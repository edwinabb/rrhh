import { Injectable, BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';

export type TipoDiaPlan = 'TURNO' | 'DESCANSO' | 'DESCANSO_COMPENSATORIO';
export type EstadoIntercambioTurno =
  | 'PENDIENTE_ACEPTACION_B'
  | 'RECHAZADA_POR_B'
  | 'ACEPTADA_POR_B'
  | 'APROBADA_MANAGER'
  | 'RECHAZADA_MANAGER'
  | 'AUTO_APROBADA'
  | 'RECHAZADA_AUTOMATICA';
export type MotivoResolucionIntercambio =
  | 'PLAZO_48H'
  | 'FECHA_ALCANZADA'
  | 'FECHA_ALCANZADA_SIN_RESPUESTA_B'
  | 'TURNO_MODIFICADO';

export interface ProponerIntercambioInput {
  tenantId: string;
  employeeIdA: string;
  employeeIdB: string;
  fecha: Date;
  mensajeA?: string;
  creadoPor: string;
}

const ESTADOS_NO_TERMINALES: readonly EstadoIntercambioTurno[] = [
  'PENDIENTE_ACEPTACION_B',
  'ACEPTADA_POR_B',
];

/**
 * Portal de intercambios (fase 9): transiciones que decide directamente un
 * humano sin orquestación adicional (proponer, aceptar/rechazar de B). Las
 * decisiones del manager y las resoluciones automáticas (48h / fecha
 * alcanzada) viven en IntercambioTurnoAplicadorService (Task 4), que reusa
 * `obtener` de este servicio.
 */
@Injectable()
export class IntercambioTurnoService {
  async proponer(tx: any, input: ProponerIntercambioInput): Promise<any> {
    if (input.employeeIdA === input.employeeIdB) {
      throw new BadRequestException('Un empleado no puede proponerse un intercambio a sí mismo');
    }

    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);
    if (new Date(input.fecha) < hoy) {
      throw new BadRequestException('La fecha del intercambio no puede estar en el pasado');
    }

    const [empA, empB] = await Promise.all([
      tx.employee.findUnique({ where: { id: input.employeeIdA } }),
      tx.employee.findUnique({ where: { id: input.employeeIdB } }),
    ]);
    if (!empA || empA.estado !== 'activo') {
      throw new BadRequestException('El empleado A no está activo');
    }
    if (!empB || empB.estado !== 'activo') {
      throw new BadRequestException('El empleado B no está activo');
    }

    const [asigA, asigB] = await Promise.all([
      tx.turnoAsignacion.findUnique({
        where: { tenantId_employeeId_fecha: { tenantId: input.tenantId, employeeId: input.employeeIdA, fecha: input.fecha } },
      }),
      tx.turnoAsignacion.findUnique({
        where: { tenantId_employeeId_fecha: { tenantId: input.tenantId, employeeId: input.employeeIdB, fecha: input.fecha } },
      }),
    ]);
    if (!asigA || !asigB) {
      throw new BadRequestException('Ambos empleados deben tener un turno asignado esa fecha');
    }

    const duplicado = await tx.intercambioTurno.findFirst({
      where: {
        tenantId: input.tenantId,
        employeeIdA: input.employeeIdA,
        employeeIdB: input.employeeIdB,
        fecha: input.fecha,
        estado: { in: ESTADOS_NO_TERMINALES },
      },
    });
    if (duplicado) {
      throw new ConflictException('Ya existe una propuesta de intercambio pendiente para ese par y esa fecha');
    }

    return tx.intercambioTurno.create({
      data: {
        tenantId: input.tenantId,
        employeeIdA: input.employeeIdA,
        employeeIdB: input.employeeIdB,
        fecha: input.fecha,
        turnoActualA: asigA.tipoDia,
        turnoActualB: asigB.tipoDia,
        mensajeA: input.mensajeA ?? null,
        estado: 'PENDIENTE_ACEPTACION_B',
        creadoPor: input.creadoPor,
      },
    });
  }

  async listarMisPropuestas(tx: any, tenantId: string, employeeIdA: string): Promise<any[]> {
    return tx.intercambioTurno.findMany({
      where: { tenantId, employeeIdA },
      orderBy: { creadoEn: 'desc' },
    });
  }

  async listarPropuestasParaMi(tx: any, tenantId: string, employeeIdB: string): Promise<any[]> {
    return tx.intercambioTurno.findMany({
      where: { tenantId, employeeIdB },
      orderBy: { creadoEn: 'desc' },
    });
  }

  async obtener(tx: any, id: string): Promise<any | null> {
    return tx.intercambioTurno.findUnique({ where: { id } });
  }

  async aceptar(tx: any, tenantId: string, id: string, employeeIdB: string): Promise<any> {
    const it = await this.obtenerPendienteDeB(tx, tenantId, id, employeeIdB);
    return tx.intercambioTurno.update({
      where: { id },
      data: { estado: 'ACEPTADA_POR_B', aceptadoEn: new Date() },
    });
  }

  async rechazarPorB(tx: any, tenantId: string, id: string, employeeIdB: string, motivoRechazo?: string): Promise<any> {
    const it = await this.obtenerPendienteDeB(tx, tenantId, id, employeeIdB);
    return tx.intercambioTurno.update({
      where: { id },
      data: {
        estado: 'RECHAZADA_POR_B',
        motivoRechazo: motivoRechazo ?? null,
        decididoPor: employeeIdB,
        decididoEn: new Date(),
      },
    });
  }

  private async obtenerPendienteDeB(tx: any, tenantId: string, id: string, employeeIdB: string): Promise<any> {
    const it = await tx.intercambioTurno.findUnique({ where: { id } });
    if (!it || it.tenantId !== tenantId) {
      throw new NotFoundException(`Intercambio ${id} no encontrado`);
    }
    if (it.employeeIdB !== employeeIdB) {
      throw new BadRequestException('Solo el empleado B puede aceptar o rechazar esta propuesta');
    }
    if (it.estado !== 'PENDIENTE_ACEPTACION_B') {
      throw new BadRequestException(
        `Esta propuesta ya no está pendiente de tu respuesta (estado actual: ${it.estado})`,
      );
    }
    return it;
  }
}
