import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@rrhh/database';

/**
 * Wrapper delgado sobre PrismaClient. La fijación de app.tenant_id/app.user_id/etc.
 * por transacción vive en TenantContextMiddleware (SET LOCAL solo tiene efecto
 * dentro de una transacción interactiva), no aquí.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
