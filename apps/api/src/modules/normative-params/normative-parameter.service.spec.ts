import {
  NormativeParameterService,
  NormativeParameterQueryClient,
  NormativeParameterRecord,
} from './normative-parameter.service';

function fakeClient(records: NormativeParameterRecord[]): {
  client: NormativeParameterQueryClient;
  findFirst: jest.Mock;
  update: jest.Mock;
  create: jest.Mock;
} {
  const findFirst = jest.fn(async (args: any) => {
    const { codigo } = args.where;

    // Query de createNewVersion: busca el registro vigente (vigenciaHasta: null).
    if ('vigenciaHasta' in args.where && args.where.vigenciaHasta === null) {
      return records.find((r) => r.codigo === codigo && r.vigenciaHasta === null) ?? null;
    }

    // Query de resolve(): fecha dentro de [vigenciaDesde, vigenciaHasta).
    const fecha: Date = args.where.vigenciaDesde.lte;
    const candidates = records
      .filter((r) => r.codigo === codigo)
      .filter((r) => r.vigenciaDesde.getTime() <= fecha.getTime())
      .filter((r) => r.vigenciaHasta === null || r.vigenciaHasta.getTime() > fecha.getTime())
      .sort((a, b) => b.vigenciaDesde.getTime() - a.vigenciaDesde.getTime());
    return candidates[0] ?? null;
  });
  const update = jest.fn(async (args: any) => {
    const record = records.find((r) => r.id === args.where.id)!;
    Object.assign(record, args.data);
    return record;
  });
  const create = jest.fn(async (args: any) => {
    const record: NormativeParameterRecord = {
      id: `generated-${records.length + 1}`,
      ...args.data,
    };
    records.push(record);
    return record;
  });

  return { client: { normativeParameter: { findFirst, update, create } }, findFirst, update, create };
}

function record(overrides: Partial<NormativeParameterRecord>): NormativeParameterRecord {
  return {
    id: 'id-1',
    codigo: 'UIT',
    valor: 5350,
    vigenciaDesde: new Date('2026-01-01'),
    vigenciaHasta: null,
    descripcion: null,
    ...overrides,
  };
}

describe('NormativeParameterService', () => {
  let service: NormativeParameterService;

  beforeEach(() => {
    service = new NormativeParameterService();
  });

  describe('resolve', () => {
    it('resuelve el valor vigente para una fecha dentro del rango', async () => {
      const { client } = fakeClient([record({ valor: 5350 })]);

      const valor = await service.resolve(client, 'UIT', new Date('2026-06-15'));

      expect(valor).toBe(5350);
    });

    it('lanza NotFoundException si ningún registro cubre la fecha', async () => {
      const { client } = fakeClient([
        record({ vigenciaDesde: new Date('2027-01-01'), vigenciaHasta: null, valor: 5500 }),
      ]);

      await expect(service.resolve(client, 'UIT', new Date('2026-06-15'))).rejects.toThrow(
        /No hay parámetro normativo/,
      );
    });

    it('usa el valor histórico correcto, NUNCA "el último valor", al recalcular un periodo pasado', async () => {
      const { client } = fakeClient([
        record({
          id: 'old',
          valor: 5150,
          vigenciaDesde: new Date('2025-01-01'),
          vigenciaHasta: new Date('2025-12-31'),
        }),
        record({
          id: 'new',
          valor: 5350,
          vigenciaDesde: new Date('2026-01-01'),
          vigenciaHasta: null,
        }),
      ]);

      // Recalcular marzo 2025 en pleno 2026 debe devolver la UIT de 2025, no la de 2026.
      const valorHistorico = await service.resolve(client, 'UIT', new Date('2025-03-15'));
      const valorVigenteHoy = await service.resolve(client, 'UIT', new Date('2026-03-15'));

      expect(valorHistorico).toBe(5150);
      expect(valorVigenteHoy).toBe(5350);
    });

    it('cachea por (codigo, periodo): la segunda llamada al mismo mes no vuelve a golpear la BD', async () => {
      const { client, findFirst } = fakeClient([record({ valor: 5350 })]);

      await service.resolve(client, 'UIT', new Date('2026-06-01'));
      await service.resolve(client, 'UIT', new Date('2026-06-28'));

      expect(findFirst).toHaveBeenCalledTimes(1);
    });

    it('no comparte cache entre periodos distintos', async () => {
      const { client, findFirst } = fakeClient([record({ valor: 5350 })]);

      await service.resolve(client, 'UIT', new Date('2026-06-01'));
      await service.resolve(client, 'UIT', new Date('2026-07-01'));

      expect(findFirst).toHaveBeenCalledTimes(2);
    });
  });

  describe('createNewVersion', () => {
    it('nunca sobreescribe: cierra la vigencia anterior en vez de mutar su valor', async () => {
      const previous = record({ id: 'prev', valor: 5350, vigenciaDesde: new Date('2026-01-01') });
      const { client } = fakeClient([previous]);

      await service.createNewVersion(client, {
        codigo: 'UIT',
        valor: 5500,
        vigenciaDesde: new Date('2027-01-01'),
        createdBy: 'user-1',
      });

      expect(previous.valor).toBe(5350); // el valor histórico jamás cambia
      expect(previous.vigenciaHasta).toEqual(new Date('2026-12-31'));
    });

    it('invalida el cache del código actualizado', async () => {
      const { client, findFirst } = fakeClient([record({ valor: 5350 })]);
      await service.resolve(client, 'UIT', new Date('2026-06-01')); // llena el cache

      await service.createNewVersion(client, {
        codigo: 'UIT',
        valor: 5500,
        vigenciaDesde: new Date('2026-06-01'),
        createdBy: 'user-1',
      });

      await service.resolve(client, 'UIT', new Date('2026-06-01'));

      // 1ra resolve (llena cache) + createNewVersion internamente hace su propio
      // findFirst (busca vigente) + la resolve final tras invalidar = 3 llamadas.
      expect(findFirst).toHaveBeenCalledTimes(3);
    });
  });
});
