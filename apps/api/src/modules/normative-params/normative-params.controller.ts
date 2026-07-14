import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { getTenantContext } from '../../common/database/tenant-request-context';
import { NormativeParameterService } from './normative-parameter.service';

@Controller('normative-params')
@UseGuards(PermissionsGuard)
export class NormativeParamsController {
  constructor(private readonly service: NormativeParameterService) {}

  @Get()
  @RequirePermission('normative_param.read')
  async resolve(@Query('codigo') codigo: string, @Query('fecha') fecha: string) {
    const ctx = getTenantContext();
    const valor = await this.service.resolve(ctx.tx, codigo, new Date(fecha));
    return { codigo, fecha, valor };
  }

  @Post()
  @RequirePermission('normative_param.write')
  async createNewVersion(
    @Body()
    body: { codigo: string; valor: unknown; vigenciaDesde: string; descripcion?: string },
  ) {
    const ctx = getTenantContext();
    const created = await this.service.createNewVersion(ctx.tx, {
      codigo: body.codigo,
      valor: body.valor,
      vigenciaDesde: new Date(body.vigenciaDesde),
      descripcion: body.descripcion,
      createdBy: ctx.userId ?? '',
    });
    return created;
  }
}
