/**
 * Asignación familiar: 10% de la RMV vigente si el trabajador tiene hijos o
 * dependientes declarados (Ley 25129).
 * Ver especificaciones-fases.md, Fase 1, regla de cálculo #9.
 */
export interface AsignacionFamiliarInput {
  tieneHijosODependientes: boolean;
  rmvVigente: number;
  tasaAsignacionFamiliar: number;
}

export interface AsignacionFamiliarResult {
  monto: number;
}

export function calcularAsignacionFamiliar(
  input: AsignacionFamiliarInput,
): AsignacionFamiliarResult {
  if (!input.tieneHijosODependientes) return { monto: 0 };
  return { monto: input.rmvVigente * input.tasaAsignacionFamiliar };
}
