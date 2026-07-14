import { createHash } from 'crypto';
import {
  Inject,
  Injectable,
  InternalServerErrorException,
  PayloadTooLargeException,
} from '@nestjs/common';
import { Client as MinioClient } from 'minio';

/**
 * Contrato mínimo que debe cumplir cualquier cliente de object storage
 * (MinIO, S3, etc.). Se inyecta bajo OBJECT_STORAGE_CLIENT para poder
 * mockearlo en tests (mismo patrón que BIOMETRIC_PROVIDER).
 */
export interface ObjectStorageClient {
  putObject(
    bucket: string,
    objectName: string,
    buffer: Buffer,
    size: number,
    metadata?: Record<string, string>,
  ): Promise<void>;
  getObject(bucket: string, objectName: string): Promise<Buffer>;
  removeObject(bucket: string, objectName: string): Promise<void>;
  presignedGetObject(
    bucket: string,
    objectName: string,
    expirySeconds: number,
  ): Promise<string>;
}

/** Token de inyección para el cliente de object storage activo. */
export const OBJECT_STORAGE_CLIENT = 'OBJECT_STORAGE_CLIENT';

/** Tamaño máximo de archivo por defecto: 100MB. */
export const TAMANO_MAXIMO_DEFAULT_BYTES = 100 * 1024 * 1024;

/** Expiración por defecto de URLs prefirmadas: 7 días. */
export const EXPIRACION_PRESIGNED_DEFAULT_SEGUNDOS = 604800;

/** Bucket usado si MINIO_BUCKET no está definido en el entorno. */
const BUCKET_DEFAULT = 'rrhh-documentos';

/** Parámetros para construir la ruta canónica de un documento versionado. */
export interface DocumentPathParams {
  tenantId: string;
  employeeId: string;
  documentId: string;
  /** Número de versión (1-based), se serializa como v{n}. */
  version: number;
  filename: string;
}

/** Resultado de una subida exitosa. */
export interface UploadResult {
  ruta: string;
  bucket: string;
  /** Checksum MD5 en hex del contenido subido. */
  checksumMd5: string;
  tamanoBytes: number;
  mimeType: string;
}

/**
 * Servicio de integración con MinIO para el módulo documental (Fase 3).
 *
 * Toda interacción con el storage pasa por el ObjectStorageClient inyectado;
 * los errores del backend de storage se normalizan a
 * InternalServerErrorException para que los consumidores no dependan de los
 * tipos de error del cliente concreto.
 */
@Injectable()
export class MinioIntegrationService {
  private readonly bucket: string;

  constructor(
    @Inject(OBJECT_STORAGE_CLIENT)
    private readonly client: ObjectStorageClient,
  ) {
    this.bucket = process.env.MINIO_BUCKET ?? BUCKET_DEFAULT;
  }

  /**
   * Construye la ruta canónica de almacenamiento:
   * documents/{tenantId}/employees/{employeeId}/{documentId}/v{n}/{filename}
   */
  buildPath(params: DocumentPathParams): string {
    const { tenantId, employeeId, documentId, version, filename } = params;
    return `documents/${tenantId}/employees/${employeeId}/${documentId}/v${version}/${filename}`;
  }

  /**
   * Sube un archivo al bucket configurado.
   *
   * @param buffer          contenido del archivo
   * @param ruta            ruta destino (usar buildPath)
   * @param mimeType        content-type declarado
   * @param tamanoMaxBytes  límite de tamaño; por defecto 100MB
   */
  async uploadFile(
    buffer: Buffer,
    ruta: string,
    mimeType: string,
    tamanoMaxBytes: number = TAMANO_MAXIMO_DEFAULT_BYTES,
  ): Promise<UploadResult> {
    if (buffer.length > tamanoMaxBytes) {
      throw new PayloadTooLargeException(
        `El archivo excede el tamaño máximo permitido: ` +
          `${buffer.length} bytes (máximo: ${tamanoMaxBytes} bytes)`,
      );
    }

    const checksumMd5 = createHash('md5').update(buffer).digest('hex');

    try {
      await this.client.putObject(this.bucket, ruta, buffer, buffer.length, {
        'Content-Type': mimeType,
      });
    } catch (err) {
      throw this.normalizarError('subir el archivo', err);
    }

    return {
      ruta,
      bucket: this.bucket,
      checksumMd5,
      tamanoBytes: buffer.length,
      mimeType,
    };
  }

  /** Descarga el contenido completo de un archivo. */
  async downloadFile(ruta: string): Promise<Buffer> {
    try {
      return await this.client.getObject(this.bucket, ruta);
    } catch (err) {
      throw this.normalizarError('descargar el archivo', err);
    }
  }

  /** Elimina un archivo del bucket. */
  async deleteFile(ruta: string): Promise<void> {
    try {
      await this.client.removeObject(this.bucket, ruta);
    } catch (err) {
      throw this.normalizarError('eliminar el archivo', err);
    }
  }

  /**
   * Genera una URL prefirmada de descarga.
   *
   * @param expiraSegundos vigencia de la URL; por defecto 604800 (7 días)
   */
  async getPresignedUrl(
    ruta: string,
    expiraSegundos: number = EXPIRACION_PRESIGNED_DEFAULT_SEGUNDOS,
  ): Promise<string> {
    try {
      return await this.client.presignedGetObject(
        this.bucket,
        ruta,
        expiraSegundos,
      );
    } catch (err) {
      throw this.normalizarError('generar la URL prefirmada', err);
    }
  }

  private normalizarError(
    operacion: string,
    err: unknown,
  ): InternalServerErrorException {
    const detalle = err instanceof Error ? err.message : String(err);
    return new InternalServerErrorException(
      `Error de almacenamiento al ${operacion}: ${detalle}`,
    );
  }
}

/**
 * Implementación real de ObjectStorageClient sobre el SDK oficial de MinIO.
 *
 * No se usa en tests unitarios (siempre se inyecta un mock bajo
 * OBJECT_STORAGE_CLIENT); el módulo de documentos la registra en producción:
 *
 *   { provide: OBJECT_STORAGE_CLIENT, useClass: MinioStorageClient }
 *
 * Config por env: MINIO_ENDPOINT, MINIO_PORT, MINIO_USE_SSL,
 * MINIO_ACCESS_KEY, MINIO_SECRET_KEY.
 */
@Injectable()
export class MinioStorageClient implements ObjectStorageClient {
  private readonly minio: MinioClient;

  constructor() {
    this.minio = new MinioClient({
      endPoint: process.env.MINIO_ENDPOINT ?? 'localhost',
      port: Number(process.env.MINIO_PORT ?? 9000),
      useSSL: process.env.MINIO_USE_SSL === 'true',
      accessKey: process.env.MINIO_ACCESS_KEY ?? '',
      secretKey: process.env.MINIO_SECRET_KEY ?? '',
    });
  }

  async putObject(
    bucket: string,
    objectName: string,
    buffer: Buffer,
    size: number,
    metadata?: Record<string, string>,
  ): Promise<void> {
    await this.minio.putObject(bucket, objectName, buffer, size, metadata);
  }

  async getObject(bucket: string, objectName: string): Promise<Buffer> {
    const stream = await this.minio.getObject(bucket, objectName);
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }

  async removeObject(bucket: string, objectName: string): Promise<void> {
    await this.minio.removeObject(bucket, objectName);
  }

  async presignedGetObject(
    bucket: string,
    objectName: string,
    expirySeconds: number,
  ): Promise<string> {
    return this.minio.presignedGetObject(bucket, objectName, expirySeconds);
  }
}
