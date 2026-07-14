import { Injectable, UnauthorizedException } from '@nestjs/common';
import * as argon2 from 'argon2';
import { PrismaService } from '../../common/database/prisma.service';
import type { TenantContext } from '../../common/database/tenant-request-context';
import { PermissionsService } from './permissions.service';

export interface AuthenticatedIdentity {
  userId: string;
  tenantId: string;
  pgRole: TenantContext['pgRole'];
  permissions: string[];
}

// Prioridad cuando un usuario tiene más de un rol de sistema asignado — Fase 0
// no tiene UI de "cambiar de rol activo"; eso queda como deuda técnica explícita.
const ROLE_NAME_TO_PG_ROLE: Record<string, TenantContext['pgRole']> = {
  Admin: 'app_admin',
  RRHH: 'app_rrhh',
  Manager: 'app_manager',
  Employee: 'app_employee',
};
const ROLE_PRIORITY: TenantContext['pgRole'][] = [
  'app_admin',
  'app_rrhh',
  'app_manager',
  'app_employee',
];

interface AuthLookupRow {
  id: string;
  tenant_id: string;
  email: string;
  password_hash: string;
  estado: string;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissionsService: PermissionsService,
  ) {}

  /**
   * Valida credenciales SIN requerir tenant/rol resuelto todavía (por eso usa la
   * función SECURITY DEFINER auth_lookup_user en vez de una query Prisma normal,
   * que sería bloqueada por RLS al no haber SET LOCAL app.tenant_id aún — ver
   * migración 20260710000000_init_foundations, sección 3b).
   */
  async validateCredentials(email: string, password: string): Promise<AuthenticatedIdentity> {
    const rows = await this.prisma.$queryRaw<AuthLookupRow[]>`
      SELECT * FROM auth_lookup_user(${email})
    `;
    const user = rows[0];
    if (!user || user.estado !== 'activo') {
      throw new UnauthorizedException('Credenciales inválidas');
    }

    const passwordMatches = await argon2.verify(user.password_hash, password);
    if (!passwordMatches) {
      throw new UnauthorizedException('Credenciales inválidas');
    }

    const { pgRole, permissions } = await this.resolveRoleAndPermissions(
      user.id,
      user.tenant_id,
    );

    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    return { userId: user.id, tenantId: user.tenant_id, pgRole, permissions };
  }

  /**
   * Ahora que ya conocemos el tenant, esta consulta sí puede pasar por RLS
   * normal (transacción corta con SET LOCAL app.tenant_id fijado explícitamente
   * a este único propósito, no a través del interceptor de request).
   */
  private async resolveRoleAndPermissions(
    userId: string,
    tenantId: string,
  ): Promise<{ pgRole: TenantContext['pgRole']; permissions: string[] }> {
    const { roleNames, permissions } = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
      await tx.$executeRawUnsafe('SET LOCAL ROLE app_rrhh');
      const userRoles = await tx.userRole.findMany({
        where: { userId },
        include: { role: true },
      });
      const permissionCodes = await this.permissionsService.getPermissionCodesForUser(tx, userId);
      return { roleNames: userRoles.map((ur) => ur.role.nombre), permissions: permissionCodes };
    });

    for (const pgRole of ROLE_PRIORITY) {
      const roleName = Object.entries(ROLE_NAME_TO_PG_ROLE).find(([, v]) => v === pgRole)?.[0];
      if (roleName && roleNames.includes(roleName)) {
        return { pgRole, permissions };
      }
    }
    // Sin rol asignado todavía: el más restrictivo por defecto, nunca el más privilegiado.
    return { pgRole: 'app_employee', permissions };
  }
}
