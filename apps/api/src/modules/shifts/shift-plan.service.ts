import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';

const HORA_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;
export type TipoDiaPlan = 'TURNO' | 'DESCANSO' | 'DESCANSO_COMPENSATORIO';

export interface CrearTurnoInput {
  tenantId: string;
  codigo: string;
  nombre: string;
  horaInicio: string;
  horaFin: string;
  horasEsperadas: number;
  toleranciaMinutos?: number;
}

export interface UpsertAsignacionInput {
  tenantId: string;
  employeeId: string;
  fecha: Date;
  tipoDia: TipoDiaPlan;
  turnoId?: string;
  notas?: string;
  creadoPor: string;
  /** Permite programar goce sin saldo (queda auditado; exige notas). */
  forzarSinSaldo?: boolean;
}

/**
 * Catálogo de turnos y plan empleado×fecha (spec §3.1/§3.2/§4.5). Asignar
 * DESCANSO_COMPENSATORIO registra GOZADO −1 en el libro; quitar/cambiar ese
 * día registra el movimiento inverso (+1) — el libro es append-only.
 */
@Injectable()
export class ShiftPlanService {
  async listarTurnos(tx: any, incluirInactivos = false): Promise<any[]> {
    return tx.turno.findMany({
      where: incluirInactivos ? {} : { activo: true },
      orderBy: { codigo: 'asc' },
    });
  }

  async crearTurno(tx: any, input: CrearTurnoInput): Promise<any> {
    this.validarHorario(input.horaInicio, input.horaFin, input.horasEsperadas);
    const existente = await tx.turno.findFirst({ where: { codigo: input.codigo } });
    if (existente) {
      throw new ConflictException(`Ya existe un turno con código "${input.codigo}"`);
    }
    return tx.turno.create({
      data: {
        tenantId: input.tenantId,
        codigo: input.codigo,
        nombre: input.nombre,
        horaInicio: input.horaInicio,
        horaFin: input.horaFin,
        horasEsperadas: input.horasEsperadas,
        toleranciaMinutos: input.toleranciaMinutos ?? 30,
      },
    });
  }

  async actualizarTurno(
    tx: any,
    id: string,
    cambios: Partial<Omit<CrearTurnoInput, 'tenantId' | 'codigo'>> & { activo?: boolean },
  ): Promise<any> {
    const turno = await tx.turno.findUnique({ where: { id } });
    if (!turno) throw new NotFoundException(`Turno ${id} no encontrado`);
    if (cambios.horaInicio !== undefined || cambios.horaFin !== undefined || cambios.horasEsperadas !== undefined) {
      this.validarHorario(
        cambios.horaInicio ?? turno.horaInicio,
        cambios.horaFin ?? turno.horaFin,
        cambios.horasEsperadas ?? Number(turno.horasEsperadas),
      );
    }
    return tx.turno.update({ where: { id }, data: cambios });
  }

  async obtenerPlan(tx: any, desde: Date, hasta: Date, employeeId?: string): Promise<any[]> {
    return tx.turnoAsignacion.findMany({
      where: { fecha: { gte: desde, lte: hasta }, ...(employeeId ? { employeeId } : {}) },
      include: {
        turno: { select: { codigo: true, nombre: true, horaInicio: true, horaFin: true } },
        employee: { select: { nombres: true, apellidos: true, numeroDocumento: true } },
      },
      orderBy: [{ employeeId: 'asc' }, { fecha: 'asc' }],
    });
  }

  async upsertAsignacion(tx: any, input: UpsertAsignacionInput): Promise<any> {
    const empleado = await tx.employee.findUnique({ where: { id: input.employeeId } });
    if (!empleado) throw new NotFoundException(`Empleado ${input.employeeId} no encontrado`);
    if (empleado.estado === 'cesado') {
      throw new BadRequestException('No se puede asignar plan a un empleado cesado');
    }

    if (input.tipoDia === 'TURNO') {
      if (!input.turnoId) throw new BadRequestException('tipoDia TURNO requiere turnoId');
      const turno = await tx.turno.findUnique({ where: { id: input.turnoId } });
      if (!turno || !turno.activo) {
        throw new BadRequestException('El turno no existe o está inactivo');
      }
    }

    const previa = await tx.turnoAsignacion.findUnique({
      where: {
        tenantId_employeeId_fecha: {
          tenantId: input.tenantId,
          employeeId: input.employeeId,
          fecha: input.fecha,
        },
      },
    });

    // Programar goce: exige saldo > 0 (o forzar con notas — spec §4.5)
    if (input.tipoDia === 'DESCANSO_COMPENSATORIO' && previa?.tipoDia !== 'DESCANSO_COMPENSATORIO') {
      const agregado = await tx.compensatorioMovimiento.aggregate({
        where: { employeeId: input.employeeId },
        _sum: { dias: true },
      });
      const saldo = Number(agregado._sum.dias ?? 0);
      if (saldo <= 0 && !input.forzarSinSaldo) {
        throw new UnprocessableEntityException({
          message: `El empleado no tiene saldo de compensatorios (saldo: ${saldo})`,
          saldo,
        });
      }
      if (saldo <= 0 && !input.notas) {
        throw new BadRequestException('Forzar goce sin saldo requiere notas');
      }
    }

    const asignacion = await tx.turnoAsignacion.upsert({
      where: {
        tenantId_employeeId_fecha: {
          tenantId: input.tenantId,
          employeeId: input.employeeId,
          fecha: input.fecha,
        },
      },
      update: {
        tipoDia: input.tipoDia,
        turnoId: input.tipoDia === 'TURNO' ? input.turnoId : null,
        notas: input.notas ?? null,
      },
      create: {
        tenantId: input.tenantId,
        employeeId: input.employeeId,
        fecha: input.fecha,
        tipoDia: input.tipoDia,
        turnoId: input.tipoDia === 'TURNO' ? input.turnoId : null,
        notas: input.notas ?? null,
      },
    });

    // Movimientos del libro (append-only): alta y reversión de goce
    if (input.tipoDia === 'DESCANSO_COMPENSATORIO' && previa?.tipoDia !== 'DESCANSO_COMPENSATORIO') {
      await tx.compensatorioMovimiento.create({
        data: {
          tenantId: input.tenantId,
          employeeId: input.employeeId,
          tipo: 'GOZADO',
          dias: -1,
          fechaReferencia: input.fecha,
          turnoAsignacionId: asignacion.id,
          creadoPor: input.creadoPor,
        },
      });
    } else if (previa?.tipoDia === 'DESCANSO_COMPENSATORIO' && input.tipoDia !== 'DESCANSO_COMPENSATORIO') {
      await tx.compensatorioMovimiento.create({
        data: {
          tenantId: input.tenantId,
          employeeId: input.employeeId,
          tipo: 'GOZADO',
          dias: 1,
          fechaReferencia: input.fecha,
          turnoAsignacionId: previa.id,
          motivo: 'Reversión: el día dejó de ser descanso compensatorio',
          creadoPor: input.creadoPor,
        },
      });
    }

    return asignacion;
  }

  private validarHorario(horaInicio: string, horaFin: string, horasEsperadas: number): void {
    if (!HORA_REGEX.test(horaInicio) || !HORA_REGEX.test(horaFin)) {
      throw new BadRequestException('horaInicio y horaFin deben tener formato HH:mm');
    }
    if (!(horasEsperadas > 0) || horasEsperadas > 24) {
      throw new BadRequestException('horasEsperadas debe ser mayor a 0 y hasta 24');
    }
  }
}
