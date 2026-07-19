import { Module } from '@nestjs/common';
import { AttendanceController } from './attendance.controller';
import { AttendanceService } from './attendance.service';
import { AttendanceImportService } from './attendance-import.service';
import {
  BIOMETRIC_PROVIDER,
  BiometricIntegrationService,
  MockBiometricProvider,
} from './biometric-integration.service';
import { PayrollAttendanceExporterService } from './payroll-attendance-exporter.service';
import { TurnoRecalculoService } from './turno-recalculo.service';

@Module({
  controllers: [AttendanceController],
  providers: [
    AttendanceService,
    AttendanceImportService,
    BiometricIntegrationService,
    PayrollAttendanceExporterService,
    TurnoRecalculoService,
    // Proveedor biométrico del MVP; en producción se registra la
    // implementación real bajo el mismo token sin tocar los consumidores.
    { provide: BIOMETRIC_PROVIDER, useClass: MockBiometricProvider },
  ],
  // Exportados para la integración con nómina (Fase 2 → Fase 1)
  exports: [AttendanceService, PayrollAttendanceExporterService, TurnoRecalculoService],
})
export class AttendanceModule {}
