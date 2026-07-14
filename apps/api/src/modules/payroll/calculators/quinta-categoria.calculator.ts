/**
 * Renta de Quinta Categoría: proyección anual = remuneración proyectada
 * restante del ejercicio + conceptos ya pagados en el año (incluye ingresos de
 * otras entidades declarados) − 7 UIT de deducción fija. Tramos progresivos
 * parametrizados. Retención mensual = impuesto anual proyectado / meses
 * restantes; se recalcula cada mes con la proyección actualizada.
 * Ver especificaciones-fases.md, Fase 1, regla de cálculo #5.
 */
export interface TramoQuinta {
  hasta: number; // limite superior del tramo, en soles (Infinity para el ultimo)
  tasa: number;
}

export interface QuintaInput {
  remuneracionProyectadaRestante: number;
  conceptosYaPagadosEnElAnio: number;
  ingresosOtrasEntidadesDeclarados: number;
  deduccionUit: number;
  uit: number;
  tramos: TramoQuinta[];
  mesesRestantes: number;
}

export interface QuintaResult {
  rentaNetaAnual: number;
  impuestoAnualProyectado: number;
  retencionMensual: number;
}

export function calcularRetencionQuinta(input: QuintaInput): QuintaResult {
  const rentaBrutaAnual =
    input.remuneracionProyectadaRestante +
    input.conceptosYaPagadosEnElAnio +
    input.ingresosOtrasEntidadesDeclarados;
  const rentaNetaAnual = rentaBrutaAnual - input.deduccionUit * input.uit;

  if (rentaNetaAnual <= 0) {
    return { rentaNetaAnual, impuestoAnualProyectado: 0, retencionMensual: 0 };
  }

  let restante = rentaNetaAnual;
  let limiteAnterior = 0;
  let impuesto = 0;

  for (const tramo of input.tramos) {
    if (restante <= 0) break;
    const anchoTramo = tramo.hasta - limiteAnterior;
    const baseEnTramo = Math.min(restante, anchoTramo);
    impuesto += baseEnTramo * tramo.tasa;
    restante -= baseEnTramo;
    limiteAnterior = tramo.hasta;
  }

  return {
    rentaNetaAnual,
    impuestoAnualProyectado: impuesto,
    retencionMensual: impuesto / input.mesesRestantes,
  };
}
