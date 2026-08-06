import { Module } from '@nestjs/common';
import { ShiftsController } from './shifts.controller';
import { ShiftPlanService } from './shift-plan.service';
import { ShiftPlanImportService } from './shift-plan-import.service';
import { CompensatorioService } from './compensatorio.service';
import { ShiftComplianceService } from './shift-compliance.service';
import { RotacionPatronService } from './rotacion-patron.service';
import { RotacionAplicadorService } from './rotacion-aplicador.service';
import { SolicitudCambioTurnoService } from './solicitud-cambio-turno.service';
import { SolicitudCambioTurnoAplicadorService } from './solicitud-cambio-turno-aplicador.service';
import { SolicitudTrabajoAdicionalService } from './solicitud-trabajo-adicional.service';
import { SolicitudTrabajoAdicionalAplicadorService } from './solicitud-trabajo-adicional-aplicador.service';
import { IntercambioTurnoService } from './intercambio-turno.service';
import { IntercambioTurnoAplicadorService } from './intercambio-turno-aplicador.service';
import { AttendanceModule } from '../attendance/attendance.module';
import { NormativeParamsModule } from '../normative-params/normative-params.module';
import { EmployeesModule } from '../employees/employees.module';
import { NotificationService } from '../../common/services/notification.service';

@Module({
  imports: [AttendanceModule, NormativeParamsModule, EmployeesModule],
  controllers: [ShiftsController],
  providers: [
    ShiftPlanService,
    ShiftPlanImportService,
    CompensatorioService,
    ShiftComplianceService,
    RotacionPatronService,
    RotacionAplicadorService,
    SolicitudCambioTurnoService,
    SolicitudCambioTurnoAplicadorService,
    SolicitudTrabajoAdicionalService,
    SolicitudTrabajoAdicionalAplicadorService,
    IntercambioTurnoService,
    IntercambioTurnoAplicadorService,
    NotificationService,
  ],
})
export class ShiftsModule {}
