import { BadRequestException, UnprocessableEntityException } from '@nestjs/common';
import { ShiftPlanService } from './shift-plan.service';

function mockTx(overrides: any = {}) {
  return {
    turno: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue(null),
      findUnique: jest.fn().mockResolvedValue({ id: 'turno-1', activo: true }),
      create: jest.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 'turno-1', ...data })),
      update: jest.fn(),
    },
    employee: { findUnique: jest.fn().mockResolvedValue({ id: 'emp-1', estado: 'activo' }) },
    turnoAsignacion: {
      findUnique: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
      upsert: jest.fn().mockImplementation(({ create }: any) => Promise.resolve({ id: 'asig-1', ...create })),
    },
    compensatorioMovimiento: {
      aggregate: jest.fn().mockResolvedValue({ _sum: { dias: 0 } }),
      create: jest.fn(),
    },
    ...overrides,
  };
}

const service = new ShiftPlanService();

describe('ShiftPlanService — catálogo', () => {
  it('crearTurno valida formato HH:mm y horas > 0', async () => {
    const tx = mockTx();
    await expect(
      service.crearTurno(tx, { tenantId: 't-1', codigo: 'X', nombre: 'X', horaInicio: '25:00', horaFin: '08:00', horasEsperadas: 12 }),
    ).rejects.toThrow(BadRequestException);
    await expect(
      service.crearTurno(tx, { tenantId: 't-1', codigo: 'X', nombre: 'X', horaInicio: '08:00', horaFin: '20:00', horasEsperadas: 0 }),
    ).rejects.toThrow(BadRequestException);
  });

  it('crearTurno rechaza código duplicado (409)', async () => {
    const tx = mockTx();
    tx.turno.findFirst.mockResolvedValue({ id: 'ya-existe' });
    await expect(
      service.crearTurno(tx, { tenantId: 't-1', codigo: 'DIA', nombre: 'Día', horaInicio: '08:00', horaFin: '20:00', horasEsperadas: 12 }),
    ).rejects.toThrow('Ya existe un turno con código "DIA"');
  });
});

describe('ShiftPlanService — plan', () => {
  it('upsert TURNO exige turno existente y activo', async () => {
    const tx = mockTx();
    tx.turno.findUnique.mockResolvedValue({ id: 'turno-1', activo: false });
    await expect(
      service.upsertAsignacion(tx, { tenantId: 't-1', employeeId: 'emp-1', fecha: new Date(2026, 7, 1), tipoDia: 'TURNO', turnoId: 'turno-1', creadoPor: 'u-1' }),
    ).rejects.toThrow(BadRequestException);
  });

  it('rechaza asignar a empleado cesado', async () => {
    const tx = mockTx();
    tx.employee.findUnique.mockResolvedValue({ id: 'emp-1', estado: 'cesado' });
    await expect(
      service.upsertAsignacion(tx, { tenantId: 't-1', employeeId: 'emp-1', fecha: new Date(2026, 7, 1), tipoDia: 'DESCANSO', creadoPor: 'u-1' }),
    ).rejects.toThrow(BadRequestException);
  });

  it('DESCANSO_COMPENSATORIO con saldo > 0 registra GOZADO −1 vinculado', async () => {
    const tx = mockTx();
    tx.compensatorioMovimiento.aggregate.mockResolvedValue({ _sum: { dias: 2 } });
    await service.upsertAsignacion(tx, { tenantId: 't-1', employeeId: 'emp-1', fecha: new Date(2026, 7, 5), tipoDia: 'DESCANSO_COMPENSATORIO', creadoPor: 'u-1' });
    expect(tx.compensatorioMovimiento.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ tipo: 'GOZADO', dias: -1, turnoAsignacionId: 'asig-1' }),
      }),
    );
  });

  it('DESCANSO_COMPENSATORIO sin saldo → 422; con forzarSinSaldo + notas pasa', async () => {
    const tx = mockTx();
    await expect(
      service.upsertAsignacion(tx, { tenantId: 't-1', employeeId: 'emp-1', fecha: new Date(2026, 7, 5), tipoDia: 'DESCANSO_COMPENSATORIO', creadoPor: 'u-1' }),
    ).rejects.toThrow(UnprocessableEntityException);

    await service.upsertAsignacion(tx, { tenantId: 't-1', employeeId: 'emp-1', fecha: new Date(2026, 7, 5), tipoDia: 'DESCANSO_COMPENSATORIO', creadoPor: 'u-1', forzarSinSaldo: true, notas: 'autorizado por gerencia' });
    expect(tx.compensatorioMovimiento.create).toHaveBeenCalled();
  });

  it('cambiar un COMPENSATORIO previo a otro tipo registra la reversión (+1)', async () => {
    const tx = mockTx();
    tx.turnoAsignacion.findUnique.mockResolvedValue({ id: 'asig-1', tipoDia: 'DESCANSO_COMPENSATORIO' });
    await service.upsertAsignacion(tx, { tenantId: 't-1', employeeId: 'emp-1', fecha: new Date(2026, 7, 5), tipoDia: 'DESCANSO', creadoPor: 'u-1' });
    expect(tx.compensatorioMovimiento.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ tipo: 'GOZADO', dias: 1 }),
      }),
    );
  });
});
