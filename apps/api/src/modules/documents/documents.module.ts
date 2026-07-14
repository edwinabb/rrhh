import { Module } from '@nestjs/common';
import { DocumentsController } from './documents.controller';
import { DocumentService } from './document.service';
import {
  MinioIntegrationService,
  MinioStorageClient,
  OBJECT_STORAGE_CLIENT,
} from './minio-integration.service';

@Module({
  controllers: [DocumentsController],
  providers: [
    DocumentService,
    MinioIntegrationService,
    // Cliente real sobre el SDK oficial de MinIO (paquete "minio", ya presente
    // en package.json). En tests unitarios NUNCA se usa: los specs inyectan un
    // mock bajo el mismo token OBJECT_STORAGE_CLIENT (patrón BIOMETRIC_PROVIDER).
    { provide: OBJECT_STORAGE_CLIENT, useClass: MinioStorageClient },
  ],
  // Exportados para otros módulos (p. ej. ATS de Fase 4 almacena CVs)
  exports: [DocumentService, MinioIntegrationService],
})
export class DocumentsModule {}
