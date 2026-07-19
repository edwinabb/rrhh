import {
  BadRequestException, Body, Controller, Get, Param, Post, Put, Query, UseGuards,
} from '@nestjs/common';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { getTenantContext, TenantContext } from '../../common/database/tenant-request-context';
import { ShiftPlanService, TipoDiaPlan } from './shift-plan.service';
import { ShiftPlanImportService } from './shift-plan-import.service';
import { CompensatorioService, TipoMovimientoCompensatorio } from './compensatorio.service';
import { ShiftComplianceService } from './shift-compliance.service';

const TIPOS_DIA: readonly TipoDiaPlan[] = ['TURNO', 'DESCANSO', 'DESCANSO_COMPENSATORIO'];
const TIPOS_MOVIMIENTO: readonly TipoMovimientoCompensatorio[] = ['GANADO', 'AJUSTE_INICIAL'];
const FECHA_REGEX = /^\d{4}-\d{2}-\d{2}$/;

function requireIdentity(ctx: TenantContext): { tenantId: string; userId: string } {
  if (!ctx.tenantId || !ctx.userId) {
    throw new BadRequestException('Request sin tenant o usuario resuelto');
  }
  return { tenantId: ctx.tenantId, userId: ctx.userId };
}

function parseFecha(valor: string, campo: string): Date {
  if (!FECHA_REGEX.test(valor ?? '')) {
    throw new BadRequestException(`${campo} inválida: "${valor}" (YYYY-MM-DD)`);
  }
  const [anio = 0, mes = 0, dia = 0] = valor.split('-').map(Number);
  const fecha = new Date(anio, mes - 1, dia);
  if (fecha.getFullYear() !== anio || fecha.getMonth() !== mes - 1 || fecha.getDate() !== dia) {
    throw new BadRequestException(`${campo} inexistente: "${valor}"`);
  }
  return fecha;
}

@Controller('turnos')
@UseGuards(PermissionsGuard)
export class ShiftsController {
  constructor(
    private readonly shiftPlan: ShiftPlanService,
    private readonly planImport: ShiftPlanImportService,
    private readonly compensatorios: CompensatorioService,
    private readonly compliance: ShiftComplianceService,
  ) {}

  // --- Catálogo ---
  @Get()
  @RequirePermission('shift.read')
  async listarTurnos(@Query('incluirInactivos') incluirInactivos?: string) {
    const ctx = getTenantContext();
    return this.shiftPlan.listarTurnos(ctx.tx, incluirInactivos === 'true');
  }

  @Post()
  @RequirePermission('shift.manage')
  async crearTurno(@Body() dto: any) {
    if (!dto?.codigo || !dto?.nombre || !dto?.horaInicio || !dto?.horaFin || !dto?.horasEsperadas) {
      throw new BadRequestException('codigo, nombre, horaInicio, horaFin y horasEsperadas son obligatorios');
    }
    const ctx = getTenantContext();
    const { tenantId } = requireIdentity(ctx);
    return this.shiftPlan.crearTurno(ctx.tx, {
      tenantId,
      codigo: dto.codigo,
      nombre: dto.nombre,
      horaInicio: dto.horaInicio,
      horaFin: dto.horaFin,
      horasEsperadas: Number(dto.horasEsperadas),
      toleranciaMinutos: dto.toleranciaMinutos !== undefined ? Number(dto.toleranciaMinutos) : undefined,
    });
  }

  @Put(':id')
  @RequirePermission('shift.manage')
  async actualizarTurno(@Param('id') id: string, @Body() cambios: any) {
    const ctx = getTenantContext();
    return this.shiftPlan.actualizarTurno(ctx.tx, id, cambios ?? {});
  }

  // --- Plan ---
  @Get('plan')
  @RequirePermission('shift.read')
  async obtenerPlan(
    @Query('desde') desde: string,
    @Query('hasta') hasta: string,
    @Query('employeeId') employeeId?: string,
  ) {
    const ctx = getTenantContext();
    return this.shiftPlan.obtenerPlan(ctx.tx, parseFecha(desde, 'desde'), parseFecha(hasta, 'hasta'), employeeId);
  }

  @Put('plan')
  @RequirePermission('shift.manage')
  async upsertAsignacion(@Body() dto: any) {
    if (!dto?.employeeId || !dto?.fecha || !dto?.tipoDia) {
      throw new BadRequestException('employeeId, fecha y tipoDia son obligatorios');
    }
    if (!TIPOS_DIA.includes(dto.tipoDia)) {
      throw new BadRequestException(`tipoDia inválido: "${dto.tipoDia}" (válidos: ${TIPOS_DIA.join(', ')})`);
    }
    const ctx = getTenantContext();
    const { tenantId, userId } = requireIdentity(ctx);
    return this.shiftPlan.upsertAsignacion(ctx.tx, {
      tenantId,
      employeeId: dto.employeeId,
      fecha: parseFecha(dto.fecha, 'fecha'),
      tipoDia: dto.tipoDia,
      turnoId: dto.turnoId,
      notas: dto.notas,
      creadoPor: userId,
      forzarSinSaldo: dto.forzarSinSaldo === true,
    });
  }

  @Get('plan/plantilla')
  @RequirePermission('shift.manage')
  plantilla() {
    return this.planImport.generarPlantilla();
  }

  @Post('plan/import')
  @RequirePermission('shift.manage')
  async importarPlan(@Body() dto: { contenido?: string }) {
    if (!dto?.contenido) throw new BadRequestException('contenido (CSV) es obligatorio');
    const ctx = getTenantContext();
    const { tenantId, userId } = requireIdentity(ctx);
    return this.planImport.importarCsv(ctx.tx, dto.contenido, tenantId, userId);
  }

  // --- Intercambio y compensatorios ---
  @Post('intercambio')
  @RequirePermission('shift.resolve')
  async intercambiar(@Body() dto: any) {
    if (!dto?.fecha || !dto?.employeeIdA || !dto?.employeeIdB) {
      throw new BadRequestException('fecha, employeeIdA y employeeIdB son obligatorios');
    }
    const ctx = getTenantContext();
    const { tenantId, userId } = requireIdentity(ctx);
    return this.compensatorios.intercambiar(ctx.tx, {
      tenantId,
      fecha: parseFecha(dto.fecha, 'fecha'),
      employeeIdA: dto.employeeIdA,
      employeeIdB: dto.employeeIdB,
      creadoPor: userId,
    });
  }

  @Post('compensatorios')
  @RequirePermission('shift.resolve')
  async registrarMovimiento(@Body() dto: any) {
    if (!dto?.employeeId || !dto?.tipo || dto?.dias === undefined || !dto?.fechaReferencia) {
      throw new BadRequestException('employeeId, tipo, dias y fechaReferencia son obligatorios');
    }
    if (!TIPOS_MOVIMIENTO.includes(dto.tipo)) {
      throw new BadRequestException(`tipo inválido: "${dto.tipo}" (válidos: ${TIPOS_MOVIMIENTO.join(', ')})`);
    }
    const ctx = getTenantContext();
    const { tenantId, userId } = requireIdentity(ctx);
    return this.compensatorios.registrarMovimiento(ctx.tx, {
      tenantId,
      employeeId: dto.employeeId,
      tipo: dto.tipo,
      dias: Number(dto.dias),
      fechaReferencia: parseFecha(dto.fechaReferencia, 'fechaReferencia'),
      motivo: dto.motivo,
      creadoPor: userId,
    });
  }

  @Get('compensatorios/:employeeId')
  @RequirePermission('shift.read')
  async libro(@Param('employeeId') employeeId: string) {
    const ctx = getTenantContext();
    return this.compensatorios.obtenerLibro(ctx.tx, employeeId);
  }

  // --- Cumplimiento ---
  @Get('cumplimiento/:periodo')
  @RequirePermission('shift.read')
  async cumplimiento(@Param('periodo') periodo: string) {
    const ctx = getTenantContext();
    return this.compliance.generarReporte(ctx.tx, periodo);
  }

  @Get('cumplimiento/:periodo/export')
  @RequirePermission('shift.manage')
  async exportNovedades(@Param('periodo') periodo: string) {
    const ctx = getTenantContext();
    return { csv: await this.compliance.exportarNovedadesCsv(ctx.tx, periodo) };
  }

  // --- Autoservicio: el empleado ve su propio plan ---
  @Get('mi-plan')
  async miPlan(@Query('desde') desde: string, @Query('hasta') hasta: string) {
    const ctx = getTenantContext();
    const { userId } = requireIdentity(ctx);
    const employee = await ctx.tx.employee.findFirst({ where: { userId } });
    if (!employee) {
      throw new BadRequestException('La sesión no tiene un empleado asociado');
    }
    return this.shiftPlan.obtenerPlan(
      ctx.tx, parseFecha(desde, 'desde'), parseFecha(hasta, 'hasta'), employee.id,
    );
  }
}
