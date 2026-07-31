import { NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { SolicitudTrabajoAdicionalAplicadorService } from './solicitud-trabajo-adicional-aplicador.service';

function mockTx(overrides: any = {}) {
  return {
    solicitudTrabajoAdicional: {
      findUnique: jest.fn().mockResolvedValue(null),
      findFirst: jest.fn().mockResolvedValue(null),
      update: jest.fn(),
    },
    employee: {
      findUnique: jest.fn().mockResolvedValue(null),
    },
    ...overrides,
  };
}

const TENANT = 't-1';
const SOLICITANTE = 'emp-solicitante';
const ASIGNADO = 'emp-asignado';

function solicitudPendienteAprobacion(overrides: any = {}) {
  return {
    id: 'sol-1',
    tenantId: TENANT,
    employeeIdSolicitante: SOLICITANTE,
    employeeIdAsignado: ASIGNADO,
    descripcionTarea: 'Reparar bomba',
    fechaEstimada: new Date(2026, 7, 10),
    horasEstimadas: 6,
    estado: 'PENDIENTE_APROBACION',
    creadoPor: 'u-1',
    ...overrides,
  };
}

function solicitudPendienteValidacion(overrides: any = {}) {
  return {
    ...solicitudPendienteAprobacion(overrides),
    estado: 'REPORTE_PENDIENTE_VALIDACION',
    ...overrides,
  };
}

describe('SolicitudTrabajoAdicionalAplicadorService', () => {
  let solicitudTrabajoAdicionalService: { actualizarEstado: jest.Mock };
  let compensatorioService: { registrarMovimiento: jest.Mock };
  let notificationService: {
    notificarTrabajoAprobado: jest.Mock;
    notificarTrabajoReasignado: jest.Mock;
    notificarTrabajoRechazado: jest.Mock;
    notificarReporteValidado: jest.Mock;
    notificarReportePedidoReentrega: jest.Mock;
  };
  let service: SolicitudTrabajoAdicionalAplicadorService;

  beforeEach(() => {
    solicitudTrabajoAdicionalService = {
      actualizarEstado: jest
        .fn()
        .mockImplementation((_tx, id, estado, managerId, motivoRechazo) =>
          Promise.resolve({ id, estado, managerId, motivoRechazo: motivoRechazo ?? null }),
        ),
    };
    compensatorioService = {
      registrarMovimiento: jest.fn().mockResolvedValue({ id: 'mov-1' }),
    };
    notificationService = {
      notificarTrabajoAprobado: jest.fn().mockResolvedValue(undefined),
      notificarTrabajoReasignado: jest.fn().mockResolvedValue(undefined),
      notificarTrabajoRechazado: jest.fn().mockResolvedValue(undefined),
      notificarReporteValidado: jest.fn().mockResolvedValue(undefined),
      notificarReportePedidoReentrega: jest.fn().mockResolvedValue(undefined),
    };

    service = new SolicitudTrabajoAdicionalAplicadorService(
      solicitudTrabajoAdicionalService as any,
      compensatorioService as any,
      notificationService as any,
    );
  });

  describe('aprobarSolicitud', () => {
    it('happy path: marca APROBADA y notifica al asignado', async () => {
      const tx = mockTx();
      tx.solicitudTrabajoAdicional.findUnique.mockResolvedValue(solicitudPendienteAprobacion());

      const resultado = await service.aprobarSolicitud(tx, TENANT, 'sol-1', 'manager-1');

      expect(solicitudTrabajoAdicionalService.actualizarEstado).toHaveBeenCalledWith(
        tx,
        'sol-1',
        'APROBADA',
        'manager-1',
      );
      expect(resultado.estado).toBe('APROBADA');
      expect(notificationService.notificarTrabajoAprobado).toHaveBeenCalledWith(
        TENANT,
        ASIGNADO,
        'Reparar bomba',
      );
    });

    it('rechaza si la solicitud no existe', async () => {
      const tx = mockTx();
      await expect(service.aprobarSolicitud(tx, TENANT, 'sol-999', 'manager-1')).rejects.toThrow(
        NotFoundException,
      );
      expect(solicitudTrabajoAdicionalService.actualizarEstado).not.toHaveBeenCalled();
    });

    it('rechaza si la solicitud no está PENDIENTE_APROBACION', async () => {
      const tx = mockTx();
      tx.solicitudTrabajoAdicional.findUnique.mockResolvedValue(
        solicitudPendienteAprobacion({ estado: 'APROBADA' }),
      );
      await expect(service.aprobarSolicitud(tx, TENANT, 'sol-1', 'manager-1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('no propaga error si la notificación falla', async () => {
      const tx = mockTx();
      tx.solicitudTrabajoAdicional.findUnique.mockResolvedValue(solicitudPendienteAprobacion());
      notificationService.notificarTrabajoAprobado.mockRejectedValue(new Error('SMTP down'));

      const resultado = await service.aprobarSolicitud(tx, TENANT, 'sol-1', 'manager-1');
      expect(resultado.estado).toBe('APROBADA');
    });
  });

  describe('reasignarSolicitud', () => {
    it('happy path: actualiza employeeIdAsignado, estado REASIGNADA y notifica al nuevo', async () => {
      const tx = mockTx();
      tx.solicitudTrabajoAdicional.findUnique.mockResolvedValue(solicitudPendienteAprobacion());
      tx.employee.findUnique.mockResolvedValue({ id: 'emp-nuevo', estado: 'activo' });
      tx.solicitudTrabajoAdicional.findFirst.mockResolvedValue(null);
      tx.solicitudTrabajoAdicional.update.mockResolvedValue({
        id: 'sol-1',
        estado: 'REASIGNADA',
        employeeIdAsignado: 'emp-nuevo',
      });

      const resultado = await service.reasignarSolicitud(tx, TENANT, 'sol-1', 'emp-nuevo', 'manager-1');

      expect(tx.solicitudTrabajoAdicional.update).toHaveBeenCalledWith({
        where: { id: 'sol-1' },
        data: {
          employeeIdAsignado: 'emp-nuevo',
          estado: 'REASIGNADA',
          managerId: 'manager-1',
          actualizadoPor: 'manager-1',
        },
      });
      expect(solicitudTrabajoAdicionalService.actualizarEstado).not.toHaveBeenCalled();
      expect(resultado.estado).toBe('REASIGNADA');
      expect(notificationService.notificarTrabajoReasignado).toHaveBeenCalledWith(
        TENANT,
        'emp-nuevo',
        'Reparar bomba',
        new Date(2026, 7, 10),
        6,
      );
    });

    it('rechaza si el empleado nuevo no existe', async () => {
      const tx = mockTx();
      tx.solicitudTrabajoAdicional.findUnique.mockResolvedValue(solicitudPendienteAprobacion());
      tx.employee.findUnique.mockResolvedValue(null);

      await expect(
        service.reasignarSolicitud(tx, TENANT, 'sol-1', 'emp-nuevo', 'manager-1'),
      ).rejects.toThrow(BadRequestException);
      expect(tx.solicitudTrabajoAdicional.update).not.toHaveBeenCalled();
    });

    it('rechaza si el empleado nuevo no está activo', async () => {
      const tx = mockTx();
      tx.solicitudTrabajoAdicional.findUnique.mockResolvedValue(solicitudPendienteAprobacion());
      tx.employee.findUnique.mockResolvedValue({ id: 'emp-nuevo', estado: 'cesado' });

      await expect(
        service.reasignarSolicitud(tx, TENANT, 'sol-1', 'emp-nuevo', 'manager-1'),
      ).rejects.toThrow(BadRequestException);
      expect(tx.solicitudTrabajoAdicional.update).not.toHaveBeenCalled();
    });

    it('rechaza si ya existe una solicitud no terminal para el empleado nuevo en esa fecha', async () => {
      const tx = mockTx();
      tx.solicitudTrabajoAdicional.findUnique.mockResolvedValue(solicitudPendienteAprobacion());
      tx.employee.findUnique.mockResolvedValue({ id: 'emp-nuevo', estado: 'activo' });
      tx.solicitudTrabajoAdicional.findFirst.mockResolvedValue({ id: 'sol-otra' });

      await expect(
        service.reasignarSolicitud(tx, TENANT, 'sol-1', 'emp-nuevo', 'manager-1'),
      ).rejects.toThrow(ConflictException);
      expect(tx.solicitudTrabajoAdicional.update).not.toHaveBeenCalled();
    });

    it('rechaza si la solicitud no está PENDIENTE_APROBACION', async () => {
      const tx = mockTx();
      tx.solicitudTrabajoAdicional.findUnique.mockResolvedValue(
        solicitudPendienteAprobacion({ estado: 'RECHAZADA' }),
      );
      await expect(
        service.reasignarSolicitud(tx, TENANT, 'sol-1', 'emp-nuevo', 'manager-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('no propaga error si la notificación falla', async () => {
      const tx = mockTx();
      tx.solicitudTrabajoAdicional.findUnique.mockResolvedValue(solicitudPendienteAprobacion());
      tx.employee.findUnique.mockResolvedValue({ id: 'emp-nuevo', estado: 'activo' });
      tx.solicitudTrabajoAdicional.findFirst.mockResolvedValue(null);
      tx.solicitudTrabajoAdicional.update.mockResolvedValue({ id: 'sol-1', estado: 'REASIGNADA' });
      notificationService.notificarTrabajoReasignado.mockRejectedValue(new Error('SMTP down'));

      const resultado = await service.reasignarSolicitud(tx, TENANT, 'sol-1', 'emp-nuevo', 'manager-1');
      expect(resultado.estado).toBe('REASIGNADA');
    });
  });

  describe('rechazarSolicitud', () => {
    it('happy path: registra motivoRechazo, marca RECHAZADA y notifica al solicitante', async () => {
      const tx = mockTx();
      tx.solicitudTrabajoAdicional.findUnique.mockResolvedValue(solicitudPendienteAprobacion());

      const resultado = await service.rechazarSolicitud(tx, TENANT, 'sol-1', 'manager-1', 'No hay presupuesto');

      expect(solicitudTrabajoAdicionalService.actualizarEstado).toHaveBeenCalledWith(
        tx,
        'sol-1',
        'RECHAZADA',
        'manager-1',
        'No hay presupuesto',
      );
      expect(resultado.estado).toBe('RECHAZADA');
      expect(notificationService.notificarTrabajoRechazado).toHaveBeenCalledWith(
        TENANT,
        SOLICITANTE,
        'No hay presupuesto',
      );
    });

    it('rechaza si la solicitud no existe', async () => {
      const tx = mockTx();
      await expect(
        service.rechazarSolicitud(tx, TENANT, 'sol-999', 'manager-1', 'motivo'),
      ).rejects.toThrow(NotFoundException);
    });

    it('rechaza si la solicitud no está PENDIENTE_APROBACION', async () => {
      const tx = mockTx();
      tx.solicitudTrabajoAdicional.findUnique.mockResolvedValue(
        solicitudPendienteAprobacion({ estado: 'RECHAZADA' }),
      );
      await expect(
        service.rechazarSolicitud(tx, TENANT, 'sol-1', 'manager-1', 'motivo'),
      ).rejects.toThrow(BadRequestException);
    });

    it('no propaga error si la notificación falla', async () => {
      const tx = mockTx();
      tx.solicitudTrabajoAdicional.findUnique.mockResolvedValue(solicitudPendienteAprobacion());
      notificationService.notificarTrabajoRechazado.mockRejectedValue(new Error('SMTP down'));

      const resultado = await service.rechazarSolicitud(tx, TENANT, 'sol-1', 'manager-1', 'motivo');
      expect(resultado.estado).toBe('RECHAZADA');
    });
  });

  describe('validarReporte', () => {
    it('happy path: marca VALIDADA, registra compensatorio GANADO (horas/8) y notifica', async () => {
      const tx = mockTx();
      tx.solicitudTrabajoAdicional.findUnique.mockResolvedValue(
        solicitudPendienteValidacion({ horasEstimadas: 6 }),
      );

      const resultado = await service.validarReporte(tx, TENANT, 'sol-1', 'manager-1');

      expect(solicitudTrabajoAdicionalService.actualizarEstado).toHaveBeenCalledWith(
        tx,
        'sol-1',
        'VALIDADA',
        'manager-1',
      );
      expect(compensatorioService.registrarMovimiento).toHaveBeenCalledWith(tx, {
        tenantId: TENANT,
        employeeId: ASIGNADO,
        tipo: 'GANADO',
        dias: 0.75,
        fechaReferencia: new Date(2026, 7, 10),
        motivo: 'Trabajo adicional: Reparar bomba',
        creadoPor: 'manager-1',
      });
      expect(resultado.estado).toBe('VALIDADA');
      expect(notificationService.notificarReporteValidado).toHaveBeenCalledWith(
        TENANT,
        ASIGNADO,
        'Reparar bomba',
        0.75,
      );
    });

    it('redondea dias a 2 decimales', async () => {
      const tx = mockTx();
      tx.solicitudTrabajoAdicional.findUnique.mockResolvedValue(
        solicitudPendienteValidacion({ horasEstimadas: 5 }),
      );

      await service.validarReporte(tx, TENANT, 'sol-1', 'manager-1');

      expect(compensatorioService.registrarMovimiento).toHaveBeenCalledWith(
        tx,
        expect.objectContaining({ dias: 0.63 }),
      );
    });

    it('actualizarEstado y registrarMovimiento ocurren en el mismo tx', async () => {
      const tx = mockTx();
      tx.solicitudTrabajoAdicional.findUnique.mockResolvedValue(solicitudPendienteValidacion());

      await service.validarReporte(tx, TENANT, 'sol-1', 'manager-1');

      expect(compensatorioService.registrarMovimiento.mock.calls[0][0]).toBe(tx);
    });

    it('rechaza si la solicitud no existe', async () => {
      const tx = mockTx();
      await expect(service.validarReporte(tx, TENANT, 'sol-999', 'manager-1')).rejects.toThrow(
        NotFoundException,
      );
      expect(compensatorioService.registrarMovimiento).not.toHaveBeenCalled();
    });

    it('rechaza si la solicitud no está REPORTE_PENDIENTE_VALIDACION', async () => {
      const tx = mockTx();
      tx.solicitudTrabajoAdicional.findUnique.mockResolvedValue(
        solicitudPendienteAprobacion({ estado: 'APROBADA' }),
      );
      await expect(service.validarReporte(tx, TENANT, 'sol-1', 'manager-1')).rejects.toThrow(
        BadRequestException,
      );
      expect(compensatorioService.registrarMovimiento).not.toHaveBeenCalled();
    });

    it('no propaga error si la notificación falla', async () => {
      const tx = mockTx();
      tx.solicitudTrabajoAdicional.findUnique.mockResolvedValue(solicitudPendienteValidacion());
      notificationService.notificarReporteValidado.mockRejectedValue(new Error('SMTP down'));

      const resultado = await service.validarReporte(tx, TENANT, 'sol-1', 'manager-1');
      expect(resultado.estado).toBe('VALIDADA');
    });
  });

  describe('rechazarReporte', () => {
    it('happy path: marca REPORTE_RECHAZADO, no toca compensatorio y notifica', async () => {
      const tx = mockTx();
      tx.solicitudTrabajoAdicional.findUnique.mockResolvedValue(solicitudPendienteValidacion());

      const resultado = await service.rechazarReporte(tx, TENANT, 'sol-1', 'manager-1', 'Fotos borrosas');

      expect(solicitudTrabajoAdicionalService.actualizarEstado).toHaveBeenCalledWith(
        tx,
        'sol-1',
        'REPORTE_RECHAZADO',
        'manager-1',
        'Fotos borrosas',
      );
      expect(compensatorioService.registrarMovimiento).not.toHaveBeenCalled();
      expect(resultado.estado).toBe('REPORTE_RECHAZADO');
      expect(notificationService.notificarReportePedidoReentrega).toHaveBeenCalledWith(
        TENANT,
        ASIGNADO,
        'Fotos borrosas',
      );
    });

    it('rechaza si la solicitud no existe', async () => {
      const tx = mockTx();
      await expect(
        service.rechazarReporte(tx, TENANT, 'sol-999', 'manager-1', 'motivo'),
      ).rejects.toThrow(NotFoundException);
    });

    it('rechaza si la solicitud no está REPORTE_PENDIENTE_VALIDACION', async () => {
      const tx = mockTx();
      tx.solicitudTrabajoAdicional.findUnique.mockResolvedValue(
        solicitudPendienteAprobacion({ estado: 'APROBADA' }),
      );
      await expect(
        service.rechazarReporte(tx, TENANT, 'sol-1', 'manager-1', 'motivo'),
      ).rejects.toThrow(BadRequestException);
    });

    it('no propaga error si la notificación falla', async () => {
      const tx = mockTx();
      tx.solicitudTrabajoAdicional.findUnique.mockResolvedValue(solicitudPendienteValidacion());
      notificationService.notificarReportePedidoReentrega.mockRejectedValue(new Error('SMTP down'));

      const resultado = await service.rechazarReporte(tx, TENANT, 'sol-1', 'manager-1', 'motivo');
      expect(resultado.estado).toBe('REPORTE_RECHAZADO');
    });
  });
});
