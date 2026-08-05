import { BadRequestException, NotFoundException, ConflictException } from '@nestjs/common';
import { ShiftsController } from './shifts.controller';

// Mock TenantContext and getTenantContext
let mockTenantContext: any = {
  tenantId: 't-1',
  userId: 'u-1',
  tx: {},
};

jest.mock('../../common/database/tenant-request-context', () => ({
  getTenantContext: () => mockTenantContext,
}));

function mockTx(overrides: any = {}) {
  return {
    rotacionPatron: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue(null),
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 'pat-1', ...data })),
      update: jest.fn(),
    },
    employee: {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn().mockResolvedValue({ id: 'emp-1', estado: 'activo' }),
    },
    turno: {
      findUnique: jest.fn().mockImplementation(({ where }: any) =>
        Promise.resolve({ id: `turno-${where.tenantId_codigo.codigo}`, codigo: where.tenantId_codigo.codigo })
      ),
    },
    ...overrides,
  };
}

describe('ShiftsController - Cambios de Turno', () => {
  let controller: ShiftsController;
  let mockSolicitudCambioTurnoService: any;
  let mockSolicitudCambioTurnoAplicadorService: any;
  let mockRequest: any;

  beforeEach(() => {
    mockSolicitudCambioTurnoService = {
      crearSolicitud: jest.fn(),
      listarSolicitudes: jest.fn(),
      listarMisSolicitudes: jest.fn(),
    };
    mockSolicitudCambioTurnoAplicadorService = {
      aprobarSolicitud: jest.fn(),
      rechazarSolicitud: jest.fn(),
    };

    mockRequest = {
      session: {
        permissions: ['shift.manage'],
      },
    };

    controller = new ShiftsController(
      {} as any, // shiftPlan
      {} as any, // planImport
      {} as any, // compensatorios
      {} as any, // compliance
      {} as any, // rotacionPatron
      {} as any, // rotacionAplicador
      mockSolicitudCambioTurnoService,
      mockSolicitudCambioTurnoAplicadorService,
      {} as any, // solicitudTrabajoAdicional
      {} as any, // solicitudTrabajoAdicionalAplicador
      {} as any, // notificacion
      {} as any, // intercambios
      {} as any, // intercambiosAplicador
    );

    mockTenantContext = {
      tenantId: 't-1',
      userId: 'u-1',
      tx: mockTx({
        employee: {
          findFirst: jest.fn().mockResolvedValue({ id: 'emp-1', nombre: 'Juan' }),
        },
        solicitudCambioTurno: {
          findUnique: jest.fn().mockResolvedValue(null),
          findFirst: jest.fn().mockResolvedValue(null),
        },
      }),
    };
  });

  describe('POST /turnos/cambios', () => {
    it('crearSolicitudCambio creates a shift change request', async () => {
      const dto = {
        fechaActual: '2026-08-15',
        turnoIdActual: 't-1',
        fechaNueva: '2026-08-20',
        turnoIdNuevo: 't-2',
        creadoPor: 'u-1',
      };
      const mockResult = {
        id: 'scr-1',
        estado: 'PENDIENTE',
        ...dto,
      };
      mockSolicitudCambioTurnoService.crearSolicitud.mockResolvedValue(mockResult);

      const resultado = await controller.crearSolicitudCambio(dto);

      expect(mockSolicitudCambioTurnoService.crearSolicitud).toHaveBeenCalledWith(
        mockTenantContext.tx,
        expect.objectContaining({
          tenantId: 't-1',
          employeeId: 'emp-1',
          creadoPor: 'u-1',
        })
      );
      expect(resultado).toEqual(mockResult);
    });

    it('crearSolicitudCambio rejects without fechaActual', async () => {
      const dto = {
        fechaNueva: '2026-08-20',
        creadoPor: 'u-1',
      };

      await expect(controller.crearSolicitudCambio(dto)).rejects.toThrow(
        'fechaActual, fechaNueva y creadoPor son obligatorios'
      );
    });

    it('crearSolicitudCambio rejects without fechaNueva', async () => {
      const dto = {
        fechaActual: '2026-08-15',
        creadoPor: 'u-1',
      };

      await expect(controller.crearSolicitudCambio(dto)).rejects.toThrow(
        'fechaActual, fechaNueva y creadoPor son obligatorios'
      );
    });

    it('crearSolicitudCambio rejects without creadoPor', async () => {
      const dto = {
        fechaActual: '2026-08-15',
        fechaNueva: '2026-08-20',
      };

      await expect(controller.crearSolicitudCambio(dto)).rejects.toThrow(
        'fechaActual, fechaNueva y creadoPor son obligatorios'
      );
    });

    it('crearSolicitudCambio rejects with invalid fecha format', async () => {
      const dto = {
        fechaActual: 'invalid',
        fechaNueva: '2026-08-20',
        creadoPor: 'u-1',
      };

      await expect(controller.crearSolicitudCambio(dto)).rejects.toThrow(
        'fechaActual inválida'
      );
    });

    it('crearSolicitudCambio throws when employee not found', async () => {
      mockTenantContext.tx.employee.findFirst.mockResolvedValue(null);
      const dto = {
        fechaActual: '2026-08-15',
        fechaNueva: '2026-08-20',
        creadoPor: 'u-1',
      };

      await expect(controller.crearSolicitudCambio(dto)).rejects.toThrow(
        'La sesión no tiene un empleado asociado'
      );
    });
  });

  describe('GET /turnos/cambios', () => {
    it('listarSolicitudesCambio returns all requests', async () => {
      const mockSolicitudes = [
        {
          id: 'scr-1',
          estado: 'PENDIENTE',
          fechaActual: new Date('2026-08-15'),
          fechaNueva: new Date('2026-08-20'),
        },
        {
          id: 'scr-2',
          estado: 'APROBADA',
          fechaActual: new Date('2026-08-10'),
          fechaNueva: new Date('2026-08-15'),
        },
      ];
      mockSolicitudCambioTurnoService.listarSolicitudes.mockResolvedValue(mockSolicitudes);

      const resultado = await controller.listarSolicitudesCambio(mockRequest);

      expect(mockSolicitudCambioTurnoService.listarSolicitudes).toHaveBeenCalledWith(
        mockTenantContext.tx,
        { tenantId: 't-1' }
      );
      expect(resultado).toEqual(mockSolicitudes);
    });

    it('listarSolicitudesCambio filters by estado', async () => {
      const mockSolicitudes = [{ id: 'scr-1', estado: 'PENDIENTE' }];
      mockSolicitudCambioTurnoService.listarSolicitudes.mockResolvedValue(mockSolicitudes);

      await controller.listarSolicitudesCambio(mockRequest, 'PENDIENTE');

      expect(mockSolicitudCambioTurnoService.listarSolicitudes).toHaveBeenCalledWith(
        mockTenantContext.tx,
        expect.objectContaining({
          tenantId: 't-1',
          estado: 'PENDIENTE',
        })
      );
    });

    it('listarSolicitudesCambio filters by employeeId', async () => {
      const mockSolicitudes = [{ id: 'scr-1', employeeId: 'emp-2' }];
      mockSolicitudCambioTurnoService.listarSolicitudes.mockResolvedValue(mockSolicitudes);

      await controller.listarSolicitudesCambio(mockRequest, undefined, 'emp-2');

      expect(mockSolicitudCambioTurnoService.listarSolicitudes).toHaveBeenCalledWith(
        mockTenantContext.tx,
        expect.objectContaining({
          tenantId: 't-1',
          employeeId: 'emp-2',
        })
      );
    });

    it('listarSolicitudesCambio filters by dates', async () => {
      const mockSolicitudes: any[] = [];
      mockSolicitudCambioTurnoService.listarSolicitudes.mockResolvedValue(mockSolicitudes);

      await controller.listarSolicitudesCambio(mockRequest, undefined, undefined, undefined, '2026-08-01', '2026-08-31');

      expect(mockSolicitudCambioTurnoService.listarSolicitudes).toHaveBeenCalledWith(
        mockTenantContext.tx,
        expect.objectContaining({
          tenantId: 't-1',
          fechaDesde: expect.any(Date),
          fechaHasta: expect.any(Date),
        })
      );
    });

    it('listarSolicitudesCambio removes motivoRechazo for non-managers', async () => {
      const mockSolicitudes = [
        { id: 'scr-1', estado: 'RECHAZADA', motivoRechazo: 'No aplica' }
      ];
      mockSolicitudCambioTurnoService.listarSolicitudes.mockResolvedValue(mockSolicitudes);
      const nonManagerRequest = { session: { permissions: ['shift.read'] } } as any;

      const resultado = await controller.listarSolicitudesCambio(nonManagerRequest);

      expect(resultado[0]).not.toHaveProperty('motivoRechazo');
    });

    it('listarSolicitudesCambio keeps motivoRechazo for managers', async () => {
      const mockSolicitudes = [
        { id: 'scr-1', estado: 'RECHAZADA', motivoRechazo: 'No aplica' }
      ];
      mockSolicitudCambioTurnoService.listarSolicitudes.mockResolvedValue(mockSolicitudes);

      const resultado = await controller.listarSolicitudesCambio(mockRequest);

      expect(resultado[0]).toHaveProperty('motivoRechazo');
    });
  });

  describe('GET /turnos/cambios/mios', () => {
    it('listarMisSolicitudesCambio returns user own requests', async () => {
      const mockSolicitudes = [
        { id: 'scr-1', employeeId: 'emp-1', estado: 'PENDIENTE' }
      ];
      mockSolicitudCambioTurnoService.listarMisSolicitudes.mockResolvedValue(mockSolicitudes);

      const resultado = await controller.listarMisSolicitudesCambio(mockRequest);

      expect(mockSolicitudCambioTurnoService.listarMisSolicitudes).toHaveBeenCalledWith(
        mockTenantContext.tx,
        't-1',
        'emp-1'
      );
      expect(resultado).toEqual(mockSolicitudes);
    });

    it('listarMisSolicitudesCambio removes motivoRechazo for non-managers', async () => {
      const mockSolicitudes = [
        { id: 'scr-1', estado: 'RECHAZADA', motivoRechazo: 'Razón privada' }
      ];
      mockSolicitudCambioTurnoService.listarMisSolicitudes.mockResolvedValue(mockSolicitudes);
      const nonManagerRequest = { session: { permissions: ['shift.read'] } } as any;

      const resultado = await controller.listarMisSolicitudesCambio(nonManagerRequest);

      expect(resultado[0]).not.toHaveProperty('motivoRechazo');
    });

    it('listarMisSolicitudesCambio throws when employee not found', async () => {
      mockTenantContext.tx.employee.findFirst.mockResolvedValue(null);

      await expect(controller.listarMisSolicitudesCambio(mockRequest)).rejects.toThrow(
        'La sesión no tiene un empleado asociado'
      );
    });
  });

  describe('PUT /turnos/cambios/:id/aprobar', () => {
    it('aprobarSolicitudCambio approves a request', async () => {
      const dto = { decididoPor: 'u-2' };
      const mockResult = {
        id: 'scr-1',
        estado: 'APROBADA',
        decididoPor: 'u-2',
      };
      mockSolicitudCambioTurnoAplicadorService.aprobarSolicitud.mockResolvedValue(mockResult);

      const resultado = await controller.aprobarSolicitudCambio(mockRequest, 'scr-1', dto);

      expect(mockSolicitudCambioTurnoAplicadorService.aprobarSolicitud).toHaveBeenCalledWith(
        mockTenantContext.tx,
        'scr-1',
        'u-2'
      );
      expect(resultado).toEqual(mockResult);
    });

    it('aprobarSolicitudCambio rejects without decididoPor', async () => {
      const dto = {};

      await expect(controller.aprobarSolicitudCambio(mockRequest, 'scr-1', dto)).rejects.toThrow(
        'decididoPor es obligatorio'
      );
    });

    it('aprobarSolicitudCambio removes motivoRechazo for non-managers', async () => {
      const dto = { decididoPor: 'u-2' };
      const mockResult = {
        id: 'scr-1',
        estado: 'APROBADA',
        motivoRechazo: null,
      };
      mockSolicitudCambioTurnoAplicadorService.aprobarSolicitud.mockResolvedValue(mockResult);
      const nonManagerRequest = { session: { permissions: ['shift.manage'] } } as any;

      const resultado = await controller.aprobarSolicitudCambio(nonManagerRequest, 'scr-1', dto);

      expect(resultado).toHaveProperty('motivoRechazo');
    });
  });

  describe('PUT /turnos/cambios/:id/rechazar', () => {
    it('rechazarSolicitudCambio rejects a request', async () => {
      const dto = { decididoPor: 'u-2', motivoRechazo: 'Conflicto de horario' };
      const mockResult = {
        id: 'scr-1',
        estado: 'RECHAZADA',
        motivoRechazo: 'Conflicto de horario',
        decididoPor: 'u-2',
      };
      mockSolicitudCambioTurnoAplicadorService.rechazarSolicitud.mockResolvedValue(mockResult);

      const resultado = await controller.rechazarSolicitudCambio(mockRequest, 'scr-1', dto);

      expect(mockSolicitudCambioTurnoAplicadorService.rechazarSolicitud).toHaveBeenCalledWith(
        mockTenantContext.tx,
        'scr-1',
        'u-2',
        'Conflicto de horario'
      );
      expect(resultado).toEqual(mockResult);
    });

    it('rechazarSolicitudCambio rejects without decididoPor', async () => {
      const dto = { motivoRechazo: 'Razón' };

      await expect(controller.rechazarSolicitudCambio(mockRequest, 'scr-1', dto)).rejects.toThrow(
        'decididoPor y motivoRechazo son obligatorios'
      );
    });

    it('rechazarSolicitudCambio rejects without motivoRechazo', async () => {
      const dto = { decididoPor: 'u-2' };

      await expect(controller.rechazarSolicitudCambio(mockRequest, 'scr-1', dto)).rejects.toThrow(
        'decididoPor y motivoRechazo son obligatorios'
      );
    });

    it('rechazarSolicitudCambio keeps motivoRechazo for managers', async () => {
      const dto = { decididoPor: 'u-2', motivoRechazo: 'Razón privada' };
      const mockResult = {
        id: 'scr-1',
        estado: 'RECHAZADA',
        motivoRechazo: 'Razón privada',
      };
      mockSolicitudCambioTurnoAplicadorService.rechazarSolicitud.mockResolvedValue(mockResult);

      const resultado = await controller.rechazarSolicitudCambio(mockRequest, 'scr-1', dto);

      expect(resultado).toHaveProperty('motivoRechazo', 'Razón privada');
    });
  });
});

describe('ShiftsController - Patrones', () => {
  let controller: ShiftsController;
  let mockRotacionPatronService: any;
  let mockRotacionAplicadorService: any;

  beforeEach(() => {
    mockRotacionPatronService = {
      listarPatrones: jest.fn(),
      crearPatron: jest.fn(),
      actualizarPatron: jest.fn(),
    };
    mockRotacionAplicadorService = {
      aplicarPatron: jest.fn(),
    };

    controller = new ShiftsController(
      {} as any, // shiftPlan
      {} as any, // planImport
      {} as any, // compensatorios
      {} as any, // compliance
      mockRotacionPatronService,
      mockRotacionAplicadorService,
      {} as any, // solicitudCambioTurno
      {} as any, // solicitudCambioTurnoAplicador
      {} as any, // solicitudTrabajoAdicional
      {} as any, // solicitudTrabajoAdicionalAplicador
      {} as any, // notificacion
      {} as any, // intercambios
      {} as any, // intercambiosAplicador
    );

    mockTenantContext = {
      tenantId: 't-1',
      userId: 'u-1',
      tx: mockTx(),
    };
  });

  describe('GET /turnos/patrones', () => {
    it('listarPatrones returns active patterns', async () => {
      const mockPatrones = [
        { id: 'pat-1', nombre: '2-2-2-1', activo: true },
        { id: 'pat-2', nombre: '3-3-1', activo: true },
      ];
      mockRotacionPatronService.listarPatrones.mockResolvedValue(mockPatrones);

      const resultado = await controller.listarPatrones();

      expect(mockRotacionPatronService.listarPatrones).toHaveBeenCalledWith(
        mockTenantContext.tx,
        't-1',
        false
      );
      expect(resultado).toEqual(mockPatrones);
    });

    it('listarPatrones includes inactive when flag is set', async () => {
      const mockPatrones = [{ id: 'pat-1', nombre: '2-2-2-1', activo: false }];
      mockRotacionPatronService.listarPatrones.mockResolvedValue(mockPatrones);

      const resultado = await controller.listarPatrones('true');

      expect(mockRotacionPatronService.listarPatrones).toHaveBeenCalledWith(
        mockTenantContext.tx,
        't-1',
        true
      );
      expect(resultado).toEqual(mockPatrones);
    });

    it('listarPatrones throws when tenant context is missing', async () => {
      mockTenantContext.tenantId = null;

      await expect(controller.listarPatrones()).rejects.toThrow(
        'Request sin tenant o usuario resuelto'
      );
    });
  });

  describe('POST /turnos/patrones', () => {
    it('crearPatron creates pattern with validation', async () => {
      const patronInput = {
        nombre: '2-2-2-1',
        descripcion: 'Patrón de prueba',
        secuencia: ['DIA', 'DIA', 'NOCHE', 'NOCHE', 'DESC', 'DESC', 'DESC'],
      };
      const mockResult = { id: 'pat-1', ...patronInput, duracionCiclo: 7, creadoPor: 'u-1' };
      mockRotacionPatronService.crearPatron.mockResolvedValue(mockResult);

      const resultado = await controller.crearPatron(patronInput);

      expect(mockRotacionPatronService.crearPatron).toHaveBeenCalledWith(
        mockTenantContext.tx,
        expect.objectContaining({
          tenantId: 't-1',
          nombre: '2-2-2-1',
          descripcion: 'Patrón de prueba',
          secuencia: ['DIA', 'DIA', 'NOCHE', 'NOCHE', 'DESC', 'DESC', 'DESC'],
          duracionCiclo: 7,
          creadoPor: 'u-1',
        })
      );
      expect(resultado).toEqual(mockResult);
    });

    it('crearPatron rejects without nombre', async () => {
      const patronInput = {
        secuencia: ['DIA', 'DIA', 'NOCHE', 'NOCHE', 'DESC', 'DESC', 'DESC'],
      };

      await expect(controller.crearPatron(patronInput)).rejects.toThrow(
        'nombre y secuencia (array) son obligatorios'
      );
    });

    it('crearPatron rejects without secuencia', async () => {
      const patronInput = {
        nombre: '2-2-2-1',
      };

      await expect(controller.crearPatron(patronInput)).rejects.toThrow(
        'nombre y secuencia (array) son obligatorios'
      );
    });

    it('crearPatron rejects with non-array secuencia', async () => {
      const patronInput = {
        nombre: '2-2-2-1',
        secuencia: 'DIA,NOCHE,DESC',
      };

      await expect(controller.crearPatron(patronInput)).rejects.toThrow(
        'nombre y secuencia (array) son obligatorios'
      );
    });

    it('crearPatron rejects when service throws ConflictException', async () => {
      const patronInput = {
        nombre: '2-2-2-1',
        secuencia: ['DIA', 'DIA', 'NOCHE', 'NOCHE', 'DESC', 'DESC', 'DESC'],
      };
      mockRotacionPatronService.crearPatron.mockRejectedValue(
        new ConflictException('Ya existe un patrón con este nombre')
      );

      await expect(controller.crearPatron(patronInput)).rejects.toThrow(ConflictException);
    });

    it('crearPatron throws when tenant context is missing', async () => {
      mockTenantContext.tenantId = null;

      await expect(
        controller.crearPatron({
          nombre: '2-2-2-1',
          secuencia: ['DIA', 'DIA', 'NOCHE', 'NOCHE', 'DESC', 'DESC', 'DESC'],
        })
      ).rejects.toThrow('Request sin tenant o usuario resuelto');
    });
  });

  describe('PUT /turnos/patrones/:id', () => {
    it('actualizarPatron updates pattern', async () => {
      const cambios = {
        nombre: '3-3-1',
        descripcion: 'Descripción actualizada',
      };
      const mockResult = { id: 'pat-1', ...cambios, activo: true };
      mockRotacionPatronService.actualizarPatron.mockResolvedValue(mockResult);

      const resultado = await controller.actualizarPatron('pat-1', cambios);

      expect(mockRotacionPatronService.actualizarPatron).toHaveBeenCalledWith(
        mockTenantContext.tx,
        'pat-1',
        expect.objectContaining({
          nombre: '3-3-1',
          descripcion: 'Descripción actualizada',
          actualizadoPor: 'u-1',
        })
      );
      expect(resultado).toEqual(mockResult);
    });

    it('actualizarPatron rejects non-existent pattern', async () => {
      mockRotacionPatronService.actualizarPatron.mockRejectedValue(
        new NotFoundException('Patrón pat-999 no encontrado')
      );

      await expect(controller.actualizarPatron('pat-999', { nombre: 'X' })).rejects.toThrow(
        NotFoundException
      );
    });

    it('actualizarPatron adds actualizadoPor to changes', async () => {
      const cambios = { activo: false };
      mockRotacionPatronService.actualizarPatron.mockResolvedValue({ id: 'pat-1', ...cambios });

      await controller.actualizarPatron('pat-1', cambios);

      expect(mockRotacionPatronService.actualizarPatron).toHaveBeenCalledWith(
        mockTenantContext.tx,
        'pat-1',
        expect.objectContaining({
          activo: false,
          actualizadoPor: 'u-1',
        })
      );
    });

    it('actualizarPatron throws when tenant context is missing', async () => {
      mockTenantContext.userId = null;

      await expect(
        controller.actualizarPatron('pat-1', { nombre: 'X' })
      ).rejects.toThrow('Request sin tenant o usuario resuelto');
    });
  });

  describe('POST /turnos/patrones/:id/aplicar', () => {
    it('aplicarPatron injects pattern to employees', async () => {
      const aplicarInput = {
        employeeIds: ['emp-1', 'emp-2', 'emp-3'],
        desde: '2026-08-01',
        hasta: '2026-08-31',
        diaInicioCiclo: '2026-08-04',
      };
      const mockResult = { procesadas: 93, errores: [] };
      mockRotacionAplicadorService.aplicarPatron.mockResolvedValue(mockResult);

      const resultado = await controller.aplicarPatron('pat-1', aplicarInput);

      expect(mockRotacionAplicadorService.aplicarPatron).toHaveBeenCalledWith(
        mockTenantContext.tx,
        expect.objectContaining({
          tenantId: 't-1',
          patronId: 'pat-1',
          employeeIds: ['emp-1', 'emp-2', 'emp-3'],
          desde: expect.any(Date),
          hasta: expect.any(Date),
          diaInicioCiclo: expect.any(Date),
          creadoPor: 'u-1',
        })
      );
      expect(resultado).toEqual(mockResult);
    });

    it('aplicarPatron includes adjustments when provided', async () => {
      const aplicarInput = {
        employeeIds: ['emp-1'],
        desde: '2026-08-01',
        hasta: '2026-08-31',
        diaInicioCiclo: '2026-08-04',
        ajustes: [{ fecha: '2026-08-15', tipoDia: 'DESC' }],
      };
      const mockResult = { procesadas: 31, errores: [] };
      mockRotacionAplicadorService.aplicarPatron.mockResolvedValue(mockResult);

      const resultado = await controller.aplicarPatron('pat-1', aplicarInput);

      expect(mockRotacionAplicadorService.aplicarPatron).toHaveBeenCalledWith(
        mockTenantContext.tx,
        expect.objectContaining({
          ajustes: [{ fecha: '2026-08-15', tipoDia: 'DESC' }],
        })
      );
      expect(resultado).toEqual(mockResult);
    });

    it('aplicarPatron rejects without employeeIds', async () => {
      const aplicarInput = {
        desde: '2026-08-01',
        hasta: '2026-08-31',
        diaInicioCiclo: '2026-08-04',
      };

      await expect(controller.aplicarPatron('pat-1', aplicarInput)).rejects.toThrow(
        'employeeIds (array), desde, hasta y diaInicioCiclo son obligatorios'
      );
    });

    it('aplicarPatron rejects with non-array employeeIds', async () => {
      const aplicarInput = {
        employeeIds: 'emp-1,emp-2',
        desde: '2026-08-01',
        hasta: '2026-08-31',
        diaInicioCiclo: '2026-08-04',
      };

      await expect(controller.aplicarPatron('pat-1', aplicarInput)).rejects.toThrow(
        'employeeIds (array), desde, hasta y diaInicioCiclo son obligatorios'
      );
    });

    it('aplicarPatron rejects without desde', async () => {
      const aplicarInput = {
        employeeIds: ['emp-1'],
        hasta: '2026-08-31',
        diaInicioCiclo: '2026-08-04',
      };

      await expect(controller.aplicarPatron('pat-1', aplicarInput)).rejects.toThrow(
        'employeeIds (array), desde, hasta y diaInicioCiclo son obligatorios'
      );
    });

    it('aplicarPatron rejects without hasta', async () => {
      const aplicarInput = {
        employeeIds: ['emp-1'],
        desde: '2026-08-01',
        diaInicioCiclo: '2026-08-04',
      };

      await expect(controller.aplicarPatron('pat-1', aplicarInput)).rejects.toThrow(
        'employeeIds (array), desde, hasta y diaInicioCiclo son obligatorios'
      );
    });

    it('aplicarPatron rejects without diaInicioCiclo', async () => {
      const aplicarInput = {
        employeeIds: ['emp-1'],
        desde: '2026-08-01',
        hasta: '2026-08-31',
      };

      await expect(controller.aplicarPatron('pat-1', aplicarInput)).rejects.toThrow(
        'employeeIds (array), desde, hasta y diaInicioCiclo son obligatorios'
      );
    });

    it('aplicarPatron validates date format for desde', async () => {
      const aplicarInput = {
        employeeIds: ['emp-1'],
        desde: 'invalid-date',
        hasta: '2026-08-31',
        diaInicioCiclo: '2026-08-04',
      };

      await expect(controller.aplicarPatron('pat-1', aplicarInput)).rejects.toThrow(
        'desde inválida'
      );
    });

    it('aplicarPatron validates date format for hasta', async () => {
      const aplicarInput = {
        employeeIds: ['emp-1'],
        desde: '2026-08-01',
        hasta: 'invalid-date',
        diaInicioCiclo: '2026-08-04',
      };

      await expect(controller.aplicarPatron('pat-1', aplicarInput)).rejects.toThrow(
        'hasta inválida'
      );
    });

    it('aplicarPatron validates date format for diaInicioCiclo', async () => {
      const aplicarInput = {
        employeeIds: ['emp-1'],
        desde: '2026-08-01',
        hasta: '2026-08-31',
        diaInicioCiclo: 'invalid-date',
      };

      await expect(controller.aplicarPatron('pat-1', aplicarInput)).rejects.toThrow(
        'diaInicioCiclo inválida'
      );
    });

    it('aplicarPatron rejects when service returns errors', async () => {
      const aplicarInput = {
        employeeIds: ['emp-1', 'emp-2'],
        desde: '2026-08-01',
        hasta: '2026-08-31',
        diaInicioCiclo: '2026-08-04',
      };
      const mockResult = {
        procesadas: 31,
        errores: [{ employeeId: 'emp-2', mensaje: 'Empleado no encontrado' }],
      };
      mockRotacionAplicadorService.aplicarPatron.mockResolvedValue(mockResult);

      const resultado = await controller.aplicarPatron('pat-1', aplicarInput);

      expect(resultado).toEqual(mockResult);
      expect(resultado.errores.length).toBeGreaterThan(0);
    });

    it('aplicarPatron throws when tenant context is missing', async () => {
      mockTenantContext.tenantId = null;

      await expect(
        controller.aplicarPatron('pat-1', {
          employeeIds: ['emp-1'],
          desde: '2026-08-01',
          hasta: '2026-08-31',
          diaInicioCiclo: '2026-08-04',
        })
      ).rejects.toThrow('Request sin tenant o usuario resuelto');
    });
  });
});

describe('ShiftsController - Trabajo Fuera de Turno', () => {
  let controller: ShiftsController;
  let mockSolicitudTrabajoAdicionalService: any;
  let mockSolicitudTrabajoAdicionalAplicadorService: any;
  let mockNotificationService: any;
  let mockRequest: any;
  let mockManagerRequest: any;

  beforeEach(() => {
    mockSolicitudTrabajoAdicionalService = {
      crearSolicitud: jest.fn(),
      listarSolicitudes: jest.fn(),
      listarMisSolicitudes: jest.fn(),
      obtenerSolicitud: jest.fn(),
      enviarReporte: jest.fn(),
    };
    mockSolicitudTrabajoAdicionalAplicadorService = {
      aprobarSolicitud: jest.fn(),
      reasignarSolicitud: jest.fn(),
      rechazarSolicitud: jest.fn(),
      validarReporte: jest.fn(),
      rechazarReporte: jest.fn(),
    };
    mockNotificationService = {
      notificarSolicitudTrabajoCreada: jest.fn().mockResolvedValue(undefined),
      notificarReporteEnviado: jest.fn().mockResolvedValue(undefined),
    };

    mockManagerRequest = { session: { permissions: ['shift.manage'] } };
    mockRequest = { session: { permissions: ['shift.read'] } };

    controller = new ShiftsController(
      {} as any, // shiftPlan
      {} as any, // planImport
      {} as any, // compensatorios
      {} as any, // compliance
      {} as any, // rotacionPatron
      {} as any, // rotacionAplicador
      {} as any, // solicitudCambioTurno
      {} as any, // solicitudCambioTurnoAplicador
      mockSolicitudTrabajoAdicionalService,
      mockSolicitudTrabajoAdicionalAplicadorService,
      mockNotificationService,
      {} as any, // intercambios
      {} as any, // intercambiosAplicador
    );

    mockTenantContext = {
      tenantId: 't-1',
      userId: 'u-1',
      tx: mockTx({
        employee: {
          findFirst: jest.fn().mockResolvedValue({ id: 'emp-1' }),
        },
      }),
    };
  });

  describe('POST /turnos/trabajo-adicional/solicitar', () => {
    it('creates a work-outside-shift request and notifies manager', async () => {
      const dto = {
        descripcionTarea: 'Reparar equipo',
        fechaEstimada: '2026-08-15',
        horasEstimadas: 4,
        urgencia: 'NORMAL',
      };
      const mockResult = {
        id: 'sta-1',
        estado: 'PENDIENTE_APROBACION',
        causaHorasExtras: false,
        horasAcumuladas: 4,
        saldoCompensatorios: 0,
      };
      mockSolicitudTrabajoAdicionalService.crearSolicitud.mockResolvedValue(mockResult);

      const resultado = await controller.solicitarTrabajoAdicional(mockManagerRequest, dto);

      expect(mockSolicitudTrabajoAdicionalService.crearSolicitud).toHaveBeenCalledWith(
        mockTenantContext.tx,
        expect.objectContaining({
          tenantId: 't-1',
          employeeIdSolicitante: 'emp-1',
          employeeIdAsignado: 'emp-1',
          descripcionTarea: 'Reparar equipo',
          horasEstimadas: 4,
          urgencia: 'NORMAL',
          creadoPor: 'u-1',
        })
      );
      expect(mockNotificationService.notificarSolicitudTrabajoCreada).toHaveBeenCalled();
      expect(resultado).toEqual(mockResult);
    });

    it('rejects without descripcionTarea', async () => {
      const dto = { fechaEstimada: '2026-08-15', horasEstimadas: 4, urgencia: 'NORMAL' };

      await expect(controller.solicitarTrabajoAdicional(mockRequest, dto)).rejects.toThrow(
        'descripcionTarea, fechaEstimada, horasEstimadas y urgencia son obligatorios'
      );
    });

    it('throws when employee not found', async () => {
      mockTenantContext.tx.employee.findFirst.mockResolvedValue(null);
      const dto = {
        descripcionTarea: 'Reparar equipo',
        fechaEstimada: '2026-08-15',
        horasEstimadas: 4,
        urgencia: 'NORMAL',
      };

      await expect(controller.solicitarTrabajoAdicional(mockRequest, dto)).rejects.toThrow(
        'La sesión no tiene un empleado asociado'
      );
    });

    it('ignores a client-supplied employeeIdAsignado and always uses the resolved employee.id', async () => {
      const dto = {
        descripcionTarea: 'Reparar equipo',
        fechaEstimada: '2026-08-15',
        horasEstimadas: 4,
        urgencia: 'NORMAL',
        employeeIdAsignado: 'emp-foraneo-otro-tenant',
      };
      mockSolicitudTrabajoAdicionalService.crearSolicitud.mockResolvedValue({ id: 'sta-1' });

      await controller.solicitarTrabajoAdicional(mockManagerRequest, dto);

      expect(mockSolicitudTrabajoAdicionalService.crearSolicitud).toHaveBeenCalledWith(
        mockTenantContext.tx,
        expect.objectContaining({
          employeeIdSolicitante: 'emp-1',
          employeeIdAsignado: 'emp-1',
        })
      );
    });

    it('removes private fields for non-managers', async () => {
      const dto = {
        descripcionTarea: 'Reparar equipo',
        fechaEstimada: '2026-08-15',
        horasEstimadas: 4,
        urgencia: 'NORMAL',
      };
      mockSolicitudTrabajoAdicionalService.crearSolicitud.mockResolvedValue({
        id: 'sta-1',
        causaHorasExtras: true,
        horasAcumuladas: 50,
        saldoCompensatorios: 2,
      });

      const resultado = await controller.solicitarTrabajoAdicional(mockRequest, dto);

      expect(resultado).not.toHaveProperty('causaHorasExtras');
      expect(resultado).not.toHaveProperty('horasAcumuladas');
      expect(resultado).not.toHaveProperty('saldoCompensatorios');
    });
  });

  describe('GET /turnos/trabajo-adicional/mis-solicitudes', () => {
    it('returns own requests', async () => {
      const mockSolicitudes = [{ id: 'sta-1', employeeIdSolicitante: 'emp-1' }];
      mockSolicitudTrabajoAdicionalService.listarMisSolicitudes.mockResolvedValue(mockSolicitudes);

      const resultado = await controller.listarMisSolicitudesTrabajoAdicional(mockRequest);

      expect(mockSolicitudTrabajoAdicionalService.listarMisSolicitudes).toHaveBeenCalledWith(
        mockTenantContext.tx,
        't-1',
        'emp-1'
      );
      expect(resultado).toEqual(mockSolicitudes);
    });

    it('throws when employee not found', async () => {
      mockTenantContext.tx.employee.findFirst.mockResolvedValue(null);

      await expect(controller.listarMisSolicitudesTrabajoAdicional(mockRequest)).rejects.toThrow(
        'La sesión no tiene un empleado asociado'
      );
    });
  });

  describe('GET /turnos/trabajo-adicional/pendientes', () => {
    it('lists pending requests with fixed estado filter', async () => {
      const mockSolicitudes = [{ id: 'sta-1', estado: 'PENDIENTE_APROBACION' }];
      mockSolicitudTrabajoAdicionalService.listarSolicitudes.mockResolvedValue(mockSolicitudes);

      const resultado = await controller.listarTrabajoAdicionalPendientes(mockManagerRequest);

      expect(mockSolicitudTrabajoAdicionalService.listarSolicitudes).toHaveBeenCalledWith(
        mockTenantContext.tx,
        expect.objectContaining({ tenantId: 't-1', estado: 'PENDIENTE_APROBACION' })
      );
      expect(resultado).toEqual(mockSolicitudes);
    });

    it('applies optional filters', async () => {
      mockSolicitudTrabajoAdicionalService.listarSolicitudes.mockResolvedValue([]);

      await controller.listarTrabajoAdicionalPendientes(
        mockManagerRequest, 'emp-2', '2026-08-01', '2026-08-31',
      );

      expect(mockSolicitudTrabajoAdicionalService.listarSolicitudes).toHaveBeenCalledWith(
        mockTenantContext.tx,
        expect.objectContaining({
          employeeId: 'emp-2',
          fechaDesde: expect.any(Date),
          fechaHasta: expect.any(Date),
        })
      );
    });
  });

  describe('GET /turnos/trabajo-adicional/validar', () => {
    it('lists requests pending validation with fixed estado filter', async () => {
      const mockSolicitudes = [{ id: 'sta-1', estado: 'REPORTE_PENDIENTE_VALIDACION' }];
      mockSolicitudTrabajoAdicionalService.listarSolicitudes.mockResolvedValue(mockSolicitudes);

      const resultado = await controller.listarTrabajoAdicionalParaValidar(mockManagerRequest);

      expect(mockSolicitudTrabajoAdicionalService.listarSolicitudes).toHaveBeenCalledWith(
        mockTenantContext.tx,
        expect.objectContaining({ tenantId: 't-1', estado: 'REPORTE_PENDIENTE_VALIDACION' })
      );
      expect(resultado).toEqual(mockSolicitudes);
    });
  });

  describe('PUT /turnos/trabajo-adicional/:id/aprobar', () => {
    it('resolves the manager Employee.id server-side and ignores any client-supplied managerId', async () => {
      const mockResult = { id: 'sta-1', estado: 'APROBADA' };
      mockSolicitudTrabajoAdicionalAplicadorService.aprobarSolicitud.mockResolvedValue(mockResult);

      const resultado = await controller.aprobarTrabajoAdicional(mockManagerRequest, 'sta-1');

      // manager.id ('emp-1') resuelto vía ctx.tx.employee.findFirst({ where: { userId } }),
      // NUNCA un valor tomado de dto.managerId (que el frontend enviaba como User.id).
      expect(mockSolicitudTrabajoAdicionalAplicadorService.aprobarSolicitud).toHaveBeenCalledWith(
        mockTenantContext.tx, 't-1', 'sta-1', 'emp-1',
      );
      expect(resultado).toEqual(mockResult);
    });

    it('throws when the caller has no associated employee', async () => {
      mockTenantContext.tx.employee.findFirst.mockResolvedValue(null);

      await expect(
        controller.aprobarTrabajoAdicional(mockManagerRequest, 'sta-1')
      ).rejects.toThrow('La sesión no tiene un empleado asociado');
    });
  });

  describe('PUT /turnos/trabajo-adicional/:id/reasignar', () => {
    it('resolves the manager Employee.id server-side and ignores any client-supplied managerId', async () => {
      const dto = { managerId: 'mgr-suplantado', employeeIdNuevo: 'emp-2' };
      const mockResult = { id: 'sta-1', estado: 'REASIGNADA', employeeIdAsignado: 'emp-2' };
      mockSolicitudTrabajoAdicionalAplicadorService.reasignarSolicitud.mockResolvedValue(mockResult);

      const resultado = await controller.reasignarTrabajoAdicional(mockManagerRequest, 'sta-1', dto);

      expect(mockSolicitudTrabajoAdicionalAplicadorService.reasignarSolicitud).toHaveBeenCalledWith(
        mockTenantContext.tx, 't-1', 'sta-1', 'emp-2', 'emp-1',
      );
      expect(resultado).toEqual(mockResult);
      expect(resultado).not.toHaveProperty('emailEnviado');
    });

    it('rejects without employeeIdNuevo', async () => {
      await expect(
        controller.reasignarTrabajoAdicional(mockManagerRequest, 'sta-1', {})
      ).rejects.toThrow('employeeIdNuevo es obligatorio');
    });

    it('throws when the caller has no associated employee', async () => {
      mockTenantContext.tx.employee.findFirst.mockResolvedValue(null);

      await expect(
        controller.reasignarTrabajoAdicional(mockManagerRequest, 'sta-1', { employeeIdNuevo: 'emp-2' })
      ).rejects.toThrow('La sesión no tiene un empleado asociado');
    });
  });

  describe('PUT /turnos/trabajo-adicional/:id/rechazar', () => {
    it('resolves the manager Employee.id server-side and ignores any client-supplied managerId', async () => {
      const dto = { managerId: 'mgr-suplantado', motivoRechazo: 'No procede' };
      const mockResult = { id: 'sta-1', estado: 'RECHAZADA', motivoRechazo: 'No procede' };
      mockSolicitudTrabajoAdicionalAplicadorService.rechazarSolicitud.mockResolvedValue(mockResult);

      const resultado = await controller.rechazarTrabajoAdicional(mockManagerRequest, 'sta-1', dto);

      expect(mockSolicitudTrabajoAdicionalAplicadorService.rechazarSolicitud).toHaveBeenCalledWith(
        mockTenantContext.tx, 't-1', 'sta-1', 'emp-1', 'No procede',
      );
      expect(resultado).toEqual(mockResult);
    });

    it('throws when the caller has no associated employee', async () => {
      mockTenantContext.tx.employee.findFirst.mockResolvedValue(null);

      await expect(
        controller.rechazarTrabajoAdicional(mockManagerRequest, 'sta-1', { motivoRechazo: 'X' })
      ).rejects.toThrow('La sesión no tiene un empleado asociado');
    });
  });

  describe('GET /turnos/trabajo-adicional/:id', () => {
    it('returns a request by id for a manager', async () => {
      const mockResult = {
        id: 'sta-1',
        estado: 'PENDIENTE_APROBACION',
        employeeIdSolicitante: 'emp-otro',
        employeeIdAsignado: 'emp-otro2',
      };
      mockSolicitudTrabajoAdicionalService.obtenerSolicitud.mockResolvedValue(mockResult);

      const resultado = await controller.obtenerTrabajoAdicional(mockManagerRequest, 'sta-1');

      expect(mockSolicitudTrabajoAdicionalService.obtenerSolicitud).toHaveBeenCalledWith(
        mockTenantContext.tx, 'sta-1',
      );
      expect(resultado).toEqual(mockResult);
    });

    it('returns a request by id for the solicitante owner', async () => {
      const mockResult = {
        id: 'sta-1',
        estado: 'PENDIENTE_APROBACION',
        employeeIdSolicitante: 'emp-1',
        employeeIdAsignado: 'emp-otro',
      };
      mockSolicitudTrabajoAdicionalService.obtenerSolicitud.mockResolvedValue(mockResult);

      const resultado = await controller.obtenerTrabajoAdicional(mockRequest, 'sta-1');

      expect(resultado).toEqual(mockResult);
    });

    it('returns a request by id for the asignado owner', async () => {
      const mockResult = {
        id: 'sta-1',
        estado: 'PENDIENTE_APROBACION',
        employeeIdSolicitante: 'emp-otro',
        employeeIdAsignado: 'emp-1',
      };
      mockSolicitudTrabajoAdicionalService.obtenerSolicitud.mockResolvedValue(mockResult);

      const resultado = await controller.obtenerTrabajoAdicional(mockRequest, 'sta-1');

      expect(resultado).toEqual(mockResult);
    });

    it('throws NotFoundException for a non-owner, non-manager caller', async () => {
      const mockResult = {
        id: 'sta-1',
        estado: 'PENDIENTE_APROBACION',
        employeeIdSolicitante: 'emp-otro',
        employeeIdAsignado: 'emp-otro2',
      };
      mockSolicitudTrabajoAdicionalService.obtenerSolicitud.mockResolvedValue(mockResult);

      await expect(
        controller.obtenerTrabajoAdicional(mockRequest, 'sta-1')
      ).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException when missing', async () => {
      mockSolicitudTrabajoAdicionalService.obtenerSolicitud.mockResolvedValue(null);

      await expect(
        controller.obtenerTrabajoAdicional(mockManagerRequest, 'sta-999')
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('POST /turnos/trabajo-adicional/:id/reporte', () => {
    it('submits a report and notifies the manager', async () => {
      const dto = { reporteDescripcion: 'Listo', reporteFotos: ['a.jpg', 'b.jpg'] };
      const mockResult = {
        id: 'sta-1',
        estado: 'REPORTE_PENDIENTE_VALIDACION',
        managerId: 'mgr-1',
        descripcionTarea: 'Reparar equipo',
        fechaEstimada: new Date('2026-08-15'),
      };
      mockSolicitudTrabajoAdicionalService.enviarReporte.mockResolvedValue(mockResult);

      const resultado = await controller.enviarReporteTrabajoAdicional(mockRequest, 'sta-1', dto);

      expect(mockSolicitudTrabajoAdicionalService.enviarReporte).toHaveBeenCalledWith(
        mockTenantContext.tx,
        expect.objectContaining({
          tenantId: 't-1',
          id: 'sta-1',
          employeeId: 'emp-1',
          reporteDescripcion: 'Listo',
          reporteFotos: ['a.jpg', 'b.jpg'],
        })
      );
      expect(mockNotificationService.notificarReporteEnviado).toHaveBeenCalledWith(
        't-1', 'mgr-1', 'Reparar equipo', mockResult.fechaEstimada,
      );
      expect(resultado).toEqual(mockResult);
    });

    it('skips notification when managerId is null', async () => {
      const dto = { reporteDescripcion: 'Listo', reporteFotos: ['a.jpg', 'b.jpg'] };
      mockSolicitudTrabajoAdicionalService.enviarReporte.mockResolvedValue({
        id: 'sta-1',
        managerId: null,
      });

      await controller.enviarReporteTrabajoAdicional(mockRequest, 'sta-1', dto);

      expect(mockNotificationService.notificarReporteEnviado).not.toHaveBeenCalled();
    });

    it('rejects without reporteDescripcion', async () => {
      await expect(
        controller.enviarReporteTrabajoAdicional(mockRequest, 'sta-1', { reporteFotos: ['a.jpg', 'b.jpg'] })
      ).rejects.toThrow('reporteDescripcion y reporteFotos son obligatorios');
    });

    it('throws when employee not found', async () => {
      mockTenantContext.tx.employee.findFirst.mockResolvedValue(null);

      await expect(
        controller.enviarReporteTrabajoAdicional(mockRequest, 'sta-1', {
          reporteDescripcion: 'Listo',
          reporteFotos: ['a.jpg', 'b.jpg'],
        })
      ).rejects.toThrow('La sesión no tiene un empleado asociado');
    });
  });

  describe('PUT /turnos/trabajo-adicional/:id/validar', () => {
    it('resolves the manager Employee.id server-side and ignores any client-supplied managerId', async () => {
      const mockResult = { id: 'sta-1', estado: 'VALIDADA' };
      mockSolicitudTrabajoAdicionalAplicadorService.validarReporte.mockResolvedValue(mockResult);

      const resultado = await controller.validarReporteTrabajoAdicional(mockManagerRequest, 'sta-1');

      expect(mockSolicitudTrabajoAdicionalAplicadorService.validarReporte).toHaveBeenCalledWith(
        mockTenantContext.tx, 't-1', 'sta-1', 'emp-1',
      );
      expect(resultado).toEqual(mockResult);
    });

    it('throws when the caller has no associated employee', async () => {
      mockTenantContext.tx.employee.findFirst.mockResolvedValue(null);

      await expect(
        controller.validarReporteTrabajoAdicional(mockManagerRequest, 'sta-1')
      ).rejects.toThrow('La sesión no tiene un empleado asociado');
    });
  });

  describe('PUT /turnos/trabajo-adicional/:id/reporte-rechazar', () => {
    it('resolves the manager Employee.id server-side and ignores any client-supplied managerId', async () => {
      const dto = { managerId: 'mgr-suplantado', motivo: 'Fotos insuficientes' };
      const mockResult = { id: 'sta-1', estado: 'REPORTE_RECHAZADO', motivoRechazo: 'Fotos insuficientes' };
      mockSolicitudTrabajoAdicionalAplicadorService.rechazarReporte.mockResolvedValue(mockResult);

      const resultado = await controller.rechazarReporteTrabajoAdicional(mockManagerRequest, 'sta-1', dto);

      expect(mockSolicitudTrabajoAdicionalAplicadorService.rechazarReporte).toHaveBeenCalledWith(
        mockTenantContext.tx, 't-1', 'sta-1', 'emp-1', 'Fotos insuficientes',
      );
      expect(resultado).toEqual(mockResult);
    });

    it('throws when the caller has no associated employee', async () => {
      mockTenantContext.tx.employee.findFirst.mockResolvedValue(null);

      await expect(
        controller.rechazarReporteTrabajoAdicional(mockManagerRequest, 'sta-1', { motivo: 'X' })
      ).rejects.toThrow('La sesión no tiene un empleado asociado');
    });
  });
});

describe('ShiftsController - Portal de Intercambios', () => {
  let controller: ShiftsController;
  let mockIntercambios: any;
  let mockIntercambiosAplicador: any;
  let mockRequestEmpleado: any;
  let mockRequestManager: any;

  beforeEach(() => {
    mockTenantContext = { tenantId: 't-1', userId: 'u-a', tx: mockTx({
      employee: { findFirst: jest.fn().mockResolvedValue({ id: 'emp-a' }) },
    }) };

    mockIntercambios = {
      proponer: jest.fn(),
      listarMisPropuestas: jest.fn(),
      listarPropuestasParaMi: jest.fn(),
      aceptar: jest.fn(),
      rechazarPorB: jest.fn(),
    };
    mockIntercambiosAplicador = {
      barrido: jest.fn().mockResolvedValue(undefined),
      aprobar: jest.fn(),
      rechazarManager: jest.fn(),
    };

    mockRequestEmpleado = { session: { permissions: ['shift.read'] } };
    mockRequestManager = { session: { permissions: ['shift.resolve'] } };

    controller = new ShiftsController(
      {} as any, {} as any, {} as any, {} as any, {} as any, {} as any,
      {} as any, {} as any, {} as any, {} as any,
      { notificarIntercambioPropuesto: jest.fn(), notificarIntercambioAceptadoPorB: jest.fn(), notificarIntercambioRechazadoPorB: jest.fn() } as any,
      mockIntercambios,
      mockIntercambiosAplicador,
    );
  });

  it('POST proponer: crea la propuesta y notifica a B', async () => {
    mockIntercambios.proponer.mockResolvedValue({ id: 'int-1', employeeIdB: 'emp-b' });
    const dto = { employeeIdB: 'emp-b', fecha: '2026-09-10', mensajeA: 'Tengo cita' };

    const resultado = await controller.proponerIntercambio(mockRequestEmpleado, dto);

    expect(mockIntercambios.proponer).toHaveBeenCalled();
    expect(resultado.id).toBe('int-1');
  });

  it('POST proponer: 400 si falta employeeIdB o fecha', async () => {
    await expect(controller.proponerIntercambio(mockRequestEmpleado, { fecha: '2026-09-10' })).rejects.toThrow(
      BadRequestException,
    );
  });

  it('GET mis-propuestas: delega en el service con el employeeId resuelto', async () => {
    mockIntercambios.listarMisPropuestas.mockResolvedValue([]);
    await controller.listarMisPropuestasIntercambio(mockRequestEmpleado);
    expect(mockIntercambios.listarMisPropuestas).toHaveBeenCalledWith(expect.anything(), 't-1', 'emp-a');
  });

  it('PUT :id/aceptar: corre el barrido antes de aceptar', async () => {
    mockIntercambios.aceptar.mockResolvedValue({ id: 'int-1', estado: 'ACEPTADA_POR_B', employeeIdA: 'emp-a', employeeIdB: 'emp-a' });
    await controller.aceptarIntercambio(mockRequestEmpleado, 'int-1');
    expect(mockIntercambiosAplicador.barrido).toHaveBeenCalledWith(expect.anything(), 't-1');
    expect(mockIntercambios.aceptar).toHaveBeenCalled();
  });

  it('PUT :id/aprobar: requiere shift.resolve', async () => {
    mockIntercambiosAplicador.aprobar.mockResolvedValue({ id: 'int-1', estado: 'APROBADA_MANAGER' });
    const resultado = await controller.aprobarIntercambio(mockRequestManager, 'int-1');
    expect(resultado.estado).toBe('APROBADA_MANAGER');
  });

  it('PUT :id/rechazar-manager: pasa motivoRechazo', async () => {
    mockIntercambiosAplicador.rechazarManager.mockResolvedValue({ id: 'int-1', estado: 'RECHAZADA_MANAGER' });
    await controller.rechazarIntercambioManager(mockRequestManager, 'int-1', { motivoRechazo: 'Sin cobertura' });
    expect(mockIntercambiosAplicador.rechazarManager).toHaveBeenCalledWith(
      expect.anything(), 't-1', 'int-1', 'emp-a', 'Sin cobertura',
    );
  });
});
