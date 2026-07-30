import { Logger } from '@nestjs/common';
import { NotificationService } from './notification.service';

function mockPrisma(overrides: any = {}) {
  return {
    employee: {
      findMany: jest.fn().mockResolvedValue([
        { id: 'emp-1', user: { email: 'emp1@test.com' } },
        { id: 'emp-2', user: { email: 'emp2@test.com' } },
        { id: 'emp-3', user: { email: 'emp3@test.com' } },
      ]),
    },
    ...overrides,
  };
}

describe('NotificationService', () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('envía email a todos los empleados', async () => {
    const prisma = mockPrisma();
    const service = new NotificationService(prisma as any);
    const enviarEmailSpy = jest.spyOn(service as any, 'enviarEmail');

    await service.notificarPatronAplicado('t-1', ['emp-1', 'emp-2', 'emp-3'], 'Rotativo 4x3');

    expect(prisma.employee.findMany).toHaveBeenCalledWith({
      where: { id: { in: ['emp-1', 'emp-2', 'emp-3'] }, tenantId: 't-1' },
      select: { id: true, user: { select: { email: true } } },
    });
    expect(enviarEmailSpy).toHaveBeenCalledTimes(3);
    expect(enviarEmailSpy).toHaveBeenCalledWith(
      'emp1@test.com',
      'Actualización de plan de turnos',
      'Tu plan de turnos fue actualizado usando patrón: Rotativo 4x3',
    );
  });

  it('crea notificación in-app para cada empleado (no-op documentado, no lanza)', async () => {
    const prisma = mockPrisma();
    const service = new NotificationService(prisma as any);
    const crearNotifSpy = jest.spyOn(service as any, 'crearNotificacionInApp');

    await service.notificarPatronAplicado('t-1', ['emp-1', 'emp-2', 'emp-3'], 'Rotativo 4x3');

    expect(crearNotifSpy).toHaveBeenCalledTimes(3);
    expect(crearNotifSpy).toHaveBeenCalledWith('t-1', 'emp-1', expect.stringContaining('Rotativo 4x3'));
  });

  it('no lanza y solo loguea si un empleado no tiene usuario/email', async () => {
    const prisma = mockPrisma({
      employee: {
        findMany: jest.fn().mockResolvedValue([{ id: 'emp-1', user: null }]),
      },
    });
    const service = new NotificationService(prisma as any);

    await expect(
      service.notificarPatronAplicado('t-1', ['emp-1'], 'Rotativo 4x3'),
    ).resolves.toBeUndefined();
    expect(Logger.prototype.warn).toHaveBeenCalled();
  });

  it('no lanza y loguea error si falla la consulta a la base de datos', async () => {
    const prisma = mockPrisma({
      employee: {
        findMany: jest.fn().mockRejectedValue(new Error('DB caída')),
      },
    });
    const service = new NotificationService(prisma as any);

    await expect(
      service.notificarPatronAplicado('t-1', ['emp-1'], 'Rotativo 4x3'),
    ).resolves.toBeUndefined();
    expect(Logger.prototype.error).toHaveBeenCalled();
  });

  it('no hace nada si la lista de empleados está vacía', async () => {
    const prisma = mockPrisma();
    const service = new NotificationService(prisma as any);

    await service.notificarPatronAplicado('t-1', [], 'Rotativo 4x3');

    expect(prisma.employee.findMany).not.toHaveBeenCalled();
  });
});
