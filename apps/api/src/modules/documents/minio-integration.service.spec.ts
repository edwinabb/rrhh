import { createHash } from 'crypto';
import {
  InternalServerErrorException,
  PayloadTooLargeException,
} from '@nestjs/common';
import {
  MinioIntegrationService,
  ObjectStorageClient,
  TAMANO_MAXIMO_DEFAULT_BYTES,
  EXPIRACION_PRESIGNED_DEFAULT_SEGUNDOS,
} from './minio-integration.service';

describe('MinioIntegrationService', () => {
  let service: MinioIntegrationService;
  let client: jest.Mocked<ObjectStorageClient>;

  const BUCKET = 'bucket-test';

  beforeEach(() => {
    process.env.MINIO_BUCKET = BUCKET;
    client = {
      putObject: jest.fn().mockResolvedValue(undefined),
      getObject: jest.fn().mockResolvedValue(Buffer.from('contenido')),
      removeObject: jest.fn().mockResolvedValue(undefined),
      presignedGetObject: jest
        .fn()
        .mockResolvedValue('https://minio.local/presigned'),
    };
    service = new MinioIntegrationService(client);
  });

  afterEach(() => {
    delete process.env.MINIO_BUCKET;
  });

  describe('buildPath', () => {
    it('construye la ruta documents/{tenantId}/employees/{employeeId}/{documentId}/v{n}/{filename}', () => {
      const ruta = service.buildPath({
        tenantId: 'tenant-1',
        employeeId: 'emp-2',
        documentId: 'doc-3',
        version: 4,
        filename: 'contrato.pdf',
      });

      expect(ruta).toBe(
        'documents/tenant-1/employees/emp-2/doc-3/v4/contrato.pdf',
      );
    });
  });

  describe('uploadFile', () => {
    const ruta = 'documents/t/employees/e/d/v1/archivo.pdf';

    it('rechaza archivos que exceden el tamaño máximo por defecto (100MB) sin llamar al storage', async () => {
      const buffer = Buffer.alloc(TAMANO_MAXIMO_DEFAULT_BYTES + 1);

      await expect(
        service.uploadFile(buffer, ruta, 'application/pdf'),
      ).rejects.toBeInstanceOf(PayloadTooLargeException);
      expect(client.putObject).not.toHaveBeenCalled();
    });

    it('rechaza archivos que exceden un tamaño máximo personalizado', async () => {
      const buffer = Buffer.alloc(11);

      await expect(
        service.uploadFile(buffer, ruta, 'application/pdf', 10),
      ).rejects.toBeInstanceOf(PayloadTooLargeException);
      expect(client.putObject).not.toHaveBeenCalled();
    });

    it('sube el archivo al bucket de env MINIO_BUCKET y calcula el checksum MD5 correcto', async () => {
      const buffer = Buffer.from('hola mundo');
      const md5Esperado = createHash('md5').update(buffer).digest('hex');

      const resultado = await service.uploadFile(
        buffer,
        ruta,
        'application/pdf',
      );

      expect(client.putObject).toHaveBeenCalledWith(
        BUCKET,
        ruta,
        buffer,
        buffer.length,
        expect.objectContaining({ 'Content-Type': 'application/pdf' }),
      );
      expect(resultado).toEqual({
        ruta,
        bucket: BUCKET,
        checksumMd5: md5Esperado,
        tamanoBytes: buffer.length,
        mimeType: 'application/pdf',
      });
    });

    it('acepta un archivo exactamente en el límite de tamaño', async () => {
      const buffer = Buffer.alloc(10);

      await expect(
        service.uploadFile(buffer, ruta, 'image/png', 10),
      ).resolves.toMatchObject({ tamanoBytes: 10 });
      expect(client.putObject).toHaveBeenCalledTimes(1);
    });

    it('normaliza errores del storage como InternalServerErrorException', async () => {
      client.putObject.mockRejectedValueOnce(new Error('connection refused'));

      await expect(
        service.uploadFile(Buffer.from('x'), ruta, 'application/pdf'),
      ).rejects.toThrow(
        new InternalServerErrorException(
          'Error de almacenamiento al subir el archivo: connection refused',
        ),
      );
    });
  });

  describe('downloadFile', () => {
    it('descarga el archivo del bucket configurado', async () => {
      const buffer = await service.downloadFile('ruta/x.pdf');

      expect(client.getObject).toHaveBeenCalledWith(BUCKET, 'ruta/x.pdf');
      expect(buffer.toString()).toBe('contenido');
    });

    it('normaliza errores del storage al descargar', async () => {
      client.getObject.mockRejectedValueOnce(new Error('NoSuchKey'));

      await expect(service.downloadFile('ruta/x.pdf')).rejects.toThrow(
        new InternalServerErrorException(
          'Error de almacenamiento al descargar el archivo: NoSuchKey',
        ),
      );
    });
  });

  describe('deleteFile', () => {
    it('elimina el archivo del bucket configurado', async () => {
      await service.deleteFile('ruta/x.pdf');

      expect(client.removeObject).toHaveBeenCalledWith(BUCKET, 'ruta/x.pdf');
    });

    it('normaliza errores del storage al eliminar', async () => {
      client.removeObject.mockRejectedValueOnce(new Error('timeout'));

      await expect(service.deleteFile('ruta/x.pdf')).rejects.toThrow(
        new InternalServerErrorException(
          'Error de almacenamiento al eliminar el archivo: timeout',
        ),
      );
    });
  });

  describe('getPresignedUrl', () => {
    it('genera URL prefirmada con expiración por defecto de 604800 segundos (7 días)', async () => {
      const url = await service.getPresignedUrl('ruta/x.pdf');

      expect(client.presignedGetObject).toHaveBeenCalledWith(
        BUCKET,
        'ruta/x.pdf',
        EXPIRACION_PRESIGNED_DEFAULT_SEGUNDOS,
      );
      expect(EXPIRACION_PRESIGNED_DEFAULT_SEGUNDOS).toBe(604800);
      expect(url).toBe('https://minio.local/presigned');
    });

    it('respeta una expiración personalizada', async () => {
      await service.getPresignedUrl('ruta/x.pdf', 3600);

      expect(client.presignedGetObject).toHaveBeenCalledWith(
        BUCKET,
        'ruta/x.pdf',
        3600,
      );
    });

    it('normaliza errores del storage al generar la URL prefirmada', async () => {
      client.presignedGetObject.mockRejectedValueOnce(new Error('boom'));

      await expect(service.getPresignedUrl('ruta/x.pdf')).rejects.toThrow(
        new InternalServerErrorException(
          'Error de almacenamiento al generar la URL prefirmada: boom',
        ),
      );
    });
  });

  describe('configuración del bucket', () => {
    it('usa el bucket por defecto si MINIO_BUCKET no está definido', async () => {
      delete process.env.MINIO_BUCKET;
      const svc = new MinioIntegrationService(client);

      await svc.deleteFile('ruta/x.pdf');

      expect(client.removeObject).toHaveBeenCalledWith(
        'rrhh-documentos',
        'ruta/x.pdf',
      );
    });
  });
});
