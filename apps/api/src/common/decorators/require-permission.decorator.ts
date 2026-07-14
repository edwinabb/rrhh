import { SetMetadata } from '@nestjs/common';

export const REQUIRED_PERMISSION_KEY = 'requiredPermission';

/** Bloquea el endpoint si el permiso no está en session.permissions. Ver PermissionsGuard. */
export const RequirePermission = (code: string) => SetMetadata(REQUIRED_PERMISSION_KEY, code);
