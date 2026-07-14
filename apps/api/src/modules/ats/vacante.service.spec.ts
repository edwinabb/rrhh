import { VacanteService } from './vacante.service';

/**
 * Tests unitarios de VacanteService (ATS, Fase 4).
 * Mismo patrón que AttendanceService/PayrollRunService: los métodos reciben
 * el tx de Prisma como parámetro y aquí se mockea por completo — sin BD real.
 */
describe('VacanteService', () => {
  const TENANT = 'tenant-1';
  const USER = 'user-1';

  const vacanteAbierta = {
    id: 'vac-1',
    tenantId: TENANT,
    titulo: 'Desarrollador Senior',
    descripcion: 'Backend NestJS',
    requisitos: { skills: ['typescript'] },
    estado: 'ABIERTA',
    cerradaEn: null,
    creadoPor: USER,
  };

  function buildTx(overrides: Partial<Record<string, any>> = {}) {
    return {
      vacante: {
        create: jest
          .fn()
          .mockImplementation(({ data }) => Promise.resolve({ id: 'vac-nueva', ...data })),
        findMany: jest.fn().mockResolvedValue([vacanteAbierta]),
        findUnique: jest.fn().mockResolvedValue(vacanteAbierta),
        update: jest
          .fn()
          .mockImplementation(({ where, data }) => Promise.resolve({ ...vacanteAbierta, ...where, ...data })),
      },
      ...overrides,
    };
  }

  const service = new VacanteService();

  describe('crearVacante', () => {
    it('crea la vacante con estado ABIERTA por defecto', async () => {
      const tx = buildTx();

      const vacante = await service.crearVacante(tx, {
        tenantId: TENANT,
        titulo: 'Desarrollador Senior',
        descripcion: 'Backend NestJS',
        requisitos: { skills: ['typescript'] },
        creadoPor: USER,
      });

      expect(tx.vacante.create).toHaveBeenCalledTimes(1);
      const data = (tx.vacante.create as jest.Mock).mock.calls[0][0].data;
      expect(data.tenantId).toBe(TENANT);
      expect(data.estado).toBe('ABIERTA');
      expect(data.creadoPor).toBe(USER);
      expect(vacante.id).toBe('vac-nueva');
    });

    it('rechaza una vacante sin título', async () => {
      const tx = buildTx();

      await expect(
        service.crearVacante(tx, {
          tenantId: TENANT,
          titulo: '   ',
          descripcion: 'x',
          requisitos: {},
          creadoPor: USER,
        }),
      ).rejects.toThrow(/t[ií]tulo/i);
      expect(tx.vacante.create).not.toHaveBeenCalled();
    });
  });

  describe('listarVacantes', () => {
    it('lista por tenant y aplica el filtro de estado si se indica', async () => {
      const tx = buildTx();

      await service.listarVacantes(tx, { tenantId: TENANT, estado: 'ABIERTA' });

      expect(tx.vacante.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { tenantId: TENANT, estado: 'ABIERTA' },
        }),
      );
    });

    it('sin filtro de estado lista todas las vacantes del tenant', async () => {
      const tx = buildTx();

      await service.listarVacantes(tx, { tenantId: TENANT });

      const where = (tx.vacante.findMany as jest.Mock).mock.calls[0][0].where;
      expect(where).toEqual({ tenantId: TENANT });
    });
  });

  describe('cerrarVacante', () => {
    it('cierra la vacante fijando estado CERRADA y cerradaEn', async () => {
      const tx = buildTx();

      const cerrada = await service.cerrarVacante(tx, 'vac-1');

      expect(tx.vacante.update).toHaveBeenCalledTimes(1);
      const args = (tx.vacante.update as jest.Mock).mock.calls[0][0];
      expect(args.where).toEqual({ id: 'vac-1' });
      expect(args.data.estado).toBe('CERRADA');
      expect(args.data.cerradaEn).toBeInstanceOf(Date);
      expect(cerrada.estado).toBe('CERRADA');
    });

    it('lanza si la vacante no existe', async () => {
      const tx = buildTx({
        vacante: {
          findUnique: jest.fn().mockResolvedValue(null),
          update: jest.fn(),
        },
      });

      await expect(service.cerrarVacante(tx, 'no-existe')).rejects.toThrow(/no encontrada/i);
      expect(tx.vacante.update).not.toHaveBeenCalled();
    });

    it('lanza si la vacante ya está CERRADA', async () => {
      const tx = buildTx({
        vacante: {
          findUnique: jest
            .fn()
            .mockResolvedValue({ ...vacanteAbierta, estado: 'CERRADA', cerradaEn: new Date() }),
          update: jest.fn(),
        },
      });

      await expect(service.cerrarVacante(tx, 'vac-1')).rejects.toThrow(/CERRADA/);
      expect(tx.vacante.update).not.toHaveBeenCalled();
    });
  });
});
