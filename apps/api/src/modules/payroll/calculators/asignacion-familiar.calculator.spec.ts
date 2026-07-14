import { calcularAsignacionFamiliar } from './asignacion-familiar.calculator';

describe('calcularAsignacionFamiliar', () => {
  it('otorga 10% de la RMV vigente si el trabajador tiene hijos/dependientes declarados', () => {
    const resultado = calcularAsignacionFamiliar({
      tieneHijosODependientes: true,
      rmvVigente: 1130,
      tasaAsignacionFamiliar: 0.1,
    });

    expect(resultado.monto).toBeCloseTo(113, 2);
  });

  it('no otorga nada si el trabajador no tiene hijos/dependientes declarados', () => {
    const resultado = calcularAsignacionFamiliar({
      tieneHijosODependientes: false,
      rmvVigente: 1130,
      tasaAsignacionFamiliar: 0.1,
    });

    expect(resultado.monto).toBe(0);
  });
});
