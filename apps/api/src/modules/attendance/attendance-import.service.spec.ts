import { AttendanceImportService } from './attendance-import.service';

/**
 * Tests unitarios de AttendanceImportService (import CSV desde sistema
 * biométrico externo). Mismo patrón que AttendanceService: los métodos
 * reciben el tx de Prisma como parámetro y aquí se mockea por completo —
 * sin BD real.
 */
describe('AttendanceImportService', () => {
  const TENANT = 'tenant-1';
  const SEDE = 'sede-1';
  const USER = 'user-1';
  const DOC = '45678901';

  const employee = {
    id: 'emp-1',
    tenantId: TENANT,
    sedeId: SEDE,
    numeroDocumento: DOC,
  };

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
    // Las marcaciones creadas durante el import alimentan el recálculo
    // posterior del resumen (findMany del día las devuelve).
    const creadas: any[] = [];
    return {
      configuracionAsistencia: {
        findFirst: jest.fn().mockResolvedValue(configAsistencia),
      },
      employee: {
        findFirst: jest.fn().mockImplementation(({ where }: any) =>
          Promise.resolve(where.numeroDocumento === DOC ? employee : null),
        ),
      },
      marcacion: {
        findFirst: jest.fn().mockResolvedValue(null), // sin duplicados por defecto
        findMany: jest.fn().mockImplementation(() => Promise.resolve([...creadas])),
        create: jest.fn().mockImplementation(({ data }: any) => {
          const marcacion = { id: `marc-${creadas.length + 1}`, ...data };
          creadas.push(marcacion);
          return Promise.resolve(marcacion);
        }),
      },
      justificacion: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
      asistenciaResumen: {
        upsert: jest
          .fn()
          .mockImplementation(({ create }: any) => Promise.resolve({ id: 'res-1', ...create })),
      },
      horasExtra: {
        upsert: jest
          .fn()
          .mockImplementation(({ create }: any) => Promise.resolve({ id: 'he-1', ...create })),
      },
      ...overrides,
    };
  }

  const service = new AttendanceImportService();

  const HEADER = 'numero_documento,fecha,hora,tipo';

  describe('generarPlantilla', () => {
    it('retorna el CSV con BOM UTF-8, header correcto y 2 filas de ejemplo', () => {
      const plantilla = service.generarPlantilla();

      expect(plantilla.startsWith('﻿')).toBe(true);
      const lineas = plantilla
        .replace(/^﻿/, '')
        .split(/\r?\n/)
        .filter((l) => l.trim() !== '');
      expect(lineas[0] ?? '').toBe(HEADER);
      expect(lineas).toHaveLength(3); // header + 2 filas de ejemplo
      expect(lineas[1] ?? '').toContain('ENTRADA');
      expect(lineas[2] ?? '').toContain('SALIDA');
      // Fechas YYYY-MM-DD y horas HH:mm en las filas de ejemplo
      expect(lineas[1] ?? '').toMatch(/,\d{4}-\d{2}-\d{2},\d{2}:\d{2},/);
    });
  });

  describe('importarCsv', () => {
    it('importa filas válidas: crea marcaciones (ubicacionValidada=false, sede del empleado) y recalcula el resumen del día', async () => {
      const tx = buildTx();
      const csv =
        `${HEADER}\n` +
        `${DOC},2026-07-01,08:00,ENTRADA\n` +
        `${DOC},2026-07-01,17:00,SALIDA\n`;

      const resultado = await service.importarCsv(tx as any, csv, USER);

      expect(resultado.procesadas).toBe(2);
      expect(resultado.omitidas).toBe(0);
      expect(resultado.errores).toEqual([]);

      expect(tx.marcacion.create).toHaveBeenCalledTimes(2);
      const entrada = tx.marcacion.create.mock.calls[0][0].data;
      expect(entrada.tenantId).toBe(TENANT);
      expect(entrada.employeeId).toBe('emp-1');
      expect(entrada.sedeId).toBe(SEDE);
      expect(entrada.tipo).toBe('ENTRADA');
      expect(entrada.timestamp).toEqual(new Date(2026, 6, 1, 8, 0, 0, 0));
      expect(entrada.tipoIdentificacion).toBe('HUELLA'); // default biométrico
      expect(entrada.ubicacionValidada).toBe(false); // import sin GPS
      expect(entrada.bloqueado).toBe(false);
      expect(entrada.creadoPor).toBe(USER);

      const salida = tx.marcacion.create.mock.calls[1][0].data;
      expect(salida.tipo).toBe('SALIDA');
      expect(salida.timestamp).toEqual(new Date(2026, 6, 1, 17, 0, 0, 0));

      // ENTRADA + SALIDA del día → upsert del resumen: 9h trabajadas, sin falta
      expect(tx.asistenciaResumen.upsert).toHaveBeenCalledTimes(1);
      const resumenArgs = tx.asistenciaResumen.upsert.mock.calls[0][0];
      expect(resumenArgs.where.tenantId_employeeId_fecha.employeeId).toBe('emp-1');
      expect(resumenArgs.create.horasTrabajadas).toBe(9);
      expect(resumenArgs.create.falta).toBe(false);
      expect(resumenArgs.update.horasTrabajadas).toBe(9);
      // 9h - 8h de jornada legal = 1h extra diaria
      expect(tx.horasExtra.upsert).toHaveBeenCalledTimes(1);
    });

    it('respeta la quinta columna tipo_identificacion cuando viene en el CSV', async () => {
      const tx = buildTx();
      const csv = `${HEADER},tipo_identificacion\n${DOC},2026-07-01,08:00,ENTRADA,MANUAL\n`;

      const resultado = await service.importarCsv(tx as any, csv, USER);

      expect(resultado.procesadas).toBe(1);
      expect(tx.marcacion.create.mock.calls[0][0].data.tipoIdentificacion).toBe('MANUAL');
    });

    it('tolera BOM UTF-8 y saltos de línea CRLF', async () => {
      const tx = buildTx();
      const csv = `﻿${HEADER}\r\n${DOC},2026-07-01,08:00,ENTRADA\r\n`;

      const resultado = await service.importarCsv(tx as any, csv, USER);

      expect(resultado.procesadas).toBe(1);
      expect(resultado.errores).toEqual([]);
      expect(tx.marcacion.create.mock.calls[0][0].data.tipo).toBe('ENTRADA');
    });

    it('acumula error si el documento no existe en el tenant y sigue con las demás filas (no aborta)', async () => {
      const tx = buildTx();
      const csv =
        `${HEADER}\n` +
        `99999999,2026-07-01,08:00,ENTRADA\n` + // fila 2: doc inexistente
        `${DOC},2026-07-01,08:00,ENTRADA\n`; // fila 3: válida

      const resultado = await service.importarCsv(tx as any, csv, USER);

      expect(resultado.procesadas).toBe(1);
      expect(resultado.omitidas).toBe(0);
      expect(resultado.errores).toHaveLength(1);
      expect(resultado.errores[0]?.fila).toBe(2);
      expect(resultado.errores[0]?.mensaje).toMatch(/99999999/);
      // Solo la fila válida persiste
      expect(tx.marcacion.create).toHaveBeenCalledTimes(1);
      expect(tx.marcacion.create.mock.calls[0][0].data.employeeId).toBe('emp-1');
    });

    it('acumula error en fila malformada (número de columnas incorrecto) sin persistirla', async () => {
      const tx = buildTx();
      const csv = `${HEADER}\n${DOC},2026-07-01\n`; // solo 2 columnas

      const resultado = await service.importarCsv(tx as any, csv, USER);

      expect(resultado.procesadas).toBe(0);
      expect(resultado.errores).toHaveLength(1);
      expect(resultado.errores[0]?.fila).toBe(2);
      expect(resultado.errores[0]?.mensaje).toMatch(/columnas/i);
      expect(tx.marcacion.create).not.toHaveBeenCalled();
    });

    it('acumula error si la fecha u hora no son parseables', async () => {
      const tx = buildTx();
      const csv =
        `${HEADER}\n` +
        `${DOC},2026-13-45,08:00,ENTRADA\n` + // fecha inválida
        `${DOC},2026-07-01,25:99,ENTRADA\n`; // hora inválida

      const resultado = await service.importarCsv(tx as any, csv, USER);

      expect(resultado.procesadas).toBe(0);
      expect(resultado.errores).toHaveLength(2);
      expect(resultado.errores[0]?.fila).toBe(2);
      expect(resultado.errores[1]?.fila).toBe(3);
      expect(tx.marcacion.create).not.toHaveBeenCalled();
    });

    it('acumula error si el tipo de marcación es inválido', async () => {
      const tx = buildTx();
      const csv = `${HEADER}\n${DOC},2026-07-01,08:00,DESCANSO\n`;

      const resultado = await service.importarCsv(tx as any, csv, USER);

      expect(resultado.procesadas).toBe(0);
      expect(resultado.errores).toHaveLength(1);
      expect(resultado.errores[0]?.mensaje).toMatch(/DESCANSO/);
      expect(tx.marcacion.create).not.toHaveBeenCalled();
    });

    it('acumula error si tipo_identificacion es inválido', async () => {
      const tx = buildTx();
      const csv = `${HEADER}\n${DOC},2026-07-01,08:00,ENTRADA,TELEPATIA\n`;

      const resultado = await service.importarCsv(tx as any, csv, USER);

      expect(resultado.procesadas).toBe(0);
      expect(resultado.errores).toHaveLength(1);
      expect(resultado.errores[0]?.mensaje).toMatch(/TELEPATIA/);
      expect(tx.marcacion.create).not.toHaveBeenCalled();
    });

    it('omite (no error) la marcación duplicada employee+timestamp+tipo: permite re-importar el mismo archivo', async () => {
      const tx = buildTx({
        marcacion: {
          findFirst: jest.fn().mockResolvedValue({ id: 'marc-existente' }),
          findMany: jest.fn().mockResolvedValue([]),
          create: jest.fn(),
        },
      });
      const csv = `${HEADER}\n${DOC},2026-07-01,08:00,ENTRADA\n`;

      const resultado = await service.importarCsv(tx as any, csv, USER);

      expect(resultado.procesadas).toBe(0);
      expect(resultado.omitidas).toBe(1);
      expect(resultado.errores).toEqual([]);
      expect(tx.marcacion.create).not.toHaveBeenCalled();
    });

    it('genera horas extra DIARIAS cuando el par ENTRADA+SALIDA excede la jornada de 8h', async () => {
      const tx = buildTx();
      const csv =
        `${HEADER}\n` +
        `${DOC},2026-07-01,08:00,ENTRADA\n` +
        `${DOC},2026-07-01,19:00,SALIDA\n`; // 11h → 3h extra

      const resultado = await service.importarCsv(tx as any, csv, USER);

      expect(resultado.procesadas).toBe(2);
      expect(tx.horasExtra.upsert).toHaveBeenCalledTimes(1);
      const heArgs = tx.horasExtra.upsert.mock.calls[0][0];
      expect(heArgs.where.tenantId_employeeId_fecha_tipo.tipo).toBe('DIARIAS');
      expect(heArgs.create.tipo).toBe('DIARIAS');
      expect(heArgs.create.horasCalculadas).toBe(3);
      expect(heArgs.update.horasCalculadas).toBe(3);
    });

    it('NO recalcula el resumen de un día que solo tiene ENTRADA (sin SALIDA)', async () => {
      const tx = buildTx();
      const csv = `${HEADER}\n${DOC},2026-07-01,08:00,ENTRADA\n`;

      const resultado = await service.importarCsv(tx as any, csv, USER);

      expect(resultado.procesadas).toBe(1);
      expect(tx.asistenciaResumen.upsert).not.toHaveBeenCalled();
      expect(tx.horasExtra.upsert).not.toHaveBeenCalled();
    });

    it('lanza error si el tenant no tiene ConfiguracionAsistencia', async () => {
      const tx = buildTx({
        configuracionAsistencia: { findFirst: jest.fn().mockResolvedValue(null) },
      });
      const csv = `${HEADER}\n${DOC},2026-07-01,08:00,ENTRADA\n`;

      await expect(service.importarCsv(tx as any, csv, USER)).rejects.toThrow(/Configuraci/);
      expect(tx.marcacion.create).not.toHaveBeenCalled();
    });
  });
});
