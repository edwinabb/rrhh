import { BadRequestException, UnprocessableEntityException } from '@nestjs/common';
import { CompensatorioService } from './compensatorio.service';

function mockTx(overrides: any = {}) {
  return {
    compensatorioMovimiento: {
      aggregate: jest.fn().mockResolvedValue({ _sum: { dias: 2 } }),
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 'mov-1', ...data })),
    },
    turnoAsignacion: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    employee: { findUnique: jest.fn().mockResolvedValue({ id: 'emp-1', numeroDocumento: '1' }) },
    marcacion: { findFirst: jest.fn().mockResolvedValue(null) },
    ...overrides,
  };
}

const service = new CompensatorioService();

describe('CompensatorioService — movimientos y saldo', () => {
  it('obtenerSaldo suma los días del libro', async () => {
    expect(await service.obtenerSaldo(mockTx(), 'emp-1')).toBe(2);
  });

  it('AJUSTE_INICIAL exige motivo', async () => {
    await expect(
      service.registrarMovimiento(mockTx(), {
        tenantId: 't-1', employeeId: 'emp-1', tipo: 'AJUSTE_INICIAL', dias: 3,
        fechaReferencia: new Date(2026, 7, 1), creadoPor: 'u-1',
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('GANADO debe ser positivo', async () => {
    await expect(
      service.registrarMovimiento(mockTx(), {
        tenantId: 't-1', employeeId: 'emp-1', tipo: 'GANADO', dias: -1,
        fechaReferencia: new Date(2026, 7, 1), creadoPor: 'u-1',
      }),
    ).rejects.toThrow(BadRequestException);
  });
});

describe('CompensatorioService — intercambio', () => {
  it('intercambia las asignaciones de A y B en la fecha (neutro para saldos)', async () => {
    const tx = mockTx();
    tx.turnoAsignacion.findUnique
      .mockResolvedValueOnce({ id: 'asig-a', tipoDia: 'DESCANSO', turnoId: null })
      .mockResolvedValueOnce({ id: 'asig-b', tipoDia: 'TURNO', turnoId: 'turno-noche' });
    await service.intercambiar(tx, {
      tenantId: 't-1', fecha: new Date(2026, 7, 10),
      employeeIdA: 'emp-a', employeeIdB: 'emp-b', creadoPor: 'u-1',
    });
    expect(tx.turnoAsignacion.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'asig-a' }, data: expect.objectContaining({ tipoDia: 'TURNO', turnoId: 'turno-noche' }) }),
    );
    expect(tx.turnoAsignacion.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'asig-b' }, data: expect.objectContaining({ tipoDia: 'DESCANSO', turnoId: null }) }),
    );
    expect(tx.compensatorioMovimiento.create).not.toHaveBeenCalled();
  });

  it('rechaza el intercambio si alguno no tiene asignación ese día (422)', async () => {
    const tx = mockTx();
    tx.turnoAsignacion.findUnique.mockResolvedValue(null);
    await expect(
      service.intercambiar(tx, {
        tenantId: 't-1', fecha: new Date(2026, 7, 10),
        employeeIdA: 'emp-a', employeeIdB: 'emp-b', creadoPor: 'u-1',
      }),
    ).rejects.toThrow(UnprocessableEntityException);
  });
});
