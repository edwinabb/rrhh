/**
 * CTS: remuneración computable = sueldo + 1/6 de la gratificación del semestre
 * que corresponde. Depósitos: mayo (cubre nov-abr) y noviembre (cubre may-oct),
 * proporcional a meses y días completos trabajados en el semestre.
 * Ver especificaciones-fases.md, Fase 1, regla de cálculo #1.
 */
export interface CtsCalculatorInput {
  sueldo: number;
  gratificacionSemestral: number;
  mesesCompletos: number;
  diasAdicionales: number;
}

export interface CtsTruncaInput {
  sueldo: number;
  gratificacionSemestral: number;
  mesesCompletosDesdeUltimoDeposito: number;
  diasAdicionales: number;
}

export interface CtsResult {
  remuneracionComputable: number;
  montoDeposito: number;
}

const DIAS_POR_MES = 30;
const MESES_SEMESTRE = 6;

function remuneracionComputable(sueldo: number, gratificacionSemestral: number): number {
  return sueldo + gratificacionSemestral / MESES_SEMESTRE;
}

function fraccionSemestre(mesesCompletos: number, diasAdicionales: number): number {
  return mesesCompletos / MESES_SEMESTRE + diasAdicionales / (MESES_SEMESTRE * DIAS_POR_MES);
}

export function calcularCts(input: CtsCalculatorInput): CtsResult {
  const computable = remuneracionComputable(input.sueldo, input.gratificacionSemestral);
  const fraccion = fraccionSemestre(input.mesesCompletos, input.diasAdicionales);
  return {
    remuneracionComputable: computable,
    montoDeposito: computable * fraccion,
  };
}

export function calcularCtsTrunca(input: CtsTruncaInput): CtsResult {
  const computable = remuneracionComputable(input.sueldo, input.gratificacionSemestral);
  const fraccion = fraccionSemestre(
    input.mesesCompletosDesdeUltimoDeposito,
    input.diasAdicionales,
  );
  return {
    remuneracionComputable: computable,
    montoDeposito: computable * fraccion,
  };
}
