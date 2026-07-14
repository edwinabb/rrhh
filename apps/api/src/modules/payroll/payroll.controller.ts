import { Body, Controller, Get, Header, Param, Post, UseGuards } from '@nestjs/common';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { getTenantContext } from '../../common/database/tenant-request-context';
import { PayrollRunService } from './payroll-run.service';
import { PayrollImportService } from './payroll-import.service';
import { PlanillaExporter } from './planilla-exporter.service';
import { BankFileExporter } from './bank-file-exporter.service';

@Controller('payroll')
@UseGuards(PermissionsGuard)
export class PayrollController {
  constructor(
    private readonly payrollRunService: PayrollRunService,
    private readonly payrollImportService: PayrollImportService,
    private readonly planillaExporter: PlanillaExporter,
    private readonly bankFileExporter: BankFileExporter,
  ) {}

  /** Plantilla CSV de novedades (con BOM UTF-8 para Excel), descargable. */
  @Get('import/plantilla')
  @RequirePermission('payroll.import')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="plantilla-novedades.csv"')
  descargarPlantillaNovedades(): string {
    return this.payrollImportService.generarPlantilla();
  }

  /** Importa novedades del período desde un CSV. Reporte: { procesadas, omitidas, errores }. */
  @Post(':periodo/import')
  @RequirePermission('payroll.import')
  async importarNovedades(@Param('periodo') periodo: string, @Body() body: { csv: string }) {
    const ctx = getTenantContext();
    return this.payrollImportService.importarCsv(ctx.tx, periodo, body?.csv ?? '');
  }

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
