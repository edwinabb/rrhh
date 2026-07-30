import { ConflictException, NotFoundException, BadRequestException } from '@nestjs/common';
import { SolicitudCambioTurnoService } from './solicitud-cambio-turno.service';

function mockTx(overrides: any = {}) {
  return {
    solicitudCambioTurno: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue(null),
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 'sol-1', ...data })),
      update: jest.fn().mockImplementation(({ where, data }: any) => Promise.resolve({ id: where.id, ...data })),
    },
    turnoAsignacion: {
      findFirst: jest.fn().mockResolvedValue(null),
      findUnique: jest.fn().mockResolvedValue(null),
    },
    turno: {
      findUnique: jest.fn().mockResolvedValue(null),
    },
    ...overrides,
  };
}

const service = new SolicitudCambioTurnoService();

const TENANT = 't-1';
const EMPLOYEE = 'emp-1';

describe('SolicitudCambioTurnoService', () => {
  describe('crearSolicitud', () => {
    it('happy path: crea solicitud con fechas futuras y sin conflictos', async () => {
      const tx = mockTx();
      tx.turnoAsignacion.findFirst.mockImplementation(({ where }: any) => {
        if (where.fecha.getTime() === new Date(2026, 7, 5).getTime()) {
          return Promise.resolve({ turnoId: 'turno-actual' });
        }
        return Promise.resolve(null);
      });
      tx.turno.findUnique.mockResolvedValue({ id: 'turno-nuevo', tenantId: TENANT });

      const resultado = await service.crearSolicitud(tx, {
        tenantId: TENANT,
        employeeId: EMPLOYEE,
        fechaActual: new Date(2026, 7, 5),
        turnoIdActual: 'turno-actual',
        fechaNueva: new Date(2026, 7, 10),
        turnoIdNuevo: 'turno-nuevo',
        creadoPor: 'u-1',
      });

      expect(resultado.estado).toBe('PENDIENTE');
      expect(tx.solicitudCambioTurno.create).toHaveBeenCalled();
    });

    it('rechaza fecha en el pasado', async () => {
      const tx = mockTx();
      await expect(
        service.crearSolicitud(tx, {
          tenantId: TENANT,
          employeeId: EMPLOYEE,
          fechaActual: new Date(2020, 0, 1),
          turnoIdActual: 'turno-actual',
          fechaNueva: new Date(2026, 7, 10),
          turnoIdNuevo: 'turno-nuevo',
          creadoPor: 'u-1',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rechaza solicitud duplicada PENDIENTE para la misma fecha', async () => {
      const tx = mockTx();
      tx.solicitudCambioTurno.findFirst.mockResolvedValue({ id: 'sol-existente', estado: 'PENDIENTE' });

      await expect(
        service.crearSolicitud(tx, {
          tenantId: TENANT,
          employeeId: EMPLOYEE,
          fechaActual: new Date(2026, 7, 5),
          turnoIdActual: 'turno-actual',
          fechaNueva: new Date(2026, 7, 10),
          turnoIdNuevo: 'turno-nuevo',
          creadoPor: 'u-1',
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('rechaza si el turno actual no coincide con la asignación existente', async () => {
      const tx = mockTx();
      tx.turnoAsignacion.findFirst.mockResolvedValue({ turnoId: 'turno-distinto' });

      await expect(
        service.crearSolicitud(tx, {
          tenantId: TENANT,
          employeeId: EMPLOYEE,
          fechaActual: new Date(2026, 7, 5),
          turnoIdActual: 'turno-actual',
          fechaNueva: new Date(2026, 7, 10),
          turnoIdNuevo: 'turno-nuevo',
          creadoPor: 'u-1',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rechaza si el turno nuevo no existe en el catálogo', async () => {
      const tx = mockTx();
      tx.turnoAsignacion.findFirst.mockResolvedValue({ turnoId: 'turno-actual' });
      tx.turno.findUnique.mockResolvedValue(null);

      await expect(
        service.crearSolicitud(tx, {
          tenantId: TENANT,
          employeeId: EMPLOYEE,
          fechaActual: new Date(2026, 7, 5),
          turnoIdActual: 'turno-actual',
          fechaNueva: new Date(2026, 7, 10),
          turnoIdNuevo: 'turno-inexistente',
          creadoPor: 'u-1',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rechaza si la fecha nueva ya tiene una asignación de turno (no-DESCANSO)', async () => {
      const tx = mockTx();
      tx.turnoAsignacion.findFirst.mockImplementation(({ where }: any) => {
        if (where.fecha.getTime() === new Date(2026, 7, 5).getTime()) {
          return Promise.resolve({ turnoId: 'turno-actual' });
        }
        return Promise.resolve({ turnoId: 'turno-ocupado', tipoDia: 'TURNO' });
      });
      tx.turno.findUnique.mockResolvedValue({ id: 'turno-nuevo', tenantId: TENANT });

      await expect(
        service.crearSolicitud(tx, {
          tenantId: TENANT,
          employeeId: EMPLOYEE,
          fechaActual: new Date(2026, 7, 5),
          turnoIdActual: 'turno-actual',
          fechaNueva: new Date(2026, 7, 10),
          turnoIdNuevo: 'turno-nuevo',
          creadoPor: 'u-1',
        }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('listarSolicitudes', () => {
    it('filtra por estado correctamente', async () => {
      const tx = mockTx();
      tx.solicitudCambioTurno.findMany.mockResolvedValue([{ id: 'sol-1', estado: 'PENDIENTE' }]);

      await service.listarSolicitudes(tx, { tenantId: TENANT, estado: 'PENDIENTE' });

      expect(tx.solicitudCambioTurno.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ tenantId: TENANT, estado: 'PENDIENTE' }),
          orderBy: { fechaSolicitud: 'desc' },
        }),
      );
    });
  });

  describe('listarMisSolicitudes', () => {
    it('filtra por tenantId y employeeId', async () => {
      const tx = mockTx();
      await service.listarMisSolicitudes(tx, TENANT, EMPLOYEE);

      expect(tx.solicitudCambioTurno.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ tenantId: TENANT, employeeId: EMPLOYEE }),
        }),
      );
    });
  });

  describe('obtenerSolicitud', () => {
    it('retorna null si no existe', async () => {
      const tx = mockTx();
      const resultado = await service.obtenerSolicitud(tx, 'sol-999');
      expect(resultado).toBeNull();
    });
  });

  describe('actualizarEstado', () => {
    it('rechaza solicitud inexistente', async () => {
      const tx = mockTx();
      await expect(
        service.actualizarEstado(tx, 'sol-999', 'APROBADA', 'manager-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('rechaza si la solicitud no está PENDIENTE', async () => {
      const tx = mockTx();
      tx.solicitudCambioTurno.findUnique.mockResolvedValue({ id: 'sol-1', estado: 'APROBADA' });

      await expect(
        service.actualizarEstado(tx, 'sol-1', 'RECHAZADA', 'manager-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('PENDIENTE -> APROBADA actualiza estado y decisión', async () => {
      const tx = mockTx();
      tx.solicitudCambioTurno.findUnique.mockResolvedValue({
        id: 'sol-1',
        tenantId: TENANT,
        employeeId: EMPLOYEE,
        estado: 'PENDIENTE',
        turnoIdNuevo: 'turno-nuevo',
        fechaNueva: new Date(2026, 7, 10),
      });
      tx.turno.findUnique.mockResolvedValue({ id: 'turno-nuevo', tenantId: TENANT });
      tx.turnoAsignacion.findFirst.mockResolvedValue(null);

      const resultado = await service.actualizarEstado(tx, 'sol-1', 'APROBADA', 'manager-1');

      expect(resultado.estado).toBe('APROBADA');
      expect(resultado.decididoPor).toBe('manager-1');
      expect(tx.solicitudCambioTurno.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'sol-1' },
          data: expect.objectContaining({ estado: 'APROBADA', decididoPor: 'manager-1' }),
        }),
      );
    });

    it('PENDIENTE -> RECHAZADA guarda motivoRechazo', async () => {
      const tx = mockTx();
      tx.solicitudCambioTurno.findUnique.mockResolvedValue({
        id: 'sol-1',
        tenantId: TENANT,
        employeeId: EMPLOYEE,
        estado: 'PENDIENTE',
        turnoIdNuevo: null,
        fechaNueva: new Date(2026, 7, 10),
      });

      const resultado = await service.actualizarEstado(tx, 'sol-1', 'RECHAZADA', 'manager-1', 'No hay cobertura disponible');

      expect(resultado.estado).toBe('RECHAZADA');
      expect(resultado.motivoRechazo).toBe('No hay cobertura disponible');
    });

    it('APROBADA rechaza si hay conflicto en la fecha nueva', async () => {
      const tx = mockTx();
      tx.solicitudCambioTurno.findUnique.mockResolvedValue({
        id: 'sol-1',
        tenantId: TENANT,
        employeeId: EMPLOYEE,
        estado: 'PENDIENTE',
        turnoIdNuevo: 'turno-nuevo',
        fechaNueva: new Date(2026, 7, 10),
      });
      tx.turno.findUnique.mockResolvedValue({ id: 'turno-nuevo', tenantId: TENANT });
      tx.turnoAsignacion.findFirst.mockResolvedValue({ turnoId: 'turno-ocupado', tipoDia: 'TURNO' });

      await expect(
        service.actualizarEstado(tx, 'sol-1', 'APROBADA', 'manager-1'),
      ).rejects.toThrow(ConflictException);
    });
  });
});
