import { calcularRetencionPensionaria } from './afp-onp.calculator';

describe('calcularRetencionPensionaria', () => {
  it('calcula ONP: 13% sobre la remuneracion, sin tope', () => {
    const resultado = calcularRetencionPensionaria({
      sistema: 'onp',
      remuneracion: 3000,
      tasaOnp: 0.13,
      aportacionObligatoriaAfp: 0,
      comisionAfp: 0,
      tipoComision: 'flujo',
      primaSeguroAfp: 0,
      topeRemuneracionMaximaAsegurable: 0,
    });

    expect(resultado.montoRetenido).toBeCloseTo(3000 * 0.13, 2);
  });

  it('calcula AFP con comision de flujo: aporte obligatorio + comision + prima de seguro', () => {
    const resultado = calcularRetencionPensionaria({
      sistema: 'afp',
      remuneracion: 3000,
      tasaOnp: 0.13,
      aportacionObligatoriaAfp: 0.1,
      comisionAfp: 0.016,
      tipoComision: 'flujo',
      primaSeguroAfp: 0.0174,
      topeRemuneracionMaximaAsegurable: 10000,
    });

    const aporte = 3000 * 0.1;
    const comision = 3000 * 0.016;
    const prima = Math.min(3000, 10000) * 0.0174;
    expect(resultado.montoRetenido).toBeCloseTo(aporte + comision + prima, 2);
  });

  it('la prima de seguro AFP respeta el tope de remuneracion maxima asegurable', () => {
    const resultado = calcularRetencionPensionaria({
      sistema: 'afp',
      remuneracion: 15000, // por encima del tope
      tasaOnp: 0.13,
      aportacionObligatoriaAfp: 0.1,
      comisionAfp: 0.016,
      tipoComision: 'flujo',
      primaSeguroAfp: 0.0174,
      topeRemuneracionMaximaAsegurable: 10000,
    });

    const aporte = 15000 * 0.1;
    const comision = 15000 * 0.016;
    const primaTopeada = 10000 * 0.0174; // no 15000 * 0.0174
    expect(resultado.montoRetenido).toBeCloseTo(aporte + comision + primaTopeada, 2);
  });
});
