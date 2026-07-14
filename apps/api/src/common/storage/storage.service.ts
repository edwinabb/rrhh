import { Injectable, OnModuleInit } from '@nestjs/common';
import { Client } from 'minio';

/**
 * Interfaz estable sobre MinIO (S3-compatible) — el Módulo 3 (Legajo Digital)
 * es quien la usa de verdad; Fase 0 solo aprovisiona el bucket y el contrato.
 * Cambiar de proveedor (S3 directo, etc.) más adelante no debería tocar a los
 * consumidores de este servicio.
 */
@Injectable()
export class StorageService implements OnModuleInit {
  private readonly client: Client;
  private readonly bucket = process.env.MINIO_BUCKET ?? 'rrhh-documentos';

  constructor() {
    this.client = new Client({
      endPoint: process.env.MINIO_ENDPOINT ?? 'localhost',
      port: Number(process.env.MINIO_PORT ?? 9000),
      useSSL: process.env.MINIO_USE_SSL === 'true',
      accessKey: process.env.MINIO_ACCESS_KEY ?? '',
      secretKey: process.env.MINIO_SECRET_KEY ?? '',
    });
  }

  async onModuleInit() {
    const exists = await this.client.bucketExists(this.bucket).catch(() => false);
    if (!exists) {
      await this.client.makeBucket(this.bucket);
      // Versionado: obligatorio para el requisito de retención documental del goal
      // (hasta 20 años en Salud) — permite recuperar versiones anteriores de un
      // documento reemplazado sin depender de borrado lógico en la app.
      await this.client.setBucketVersioning(this.bucket, { Status: 'Enabled' });
    }
  }

  async upload(key: string, data: Buffer, contentType?: string): Promise<void> {
    await this.client.putObject(this.bucket, key, data, undefined, {
      ...(contentType ? { 'Content-Type': contentType } : {}),
    });
  }

  async download(key: string): Promise<Buffer> {
    const stream = await this.client.getObject(this.bucket, key);
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(chunk as Buffer);
    }
    return Buffer.concat(chunks);
  }

  async getSignedUrl(key: string, expirySeconds = 300): Promise<string> {
    return this.client.presignedGetObject(this.bucket, key, expirySeconds);
  }
}
