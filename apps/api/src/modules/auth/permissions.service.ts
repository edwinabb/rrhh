import { Injectable } from '@nestjs/common';

/**
 * Forma mínima de cliente Prisma que esta clase necesita — permite testear con
 * un mock plano en vez de instanciar/mockear todo PrismaClient, y permite
 * pasarle indistintamente el cliente base o una transacción (Prisma.TransactionClient),
 * que comparten esta forma.
 */
export interface PermissionsQueryClient {
  userRole: {
    findMany: (args: {
      where: { userId: string };
      include: { role: { include: { permissions: { include: { permission: true } } } } };
    }) => Promise<
      Array<{
        role: {
          permissions: Array<{ permission: { code: string } }>;
        };
      }>
    >;
  };
}

@Injectable()
export class PermissionsService {
  /**
   * Agrega los códigos de permiso de todos los roles asignados a un usuario,
   * sin duplicados. Se llama una sola vez en login (no por request) — el
   * resultado se guarda en la sesión y PermissionsGuard lo lee de ahí.
   */
  async getPermissionCodesForUser(
    client: PermissionsQueryClient,
    userId: string,
  ): Promise<string[]> {
    const userRoles = await client.userRole.findMany({
      where: { userId },
      include: { role: { include: { permissions: { include: { permission: true } } } } },
    });

    const codes = new Set<string>();
    for (const userRole of userRoles) {
      for (const rolePermission of userRole.role.permissions) {
        codes.add(rolePermission.permission.code);
      }
    }
    return Array.from(codes);
  }
}
