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

  // ========== Tests para notificarTrabajoAprobado ==========

  it('notificarTrabajoAprobado: envía email con la descripción de la tarea', async () => {
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

    await service.notificarTrabajoAprobado('t-1', 'emp-1', 'Reparar servidor de backups');

    expect(prisma.employee.findUnique).toHaveBeenCalledWith({
      where: { id: 'emp-1' },
      select: { id: true, user: { select: { email: true } } },
    });
    expect(enviarEmailSpy).toHaveBeenCalledWith(
      'emp1@test.com',
      'Trabajo adicional aprobado',
      expect.stringContaining('Reparar servidor de backups'),
    );
  });

  it('notificarTrabajoAprobado: crea notificación in-app', async () => {
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

    await service.notificarTrabajoAprobado('t-1', 'emp-1', 'Reparar servidor de backups');

    expect(crearNotifSpy).toHaveBeenCalledWith(
      't-1',
      'emp-1',
      expect.stringContaining('Reparar servidor de backups'),
    );
  });

  it('notificarTrabajoAprobado: no lanza si empleado no tiene usuario/email', async () => {
    const prisma = mockPrisma({
      employee: {
        findUnique: jest.fn().mockResolvedValue({ id: 'emp-1', user: null }),
      },
    });
    const service = new NotificationService(prisma as any);

    await expect(
      service.notificarTrabajoAprobado('t-1', 'emp-1', 'Reparar servidor de backups'),
    ).resolves.toBeUndefined();
    expect(Logger.prototype.warn).toHaveBeenCalled();
  });

  it('notificarTrabajoAprobado: no lanza si falla la consulta a la BD', async () => {
    const prisma = mockPrisma({
      employee: {
        findUnique: jest.fn().mockRejectedValue(new Error('BD caída')),
      },
    });
    const service = new NotificationService(prisma as any);

    await expect(
      service.notificarTrabajoAprobado('t-1', 'emp-1', 'Reparar servidor de backups'),
    ).resolves.toBeUndefined();
    expect(Logger.prototype.error).toHaveBeenCalled();
  });

  // ========== Tests para notificarTrabajoReasignado ==========

  it('notificarTrabajoReasignado: envía email con tarea, fecha y horas estimadas', async () => {
    const prisma = mockPrisma({
      employee: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'emp-2',
          user: { email: 'emp2@test.com' },
        }),
      },
    });
    const service = new NotificationService(prisma as any);
    const enviarEmailSpy = jest.spyOn(service as any, 'enviarEmail');

    const fechaEstimada = new Date('2026-08-20');
    await service.notificarTrabajoReasignado('t-1', 'emp-2', 'Migrar base de datos', fechaEstimada, 6);

    expect(enviarEmailSpy).toHaveBeenCalledWith(
      'emp2@test.com',
      'Trabajo adicional asignado',
      expect.stringContaining('Migrar base de datos'),
    );
    const callArgs = enviarEmailSpy.mock.calls[0];
    expect(callArgs?.[2]).toContain(fechaEstimada.toDateString());
    expect(callArgs?.[2]).toContain('6');
  });

  it('notificarTrabajoReasignado: crea notificación in-app', async () => {
    const prisma = mockPrisma({
      employee: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'emp-2',
          user: { email: 'emp2@test.com' },
        }),
      },
    });
    const service = new NotificationService(prisma as any);
    const crearNotifSpy = jest.spyOn(service as any, 'crearNotificacionInApp');

    await service.notificarTrabajoReasignado('t-1', 'emp-2', 'Migrar base de datos', new Date('2026-08-20'), 6);

    expect(crearNotifSpy).toHaveBeenCalledWith('t-1', 'emp-2', expect.stringContaining('Migrar base de datos'));
  });

  it('notificarTrabajoReasignado: no lanza si empleado no tiene usuario/email', async () => {
    const prisma = mockPrisma({
      employee: {
        findUnique: jest.fn().mockResolvedValue({ id: 'emp-2', user: null }),
      },
    });
    const service = new NotificationService(prisma as any);

    await expect(
      service.notificarTrabajoReasignado('t-1', 'emp-2', 'Migrar base de datos', new Date('2026-08-20'), 6),
    ).resolves.toBeUndefined();
    expect(Logger.prototype.warn).toHaveBeenCalled();
  });

  it('notificarTrabajoReasignado: no lanza si falla la consulta a la BD', async () => {
    const prisma = mockPrisma({
      employee: {
        findUnique: jest.fn().mockRejectedValue(new Error('BD caída')),
      },
    });
    const service = new NotificationService(prisma as any);

    await expect(
      service.notificarTrabajoReasignado('t-1', 'emp-2', 'Migrar base de datos', new Date('2026-08-20'), 6),
    ).resolves.toBeUndefined();
    expect(Logger.prototype.error).toHaveBeenCalled();
  });

  // ========== Tests para notificarTrabajoRechazado ==========

  it('notificarTrabajoRechazado: envía email al empleado', async () => {
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

    await service.notificarTrabajoRechazado('t-1', 'emp-1', 'Presupuesto insuficiente');

    expect(enviarEmailSpy).toHaveBeenCalledWith(
      'emp1@test.com',
      'Trabajo adicional rechazado',
      'Tu solicitud de trabajo adicional fue rechazada',
    );
  });

  it('notificarTrabajoRechazado: crea notificación in-app', async () => {
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

    await service.notificarTrabajoRechazado('t-1', 'emp-1', 'Presupuesto insuficiente');

    expect(crearNotifSpy).toHaveBeenCalledWith('t-1', 'emp-1', expect.stringContaining('rechazada'));
  });

  it('notificarTrabajoRechazado: loguea el motivoRechazo internamente (no en mensaje a empleado)', async () => {
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
    const enviarEmailSpy = jest.spyOn(service as any, 'enviarEmail');

    await service.notificarTrabajoRechazado('t-1', 'emp-1', 'Presupuesto insuficiente');

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Presupuesto insuficiente'));
    const callArgs = enviarEmailSpy.mock.calls[0];
    expect(callArgs?.[2]).not.toContain('Presupuesto insuficiente');
  });

  it('notificarTrabajoRechazado: no lanza si empleado no tiene usuario/email', async () => {
    const prisma = mockPrisma({
      employee: {
        findUnique: jest.fn().mockResolvedValue({ id: 'emp-1', user: null }),
      },
    });
    const service = new NotificationService(prisma as any);

    await expect(
      service.notificarTrabajoRechazado('t-1', 'emp-1', 'Presupuesto insuficiente'),
    ).resolves.toBeUndefined();
    expect(Logger.prototype.warn).toHaveBeenCalled();
  });

  it('notificarTrabajoRechazado: no lanza si falla la consulta a la BD', async () => {
    const prisma = mockPrisma({
      employee: {
        findUnique: jest.fn().mockRejectedValue(new Error('BD caída')),
      },
    });
    const service = new NotificationService(prisma as any);

    await expect(
      service.notificarTrabajoRechazado('t-1', 'emp-1', 'Presupuesto insuficiente'),
    ).resolves.toBeUndefined();
    expect(Logger.prototype.error).toHaveBeenCalled();
  });

  // ========== Tests para notificarReporteValidado ==========

  it('notificarReporteValidado: envía email con días compensatorios', async () => {
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

    await service.notificarReporteValidado('t-1', 'emp-1', 'Reparar servidor de backups', 2);

    expect(enviarEmailSpy).toHaveBeenCalledWith(
      'emp1@test.com',
      'Reporte de trabajo adicional validado',
      expect.stringContaining('2'),
    );
  });

  it('notificarReporteValidado: crea notificación in-app', async () => {
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

    await service.notificarReporteValidado('t-1', 'emp-1', 'Reparar servidor de backups', 2);

    expect(crearNotifSpy).toHaveBeenCalledWith('t-1', 'emp-1', expect.stringContaining('validado'));
  });

  it('notificarReporteValidado: no lanza si empleado no tiene usuario/email', async () => {
    const prisma = mockPrisma({
      employee: {
        findUnique: jest.fn().mockResolvedValue({ id: 'emp-1', user: null }),
      },
    });
    const service = new NotificationService(prisma as any);

    await expect(
      service.notificarReporteValidado('t-1', 'emp-1', 'Reparar servidor de backups', 2),
    ).resolves.toBeUndefined();
    expect(Logger.prototype.warn).toHaveBeenCalled();
  });

  it('notificarReporteValidado: no lanza si falla la consulta a la BD', async () => {
    const prisma = mockPrisma({
      employee: {
        findUnique: jest.fn().mockRejectedValue(new Error('BD caída')),
      },
    });
    const service = new NotificationService(prisma as any);

    await expect(
      service.notificarReporteValidado('t-1', 'emp-1', 'Reparar servidor de backups', 2),
    ).resolves.toBeUndefined();
    expect(Logger.prototype.error).toHaveBeenCalled();
  });

  // ========== Tests para notificarReportePedidoReentrega ==========

  it('notificarReportePedidoReentrega: envía email al empleado', async () => {
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

    await service.notificarReportePedidoReentrega('t-1', 'emp-1', 'Fotos ilegibles');

    expect(enviarEmailSpy).toHaveBeenCalledWith(
      'emp1@test.com',
      'Reporte de trabajo adicional rechazado',
      'Tu reporte fue rechazado y necesita reentrega. Por favor reenvía fotos y descripción.',
    );
  });

  it('notificarReportePedidoReentrega: crea notificación in-app', async () => {
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

    await service.notificarReportePedidoReentrega('t-1', 'emp-1', 'Fotos ilegibles');

    expect(crearNotifSpy).toHaveBeenCalledWith('t-1', 'emp-1', expect.stringContaining('reentrega'));
  });

  it('notificarReportePedidoReentrega: loguea el motivo internamente (no en mensaje a empleado)', async () => {
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
    const enviarEmailSpy = jest.spyOn(service as any, 'enviarEmail');

    await service.notificarReportePedidoReentrega('t-1', 'emp-1', 'Fotos ilegibles');

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Fotos ilegibles'));
    const callArgs = enviarEmailSpy.mock.calls[0];
    expect(callArgs?.[2]).not.toContain('Fotos ilegibles');
  });

  it('notificarReportePedidoReentrega: no lanza si empleado no tiene usuario/email', async () => {
    const prisma = mockPrisma({
      employee: {
        findUnique: jest.fn().mockResolvedValue({ id: 'emp-1', user: null }),
      },
    });
    const service = new NotificationService(prisma as any);

    await expect(
      service.notificarReportePedidoReentrega('t-1', 'emp-1', 'Fotos ilegibles'),
    ).resolves.toBeUndefined();
    expect(Logger.prototype.warn).toHaveBeenCalled();
  });

  it('notificarReportePedidoReentrega: no lanza si falla la consulta a la BD', async () => {
    const prisma = mockPrisma({
      employee: {
        findUnique: jest.fn().mockRejectedValue(new Error('BD caída')),
      },
    });
    const service = new NotificationService(prisma as any);

    await expect(
      service.notificarReportePedidoReentrega('t-1', 'emp-1', 'Fotos ilegibles'),
    ).resolves.toBeUndefined();
    expect(Logger.prototype.error).toHaveBeenCalled();
  });

  // ========== Tests para notificarSolicitudTrabajoCreada ==========

  it('notificarSolicitudTrabajoCreada: envía email al manager con datos de la solicitud', async () => {
    const prisma = mockPrisma({
      employee: {
        findUnique: jest
          .fn()
          .mockResolvedValueOnce({ managerId: 'mgr-1', nombres: 'Juan', apellidos: 'Pérez' })
          .mockResolvedValueOnce({ user: { email: 'mgr1@test.com' } }),
      },
    });
    const service = new NotificationService(prisma as any);
    const enviarEmailSpy = jest.spyOn(service as any, 'enviarEmail');

    const fechaEstimada = new Date('2026-08-25');
    await service.notificarSolicitudTrabajoCreada(
      't-1',
      'emp-solicitante',
      'Reparar bomba de agua',
      fechaEstimada,
      4,
      'ALTA',
    );

    expect(prisma.employee.findUnique).toHaveBeenNthCalledWith(1, {
      where: { id: 'emp-solicitante' },
      select: { managerId: true, nombres: true, apellidos: true },
    });
    expect(prisma.employee.findUnique).toHaveBeenNthCalledWith(2, {
      where: { id: 'mgr-1' },
      select: { user: { select: { email: true } } },
    });
    const callArgs = enviarEmailSpy.mock.calls[0];
    expect(enviarEmailSpy).toHaveBeenCalledWith('mgr1@test.com', 'Nueva solicitud de trabajo adicional', expect.any(String));
    expect(callArgs?.[2]).toContain('Juan Pérez');
    expect(callArgs?.[2]).toContain('Reparar bomba de agua');
    expect(callArgs?.[2]).toContain(fechaEstimada.toDateString());
    expect(callArgs?.[2]).toContain('4');
    expect(callArgs?.[2]).toContain('ALTA');
  });

  it('notificarSolicitudTrabajoCreada: crea notificación in-app para el manager', async () => {
    const prisma = mockPrisma({
      employee: {
        findUnique: jest
          .fn()
          .mockResolvedValueOnce({ managerId: 'mgr-1', nombres: 'Juan', apellidos: 'Pérez' })
          .mockResolvedValueOnce({ user: { email: 'mgr1@test.com' } }),
      },
    });
    const service = new NotificationService(prisma as any);
    const crearNotifSpy = jest.spyOn(service as any, 'crearNotificacionInApp');

    await service.notificarSolicitudTrabajoCreada(
      't-1',
      'emp-solicitante',
      'Reparar bomba de agua',
      new Date('2026-08-25'),
      4,
      'ALTA',
    );

    expect(crearNotifSpy).toHaveBeenCalledWith('t-1', 'mgr-1', expect.stringContaining('Reparar bomba de agua'));
  });

  it('notificarSolicitudTrabajoCreada: no hace nada si el solicitante no tiene manager asignado', async () => {
    const prisma = mockPrisma({
      employee: {
        findUnique: jest.fn().mockResolvedValue({ managerId: null, nombres: 'Juan', apellidos: 'Pérez' }),
      },
    });
    const service = new NotificationService(prisma as any);
    const enviarEmailSpy = jest.spyOn(service as any, 'enviarEmail');
    const crearNotifSpy = jest.spyOn(service as any, 'crearNotificacionInApp');

    await expect(
      service.notificarSolicitudTrabajoCreada(
        't-1',
        'emp-solicitante',
        'Reparar bomba de agua',
        new Date('2026-08-25'),
        4,
        'ALTA',
      ),
    ).resolves.toBeUndefined();

    expect(Logger.prototype.warn).toHaveBeenCalled();
    expect(prisma.employee.findUnique).toHaveBeenCalledTimes(1);
    expect(enviarEmailSpy).not.toHaveBeenCalled();
    expect(crearNotifSpy).not.toHaveBeenCalled();
  });

  it('notificarSolicitudTrabajoCreada: no lanza si el manager no tiene usuario/email (in-app sí se intenta)', async () => {
    const prisma = mockPrisma({
      employee: {
        findUnique: jest
          .fn()
          .mockResolvedValueOnce({ managerId: 'mgr-1', nombres: 'Juan', apellidos: 'Pérez' })
          .mockResolvedValueOnce({ user: null }),
      },
    });
    const service = new NotificationService(prisma as any);
    const enviarEmailSpy = jest.spyOn(service as any, 'enviarEmail');
    const crearNotifSpy = jest.spyOn(service as any, 'crearNotificacionInApp');

    await expect(
      service.notificarSolicitudTrabajoCreada(
        't-1',
        'emp-solicitante',
        'Reparar bomba de agua',
        new Date('2026-08-25'),
        4,
        'ALTA',
      ),
    ).resolves.toBeUndefined();

    expect(Logger.prototype.warn).toHaveBeenCalled();
    expect(enviarEmailSpy).not.toHaveBeenCalled();
    expect(crearNotifSpy).toHaveBeenCalledWith('t-1', 'mgr-1', expect.any(String));
  });

  it('notificarSolicitudTrabajoCreada: no lanza si falla la consulta al solicitante', async () => {
    const prisma = mockPrisma({
      employee: {
        findUnique: jest.fn().mockRejectedValue(new Error('BD caída')),
      },
    });
    const service = new NotificationService(prisma as any);

    await expect(
      service.notificarSolicitudTrabajoCreada(
        't-1',
        'emp-solicitante',
        'Reparar bomba de agua',
        new Date('2026-08-25'),
        4,
        'ALTA',
      ),
    ).resolves.toBeUndefined();
    expect(Logger.prototype.error).toHaveBeenCalled();
  });

  // ========== Tests para notificarReporteEnviado ==========

  it('notificarReporteEnviado: envía email al manager con tarea y fecha', async () => {
    const prisma = mockPrisma({
      employee: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'mgr-1',
          user: { email: 'mgr1@test.com' },
        }),
      },
    });
    const service = new NotificationService(prisma as any);
    const enviarEmailSpy = jest.spyOn(service as any, 'enviarEmail');

    const fechaEstimada = new Date('2026-08-25');
    await service.notificarReporteEnviado('t-1', 'mgr-1', 'Reparar bomba de agua', fechaEstimada);

    expect(prisma.employee.findUnique).toHaveBeenCalledWith({
      where: { id: 'mgr-1' },
      select: { id: true, user: { select: { email: true } } },
    });
    const callArgs = enviarEmailSpy.mock.calls[0];
    expect(enviarEmailSpy).toHaveBeenCalledWith('mgr1@test.com', 'Reporte de trabajo adicional entregado', expect.any(String));
    expect(callArgs?.[2]).toContain('Reparar bomba de agua');
    expect(callArgs?.[2]).toContain(fechaEstimada.toDateString());
  });

  it('notificarReporteEnviado: crea notificación in-app para el manager', async () => {
    const prisma = mockPrisma({
      employee: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'mgr-1',
          user: { email: 'mgr1@test.com' },
        }),
      },
    });
    const service = new NotificationService(prisma as any);
    const crearNotifSpy = jest.spyOn(service as any, 'crearNotificacionInApp');

    await service.notificarReporteEnviado('t-1', 'mgr-1', 'Reparar bomba de agua', new Date('2026-08-25'));

    expect(crearNotifSpy).toHaveBeenCalledWith('t-1', 'mgr-1', expect.stringContaining('Reparar bomba de agua'));
  });

  it('notificarReporteEnviado: no lanza si el manager no tiene usuario/email', async () => {
    const prisma = mockPrisma({
      employee: {
        findUnique: jest.fn().mockResolvedValue({ id: 'mgr-1', user: null }),
      },
    });
    const service = new NotificationService(prisma as any);
    const enviarEmailSpy = jest.spyOn(service as any, 'enviarEmail');
    const crearNotifSpy = jest.spyOn(service as any, 'crearNotificacionInApp');

    await expect(
      service.notificarReporteEnviado('t-1', 'mgr-1', 'Reparar bomba de agua', new Date('2026-08-25')),
    ).resolves.toBeUndefined();
    expect(Logger.prototype.warn).toHaveBeenCalled();
    expect(enviarEmailSpy).not.toHaveBeenCalled();
    expect(crearNotifSpy).toHaveBeenCalledWith('t-1', 'mgr-1', expect.any(String));
  });

  it('notificarReporteEnviado: no lanza si falla la consulta a la BD', async () => {
    const prisma = mockPrisma({
      employee: {
        findUnique: jest.fn().mockRejectedValue(new Error('BD caída')),
      },
    });
    const service = new NotificationService(prisma as any);

    await expect(
      service.notificarReporteEnviado('t-1', 'mgr-1', 'Reparar bomba de agua', new Date('2026-08-25')),
    ).resolves.toBeUndefined();
    expect(Logger.prototype.error).toHaveBeenCalled();
  });
});
