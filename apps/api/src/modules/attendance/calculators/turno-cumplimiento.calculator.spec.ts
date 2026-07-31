import { construirVentanaTurno } from './ventana-turno.calculator';
import { evaluarCumplimientoTurno } from './turno-cumplimiento.calculator';

const NOCHE = { horaInicio: '20:00', horaFin: '08:00' };
const DIA = { horaInicio: '08:30', horaFin: '18:00' };

function marca(tipo: 'ENTRADA' | 'SALIDA', d: Date) {
  return { tipo, timestampActual: d } as const;
}

describe('evaluarCumplimientoTurno', () => {
  const ventanaNoche = construirVentanaTurno(new Date(2026, 6, 20), NOCHE, 120, 240);
  const baseNoche = { ventana: ventanaNoche, horasEsperadas: 12, toleranciaMinutos: 30 };

  it('turno NOCHE puntual y completo: 12.13 h en un solo día, sin retraso ni déficit', () => {
    const r = evaluarCumplimientoTurno({
      ...baseNoche,
      marcaciones: [
        marca('ENTRADA', new Date(2026, 6, 20, 19, 55)),
        marca('SALIDA', new Date(2026, 6, 21, 8, 3)),
      ],
    });
    expect(r.horasTrabajadas).toBeCloseTo(12.13, 2);
    expect(r.minutosRetraso).toBe(0);
    expect(r.tardanzaMinutos).toBe(0);
    expect(r.deficitMinutos).toBe(0);
    expect(r.falta).toBe(false);
  });

  it('gracia: 29 min de retraso no es tardanza formal pero sí exige compensación', () => {
    const ventana = construirVentanaTurno(new Date(2026, 6, 20), DIA, 120, 240);
    const r = evaluarCumplimientoTurno({
      ventana,
      horasEsperadas: 9.5,
      toleranciaMinutos: 30,
      marcaciones: [
        marca('ENTRADA', new Date(2026, 6, 20, 8, 59)), // 29 min tarde
        marca('SALIDA', new Date(2026, 6, 20, 18, 29)), // compensó
      ],
    });
    expect(r.minutosRetraso).toBe(29);
    expect(r.tardanzaMinutos).toBe(0); // dentro de la gracia
    expect(r.salidaEsperada).toEqual(new Date(2026, 6, 20, 18, 29));
    expect(r.deficitMinutos).toBe(0);
  });

  it('a los 30:00 exactos ya es tardanza formal (>=), contada desde la hora oficial', () => {
    const ventana = construirVentanaTurno(new Date(2026, 6, 20), DIA, 120, 240);
    const r = evaluarCumplimientoTurno({
      ventana,
      horasEsperadas: 9.5,
      toleranciaMinutos: 30,
      marcaciones: [
        marca('ENTRADA', new Date(2026, 6, 20, 9, 0)), // 30 min exactos
        marca('SALIDA', new Date(2026, 6, 20, 18, 30)),
      ],
    });
    expect(r.minutosRetraso).toBe(30);
    expect(r.tardanzaMinutos).toBe(30);
    expect(r.deficitMinutos).toBe(0); // compensó saliendo 18:30
  });

  it('no compensa: sale a la hora normal con 20 min de retraso → déficit 20', () => {
    const ventana = construirVentanaTurno(new Date(2026, 6, 20), DIA, 120, 240);
    const r = evaluarCumplimientoTurno({
      ventana,
      horasEsperadas: 9.5,
      toleranciaMinutos: 30,
      marcaciones: [
        marca('ENTRADA', new Date(2026, 6, 20, 8, 50)),
        marca('SALIDA', new Date(2026, 6, 20, 18, 0)),
      ],
    });
    expect(r.minutosRetraso).toBe(20);
    expect(r.salidaEsperada).toEqual(new Date(2026, 6, 20, 18, 20));
    expect(r.deficitMinutos).toBe(20);
  });

  it('horas extra: lo trabajado después de la salida esperada (la compensación no cuenta)', () => {
    const r = evaluarCumplimientoTurno({
      ...baseNoche,
      marcaciones: [
        marca('ENTRADA', new Date(2026, 6, 20, 20, 10)), // 10 min retraso
        marca('SALIDA', new Date(2026, 6, 21, 9, 10)), // esperada 08:10 → 1h extra
      ],
    });
    expect(r.minutosRetraso).toBe(10);
    expect(r.horasExtras).toBeCloseTo(1, 2);
    expect(r.deficitMinutos).toBe(0);
  });

  it('sin marcaciones: falta (salvo justificación aprobada)', () => {
    const sinJust = evaluarCumplimientoTurno({ ...baseNoche, marcaciones: [] });
    expect(sinJust.falta).toBe(true);
    const conJust = evaluarCumplimientoTurno({
      ...baseNoche,
      marcaciones: [],
      justificacionAprobada: { id: 'j-1' },
    });
    expect(conJust.falta).toBe(false);
    expect(conJust.justificado).toBe(true);
  });

  it('entrada sin salida: inconsistente, sin horas', () => {
    const r = evaluarCumplimientoTurno({
      ...baseNoche,
      marcaciones: [marca('ENTRADA', new Date(2026, 6, 20, 19, 58))],
    });
    expect(r.inconsistente).toBe(true);
    expect(r.horasTrabajadas).toBe(0);
  });
});
