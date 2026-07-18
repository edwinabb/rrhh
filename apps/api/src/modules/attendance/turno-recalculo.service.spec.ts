import { TurnoRecalculoService } from './turno-recalculo.service';

const TURNO_NOCHE = {
  id: 'turno-noche',
  codigo: 'NOCHE',
  horaInicio: '20:00',
  horaFin: '08:00',
  horasEsperadas: { toNumber: () => 12 },
  toleranciaMinutos: 30,
};

const CONFIG = {
  horaEntradaEstandar: '08:00',
  toleranciaTardanzaMinutos: 30,
  horasJornada: 8,
  ventanaAntesTurnoMinutos: 120,
  ventanaDespuesTurnoMinutos: 240,
};

function mockTx(overrides: any = {}) {
  return {
    turnoAsignacion: { findMany: jest.fn().mockResolvedValue([]), count: jest.fn().mockResolvedValue(0) },
    marcacion: { findMany: jest.fn().mockResolvedValue([]) },
    justificacion: { findFirst: jest.fn().mockResolvedValue(null) },
    asistenciaResumen: { upsert: jest.fn() },
    horasExtra: { upsert: jest.fn() },
    contrato: { findFirst: jest.fn().mockResolvedValue({ personalDeConfianza: false }) },
    ...overrides,
  };
}

describe('TurnoRecalculoService', () => {
  const service = new TurnoRecalculoService();

  it('empleado sin plan en el mes → false (flujo estándar)', async () => {
    const tx = mockTx();
    const manejado = await service.recalcularConTurno(
      tx, 't-1', 'emp-1', new Date(2026, 6, 21, 8, 3), CONFIG,
    );
    expect(manejado).toBe(false);
    expect(tx.asistenciaResumen.upsert).not.toHaveBeenCalled();
  });

  it('salida a las 08:03 del día siguiente: el resumen se upserta en la FECHA DEL TURNO', async () => {
    const tx = mockTx();
    tx.turnoAsignacion.count.mockResolvedValue(10); // tiene plan en el mes
    tx.turnoAsignacion.findMany.mockResolvedValue([
      { fecha: new Date(2026, 6, 20), tipoDia: 'TURNO', turno: TURNO_NOCHE },
    ]);
    tx.marcacion.findMany.mockResolvedValue([
      { tipo: 'ENTRADA', timestamp: new Date(2026, 6, 20, 19, 55) },
      { tipo: 'SALIDA', timestamp: new Date(2026, 6, 21, 8, 3) },
    ]);

    const manejado = await service.recalcularConTurno(
      tx, 't-1', 'emp-1', new Date(2026, 6, 21, 8, 3), CONFIG,
    );

    expect(manejado).toBe(true);
    const upsert = tx.asistenciaResumen.upsert.mock.calls[0][0];
    expect(upsert.where.tenantId_employeeId_fecha.fecha).toEqual(new Date(2026, 6, 20));
    expect(upsert.update.turnoId).toBe('turno-noche');
    expect(upsert.update.horasTrabajadas).toBeCloseTo(12.13, 2);
    expect(upsert.update.sinPlan).toBe(false);
  });

  it('horas extra del turno se upsertan en la fecha del turno', async () => {
    const tx = mockTx();
    tx.turnoAsignacion.count.mockResolvedValue(10);
    tx.turnoAsignacion.findMany.mockResolvedValue([
      { fecha: new Date(2026, 6, 20), tipoDia: 'TURNO', turno: TURNO_NOCHE },
    ]);
    tx.marcacion.findMany.mockResolvedValue([
      { tipo: 'ENTRADA', timestamp: new Date(2026, 6, 20, 20, 0) },
      { tipo: 'SALIDA', timestamp: new Date(2026, 6, 21, 9, 0) }, // 1h extra
    ]);

    await service.recalcularConTurno(tx, 't-1', 'emp-1', new Date(2026, 6, 21, 9, 0), CONFIG);

    const upsertHe = tx.horasExtra.upsert.mock.calls[0][0];
    expect(upsertHe.where.tenantId_employeeId_fecha_tipo.fecha).toEqual(new Date(2026, 6, 20));
    expect(upsertHe.create.horasCalculadas).toBeCloseTo(1, 2);
  });

  it('personal de confianza: horasExtrasDiarias=0 y NO se upserta HorasExtra', async () => {
    const tx = mockTx();
    tx.contrato.findFirst.mockResolvedValue({ personalDeConfianza: true });
    tx.turnoAsignacion.count.mockResolvedValue(10);
    tx.turnoAsignacion.findMany.mockResolvedValue([
      { fecha: new Date(2026, 6, 20), tipoDia: 'TURNO', turno: TURNO_NOCHE },
    ]);
    tx.marcacion.findMany.mockResolvedValue([
      { tipo: 'ENTRADA', timestamp: new Date(2026, 6, 20, 20, 0) },
      { tipo: 'SALIDA', timestamp: new Date(2026, 6, 21, 9, 0) }, // 1h sobre el turno
    ]);

    await service.recalcularConTurno(tx, 't-1', 'emp-1', new Date(2026, 6, 21, 9, 0), CONFIG);

    const upsert = tx.asistenciaResumen.upsert.mock.calls[0][0];
    expect(upsert.update.horasExtrasDiarias).toBe(0);
    expect(upsert.update.horasTrabajadas).toBeCloseTo(13, 2); // horas reales sí quedan
    expect(tx.horasExtra.upsert).not.toHaveBeenCalled();
  });

  it('marcación fuera de toda ventana con plan en el mes → resumen del día calendario con sinPlan=true', async () => {
    const tx = mockTx();
    tx.turnoAsignacion.count.mockResolvedValue(10);
    tx.turnoAsignacion.findMany.mockResolvedValue([]); // sin turno D-1..D+1
    tx.marcacion.findMany.mockResolvedValue([
      { tipo: 'ENTRADA', timestamp: new Date(2026, 6, 22, 8, 0) },
      { tipo: 'SALIDA', timestamp: new Date(2026, 6, 22, 20, 0) },
    ]);

    const manejado = await service.recalcularConTurno(
      tx, 't-1', 'emp-1', new Date(2026, 6, 22, 20, 0), CONFIG,
    );

    expect(manejado).toBe(true);
    const upsert = tx.asistenciaResumen.upsert.mock.calls[0][0];
    expect(upsert.where.tenantId_employeeId_fecha.fecha).toEqual(new Date(2026, 6, 22));
    expect(upsert.update.sinPlan).toBe(true);
    expect(upsert.update.turnoId).toBeNull();
  });
});
