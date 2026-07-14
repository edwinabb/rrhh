import { Module } from '@nestjs/common';
import { AttendanceController } from './attendance.controller';
import { AttendanceService } from './attendance.service';
import {
  BIOMETRIC_PROVIDER,
  BiometricIntegrationService,
  MockBiometricProvider,
} from './biometric-integration.service';
import { PayrollAttendanceExporterService } from './payroll-attendance-exporter.service';

@Module({
  controllers: [AttendanceController],
  providers: [
    AttendanceService,
    BiometricIntegrationService,
    PayrollAttendanceExporterService,
    // Proveedor biométrico del MVP; en producción se registra la
    // implementación real bajo el mismo token sin tocar los consumidores.
    { provide: BIOMETRIC_PROVIDER, useClass: MockBiometricProvider },
  ],
  // Exportados para la integración con nómina (Fase 2 → Fase 1)
  exports: [AttendanceService, PayrollAttendanceExporterService],
})
export class AttendanceModule {}
