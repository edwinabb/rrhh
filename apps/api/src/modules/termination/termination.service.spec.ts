import {
  BadRequestException,
  ConflictException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { TerminationService, calcularFechaLimitePago } from './termination.service';

const CONTRATO = {
  id: 'c-1',
  regimenLaboral: 'general',
  tipoContrato: 'indeterminado',
  fechaInicio: new Date('2024-01-01'),
  fechaFin: null,
  jornada: { horasDia: 8 },
  remuneracionBasica: { toNumber: () => 3000 },
};

function mockTx(overrides: any = {}) {
  return {
    employee: {
      findUnique: jest.fn().mockResolvedValue({ id: 'emp-1', tenantId: 't-1', estado: 'activo' }),
      update: jest.fn(),
    },
    contrato: { findFirst: jest.fn().mockResolvedValue(CONTRATO) },
    regimenPensionario: {
      findFirst: jest.fn().mockResolvedValue({ sistema: 'onp', tipoComision: null }),
    },
    vacacionPeriodo: { findMany: jest.fn().mockResolvedValue([]), updateMany: jest.fn() },
    planillaNovedad: { findMany: jest.fn().mockResolvedValue([]) },
    horasExtra: { findMany: jest.fn().mockResolvedValue([]) },
    planillaDetalle: { findMany: jest.fn().mockResolvedValue([]) },
    cese: {
      findFirst: jest.fn().mockResolvedValue(null),
      findUnique: jest.fn(),
      create: jest.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 'cese-1', ...data })),
      update: jest.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 'cese-1', ...data })),
    },
    ...overrides,
  };
}

const normativeParams = { resolve: jest.fn().mockResolvedValue(undefined) } as any;

describe('TerminationService — crear y corregir', () => {
  let service: TerminationService;
  beforeEach(() => {
    service = new TerminationService(normativeParams);
    jest.clearAllMocks();
  });

  it('calcularFechaLimitePago: fecha de cese + 2 días calendario (48h, D.S. 001-97-TR)', () => {
    expect(calcularFechaLimitePago(new Date('2026-07-15')).toISOString().slice(0, 10)).toBe('2026-07-17');
  });

  it('crearCese: pre-llena el snapshot desde contrato y régimen pensionario', async () => {
    const tx = mockTx();
    const cese = await service.crearCese(tx, {
      tenantId: 't-1',
      employeeId: 'emp-1',
      fechaCese: new Date('2026-07-15'),
      motivo: 'RENUNCIA',
      creadoPor: 'user-1',
    });
    const snapshot = cese.inputSnapshot;
    expect(snapshot.regimen).toBe('general');
    expect(snapshot.remuneracionComputable).toBe(3000);
    expect(snapshot.sistemaPensionario).toBe('onp');
    // Cese 2026-07-15: último depósito CTS = mayo 2026 (cubre desde 1-may):
    // 2 meses completos (may, jun) + 14 días
    expect(snapshot.cts.mesesCompletosDesdeUltimoDeposito).toBe(2);
    expect(snapshot.cts.diasAdicionales).toBe(14);
    // Semestre grati jul-dic: 0 meses calendario completos al 15-jul
    expect(snapshot.gratificacionTrunca.mesesCompletos).toBe(0);
    // Pendiente: sueldo prorrateado 15/30 = 1500
    expect(snapshot.remuneracionesPendientes[0].monto).toBe(1500);
    expect(tx.cese.create).toHaveBeenCalled();
  });

  it('crearCese: rechaza empleado con cese vigente (409)', async () => {
    const tx = mockTx();
    tx.cese.findFirst.mockResolvedValue({ id: 'previo', estado: 'BORRADOR' });
    await expect(
      service.crearCese(tx, {
        tenantId: 't-1',
        employeeId: 'emp-1',
        fechaCese: new Date('2026-07-15'),
        motivo: 'RENUNCIA',
        creadoPor: 'user-1',
      }),
    ).rejects.toThrow(ConflictException);
  });

  it('crearCese: rechaza fechaCese anterior al inicio del contrato', async () => {
    const tx = mockTx();
    await expect(
      service.crearCese(tx, {
        tenantId: 't-1',
        employeeId: 'emp-1',
        fechaCese: new Date('2023-12-31'),
        motivo: 'RENUNCIA',
        creadoPor: 'user-1',
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('crearCese: TERMINO_CONTRATO exige contrato con fechaFin', async () => {
    const tx = mockTx();
    await expect(
      service.crearCese(tx, {
        tenantId: 't-1',
        employeeId: 'emp-1',
        fechaCese: new Date('2026-07-15'),
        motivo: 'TERMINO_CONTRATO',
        creadoPor: 'user-1',
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('actualizarDatos: mergea el snapshot y regresa el cese a BORRADOR', async () => {
    const tx = mockTx();
    tx.cese.findUnique.mockResolvedValue({
      id: 'cese-1',
      estado: 'CALCULADA',
      inputSnapshot: { regimen: 'general', remuneracionComputable: 3000 },
    });
    await service.actualizarDatos(tx, 'cese-1', { remuneracionComputable: 3200 });
    expect(tx.cese.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          estado: 'BORRADOR',
          inputSnapshot: expect.objectContaining({ remuneracionComputable: 3200 }),
        }),
      }),
    );
  });

  it('actualizarDatos: rechaza si el cese está APROBADA o posterior', async () => {
    const tx = mockTx();
    tx.cese.findUnique.mockResolvedValue({ id: 'cese-1', estado: 'APROBADA', inputSnapshot: {} });
    await expect(service.actualizarDatos(tx, 'cese-1', {})).rejects.toThrow(ConflictException);
  });
});

describe('TerminationService — calcular', () => {
  const paramsResolve = (client: any, codigo: string) => {
    const valores: Record<string, unknown> = {
      UIT: 5350,
      RMV: 1130,
      ONP_TASA: 0.13,
      AFP_APORTE_OBLIGATORIO: 0.1,
      GRATIFICACION_BONIF_EXTRAORD: { essalud: 0.09, eps: 0.0675 },
      QUINTA_DEDUCCION_UIT: 7,
      MYPE_FACTOR_CTS_GRATI: { mype_pequena: 0.5, mype_micro: 0 },
      INDEMNIZACION_TOPE_REMUNERACIONES: 12,
      INDEMNIZACION_MYPE: {
        mype_pequena: { diasPorAnio: 20, topeDias: 120 },
        mype_micro: { diasPorAnio: 10, topeDias: 90 },
      },
    };
    return Promise.resolve(valores[codigo]);
  };

  const SNAPSHOT = {
    regimen: 'general',
    tipoContrato: 'indeterminado',
    fechaInicioContrato: '2024-01-01',
    fechaFinContrato: null,
    remuneracionComputable: 3000,
    sistemaPensionario: 'onp',
    afiliadoEps: false,
    excluidoIndemnizacionVacacional: false,
    cts: { gratificacionSemestralPercibida: 3000, mesesCompletosDesdeUltimoDeposito: 2, diasAdicionales: 14 },
    gratificacionTrunca: { mesesCompletos: 0 },
    vacaciones: [],
    remuneracionesPendientes: [{ concepto: 'Sueldo julio (15 días)', monto: 1500 }],
    gratificacionExtraordinaria: 0,
    derechohabientes: null,
    quinta: { rentaPagadaEnElAnio: 0, retencionesYaEfectuadas: 0 },
  };

  it('calcula, persiste componentes/totales y transiciona a CALCULADA', async () => {
    const tx = mockTx();
    tx.cese.findUnique.mockResolvedValue({
      id: 'cese-1',
      estado: 'BORRADOR',
      motivo: 'RENUNCIA',
      fechaCese: new Date('2026-07-15'),
      inputSnapshot: SNAPSHOT,
    });
    const service = new TerminationService({ resolve: jest.fn(paramsResolve) } as any);
    await service.calcular(tx, 'cese-1');

    const update = tx.cese.update.mock.calls[0][0];
    expect(update.data.estado).toBe('CALCULADA');
    expect(update.data.totalBruto).toBeGreaterThan(0);
    // ONP sobre pendientes: 1500 × 0.13 = 195
    const onp = update.data.componentes.deducciones.find((l: any) => l.concepto === 'Retención ONP');
    expect(onp.monto).toBe(-195);
    expect(update.data.netoPagar).toBeCloseTo(update.data.totalBruto - 195, 2);
  });

  it('rechaza calcular un cese APROBADA', async () => {
    const tx = mockTx();
    tx.cese.findUnique.mockResolvedValue({ id: 'cese-1', estado: 'APROBADA', inputSnapshot: SNAPSHOT });
    const service = new TerminationService({ resolve: jest.fn(paramsResolve) } as any);
    await expect(service.calcular(tx, 'cese-1')).rejects.toThrow(ConflictException);
  });
});

describe('TerminationService — aprobar/pagar/anular', () => {
  const ceseCalculada = (overrides: any = {}) => ({
    id: 'cese-1',
    tenantId: 't-1',
    employeeId: 'emp-1',
    estado: 'CALCULADA',
    motivo: 'RENUNCIA',
    fechaCese: new Date('2026-07-15'),
    fechaLimitePago: new Date('2026-07-17'),
    componentes: { ingresos: [], deducciones: [] },
    derechohabientes: null,
    inputSnapshot: {},
    ...overrides,
  });

  const documentos = { generarDocumentosCese: jest.fn().mockResolvedValue(['d1', 'd2', 'd3', 'd4']) } as any;

  function crearService() {
    return new TerminationService({ resolve: jest.fn() } as any, documentos);
  }

  it('aprobar: genera documentos, cesa al empleado y liquida los períodos vacacionales', async () => {
    const tx = mockTx();
    tx.cese.findUnique.mockResolvedValue(ceseCalculada());
    tx.tenant = { findUnique: jest.fn().mockResolvedValue({ razonSocial: 'Demo SAC', ruc: '20123456789' }) };
    const service = crearService();
    await service.aprobar(tx, 'cese-1', 'admin-1');

    expect(documentos.generarDocumentosCese).toHaveBeenCalled();
    expect(tx.employee.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { estado: 'cesado' } }),
    );
    expect(tx.vacacionPeriodo.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { estado: 'LIQUIDADO' } }),
    );
    expect(tx.cese.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ estado: 'APROBADA', aprobadoPor: 'admin-1' }) }),
    );
  });

  it('aprobar: FALLECIMIENTO sin derechohabientes → 422', async () => {
    const tx = mockTx();
    tx.cese.findUnique.mockResolvedValue(ceseCalculada({ motivo: 'FALLECIMIENTO' }));
    await expect(crearService().aprobar(tx, 'cese-1', 'admin-1')).rejects.toThrow(
      UnprocessableEntityException,
    );
  });

  it('aprobar: derechohabientes con porcentajes que no suman 100 → 422', async () => {
    const tx = mockTx();
    tx.cese.findUnique.mockResolvedValue(
      ceseCalculada({
        motivo: 'FALLECIMIENTO',
        derechohabientes: [{ nombre: 'X', tipoDocumento: '01', numeroDocumento: '1', parentesco: 'cónyuge', porcentaje: 60 }],
      }),
    );
    await expect(crearService().aprobar(tx, 'cese-1', 'admin-1')).rejects.toThrow(
      UnprocessableEntityException,
    );
  });

  it('aprobar: si la generación de PDFs falla, el estado NO avanza', async () => {
    const tx = mockTx();
    tx.cese.findUnique.mockResolvedValue(ceseCalculada());
    tx.tenant = { findUnique: jest.fn().mockResolvedValue({ razonSocial: 'Demo SAC', ruc: '20123456789' }) };
    documentos.generarDocumentosCese.mockRejectedValueOnce(new Error('MinIO caído'));
    await expect(crearService().aprobar(tx, 'cese-1', 'admin-1')).rejects.toThrow('MinIO caído');
    expect(tx.cese.update).not.toHaveBeenCalled();
  });

  it('pagar: fuera del plazo de 48h marca pagoFueraDePlazo', async () => {
    const tx = mockTx();
    tx.cese.findUnique.mockResolvedValue(ceseCalculada({ estado: 'APROBADA' }));
    const service = crearService();
    await service.pagar(tx, 'cese-1', new Date('2026-07-20T12:00:00Z'));
    expect(tx.cese.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ estado: 'PAGADA', pagoFueraDePlazo: true }),
      }),
    );
  });

  it('anular: desde APROBADA revierte empleado y vacaciones; desde PAGADA se rechaza', async () => {
    const tx = mockTx();
    tx.cese.findUnique.mockResolvedValue(ceseCalculada({ estado: 'APROBADA' }));
    await crearService().anular(tx, 'cese-1', 'error de datos');
    expect(tx.employee.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { estado: 'activo' } }),
    );

    tx.cese.findUnique.mockResolvedValue(ceseCalculada({ estado: 'PAGADA' }));
    await expect(crearService().anular(tx, 'cese-1', 'x')).rejects.toThrow(ConflictException);
  });
});
