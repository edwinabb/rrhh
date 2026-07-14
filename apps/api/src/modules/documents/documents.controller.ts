import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import {
  getTenantContext,
  TenantContext,
} from '../../common/database/tenant-request-context';
import { DocumentService, TipoDocumento } from './document.service';

// ---------------------------------------------------------------------------
// DTOs (sin class-validator: el proyecto no lo usa; validación mínima manual)
// ---------------------------------------------------------------------------

export class UploadDocumentDto {
  employeeId!: string;
  tipo!: TipoDocumento;
  nombreArchivo!: string;
  mimeType!: string;
  /** Contenido binario del archivo codificado en base64. */
  contenidoBase64!: string;
  /** LPDP Ley 29733: marcar documentos con datos personales sensibles. */
  requiereConsentimiento?: boolean;
}

export class DeleteDocumentDto {
  /** Motivo auditable de la eliminación lógica (obligatorio, Ley 29733). */
  motivo!: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TIPOS_DOCUMENTO: readonly TipoDocumento[] = [
  'CONTRATO',
  'CV',
  'DNI',
  'CERTIFICADO',
  'MEMO',
  'BOLETA',
  'OTRO',
];

/** tenantId/userId son nullables en el contexto; estos endpoints los exigen. */
function requireIdentity(ctx: TenantContext): { tenantId: string; userId: string } {
  if (!ctx.tenantId || !ctx.userId) {
    throw new BadRequestException('Request sin tenant o usuario resuelto');
  }
  return { tenantId: ctx.tenantId, userId: ctx.userId };
}

function parsearFecha(nombre: string, valor?: string): Date | undefined {
  if (!valor) return undefined;
  const fecha = new Date(valor);
  if (Number.isNaN(fecha.getTime())) {
    throw new BadRequestException(`Parámetro ${nombre} inválido: "${valor}"`);
  }
  return fecha;
}

/**
 * Las filas de Document llevan tamanoBytes como BigInt (Prisma @db.BigInt) y
 * JSON.stringify no serializa BigInt. Con el límite de 100MB por archivo el
 * valor siempre cabe en un Number, así que se convierte de forma recursiva
 * antes de responder.
 */
function serializarBigInt<T>(valor: T): T {
  if (typeof valor === 'bigint') return Number(valor) as unknown as T;
  if (Array.isArray(valor)) {
    return valor.map((item) => serializarBigInt(item)) as unknown as T;
  }
  if (valor !== null && typeof valor === 'object' && !(valor instanceof Date)) {
    return Object.fromEntries(
      Object.entries(valor as Record<string, unknown>).map(([k, v]) => [
        k,
        serializarBigInt(v),
      ]),
    ) as unknown as T;
  }
  return valor;
}

// ---------------------------------------------------------------------------
// Controller
// ---------------------------------------------------------------------------

@Controller('documents')
@UseGuards(PermissionsGuard)
export class DocumentsController {
  constructor(private readonly documentService: DocumentService) {}

  /**
   * POST /documents — sube un documento al legajo (base64 en el body).
   * Si el empleado ya tiene un documento ACTIVO del mismo tipo se versiona
   * (DocumentVersion incremental) en lugar de duplicarse.
   */
  @Post()
  @RequirePermission('documents.upload')
  async uploadDocument(@Body() dto: UploadDocumentDto) {
    const ctx = getTenantContext();
    const { tenantId, userId } = requireIdentity(ctx);

    if (
      !dto.employeeId ||
      !dto.tipo ||
      !dto.nombreArchivo ||
      !dto.mimeType ||
      !dto.contenidoBase64
    ) {
      throw new BadRequestException(
        'employeeId, tipo, nombreArchivo, mimeType y contenidoBase64 son obligatorios',
      );
    }
    if (!TIPOS_DOCUMENTO.includes(dto.tipo)) {
      throw new BadRequestException(
        `Tipo de documento inválido: "${dto.tipo}" (válidos: ${TIPOS_DOCUMENTO.join(', ')})`,
      );
    }

    const contenido = Buffer.from(dto.contenidoBase64, 'base64');
    if (contenido.length === 0) {
      throw new BadRequestException('contenidoBase64 no contiene datos válidos');
    }

    const resultado = await this.documentService.uploadDocument(ctx.tx, {
      tenantId,
      employeeId: dto.employeeId,
      tipo: dto.tipo,
      nombreArchivo: dto.nombreArchivo,
      mimeType: dto.mimeType,
      contenido,
      subidoPor: userId,
      requiereConsentimiento: dto.requiereConsentimiento,
    });

    return serializarBigInt(resultado);
  }

  /**
   * GET /documents/search — busca documentos ACTIVOS por empleado, tipo y/o
   * rango de fechas de subida (?employeeId=&tipo=&desde=&hasta=, ISO 8601).
   * El aislamiento por tenant lo garantiza RLS via el tx del contexto.
   */
  @Get('search')
  @RequirePermission('documents.read')
  async searchDocuments(
    @Query('employeeId') employeeId?: string,
    @Query('tipo') tipo?: string,
    @Query('desde') desde?: string,
    @Query('hasta') hasta?: string,
  ) {
    const ctx = getTenantContext();

    if (tipo && !TIPOS_DOCUMENTO.includes(tipo as TipoDocumento)) {
      throw new BadRequestException(
        `Tipo de documento inválido: "${tipo}" (válidos: ${TIPOS_DOCUMENTO.join(', ')})`,
      );
    }

    const documentos = await this.documentService.searchDocuments(ctx.tx, {
      employeeId,
      tipo: tipo as TipoDocumento | undefined,
      desde: parsearFecha('desde', desde),
      hasta: parsearFecha('hasta', hasta),
    });

    return serializarBigInt(documentos);
  }

  /**
   * GET /documents/legajo/:employeeId — vista de legajo: documentos activos
   * agrupados por tipo + tipos requeridos faltantes
   * (?tiposRequeridos=CONTRATO,DNI — lista separada por comas, opcional).
   */
  @Get('legajo/:employeeId')
  @RequirePermission('documents.read')
  async getLegajo(
    @Param('employeeId') employeeId: string,
    @Query('tiposRequeridos') tiposRequeridos?: string,
  ) {
    const ctx = getTenantContext();

    const tipos = tiposRequeridos
      ? tiposRequeridos
          .split(',')
          .map((t) => t.trim())
          .filter((t) => t.length > 0)
      : [];

    const legajo = await this.documentService.getLegajoView(ctx.tx, employeeId, tipos);
    return serializarBigInt(legajo);
  }

  /**
   * GET /documents/:id/download — metadata + contenido (base64) del documento.
   * Los documentos ELIMINADOS (derecho al olvido) responden 410 Gone.
   */
  @Get(':id/download')
  @RequirePermission('documents.read')
  async downloadDocument(@Param('id') id: string) {
    const ctx = getTenantContext();

    const { documento, contenido } = await this.documentService.downloadDocument(
      ctx.tx,
      id,
    );

    return serializarBigInt({
      documento,
      nombreArchivo: documento.nombreArchivo,
      mimeType: documento.mimeType,
      contenidoBase64: contenido.toString('base64'),
    });
  }

  /**
   * DELETE /documents/:id — eliminación lógica (Ley 29733): estado = ELIMINADO
   * con motivo auditable en el body. Nunca borra la fila ni sus versiones.
   */
  @Delete(':id')
  @RequirePermission('documents.delete')
  async deleteDocument(@Param('id') id: string, @Body() dto: DeleteDocumentDto) {
    const ctx = getTenantContext();
    requireIdentity(ctx);

    if (!dto?.motivo || dto.motivo.trim() === '') {
      throw new BadRequestException(
        'motivo es obligatorio para eliminar un documento (trazabilidad Ley 29733)',
      );
    }

    const documento = await this.documentService.deleteDocument(ctx.tx, id, dto.motivo);
    return serializarBigInt(documento);
  }
}
