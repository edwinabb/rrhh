import { Module } from '@nestjs/common';
import { PayrollController } from './payroll.controller';
import { PayrollRunService } from './payroll-run.service';
import { PayrollImportService } from './payroll-import.service';
import { PlanillaExporter } from './planilla-exporter.service';
import { BankFileExporter } from './bank-file-exporter.service';
import { NormativeParamsModule } from '../normative-params/normative-params.module';

@Module({
  imports: [NormativeParamsModule],
  controllers: [PayrollController],
  providers: [PayrollRunService, PayrollImportService, PlanillaExporter, BankFileExporter],
})
export class PayrollModule {}
