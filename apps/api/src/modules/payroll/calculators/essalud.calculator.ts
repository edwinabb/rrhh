/**
 * EsSalud: 9% a cargo del empleador (no es descuento al trabajador); tasa
 * reducida si el tenant tiene convenio EPS (parametrizable).
 * Ver especificaciones-fases.md, Fase 1, regla de cálculo #8.
 */
export interface EssaludInput {
  remuneracion: number;
  tieneConvenioEps: boolean;
  tasaEssalud: number;
  tasaEssaludConEps: number;
}

export interface EssaludResult {
  montoAporteEmpleador: number;
}

export function calcularAporteEssalud(input: EssaludInput): EssaludResult {
  const tasa = input.tieneConvenioEps ? input.tasaEssaludConEps : input.tasaEssalud;
  return { montoAporteEmpleador: input.remuneracion * tasa };
}
