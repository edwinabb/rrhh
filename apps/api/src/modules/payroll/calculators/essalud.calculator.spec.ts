import { calcularAporteEssalud } from './essalud.calculator';

describe('calcularAporteEssalud', () => {
  it('calcula 9% a cargo del empleador (no es descuento al trabajador)', () => {
    const resultado = calcularAporteEssalud({
      remuneracion: 2500,
      tieneConvenioEps: false,
      tasaEssalud: 0.09,
      tasaEssaludConEps: 0.09, // igual a essalud si no hay reduccion pactada
    });

    expect(resultado.montoAporteEmpleador).toBeCloseTo(2500 * 0.09, 2);
  });

  it('usa la tasa reducida cuando el tenant tiene convenio EPS', () => {
    const resultado = calcularAporteEssalud({
      remuneracion: 2500,
      tieneConvenioEps: true,
      tasaEssalud: 0.09,
      tasaEssaludConEps: 0.025, // ejemplo de tasa reducida pactada con la EPS
    });

    expect(resultado.montoAporteEmpleador).toBeCloseTo(2500 * 0.025, 2);
  });
});
