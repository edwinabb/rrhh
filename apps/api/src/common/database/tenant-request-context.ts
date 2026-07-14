import { AsyncLocalStorage } from 'node:async_hooks';
import type { Prisma } from '@rrhh/database';

export interface TenantContext {
  tenantId: string | null;
  userId: string | null;
  pgRole: 'app_rrhh' | 'app_manager' | 'app_employee' | 'app_admin';
  requestId: string;
  ipOrigen: string | null;
  userAgent: string | null;
  /** Cliente Prisma ligado a la transacción interactiva donde ya se ejecutó SET LOCAL. */
  tx: Prisma.TransactionClient;
}

/**
 * AsyncLocalStorage es lo que permite que cualquier servicio, en cualquier
 * profundidad de la pila de llamadas, obtenga el cliente Prisma ya escrito con
 * el tenant/rol de la request actual sin tener que pasarlo como parámetro por
 * todos lados. Ver TenantContextInterceptor, que es quien lo puebla.
 */
export const tenantRequestStorage = new AsyncLocalStorage<TenantContext>();

/**
 * Cualquier servicio que toque la base de datos debe usar esto en vez de
 * inyectar PrismaService directamente para queries con RLS — así es imposible
 * (a nivel de tipos y en runtime) ejecutar una query sin haber pasado por el
 * SET LOCAL app.tenant_id primero.
 */
export function getTenantContext(): TenantContext {
  const ctx = tenantRequestStorage.getStore();
  if (!ctx) {
    throw new Error(
      'getTenantContext() llamado fuera de una request con tenant resuelto. ' +
        '¿Falta @Public() en un endpoint que no debería requerir sesión, o el ' +
        'TenantContextInterceptor no está registrado?',
    );
  }
  return ctx;
}
