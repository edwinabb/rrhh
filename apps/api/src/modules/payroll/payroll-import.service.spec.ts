import { PayrollImportService } from './payroll-import.service';

describe('PayrollImportService', () => {
  const TENANT_ID = 'tenant-1';
  const EMPLOYEE_ID = 'emp-1';
  const PERIODO = '2026-06';

  function buildTx(overrides: Partial<any> = {}) {
    return {
      employee: {
        findFirst: jest.fn().mockImplementation(({ where }: any) =>
          Promise.resolve(
            where.numeroDocumento === '45678901'
              ? { id: EMPLOYEE_ID, tenantId: TENANT_ID, numeroDocumento: '45678901' }
              : null,
          ),
        ),
      },
      planillaNovedad: {
        upsert: jest
          .fn()
          .mockImplementation(({ create }: any) => Promise.resolve({ id: 'nov-1', ...create })),
      },
      ...overrides,
    };
  }

  describe('generarPlantilla', () => {
    it('genera un CSV con BOM UTF-8, cabecera y 2 filas de ejemplo', () => {
      const service = new PayrollImportService();
      const plantilla = service.generarPlantilla();

      expect(plantilla.startsWith('﻿')).toBe(true);
      const lineas = plantilla.replace('﻿', '').trim().split('\n');
      expect(lineas[0]).toBe(
        'numero_documento,dias_laborados,horas_extra_25,horas_extra_35,bonificaciones,descuentos',
      );
      expect(lineas).toHaveLength(3); // cabecera + 2 ejemplos
      // Cada fila de ejemplo tiene exactamente 6 columnas
      expect(lineas[1]!.split(',')).toHaveLength(6);
      expect(lineas[2]!.split(',')).toHaveLength(6);
    });
  });

  describe('importarCsv', () => {
    it('importa una fila válida: resuelve el empleado por documento y hace upsert', async () => {
      const tx = buildTx();
      const service = new PayrollImportService();
      const csv =
        'numero_documento,dias_laborados,horas_extra_25,horas_extra_35,bonificaciones,descuentos\n' +
        '45678901,30,4,2,250.00,50.00\n';

      const reporte = await service.importarCsv(tx as any, PERIODO, csv);

      expect(reporte).toEqual({ procesadas: 1, omitidas: 0, errores: [] });
      expect(tx.planillaNovedad.upsert).toHaveBeenCalledTimes(1);
      const llamada = tx.planillaNovedad.upsert.mock.calls[0][0];
      expect(llamada.where).toEqual({
        tenantId_employeeId_periodo: {
          tenantId: TENANT_ID,
          employeeId: EMPLOYEE_ID,
          periodo: PERIODO,
        },
      });
      expect(llamada.create).toMatchObject({
        tenantId: TENANT_ID,
        employeeId: EMPLOYEE_ID,
        periodo: PERIODO,
        diasLaborados: 30,
        horasExtra25: 4,
        horasExtra35: 2,
        bonificaciones: 250,
        descuentos: 50,
        fuente: 'csv',
      });
    });

    it('re-importar el mismo período actualiza vía upsert (update con los nuevos valores, sin duplicar)', async () => {
      const tx = buildTx();
      const service = new PayrollImportService();
      const csv1 =
        'numero_documento,dias_laborados,horas_extra_25,horas_extra_35,bonificaciones,descuentos\n' +
        '45678901,30,4,0,250.00,0\n';
      const csv2 =
        'numero_documento,dias_laborados,horas_extra_25,horas_extra_35,bonificaciones,descuentos\n' +
        '45678901,28,0,3,100.00,20.00\n';

      await service.importarCsv(tx as any, PERIODO, csv1);
      await service.importarCsv(tx as any, PERIODO, csv2);

      // Siempre upsert sobre la misma clave única — nunca create suelto
      expect(tx.planillaNovedad.upsert).toHaveBeenCalledTimes(2);
      const segunda = tx.planillaNovedad.upsert.mock.calls[1][0];
      expect(segunda.where.tenantId_employeeId_periodo).toEqual({
        tenantId: TENANT_ID,
        employeeId: EMPLOYEE_ID,
        periodo: PERIODO,
      });
      expect(segunda.update).toMatchObject({
        diasLaborados: 28,
        horasExtra25: 0,
        horasExtra35: 3,
        bonificaciones: 100,
        descuentos: 20,
      });
    });

    it('documento inexistente en el tenant → error de fila, no aborta y no persiste esa fila', async () => {
      const tx = buildTx();
      const service = new PayrollImportService();
      const csv =
        'numero_documento,dias_laborados,horas_extra_25,horas_extra_35,bonificaciones,descuentos\n' +
        '99999999,30,0,0,0,0\n' +
        '45678901,30,0,0,100,0\n';

      const reporte = await service.importarCsv(tx as any, PERIODO, csv);

      expect(reporte.procesadas).toBe(1);
      expect(reporte.omitidas).toBe(1);
      expect(reporte.errores).toHaveLength(1);
      expect(reporte.errores[0]!.fila).toBe(2);
      expect(reporte.errores[0]!.mensaje).toContain('99999999');
      expect(tx.planillaNovedad.upsert).toHaveBeenCalledTimes(1);
    });

    it('valores negativos → error de fila y no persiste', async () => {
      const tx = buildTx();
      const service = new PayrollImportService();
      const csv =
        'numero_documento,dias_laborados,horas_extra_25,horas_extra_35,bonificaciones,descuentos\n' +
        '45678901,30,-4,0,0,0\n';

      const reporte = await service.importarCsv(tx as any, PERIODO, csv);

      expect(reporte).toMatchObject({ procesadas: 0, omitidas: 1 });
      expect(reporte.errores[0]!.fila).toBe(2);
      expect(tx.planillaNovedad.upsert).not.toHaveBeenCalled();
    });

    it('dias_laborados fuera de 0-31 o no numérico → error de fila', async () => {
      const tx = buildTx();
      const service = new PayrollImportService();
      const csv =
        'numero_documento,dias_laborados,horas_extra_25,horas_extra_35,bonificaciones,descuentos\n' +
        '45678901,45,0,0,0,0\n' +
        '45678901,abc,0,0,0,0\n';

      const reporte = await service.importarCsv(tx as any, PERIODO, csv);

      expect(reporte).toMatchObject({ procesadas: 0, omitidas: 2 });
      expect(reporte.errores.map((e: any) => e.fila)).toEqual([2, 3]);
      expect(tx.planillaNovedad.upsert).not.toHaveBeenCalled();
    });

    it('tolera BOM, CRLF, campos entrecomillados y líneas vacías; campos vacíos toman defaults', async () => {
      const tx = buildTx();
      const service = new PayrollImportService();
      const csv =
        '﻿numero_documento,dias_laborados,horas_extra_25,horas_extra_35,bonificaciones,descuentos\r\n' +
        '"45678901",,"4",0,"1250.50",\r\n' +
        '\r\n';

      const reporte = await service.importarCsv(tx as any, PERIODO, csv);

      expect(reporte).toEqual({ procesadas: 1, omitidas: 0, errores: [] });
      const llamada = tx.planillaNovedad.upsert.mock.calls[0][0];
      expect(llamada.create).toMatchObject({
        diasLaborados: null,
        horasExtra25: 4,
        horasExtra35: 0,
        bonificaciones: 1250.5,
        descuentos: 0,
      });
    });

    it('cabecera inválida o número de columnas incorrecto → errores sin abortar', async () => {
      const tx = buildTx();
      const service = new PayrollImportService();
      const csv =
        'numero_documento,dias_laborados,horas_extra_25,horas_extra_35,bonificaciones,descuentos\n' +
        '45678901,30\n';

      const reporte = await service.importarCsv(tx as any, PERIODO, csv);

      expect(reporte.procesadas).toBe(0);
      expect(reporte.omitidas).toBe(1);
      expect(reporte.errores[0]!.fila).toBe(2);
    });

    it('período inválido → lanza error antes de tocar la base', async () => {
      const tx = buildTx();
      const service = new PayrollImportService();

      await expect(service.importarCsv(tx as any, '062026', 'x')).rejects.toThrow();
      expect(tx.planillaNovedad.upsert).not.toHaveBeenCalled();
    });
  });
});
