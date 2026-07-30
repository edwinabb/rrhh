import { ConflictException, NotFoundException, BadRequestException } from '@nestjs/common';
import { RotacionPatronService } from './rotacion-patron.service';

function mockTx(overrides: any = {}) {
  return {
    rotacionPatron: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue(null),
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 'pat-1', ...data })),
      update: jest.fn(),
    },
    ...overrides,
  };
}

const service = new RotacionPatronService();

describe('RotacionPatronService', () => {
  it('crearPatron rechaza secuencia no-7', async () => {
    const tx = mockTx();
    await expect(
      service.crearPatron(tx, {
        tenantId: 't-1', nombre: 'X', secuencia: ['DIA', 'NOCHE'], duracionCiclo: 2
      })
    ).rejects.toThrow(BadRequestException);
  });

  it('crearPatron rechaza duplicate nombre', async () => {
    const tx = mockTx();
    tx.rotacionPatron.findFirst.mockResolvedValue({ id: 'pat-1' });
    await expect(
      service.crearPatron(tx, {
        tenantId: 't-1', nombre: '2-2-2-1', secuencia: ['DIA', 'DIA', 'NOCHE', 'NOCHE', 'DESC', 'DESC', 'DESC'], duracionCiclo: 7
      })
    ).rejects.toThrow(ConflictException);
  });

  it('crearPatron guarda patrón válido', async () => {
    const tx = mockTx();
    const resultado = await service.crearPatron(tx, {
      tenantId: 't-1', nombre: '2-2-2-1', secuencia: ['DIA', 'DIA', 'NOCHE', 'NOCHE', 'DESC', 'DESC', 'DESC'], duracionCiclo: 7, creadoPor: 'u-1'
    });
    expect(resultado.nombre).toBe('2-2-2-1');
  });

  it('listarPatrones filtra por activo', async () => {
    const tx = mockTx();
    tx.rotacionPatron.findMany.mockResolvedValue([{ id: 'pat-1', activo: true }]);
    const resultado = await service.listarPatrones(tx, 't-1', false);
    expect(tx.rotacionPatron.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ activo: true })
    }));
  });

  it('actualizarPatron rechaza patrón inexistente', async () => {
    const tx = mockTx();
    await expect(
      service.actualizarPatron(tx, 'pat-999', { nombre: 'X' })
    ).rejects.toThrow(NotFoundException);
  });
});
