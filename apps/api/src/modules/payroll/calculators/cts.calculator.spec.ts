import { calcularCts, calcularCtsTrunca } from './cts.calculator';

describe('calcularCts', () => {
  it('deposita el semestre completo (6 meses) sin proporcionalidad', () => {
    const resultado = calcularCts({
      sueldo: 2000,
      gratificacionSemestral: 2000,
      mesesCompletos: 6,
      diasAdicionales: 0,
    });

    // remuneracion computable = 2000 + (2000/6) = 2333.33
    // deposito = 2333.33 (semestre completo = 1x remuneracion computable)
    expect(resultado.remuneracionComputable).toBeCloseTo(2333.33, 2);
    expect(resultado.montoDeposito).toBeCloseTo(2333.33, 2);
  });

  it('prorratea cuando el trabajador ingresó a mitad del semestre (caso borde obligatorio: ingreso a mitad de mes)', () => {
    // Ingresó el 16 de agosto: trabajó 3 meses completos + 15 días del semestre may-oct.
    const resultado = calcularCts({
      sueldo: 1500,
      gratificacionSemestral: 1500,
      mesesCompletos: 3,
      diasAdicionales: 15,
    });

    const remuneracionComputable = 1500 + 1500 / 6; // 1750
    const fraccionSemestre = 3 / 6 + 15 / 180; // meses + dias sobre 6 meses de 30 dias
    expect(resultado.remuneracionComputable).toBeCloseTo(1750, 2);
    expect(resultado.montoDeposito).toBeCloseTo(remuneracionComputable * fraccionSemestre, 2);
  });
});

describe('calcularCtsTrunca', () => {
  it('calcula proporcional desde el último depósito hasta la fecha de cese (caso borde obligatorio: cese antes del depósito de CTS)', () => {
    // Cese a los 2 meses y 10 dias desde el último depósito (1 de mayo), antes
    // de que llegue el depósito de noviembre.
    const resultado = calcularCtsTrunca({
      sueldo: 1800,
      gratificacionSemestral: 1800,
      mesesCompletosDesdeUltimoDeposito: 2,
      diasAdicionales: 10,
    });

    const remuneracionComputable = 1800 + 1800 / 6; // 2100
    const fraccion = 2 / 6 + 10 / 180;
    expect(resultado.montoDeposito).toBeCloseTo(remuneracionComputable * fraccion, 2);
  });
});
