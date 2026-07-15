/**
 * Indemnización por despido arbitrario (D.S. 003-97-TR arts. 38 y 76):
 * - Indeterminado: 1.5 remuneraciones mensuales por año completo + fracción
 *   proporcional por meses/días; tope 12 remuneraciones.
 * - Plazo fijo: 1.5 remuneraciones por mes que falte al vencimiento; tope 12.
 * - MYPE (D.S. 013-2013-PRODUCE): pequeña 20 remuneraciones diarias/año (tope
 *   120 días); micro 10/año (tope 90 días).
 * Ver spec 2026-07-15-liquidacion-cese-design.md §4.3.
 */
export type RegimenLaboral = 'general' | 'mype_micro' | 'mype_pequena' | 'agrario';
export type TipoContratoIndemnizacion = 'indeterminado' | 'plazo_fijo';

export interface IndemnizacionMypeParams {
  diasPorAnio: number;
  topeDias: number;
}

export interface IndemnizacionDespidoInput {
  regimen: RegimenLaboral;
  tipoContrato: TipoContratoIndemnizacion;
  remuneracionMensual: number;
  aniosCompletos: number;
  mesesAdicionales: number;
  diasAdicionales: number;
  /** Solo plazo fijo: meses que faltan hasta el vencimiento pactado. */
  mesesRestantesContrato: number;
  topeRemuneraciones: number;
  mypeParams: { mype_pequena: IndemnizacionMypeParams; mype_micro: IndemnizacionMypeParams };
}

export interface IndemnizacionDespidoResult {
  monto: number;
  topeAplicado: boolean;
}

const FACTOR_GENERAL = 1.5;
const DIAS_POR_MES = 30;

function redondear(monto: number): number {
  return Math.round(monto * 100) / 100;
}

export function calcularIndemnizacionDespido(
  input: IndemnizacionDespidoInput,
): IndemnizacionDespidoResult {
  const aniosConFraccion =
    input.aniosCompletos + input.mesesAdicionales / 12 + input.diasAdicionales / 360;

  if (input.regimen === 'mype_micro' || input.regimen === 'mype_pequena') {
    const params = input.mypeParams[input.regimen];
    const remuneracionDiaria = input.remuneracionMensual / DIAS_POR_MES;
    const dias = params.diasPorAnio * aniosConFraccion;
    const diasConTope = Math.min(dias, params.topeDias);
    return {
      monto: redondear(diasConTope * remuneracionDiaria),
      topeAplicado: dias > params.topeDias,
    };
  }

  const base =
    input.tipoContrato === 'plazo_fijo'
      ? FACTOR_GENERAL * input.remuneracionMensual * input.mesesRestantesContrato
      : FACTOR_GENERAL * input.remuneracionMensual * aniosConFraccion;
  const tope = input.topeRemuneraciones * input.remuneracionMensual;

  return { monto: redondear(Math.min(base, tope)), topeAplicado: base > tope };
}
