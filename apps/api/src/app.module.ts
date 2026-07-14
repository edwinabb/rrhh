import { Module } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { DatabaseModule } from './common/database/database.module';
import { QueueModule } from './common/queue/queue.module';
import { StorageModule } from './common/storage/storage.module';
import { TenantContextInterceptor } from './common/database/tenant-context.interceptor';
import { AuthModule } from './modules/auth/auth.module';
import { SessionAuthGuard } from './modules/auth/session-auth.guard';
import { EmployeesModule } from './modules/employees/employees.module';
import { NormativeParamsModule } from './modules/normative-params/normative-params.module';
import { AuditModule } from './modules/audit/audit.module';
import { PayrollModule } from './modules/payroll/payroll.module';
import { AttendanceModule } from './modules/attendance/attendance.module';
import { DocumentsModule } from './modules/documents/documents.module';
import { AtsModule } from './modules/ats/ats.module';

@Module({
  imports: [
    DatabaseModule,
    QueueModule,
    StorageModule,
    AuthModule,
    EmployeesModule,
    NormativeParamsModule,
    AuditModule,
    PayrollModule,
    AttendanceModule,
    DocumentsModule,
    AtsModule,
  ],
  providers: [
    // Orden real de ejecución en Nest: guards -> interceptors, sin importar el
    // orden de declaración aquí. SessionAuthGuard rechaza requests sin sesión
    // antes de que TenantContextInterceptor llegue a abrir una transacción.
    { provide: APP_GUARD, useClass: SessionAuthGuard },
    { provide: APP_INTERCEPTOR, useClass: TenantContextInterceptor },
  ],
})
export class AppModule {}
