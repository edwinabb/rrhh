import { BadRequestException, Body, Controller, Get, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { getTenantContext } from '../../common/database/tenant-request-context';
import { VacationsService } from './vacations.service';

export class CrearPeriodoDto {
  employeeId!: string;
  /** ISO YYYY-MM-DD (aniversario de ingreso). */
  periodoInicio!: string;
}

export class ActualizarPeriodoDto {
  diasGozados?: number;
  estado?: 'EN_CURSO' | 'VENCIDO_PENDIENTE' | 'GOZADO' | 'LIQUIDADO';
  notas?: string;
}

@Controller('vacaciones')
@UseGuards(PermissionsGuard)
export class VacationsController {
  constructor(private readonly vacations: VacationsService) {}

  @Get('periodos')
  @RequirePermission('vacation.read')
  async listar(@Query('employeeId') employeeId: string) {
    if (!employeeId) throw new BadRequestException('employeeId es obligatorio');
    const ctx = getTenantContext();
    return this.vacations.listarPorEmpleado(ctx.tx, employeeId);
  }

  @Post('periodos')
  @RequirePermission('vacation.manage')
  async crear(@Body() dto: CrearPeriodoDto) {
    if (!dto?.employeeId || !dto?.periodoInicio) {
      throw new BadRequestException('employeeId y periodoInicio son obligatorios');
    }
    const fecha = new Date(dto.periodoInicio);
    if (Number.isNaN(fecha.getTime())) {
      throw new BadRequestException(`periodoInicio inválido: "${dto.periodoInicio}"`);
    }
    const ctx = getTenantContext();
    if (!ctx.tenantId) throw new BadRequestException('Request sin tenant resuelto');
    return this.vacations.crearPeriodo(ctx.tx, {
      tenantId: ctx.tenantId,
      employeeId: dto.employeeId,
      periodoInicio: fecha,
    });
  }

  @Put('periodos/:id')
  @RequirePermission('vacation.manage')
  async actualizar(@Param('id') id: string, @Body() dto: ActualizarPeriodoDto) {
    const ctx = getTenantContext();
    return this.vacations.actualizarPeriodo(ctx.tx, id, dto ?? {});
  }
}
