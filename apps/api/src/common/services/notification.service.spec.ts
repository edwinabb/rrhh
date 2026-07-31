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

  // ========== Tests para notificarSolicitudAprobada ==========

  it('notificarSolicitudAprobada: envía email a empleado con fechaNueva y nombreTurno', async () => {
    const prisma = mockPrisma({
      employee: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'emp-1',
          user: { email: 'emp1@test.com' },
        }),
      },
    });
    const service = new NotificationService(prisma as any);
    const enviarEmailSpy = jest.spyOn(service as any, 'enviarEmail');

    const fechaNueva = new Date('2026-08-15');
    await service.notificarSolicitudAprobada('t-1', 'emp-1', fechaNueva, 'Turno Mañana');

    expect(prisma.employee.findUnique).toHaveBeenCalledWith({
      where: { id: 'emp-1' },
      select: { id: true, user: { select: { email: true } } },
    });
    expect(enviarEmailSpy).toHaveBeenCalledWith(
      'emp1@test.com',
      'Solicitud de cambio de turno aprobada',
      expect.stringContaining(fechaNueva.toDateString()),
    );
    expect(enviarEmailSpy).toHaveBeenCalledWith(
      'emp1@test.com',
      'Solicitud de cambio de turno aprobada',
      expect.stringContaining('Turno Mañana'),
    );
  });

  it('notificarSolicitudAprobada: envía email sin nombreTurno si no se proporciona', async () => {
    const prisma = mockPrisma({
      employee: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'emp-1',
          user: { email: 'emp1@test.com' },
        }),
      },
    });
    const service = new NotificationService(prisma as any);
    const enviarEmailSpy = jest.spyOn(service as any, 'enviarEmail');

    const fechaNueva = new Date('2026-08-15');
    await service.notificarSolicitudAprobada('t-1', 'emp-1', fechaNueva, null);

    expect(enviarEmailSpy).toHaveBeenCalledWith(
      'emp1@test.com',
      'Solicitud de cambio de turno aprobada',
      expect.not.stringContaining('('),
    );
  });

  it('notificarSolicitudAprobada: crea notificación in-app', async () => {
    const prisma = mockPrisma({
      employee: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'emp-1',
          user: { email: 'emp1@test.com' },
        }),
      },
    });
    const service = new NotificationService(prisma as any);
    const crearNotifSpy = jest.spyOn(service as any, 'crearNotificacionInApp');

    const fechaNueva = new Date('2026-08-15');
    await service.notificarSolicitudAprobada('t-1', 'emp-1', fechaNueva, 'Turno Noche');

    expect(crearNotifSpy).toHaveBeenCalledWith('t-1', 'emp-1', expect.stringContaining('aprobada'));
  });

  it('notificarSolicitudAprobada: no lanza si empleado no tiene usuario/email', async () => {
    const prisma = mockPrisma({
      employee: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'emp-1',
          user: null,
        }),
      },
    });
    const service = new NotificationService(prisma as any);

    await expect(
      service.notificarSolicitudAprobada('t-1', 'emp-1', new Date('2026-08-15'), 'Turno Mañana'),
    ).resolves.toBeUndefined();
    expect(Logger.prototype.warn).toHaveBeenCalled();
  });

  it('notificarSolicitudAprobada: no lanza si falla la consulta a la BD', async () => {
    const prisma = mockPrisma({
      employee: {
        findUnique: jest.fn().mockRejectedValue(new Error('BD caída')),
      },
    });
    const service = new NotificationService(prisma as any);

    await expect(
      service.notificarSolicitudAprobada('t-1', 'emp-1', new Date('2026-08-15'), 'Turno Mañana'),
    ).resolves.toBeUndefined();
    expect(Logger.prototype.error).toHaveBeenCalled();
  });

  // ========== Tests para notificarSolicitudRechazada ==========

  it('notificarSolicitudRechazada: envía email al empleado', async () => {
    const prisma = mockPrisma({
      employee: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'emp-1',
          user: { email: 'emp1@test.com' },
        }),
      },
    });
    const service = new NotificationService(prisma as any);
    const enviarEmailSpy = jest.spyOn(service as any, 'enviarEmail');

    await service.notificarSolicitudRechazada('t-1', 'emp-1', 'Conflicto de turno');

    expect(enviarEmailSpy).toHaveBeenCalledWith(
      'emp1@test.com',
      'Solicitud de cambio de turno rechazada',
      'Tu solicitud de cambio de turno fue rechazada',
    );
  });

  it('notificarSolicitudRechazada: crea notificación in-app', async () => {
    const prisma = mockPrisma({
      employee: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'emp-1',
          user: { email: 'emp1@test.com' },
        }),
      },
    });
    const service = new NotificationService(prisma as any);
    const crearNotifSpy = jest.spyOn(service as any, 'crearNotificacionInApp');

    await service.notificarSolicitudRechazada('t-1', 'emp-1', 'Conflicto de turno');

    expect(crearNotifSpy).toHaveBeenCalledWith('t-1', 'emp-1', expect.stringContaining('rechazada'));
  });

  it('notificarSolicitudRechazada: loguea el motivoRechazo internamente (no en mensaje a empleado)', async () => {
    const prisma = mockPrisma({
      employee: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'emp-1',
          user: { email: 'emp1@test.com' },
        }),
      },
    });
    const service = new NotificationService(prisma as any);
    const logSpy = jest.spyOn(Logger.prototype, 'log');

    await service.notificarSolicitudRechazada('t-1', 'emp-1', 'Conflicto de turno');

    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('Conflicto de turno'),
    );
  });

  it('notificarSolicitudRechazada: no lanza si empleado no tiene usuario/email', async () => {
    const prisma = mockPrisma({
      employee: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'emp-1',
          user: null,
        }),
      },
    });
    const service = new NotificationService(prisma as any);

    await expect(
      service.notificarSolicitudRechazada('t-1', 'emp-1', 'Conflicto de turno'),
    ).resolves.toBeUndefined();
    expect(Logger.prototype.warn).toHaveBeenCalled();
  });

  it('notificarSolicitudRechazada: no lanza si falla la consulta a la BD', async () => {
    const prisma = mockPrisma({
      employee: {
        findUnique: jest.fn().mockRejectedValue(new Error('BD caída')),
      },
    });
    const service = new NotificationService(prisma as any);

    await expect(
      service.notificarSolicitudRechazada('t-1', 'emp-1', 'Conflicto de turno'),
    ).resolves.toBeUndefined();
    expect(Logger.prototype.error).toHaveBeenCalled();
  });

  it('notificarSolicitudRechazada: no incluye motivoRechazo en el mensaje al empleado (solo internamente)', async () => {
    const prisma = mockPrisma({
      employee: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'emp-1',
          user: { email: 'emp1@test.com' },
        }),
      },
    });
    const service = new NotificationService(prisma as any);
    const enviarEmailSpy = jest.spyOn(service as any, 'enviarEmail');

    await service.notificarSolicitudRechazada('t-1', 'emp-1', 'Motivo interno confidencial');

    // El mensaje enviado al empleado NO debe contener el motivo
    expect(enviarEmailSpy).toHaveBeenCalled();
    const callArgs = enviarEmailSpy.mock.calls[0];
    expect(callArgs).toBeDefined();
    if (callArgs) {
      expect(callArgs[2]).not.toContain('Motivo interno confidencial');
      expect(callArgs[2]).toContain('rechazada');
    }
  });
});
