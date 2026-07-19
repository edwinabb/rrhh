import { AttendanceService } from './attendance.service';

/**
 * Tests unitarios de AttendanceService (orquestador de asistencia, Fase 2).
 * Mismo patrón que PayrollRunService: los métodos reciben el tx de Prisma
 * como parámetro y aquí se mockea por completo — sin BD real.
 */
describe('AttendanceService', () => {
  const TENANT = 'tenant-1';
  const EMPLOYEE = 'emp-1';
  const SEDE = 'sede-1';
  const USER = 'user-1';

  // Coordenadas del centro del geofence (Lima Centro)
  const GEO = { latitud: -12.0464, longitud: -77.0428, radioMetros: 100 };

  const configAsistencia = {
    id: 'config-1',
    tenantId: TENANT,
    horaEntradaEstandar: '08:00',
    horaSalidaEstandar: '17:00',
    toleranciaTardanzaMinutos: 15,
    requiereGeofence: true,
    requiereBiometria: false,
    umbralConfianzaBiometria: 0.95,
  };

  function buildTx(overrides: Partial<Record<string, any>> = {}) {
    return {
      configuracionAsistencia: {
        findUnique: jest.fn().mockResolvedValue(configAsistencia),
      },
      geofence: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'geo-1',
          tenantId: TENANT,
          sedeId: SEDE,
          ...GEO,
          activo: true,
        }),
      },
      marcacion: {
        findMany: jest.fn().mockResolvedValue([]),
        create: jest
          .fn()
          .mockImplementation(({ data }) => Promise.resolve({ id: 'marc-nueva', ...data })),
      },
      justificacion: {
        findFirst: jest.fn().mockResolvedValue(null),
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest
          .fn()
          .mockImplementation(({ data }) => Promise.resolve({ id: 'just-1', ...data })),
        update: jest
          .fn()
          .mockImplementation(({ data }) => Promise.resolve({ id: 'just-1', ...data })),
      },
      asistenciaResumen: {
        upsert: jest
          .fn()
          .mockImplementation(({ create }) => Promise.resolve({ id: 'resumen-1', ...create })),
      },
      horasExtra: {
        upsert: jest
          .fn()
          .mockImplementation(({ create }) => Promise.resolve({ id: 'he-1', ...create })),
      },
      ...overrides,
    };
  }

  const service = new AttendanceService();

  describe('registrarMarcacion', () => {
    const entradaValida = {
      tenantId: TENANT,
      employeeId: EMPLOYEE,
      sedeId: SEDE,
      tipo: 'ENTRADA' as const,
      timestamp: new Date('2026-07-13T08:05:00'),
      latitud: GEO.latitud,
      longitud: GEO.longitud,
      creadoPor: USER,
    };

    it('registra una ENTRADA válida dentro del geofence sin recalcular el resumen', async () => {
      const tx = buildTx();

      const marcacion = await service.registrarMarcacion(tx as any, entradaValida);

      expect(tx.marcacion.create).toHaveBeenCalledTimes(1);
      const data = tx.marcacion.create.mock.calls[0][0].data;
      expect(data.tipo).toBe('ENTRADA');
      expect(data.bloqueado).toBe(false);
      expect(data.ubicacionValidada).toBe(true);
      expect(data.distanciaSedeMetros).toBeLessThan(1);
      expect(data.creadoPor).toBe(USER);
      // ENTRADA no dispara recálculo de resumen ni horas extra
      expect(tx.asistenciaResumen.upsert).not.toHaveBeenCalled();
      expect(tx.horasExtra.upsert).not.toHaveBeenCalled();
      expect(marcacion.bloqueado).toBe(false);
    });

    it('lanza error si el tenant no tiene ConfiguracionAsistencia', async () => {
      const tx = buildTx({
        configuracionAsistencia: { findUnique: jest.fn().mockResolvedValue(null) },
      });

      await expect(service.registrarMarcacion(tx as any, entradaValida)).rejects.toThrow(
        /Configuraci/,
      );
      expect(tx.marcacion.create).not.toHaveBeenCalled();
    });

    it('persiste bloqueada (append-only) una SALIDA sin ENTRADA previa y no recalcula el resumen', async () => {
      const tx = buildTx(); // sin marcaciones previas del día

      const marcacion = await service.registrarMarcacion(tx as any, {
        ...entradaValida,
        tipo: 'SALIDA' as const,
        timestamp: new Date('2026-07-13T17:00:00'),
      });

      // Se registra el intento por auditoría, pero bloqueado
      expect(tx.marcacion.create).toHaveBeenCalledTimes(1);
      const data = tx.marcacion.create.mock.calls[0][0].data;
      expect(data.bloqueado).toBe(true);
      expect(data.motivoBloqueo).toMatch(/SALIDA sin ENTRADA/);
      expect(marcacion.bloqueado).toBe(true);
      // Una marcación bloqueada no altera resumen ni horas extra
      expect(tx.asistenciaResumen.upsert).not.toHaveBeenCalled();
      expect(tx.horasExtra.upsert).not.toHaveBeenCalled();
    });

    it('en SALIDA recalcula el resumen del día e inserta horas extra diarias si excede la jornada', async () => {
      const entradaPrevia = {
        id: 'marc-entrada',
        tipo: 'ENTRADA',
        timestamp: new Date('2026-07-13T08:00:00'),
      };
      const tx = buildTx({
        marcacion: {
          findMany: jest.fn().mockResolvedValue([entradaPrevia]),
          create: jest
            .fn()
            .mockImplementation(({ data }) => Promise.resolve({ id: 'marc-salida', ...data })),
        },
      });

      // Salida a las 19:00 → 11h trabajadas → 3h extra sobre la jornada legal de 8h
      await service.registrarMarcacion(tx as any, {
        ...entradaValida,
        tipo: 'SALIDA' as const,
        timestamp: new Date('2026-07-13T19:00:00'),
      });

      expect(tx.asistenciaResumen.upsert).toHaveBeenCalledTimes(1);
      const resumenArgs = tx.asistenciaResumen.upsert.mock.calls[0][0];
      expect(resumenArgs.create.horasTrabajadas).toBe(11);
      expect(resumenArgs.create.falta).toBe(false);
      expect(resumenArgs.update.horasTrabajadas).toBe(11);

      expect(tx.horasExtra.upsert).toHaveBeenCalledTimes(1);
      const heArgs = tx.horasExtra.upsert.mock.calls[0][0];
      expect(heArgs.create.tipo).toBe('DIARIAS');
      expect(heArgs.create.horasCalculadas).toBe(3);
      expect(heArgs.create.horasExtrasDiarias).toBeUndefined();
    });

    it('en SALIDA dentro de la jornada NO inserta horas extra', async () => {
      const entradaPrevia = {
        id: 'marc-entrada',
        tipo: 'ENTRADA',
        timestamp: new Date('2026-07-13T08:00:00'),
      };
      const tx = buildTx({
        marcacion: {
          findMany: jest.fn().mockResolvedValue([entradaPrevia]),
          create: jest
            .fn()
            .mockImplementation(({ data }) => Promise.resolve({ id: 'marc-salida', ...data })),
        },
      });

      // Salida a las 16:00 → exactamente 8h, sin exceso
      await service.registrarMarcacion(tx as any, {
        ...entradaValida,
        tipo: 'SALIDA' as const,
        timestamp: new Date('2026-07-13T16:00:00'),
      });

      expect(tx.asistenciaResumen.upsert).toHaveBeenCalledTimes(1);
      expect(tx.horasExtra.upsert).not.toHaveBeenCalled();
    });
  });

  describe('crearJustificacion', () => {
    it('crea la justificación en estado PENDIENTE', async () => {
      const tx = buildTx();

      const justificacion = await service.crearJustificacion(tx as any, {
        tenantId: TENANT,
        employeeId: EMPLOYEE,
        motivo: 'FALTA',
        fecha: new Date('2026-07-10'),
        descripcion: 'Cita médica con constancia',
        documentoUrl: 'https://storage/constancia.pdf',
      });

      expect(tx.justificacion.create).toHaveBeenCalledTimes(1);
      const data = tx.justificacion.create.mock.calls[0][0].data;
      expect(data.estado).toBe('PENDIENTE');
      expect(data.tenantId).toBe(TENANT);
      expect(data.employeeId).toBe(EMPLOYEE);
      expect(justificacion.estado).toBe('PENDIENTE');
    });
  });

  describe('resolverJustificacion', () => {
    const pendiente = {
      id: 'just-1',
      tenantId: TENANT,
      employeeId: EMPLOYEE,
      fecha: new Date('2026-07-10'),
      estado: 'PENDIENTE',
    };

    it('aprueba una justificación pendiente y marca justificado=true en el resumen de esa fecha', async () => {
      const tx = buildTx({
        justificacion: {
          findUnique: jest.fn().mockResolvedValue(pendiente),
          update: jest
            .fn()
            .mockImplementation(({ data }) => Promise.resolve({ ...pendiente, ...data })),
        },
      });

      const resultado = await service.resolverJustificacion(tx as any, 'just-1', true, USER);

      expect(resultado.estado).toBe('APROBADA');
      const updateArgs = tx.justificacion.update.mock.calls[0][0];
      expect(updateArgs.where.id).toBe('just-1');
      expect(updateArgs.data.aprobadoPor).toBe(USER);
      expect(updateArgs.data.aprobadoEn).toBeInstanceOf(Date);

      expect(tx.asistenciaResumen.upsert).toHaveBeenCalledTimes(1);
      const resumenArgs = tx.asistenciaResumen.upsert.mock.calls[0][0];
      expect(resumenArgs.where.tenantId_employeeId_fecha.employeeId).toBe(EMPLOYEE);
      expect(resumenArgs.update.justificado).toBe(true);
      expect(resumenArgs.update.falta).toBe(false);
      expect(resumenArgs.create.justificado).toBe(true);
    });

    it('rechaza una justificación pendiente con motivo y NO toca el resumen', async () => {
      const tx = buildTx({
        justificacion: {
          findUnique: jest.fn().mockResolvedValue(pendiente),
          update: jest
            .fn()
            .mockImplementation(({ data }) => Promise.resolve({ ...pendiente, ...data })),
        },
      });

      const resultado = await service.resolverJustificacion(
        tx as any,
        'just-1',
        false,
        USER,
        'Documento ilegible',
      );

      expect(resultado.estado).toBe('RECHAZADA');
      const updateArgs = tx.justificacion.update.mock.calls[0][0];
      expect(updateArgs.data.motivoRechazo).toBe('Documento ilegible');
      expect(tx.asistenciaResumen.upsert).not.toHaveBeenCalled();
    });

    it('lanza error al rechazar sin motivo de rechazo', async () => {
      const tx = buildTx({
        justificacion: {
          findUnique: jest.fn().mockResolvedValue(pendiente),
          update: jest.fn(),
        },
      });

      await expect(
        service.resolverJustificacion(tx as any, 'just-1', false, USER),
      ).rejects.toThrow(/motivo/i);
      expect(tx.justificacion.update).not.toHaveBeenCalled();
    });

    it('lanza error si la justificación ya fue resuelta (transición inválida)', async () => {
      const tx = buildTx({
        justificacion: {
          findUnique: jest.fn().mockResolvedValue({ ...pendiente, estado: 'APROBADA' }),
          update: jest.fn(),
        },
      });

      await expect(
        service.resolverJustificacion(tx as any, 'just-1', true, USER),
      ).rejects.toThrow(/PENDIENTE/);
      expect(tx.justificacion.update).not.toHaveBeenCalled();
    });

    it('lanza error si la justificación no existe', async () => {
      const tx = buildTx({
        justificacion: {
          findUnique: jest.fn().mockResolvedValue(null),
          update: jest.fn(),
        },
      });

      await expect(
        service.resolverJustificacion(tx as any, 'inexistente', true, USER),
      ).rejects.toThrow(/no encontrada/i);
    });
  });

  describe('AttendanceService — integración con turnos', () => {
    it('si TurnoRecalculoService maneja el día, no se ejecuta el recálculo estándar', async () => {
      const entradaPrevia = {
        id: 'marc-entrada',
        tipo: 'ENTRADA',
        timestamp: new Date('2026-07-13T08:00:00'),
      };
      const tx = buildTx({
        marcacion: {
          findMany: jest.fn().mockResolvedValue([entradaPrevia]),
          create: jest
            .fn()
            .mockImplementation(({ data }) => Promise.resolve({ id: 'marc-salida', ...data })),
        },
      });

      const turnoRecalculo = { recalcularConTurno: jest.fn().mockResolvedValue(true) } as any;
      const serviceConTurno = new AttendanceService(turnoRecalculo);

      await serviceConTurno.registrarMarcacion(tx as any, {
        tenantId: TENANT,
        employeeId: EMPLOYEE,
        sedeId: SEDE,
        tipo: 'SALIDA' as const,
        timestamp: new Date('2026-07-13T17:00:00'),
        latitud: GEO.latitud,
        longitud: GEO.longitud,
        creadoPor: USER,
      });

      expect(turnoRecalculo.recalcularConTurno).toHaveBeenCalled();
      expect(tx.asistenciaResumen.upsert).not.toHaveBeenCalled();
    });
  });
});
