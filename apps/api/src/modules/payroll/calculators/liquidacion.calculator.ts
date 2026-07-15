import { calcularCtsTrunca } from './cts.calculator';
import { calcularGratificacion } from './gratificacion.calculator';
import {
  calcularVacacionesCese,
  PeriodoVacacionalInput,
} from './vacaciones.calculator';
import {
  calcularIndemnizacionDespido,
  IndemnizacionMypeParams,
  RegimenLaboral,
  TipoContratoIndemnizacion,
} from './indemnizacion-despido.calculator';
import { calcularRetencionPensionaria } from './afp-onp.calculator';
import { calcularRetencionQuinta, TramoQuinta } from './quinta-categoria.calculator';

/**
 * Motor de liquidación de beneficios sociales al cese (D.S. 001-97-TR: pago
 * dentro de 48h). Compone los calculadores puros según motivo y régimen y
 * aplica la matriz de afectación (spec §4.4):
 *   CTS e indemnizaciones → inafectas a todo.
 *   Gratificación trunca + bonificación → inafecta a pensión (Ley 30334), afecta a 5ta.
 *   Vacaciones y remuneraciones pendientes → afectas a pensión y 5ta.
 *   Gratificación extraordinaria por cese (mutuo disenso) → no remunerativa, inafecta.
 */
export const CONCEPTO_RETENCION_QUINTA = 'Retención 5ta categoría';

export type MotivoCese =
  | 'RENUNCIA'
  | 'TERMINO_CONTRATO'
  | 'MUTUO_DISENSO'
  | 'DESPIDO_ARBITRARIO'
  | 'FALLECIMIENTO';

export interface LineaLiquidacion {
  concepto: string;
  baseLegal: string;
  monto: number;
}

export interface RemuneracionPendiente {
  concepto: string;
  monto: number;
}

export interface IndemnizacionDespidoParams {
  tipoContrato: TipoContratoIndemnizacion;
  aniosCompletos: number;
  mesesAdicionales: number;
  diasAdicionales: number;
  mesesRestantesContrato: number;
  topeRemuneraciones: number;
  mypeParams: { mype_pequena: IndemnizacionMypeParams; mype_micro: IndemnizacionMypeParams };
}

export interface LiquidacionCeseInput {
  motivo: MotivoCese;
  regimen: RegimenLaboral;
  fechaCese: Date;
  remuneracionComputable: number;
  /** 1 (general/agrario), 0.5 (mype_pequena), 0 (mype_micro) — parámetro normativo. */
  factorRegimenCtsGrati: number;
  cts: {
    gratificacionSemestralPercibida: number;
    mesesCompletosDesdeUltimoDeposito: number;
    diasAdicionales: number;
  };
  gratificacionTrunca: {
    mesesCompletos: number;
    afiliadoEps: boolean;
    tasaBonifEssalud: number;
    tasaBonifEps: number;
  };
  vacaciones: { periodos: PeriodoVacacionalInput[]; excluidoIndemnizacion: boolean };
  remuneracionesPendientes: RemuneracionPendiente[];
  gratificacionExtraordinaria: number;
  indemnizacionDespido: IndemnizacionDespidoParams | null;
  deducciones: {
    pension: {
      sistema: 'afp' | 'onp';
      tasaOnp: number;
      aportacionObligatoriaAfp: number;
      comisionAfp: number;
      tipoComision: 'flujo' | 'mixta';
      primaSeguroAfp: number;
      topeRemuneracionMaximaAsegurable: number;
    };
    quinta: {
      uit: number;
      deduccionUit: number;
      tramos: TramoQuinta[];
      /** Remuneración afecta a 5ta ya percibida en el ejercicio. */
      rentaPagadaEnElAnio: number;
      /** Retenciones de 5ta ya efectuadas en el ejercicio. */
      retencionesYaEfectuadas: number;
    };
  };
}

export interface LiquidacionCeseResult {
  ingresos: LineaLiquidacion[];
  deducciones: LineaLiquidacion[];
  totalBruto: number;
  totalDeducciones: number;
  netoPagar: number;
}

function redondear(monto: number): number {
  return Math.round(monto * 100) / 100;
}

export function calcularLiquidacion(input: LiquidacionCeseInput): LiquidacionCeseResult {
  const ingresos: LineaLiquidacion[] = [];
  let afectoPension = 0;
  let afectoQuinta = 0;

  // 1. CTS trunca (inafecta) — factor de régimen MYPE.
  if (input.factorRegimenCtsGrati > 0) {
    const cts = calcularCtsTrunca({
      sueldo: input.remuneracionComputable,
      gratificacionSemestral: input.cts.gratificacionSemestralPercibida,
      mesesCompletosDesdeUltimoDeposito: input.cts.mesesCompletosDesdeUltimoDeposito,
      diasAdicionales: input.cts.diasAdicionales,
    });
    const monto = redondear(cts.montoDeposito * input.factorRegimenCtsGrati);
    if (monto > 0) {
      ingresos.push({ concepto: 'CTS trunca', baseLegal: 'D.S. 001-97-TR', monto });
    }
  }

  // 2. Gratificación trunca + bonificación extraordinaria (inafectas a pensión
  //    por Ley 30334; afectas a 5ta) — factor de régimen MYPE.
  if (input.factorRegimenCtsGrati > 0 && input.gratificacionTrunca.mesesCompletos > 0) {
    const grati = calcularGratificacion({
      sueldo: input.remuneracionComputable,
      asignacionFamiliar: 0, // ya incluida en remuneracionComputable
      conceptosRemunerativosRegulares: 0,
      mesesCompletos: input.gratificacionTrunca.mesesCompletos,
      afiliadoEps: input.gratificacionTrunca.afiliadoEps,
      tasaBonifEssalud: input.gratificacionTrunca.tasaBonifEssalud,
      tasaBonifEps: input.gratificacionTrunca.tasaBonifEps,
    });
    const montoGrati = redondear(grati.montoGratificacion * input.factorRegimenCtsGrati);
    const montoBonif = redondear(grati.bonificacionExtraordinaria * input.factorRegimenCtsGrati);
    if (montoGrati > 0) {
      ingresos.push({ concepto: 'Gratificación trunca', baseLegal: 'Ley 27735 / Ley 30334', monto: montoGrati });
      afectoQuinta += montoGrati;
    }
    if (montoBonif > 0) {
      ingresos.push({
        concepto: 'Bonificación extraordinaria (Ley 30334)',
        baseLegal: 'Ley 30334',
        monto: montoBonif,
      });
      afectoQuinta += montoBonif;
    }
  }

  // 3. Vacaciones (afectas a pensión y 5ta) + indemnización vacacional (inafecta).
  const vac = calcularVacacionesCese({
    remuneracionComputable: input.remuneracionComputable,
    fechaCese: input.fechaCese,
    periodos: input.vacaciones.periodos,
    excluidoIndemnizacion: input.vacaciones.excluidoIndemnizacion,
  });
  if (vac.vacacionesDevengadas > 0) {
    ingresos.push({ concepto: 'Vacaciones devengadas', baseLegal: 'D.Leg. 713', monto: vac.vacacionesDevengadas });
    afectoPension += vac.vacacionesDevengadas;
    afectoQuinta += vac.vacacionesDevengadas;
  }
  if (vac.vacacionesTruncas > 0) {
    ingresos.push({ concepto: 'Vacaciones truncas', baseLegal: 'D.Leg. 713 art. 22', monto: vac.vacacionesTruncas });
    afectoPension += vac.vacacionesTruncas;
    afectoQuinta += vac.vacacionesTruncas;
  }
  if (vac.indemnizacionVacacional > 0) {
    ingresos.push({
      concepto: 'Indemnización vacacional',
      baseLegal: 'D.Leg. 713 art. 23',
      monto: vac.indemnizacionVacacional,
    });
  }

  // 4. Remuneraciones pendientes (afectas a todo).
  for (const pendiente of input.remuneracionesPendientes) {
    const monto = redondear(pendiente.monto);
    if (monto <= 0) continue;
    ingresos.push({ concepto: pendiente.concepto, baseLegal: 'Remuneración devengada', monto });
    afectoPension += monto;
    afectoQuinta += monto;
  }

  // 5. Gratificación extraordinaria por cese (mutuo disenso — inafecta).
  if (input.motivo === 'MUTUO_DISENSO' && input.gratificacionExtraordinaria > 0) {
    ingresos.push({
      concepto: 'Gratificación extraordinaria por cese',
      baseLegal: 'Acuerdo de mutuo disenso (concepto no remunerativo)',
      monto: redondear(input.gratificacionExtraordinaria),
    });
  }

  // 6. Indemnización por despido arbitrario (inafecta).
  if (input.motivo === 'DESPIDO_ARBITRARIO' && input.indemnizacionDespido) {
    const ind = calcularIndemnizacionDespido({
      regimen: input.regimen,
      remuneracionMensual: input.remuneracionComputable,
      ...input.indemnizacionDespido,
    });
    if (ind.monto > 0) {
      ingresos.push({
        concepto: 'Indemnización por despido arbitrario',
        baseLegal: 'D.S. 003-97-TR arts. 34/38/76',
        monto: ind.monto,
      });
    }
  }

  // Deducciones.
  const deducciones: LineaLiquidacion[] = [];

  if (afectoPension > 0) {
    const pension = calcularRetencionPensionaria({
      ...input.deducciones.pension,
      remuneracion: afectoPension,
    });
    const monto = redondear(pension.montoRetenido);
    if (monto > 0) {
      deducciones.push({
        concepto: `Retención ${input.deducciones.pension.sistema === 'afp' ? 'AFP' : 'ONP'}`,
        baseLegal: input.deducciones.pension.sistema === 'afp' ? 'D.S. 054-97-EF' : 'D.L. 19990',
        monto: -monto,
      });
    }
  }

  if (afectoQuinta > 0) {
    const quinta = calcularRetencionQuinta({
      remuneracionProyectadaRestante: afectoQuinta,
      conceptosYaPagadosEnElAnio: input.deducciones.quinta.rentaPagadaEnElAnio,
      ingresosOtrasEntidadesDeclarados: 0,
      deduccionUit: input.deducciones.quinta.deduccionUit,
      uit: input.deducciones.quinta.uit,
      tramos: input.deducciones.quinta.tramos,
      mesesRestantes: 1, // al cese la retención es única, no mensualizada
    });
    const retencion = redondear(
      Math.max(0, quinta.impuestoAnualProyectado - input.deducciones.quinta.retencionesYaEfectuadas),
    );
    if (retencion > 0) {
      deducciones.push({
        concepto: CONCEPTO_RETENCION_QUINTA,
        baseLegal: 'TUO Ley Impuesto a la Renta, D.S. 179-2004-EF',
        monto: -retencion,
      });
    }
  }

  const totalBruto = redondear(ingresos.reduce((s, l) => s + l.monto, 0));
  const totalDeducciones = redondear(deducciones.reduce((s, l) => s - l.monto, 0));

  return {
    ingresos,
    deducciones,
    totalBruto,
    totalDeducciones,
    netoPagar: redondear(totalBruto - totalDeducciones),
  };
}
