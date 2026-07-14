import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { REQUIRED_PERMISSION_KEY } from '../decorators/require-permission.decorator';

/**
 * Chequeo síncrono contra session.permissions (calculado una vez en login por
 * PermissionsService — ver auth.service.ts). Deliberadamente NO consulta la
 * base de datos: correr como Guard significa ejecutarse antes que
 * TenantContextInterceptor, que es quien abre la transacción con RLS. Si un rol
 * cambia, el usuario debe re-loguearse para que el cambio tome efecto — deuda
 * técnica reconocida (ver README de apps/api).
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredPermission = this.reflector.getAllAndOverride<string | undefined>(
      REQUIRED_PERMISSION_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!requiredPermission) return true; // endpoint sin @RequirePermission: no restringido por RBAC

    const req = context.switchToHttp().getRequest<Request>();
    const permissions = req.session?.permissions ?? [];
    if (!permissions.includes(requiredPermission)) {
      throw new ForbiddenException(`Falta el permiso requerido: ${requiredPermission}`);
    }
    return true;
  }
}
