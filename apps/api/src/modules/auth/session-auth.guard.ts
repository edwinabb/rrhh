import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { IS_PUBLIC_KEY } from '../../common/decorators/public.decorator';

/**
 * Guard global: toda ruta requiere sesión válida salvo que esté marcada @Public().
 * Corre antes que TenantContextInterceptor (guards preceden a interceptors en el
 * pipeline de Nest), así que si esto rechaza la request, nunca se abre la
 * transacción de Prisma ni se toca la base de datos.
 */
@Injectable()
export class SessionAuthGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest<Request>();
    const session = req.session as { userId?: string; tenantId?: string } | undefined;
    if (!session?.userId || !session?.tenantId) {
      throw new UnauthorizedException('Sesión requerida');
    }
    return true;
  }
}
