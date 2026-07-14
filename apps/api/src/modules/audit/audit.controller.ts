import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { getTenantContext } from '../../common/database/tenant-request-context';

/**
 * Solo lectura — AUDIT_LOG es append-only a nivel de BD (revocado UPDATE/DELETE
 * a todos los roles, ver migración 20260710000000_init_foundations). Este
 * controller nunca necesita (ni debe) exponer un endpoint de escritura: el
 * trigger de Postgres es la única vía de inserción.
 */
@Controller('audit-log')
@UseGuards(PermissionsGuard)
export class AuditController {
  @Get()
  @RequirePermission('audit_log.read')
  async list(@Query('tabla') tabla?: string, @Query('registroId') registroId?: string) {
    const ctx = getTenantContext();
    return ctx.tx.auditLog.findMany({
      where: {
        ...(tabla ? { tabla } : {}),
        ...(registroId ? { registroId } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
  }
}
