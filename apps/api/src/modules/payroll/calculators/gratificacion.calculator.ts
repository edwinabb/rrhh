/**
 * Gratificación: sueldo computable = sueldo + asignación familiar + conceptos
 * remunerativos regulares del semestre. Monto = sueldo computable × (meses
 * completos trabajados / 6). Bonificación extraordinaria Ley 30334: 9% sobre
 * el monto de gratificación (6.75% si el trabajador está afiliado a EPS).
 * Ver especificaciones-fases.md, Fase 1, regla de cálculo #2.
 */
export interface GratificacionInput {
  sueldo: number;
  asignacionFamiliar: number;
  conceptosRemunerativosRegulares: number;
  mesesCompletos: number;
  afiliadoEps: boolean;
  tasaBonifEssalud: number;
  tasaBonifEps: number;
}

export interface GratificacionResult {
  sueldoComputable: number;
  montoGratificacion: number;
  bonificacionExtraordinaria: number;
}

const MESES_SEMESTRE = 6;

export function calcularGratificacion(input: GratificacionInput): GratificacionResult {
  const sueldoComputable =
    input.sueldo + input.asignacionFamiliar + input.conceptosRemunerativosRegulares;
  const montoGratificacion = sueldoComputable * (input.mesesCompletos / MESES_SEMESTRE);
  const tasaBonif = input.afiliadoEps ? input.tasaBonifEps : input.tasaBonifEssalud;

  return {
    sueldoComputable,
    montoGratificacion,
    bonificacionExtraordinaria: montoGratificacion * tasaBonif,
  };
}
