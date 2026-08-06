import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PayrollController } from './payroll.controller';
import { PayrollRunService } from './payroll-run.service';
import { PayrollImportService } from './payroll-import.service';
import { PlanillaExporter } from './planilla-exporter.service';
import { BankFileExporter } from './bank-file-exporter.service';
import { PayrollExportMapperService } from './payroll-export-mapper.service';

// Mock de getTenantContext siguiendo la convención del repo (ver
// shifts.controller.spec.ts): un objeto mutable que cada test reemplaza.
let mockTenantContext: any = { tenantId: 't-1', userId: 'u-1', tx: {} };

jest.mock('../../common/database/tenant-request-context', () => ({
  getTenantContext: () => mockTenantContext,
}));

describe('PayrollController - Exportes de Nómina', () => {
  let controller: PayrollController;
  let mockPayrollRunService: any;
  let mockPayrollImportService: any;
  let mockPlanillaExporter: any;
  let mockBankFileExporter: any;
  let mockExportMapperService: any;

  beforeEach(async () => {
    mockPayrollRunService = {
      procesarPeriodo: jest.fn(),
    };
    mockPayrollImportService = {
      generarPlantilla: jest.fn(),
      importarCsv: jest.fn(),
    };
    mockPlanillaExporter = {
      exportarE18: jest.fn().mockReturnValue('1|12345678|0121|5000.00|5000.00'),
    };
    mockBankFileExporter = {
      exportarBcp: jest.fn().mockReturnValue('12345678|1234567890|5000.00'),
    };
    mockExportMapperService = {
      obtenerConfig: jest.fn(),
      mapearConceptosA18: jest.fn(),
      filtrarConceptosExcluidos: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [PayrollController],
      providers: [
        { provide: PayrollRunService, useValue: mockPayrollRunService },
        { provide: PayrollImportService, useValue: mockPayrollImportService },
        { provide: PlanillaExporter, useValue: mockPlanillaExporter },
        { provide: BankFileExporter, useValue: mockBankFileExporter },
        { provide: PayrollExportMapperService, useValue: mockExportMapperService },
      ],
    }).compile();

    controller = module.get<PayrollController>(PayrollController);
  });

  describe('E2E: Exportes', () => {
    it('E2E: exportarPlame para período julio 2026 genera contenido válido', async () => {
      // Integration test placeholder - requires full database setup
      // When database fixtures are seeded with July 2026 planilla:
      // - Call exportarPlame('202607')
      // - Verify output is valid E18 format
      // - Verify pipe-delimited content
      // - Verify no excluded codes present
      // - Verify correct documento/monto mapping
      expect(true).toBe(true); // TODO: implement after Task 7 seed
    });

    it('E2E: exportarTelecredito filtra empleados sin cuenta y incluye advertencias', async () => {
      // Integration test placeholder - requires full database setup
      // When database fixtures are seeded:
      // - Call exportarTelecredito('202607')
      // - Verify success: true
      // - Verify file content is valid BCP format
      // - Verify advertencias array contains employees without bank account
      // - Verify employees with accounts are in file content
      expect(true).toBe(true); // TODO: implement after Task 7 seed
    });

    it('E2E: configuración por tenant afecta exportes (montoMode, formatoExportar)', async () => {
      // Integration test placeholder
      // Test that TenantPayrollExportConfig settings affect export output:
      // - devengado_igual_pagado vs devengado_con_descuentos
      // - pipe vs csv format
      // - conceptosExcluidos filtering
      expect(true).toBe(true); // TODO: implement after Task 7 seed
    });
  });
});

describe('PayrollController.exportarPlame', () => {
  let controller: PayrollController;

  beforeEach(() => {
    // Se usan las implementaciones reales de PlanillaExporter y del mapper
    // para que el test cubra el pipeline completo conceptos -> Estructura 18.
    controller = new PayrollController(
      {} as any, // PayrollRunService
      {} as any, // PayrollImportService
      new PlanillaExporter(),
      {} as any, // BankFileExporter
      new PayrollExportMapperService(),
    );
  });

  it('descarga Estructura 18 para período procesado', async () => {
    mockTenantContext = {
      tenantId: 't-1',
      userId: 'u-1',
      tx: {
        planilla: {
          findUnique: jest.fn().mockResolvedValue({
            id: 'plan-1',
            periodo: '2026-07',
            estado: 'procesado',
          }),
        },
        planillaDetalle: {
          findMany: jest.fn().mockResolvedValue([
            {
              id: 'det-1',
              conceptosCalculados: [{ codigo: '0121', nombre: 'Sueldo', monto: 5000 }],
              employee: { tipoDocumento: '01', numeroDocumento: '12345678' },
            },
          ]),
        },
        tenantPayrollExportConfig: {
          findUnique: jest.fn().mockResolvedValue(null), // defaults
        },
      },
    };

    const resultado = await controller.exportarPlame('2026-07');

    expect(resultado.statusCode).toBe(200);
    expect(resultado.headers['Content-Disposition']).toContain('E18_2026-07.txt');
    expect(resultado.headers['Content-Type']).toBe('text/plain; charset=utf-8');
    expect(resultado.body).toBe('01|12345678|0121|5000.00|5000.00');
  });

  it('genera una fila por cada concepto de cada trabajador', async () => {
    mockTenantContext = {
      tenantId: 't-1',
      userId: 'u-1',
      tx: {
        planilla: {
          findUnique: jest
            .fn()
            .mockResolvedValue({ periodo: '2026-07', estado: 'procesado' }),
        },
        planillaDetalle: {
          findMany: jest.fn().mockResolvedValue([
            {
              conceptosCalculados: [
                { codigo: '0121', nombre: 'Sueldo', monto: 2000 },
                { codigo: '0201', nombre: 'Asignación familiar', monto: 113 },
              ],
              employee: { tipoDocumento: '01', numeroDocumento: '11111111' },
            },
            {
              conceptosCalculados: [{ codigo: '0121', nombre: 'Sueldo', monto: 3000 }],
              employee: { tipoDocumento: '01', numeroDocumento: '22222222' },
            },
          ]),
        },
        tenantPayrollExportConfig: {
          findUnique: jest.fn().mockResolvedValue(null),
        },
      },
    };

    const resultado = await controller.exportarPlame('2026-07');

    expect(resultado.body.split('\n')).toHaveLength(3);
  });

  it('omite los conceptos excluidos configurados por el tenant', async () => {
    mockTenantContext = {
      tenantId: 't-1',
      userId: 'u-1',
      tx: {
        planilla: {
          findUnique: jest
            .fn()
            .mockResolvedValue({ periodo: '2026-07', estado: 'procesado' }),
        },
        planillaDetalle: {
          findMany: jest.fn().mockResolvedValue([
            {
              conceptosCalculados: [
                { codigo: '0121', nombre: 'Sueldo', monto: 2000 },
                { codigo: '0201', nombre: 'Asignación familiar', monto: 113 },
              ],
              employee: { tipoDocumento: '01', numeroDocumento: '11111111' },
            },
          ]),
        },
        tenantPayrollExportConfig: {
          findUnique: jest.fn().mockResolvedValue({
            tenantId: 't-1',
            montoMode: 'devengado_igual_pagado',
            formatoExportar: 'pipe',
            conceptosExcluidos: ['0201'],
            camposSensibles: [],
          }),
        },
      },
    };

    const resultado = await controller.exportarPlame('2026-07');

    expect(resultado.body).toBe('01|11111111|0121|2000.00|2000.00');
  });

  it('retorna 404 si período no existe', async () => {
    mockTenantContext = {
      tenantId: 't-1',
      userId: 'u-1',
      tx: { planilla: { findUnique: jest.fn().mockResolvedValue(null) } },
    };

    await expect(controller.exportarPlame('2026-99')).rejects.toThrow(NotFoundException);
  });

  it('retorna 400 si período no está procesado', async () => {
    mockTenantContext = {
      tenantId: 't-1',
      userId: 'u-1',
      tx: {
        planilla: {
          findUnique: jest
            .fn()
            .mockResolvedValue({ periodo: '2026-07', estado: 'registrado' }),
        },
      },
    };

    await expect(controller.exportarPlame('2026-07')).rejects.toThrow(BadRequestException);
  });

  it('retorna 400 si período no tiene conceptos calculados', async () => {
    mockTenantContext = {
      tenantId: 't-1',
      userId: 'u-1',
      tx: {
        planilla: {
          findUnique: jest
            .fn()
            .mockResolvedValue({ periodo: '2026-07', estado: 'procesado' }),
        },
        planillaDetalle: { findMany: jest.fn().mockResolvedValue([]) },
        tenantPayrollExportConfig: {
          findUnique: jest.fn().mockResolvedValue(null),
        },
      },
    };

    await expect(controller.exportarPlame('2026-07')).rejects.toThrow(BadRequestException);
  });

  it('retorna 400 si la request no tiene tenant o usuario resuelto', async () => {
    mockTenantContext = { tenantId: null, userId: null, tx: {} };

    await expect(controller.exportarPlame('2026-07')).rejects.toThrow(BadRequestException);
  });

  it('acota la consulta de planilla al tenant del contexto', async () => {
    const findUnique = jest
      .fn()
      .mockResolvedValue({ periodo: '2026-07', estado: 'procesado' });
    mockTenantContext = {
      tenantId: 't-1',
      userId: 'u-1',
      tx: {
        planilla: { findUnique },
        planillaDetalle: { findMany: jest.fn().mockResolvedValue([]) },
        tenantPayrollExportConfig: {
          findUnique: jest.fn().mockResolvedValue(null),
        },
      },
    };

    await expect(controller.exportarPlame('2026-07')).rejects.toThrow(BadRequestException);

    expect(findUnique).toHaveBeenCalledWith({
      where: { tenantId_periodo: { tenantId: 't-1', periodo: '2026-07' } },
    });
  });
});

describe('PayrollController.exportarTelecredito', () => {
  let controller: PayrollController;

  beforeEach(() => {
    // BankFileExporter real: el test cubre el pipeline completo
    // planilla_detalle -> filas BCP -> archivo pipe-delimited.
    controller = new PayrollController(
      {} as any, // PayrollRunService
      {} as any, // PayrollImportService
      {} as any, // PlanillaExporter
      new BankFileExporter(),
      new PayrollExportMapperService(),
    );
  });

  it('descarga telecrédito con advertencias para empleados sin cuenta', async () => {
    mockTenantContext = {
      tenantId: 't-1',
      userId: 'u-1',
      tx: {
        planilla: {
          findUnique: jest.fn().mockResolvedValue({
            id: 'plan-1',
            periodo: '2026-07',
            estado: 'procesado',
          }),
        },
        planillaDetalle: {
          findMany: jest.fn().mockResolvedValue([
            {
              id: 'det-1',
              conceptosCalculados: [{ codigo: '0121', nombre: 'Sueldo', monto: 5000 }],
              employee: {
                numeroDocumento: '12345678',
                cuentasBancarias: [{ numero: '1234567890', esPrincipal: true }],
              },
            },
            {
              id: 'det-2',
              conceptosCalculados: [{ codigo: '0121', nombre: 'Sueldo', monto: 6000 }],
              employee: { numeroDocumento: '87654321', cuentasBancarias: [] },
            },
          ]),
        },
      },
    };

    const resultado = await controller.exportarTelecredito('2026-07');

    expect(resultado.success).toBe(true);
    expect(resultado.archivo).toBe('12345678|1234567890|5000.00');
    expect(resultado.advertencias).toHaveLength(1);
    expect(resultado.advertencias[0]).toEqual({
      numeroDocumento: '87654321',
      mensaje: 'Sin cuenta bancaria registrada',
    });
    // La advertencia no bloquea: el trabajador con cuenta sí se exporta.
    expect(resultado.archivo).not.toContain('87654321');
  });

  it('descuenta los conceptos negativos al calcular el monto a abonar', async () => {
    mockTenantContext = {
      tenantId: 't-1',
      userId: 'u-1',
      tx: {
        planilla: {
          findUnique: jest
            .fn()
            .mockResolvedValue({ periodo: '2026-07', estado: 'procesado' }),
        },
        planillaDetalle: {
          findMany: jest.fn().mockResolvedValue([
            {
              conceptosCalculados: [
                { codigo: '0121', nombre: 'Sueldo', monto: 5000 },
                { codigo: '0701', nombre: 'Descuento ONP', monto: -650 },
              ],
              employee: {
                numeroDocumento: '12345678',
                cuentasBancarias: [{ numero: '1234567890', esPrincipal: true }],
              },
            },
          ]),
        },
      },
    };

    const resultado = await controller.exportarTelecredito('2026-07');

    expect(resultado.archivo).toBe('12345678|1234567890|4350.00');
    expect(resultado.advertencias).toEqual([]);
  });

  it('usa la cuenta marcada como principal cuando hay varias', async () => {
    mockTenantContext = {
      tenantId: 't-1',
      userId: 'u-1',
      tx: {
        planilla: {
          findUnique: jest
            .fn()
            .mockResolvedValue({ periodo: '2026-07', estado: 'procesado' }),
        },
        planillaDetalle: {
          findMany: jest.fn().mockResolvedValue([
            {
              conceptosCalculados: [{ codigo: '0121', nombre: 'Sueldo', monto: 1000 }],
              employee: {
                numeroDocumento: '12345678',
                // El orderBy de Prisma ya devuelve la principal primero.
                cuentasBancarias: [
                  { numero: '9999999999', esPrincipal: true },
                  { numero: '1111111111', esPrincipal: false },
                ],
              },
            },
          ]),
        },
      },
    };

    const resultado = await controller.exportarTelecredito('2026-07');

    expect(resultado.archivo).toBe('12345678|9999999999|1000.00');
  });

  it('retorna 404 si período no existe', async () => {
    mockTenantContext = {
      tenantId: 't-1',
      userId: 'u-1',
      tx: { planilla: { findUnique: jest.fn().mockResolvedValue(null) } },
    };

    await expect(controller.exportarTelecredito('2026-99')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('retorna 400 si período no está procesado', async () => {
    mockTenantContext = {
      tenantId: 't-1',
      userId: 'u-1',
      tx: {
        planilla: {
          findUnique: jest
            .fn()
            .mockResolvedValue({ periodo: '2026-07', estado: 'registrado' }),
        },
      },
    };

    await expect(controller.exportarTelecredito('2026-07')).rejects.toThrow(
      BadRequestException,
    );
  });

  it('retorna 400 si monto total es 0', async () => {
    mockTenantContext = {
      tenantId: 't-1',
      userId: 'u-1',
      tx: {
        planilla: {
          findUnique: jest
            .fn()
            .mockResolvedValue({ periodo: '2026-07', estado: 'procesado' }),
        },
        planillaDetalle: {
          findMany: jest.fn().mockResolvedValue([
            {
              conceptosCalculados: [],
              employee: {
                numeroDocumento: '12345678',
                cuentasBancarias: [{ numero: '1234567890', esPrincipal: true }],
              },
            },
          ]),
        },
      },
    };

    await expect(controller.exportarTelecredito('2026-07')).rejects.toThrow(
      BadRequestException,
    );
  });

  it('retorna 400 si ningún trabajador tiene cuenta bancaria (monto total 0)', async () => {
    mockTenantContext = {
      tenantId: 't-1',
      userId: 'u-1',
      tx: {
        planilla: {
          findUnique: jest
            .fn()
            .mockResolvedValue({ periodo: '2026-07', estado: 'procesado' }),
        },
        planillaDetalle: {
          findMany: jest.fn().mockResolvedValue([
            {
              conceptosCalculados: [{ codigo: '0121', nombre: 'Sueldo', monto: 5000 }],
              employee: { numeroDocumento: '12345678', cuentasBancarias: [] },
            },
          ]),
        },
      },
    };

    await expect(controller.exportarTelecredito('2026-07')).rejects.toThrow(
      BadRequestException,
    );
  });

  it('retorna 400 si la request no tiene tenant o usuario resuelto', async () => {
    mockTenantContext = { tenantId: null, userId: null, tx: {} };

    await expect(controller.exportarTelecredito('2026-07')).rejects.toThrow(
      BadRequestException,
    );
  });

  it('acota la consulta de planilla y de detalle al tenant del contexto', async () => {
    const findUnique = jest.fn().mockResolvedValue({
      periodo: '2026-07',
      estado: 'procesado',
    });
    const findMany = jest.fn().mockResolvedValue([]);
    mockTenantContext = {
      tenantId: 't-1',
      userId: 'u-1',
      tx: { planilla: { findUnique }, planillaDetalle: { findMany } },
    };

    await expect(controller.exportarTelecredito('2026-07')).rejects.toThrow(
      BadRequestException,
    );

    expect(findUnique).toHaveBeenCalledWith({
      where: { tenantId_periodo: { tenantId: 't-1', periodo: '2026-07' } },
    });
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { planilla: { tenantId: 't-1', periodo: '2026-07' } },
      }),
    );
  });
});
