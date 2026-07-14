import {
  construirResumenDia,
  calcularHorasComputables,
  MarcacionDia,
  ConfiguracionResumenDia,
  ResumenDia,
} from './asistencia-resumen.calculator';

// Configuración normativa base para los tests (parámetros, no constantes mágicas
// dentro del calculador): jornada 08:00-17:00, tolerancia de entrada 15 min,
// jornada oficial de 8 horas para valorizar faltas justificadas en HC.
const configBase: ConfiguracionResumenDia = {
  horaInicioDia: '08:00',
  minutosToleranciaEntrada: 15,
  horasJornada: 8,
};

function marcacion(tipo: MarcacionDia['tipo'], iso: string): MarcacionDia {
  return { tipo, timestampActual: new Date(iso) };
}

describe('construirResumenDia', () => {
  it('día normal: primera ENTRADA y última SALIDA, horas trabajadas, sin falta ni tardanza', () => {
    const marcaciones: MarcacionDia[] = [
      marcacion('ENTRADA', '2026-07-13T08:05:00'),
      marcacion('SALIDA', '2026-07-13T17:05:00'),
    ];

    const resumen = construirResumenDia(marcaciones, configBase);

    expect(resumen.horaEntrada).toEqual(new Date('2026-07-13T08:05:00'));
    expect(resumen.horaSalida).toEqual(new Date('2026-07-13T17:05:00'));
    expect(resumen.horasTrabajadas).toBeCloseTo(9, 2);
    expect(resumen.falta).toBe(false);
    expect(resumen.tardanzaMinutos).toBe(0);
    expect(resumen.justificado).toBe(false);
    expect(resumen.inconsistente).toBe(false);
  });

  it('con múltiples marcaciones toma la primera ENTRADA y la última SALIDA', () => {
    // Marcaciones desordenadas y duplicadas (append-only: pueden existir varias)
    const marcaciones: MarcacionDia[] = [
      marcacion('SALIDA', '2026-07-13T13:00:00'),
      marcacion('ENTRADA', '2026-07-13T14:00:00'),
      marcacion('ENTRADA', '2026-07-13T08:00:00'),
      marcacion('SALIDA', '2026-07-13T18:00:00'),
    ];

    const resumen = construirResumenDia(marcaciones, configBase);

    expect(resumen.horaEntrada).toEqual(new Date('2026-07-13T08:00:00'));
    expect(resumen.horaSalida).toEqual(new Date('2026-07-13T18:00:00'));
    expect(resumen.horasTrabajadas).toBeCloseTo(10, 2);
  });

  it('falta sin justificar: sin marcaciones y sin justificación aprobada', () => {
    const resumen = construirResumenDia([], configBase);

    expect(resumen.falta).toBe(true);
    expect(resumen.justificado).toBe(false);
    expect(resumen.horaEntrada).toBeNull();
    expect(resumen.horaSalida).toBeNull();
    expect(resumen.horasTrabajadas).toBe(0);
    expect(resumen.tardanzaMinutos).toBe(0);
  });

  it('falta justificada: sin marcaciones pero con justificación aprobada NO computa como falta', () => {
    const resumen = construirResumenDia([], configBase, {
      id: 'a3f1c9c2-0000-4000-8000-000000000001',
    });

    expect(resumen.falta).toBe(false);
    expect(resumen.justificado).toBe(true);
    expect(resumen.justificacionId).toBe('a3f1c9c2-0000-4000-8000-000000000001');
    expect(resumen.horasTrabajadas).toBe(0);
  });

  it('tardanza: entrada después de la tolerancia registra minutos de retraso sobre la hora oficial', () => {
    const marcaciones: MarcacionDia[] = [
      marcacion('ENTRADA', '2026-07-13T08:20:00'),
      marcacion('SALIDA', '2026-07-13T17:00:00'),
    ];

    const resumen = construirResumenDia(marcaciones, configBase);

    // Tolerancia 15 min superada: la tardanza se cuenta desde la hora oficial (08:00) → 20 min
    expect(resumen.tardanzaMinutos).toBe(20);
    expect(resumen.falta).toBe(false);
  });

  it('entrada dentro de la tolerancia no genera tardanza', () => {
    const marcaciones: MarcacionDia[] = [
      marcacion('ENTRADA', '2026-07-13T08:14:00'),
      marcacion('SALIDA', '2026-07-13T17:00:00'),
    ];

    const resumen = construirResumenDia(marcaciones, configBase);

    expect(resumen.tardanzaMinutos).toBe(0);
  });

  it('día inconsistente: entrada sin salida → horasTrabajadas 0 y flag inconsistente', () => {
    const marcaciones: MarcacionDia[] = [
      marcacion('ENTRADA', '2026-07-13T08:00:00'),
    ];

    const resumen = construirResumenDia(marcaciones, configBase);

    expect(resumen.inconsistente).toBe(true);
    expect(resumen.horasTrabajadas).toBe(0);
    expect(resumen.horaEntrada).toEqual(new Date('2026-07-13T08:00:00'));
    expect(resumen.horaSalida).toBeNull();
    // Sí hubo marcación: no es falta
    expect(resumen.falta).toBe(false);
  });

  it('las marcaciones de tipo JUSTIFICACION no cuentan como entrada/salida', () => {
    const marcaciones: MarcacionDia[] = [
      marcacion('JUSTIFICACION', '2026-07-13T09:00:00'),
    ];

    const resumen = construirResumenDia(marcaciones, configBase);

    expect(resumen.horaEntrada).toBeNull();
    expect(resumen.horaSalida).toBeNull();
    // Hubo actividad registrada pero sin ENTRADA/SALIDA y sin justificación aprobada → falta
    expect(resumen.falta).toBe(true);
  });
});

describe('calcularHorasComputables', () => {
  const diaTrabajado = (horas: number): ResumenDia => ({
    horaEntrada: new Date('2026-07-13T08:00:00'),
    horaSalida: new Date(new Date('2026-07-13T08:00:00').getTime() + horas * 3600000),
    horasTrabajadas: horas,
    falta: false,
    tardanzaMinutos: 0,
    justificado: false,
    justificacionId: null,
    inconsistente: false,
  });

  const diaFalta = (justificado: boolean): ResumenDia => ({
    horaEntrada: null,
    horaSalida: null,
    horasTrabajadas: 0,
    falta: !justificado,
    tardanzaMinutos: 0,
    justificado,
    justificacionId: justificado ? 'a3f1c9c2-0000-4000-8000-000000000002' : null,
    inconsistente: false,
  });

  it('HC de un período: suma horas trabajadas, la falta justificada computa jornada y la injustificada no suma', () => {
    const resumenes: ResumenDia[] = [
      diaTrabajado(8),
      diaTrabajado(9),
      diaFalta(true), // justificada → computa 8h de jornada
      diaFalta(false), // injustificada → 0h
    ];

    const resultado = calcularHorasComputables(resumenes, configBase.horasJornada);

    expect(resultado.horasTrabajadas).toBeCloseTo(17, 2);
    expect(resultado.horasComputables).toBeCloseTo(25, 2); // 8 + 9 + 8 (justificada) + 0
    expect(resultado.faltasInjustificadas).toBe(1);
    expect(resultado.faltasJustificadas).toBe(1);
  });

  it('HC de un período sin faltas es igual al total de horas trabajadas', () => {
    const resumenes: ResumenDia[] = [diaTrabajado(8), diaTrabajado(8.5)];

    const resultado = calcularHorasComputables(resumenes, configBase.horasJornada);

    expect(resultado.horasComputables).toBeCloseTo(16.5, 2);
    expect(resultado.faltasInjustificadas).toBe(0);
  });

  it('HC de un período vacío es 0', () => {
    const resultado = calcularHorasComputables([], configBase.horasJornada);

    expect(resultado.horasComputables).toBe(0);
    expect(resultado.horasTrabajadas).toBe(0);
    expect(resultado.faltasInjustificadas).toBe(0);
    expect(resultado.faltasJustificadas).toBe(0);
  });
});
