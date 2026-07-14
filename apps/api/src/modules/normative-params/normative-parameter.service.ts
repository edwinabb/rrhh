import { Injectable, NotFoundException } from '@nestjs/common';

export interface NormativeParameterRecord {
  id: string;
  codigo: string;
  valor: unknown;
  vigenciaDesde: Date;
  vigenciaHasta: Date | null;
  descripcion: string | null;
}

/**
 * Forma mínima de cliente Prisma requerida — permite testear con un mock plano,
 * y acepta indistintamente el cliente base o una transacción con RLS ya fijado.
 */
export interface NormativeParameterQueryClient {
  normativeParameter: {
    // Sintaxis de método (no propiedad-función) a propósito: los métodos se
    // chequean de forma bivariante bajo strictFunctionTypes, lo que permite
    // pasar Prisma.TransactionClient (cuyo findFirst acepta args tipados,
    // no unknown) además de mocks planos en tests.
    findFirst(args: unknown): Promise<NormativeParameterRecord | null>;
    update(args: unknown): Promise<NormativeParameterRecord>;
    create(args: unknown): Promise<NormativeParameterRecord>;
  };
}

function periodKey(fecha: Date): string {
  return `${fecha.getUTCFullYear()}-${String(fecha.getUTCMonth() + 1).padStart(2, '0')}`;
}

/**
 * Motor de parámetros normativos: resuelve por vigencia real a una fecha dada,
 * nunca "el último valor" (recalcular marzo en diciembre debe usar la UIT de
 * marzo). Ver docs/superpowers/specs/2026-07-07-fase0-fundaciones-design.md.
 */
@Injectable()
export class NormativeParameterService {
  // Cache en memoria por (codigo, periodo=YYYY-MM). Vive mientras dure el proceso
  // (ej. un job de cierre de planilla); se invalida por completo al escribir.
  // No es un cache distribuido: cada worker de BullMQ tiene el suyo, lo cual es
  // correcto porque cada worker resuelve su propio periodo de una sola vez.
  private readonly cache = new Map<string, unknown>();

  async resolve(client: NormativeParameterQueryClient, codigo: string, fecha: Date): Promise<unknown> {
    const cacheKey = `${codigo}:${periodKey(fecha)}`;
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey);
    }

    const record = await client.normativeParameter.findFirst({
      where: {
        codigo,
        vigenciaDesde: { lte: fecha },
        OR: [{ vigenciaHasta: null }, { vigenciaHasta: { gt: fecha } }],
      },
      orderBy: { vigenciaDesde: 'desc' },
    });

    if (!record) {
      throw new NotFoundException(
        `No hay parámetro normativo '${codigo}' vigente para ${fecha.toISOString().slice(0, 10)}`,
      );
    }

    this.cache.set(cacheKey, record.valor);
    return record.valor;
  }

  /**
   * Nunca actualiza `valor` de un registro existente: cierra la vigencia del
   * registro vigente anterior (si existe) e inserta uno nuevo. El historial
   * completo queda preservado para poder recalcular periodos pasados.
   */
  async createNewVersion(
    client: NormativeParameterQueryClient,
    params: {
      codigo: string;
      valor: unknown;
      vigenciaDesde: Date;
      descripcion?: string;
      createdBy: string;
    },
  ): Promise<NormativeParameterRecord> {
    const vigente = await client.normativeParameter.findFirst({
      where: { codigo: params.codigo, vigenciaHasta: null },
    });

    if (vigente) {
      const diaAnterior = new Date(params.vigenciaDesde);
      diaAnterior.setUTCDate(diaAnterior.getUTCDate() - 1);
      await client.normativeParameter.update({
        where: { id: vigente.id },
        data: { vigenciaHasta: diaAnterior },
      });
    }

    const created = await client.normativeParameter.create({
      data: {
        codigo: params.codigo,
        valor: params.valor,
        vigenciaDesde: params.vigenciaDesde,
        vigenciaHasta: null,
        descripcion: params.descripcion,
        createdBy: params.createdBy,
      },
    });

    this.invalidate(params.codigo);
    return created;
  }

  private invalidate(codigo: string): void {
    for (const key of this.cache.keys()) {
      if (key.startsWith(`${codigo}:`)) {
        this.cache.delete(key);
      }
    }
  }
}
