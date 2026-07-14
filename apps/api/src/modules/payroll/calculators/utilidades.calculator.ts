/**
 * Utilidades: renta neta × tasa por sector (parametrizable), distribuida 50%
 * en función de días laborados y 50% en función de remuneración percibida en
 * el ejercicio, con tope de 18 remuneraciones mensuales por trabajador.
 * Ver especificaciones-fases.md, Fase 1, regla de cálculo #3.
 */
export interface UtilidadesInput {
  rentaNeta: number;
  tasaPorSector: number;
  diasLaboradosTrabajador: number;
  diasLaboradosTotalEmpresa: number;
  remuneracionPercibidaTrabajador: number;
  remuneracionPercibidaTotalEmpresa: number;
  remuneracionMensualPromedio: number;
  topeRemuneracionesMensuales: number;
}

export interface UtilidadesResult {
  montoAntesDelTope: number;
  montoFinal: number;
  topeAplicado: boolean;
}

export function calcularUtilidades(input: UtilidadesInput): UtilidadesResult {
  const bolsaUtilidades = input.rentaNeta * input.tasaPorSector;
  const porDias =
    bolsaUtilidades * 0.5 * (input.diasLaboradosTrabajador / input.diasLaboradosTotalEmpresa);
  const porRemuneracion =
    bolsaUtilidades *
    0.5 *
    (input.remuneracionPercibidaTrabajador / input.remuneracionPercibidaTotalEmpresa);
  const montoAntesDelTope = porDias + porRemuneracion;
  const tope = input.remuneracionMensualPromedio * input.topeRemuneracionesMensuales;
  const topeAplicado = montoAntesDelTope > tope;

  return {
    montoAntesDelTope,
    montoFinal: topeAplicado ? tope : montoAntesDelTope,
    topeAplicado,
  };
}
