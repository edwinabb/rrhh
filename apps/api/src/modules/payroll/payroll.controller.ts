import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  NotFoundException,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { getTenantContext, TenantContext } from '../../common/database/tenant-request-context';
import { PayrollRunService } from './payroll-run.service';
import { PayrollImportService } from './payroll-import.service';
import { PlanillaExporter } from './planilla-exporter.service';
import { BankFileExporter, BankFileRow } from './bank-file-exporter.service';
import {
  PayrollExportMapperService,
  PlanillaDetalleRow,
} from './payroll-export-mapper.service';

function requireIdentity(ctx: TenantContext): { tenantId: string; userId: string } {
  if (!ctx.tenantId || !ctx.userId) {
    throw new BadRequestException('Request sin tenant o usuario resuelto');
  }
  return { tenantId: ctx.tenantId, userId: ctx.userId };
}

@Controller('payroll')
@UseGuards(PermissionsGuard)
export class PayrollController {
  constructor(
    private readonly payrollRunService: PayrollRunService,
    private readonly payrollImportService: PayrollImportService,
    private readonly planillaExporter: PlanillaExporter,
    private readonly bankFileExporter: BankFileExporter,
    private readonly exportMapper: PayrollExportMapperService,
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

  /**
   * Exporta la Estructura 18 de PLAME (detalle de ingresos, tributos y
   * descuentos por trabajador) del período indicado.
   */
  @Get(':periodo/export/plame')
  @RequirePermission('payroll.export')
  async exportarPlame(@Param('periodo') periodo: string) {
    const ctx = getTenantContext();
    const { tenantId } = requireIdentity(ctx);

    const planilla = await ctx.tx.planilla.findUnique({
      where: { tenantId_periodo: { tenantId, periodo } },
    });
    if (!planilla) throw new NotFoundException('Período no encontrado');
    if (planilla.estado !== 'procesado') {
      throw new BadRequestException('Período aún no procesado');
    }

    const config = await this.exportMapper.obtenerConfig(ctx.tx, tenantId);

    const detalles = await ctx.tx.planillaDetalle.findMany({
      where: { planilla: { tenantId, periodo } },
      include: {
        employee: { select: { tipoDocumento: true, numeroDocumento: true } },
      },
    });

    if (!detalles.length) {
      throw new BadRequestException('Período sin conceptos calculados');
    }

    let filas: PlanillaDetalleRow[] = [];
    for (const detalle of detalles) {
      const conceptos = (detalle.conceptosCalculados as any[]) || [];
      filas.push(
        ...this.exportMapper.mapearConceptosA18(
          conceptos,
          detalle.employee.tipoDocumento,
          detalle.employee.numeroDocumento,
          config.montoMode as string,
        ),
      );
    }

    filas = this.exportMapper.filtrarConceptosExcluidos(
      filas,
      (config.conceptosExcluidos as string[]) || [],
    );

    const contenido = this.planillaExporter.exportarE18(filas);

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Content-Disposition': `attachment; filename="E18_${periodo}.txt"`,
      },
      body: contenido,
    };
  }

  /**
   * Exporta el archivo de telecrédito BCP (pago masivo de haberes) del período.
   *
   * A diferencia de PLAME, retorna JSON: el archivo va en `archivo` y los
   * trabajadores que no pudieron incluirse (sin cuenta bancaria registrada)
   * van en `advertencias`. La falta de cuenta NO cancela la exportación —
   * es un aviso para que RRHH regularice y vuelva a exportar.
   */
  @Get(':periodo/export/telecredito')
  @RequirePermission('payroll.export')
  async exportarTelecredito(@Param('periodo') periodo: string) {
    const ctx = getTenantContext();
    const { tenantId } = requireIdentity(ctx);

    const planilla = await ctx.tx.planilla.findUnique({
      where: { tenantId_periodo: { tenantId, periodo } },
    });
    if (!planilla) throw new NotFoundException('Período no encontrado');
    if (planilla.estado !== 'procesado') {
      throw new BadRequestException('Período aún no procesado');
    }

    const detalles = await ctx.tx.planillaDetalle.findMany({
      where: { planilla: { tenantId, periodo } },
      include: {
        employee: {
          select: {
            numeroDocumento: true,
            // La principal primero; si no hay ninguna marcada, cae a la primera.
            cuentasBancarias: {
              select: { numero: true, esPrincipal: true },
              orderBy: { esPrincipal: 'desc' },
            },
          },
        },
      },
    });

    const advertencias: Array<{ numeroDocumento: string; mensaje: string }> = [];
    const filas: BankFileRow[] = [];
    let totalMonto = 0;

    for (const detalle of detalles) {
      const numeroCuenta = detalle.employee.cuentasBancarias[0]?.numero;
      if (!numeroCuenta) {
        advertencias.push({
          numeroDocumento: detalle.employee.numeroDocumento,
          mensaje: 'Sin cuenta bancaria registrada',
        });
        continue;
      }

      const conceptos = (detalle.conceptosCalculados as any[]) || [];
      const monto = conceptos.reduce((sum, c) => sum + Number(c.monto), 0);

      filas.push({
        numeroDocumento: detalle.employee.numeroDocumento,
        numeroCuenta,
        monto,
      });
      totalMonto += monto;
    }

    if (totalMonto === 0) {
      throw new BadRequestException('Nada que exportar (monto total = 0)');
    }

    const contenido = this.bankFileExporter.exportarBcp(filas);

    return {
      success: true,
      archivo: contenido,
      advertencias,
    };
  }
}
