import { Injectable } from '@nestjs/common';

/**
 * Genera el archivo de importación PLAME, Estructura 18 ("Trabajador: Detalle
 * de ingresos, tributos y descuentos"). Layout exacto documentado en
 * docs/superpowers/specs/anexo3-estructuras-archivos.md, sección E18.
 */
export interface PlanillaDetalleRow {
  tipoDocumento: string;
  numeroDocumento: string;
  codigoConceptoSunat: string;
  montoDevengado: number;
  montoPagado: number;
}

// Códigos de "totales calculados" que la Estructura 18 prohíbe declarar
// explícitamente — ver anexo3-estructuras-archivos.md, sección E18.
const CODIGOS_EXCLUIDOS = new Set([
  '0100', '0200', '0300', '0400', '0500', '0600', '0603', '0604',
  '0607', '0610', '0612', '0616', '0800', '0802', '0804', '0806', '0808',
]);

@Injectable()
export class PlanillaExporter {
  exportarE18(filas: PlanillaDetalleRow[]): string {
    return filas
      .map((fila) => {
        if (CODIGOS_EXCLUIDOS.has(fila.codigoConceptoSunat)) {
          throw new Error(
            `El código ${fila.codigoConceptoSunat} es un total calculado — no se declara en la Estructura 18`,
          );
        }
        return [
          fila.tipoDocumento,
          fila.numeroDocumento,
          fila.codigoConceptoSunat,
          fila.montoDevengado.toFixed(2),
          fila.montoPagado.toFixed(2),
        ].join('|');
      })
      .join('\n');
  }
}
