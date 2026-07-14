/**
 * Calculador de horas extra — normativa peruana:
 * - D.Leg. 854 (TUO aprobado por D.S. 007-2002-TR), jornada máxima: 8h/día o 48h/semana.
 * - Recargo mínimo: 25% del valor hora por las primeras 2 horas extra,
 *   35% por las horas siguientes (art. 10 del TUO).
 *
 * Todas las funciones son puras: sin side effects, los parámetros normativos
 * se reciben como argumentos y los defaults legales se exportan como
 * constantes documentadas (pueden ser reemplazados por configuración del
 * tenant o convenios colectivos más favorables).
 */

/** Jornada máxima diaria legal en Perú (D.Leg. 854): 8 horas. */
export const JORNADA_MAXIMA_DIARIA_LEGAL = 8;

/** Jornada máxima semanal legal en Perú (D.Leg. 854): 48 horas. */
export const JORNADA_MAXIMA_SEMANAL_LEGAL = 48;

/** Parámetros de recargo por sobretiempo. */
export interface RecargoParams {
  /** Cantidad de horas extra que pagan la tasa del primer tramo. */
  horasPrimerTramo: number;
  /** Tasa de recargo del primer tramo (ej. 0.25 = 25%). */
  tasaPrimerTramo: number;
  /** Tasa de recargo a partir de la hora siguiente al primer tramo. */
  tasaSegundoTramo: number;
}

/** Tasas mínimas legales de sobretiempo según D.Leg. 854 (art. 10 del TUO). */
export const TASAS_RECARGO_DLEG_854: RecargoParams = {
  horasPrimerTramo: 2,
  tasaPrimerTramo: 0.25,
  tasaSegundoTramo: 0.35,
};

export interface RecargoResult {
  /** Horas extra pagadas a la tasa del primer tramo. */
  horasPrimerTramo: number;
  /** Horas extra pagadas a la tasa del segundo tramo. */
  horasSegundoTramo: number;
  /** Monto del recargo (solo la sobretasa, sin el valor hora base). */
  recargo: number;
  /** Pago total del sobretiempo: valor hora base + recargo. */
  pagoTotal: number;
}

/**
 * Horas extra diarias: excedente sobre la jornada máxima diaria.
 * @pure
 */
export function calcularHorasExtraDiarias(
  horasTrabajadasDia: number,
  jornadaMaximaDiaria: number = JORNADA_MAXIMA_DIARIA_LEGAL,
): number {
  return Math.max(0, horasTrabajadasDia - jornadaMaximaDiaria);
}

/**
 * Horas extra semanales: excedente sobre la jornada máxima semanal,
 * descontando las horas ya contadas como extra diaria para evitar
 * el doble conteo (cada día se computa topeado a la jornada diaria).
 * @pure
 */
export function calcularHorasExtraSemanales(
  horasPorDia: number[],
  jornadaMaximaSemanal: number = JORNADA_MAXIMA_SEMANAL_LEGAL,
  jornadaMaximaDiaria: number = JORNADA_MAXIMA_DIARIA_LEGAL,
): number {
  // Solo las horas dentro del tope diario cuentan para el tope semanal;
  // el excedente diario ya fue contabilizado como extra diaria.
  const horasComputables = horasPorDia.reduce(
    (total, horas) => total + Math.min(horas, jornadaMaximaDiaria),
    0,
  );
  return Math.max(0, horasComputables - jornadaMaximaSemanal);
}

/**
 * Recargo por sobretiempo (D.Leg. 854): primeras `horasPrimerTramo` horas
 * a la tasa del primer tramo, las siguientes a la tasa del segundo tramo.
 * Las tasas y el tramo se reciben como parámetros (mínimos legales por defecto)
 * para permitir convenios más favorables al trabajador.
 * @pure
 */
export function calcularRecargo(
  horasExtra: number,
  valorHora: number,
  params: RecargoParams = TASAS_RECARGO_DLEG_854,
): RecargoResult {
  const horasPrimerTramo = Math.min(horasExtra, params.horasPrimerTramo);
  const horasSegundoTramo = Math.max(0, horasExtra - params.horasPrimerTramo);

  const recargo =
    horasPrimerTramo * valorHora * params.tasaPrimerTramo +
    horasSegundoTramo * valorHora * params.tasaSegundoTramo;

  return {
    horasPrimerTramo,
    horasSegundoTramo,
    recargo,
    pagoTotal: horasExtra * valorHora + recargo,
  };
}
