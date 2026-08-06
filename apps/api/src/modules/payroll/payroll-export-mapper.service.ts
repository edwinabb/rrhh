import { Injectable } from '@nestjs/common';

export interface PlanillaDetalleRow {
  tipoDocumento: string;
  numeroDocumento: string;
  codigoConceptoSunat: string;
  montoDevengado: number;
  montoPagado: number;
}

export interface ConceptoCalculado {
  codigo: string;
  nombre: string;
  monto: number;
}

@Injectable()
export class PayrollExportMapperService {
  /**
   * Obtiene la configuración de exportación del tenant. Si no existe,
   * retorna defaults.
   */
  async obtenerConfig(tx: any, tenantId: string): Promise<any> {
    const config = await tx.tenantPayrollExportConfig.findUnique({
      where: { tenantId },
    });
    return (
      config ?? {
        montoMode: 'devengado_igual_pagado',
        formatoExportar: 'pipe',
        conceptosExcluidos: [],
        camposSensibles: [],
      }
    );
  }

  /**
   * Mapea conceptos calculados a filas de Estructura 18 (PLAME).
   * Maneja `montoMode`: devengado_igual_pagado vs devengado_con_descuentos.
   */
  mapearConceptosA18(
    conceptos: ConceptoCalculado[],
    tipoDocumento: string,
    numeroDocumento: string,
    montoMode: string,
  ): PlanillaDetalleRow[] {
    return conceptos.map((c) => {
      const devengado = c.monto;
      const pagado =
        montoMode === 'devengado_con_descuentos' ? devengado * 0.95 : devengado;

      return {
        tipoDocumento,
        numeroDocumento,
        codigoConceptoSunat: c.codigo,
        montoDevengado: devengado,
        montoPagado: pagado,
      };
    });
  }

  /**
   * Filtra conceptos excluidos (ej: códigos de totales calculados).
   */
  filtrarConceptosExcluidos(
    filas: PlanillaDetalleRow[],
    conceptosExcluidos: string[],
  ): PlanillaDetalleRow[] {
    if (!conceptosExcluidos.length) return filas;
    return filas.filter(
      (f) => !conceptosExcluidos.includes(f.codigoConceptoSunat),
    );
  }
}
