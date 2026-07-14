/**
 * Helper compartido por los tests de integración. Requiere Postgres real
 * (docker-compose up postgres) con la migración de Fase 0 ya aplicada:
 *
 *   docker compose up -d postgres
 *   pnpm db:migrate
 *   pnpm --filter @rrhh/api test:integration
 *
 * No usa mocks: el objetivo de esta suite es probar exactamente lo que un mock
 * no puede — RLS y roles nativos de Postgres — contra el motor real.
 */
import { PrismaClient } from '@rrhh/database';

export const rootClient = new PrismaClient();

export async function withTenantContext<T>(
  params: { tenantId?: string; userId?: string; pgRole?: string },
  fn: (tx: PrismaClient) => Promise<T>,
): Promise<T> {
  return rootClient.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${params.tenantId ?? ''}, true)`;
    await tx.$executeRaw`SELECT set_config('app.user_id', ${params.userId ?? ''}, true)`;
    if (params.pgRole) {
      await tx.$executeRawUnsafe(`SET LOCAL ROLE ${params.pgRole}`);
    }
    return fn(tx as unknown as PrismaClient);
  });
}

export async function createTenant(ruc: string, razonSocial: string) {
  return rootClient.tenant.create({ data: { ruc, razonSocial } });
}

export async function cleanupTenant(tenantId: string) {
  // Como app_rrhh (rol por defecto de la conexión de test) tiene DELETE solo
  // como app_admin en algunas tablas — limpiar como el rol de conexión base
  // (superusuario del contenedor de test), fuera de RLS.
  await rootClient.employee.deleteMany({ where: { tenantId } });
  await rootClient.sede.deleteMany({ where: { tenantId } });
  await rootClient.userRole.deleteMany({ where: { user: { tenantId } } });
  await rootClient.user.deleteMany({ where: { tenantId } });
  await rootClient.role.deleteMany({ where: { tenantId } });
  await rootClient.tenant.delete({ where: { id: tenantId } });
}
