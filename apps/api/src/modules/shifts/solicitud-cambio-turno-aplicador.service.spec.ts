import { NotFoundException, BadRequestException } from '@nestjs/common';
import { SolicitudCambioTurnoAplicadorService } from './solicitud-cambio-turno-aplicador.service';

function mockTx(overrides: any = {}) {
  return {
    solicitudCambioTurno: {
      findUnique: jest.fn().mockResolvedValue(null),
    },
    turno: {
      findUnique: jest.fn().mockResolvedValue(null),
    },
    ...overrides,
  };
}

const TENANT = 't-1';
const EMPLOYEE = 'emp-1';

function solicitudPendiente(overrides: any = {}) {
  return {
    id: 'sol-1',
    tenantId: TENANT,
    employeeId: EMPLOYEE,
    estado: 'PENDIENTE',
    fechaActual: new Date(2026, 7, 5),
    turnoIdActual: 'turno-actual',
    fechaNueva: new Date(2026, 7, 10),
    turnoIdNuevo: 'turno-nuevo',
    creadoPor: 'u-1',
    ...overrides,
  };
}

describe('SolicitudCambioTurnoAplicadorService', () => {
  let solicitudCambioTurnoService: { actualizarEstado: jest.Mock };
  let shiftPlanService: { upsertAsignacion: jest.Mock };
  let notificationService: { notificarSolicitudAprobada: jest.Mock; notificarSolicitudRechazada: jest.Mock };
  let service: SolicitudCambioTurnoAplicadorService;

  beforeEach(() => {
    solicitudCambioTurnoService = {
      actualizarEstado: jest.fn().mockImplementation((_tx, id, estado, decididoPor, motivoRechazo) =>
        Promise.resolve({ id, estado, decididoPor, motivoRechazo: motivoRechazo ?? null }),
      ),
    };
    shiftPlanService = {
      upsertAsignacion: jest.fn().mockResolvedValue({ id: 'asig-1' }),
    };
    notificationService = {
      notificarSolicitudAprobada: jest.fn().mockResolvedValue(undefined),
      notificarSolicitudRechazada: jest.fn().mockResolvedValue(undefined),
    };

    service = new SolicitudCambioTurnoAplicadorService(
      solicitudCambioTurnoService as any,
      shiftPlanService as any,
      notificationService as any,
    );
  });

  describe('aprobarSolicitud', () => {
    it('happy path: aplica turnoAsignacion, marca APROBADA y notifica', async () => {
      const tx = mockTx();
      tx.solicitudCambioTurno.findUnique.mockResolvedValue(solicitudPendiente());
      tx.turno.findUnique.mockResolvedValue({ id: 'turno-nuevo', tenantId: TENANT, nombre: 'Turno Día' });

      const resultado = await service.aprobarSolicitud(tx, 'sol-1', 'manager-1');

      expect(shiftPlanService.upsertAsignacion).toHaveBeenCalledWith(
        tx,
        expect.objectContaining({
          tenantId: TENANT,
          employeeId: EMPLOYEE,
          fecha: new Date(2026, 7, 10),
          tipoDia: 'TURNO',
          turnoId: 'turno-nuevo',
          creadoPor: 'u-1',
        }),
      );
      expect(solicitudCambioTurnoService.actualizarEstado).toHaveBeenCalledWith(
        tx,
        'sol-1',
        'APROBADA',
        'manager-1',
      );
      expect(resultado.estado).toBe('APROBADA');
      expect(notificationService.notificarSolicitudAprobada).toHaveBeenCalledWith(
        TENANT,
        EMPLOYEE,
        new Date(2026, 7, 10),
        'Turno Día',
      );
    });

    it('happy path con turnoIdNuevo null: aplica DESCANSO', async () => {
      const tx = mockTx();
      tx.solicitudCambioTurno.findUnique.mockResolvedValue(solicitudPendiente({ turnoIdNuevo: null }));

      await service.aprobarSolicitud(tx, 'sol-1', 'manager-1');

      expect(shiftPlanService.upsertAsignacion).toHaveBeenCalledWith(
        tx,
        expect.objectContaining({ tipoDia: 'DESCANSO' }),
      );
      expect(shiftPlanService.upsertAsignacion.mock.calls[0][1].turnoId).toBeUndefined();
    });

    it('rechaza si la solicitud no existe', async () => {
      const tx = mockTx();
      tx.solicitudCambioTurno.findUnique.mockResolvedValue(null);

      await expect(service.aprobarSolicitud(tx, 'sol-999', 'manager-1')).rejects.toThrow(NotFoundException);
      expect(shiftPlanService.upsertAsignacion).not.toHaveBeenCalled();
      expect(solicitudCambioTurnoService.actualizarEstado).not.toHaveBeenCalled();
    });

    it('rechaza si la solicitud no está PENDIENTE', async () => {
      const tx = mockTx();
      tx.solicitudCambioTurno.findUnique.mockResolvedValue(solicitudPendiente({ estado: 'APROBADA' }));

      await expect(service.aprobarSolicitud(tx, 'sol-1', 'manager-1')).rejects.toThrow(BadRequestException);
      expect(shiftPlanService.upsertAsignacion).not.toHaveBeenCalled();
    });

    it('rechaza si el turno nuevo no existe en el catálogo', async () => {
      const tx = mockTx();
      tx.solicitudCambioTurno.findUnique.mockResolvedValue(solicitudPendiente());
      tx.turno.findUnique.mockResolvedValue(null);

      await expect(service.aprobarSolicitud(tx, 'sol-1', 'manager-1')).rejects.toThrow(BadRequestException);
      expect(shiftPlanService.upsertAsignacion).not.toHaveBeenCalled();
      expect(solicitudCambioTurnoService.actualizarEstado).not.toHaveBeenCalled();
    });

    it('rechaza si el turno nuevo pertenece a otro tenant', async () => {
      const tx = mockTx();
      tx.solicitudCambioTurno.findUnique.mockResolvedValue(solicitudPendiente());
      tx.turno.findUnique.mockResolvedValue({ id: 'turno-nuevo', tenantId: 'otro-tenant', nombre: 'X' });

      await expect(service.aprobarSolicitud(tx, 'sol-1', 'manager-1')).rejects.toThrow(BadRequestException);
    });

    it('no propaga error si la notificación de aprobación falla', async () => {
      const tx = mockTx();
      tx.solicitudCambioTurno.findUnique.mockResolvedValue(solicitudPendiente());
      tx.turno.findUnique.mockResolvedValue({ id: 'turno-nuevo', tenantId: TENANT, nombre: 'Turno Día' });
      notificationService.notificarSolicitudAprobada.mockRejectedValue(new Error('SMTP down'));

      const resultado = await service.aprobarSolicitud(tx, 'sol-1', 'manager-1');
      expect(resultado.estado).toBe('APROBADA');
    });
  });

  describe('rechazarSolicitud', () => {
    it('happy path: registra motivoRechazo, marca RECHAZADA y notifica', async () => {
      const tx = mockTx();
      tx.solicitudCambioTurno.findUnique.mockResolvedValue(solicitudPendiente());

      const resultado = await service.rechazarSolicitud(tx, 'sol-1', 'manager-1', 'No hay cobertura');

      expect(solicitudCambioTurnoService.actualizarEstado).toHaveBeenCalledWith(
        tx,
        'sol-1',
        'RECHAZADA',
        'manager-1',
        'No hay cobertura',
      );
      expect(resultado.estado).toBe('RECHAZADA');
      expect(resultado.motivoRechazo).toBe('No hay cobertura');
      expect(shiftPlanService.upsertAsignacion).not.toHaveBeenCalled();
      expect(notificationService.notificarSolicitudRechazada).toHaveBeenCalledWith(
        TENANT,
        EMPLOYEE,
        'No hay cobertura',
      );
    });

    it('rechaza si la solicitud no existe', async () => {
      const tx = mockTx();
      tx.solicitudCambioTurno.findUnique.mockResolvedValue(null);

      await expect(
        service.rechazarSolicitud(tx, 'sol-999', 'manager-1', 'motivo'),
      ).rejects.toThrow(NotFoundException);
      expect(solicitudCambioTurnoService.actualizarEstado).not.toHaveBeenCalled();
    });

    it('rechaza si la solicitud no está PENDIENTE', async () => {
      const tx = mockTx();
      tx.solicitudCambioTurno.findUnique.mockResolvedValue(solicitudPendiente({ estado: 'RECHAZADA' }));

      await expect(
        service.rechazarSolicitud(tx, 'sol-1', 'manager-1', 'motivo'),
      ).rejects.toThrow(BadRequestException);
    });

    it('no propaga error si la notificación de rechazo falla', async () => {
      const tx = mockTx();
      tx.solicitudCambioTurno.findUnique.mockResolvedValue(solicitudPendiente());
      notificationService.notificarSolicitudRechazada.mockRejectedValue(new Error('SMTP down'));

      const resultado = await service.rechazarSolicitud(tx, 'sol-1', 'manager-1', 'motivo');
      expect(resultado.estado).toBe('RECHAZADA');
    });
  });
});
