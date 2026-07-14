import { Injectable } from '@nestjs/common';

export type EstadoVacante = 'ABIERTA' | 'PAUSADA' | 'CERRADA';

export interface CrearVacanteInput {
  tenantId: string;
  titulo: string;
  descripcion: string;
  /** Estructura libre: skills, experiencia, educación... */
  requisitos: unknown;
  salarioMin?: number;
  salarioMax?: number;
  sedeId?: string;
  /** User id que crea la vacante. */
  creadoPor: string;
}

export interface ListarVacantesFiltros {
  tenantId: string;
  estado?: EstadoVacante;
}

/**
 * Servicio de vacantes (ATS, Fase 4). Mismo patrón que AttendanceService /
 * PayrollRunService: cada método recibe el cliente/tx de Prisma como
 * parámetro (el controller decide la transacción).
 *
 * Regla de negocio central: una vacante CERRADA es terminal — fija
 * cerradaEn y deja de aceptar candidatos nuevos (lo valida CandidateService
 * en registrarCandidato).
 */
@Injectable()
export class VacanteService {
  /** Crea una vacante en estado ABIERTA. */
  async crearVacante(tx: any, input: CrearVacanteInput) {
    if (!input.titulo || !input.titulo.trim()) {
      throw new Error('La vacante requiere un título');
    }

    return tx.vacante.create({
      data: {
        tenantId: input.tenantId,
        titulo: input.titulo.trim(),
        descripcion: input.descripcion,
        requisitos: input.requisitos,
        salarioMin: input.salarioMin,
        salarioMax: input.salarioMax,
        sedeId: input.sedeId,
        creadoPor: input.creadoPor,
        estado: 'ABIERTA',
      },
    });
  }

  /** Lista las vacantes del tenant, opcionalmente filtradas por estado. */
  async listarVacantes(tx: any, filtros: ListarVacantesFiltros) {
    const where: Record<string, unknown> = { tenantId: filtros.tenantId };
    if (filtros.estado) {
      where.estado = filtros.estado;
    }

    return tx.vacante.findMany({
      where,
      orderBy: { creadoEn: 'desc' },
    });
  }

  /**
   * Cierra una vacante: estado → CERRADA y fija cerradaEn.
   * CERRADA es terminal: cerrar dos veces es un error (y una vacante cerrada
   * no acepta candidatos nuevos).
   */
  async cerrarVacante(tx: any, id: string) {
    const vacante = await tx.vacante.findUnique({ where: { id } });
    if (!vacante) {
      throw new Error(`Vacante no encontrada: ${id}`);
    }
    if (vacante.estado === 'CERRADA') {
      throw new Error(`La vacante ${id} ya está CERRADA`);
    }

    return tx.vacante.update({
      where: { id },
      data: { estado: 'CERRADA', cerradaEn: new Date() },
    });
  }
}
