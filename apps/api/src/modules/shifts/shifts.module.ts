import { Module } from '@nestjs/common';
import { ShiftsController } from './shifts.controller';
import { ShiftPlanService } from './shift-plan.service';
import { ShiftPlanImportService } from './shift-plan-import.service';
import { CompensatorioService } from './compensatorio.service';
import { ShiftComplianceService } from './shift-compliance.service';
import { AttendanceModule } from '../attendance/attendance.module';
import { NormativeParamsModule } from '../normative-params/normative-params.module';

@Module({
  imports: [AttendanceModule, NormativeParamsModule],
  controllers: [ShiftsController],
  providers: [ShiftPlanService, ShiftPlanImportService, CompensatorioService, ShiftComplianceService],
})
export class ShiftsModule {}
