import { calcularRetencionQuinta } from './quinta-categoria.calculator';

describe('calcularRetencionQuinta', () => {
  const tramos = [
    { hasta: 5 * 5350, tasa: 0.08 }, // hasta 5 UIT: 8%
    { hasta: 20 * 5350, tasa: 0.14 }, // hasta 20 UIT: 14%
    { hasta: 35 * 5350, tasa: 0.17 }, // hasta 35 UIT: 17%
    { hasta: 45 * 5350, tasa: 0.2 }, // hasta 45 UIT: 20%
    { hasta: Infinity, tasa: 0.3 }, // exceso: 30%
  ];

  it('proyecta el impuesto anual, resta 7 UIT, y prorratea entre los meses restantes del ejercicio', () => {
    const resultado = calcularRetencionQuinta({
      remuneracionProyectadaRestante: 8 * 2500, // 8 meses restantes a 2500
      conceptosYaPagadosEnElAnio: 4 * 2500, // 4 meses ya pagados
      ingresosOtrasEntidadesDeclarados: 0,
      deduccionUit: 7,
      uit: 5350,
      tramos,
      mesesRestantes: 8,
    });

    const rentaBrutaAnual = 8 * 2500 + 4 * 2500; // 30000
    const rentaNetaAnual = rentaBrutaAnual - 7 * 5350; // 30000 - 37450 < 0
    expect(rentaNetaAnual).toBeLessThan(0);
    expect(resultado.impuestoAnualProyectado).toBe(0);
    expect(resultado.retencionMensual).toBe(0);
  });

  it('aplica los tramos progresivos cuando la renta neta anual supera la deduccion de 7 UIT', () => {
    const resultado = calcularRetencionQuinta({
      remuneracionProyectadaRestante: 8 * 8000,
      conceptosYaPagadosEnElAnio: 4 * 8000,
      ingresosOtrasEntidadesDeclarados: 0,
      deduccionUit: 7,
      uit: 5350,
      tramos,
      mesesRestantes: 8,
    });

    const rentaBrutaAnual = 12 * 8000; // 96000
    const rentaNetaAnual = rentaBrutaAnual - 7 * 5350; // 96000 - 37450 = 58550
    // tramo 1: 5*5350=26750 al 8% ; tramo 2: hasta 20*5350=107000, resto (58550-26750)=31800 al 14%
    const impuestoEsperado = 26750 * 0.08 + (58550 - 26750) * 0.14;
    expect(resultado.impuestoAnualProyectado).toBeCloseTo(impuestoEsperado, 2);
    expect(resultado.retencionMensual).toBeCloseTo(impuestoEsperado / 8, 2);
  });

  it('incluye ingresos de otras entidades declarados por el trabajador en la proyeccion', () => {
    const sinOtrasEntidades = calcularRetencionQuinta({
      remuneracionProyectadaRestante: 8 * 8000,
      conceptosYaPagadosEnElAnio: 4 * 8000,
      ingresosOtrasEntidadesDeclarados: 0,
      deduccionUit: 7,
      uit: 5350,
      tramos,
      mesesRestantes: 8,
    });
    const conOtrasEntidades = calcularRetencionQuinta({
      remuneracionProyectadaRestante: 8 * 8000,
      conceptosYaPagadosEnElAnio: 4 * 8000,
      ingresosOtrasEntidadesDeclarados: 10000,
      deduccionUit: 7,
      uit: 5350,
      tramos,
      mesesRestantes: 8,
    });

    expect(conOtrasEntidades.impuestoAnualProyectado).toBeGreaterThan(
      sinOtrasEntidades.impuestoAnualProyectado,
    );
  });
});
