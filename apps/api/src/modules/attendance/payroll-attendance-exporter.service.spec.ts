import { PayrollAttendanceExporterService } from './payroll-attendance-exporter.service';

/**
 * Tests unitarios (mocks, sin BD real) del exportador de asistencia hacia
 * nómina (integración Fase 2 → Fase 1). Patrón PayrollRunService: el cliente
 * transaccional (tx) se recibe como parámetro y se mockea.
 */
describe('PayrollAttendanceExporterService', () => {
  function buildTx(overrides: Partial<any> = {}) {
    return {
      asistenciaResumen: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      horasExtra: {
        findMany: jest.fn().mockResolvedValue([]),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      ...overrides,
    };
  }

  function resumenBase(overrides: Partial<any> = {}) {
    return {
      id: 'res-1',
      tenantId: 'tenant-1',
      employeeId: 'emp-1',
      fecha: new Date('2026-06-01'),
      horaEntrada: new Date('2026-06-01T08:00:00Z'),
      horaSalida: new Date('2026-06-01T16:00:00Z'),
      horasTrabajadas: 8,
      horasExtrasDiarias: 0,
      falta: false,
      tardanzaMinutos: 0,
      justificado: false,
      ...overrides,
    };
  }

  describe('exportarHorasComputables', () => {
    it('agrupa por empleado y calcula HC: falta justificada computa la jornada, injustificada no suma', async () => {
      const tx = buildTx({
        asistenciaResumen: {
          findMany: jest.fn().mockResolvedValue([
            // emp-1: 8h trabajadas + falta justificada (computa jornada de 8h)
            resumenBase({ employeeId: 'emp-1', horasTrabajadas: 8 }),
            resumenBase({
              employeeId: 'emp-1',
              fecha: new Date('2026-06-02'),
              horaEntrada: null,
              horaSalida: null,
              horasTrabajadas: 0,
              falta: false,
              justificado: true,
            }),
            // emp-2: 9h trabajadas + falta injustificada (no suma)
            resumenBase({ employeeId: 'emp-2', horasTrabajadas: 9 }),
            resumenBase({
              employeeId: 'emp-2',
              fecha: new Date('2026-06-02'),
              horaEntrada: null,
              horaSalida: null,
              horasTrabajadas: 0,
              falta: true,
              justificado: false,
            }),
          ]),
        },
      });
      const service = new PayrollAttendanceExporterService();

      const resultado = await service.exportarHorasComputables(tx as any, '2026-06');

      expect(resultado.get('emp-1')).toEqual({
        horasComputables: 16,
        faltasInjustificadas: 0,
        tardanzasMinutos: 0,
      });
      expect(resultado.get('emp-2')).toEqual({
        horasComputables: 9,
        faltasInjustificadas: 1,
        tardanzasMinutos: 0,
      });
    });

    it('suma los minutos de tardanza del período por empleado', async () => {
      const tx = buildTx({
        asistenciaResumen: {
          findMany: jest.fn().mockResolvedValue([
            resumenBase({ tardanzaMinutos: 20 }),
            resumenBase({ fecha: new Date('2026-06-02'), tardanzaMinutos: 12 }),
          ]),
        },
      });
      const service = new PayrollAttendanceExporterService();

      const resultado = await service.exportarHorasComputables(tx as any, '2026-06');

      expect(resultado.get('emp-1')?.tardanzasMinutos).toBe(32);
    });

    it('consulta AsistenciaResumen con el rango de fechas exacto del período', async () => {
      const tx = buildTx();
      const service = new PayrollAttendanceExporterService();

      await service.exportarHorasComputables(tx as any, '2026-02');

      expect(tx.asistenciaResumen.findMany).toHaveBeenCalledWith({
        where: {
          fecha: {
            gte: new Date(Date.UTC(2026, 1, 1)),
            lte: new Date(Date.UTC(2026, 1, 28)),
          },
        },
      });
    });

    it('retorna mapa vacío si el período no tiene resúmenes', async () => {
      const tx = buildTx();
      const service = new PayrollAttendanceExporterService();

      const resultado = await service.exportarHorasComputables(tx as any, '2026-06');

      expect(resultado.size).toBe(0);
    });
  });

  describe('exportarHorasExtra', () => {
    function horasExtraRegistro(overrides: Partial<any> = {}) {
      return {
        id: 'he-1',
        tenantId: 'tenant-1',
        employeeId: 'emp-1',
        fecha: new Date('2026-06-01'),
        tipo: 'DIARIAS',
        horasCalculadas: 3,
        incluidoEnNomina: false,
        ...overrides,
      };
    }

    it('reparte tramos D.Leg. 854: primeras 2h del día al 25%, el resto al 35%', async () => {
      const tx = buildTx({
        horasExtra: {
          // 3h extra en un día → 2h al 25% + 1h al 35%
          findMany: jest.fn().mockResolvedValue([horasExtraRegistro({ horasCalculadas: 3 })]),
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
      });
      const service = new PayrollAttendanceExporterService();

      const resultado = await service.exportarHorasExtra(tx as any, '2026-06');

      expect(resultado.get('emp-1')).toEqual({ horas25: 2, horas35: 1 });
    });

    it('aplica el tramo de 2h por cada registro (día), no sobre el total del mes', async () => {
      const tx = buildTx({
        horasExtra: {
          // dos días con 2h cada uno → 4h al 25%, 0h al 35%
          findMany: jest.fn().mockResolvedValue([
            horasExtraRegistro({ id: 'he-1', horasCalculadas: 2 }),
            horasExtraRegistro({
              id: 'he-2',
              fecha: new Date('2026-06-02'),
              horasCalculadas: 2,
            }),
          ]),
          updateMany: jest.fn().mockResolvedValue({ count: 2 }),
        },
      });
      const service = new PayrollAttendanceExporterService();

      const resultado = await service.exportarHorasExtra(tx as any, '2026-06');

      expect(resultado.get('emp-1')).toEqual({ horas25: 4, horas35: 0 });
    });

    it('lee solo registros con incluidoEnNomina=false y los marca como incluidos', async () => {
      const findMany = jest.fn().mockResolvedValue([
        horasExtraRegistro({ id: 'he-1' }),
        horasExtraRegistro({ id: 'he-2', employeeId: 'emp-2', horasCalculadas: 1 }),
      ]);
      const updateMany = jest.fn().mockResolvedValue({ count: 2 });
      const tx = buildTx({ horasExtra: { findMany, updateMany } });
      const service = new PayrollAttendanceExporterService();

      await service.exportarHorasExtra(tx as any, '2026-06');

      expect(findMany).toHaveBeenCalledWith({
        where: {
          incluidoEnNomina: false,
          fecha: {
            gte: new Date(Date.UTC(2026, 5, 1)),
            lte: new Date(Date.UTC(2026, 5, 30)),
          },
        },
      });
      expect(updateMany).toHaveBeenCalledWith({
        where: { id: { in: ['he-1', 'he-2'] } },
        data: { incluidoEnNomina: true },
      });
    });

    it('retorna mapa vacío y no marca nada si no hay horas extra pendientes', async () => {
      const tx = buildTx();
      const service = new PayrollAttendanceExporterService();

      const resultado = await service.exportarHorasExtra(tx as any, '2026-06');

      expect(resultado.size).toBe(0);
      expect(tx.horasExtra.updateMany).not.toHaveBeenCalled();
    });
  });
});
