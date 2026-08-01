import { ConflictException, NotFoundException, BadRequestException } from '@nestjs/common';
import { SolicitudTrabajoAdicionalService } from './solicitud-trabajo-adicional.service';
import { CompensatorioService } from './compensatorio.service';

function mockTx(overrides: any = {}) {
  return {
    solicitudTrabajoAdicional: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue(null),
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 'sol-1', ...data })),
      update: jest.fn().mockImplementation(({ where, data }: any) => Promise.resolve({ id: where.id, ...data })),
    },
    employee: {
      findUnique: jest.fn().mockResolvedValue({ id: 'emp-1', estado: 'activo' }),
    },
    asistenciaResumen: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    compensatorioMovimiento: {
      aggregate: jest.fn().mockResolvedValue({ _sum: { dias: 2 } }),
    },
    ...overrides,
  };
}

const TENANT = 't-1';
const SOLICITANTE = 'emp-1';
const ASIGNADO = 'emp-2';

function crearServicio() {
  return new SolicitudTrabajoAdicionalService(new CompensatorioService());
}

function inputBase(overrides: any = {}) {
  return {
    tenantId: TENANT,
    employeeIdSolicitante: SOLICITANTE,
    employeeIdAsignado: ASIGNADO,
    descripcionTarea: 'Revisión de inventario fuera de turno',
    fechaEstimada: new Date(2026, 7, 15),
    horasEstimadas: 4,
    urgencia: 'NORMAL',
    creadoPor: 'u-1',
    ...overrides,
  };
}

describe('SolicitudTrabajoAdicionalService', () => {
  describe('crearSolicitud', () => {
    it('happy path: crea solicitud PENDIENTE_APROBACION con indicadores privados calculados', async () => {
      const tx = mockTx();
      const service = crearServicio();

      const resultado = await service.crearSolicitud(tx, inputBase());

      expect(resultado.estado).toBe('PENDIENTE_APROBACION');
      expect(resultado.horasAcumuladas).toBe(4); // 0 acumuladas + 4 estimadas
      expect(resultado.causaHorasExtras).toBe(false);
      expect(resultado.saldoCompensatorios).toBe(2);
      expect(tx.solicitudTrabajoAdicional.create).toHaveBeenCalled();
    });

    it('marca causaHorasExtras=true si horasAcumuladas supera la jornada semanal máxima (48h default)', async () => {
      const tx = mockTx({
        asistenciaResumen: {
          findMany: jest.fn().mockResolvedValue([{ horasTrabajadas: 44 }]),
        },
      });
      const service = crearServicio();

      const resultado = await service.crearSolicitud(tx, inputBase({ horasEstimadas: 6 }));

      expect(resultado.horasAcumuladas).toBe(50);
      expect(resultado.causaHorasExtras).toBe(true);
    });

    it('rechaza fecha estimada en el pasado', async () => {
      const tx = mockTx();
      const service = crearServicio();

      await expect(
        service.crearSolicitud(tx, inputBase({ fechaEstimada: new Date(2020, 0, 1) })),
      ).rejects.toThrow(BadRequestException);
    });

    it('rechaza horasEstimadas > 12', async () => {
      const tx = mockTx();
      const service = crearServicio();

      await expect(
        service.crearSolicitud(tx, inputBase({ horasEstimadas: 13 })),
      ).rejects.toThrow(BadRequestException);
    });

    it('rechaza horasEstimadas <= 0', async () => {
      const tx = mockTx();
      const service = crearServicio();

      await expect(
        service.crearSolicitud(tx, inputBase({ horasEstimadas: 0 })),
      ).rejects.toThrow(BadRequestException);
    });

    it('rechaza si el empleado solicitante no existe', async () => {
      const tx = mockTx({ employee: { findUnique: jest.fn().mockResolvedValue(null) } });
      const service = crearServicio();

      await expect(service.crearSolicitud(tx, inputBase())).rejects.toThrow(NotFoundException);
    });

    it('rechaza si el empleado solicitante no está activo', async () => {
      const tx = mockTx({ employee: { findUnique: jest.fn().mockResolvedValue({ id: SOLICITANTE, estado: 'cesado' }) } });
      const service = crearServicio();

      await expect(service.crearSolicitud(tx, inputBase())).rejects.toThrow(BadRequestException);
    });

    it('rechaza solicitud duplicada para el mismo empleado y fecha en estado no terminal', async () => {
      const tx = mockTx();
      tx.solicitudTrabajoAdicional.findFirst.mockResolvedValue({ id: 'sol-existente', estado: 'APROBADA' });
      const service = crearServicio();

      await expect(service.crearSolicitud(tx, inputBase())).rejects.toThrow(ConflictException);
    });
  });

  describe('listarSolicitudes', () => {
    it('filtra por estado correctamente', async () => {
      const tx = mockTx();
      const service = crearServicio();
      tx.solicitudTrabajoAdicional.findMany.mockResolvedValue([{ id: 'sol-1', estado: 'PENDIENTE_APROBACION' }]);

      await service.listarSolicitudes(tx, { tenantId: TENANT, estado: 'PENDIENTE_APROBACION' });

      expect(tx.solicitudTrabajoAdicional.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ tenantId: TENANT, estado: 'PENDIENTE_APROBACION' }),
          orderBy: { creadoEn: 'desc' },
        }),
      );
    });
  });

  describe('listarMisSolicitudes', () => {
    it('filtra por OR de solicitante/asignado (una solicitud reasignada pertenece al nuevo asignado)', async () => {
      const tx = mockTx();
      const service = crearServicio();

      await service.listarMisSolicitudes(tx, TENANT, ASIGNADO);

      expect(tx.solicitudTrabajoAdicional.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            tenantId: TENANT,
            OR: [
              { employeeIdSolicitante: ASIGNADO },
              { employeeIdAsignado: ASIGNADO },
            ],
          }),
        }),
      );
    });
  });

  describe('obtenerSolicitud', () => {
    it('retorna null si no existe', async () => {
      const tx = mockTx();
      const service = crearServicio();

      const resultado = await service.obtenerSolicitud(tx, 'sol-999');

      expect(resultado).toBeNull();
    });
  });

  describe('actualizarEstado', () => {
    it('rechaza solicitud inexistente', async () => {
      const tx = mockTx();
      const service = crearServicio();

      await expect(service.actualizarEstado(tx, 'sol-999', 'APROBADA', 'manager-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('rechaza transición inválida', async () => {
      const tx = mockTx();
      tx.solicitudTrabajoAdicional.findUnique.mockResolvedValue({ id: 'sol-1', estado: 'VALIDADA' });
      const service = crearServicio();

      await expect(service.actualizarEstado(tx, 'sol-1', 'APROBADA', 'manager-1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('PENDIENTE_APROBACION -> APROBADA registra managerId', async () => {
      const tx = mockTx();
      tx.solicitudTrabajoAdicional.findUnique.mockResolvedValue({ id: 'sol-1', estado: 'PENDIENTE_APROBACION' });
      const service = crearServicio();

      const resultado = await service.actualizarEstado(tx, 'sol-1', 'APROBADA', 'manager-1');

      expect(resultado.estado).toBe('APROBADA');
      expect(resultado.managerId).toBe('manager-1');
      expect(resultado.actualizadoPor).toBe('manager-1');
    });

    it('PENDIENTE_APROBACION -> RECHAZADA guarda motivoRechazo', async () => {
      const tx = mockTx();
      tx.solicitudTrabajoAdicional.findUnique.mockResolvedValue({ id: 'sol-1', estado: 'PENDIENTE_APROBACION' });
      const service = crearServicio();

      const resultado = await service.actualizarEstado(
        tx,
        'sol-1',
        'RECHAZADA',
        'manager-1',
        'No hay presupuesto disponible',
      );

      expect(resultado.estado).toBe('RECHAZADA');
      expect(resultado.motivoRechazo).toBe('No hay presupuesto disponible');
    });

    it('REPORTE_PENDIENTE_VALIDACION -> VALIDADA', async () => {
      const tx = mockTx();
      tx.solicitudTrabajoAdicional.findUnique.mockResolvedValue({
        id: 'sol-1',
        estado: 'REPORTE_PENDIENTE_VALIDACION',
      });
      const service = crearServicio();

      const resultado = await service.actualizarEstado(tx, 'sol-1', 'VALIDADA', 'manager-1');

      expect(resultado.estado).toBe('VALIDADA');
    });

    it('REPORTE_PENDIENTE_VALIDACION -> REPORTE_RECHAZADO guarda motivoRechazo', async () => {
      const tx = mockTx();
      tx.solicitudTrabajoAdicional.findUnique.mockResolvedValue({
        id: 'sol-1',
        estado: 'REPORTE_PENDIENTE_VALIDACION',
      });
      const service = crearServicio();

      const resultado = await service.actualizarEstado(
        tx,
        'sol-1',
        'REPORTE_RECHAZADO',
        'manager-1',
        'Fotos insuficientes',
      );

      expect(resultado.estado).toBe('REPORTE_RECHAZADO');
      expect(resultado.motivoRechazo).toBe('Fotos insuficientes');
    });
  });

  describe('enviarReporte', () => {
    const FOTO_VALIDA_1 = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAAAAAAAD/2wBD';
    const FOTO_VALIDA_2 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAUA';

    function reporteInput(overrides: any = {}) {
      return {
        tenantId: TENANT,
        id: 'sol-1',
        employeeId: ASIGNADO,
        reporteDescripcion: 'Tarea completada según lo solicitado',
        reporteFotos: [FOTO_VALIDA_1, FOTO_VALIDA_2],
        ...overrides,
      };
    }

    it('happy path desde APROBADA', async () => {
      const tx = mockTx();
      tx.solicitudTrabajoAdicional.findFirst.mockResolvedValue({
        id: 'sol-1',
        tenantId: TENANT,
        employeeIdAsignado: ASIGNADO,
        estado: 'APROBADA',
      });
      const service = crearServicio();

      const resultado = await service.enviarReporte(tx, reporteInput());

      expect(resultado.estado).toBe('REPORTE_PENDIENTE_VALIDACION');
      expect(resultado.reporteEnviadoEn).toBeInstanceOf(Date);
      expect(resultado.actualizadoPor).toBe(ASIGNADO);
    });

    it('rechaza solicitud inexistente', async () => {
      const tx = mockTx();
      const service = crearServicio();

      await expect(service.enviarReporte(tx, reporteInput())).rejects.toThrow(NotFoundException);
    });

    it('rechaza si quien reporta no es el empleado asignado', async () => {
      const tx = mockTx();
      tx.solicitudTrabajoAdicional.findFirst.mockResolvedValue({
        id: 'sol-1',
        tenantId: TENANT,
        employeeIdAsignado: 'otro-empleado',
        estado: 'APROBADA',
      });
      const service = crearServicio();

      await expect(service.enviarReporte(tx, reporteInput())).rejects.toThrow(BadRequestException);
    });

    it('rechaza desde un estado no permitido', async () => {
      const tx = mockTx();
      tx.solicitudTrabajoAdicional.findFirst.mockResolvedValue({
        id: 'sol-1',
        tenantId: TENANT,
        employeeIdAsignado: ASIGNADO,
        estado: 'PENDIENTE_APROBACION',
      });
      const service = crearServicio();

      await expect(service.enviarReporte(tx, reporteInput())).rejects.toThrow(BadRequestException);
    });

    it('rechaza con menos de 2 fotos', async () => {
      const tx = mockTx();
      tx.solicitudTrabajoAdicional.findFirst.mockResolvedValue({
        id: 'sol-1',
        tenantId: TENANT,
        employeeIdAsignado: ASIGNADO,
        estado: 'APROBADA',
      });
      const service = crearServicio();

      await expect(
        service.enviarReporte(tx, reporteInput({ reporteFotos: [FOTO_VALIDA_1] })),
      ).rejects.toThrow(BadRequestException);
    });

    it('rechaza fotos con formato inválido (no es data-URL de imagen)', async () => {
      const tx = mockTx();
      tx.solicitudTrabajoAdicional.findFirst.mockResolvedValue({
        id: 'sol-1',
        tenantId: TENANT,
        employeeIdAsignado: ASIGNADO,
        estado: 'APROBADA',
      });
      const service = crearServicio();

      await expect(
        service.enviarReporte(
          tx,
          reporteInput({ reporteFotos: [FOTO_VALIDA_1, '<script>alert(1)</script>'] }),
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('rechaza fotos con un mime type no permitido', async () => {
      const tx = mockTx();
      tx.solicitudTrabajoAdicional.findFirst.mockResolvedValue({
        id: 'sol-1',
        tenantId: TENANT,
        employeeIdAsignado: ASIGNADO,
        estado: 'APROBADA',
      });
      const service = crearServicio();

      await expect(
        service.enviarReporte(
          tx,
          reporteInput({
            reporteFotos: [FOTO_VALIDA_1, 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4='],
          }),
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('rechaza fotos que exceden el tamaño máximo (~7MB en base64)', async () => {
      const tx = mockTx();
      tx.solicitudTrabajoAdicional.findFirst.mockResolvedValue({
        id: 'sol-1',
        tenantId: TENANT,
        employeeIdAsignado: ASIGNADO,
        estado: 'APROBADA',
      });
      const service = crearServicio();

      const fotoGigante = 'data:image/png;base64,' + 'A'.repeat(7_000_001);

      await expect(
        service.enviarReporte(tx, reporteInput({ reporteFotos: [FOTO_VALIDA_1, fotoGigante] })),
      ).rejects.toThrow(BadRequestException);
    });

    it('acepta fotos válidas en formato data-URL (jpeg y png)', async () => {
      const tx = mockTx();
      tx.solicitudTrabajoAdicional.findFirst.mockResolvedValue({
        id: 'sol-1',
        tenantId: TENANT,
        employeeIdAsignado: ASIGNADO,
        estado: 'APROBADA',
      });
      const service = crearServicio();

      const resultado = await service.enviarReporte(tx, reporteInput());

      expect(resultado.estado).toBe('REPORTE_PENDIENTE_VALIDACION');
    });

    it('permite reenvío desde REPORTE_RECHAZADO (reintentos infinitos)', async () => {
      const tx = mockTx();
      tx.solicitudTrabajoAdicional.findFirst.mockResolvedValue({
        id: 'sol-1',
        tenantId: TENANT,
        employeeIdAsignado: ASIGNADO,
        estado: 'REPORTE_RECHAZADO',
      });
      const service = crearServicio();

      const resultado = await service.enviarReporte(tx, reporteInput());

      expect(resultado.estado).toBe('REPORTE_PENDIENTE_VALIDACION');
    });
  });
});
