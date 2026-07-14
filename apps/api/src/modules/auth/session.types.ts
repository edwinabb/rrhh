import 'express-session';
import type { TenantContext } from '../../common/database/tenant-request-context';

declare module 'express-session' {
  interface SessionData {
    userId?: string;
    tenantId?: string;
    pgRole?: TenantContext['pgRole'];
    permissions?: string[];
  }
}
