import { BadRequestException } from '@nestjs/common';
import { VacationsService } from './vacations.service';

function mockTx(overrides: any = {}) {
  return {
    employee: { findUnique: jest.fn().mockResolvedValue({ id: 'emp-1', tenantId: 't-1' }) },
    contrato: {
      findFirst: jest.fn().mockResolvedValue({
        regimenLaboral: 'general',
        fechaInicio: new Date('2025-03-01'),
      }),
    },
    vacacionPeriodo: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue(null),
      findUnique: jest.fn(),
      create: jest.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 'vp-1', ...data })),
      update: jest.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 'vp-1', ...data })),
    },
    ...overrides,
  };
}

const normativeParams = {
  resolve: jest.fn((client: any, codigo: string) => {
    const valores: Record<string, unknown> = { VACACIONES_DIAS_GENERAL: 30, VACACIONES_DIAS_MYPE: 15 };
    return Promise.resolve(valores[codigo]);
  }),
} as any;

describe('VacationsService', () => {
  let service: VacationsService;
  beforeEach(() => {
    service = new VacationsService(normativeParams);
    jest.clearAllMocks();
  });

  it('crearPeriodo: periodoFin = inicio + 1 año − 1 día; diasGanados según régimen (general=30)', async () => {
    const tx = mockTx();
    const r = await service.crearPeriodo(tx, {
      tenantId: 't-1',
      employeeId: 'emp-1',
      periodoInicio: new Date('2026-03-01'),
    });
    expect(tx.vacacionPeriodo.create).toHaveBeenCalled();
    expect(r.diasGanados).toBe(30);
    expect(new Date(r.periodoFin).toISOString().slice(0, 10)).toBe('2027-02-28');
  });

  it('crearPeriodo: MYPE genera 15 días', async () => {
    const tx = mockTx({
      contrato: {
        findFirst: jest.fn().mockResolvedValue({
          regimenLaboral: 'mype_pequena',
          fechaInicio: new Date('2025-03-01'),
        }),
      },
    });
    const r = await service.crearPeriodo(tx, {
      tenantId: 't-1',
      employeeId: 'emp-1',
      periodoInicio: new Date('2026-03-01'),
    });
    expect(r.diasGanados).toBe(15);
  });

  it('actualizarPeriodo: rechaza diasGozados > diasGanados', async () => {
    const tx = mockTx();
    tx.vacacionPeriodo.findUnique.mockResolvedValue({ id: 'vp-1', diasGanados: 30, estado: 'EN_CURSO' });
    await expect(
      service.actualizarPeriodo(tx, 'vp-1', { diasGozados: 31 }),
    ).rejects.toThrow(BadRequestException);
  });

  it('actualizarPeriodo: gozar todos los días marca el período GOZADO', async () => {
    const tx = mockTx();
    tx.vacacionPeriodo.findUnique.mockResolvedValue({ id: 'vp-1', diasGanados: 30, estado: 'VENCIDO_PENDIENTE' });
    await service.actualizarPeriodo(tx, 'vp-1', { diasGozados: 30 });
    expect(tx.vacacionPeriodo.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ estado: 'GOZADO' }) }),
    );
  });
});
