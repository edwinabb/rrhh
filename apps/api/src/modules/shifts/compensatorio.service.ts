import {
  BadRequestException,
  Injectable,
  UnprocessableEntityException,
} from '@nestjs/common';

export type TipoMovimientoCompensatorio = 'GANADO' | 'GOZADO' | 'AJUSTE_INICIAL';

export interface RegistrarMovimientoInput {
  tenantId: string;
  employeeId: string;
  tipo: TipoMovimientoCompensatorio;
  dias: number;
  fechaReferencia: Date;
  motivo?: string;
  creadoPor: string;
}

export interface IntercambioInput {
  tenantId: string;
  fecha: Date;
  employeeIdA: string;
  employeeIdB: string;
  creadoPor: string;
}

/**
 * Libro mayor de descansos compensatorios e intercambios de turno (spec
 * §4.4/§4.5): saldo = suma de movimientos; el intercambio A↔B es neutro para
 * los saldos (nadie ganó ni gozó — trabajó uno en lugar del otro).
 */
@Injectable()
export class CompensatorioService {
  async obtenerSaldo(tx: any, employeeId: string): Promise<number> {
    const agregado = await tx.compensatorioMovimiento.aggregate({
      where: { employeeId },
      _sum: { dias: true },
    });
    return Number(agregado._sum.dias ?? 0);
  }

  async obtenerLibro(tx: any, employeeId: string): Promise<{ saldo: number; movimientos: any[] }> {
    const movimientos = await tx.compensatorioMovimiento.findMany({
      where: { employeeId },
      orderBy: { creadoEn: 'desc' },
    });
    return { saldo: await this.obtenerSaldo(tx, employeeId), movimientos };
  }

  async registrarMovimiento(tx: any, input: RegistrarMovimientoInput): Promise<any> {
    if (input.tipo === 'AJUSTE_INICIAL' && !input.motivo?.trim()) {
      throw new BadRequestException('AJUSTE_INICIAL requiere motivo');
    }
    if (input.tipo === 'GANADO' && !(input.dias > 0)) {
      throw new BadRequestException('Un movimiento GANADO debe tener días positivos');
    }
    if (input.tipo === 'GOZADO' && input.dias === 0) {
      throw new BadRequestException('Un movimiento GOZADO no puede ser 0');
    }
    return tx.compensatorioMovimiento.create({
      data: {
        tenantId: input.tenantId,
        employeeId: input.employeeId,
        tipo: input.tipo,
        dias: input.dias,
        fechaReferencia: input.fechaReferencia,
        motivo: input.motivo ?? null,
        creadoPor: input.creadoPor,
      },
    });
  }

  async intercambiar(tx: any, input: IntercambioInput): Promise<{ a: any; b: any }> {
    const [asigA, asigB] = await Promise.all([
      tx.turnoAsignacion.findUnique({
        where: {
          tenantId_employeeId_fecha: {
            tenantId: input.tenantId, employeeId: input.employeeIdA, fecha: input.fecha,
          },
        },
      }),
      tx.turnoAsignacion.findUnique({
        where: {
          tenantId_employeeId_fecha: {
            tenantId: input.tenantId, employeeId: input.employeeIdB, fecha: input.fecha,
          },
        },
      }),
    ]);
    const faltantes: string[] = [];
    if (!asigA) faltantes.push(`empleado A sin asignación el ${input.fecha.toISOString().slice(0, 10)}`);
    if (!asigB) faltantes.push(`empleado B sin asignación el ${input.fecha.toISOString().slice(0, 10)}`);
    if (faltantes.length > 0) {
      throw new UnprocessableEntityException({ message: 'Intercambio inválido', faltantes });
    }

    const [empA, empB] = await Promise.all([
      tx.employee.findUnique({ where: { id: input.employeeIdA } }),
      tx.employee.findUnique({ where: { id: input.employeeIdB } }),
    ]);

    const a = await tx.turnoAsignacion.update({
      where: { id: asigA.id },
      data: {
        tipoDia: asigB.tipoDia,
        turnoId: asigB.turnoId,
        notas: `Intercambio con ${empB?.numeroDocumento ?? input.employeeIdB}`,
      },
    });
    const b = await tx.turnoAsignacion.update({
      where: { id: asigB.id },
      data: {
        tipoDia: asigA.tipoDia,
        turnoId: asigA.turnoId,
        notas: `Intercambio con ${empA?.numeroDocumento ?? input.employeeIdA}`,
      },
    });
    return { a, b };
  }
}
