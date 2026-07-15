import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { NormativeParameterService } from '../normative-params/normative-parameter.service';

export interface CrearPeriodoInput {
  tenantId: string;
  employeeId: string;
  periodoInicio: Date;
}

export interface ActualizarPeriodoInput {
  diasGozados?: number;
  estado?: 'EN_CURSO' | 'VENCIDO_PENDIENTE' | 'GOZADO' | 'LIQUIDADO';
  notas?: string;
}

/**
 * Récord vacacional (D.Leg. 713). Fuente de verdad de los períodos y días
 * gozados; el módulo de cese lo lee para pre-llenar la liquidación. Mismo
 * patrón que DocumentService: los métodos reciben el tx de Prisma.
 */
@Injectable()
export class VacationsService {
  constructor(private readonly normativeParams: NormativeParameterService) {}

  async listarPorEmpleado(tx: any, employeeId: string): Promise<any[]> {
    return tx.vacacionPeriodo.findMany({
      where: { employeeId },
      orderBy: { periodoInicio: 'asc' },
    });
  }

  async crearPeriodo(tx: any, input: CrearPeriodoInput): Promise<any> {
    const contrato = await tx.contrato.findFirst({
      where: { employeeId: input.employeeId },
      orderBy: { fechaInicio: 'desc' },
    });
    if (!contrato) {
      throw new BadRequestException('El empleado no tiene contrato registrado');
    }

    const esMype =
      contrato.regimenLaboral === 'mype_micro' || contrato.regimenLaboral === 'mype_pequena';
    const diasGanados = (await this.normativeParams.resolve(
      tx,
      esMype ? 'VACACIONES_DIAS_MYPE' : 'VACACIONES_DIAS_GENERAL',
      input.periodoInicio,
    )) as number;

    const periodoFin = new Date(input.periodoInicio);
    periodoFin.setUTCFullYear(periodoFin.getUTCFullYear() + 1);
    periodoFin.setUTCDate(periodoFin.getUTCDate() - 1);

    return tx.vacacionPeriodo.create({
      data: {
        tenantId: input.tenantId,
        employeeId: input.employeeId,
        periodoInicio: input.periodoInicio,
        periodoFin,
        diasGanados,
      },
    });
  }

  async actualizarPeriodo(tx: any, id: string, cambios: ActualizarPeriodoInput): Promise<any> {
    const periodo = await tx.vacacionPeriodo.findUnique({ where: { id } });
    if (!periodo) throw new NotFoundException(`Período vacacional ${id} no encontrado`);
    if (periodo.estado === 'LIQUIDADO') {
      throw new BadRequestException('Un período LIQUIDADO no puede modificarse');
    }

    const data: Record<string, unknown> = {};
    if (cambios.notas !== undefined) data.notas = cambios.notas;
    if (cambios.estado !== undefined) data.estado = cambios.estado;
    if (cambios.diasGozados !== undefined) {
      if (cambios.diasGozados < 0 || cambios.diasGozados > periodo.diasGanados) {
        throw new BadRequestException(
          `diasGozados debe estar entre 0 y ${periodo.diasGanados}`,
        );
      }
      data.diasGozados = cambios.diasGozados;
      if (cambios.estado === undefined && cambios.diasGozados >= periodo.diasGanados) {
        data.estado = 'GOZADO';
      }
    }

    return tx.vacacionPeriodo.update({ where: { id }, data });
  }
}
