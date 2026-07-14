import { calcularLiquidacion } from './liquidacion.calculator';

describe('calcularLiquidacion', () => {
  it('suma CTS trunca + gratificacion trunca + vacaciones truncas + conceptos pendientes', () => {
    const resultado = calcularLiquidacion({
      sueldo: 2500,
      gratificacionSemestral: 2500,
      mesesCompletosDesdeUltimoDepositoCts: 2,
      diasAdicionalesCts: 10,
      mesesCompletosGratificacionTrunca: 2,
      diasVacacionesPendientes: 15,
      valorDiaVacacional: 2500 / 30,
      conceptosPendientesDePago: 500,
    });

    expect(resultado.ctsTrunca).toBeGreaterThan(0);
    expect(resultado.gratificacionTrunca).toBeCloseTo(2500 * (2 / 6), 2);
    expect(resultado.vacacionesTruncas).toBeCloseTo((2500 / 30) * 15, 2);
    expect(resultado.conceptosPendientes).toBe(500);
    expect(resultado.total).toBeCloseTo(
      resultado.ctsTrunca +
        resultado.gratificacionTrunca +
        resultado.vacacionesTruncas +
        resultado.conceptosPendientes,
      2,
    );
  });

  it('funciona con remuneracion variable (0 en meses sin ventas, caso borde obligatorio)', () => {
    const resultado = calcularLiquidacion({
      sueldo: 0,
      gratificacionSemestral: 0,
      mesesCompletosDesdeUltimoDepositoCts: 1,
      diasAdicionalesCts: 0,
      mesesCompletosGratificacionTrunca: 1,
      diasVacacionesPendientes: 5,
      valorDiaVacacional: 0,
      conceptosPendientesDePago: 1200, // comisiones pendientes de liquidar
    });

    expect(resultado.ctsTrunca).toBe(0);
    expect(resultado.gratificacionTrunca).toBe(0);
    expect(resultado.vacacionesTruncas).toBe(0);
    expect(resultado.total).toBe(1200);
  });
});
