import { calcularCtsTrunca } from './cts.calculator';
import { calcularGratificacion } from './gratificacion.calculator';

/**
 * Liquidación de beneficios truncos (dentro de 48h desde el cese): CTS trunca
 * + gratificación trunca + vacaciones truncas (proporcional a meses/días desde
 * el inicio del periodo vacacional vigente) + conceptos pendientes de pago.
 * Ver especificaciones-fases.md, Fase 1, regla de cálculo #4.
 */
export interface LiquidacionInput {
  sueldo: number;
  gratificacionSemestral: number;
  mesesCompletosDesdeUltimoDepositoCts: number;
  diasAdicionalesCts: number;
  mesesCompletosGratificacionTrunca: number;
  diasVacacionesPendientes: number;
  valorDiaVacacional: number;
  conceptosPendientesDePago: number;
}

export interface LiquidacionResult {
  ctsTrunca: number;
  gratificacionTrunca: number;
  vacacionesTruncas: number;
  conceptosPendientes: number;
  total: number;
}

export function calcularLiquidacion(input: LiquidacionInput): LiquidacionResult {
  const cts = calcularCtsTrunca({
    sueldo: input.sueldo,
    gratificacionSemestral: input.gratificacionSemestral,
    mesesCompletosDesdeUltimoDeposito: input.mesesCompletosDesdeUltimoDepositoCts,
    diasAdicionales: input.diasAdicionalesCts,
  });

  const gratificacion = calcularGratificacion({
    sueldo: input.sueldo,
    asignacionFamiliar: 0,
    conceptosRemunerativosRegulares: 0,
    mesesCompletos: input.mesesCompletosGratificacionTrunca,
    afiliadoEps: false,
    tasaBonifEssalud: 0, // la liquidacion trunca reporta solo el monto base, no la bonificacion
    tasaBonifEps: 0,
  });

  const vacacionesTruncas = input.valorDiaVacacional * input.diasVacacionesPendientes;

  const total =
    cts.montoDeposito +
    gratificacion.montoGratificacion +
    vacacionesTruncas +
    input.conceptosPendientesDePago;

  return {
    ctsTrunca: cts.montoDeposito,
    gratificacionTrunca: gratificacion.montoGratificacion,
    vacacionesTruncas,
    conceptosPendientes: input.conceptosPendientesDePago,
    total,
  };
}
