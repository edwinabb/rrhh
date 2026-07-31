import { BadRequestException } from '@nestjs/common';
import { RotacionAplicadorService } from './rotacion-aplicador.service';

function mockTx(overrides: any = {}) {
  return {
    rotacionPatron: { findUnique: jest.fn().mockResolvedValue(null) },
    employee: { findMany: jest.fn().mockResolvedValue([]), findUnique: jest.fn().mockResolvedValue({ id: 'emp-1', estado: 'activo' }) },
    turno: {
      findUnique: jest.fn().mockImplementation(({ where }: any) =>
        Promise.resolve({ id: `turno-${where.tenantId_codigo.codigo}`, codigo: where.tenantId_codigo.codigo })
      ),
    },
    turnoAsignacion: { findMany: jest.fn().mockResolvedValue([]) },
    ...overrides,
  };
}

const service = new RotacionAplicadorService(
  { upsertAsignacion: jest.fn() } as any, // ShiftPlanService mock
  { notificarPatronAplicado: jest.fn().mockResolvedValue(undefined) } as any // NotificationService mock
);

describe('RotacionAplicadorService', () => {
  it('aplica patrón a 3 empleados durante 30 días', async () => {
    const tx = mockTx();
    tx.rotacionPatron.findUnique.mockResolvedValue({
      id: 'pat-1', secuencia: JSON.stringify(['DIA', 'DIA', 'NOCHE', 'NOCHE', 'DESC', 'DESC', 'DESC'])
    });
    tx.employee.findMany.mockResolvedValue([
      { id: 'emp-1' }, { id: 'emp-2' }, { id: 'emp-3' }
    ]);

    const resultado = await service.aplicarPatron(tx, {
      tenantId: 't-1',
      patronId: 'pat-1',
      employeeIds: ['emp-1', 'emp-2', 'emp-3'],
      desde: new Date(2026, 7, 1),
      hasta: new Date(2026, 7, 31),
      diaInicioCiclo: new Date(2026, 7, 4), // Lunes
      creadoPor: 'u-1',
    });

    expect(resultado.procesadas).toBeGreaterThan(0);
  });

  it('rechaza patrón inexistente', async () => {
    const tx = mockTx();
    await expect(
      service.aplicarPatron(tx, {
        tenantId: 't-1', patronId: 'pat-999', employeeIds: ['emp-1'],
        desde: new Date(2026, 7, 1), hasta: new Date(2026, 7, 31),
        diaInicioCiclo: new Date(2026, 7, 4), creadoPor: 'u-1'
      })
    ).rejects.toThrow('Patrón no encontrado');
  });

  it('rechaza fechas en el pasado', async () => {
    const tx = mockTx();
    tx.rotacionPatron.findUnique.mockResolvedValue({
      id: 'pat-1', secuencia: JSON.stringify(['DIA', 'DIA', 'NOCHE', 'NOCHE', 'DESC', 'DESC', 'DESC'])
    });

    await expect(
      service.aplicarPatron(tx, {
        tenantId: 't-1',
        patronId: 'pat-1',
        employeeIds: ['emp-1'],
        desde: new Date(2020, 0, 1), // Past date
        hasta: new Date(2020, 0, 31),
        diaInicioCiclo: new Date(2020, 0, 4),
        creadoPor: 'u-1',
      })
    ).rejects.toThrow(BadRequestException);
  });
});
