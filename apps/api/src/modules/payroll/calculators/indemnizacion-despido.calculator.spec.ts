import { calcularIndemnizacionDespido } from './indemnizacion-despido.calculator';

describe('calcularIndemnizacionDespido', () => {
  const paramsGeneral = {
    topeRemuneraciones: 12,
    mypeParams: {
      mype_pequena: { diasPorAnio: 20, topeDias: 120 },
      mype_micro: { diasPorAnio: 10, topeDias: 90 },
    },
  };

  it('indeterminado (general): 1.5 remuneraciones por año + fracción proporcional', () => {
    const r = calcularIndemnizacionDespido({
      ...paramsGeneral,
      regimen: 'general',
      tipoContrato: 'indeterminado',
      remuneracionMensual: 3000,
      aniosCompletos: 3,
      mesesAdicionales: 6,
      diasAdicionales: 0,
      mesesRestantesContrato: 0,
    });
    // 1.5 × 3000 × (3 + 6/12) = 15750
    expect(r.monto).toBe(15750);
  });

  it('indeterminado (general): aplica el tope de 12 remuneraciones', () => {
    const r = calcularIndemnizacionDespido({
      ...paramsGeneral,
      regimen: 'general',
      tipoContrato: 'indeterminado',
      remuneracionMensual: 3000,
      aniosCompletos: 10,
      mesesAdicionales: 0,
      diasAdicionales: 0,
      mesesRestantesContrato: 0,
    });
    // 1.5 × 3000 × 10 = 45000 > tope 12 × 3000 = 36000
    expect(r.monto).toBe(36000);
    expect(r.topeAplicado).toBe(true);
  });

  it('plazo fijo (general): 1.5 remuneraciones por mes restante, con tope', () => {
    const r = calcularIndemnizacionDespido({
      ...paramsGeneral,
      regimen: 'general',
      tipoContrato: 'plazo_fijo',
      remuneracionMensual: 2000,
      aniosCompletos: 1,
      mesesAdicionales: 0,
      diasAdicionales: 0,
      mesesRestantesContrato: 4,
    });
    // 1.5 × 2000 × 4 = 12000 (< tope 24000)
    expect(r.monto).toBe(12000);
  });

  it('MYPE pequeña: 20 remuneraciones diarias por año, tope 120 días', () => {
    const r = calcularIndemnizacionDespido({
      ...paramsGeneral,
      regimen: 'mype_pequena',
      tipoContrato: 'indeterminado',
      remuneracionMensual: 1500, // remuneración diaria = 50
      aniosCompletos: 8,
      mesesAdicionales: 0,
      diasAdicionales: 0,
      mesesRestantesContrato: 0,
    });
    // 20 días × 8 años = 160 días > tope 120 → 120 × 50 = 6000
    expect(r.monto).toBe(6000);
    expect(r.topeAplicado).toBe(true);
  });

  it('MYPE micro: 10 remuneraciones diarias por año, tope 90 días', () => {
    const r = calcularIndemnizacionDespido({
      ...paramsGeneral,
      regimen: 'mype_micro',
      tipoContrato: 'indeterminado',
      remuneracionMensual: 1200, // diaria = 40
      aniosCompletos: 2,
      mesesAdicionales: 6,
      diasAdicionales: 0,
      mesesRestantesContrato: 0,
    });
    // 10 × 2.5 = 25 días × 40 = 1000
    expect(r.monto).toBe(1000);
    expect(r.topeAplicado).toBe(false);
  });
});
