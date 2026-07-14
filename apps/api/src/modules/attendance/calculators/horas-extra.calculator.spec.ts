import {
  calcularHorasExtraDiarias,
  calcularHorasExtraSemanales,
  calcularRecargo,
  JORNADA_MAXIMA_DIARIA_LEGAL,
  JORNADA_MAXIMA_SEMANAL_LEGAL,
  TASAS_RECARGO_DLEG_854,
} from './horas-extra.calculator';

describe('calcularHorasExtraDiarias', () => {
  it('retorna 0 cuando las horas trabajadas no exceden la jornada máxima diaria', () => {
    expect(calcularHorasExtraDiarias(8)).toBe(0);
    expect(calcularHorasExtraDiarias(6.5)).toBe(0);
    expect(calcularHorasExtraDiarias(0)).toBe(0);
  });

  it('retorna el excedente sobre la jornada legal de 8 horas (extra diaria simple)', () => {
    // 10h trabajadas - 8h de jornada legal = 2h extra
    expect(calcularHorasExtraDiarias(10)).toBe(2);
    // fracciones de hora también cuentan
    expect(calcularHorasExtraDiarias(8.5)).toBeCloseTo(0.5, 5);
  });

  it('acepta una jornada máxima diaria distinta como parámetro (ej. jornada reducida de 6h)', () => {
    expect(calcularHorasExtraDiarias(10, 6)).toBe(4);
    expect(calcularHorasExtraDiarias(6, 6)).toBe(0);
  });
});

describe('calcularHorasExtraSemanales', () => {
  it('retorna 0 cuando la semana no excede el tope semanal', () => {
    // 6 días de 8h = 48h exactas, sin excedente
    expect(calcularHorasExtraSemanales([8, 8, 8, 8, 8, 8])).toBe(0);
    expect(calcularHorasExtraSemanales([8, 8, 8, 8, 4])).toBe(0);
  });

  it('detecta excedente semanal cuando ningún día supera la jornada diaria', () => {
    // 7 días: 8+8+8+8+8+8+4 = 52h, ninguna hora es extra diaria
    // 52h - 48h = 4h extra semanales
    expect(calcularHorasExtraSemanales([8, 8, 8, 8, 8, 8, 4])).toBe(4);
  });

  it('NO cuenta dos veces las horas ya computadas como extra diaria (sin doble conteo)', () => {
    // 6 días de 10h = 60h totales, pero 2h/día ya son extra diaria (12h).
    // Horas computables para el tope semanal: 6 x 8 = 48h -> 0h extra semanal.
    expect(calcularHorasExtraSemanales([10, 10, 10, 10, 10, 10])).toBe(0);
  });

  it('combina extra diaria y semanal descontando la diaria del cómputo semanal', () => {
    // Días: 10, 9, 8, 8, 8, 8, 4 -> extras diarias: 2 + 1 = 3h
    // Computables (topeadas a 8h/día): 8+8+8+8+8+8+4 = 52h -> 52 - 48 = 4h semanales
    expect(calcularHorasExtraSemanales([10, 9, 8, 8, 8, 8, 4])).toBe(4);
  });

  it('acepta topes semanal y diario personalizados como parámetros', () => {
    // Tope semanal 40h, tope diario 8h: 5 días de 9h -> computables 40h -> 0 semanal
    expect(calcularHorasExtraSemanales([9, 9, 9, 9, 9], 40, 8)).toBe(0);
    // Tope semanal 40h: 8+8+8+8+8+4 = 44 computables -> 4h semanales
    expect(calcularHorasExtraSemanales([8, 8, 8, 8, 8, 4], 40, 8)).toBe(4);
  });
});

describe('calcularRecargo (D.Leg. 854: primeras 2h al 25%, siguientes al 35%)', () => {
  it('retorna 0 de recargo y 0 de pago cuando no hay horas extra', () => {
    const resultado = calcularRecargo(0, 10);
    expect(resultado.recargo).toBe(0);
    expect(resultado.pagoTotal).toBe(0);
    expect(resultado.horasPrimerTramo).toBe(0);
    expect(resultado.horasSegundoTramo).toBe(0);
  });

  it('aplica solo el 25% cuando las horas extra no superan el primer tramo (2h)', () => {
    // 2h extra x S/10 x 25% = S/5 de recargo; pago total = 2x10 + 5 = S/25
    const resultado = calcularRecargo(2, 10);
    expect(resultado.horasPrimerTramo).toBe(2);
    expect(resultado.horasSegundoTramo).toBe(0);
    expect(resultado.recargo).toBeCloseTo(5, 2);
    expect(resultado.pagoTotal).toBeCloseTo(25, 2);
  });

  it('aplica 25% a las primeras 2h y 35% a las siguientes (recargo mixto)', () => {
    // 4h extra x S/10: tramo1 = 2h x 10 x 0.25 = 5; tramo2 = 2h x 10 x 0.35 = 7
    // recargo = 12; pago total = 4x10 + 12 = 52
    const resultado = calcularRecargo(4, 10);
    expect(resultado.horasPrimerTramo).toBe(2);
    expect(resultado.horasSegundoTramo).toBe(2);
    expect(resultado.recargo).toBeCloseTo(12, 2);
    expect(resultado.pagoTotal).toBeCloseTo(52, 2);
  });

  it('maneja fracciones de hora dentro del primer tramo', () => {
    // 1.5h extra x S/12 x 25% = 4.50 de recargo; pago total = 18 + 4.50 = 22.50
    const resultado = calcularRecargo(1.5, 12);
    expect(resultado.horasPrimerTramo).toBeCloseTo(1.5, 5);
    expect(resultado.horasSegundoTramo).toBe(0);
    expect(resultado.recargo).toBeCloseTo(4.5, 2);
    expect(resultado.pagoTotal).toBeCloseTo(22.5, 2);
  });

  it('acepta tasas y tramo como parámetros (convenio más favorable que el mínimo legal)', () => {
    // Convenio: 50% primeras 3h, 100% las siguientes
    const resultado = calcularRecargo(5, 10, {
      horasPrimerTramo: 3,
      tasaPrimerTramo: 0.5,
      tasaSegundoTramo: 1.0,
    });
    // tramo1 = 3 x 10 x 0.5 = 15; tramo2 = 2 x 10 x 1.0 = 20; recargo = 35
    // pago total = 5 x 10 + 35 = 85
    expect(resultado.horasPrimerTramo).toBe(3);
    expect(resultado.horasSegundoTramo).toBe(2);
    expect(resultado.recargo).toBeCloseTo(35, 2);
    expect(resultado.pagoTotal).toBeCloseTo(85, 2);
  });
});

describe('constantes normativas por defecto', () => {
  it('expone los valores legales peruanos como defaults documentados', () => {
    expect(JORNADA_MAXIMA_DIARIA_LEGAL).toBe(8);
    expect(JORNADA_MAXIMA_SEMANAL_LEGAL).toBe(48);
    expect(TASAS_RECARGO_DLEG_854.horasPrimerTramo).toBe(2);
    expect(TASAS_RECARGO_DLEG_854.tasaPrimerTramo).toBe(0.25);
    expect(TASAS_RECARGO_DLEG_854.tasaSegundoTramo).toBe(0.35);
  });
});
