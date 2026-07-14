import { GoneException, NotFoundException, BadRequestException } from '@nestjs/common';
import { createHash } from 'crypto';
import { DocumentService } from './document.service';
import { MinioIntegrationService } from './minio-integration.service';

/**
 * Tests unitarios de DocumentService (legajo digital, Fase 3).
 * Mismo patrón que PayrollRunService/AttendanceService: los métodos reciben
 * el tx de Prisma como parámetro y aquí se mockea por completo — sin BD real,
 * sin MinIO real (MinioIntegrationService inyectado como mock).
 */
describe('DocumentService', () => {
  const TENANT = 'tenant-1';
  const EMPLOYEE = 'emp-1';
  const USER = 'user-1';

  const contenido = Buffer.from('contenido-pdf-simulado');
  const md5 = createHash('md5').update(contenido).digest('hex');

  const documentoActivo = {
    id: 'doc-1',
    tenantId: TENANT,
    employeeId: EMPLOYEE,
    tipo: 'CONTRATO',
    nombreArchivo: 'contrato.pdf',
    mimeType: 'application/pdf',
    tamanoBytes: BigInt(contenido.length),
    checksumMd5: md5,
    rutaMinio: `documents/${TENANT}/employees/${EMPLOYEE}/doc-1/v1/contrato.pdf`,
    estado: 'ACTIVO',
    eliminadoEn: null,
    motivoEliminacion: null,
    subidoPor: USER,
  };

  /** Mock estructural de MinioIntegrationService (sin red). */
  function buildStorage() {
    return {
      buildPath: jest.fn(
        ({ tenantId, employeeId, documentId, version, filename }: any) =>
          `documents/${tenantId}/employees/${employeeId}/${documentId}/v${version}/${filename}`,
      ),
      uploadFile: jest.fn().mockImplementation((buffer: Buffer, ruta: string, mimeType: string) =>
        Promise.resolve({
          ruta,
          bucket: 'rrhh-documentos',
          checksumMd5: createHash('md5').update(buffer).digest('hex'),
          tamanoBytes: buffer.length,
          mimeType,
        }),
      ),
      downloadFile: jest.fn().mockResolvedValue(contenido),
    };
  }

  function buildService(storage = buildStorage()) {
    return {
      storage,
      service: new DocumentService(storage as unknown as MinioIntegrationService),
    };
  }

  function buildTx(overrides: Partial<Record<string, any>> = {}) {
    return {
      document: {
        findFirst: jest.fn().mockResolvedValue(null),
        findUnique: jest.fn().mockResolvedValue(documentoActivo),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest
          .fn()
          .mockImplementation(({ data }) => Promise.resolve({ ...data })),
        update: jest
          .fn()
          .mockImplementation(({ where, data }) =>
            Promise.resolve({ ...documentoActivo, ...where, ...data }),
          ),
        // delete se mockea SOLO para poder afirmar que NUNCA se llama
        delete: jest.fn(),
      },
      documentVersion: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest
          .fn()
          .mockImplementation(({ data }) => Promise.resolve({ id: 'ver-nueva', ...data })),
      },
      ...overrides,
    };
  }

  const inputSubida = {
    tenantId: TENANT,
    employeeId: EMPLOYEE,
    tipo: 'CONTRATO' as const,
    nombreArchivo: 'contrato.pdf',
    mimeType: 'application/pdf',
    contenido,
    subidoPor: USER,
  };

  describe('uploadDocument', () => {
    it('crea Document + DocumentVersion v1 y sube el objeto al storage cuando no hay documento previo', async () => {
      const { service, storage } = buildService();
      const tx = buildTx();

      const resultado = await service.uploadDocument(tx as any, inputSubida);

      // Se subió el binario una sola vez
      expect(storage.uploadFile).toHaveBeenCalledTimes(1);
      const [bufferSubido, rutaSubida, mime] = storage.uploadFile.mock.calls[0];
      expect(bufferSubido).toBe(contenido);
      expect(mime).toBe('application/pdf');

      // Document creado con metadata correcta y la misma ruta subida
      expect(tx.document.create).toHaveBeenCalledTimes(1);
      const dataDoc = tx.document.create.mock.calls[0][0].data;
      expect(dataDoc.id).toBeDefined(); // id generado para poder construir la ruta
      expect(dataDoc.tenantId).toBe(TENANT);
      expect(dataDoc.employeeId).toBe(EMPLOYEE);
      expect(dataDoc.tipo).toBe('CONTRATO');
      expect(dataDoc.checksumMd5).toBe(md5);
      expect(dataDoc.tamanoBytes).toBe(BigInt(contenido.length));
      expect(dataDoc.rutaMinio).toBe(rutaSubida);
      expect(dataDoc.subidoPor).toBe(USER);

      // Versión 1 en la misma transacción, misma ruta y checksum
      expect(tx.documentVersion.create).toHaveBeenCalledTimes(1);
      const dataVer = tx.documentVersion.create.mock.calls[0][0].data;
      expect(dataVer.numeroVersion).toBe(1);
      expect(dataVer.documentId).toBe(dataDoc.id);
      expect(dataVer.tenantId).toBe(TENANT);
      expect(dataVer.rutaMinio).toBe(rutaSubida);
      expect(dataVer.checksumMd5).toBe(md5);

      expect(resultado.numeroVersion).toBe(1);
    });

    it('crea versión incremental (v2) sin duplicar el Document cuando ya existe uno activo del mismo tipo', async () => {
      const { service, storage } = buildService();
      const tx = buildTx({
        document: {
          ...buildTx().document,
          findFirst: jest.fn().mockResolvedValue(documentoActivo),
        },
        documentVersion: {
          findFirst: jest.fn().mockResolvedValue({
            id: 'ver-1',
            documentId: 'doc-1',
            numeroVersion: 1,
          }),
          create: jest
            .fn()
            .mockImplementation(({ data }) => Promise.resolve({ id: 'ver-2', ...data })),
        },
      });

      const resultado = await service.uploadDocument(tx as any, inputSubida);

      // NO se crea un Document nuevo: se versiona el existente
      expect(tx.document.create).not.toHaveBeenCalled();
      expect(tx.documentVersion.create).toHaveBeenCalledTimes(1);
      const dataVer = tx.documentVersion.create.mock.calls[0][0].data;
      expect(dataVer.documentId).toBe('doc-1');
      expect(dataVer.numeroVersion).toBe(2);

      // La ruta de la nueva versión usa v2 (no pisa el objeto de v1)
      expect(storage.uploadFile).toHaveBeenCalledTimes(1);
      const rutaSubida = storage.uploadFile.mock.calls[0][1];
      expect(rutaSubida).toContain('/v2/');
      expect(dataVer.rutaMinio).toBe(rutaSubida);

      // La metadata vigente del Document se actualiza a la nueva versión
      expect(tx.document.update).toHaveBeenCalledTimes(1);
      const update = tx.document.update.mock.calls[0][0];
      expect(update.where.id).toBe('doc-1');
      expect(update.data.rutaMinio).toBe(rutaSubida);
      expect(update.data.checksumMd5).toBe(md5);

      expect(resultado.numeroVersion).toBe(2);
    });
  });

  describe('downloadDocument', () => {
    it('retorna metadata + buffer descargado del storage para un documento activo', async () => {
      const { service, storage } = buildService();
      const tx = buildTx();

      const resultado = await service.downloadDocument(tx as any, 'doc-1');

      expect(tx.document.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'doc-1' } }),
      );
      expect(storage.downloadFile).toHaveBeenCalledWith(documentoActivo.rutaMinio);
      expect(resultado.documento.id).toBe('doc-1');
      expect(resultado.contenido).toBe(contenido);
    });

    it('lanza GoneException si el documento está ELIMINADO y no toca el storage', async () => {
      const { service, storage } = buildService();
      const tx = buildTx({
        document: {
          ...buildTx().document,
          findUnique: jest.fn().mockResolvedValue({
            ...documentoActivo,
            estado: 'ELIMINADO',
            eliminadoEn: new Date('2026-07-01'),
            motivoEliminacion: 'solicitud del titular',
          }),
        },
      });

      await expect(service.downloadDocument(tx as any, 'doc-1')).rejects.toBeInstanceOf(
        GoneException,
      );
      expect(storage.downloadFile).not.toHaveBeenCalled();
    });

    it('lanza NotFoundException si el documento no existe', async () => {
      const { service } = buildService();
      const tx = buildTx({
        document: { ...buildTx().document, findUnique: jest.fn().mockResolvedValue(null) },
      });

      await expect(service.downloadDocument(tx as any, 'doc-x')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('deleteDocument (derecho al olvido, Ley 29733)', () => {
    it('hace soft-delete (estado=ELIMINADO, eliminadoEn, motivoEliminacion) y NUNCA borra la fila', async () => {
      const { service } = buildService();
      const tx = buildTx();

      const resultado = await service.deleteDocument(
        tx as any,
        'doc-1',
        'solicitud del titular de los datos',
      );

      expect(tx.document.update).toHaveBeenCalledTimes(1);
      const update = tx.document.update.mock.calls[0][0];
      expect(update.where.id).toBe('doc-1');
      expect(update.data.estado).toBe('ELIMINADO');
      expect(update.data.eliminadoEn).toBeInstanceOf(Date);
      expect(update.data.motivoEliminacion).toBe('solicitud del titular de los datos');

      // Cumplimiento: jamás se ejecuta un DELETE físico
      expect(tx.document.delete).not.toHaveBeenCalled();
      expect(resultado.estado).toBe('ELIMINADO');
    });

    it('exige motivo no vacío y rechaza eliminar un documento ya ELIMINADO', async () => {
      const { service } = buildService();

      const tx1 = buildTx();
      await expect(service.deleteDocument(tx1 as any, 'doc-1', '   ')).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(tx1.document.update).not.toHaveBeenCalled();

      const tx2 = buildTx({
        document: {
          ...buildTx().document,
          findUnique: jest
            .fn()
            .mockResolvedValue({ ...documentoActivo, estado: 'ELIMINADO' }),
        },
      });
      await expect(
        service.deleteDocument(tx2 as any, 'doc-1', 'motivo válido'),
      ).rejects.toBeInstanceOf(GoneException);
      expect(tx2.document.update).not.toHaveBeenCalled();
    });
  });

  describe('searchDocuments', () => {
    it('arma el where con employeeId, tipo y rango de fechas, limitado a documentos ACTIVOS', async () => {
      const { service } = buildService();
      const tx = buildTx({
        document: {
          ...buildTx().document,
          findMany: jest.fn().mockResolvedValue([documentoActivo]),
        },
      });

      const desde = new Date('2026-01-01');
      const hasta = new Date('2026-06-30');
      const resultado = await service.searchDocuments(tx as any, {
        employeeId: EMPLOYEE,
        tipo: 'CONTRATO',
        desde,
        hasta,
      });

      expect(tx.document.findMany).toHaveBeenCalledTimes(1);
      const where = tx.document.findMany.mock.calls[0][0].where;
      expect(where.employeeId).toBe(EMPLOYEE);
      expect(where.tipo).toBe('CONTRATO');
      expect(where.estado).toBe('ACTIVO');
      expect(where.creadoEn).toEqual({ gte: desde, lte: hasta });
      expect(resultado).toEqual([documentoActivo]);
    });

    it('sin filtros solo restringe a ACTIVO (no inventa condiciones)', async () => {
      const { service } = buildService();
      const tx = buildTx();

      await service.searchDocuments(tx as any, {});

      const where = tx.document.findMany.mock.calls[0][0].where;
      expect(where).toEqual({ estado: 'ACTIVO' });
    });
  });

  describe('getLegajoView', () => {
    it('agrupa documentos activos por tipo y lista los tipos requeridos faltantes', async () => {
      const docs = [
        { ...documentoActivo, id: 'd1', tipo: 'CONTRATO' },
        { ...documentoActivo, id: 'd2', tipo: 'DNI' },
        { ...documentoActivo, id: 'd3', tipo: 'CONTRATO' },
      ];
      const { service } = buildService();
      const tx = buildTx({
        document: { ...buildTx().document, findMany: jest.fn().mockResolvedValue(docs) },
      });

      const legajo = await service.getLegajoView(tx as any, EMPLOYEE, [
        'CONTRATO',
        'DNI',
        'CV',
        'CERTIFICADO',
      ]);

      // Solo documentos ACTIVOS del empleado
      const where = tx.document.findMany.mock.calls[0][0].where;
      expect(where.employeeId).toBe(EMPLOYEE);
      expect(where.estado).toBe('ACTIVO');

      expect(legajo.employeeId).toBe(EMPLOYEE);
      expect(Object.keys(legajo.documentosPorTipo).sort()).toEqual(['CONTRATO', 'DNI']);
      expect(legajo.documentosPorTipo['CONTRATO']).toHaveLength(2);
      expect(legajo.documentosPorTipo['DNI']).toHaveLength(1);
      expect(legajo.tiposFaltantes.sort()).toEqual(['CERTIFICADO', 'CV']);
    });
  });
});
