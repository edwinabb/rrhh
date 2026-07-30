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
