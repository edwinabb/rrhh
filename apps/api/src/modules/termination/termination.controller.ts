import { BadRequestException, Body, Controller, Get, Param, Post, Put, UseGuards } from '@nestjs/common';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { getTenantContext, TenantContext } from '../../common/database/tenant-request-context';
import { TerminationService, CeseSnapshot } from './termination.service';
import { MotivoCese } from '../payroll/calculators/liquidacion.calculator';

export class CrearCeseDto {
  employeeId!: string;
  /** ISO YYYY-MM-DD. */
  fechaCese!: string;
  motivo!: MotivoCese;
}

export class AnularCeseDto {
  motivo!: string;
}

const MOTIVOS: readonly MotivoCese[] = [
  'RENUNCIA',
  'TERMINO_CONTRATO',
  'MUTUO_DISENSO',
  'DESPIDO_ARBITRARIO',
  'FALLECIMIENTO',
];

function requireIdentity(ctx: TenantContext): { tenantId: string; userId: string } {
  if (!ctx.tenantId || !ctx.userId) {
    throw new BadRequestException('Request sin tenant o usuario resuelto');
  }
  return { tenantId: ctx.tenantId, userId: ctx.userId };
}

@Controller('ceses')
@UseGuards(PermissionsGuard)
export class TerminationController {
  constructor(private readonly termination: TerminationService) {}

  @Get()
  @RequirePermission('termination.read')
  async listar() {
    const ctx = getTenantContext();
    return this.termination.listar(ctx.tx);
  }

  @Get(':id')
  @RequirePermission('termination.read')
  async detalle(@Param('id') id: string) {
    const ctx = getTenantContext();
    return this.termination.detalle(ctx.tx, id);
  }

  @Post()
  @RequirePermission('termination.manage')
  async crear(@Body() dto: CrearCeseDto) {
    if (!dto?.employeeId || !dto?.fechaCese || !dto?.motivo) {
      throw new BadRequestException('employeeId, fechaCese y motivo son obligatorios');
    }
    if (!MOTIVOS.includes(dto.motivo)) {
      throw new BadRequestException(`Motivo inválido: "${dto.motivo}"`);
    }
    const fecha = new Date(dto.fechaCese);
    if (Number.isNaN(fecha.getTime())) {
      throw new BadRequestException(`fechaCese inválida: "${dto.fechaCese}"`);
    }
    const ctx = getTenantContext();
    const { tenantId, userId } = requireIdentity(ctx);
    return this.termination.crearCese(ctx.tx, {
      tenantId,
      employeeId: dto.employeeId,
      fechaCese: fecha,
      motivo: dto.motivo,
      creadoPor: userId,
    });
  }

  @Put(':id/datos')
  @RequirePermission('termination.manage')
  async actualizarDatos(@Param('id') id: string, @Body() cambios: Partial<CeseSnapshot>) {
    const ctx = getTenantContext();
    return this.termination.actualizarDatos(ctx.tx, id, cambios ?? {});
  }

  @Post(':id/calcular')
  @RequirePermission('termination.manage')
  async calcular(@Param('id') id: string) {
    const ctx = getTenantContext();
    return this.termination.calcular(ctx.tx, id);
  }

  @Post(':id/aprobar')
  @RequirePermission('termination.approve')
  async aprobar(@Param('id') id: string) {
    const ctx = getTenantContext();
    const { userId } = requireIdentity(ctx);
    return this.termination.aprobar(ctx.tx, id, userId);
  }

  @Post(':id/pagar')
  @RequirePermission('termination.approve')
  async pagar(@Param('id') id: string) {
    const ctx = getTenantContext();
    return this.termination.pagar(ctx.tx, id);
  }

  @Post(':id/anular')
  @RequirePermission('termination.approve')
  async anular(@Param('id') id: string, @Body() dto: AnularCeseDto) {
    const ctx = getTenantContext();
    return this.termination.anular(ctx.tx, id, dto?.motivo ?? '');
  }
}
