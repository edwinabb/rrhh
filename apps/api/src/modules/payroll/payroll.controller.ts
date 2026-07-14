import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { getTenantContext } from '../../common/database/tenant-request-context';
import { PayrollRunService } from './payroll-run.service';
import { PlanillaExporter } from './planilla-exporter.service';
import { BankFileExporter } from './bank-file-exporter.service';

@Controller('payroll')
@UseGuards(PermissionsGuard)
export class PayrollController {
  constructor(
    private readonly payrollRunService: PayrollRunService,
    private readonly planillaExporter: PlanillaExporter,
    private readonly bankFileExporter: BankFileExporter,
  ) {}

  @Post(':periodo/procesar')
  @RequirePermission('payroll.process')
  async procesar(@Param('periodo') periodo: string) {
    const ctx = getTenantContext();
    return this.payrollRunService.procesarPeriodo(ctx.tx, periodo);
  }

  @Get(':periodo/export/plame')
  @RequirePermission('payroll.export')
  async exportarPlame(@Param('periodo') periodo: string) {
    const ctx = getTenantContext();
    // TODO: leer planilla_detalle del periodo y convertir a formato Estructura 18
    return {
      mensaje: 'Exportación PLAME no implementada aún — requiere completar lectura de BD',
    };
  }

  @Get(':periodo/export/telecredito')
  @RequirePermission('payroll.export')
  async exportarTelecredito(@Param('periodo') periodo: string) {
    const ctx = getTenantContext();
    // TODO: leer planilla_detalle y cuentas_bancaria del periodo para generar telecrédito
    return {
      mensaje: 'Exportación telecrédito no implementada aún — requiere completar lectura de BD',
    };
  }
}
