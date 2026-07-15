import { BadRequestException, ConflictException } from '@nestjs/common';
import { TerminationService, calcularFechaLimitePago } from './termination.service';

const CONTRATO = {
  id: 'c-1',
  regimenLaboral: 'general',
  tipoContrato: 'indeterminado',
  fechaInicio: new Date('2024-01-01'),
  fechaFin: null,
  jornada: { horasDia: 8 },
  remuneracionBasica: { toNumber: () => 3000 },
};

function mockTx(overrides: any = {}) {
  return {
    employee: {
      findUnique: jest.fn().mockResolvedValue({ id: 'emp-1', tenantId: 't-1', estado: 'activo' }),
      update: jest.fn(),
    },
    contrato: { findFirst: jest.fn().mockResolvedValue(CONTRATO) },
    regimenPensionario: {
      findFirst: jest.fn().mockResolvedValue({ sistema: 'onp', tipoComision: null }),
    },
    vacacionPeriodo: { findMany: jest.fn().mockResolvedValue([]), updateMany: jest.fn() },
    planillaNovedad: { findMany: jest.fn().mockResolvedValue([]) },
    horasExtra: { findMany: jest.fn().mockResolvedValue([]) },
    planillaDetalle: { findMany: jest.fn().mockResolvedValue([]) },
    cese: {
      findFirst: jest.fn().mockResolvedValue(null),
      findUnique: jest.fn(),
      create: jest.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 'cese-1', ...data })),
      update: jest.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 'cese-1', ...data })),
    },
    ...overrides,
  };
}

const normativeParams = { resolve: jest.fn().mockResolvedValue(undefined) } as any;

describe('TerminationService — crear y corregir', () => {
  let service: TerminationService;
  beforeEach(() => {
    service = new TerminationService(normativeParams);
    jest.clearAllMocks();
  });

  it('calcularFechaLimitePago: fecha de cese + 2 días calendario (48h, D.S. 001-97-TR)', () => {
    expect(calcularFechaLimitePago(new Date('2026-07-15')).toISOString().slice(0, 10)).toBe('2026-07-17');
  });

  it('crearCese: pre-llena el snapshot desde contrato y régimen pensionario', async () => {
    const tx = mockTx();
    const cese = await service.crearCese(tx, {
      tenantId: 't-1',
      employeeId: 'emp-1',
      fechaCese: new Date('2026-07-15'),
      motivo: 'RENUNCIA',
      creadoPor: 'user-1',
    });
    const snapshot = cese.inputSnapshot;
    expect(snapshot.regimen).toBe('general');
    expect(snapshot.remuneracionComputable).toBe(3000);
    expect(snapshot.sistemaPensionario).toBe('onp');
    // Cese 2026-07-15: último depósito CTS = mayo 2026 (cubre desde 1-may):
    // 2 meses completos (may, jun) + 14 días
    expect(snapshot.cts.mesesCompletosDesdeUltimoDeposito).toBe(2);
    expect(snapshot.cts.diasAdicionales).toBe(14);
    // Semestre grati jul-dic: 0 meses calendario completos al 15-jul
    expect(snapshot.gratificacionTrunca.mesesCompletos).toBe(0);
    // Pendiente: sueldo prorrateado 15/30 = 1500
    expect(snapshot.remuneracionesPendientes[0].monto).toBe(1500);
    expect(tx.cese.create).toHaveBeenCalled();
  });

  it('crearCese: rechaza empleado con cese vigente (409)', async () => {
    const tx = mockTx();
    tx.cese.findFirst.mockResolvedValue({ id: 'previo', estado: 'BORRADOR' });
    await expect(
      service.crearCese(tx, {
        tenantId: 't-1',
        employeeId: 'emp-1',
        fechaCese: new Date('2026-07-15'),
        motivo: 'RENUNCIA',
        creadoPor: 'user-1',
      }),
    ).rejects.toThrow(ConflictException);
  });

  it('crearCese: rechaza fechaCese anterior al inicio del contrato', async () => {
    const tx = mockTx();
    await expect(
      service.crearCese(tx, {
        tenantId: 't-1',
        employeeId: 'emp-1',
        fechaCese: new Date('2023-12-31'),
        motivo: 'RENUNCIA',
        creadoPor: 'user-1',
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('crearCese: TERMINO_CONTRATO exige contrato con fechaFin', async () => {
    const tx = mockTx();
    await expect(
      service.crearCese(tx, {
        tenantId: 't-1',
        employeeId: 'emp-1',
        fechaCese: new Date('2026-07-15'),
        motivo: 'TERMINO_CONTRATO',
        creadoPor: 'user-1',
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('actualizarDatos: mergea el snapshot y regresa el cese a BORRADOR', async () => {
    const tx = mockTx();
    tx.cese.findUnique.mockResolvedValue({
      id: 'cese-1',
      estado: 'CALCULADA',
      inputSnapshot: { regimen: 'general', remuneracionComputable: 3000 },
    });
    await service.actualizarDatos(tx, 'cese-1', { remuneracionComputable: 3200 });
    expect(tx.cese.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          estado: 'BORRADOR',
          inputSnapshot: expect.objectContaining({ remuneracionComputable: 3200 }),
        }),
      }),
    );
  });

  it('actualizarDatos: rechaza si el cese está APROBADA o posterior', async () => {
    const tx = mockTx();
    tx.cese.findUnique.mockResolvedValue({ id: 'cese-1', estado: 'APROBADA', inputSnapshot: {} });
    await expect(service.actualizarDatos(tx, 'cese-1', {})).rejects.toThrow(ConflictException);
  });
});
