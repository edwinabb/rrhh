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
