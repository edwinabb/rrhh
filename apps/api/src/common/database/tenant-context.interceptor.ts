import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { firstValueFrom, from, Observable } from 'rxjs';
import { Prisma } from '@rrhh/database';
import { PrismaService } from './prisma.service';
import { tenantRequestStorage, TenantContext } from './tenant-request-context';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';

/**
 * Envuelve cada request autenticada en una transacción interactiva de Prisma:
 * 1. Abre la transacción.
 * 2. Ejecuta SET LOCAL app.tenant_id / app.user_id / app.request_id / app.ip_origen /
 *    app.user_agent, y SET LOCAL ROLE <rol pg> — todo transaction-scoped, así que
 *    connection pooling (PgBouncer transaction mode) es seguro.
 * 3. Publica esa transacción en AsyncLocalStorage para que cualquier servicio la
 *    recupere vía getTenantContext() sin necesidad de pasarla explícitamente.
 * 4. Ejecuta el resto del pipeline de Nest (guards ya corrieron; esto envuelve el
 *    handler del controller) dentro de la misma transacción.
 *
 * Endpoints marcados @Public() (login, health check) se saltan todo esto: no hay
 * tenant que resolver todavía.
 */
@Injectable()
export class TenantContextInterceptor implements NestInterceptor {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reflector: Reflector,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return next.handle();
    }

    const req = context.switchToHttp().getRequest<Request>();
    const session = req.session as
      | { userId?: string; tenantId?: string; pgRole?: TenantContext['pgRole'] }
      | undefined;

    // AuthGuard corre antes que este interceptor y ya habrá rechazado la request
    // si no hay sesión válida — aquí asumimos que session existe para rutas no públicas.
    const requestId = randomUUID();

    return from(
      this.prisma.$transaction(async (tx) => {
        const ctx: TenantContext = {
          tenantId: session?.tenantId ?? null,
          userId: session?.userId ?? null,
          pgRole: session?.pgRole ?? 'app_employee',
          requestId,
          ipOrigen: req.ip ?? null,
          userAgent: req.get('user-agent') ?? null,
          tx,
        };

        await tx.$executeRaw`SELECT set_config('app.tenant_id', ${ctx.tenantId ?? ''}, true)`;
        await tx.$executeRaw`SELECT set_config('app.user_id', ${ctx.userId ?? ''}, true)`;
        await tx.$executeRaw`SELECT set_config('app.request_id', ${ctx.requestId}, true)`;
        await tx.$executeRaw`SELECT set_config('app.ip_origen', ${ctx.ipOrigen ?? ''}, true)`;
        await tx.$executeRaw`SELECT set_config('app.user_agent', ${ctx.userAgent ?? ''}, true)`;
        await tx.$executeRaw`SELECT set_config('app.role', ${ctx.pgRole}, true)`;
        // SET LOCAL ROLE no acepta bind params — el valor viene de un enum cerrado
        // (TenantContext['pgRole']), nunca de input directo del usuario.
        await tx.$executeRawUnsafe(`SET LOCAL ROLE ${ctx.pgRole}`);

        return tenantRequestStorage.run(ctx, () => firstValueFrom(next.handle()));
      }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted }),
    );
  }
}
