/**
 * Vacaciones al cese (D.Leg. 713):
 * - Devengadas: días ganados no gozados de períodos vencidos × valor-día vigente.
 * - Truncas: proporcional del período EN_CURSO — (meses completos + días/30)/12
 *   sobre la remuneración vacacional del período (diasGanados/30 × computable).
 * - Indemnización (art. 23): una remuneración adicional por período vencido hace
 *   más de un año sin gozar; excluible para gerentes que deciden sus vacaciones.
 * Ver spec 2026-07-15-liquidacion-cese-design.md §4.2.
 */
export type EstadoPeriodoVacacional = 'EN_CURSO' | 'VENCIDO_PENDIENTE' | 'GOZADO' | 'LIQUIDADO';

export interface PeriodoVacacionalInput {
  periodoInicio: Date;
  periodoFin: Date;
  diasGanados: number;
  diasGozados: number;
  estado: EstadoPeriodoVacacional;
}

export interface VacacionesCeseInput {
  remuneracionComputable: number;
  fechaCese: Date;
  periodos: PeriodoVacacionalInput[];
  excluidoIndemnizacion: boolean;
}

export interface VacacionesCeseResult {
  vacacionesDevengadas: number;
  vacacionesTruncas: number;
  indemnizacionVacacional: number;
}

const DIAS_POR_MES = 30;
const MESES_POR_ANIO = 12;

function redondear(monto: number): number {
  return Math.round(monto * 100) / 100;
}

/** Meses calendario completos + días sueltos entre dos fechas (convención 30/360 del proyecto). */
function mesesYDias(desde: Date, hasta: Date): { meses: number; dias: number } {
  let meses =
    (hasta.getUTCFullYear() - desde.getUTCFullYear()) * 12 +
    (hasta.getUTCMonth() - desde.getUTCMonth());
  let dias = hasta.getUTCDate() - desde.getUTCDate();
  if (dias < 0) {
    meses -= 1;
    dias += DIAS_POR_MES;
  }
  return { meses: Math.max(0, meses), dias: Math.max(0, dias) };
}

function anioDespues(fecha: Date): Date {
  const d = new Date(fecha);
  d.setUTCFullYear(d.getUTCFullYear() + 1);
  return d;
}

export function calcularVacacionesCese(input: VacacionesCeseInput): VacacionesCeseResult {
  const valorDia = input.remuneracionComputable / DIAS_POR_MES;
  let devengadas = 0;
  let truncas = 0;
  let periodosConIndemnizacion = 0;

  for (const periodo of input.periodos) {
    if (periodo.estado === 'GOZADO' || periodo.estado === 'LIQUIDADO') continue;

    if (periodo.estado === 'VENCIDO_PENDIENTE') {
      const diasPendientes = Math.max(0, periodo.diasGanados - periodo.diasGozados);
      devengadas += diasPendientes * valorDia;
      if (
        diasPendientes > 0 &&
        anioDespues(periodo.periodoFin).getTime() < input.fechaCese.getTime()
      ) {
        periodosConIndemnizacion += 1;
      }
      continue;
    }

    // EN_CURSO: récord trunco proporcional al tiempo transcurrido del período.
    const { meses, dias } = mesesYDias(periodo.periodoInicio, input.fechaCese);
    const fraccion = meses / MESES_POR_ANIO + dias / (MESES_POR_ANIO * DIAS_POR_MES);
    const remuneracionVacacional =
      (periodo.diasGanados / DIAS_POR_MES) * input.remuneracionComputable;
    truncas += remuneracionVacacional * Math.min(1, fraccion);
  }

  const indemnizacion = input.excluidoIndemnizacion
    ? 0
    : periodosConIndemnizacion * input.remuneracionComputable;

  return {
    vacacionesDevengadas: redondear(devengadas),
    vacacionesTruncas: redondear(truncas),
    indemnizacionVacacional: redondear(indemnizacion),
  };
}
