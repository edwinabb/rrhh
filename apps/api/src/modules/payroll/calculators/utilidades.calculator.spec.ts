import { calcularUtilidades } from './utilidades.calculator';

describe('calcularUtilidades', () => {
  it('reparte 50% por dias laborados y 50% por remuneracion percibida', () => {
    const resultado = calcularUtilidades({
      rentaNeta: 1_000_000,
      tasaPorSector: 0.08,
      diasLaboradosTrabajador: 300,
      diasLaboradosTotalEmpresa: 30_000,
      remuneracionPercibidaTrabajador: 24_000,
      remuneracionPercibidaTotalEmpresa: 2_400_000,
      remuneracionMensualPromedio: 2_000,
      topeRemuneracionesMensuales: 18,
    });

    const bolsaUtilidades = 1_000_000 * 0.08; // 80000
    const porDias = bolsaUtilidades * 0.5 * (300 / 30_000);
    const porRemuneracion = bolsaUtilidades * 0.5 * (24_000 / 2_400_000);
    expect(resultado.montoAntesDelTope).toBeCloseTo(porDias + porRemuneracion, 2);
  });

  it('aplica el tope de 18 remuneraciones mensuales por trabajador', () => {
    const resultado = calcularUtilidades({
      rentaNeta: 100_000_000, // renta neta enorme para forzar el tope
      tasaPorSector: 0.1,
      diasLaboradosTrabajador: 300,
      diasLaboradosTotalEmpresa: 3_000,
      remuneracionPercibidaTrabajador: 24_000,
      remuneracionPercibidaTotalEmpresa: 240_000,
      remuneracionMensualPromedio: 2_000,
      topeRemuneracionesMensuales: 18,
    });

    const tope = 2_000 * 18; // 36000
    expect(resultado.montoAntesDelTope).toBeGreaterThan(tope);
    expect(resultado.montoFinal).toBe(tope);
  });

  it('no aplica el tope cuando el monto calculado esta por debajo', () => {
    const resultado = calcularUtilidades({
      rentaNeta: 500_000,
      tasaPorSector: 0.05,
      diasLaboradosTrabajador: 300,
      diasLaboradosTotalEmpresa: 30_000,
      remuneracionPercibidaTrabajador: 24_000,
      remuneracionPercibidaTotalEmpresa: 2_400_000,
      remuneracionMensualPromedio: 2_000,
      topeRemuneracionesMensuales: 18,
    });

    expect(resultado.montoFinal).toBe(resultado.montoAntesDelTope);
  });
});
