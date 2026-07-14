/**
 * Calculador puro de resumen diario de asistencia y horas computables (HC).
 *
 * Reglas de negocio (spec Fase 2, sección AsistenciaResumen + integración nómina):
 * - horaEntrada: primera marcación ENTRADA del día; horaSalida: última SALIDA.
 * - Falta: día sin marcaciones de ENTRADA/SALIDA y sin justificación aprobada.
 *   Una falta con justificación aprobada NO computa como falta (justificado = true).
 * - Tardanza: si la entrada supera la tolerancia configurada, los minutos de
 *   retraso se cuentan desde la hora oficial de inicio (la tolerancia es una
 *   gracia: superada, el retraso se mide contra el horario oficial).
 * - Día inconsistente (entrada sin salida o salida sin entrada): no se pueden
 *   calcular horas → horasTrabajadas = 0 y flag `inconsistente` para revisión.
 * - HC: horas trabajadas del período; las faltas justificadas computan la
 *   jornada oficial (no descuentan) y las injustificadas no suman.
 *
 * Todos los parámetros normativos (horario, tolerancia, jornada) llegan como
 * argumentos: sin constantes mágicas ni side effects (@pure).
 */

export type TipoMarcacion = 'ENTRADA' | 'SALIDA' | 'JUSTIFICACION';

export interface MarcacionDia {
  tipo: TipoMarcacion;
  /** Hora real del evento (campo timestamp_actual de la tabla marcacion) */
  timestampActual: Date;
}

export interface ConfiguracionResumenDia {
  /** Hora oficial de inicio de jornada, formato HH:mm (ej. "08:00") */
  horaInicioDia: string;
  /** Minutos de gracia antes de considerar tardanza */
  minutosToleranciaEntrada: number;
  /** Horas de la jornada oficial; valoriza faltas justificadas en HC */
  horasJornada: number;
}

export interface JustificacionAprobadaRef {
  id: string;
}

export interface ResumenDia {
  horaEntrada: Date | null;
  horaSalida: Date | null;
  /** Horas con 2 decimales; 0 si falta o día inconsistente */
  horasTrabajadas: number;
  /** true solo si no hay marcaciones ENTRADA/SALIDA y no hay justificación aprobada */
  falta: boolean;
  /** Minutos de retraso respecto a la hora oficial; 0 si dentro de tolerancia */
  tardanzaMinutos: number;
  justificado: boolean;
  justificacionId: string | null;
  /** Entrada sin salida (o viceversa): requiere revisión manual */
  inconsistente: boolean;
}

export interface HorasComputablesResult {
  /** Suma de horas efectivamente trabajadas en el período */
  horasTrabajadas: number;
  /** HC a exportar a nómina: trabajadas + jornada por cada falta justificada */
  horasComputables: number;
  faltasInjustificadas: number;
  faltasJustificadas: number;
}

const MS_POR_HORA = 3_600_000;
const MS_POR_MINUTO = 60_000;

function redondear2(valor: number): number {
  return Math.round(valor * 100) / 100;
}

/** Construye un Date con la hora HH:mm sobre la misma fecha de referencia. @pure */
function horaEnFecha(referencia: Date, horaHHmm: string): Date {
  const [horas = 0, minutos = 0] = horaHHmm.split(':').map(Number);
  const fecha = new Date(referencia);
  fecha.setHours(horas, minutos, 0, 0);
  return fecha;
}

/**
 * Resumen de asistencia de un empleado para una fecha, a partir de sus
 * marcaciones del día (append-only: puede haber varias, en cualquier orden).
 * @pure
 */
export function construirResumenDia(
  marcacionesDelDia: MarcacionDia[],
  configuracion: ConfiguracionResumenDia,
  justificacionAprobada?: JustificacionAprobadaRef,
): ResumenDia {
  const entradas = marcacionesDelDia
    .filter((m) => m.tipo === 'ENTRADA')
    .sort((a, b) => a.timestampActual.getTime() - b.timestampActual.getTime());
  const salidas = marcacionesDelDia
    .filter((m) => m.tipo === 'SALIDA')
    .sort((a, b) => a.timestampActual.getTime() - b.timestampActual.getTime());

  const horaEntrada = entradas[0]?.timestampActual ?? null;
  const horaSalida = salidas[salidas.length - 1]?.timestampActual ?? null;

  const justificado = justificacionAprobada !== undefined;
  const sinMarcaciones = horaEntrada === null && horaSalida === null;
  // Falta: sin marcaciones y sin justificación aprobada
  const falta = sinMarcaciones && !justificado;
  // Inconsistente: una de las dos marcaciones falta (entrada sin salida o viceversa)
  const inconsistente = !sinMarcaciones && (horaEntrada === null || horaSalida === null);

  let horasTrabajadas = 0;
  if (horaEntrada !== null && horaSalida !== null) {
    horasTrabajadas = redondear2(
      (horaSalida.getTime() - horaEntrada.getTime()) / MS_POR_HORA,
    );
  }

  let tardanzaMinutos = 0;
  if (horaEntrada !== null) {
    const inicioOficial = horaEnFecha(horaEntrada, configuracion.horaInicioDia);
    const limiteTolerancia = new Date(
      inicioOficial.getTime() + configuracion.minutosToleranciaEntrada * MS_POR_MINUTO,
    );
    if (horaEntrada.getTime() > limiteTolerancia.getTime()) {
      // Superada la gracia, el retraso se mide contra la hora oficial de inicio
      tardanzaMinutos = Math.ceil(
        (horaEntrada.getTime() - inicioOficial.getTime()) / MS_POR_MINUTO,
      );
    }
  }

  return {
    horaEntrada,
    horaSalida,
    horasTrabajadas,
    falta,
    tardanzaMinutos,
    justificado,
    justificacionId: justificacionAprobada?.id ?? null,
    inconsistente,
  };
}

/**
 * Horas computables (HC) de un período para exportar a nómina:
 * suma de horas trabajadas donde la falta justificada computa la jornada
 * oficial (no descuenta) y la falta injustificada no suma horas.
 * @pure
 */
export function calcularHorasComputables(
  resumenes: ResumenDia[],
  horasJornada: number,
): HorasComputablesResult {
  let horasTrabajadas = 0;
  let horasComputables = 0;
  let faltasInjustificadas = 0;
  let faltasJustificadas = 0;

  for (const resumen of resumenes) {
    horasTrabajadas += resumen.horasTrabajadas;

    if (resumen.falta) {
      // Falta injustificada: no computa horas
      faltasInjustificadas += 1;
    } else if (resumen.justificado && resumen.horasTrabajadas === 0) {
      // Falta justificada: computa la jornada oficial completa
      faltasJustificadas += 1;
      horasComputables += horasJornada;
    } else {
      horasComputables += resumen.horasTrabajadas;
    }
  }

  return {
    horasTrabajadas: redondear2(horasTrabajadas),
    horasComputables: redondear2(horasComputables),
    faltasInjustificadas,
    faltasJustificadas,
  };
}
