/**
 * AFP: aporte obligatorio (parametrizable, ~10%) + comisión (flujo sobre
 * remuneración o mixta sobre saldo) + prima de seguro (con tope de
 * remuneración máxima asegurable). ONP: tasa parametrizable (~13%) sin tope.
 * Ver especificaciones-fases.md, Fase 1, reglas de cálculo #6 y #7.
 */
export interface PensionInput {
  sistema: 'afp' | 'onp';
  remuneracion: number;
  tasaOnp: number;
  aportacionObligatoriaAfp: number;
  comisionAfp: number;
  tipoComision: 'flujo' | 'mixta';
  primaSeguroAfp: number;
  topeRemuneracionMaximaAsegurable: number;
}

export interface PensionResult {
  montoRetenido: number;
}

export function calcularRetencionPensionaria(input: PensionInput): PensionResult {
  if (input.sistema === 'onp') {
    return { montoRetenido: input.remuneracion * input.tasaOnp };
  }

  const aporte = input.remuneracion * input.aportacionObligatoriaAfp;
  // La comisión "mixta" (sobre saldo acumulado) requiere el saldo del
  // trabajador — fuera de alcance de este cálculo mensual; se modela en la
  // capa de servicio cuando exista el módulo de saldos (deuda técnica Fase 1).
  const comision = input.remuneracion * input.comisionAfp;
  const baseAsegurable = Math.min(input.remuneracion, input.topeRemuneracionMaximaAsegurable);
  const prima = baseAsegurable * input.primaSeguroAfp;

  return { montoRetenido: aporte + comision + prima };
}
