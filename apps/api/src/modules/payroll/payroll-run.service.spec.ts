import { PayrollRunService } from './payroll-run.service';
import { NormativeParameterService } from '../normative-params/normative-parameter.service';

describe('PayrollRunService.procesarPeriodo', () => {
  function buildClient(overrides: Partial<any> = {}) {
    return {
      employee: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'emp-1',
            contratos: [
              {
                regimenLaboral: 'general',
                remuneracionBasica: { toNumber: () => 2000 },
              },
            ],
            regimenesPensionarios: [{ sistema: 'onp', codigoSunat: '02' }],
            cuentasBancarias: [],
          },
        ]),
      },
      planilla: {
        create: jest
          .fn()
          .mockImplementation(({ data }) =>
            Promise.resolve({ id: 'planilla-1', ...data, tenantId: data.tenantId }),
          ),
        update: jest.fn().mockResolvedValue({ id: 'planilla-1', estado: 'procesado' }),
      },
      planillaDetalle: {
        create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'detalle-1', ...data })),
      },
      normativeParameter: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'param-1',
          codigo: 'ONP_TASA',
          valor: 0.13,
          vigenciaDesde: new Date('2026-01-01'),
          vigenciaHasta: null,
        }),
      },
      ...overrides,
    };
  }

  function buildNormativeService() {
    const mockService = {
      resolve: jest.fn().mockImplementation((client, codigo, fecha) => {
        const params: Record<string, number> = {
          UIT: 5350,
          RMV: 1130,
          ESSALUD_TASA: 0.09,
          ONP_TASA: 0.13,
          AFP_APORTE_OBLIGATORIO: 0.1,
          ASIGNACION_FAMILIAR_TASA: 0.1,
        };
        return Promise.resolve(params[codigo] ?? 0);
      }),
    };
    return mockService as any;
  }

  it('crea la planilla en estado "procesado" con el detalle de cada trabajador', async () => {
    const client = buildClient();
    const normativeService = buildNormativeService();
    const service = new PayrollRunService(normativeService);

    const resultado = await service.procesarPeriodo(client as any, '2026-06');

    expect(client.planilla.create).toHaveBeenCalled();
    expect(client.planillaDetalle.create).toHaveBeenCalledTimes(1);
    expect(resultado.estado).toBe('procesado');
  });

  it('calcula conceptos correctos: remuneracion base, asignacion familiar, desuentos', async () => {
    const client = buildClient();
    const normativeService = buildNormativeService();
    const service = new PayrollRunService(normativeService);

    await service.procesarPeriodo(client as any, '2026-06');

    const detalleLlamada = client.planillaDetalle.create.mock.calls[0][0];
    expect(detalleLlamada.data.conceptosCalculados).toBeDefined();
    expect(Array.isArray(detalleLlamada.data.conceptosCalculados)).toBe(true);
    // Debe contener al menos: sueldo, asignación familiar, descuento pensionario
    expect(detalleLlamada.data.conceptosCalculados.length).toBeGreaterThanOrEqual(3);
  });

  it('calcula neto pagar correctamente (remuneracion + asignacion - descuentos)', async () => {
    const client = buildClient();
    const normativeService = buildNormativeService();
    const service = new PayrollRunService(normativeService);

    await service.procesarPeriodo(client as any, '2026-06');

    const detalleLlamada = client.planillaDetalle.create.mock.calls[0][0];
    expect(detalleLlamada.data.netoPagar).toBeGreaterThan(0);
    // Neto debe ser menor que la remuneracion base (por descuentos)
    expect(detalleLlamada.data.netoPagar).toBeLessThan(2000);
  });
});

describe('PayrollRunService.procesarPeriodo — novedades de planilla (import CSV)', () => {
  function buildClient(overrides: Partial<any> = {}) {
    return {
      employee: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'emp-1',
            contratos: [
              {
                regimenLaboral: 'general',
                remuneracionBasica: { toNumber: () => 2000 },
                jornada: { horasDia: 8, diasSemana: 5 },
              },
            ],
            regimenesPensionarios: [{ sistema: 'onp', codigoSunat: '02' }],
            cuentasBancarias: [],
          },
        ]),
      },
      planilla: {
        create: jest
          .fn()
          .mockImplementation(({ data }) =>
            Promise.resolve({ id: 'planilla-1', ...data, tenantId: data.tenantId }),
          ),
        update: jest.fn().mockResolvedValue({ id: 'planilla-1', estado: 'procesado' }),
      },
      planillaDetalle: {
        create: jest
          .fn()
          .mockImplementation(({ data }) => Promise.resolve({ id: 'detalle-1', ...data })),
      },
      ...overrides,
    };
  }

  function buildNormativeService() {
    return {
      resolve: jest.fn().mockImplementation((client, codigo) => {
        const params: Record<string, number> = {
          UIT: 5350,
          RMV: 1130,
          ESSALUD_TASA: 0.09,
          ONP_TASA: 0.13,
          AFP_APORTE_OBLIGATORIO: 0.1,
          ASIGNACION_FAMILIAR_TASA: 0.1,
        };
        return Promise.resolve(params[codigo] ?? 0);
      }),
    } as any;
  }

  function novedadMock(novedades: any[]) {
    return { findMany: jest.fn().mockResolvedValue(novedades) };
  }

  async function netoBase(): Promise<number> {
    // Corrida de referencia SIN novedades (mismo mock que los tests originales)
    const client = buildClient();
    const service = new PayrollRunService(buildNormativeService());
    await service.procesarPeriodo(client as any, '2026-06');
    return client.planillaDetalle.create.mock.calls[0][0].data.netoPagar;
  }

  it('con novedades agrega conceptos de horas extra, bonificaciones y descuentos, y ajusta el neto', async () => {
    const netoSinNovedades = await netoBase();

    const client = buildClient({
      planillaNovedad: novedadMock([
        {
          employeeId: 'emp-1',
          periodo: '2026-06',
          diasLaborados: 30,
          horasExtra25: 4,
          horasExtra35: 2,
          bonificaciones: 250,
          descuentos: 50,
        },
      ]),
    });
    const service = new PayrollRunService(buildNormativeService());

    await service.procesarPeriodo(client as any, '2026-06');

    const data = client.planillaDetalle.create.mock.calls[0][0].data;
    const conceptos = data.conceptosCalculados as Array<{
      codigo: string;
      nombre: string;
      monto: number;
    }>;

    // valorHora = 2000 / 30 / 8 = 8.3333
    const valorHora = 2000 / 30 / 8;
    const he25 = conceptos.find((c) => c.codigo === '0104');
    const he35 = conceptos.find((c) => c.codigo === '0105');
    const bonif = conceptos.find((c) => c.nombre.toLowerCase().includes('bonificacion'));
    const desc = conceptos.find((c) => c.nombre.toLowerCase().includes('descuento') && c.monto === -50);

    expect(he25).toBeDefined();
    expect(he25!.monto).toBeCloseTo(4 * valorHora * 1.25, 2);
    expect(he35).toBeDefined();
    expect(he35!.monto).toBeCloseTo(2 * valorHora * 1.35, 2);
    expect(bonif).toBeDefined();
    expect(bonif!.monto).toBe(250);
    expect(desc).toBeDefined();

    const deltaEsperado = 4 * valorHora * 1.25 + 2 * valorHora * 1.35 + 250 - 50;
    expect(data.netoPagar).toBeCloseTo(netoSinNovedades + deltaEsperado, 1);
  });

  it('diasLaborados < 30 prorratea el sueldo base (sueldo * dias / 30)', async () => {
    const netoSinNovedades = await netoBase();

    const client = buildClient({
      planillaNovedad: novedadMock([
        {
          employeeId: 'emp-1',
          periodo: '2026-06',
          diasLaborados: 15,
          horasExtra25: 0,
          horasExtra35: 0,
          bonificaciones: 0,
          descuentos: 0,
        },
      ]),
    });
    const service = new PayrollRunService(buildNormativeService());

    await service.procesarPeriodo(client as any, '2026-06');

    const data = client.planillaDetalle.create.mock.calls[0][0].data;
    const sueldo = (data.conceptosCalculados as any[]).find((c) => c.codigo === '0121');
    expect(sueldo.monto).toBeCloseTo(2000 * (15 / 30), 2); // 1000
    expect(data.netoPagar).toBeCloseTo(netoSinNovedades - 1000, 1);
  });

  it('empleado SIN novedad en el período: cálculo idéntico al flujo sin novedades', async () => {
    const netoSinNovedades = await netoBase();

    const client = buildClient({
      planillaNovedad: novedadMock([]), // hay tabla, pero sin filas para el período
    });
    const service = new PayrollRunService(buildNormativeService());

    await service.procesarPeriodo(client as any, '2026-06');

    const data = client.planillaDetalle.create.mock.calls[0][0].data;
    expect(data.netoPagar).toBeCloseTo(netoSinNovedades, 6);
  });

  it('soporta valores Decimal de Prisma (objetos con toNumber) en la novedad', async () => {
    const dec = (n: number) => ({ toNumber: () => n });
    const client = buildClient({
      planillaNovedad: novedadMock([
        {
          employeeId: 'emp-1',
          periodo: '2026-06',
          diasLaborados: null,
          horasExtra25: dec(2),
          horasExtra35: dec(0),
          bonificaciones: dec(100),
          descuentos: dec(0),
        },
      ]),
    });
    const service = new PayrollRunService(buildNormativeService());

    await service.procesarPeriodo(client as any, '2026-06');

    const data = client.planillaDetalle.create.mock.calls[0][0].data;
    const conceptos = data.conceptosCalculados as any[];
    const valorHora = 2000 / 30 / 8;
    expect(conceptos.find((c) => c.codigo === '0104').monto).toBeCloseTo(2 * valorHora * 1.25, 2);
    expect(conceptos.find((c) => c.nombre.toLowerCase().includes('bonificacion')).monto).toBe(100);
  });
});
