import { randomUUID } from 'crypto';
import {
  BadRequestException,
  GoneException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { MinioIntegrationService } from './minio-integration.service';

/** Tipos de documento del legajo (enum TipoDocumento de Prisma, Fase 3). */
export type TipoDocumento =
  | 'CONTRATO'
  | 'CV'
  | 'DNI'
  | 'CERTIFICADO'
  | 'MEMO'
  | 'BOLETA'
  | 'OTRO';

export interface UploadDocumentInput {
  tenantId: string;
  employeeId: string;
  tipo: TipoDocumento;
  nombreArchivo: string;
  mimeType: string;
  contenido: Buffer;
  subidoPor: string;
  /** LPDP Ley 29733: marcar documentos con datos personales sensibles. */
  requiereConsentimiento?: boolean;
}

export interface UploadDocumentResult {
  documento: any;
  version: any;
  numeroVersion: number;
}

export interface DownloadDocumentResult {
  documento: any;
  contenido: Buffer;
}

export interface SearchDocumentsFilters {
  employeeId?: string;
  tipo?: TipoDocumento;
  /** Filtra por fecha de creación (creadoEn >= desde). */
  desde?: Date;
  /** Filtra por fecha de creación (creadoEn <= hasta). */
  hasta?: Date;
}

export interface LegajoView {
  employeeId: string;
  /** Documentos activos agrupados por tipo. */
  documentosPorTipo: Record<string, any[]>;
  /** Tipos requeridos sin ningún documento activo. */
  tiposFaltantes: string[];
}

/**
 * Lógica de legajo digital (Fase 3). Mismo patrón que PayrollRunService:
 * todos los métodos reciben el tx de Prisma como parámetro (el caller decide
 * el alcance transaccional y el contexto RLS del tenant). El binario vive en
 * MinIO detrás de MinioIntegrationService (inyectado, mockeable en tests);
 * en Postgres solo se guarda metadata.
 *
 * Cumplimiento LPDP (Ley 29733): la eliminación es SIEMPRE lógica
 * (estado = ELIMINADO + motivo auditable); la fila y el historial de
 * versiones nunca se destruyen.
 */
@Injectable()
export class DocumentService {
  constructor(private readonly storage: MinioIntegrationService) {}

  /**
   * Sube un documento al legajo. Si el empleado ya tiene un documento ACTIVO
   * del mismo tipo, NO se duplica: se crea la siguiente versión incremental
   * en DocumentVersion y se actualiza la metadata vigente del Document.
   * Documento nuevo => Document + DocumentVersion v1, misma transacción.
   */
  async uploadDocument(tx: any, input: UploadDocumentInput): Promise<UploadDocumentResult> {
    const { tenantId, employeeId, tipo, nombreArchivo, mimeType, contenido, subidoPor } = input;

    if (!contenido || contenido.length === 0) {
      throw new BadRequestException('El contenido del documento está vacío');
    }

    const existente = await tx.document.findFirst({
      where: { tenantId, employeeId, tipo, estado: 'ACTIVO' },
    });

    // El id del Document se necesita antes del INSERT para construir la
    // ruta canónica del objeto en MinIO (documents/{tenant}/.../{docId}/v{n}/...).
    const documentId: string = existente ? existente.id : randomUUID();

    let numeroVersion = 1;
    if (existente) {
      const ultimaVersion = await tx.documentVersion.findFirst({
        where: { documentId },
        orderBy: { numeroVersion: 'desc' },
      });
      numeroVersion = (ultimaVersion?.numeroVersion ?? 0) + 1;
    }

    const ruta = this.storage.buildPath({
      tenantId,
      employeeId,
      documentId,
      version: numeroVersion,
      filename: nombreArchivo,
    });

    // Subida primero: si el storage falla, no queda metadata huérfana en BD.
    const subida = await this.storage.uploadFile(contenido, ruta, mimeType);

    const metadataVigente = {
      nombreArchivo,
      mimeType,
      tamanoBytes: BigInt(subida.tamanoBytes),
      checksumMd5: subida.checksumMd5,
      rutaMinio: subida.ruta,
    };

    let documento;
    if (existente) {
      documento = await tx.document.update({
        where: { id: documentId },
        data: metadataVigente,
      });
    } else {
      documento = await tx.document.create({
        data: {
          id: documentId,
          tenantId,
          employeeId,
          tipo,
          estado: 'ACTIVO',
          subidoPor,
          requiereConsentimiento: input.requiereConsentimiento ?? false,
          ...metadataVigente,
        },
      });
    }

    const version = await tx.documentVersion.create({
      data: {
        tenantId,
        documentId,
        numeroVersion,
        rutaMinio: subida.ruta,
        checksumMd5: subida.checksumMd5,
        tamanoBytes: BigInt(subida.tamanoBytes),
        subidoPor,
      },
    });

    return { documento, version, numeroVersion };
  }

  /**
   * Descarga metadata + contenido binario. Los documentos ELIMINADOS
   * (derecho al olvido) no son descargables: GoneException.
   */
  async downloadDocument(tx: any, documentId: string): Promise<DownloadDocumentResult> {
    const documento = await this.obtenerDocumento(tx, documentId);

    if (documento.estado === 'ELIMINADO') {
      throw new GoneException(
        `El documento ${documentId} fue eliminado (Ley 29733) y ya no está disponible`,
      );
    }

    const contenido = await this.storage.downloadFile(documento.rutaMinio);
    return { documento, contenido };
  }

  /**
   * Soft-delete (derecho al olvido, Ley 29733): marca estado = ELIMINADO con
   * fecha y motivo auditable. NUNCA ejecuta un DELETE físico — la fila y sus
   * versiones se conservan para trazabilidad.
   */
  async deleteDocument(tx: any, documentId: string, motivo: string): Promise<any> {
    if (!motivo || motivo.trim() === '') {
      throw new BadRequestException(
        'El motivo de eliminación es obligatorio (trazabilidad Ley 29733)',
      );
    }

    const documento = await this.obtenerDocumento(tx, documentId);

    if (documento.estado === 'ELIMINADO') {
      throw new GoneException(`El documento ${documentId} ya fue eliminado`);
    }

    return tx.document.update({
      where: { id: documentId },
      data: {
        estado: 'ELIMINADO',
        eliminadoEn: new Date(),
        motivoEliminacion: motivo.trim(),
      },
    });
  }

  /**
   * Busca documentos ACTIVOS por empleado, tipo y/o rango de fecha de subida.
   * El aislamiento por tenant lo garantiza el tx (RLS via app.tenant_id).
   */
  async searchDocuments(tx: any, filtros: SearchDocumentsFilters): Promise<any[]> {
    const where: Record<string, unknown> = { estado: 'ACTIVO' };

    if (filtros.employeeId) where.employeeId = filtros.employeeId;
    if (filtros.tipo) where.tipo = filtros.tipo;
    if (filtros.desde || filtros.hasta) {
      where.creadoEn = {
        ...(filtros.desde ? { gte: filtros.desde } : {}),
        ...(filtros.hasta ? { lte: filtros.hasta } : {}),
      };
    }

    return tx.document.findMany({
      where,
      orderBy: { creadoEn: 'desc' },
    });
  }

  /**
   * Vista de legajo: documentos activos del empleado agrupados por tipo,
   * más la lista de tipos requeridos (parámetro del caller, según política
   * del tenant) que aún no tienen ningún documento.
   */
  async getLegajoView(
    tx: any,
    employeeId: string,
    tiposRequeridos: string[] = [],
  ): Promise<LegajoView> {
    const documentos = await tx.document.findMany({
      where: { employeeId, estado: 'ACTIVO' },
      orderBy: { creadoEn: 'desc' },
    });

    const documentosPorTipo: Record<string, any[]> = {};
    for (const doc of documentos) {
      (documentosPorTipo[doc.tipo] ??= []).push(doc);
    }

    const tiposFaltantes = tiposRequeridos.filter((tipo) => !documentosPorTipo[tipo]);

    return { employeeId, documentosPorTipo, tiposFaltantes };
  }

  private async obtenerDocumento(tx: any, documentId: string): Promise<any> {
    const documento = await tx.document.findUnique({ where: { id: documentId } });
    if (!documento) {
      throw new NotFoundException(`Documento ${documentId} no encontrado`);
    }
    return documento;
  }
}
