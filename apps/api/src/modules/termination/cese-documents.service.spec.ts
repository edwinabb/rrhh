import { CeseDocumentsService } from './cese-documents.service';

const documentService = {
  uploadDocument: jest.fn().mockResolvedValue({ documento: { id: 'doc-1' }, numeroVersion: 1 }),
} as any;

const CESE = {
  id: 'cese-1',
  fechaCese: new Date('2026-07-15'),
  motivo: 'RENUNCIA',
  componentes: {
    ingresos: [{ concepto: 'CTS trunca', baseLegal: 'D.S. 001-97-TR', monto: 1458.33 }],
    deducciones: [
      { concepto: 'Retención ONP', baseLegal: 'D.L. 19990', monto: -195 },
      { concepto: 'Retención 5ta categoría', baseLegal: 'TUO LIR', monto: -100 },
    ],
  },
  totalBruto: 1458.33,
  totalDeducciones: 195,
  netoPagar: 1263.33,
  inputSnapshot: {
    fechaInicioContrato: '2024-01-01',
    quinta: { rentaPagadaEnElAnio: 21000, retencionesYaEfectuadas: 0 },
  },
  derechohabientes: null,
};
const EMPLEADO = {
  id: 'emp-1',
  tenantId: 't-1',
  nombres: 'María',
  apellidos: 'Quispe',
  tipoDocumento: '01',
  numeroDocumento: '45678901',
};
const TENANT = { razonSocial: 'Demo SAC', ruc: '20123456789' };

describe('CeseDocumentsService', () => {
  let service: CeseDocumentsService;
  beforeEach(() => {
    service = new CeseDocumentsService(documentService);
    jest.clearAllMocks();
  });

  it('genera y archiva los 4 documentos con los tipos correctos', async () => {
    const ids = await service.generarDocumentosCese({}, CESE, EMPLEADO, TENANT, 'user-1');
    expect(ids).toHaveLength(4);
    const tipos = documentService.uploadDocument.mock.calls.map((c: any[]) => c[1].tipo);
    expect(tipos).toEqual(
      expect.arrayContaining([
        'LIQUIDACION',
        'CERTIFICADO_TRABAJO',
        'CONSTANCIA_CESE',
        'CERTIFICADO_RETENCION_5TA',
      ]),
    );
    // Todos los PDFs tienen contenido real
    for (const call of documentService.uploadDocument.mock.calls) {
      expect(call[1].contenido.length).toBeGreaterThan(500);
      expect(call[1].mimeType).toBe('application/pdf');
      expect(call[1].employeeId).toBe('emp-1');
    }
  });

  it('rechaza generar sin componentes calculados', async () => {
    await expect(
      service.generarDocumentosCese({}, { ...CESE, componentes: null }, EMPLEADO, TENANT, 'user-1'),
    ).rejects.toThrow('sin componentes calculados');
  });
});
