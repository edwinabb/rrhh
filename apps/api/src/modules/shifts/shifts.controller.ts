import {
  BadRequestException, Body, Controller, Get, NotFoundException, Param, Post, Put,
  Query, UseGuards, Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { getTenantContext, TenantContext } from '../../common/database/tenant-request-context';
import { ShiftPlanService, TipoDiaPlan } from './shift-plan.service';
import { ShiftPlanImportService } from './shift-plan-import.service';
import { CompensatorioService, TipoMovimientoCompensatorio } from './compensatorio.service';
import { ShiftComplianceService } from './shift-compliance.service';
import { RotacionPatronService } from './rotacion-patron.service';
import { RotacionAplicadorService } from './rotacion-aplicador.service';
import { SolicitudCambioTurnoService } from './solicitud-cambio-turno.service';
import { SolicitudCambioTurnoAplicadorService } from './solicitud-cambio-turno-aplicador.service';
import { SolicitudTrabajoAdicionalService } from './solicitud-trabajo-adicional.service';
import { SolicitudTrabajoAdicionalAplicadorService } from './solicitud-trabajo-adicional-aplicador.service';
import { IntercambioTurnoService } from './intercambio-turno.service';
import { IntercambioTurnoAplicadorService } from './intercambio-turno-aplicador.service';
import { NotificationService } from '../../common/services/notification.service';

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
    private readonly rotacionPatron: RotacionPatronService,
    private readonly rotacionAplicador: RotacionAplicadorService,
    private readonly solicitudCambioTurno: SolicitudCambioTurnoService,
    private readonly solicitudCambioTurnoAplicador: SolicitudCambioTurnoAplicadorService,
    private readonly solicitudTrabajoAdicional: SolicitudTrabajoAdicionalService,
    private readonly solicitudTrabajoAdicionalAplicador: SolicitudTrabajoAdicionalAplicadorService,
    private readonly notificacion: NotificationService,
    private readonly intercambios: IntercambioTurnoService,
    private readonly intercambiosAplicador: IntercambioTurnoAplicadorService,
  ) {}

  private filtrarMotivoRechazoParaNoManagers(
    solicitudes: any | any[],
    request: Request,
  ): any | any[] {
    const permissions = (request.session as any)?.permissions ?? [];
    const tienePermiso = permissions.includes('shift.manage');

    if (tienePermiso) {
      return solicitudes;
    }

    const filtrar = (solicitud: any) => {
      const { motivoRechazo, ...resto } = solicitud;
      return resto;
    };

    if (Array.isArray(solicitudes)) {
      return solicitudes.map(filtrar);
    }
    return filtrar(solicitudes);
  }

  private filtrarCamposPrivadosTrabajoAdicional(solicitudes: any | any[], request: Request): any | any[] {
    const permissions = (request.session as any)?.permissions ?? [];
    const tienePermiso = permissions.includes('shift.manage');
    if (tienePermiso) return solicitudes;
    const filtrar = (s: any) => {
      const { causaHorasExtras, horasAcumuladas, saldoCompensatorios, ...resto } = s;
      return resto;
    };
    return Array.isArray(solicitudes) ? solicitudes.map(filtrar) : filtrar(solicitudes);
  }

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

  // --- Portal de intercambios autoservicio (fase 9) ---
  @Post('intercambios/proponer')
  @RequirePermission('shift.read')
  async proponerIntercambio(@Req() request: Request, @Body() dto: any) {
    if (!dto?.employeeIdB || !dto?.fecha) {
      throw new BadRequestException('employeeIdB y fecha son obligatorios');
    }
    const ctx = getTenantContext();
    const { tenantId, userId } = requireIdentity(ctx);
    const empleadoA = await ctx.tx.employee.findFirst({ where: { userId } });
    if (!empleadoA) {
      throw new BadRequestException('La sesión no tiene un empleado asociado');
    }

    await this.intercambiosAplicador.barrido(ctx.tx, tenantId);
    const fecha = parseFecha(dto.fecha, 'fecha');
    const intercambio = await this.intercambios.proponer(ctx.tx, {
      tenantId,
      employeeIdA: empleadoA.id,
      employeeIdB: dto.employeeIdB,
      fecha,
      mensajeA: dto.mensajeA,
      creadoPor: userId,
    });

    try {
      await this.notificacion.notificarIntercambioPropuesto(
        tenantId, empleadoA.id, dto.employeeIdB, fecha, dto.mensajeA,
      );
    } catch {
      // No bloqueante: NotificationService ya loguea internamente sus errores.
    }

    return intercambio;
  }

  @Get('intercambios/mis-propuestas')
  @RequirePermission('shift.read')
  async listarMisPropuestasIntercambio(@Req() request: Request) {
    const ctx = getTenantContext();
    const { tenantId, userId } = requireIdentity(ctx);
    const empleado = await ctx.tx.employee.findFirst({ where: { userId } });
    if (!empleado) {
      throw new BadRequestException('La sesión no tiene un empleado asociado');
    }
    await this.intercambiosAplicador.barrido(ctx.tx, tenantId);
    return this.intercambios.listarMisPropuestas(ctx.tx, tenantId, empleado.id);
  }

  @Get('intercambios/propuestas-para-mi')
  @RequirePermission('shift.read')
  async listarPropuestasParaMiIntercambio(@Req() request: Request) {
    const ctx = getTenantContext();
    const { tenantId, userId } = requireIdentity(ctx);
    const empleado = await ctx.tx.employee.findFirst({ where: { userId } });
    if (!empleado) {
      throw new BadRequestException('La sesión no tiene un empleado asociado');
    }
    await this.intercambiosAplicador.barrido(ctx.tx, tenantId);
    return this.intercambios.listarPropuestasParaMi(ctx.tx, tenantId, empleado.id);
  }

  @Put('intercambios/:id/aceptar')
  @RequirePermission('shift.read')
  async aceptarIntercambio(@Req() request: Request, @Param('id') id: string) {
    const ctx = getTenantContext();
    const { tenantId, userId } = requireIdentity(ctx);
    const empleado = await ctx.tx.employee.findFirst({ where: { userId } });
    if (!empleado) {
      throw new BadRequestException('La sesión no tiene un empleado asociado');
    }
    await this.intercambiosAplicador.barrido(ctx.tx, tenantId);
    const intercambio = await this.intercambios.aceptar(ctx.tx, tenantId, id, empleado.id);

    try {
      await this.notificacion.notificarIntercambioAceptadoPorB(
        tenantId, intercambio.employeeIdA, intercambio.employeeIdB, intercambio.fecha,
      );
    } catch {
      // No bloqueante: NotificationService ya loguea internamente sus errores.
    }

    return intercambio;
  }

  @Put('intercambios/:id/rechazar')
  @RequirePermission('shift.read')
  async rechazarIntercambioPorB(@Req() request: Request, @Param('id') id: string, @Body() dto: any) {
    const ctx = getTenantContext();
    const { tenantId, userId } = requireIdentity(ctx);
    const empleado = await ctx.tx.employee.findFirst({ where: { userId } });
    if (!empleado) {
      throw new BadRequestException('La sesión no tiene un empleado asociado');
    }
    await this.intercambiosAplicador.barrido(ctx.tx, tenantId);
    const intercambio = await this.intercambios.rechazarPorB(ctx.tx, tenantId, id, empleado.id, dto?.motivoRechazo);

    try {
      await this.notificacion.notificarIntercambioRechazadoPorB(tenantId, intercambio.employeeIdA, dto?.motivoRechazo);
    } catch {
      // No bloqueante: NotificationService ya loguea internamente sus errores.
    }

    return intercambio;
  }

  @Get('intercambios/pendientes')
  @RequirePermission('shift.resolve')
  async listarIntercambiosPendientes(@Req() request: Request) {
    const ctx = getTenantContext();
    const { tenantId } = requireIdentity(ctx);
    await this.intercambiosAplicador.barrido(ctx.tx, tenantId);
    return ctx.tx.intercambioTurno.findMany({
      where: { tenantId, estado: 'ACEPTADA_POR_B' },
      orderBy: { aceptadoEn: 'asc' },
    });
  }

  @Put('intercambios/:id/aprobar')
  @RequirePermission('shift.resolve')
  async aprobarIntercambio(@Req() request: Request, @Param('id') id: string) {
    const ctx = getTenantContext();
    const { tenantId, userId } = requireIdentity(ctx);
    const manager = await ctx.tx.employee.findFirst({ where: { userId } });
    if (!manager) {
      throw new BadRequestException('La sesión no tiene un empleado asociado');
    }
    return this.intercambiosAplicador.aprobar(ctx.tx, tenantId, id, manager.id);
  }

  @Put('intercambios/:id/rechazar-manager')
  @RequirePermission('shift.resolve')
  async rechazarIntercambioManager(@Req() request: Request, @Param('id') id: string, @Body() dto: any) {
    const ctx = getTenantContext();
    const { tenantId, userId } = requireIdentity(ctx);
    const manager = await ctx.tx.employee.findFirst({ where: { userId } });
    if (!manager) {
      throw new BadRequestException('La sesión no tiene un empleado asociado');
    }
    return this.intercambiosAplicador.rechazarManager(ctx.tx, tenantId, id, manager.id, dto?.motivoRechazo);
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

  // --- Solicitud de cambio de turno ---
  @Post('cambios')
  @RequirePermission('shift.manage')
  async crearSolicitudCambio(@Body() dto: any) {
    if (!dto?.fechaActual || !dto?.fechaNueva || !dto?.creadoPor) {
      throw new BadRequestException('fechaActual, fechaNueva y creadoPor son obligatorios');
    }
    const ctx = getTenantContext();
    const { tenantId, userId } = requireIdentity(ctx);
    const employee = await ctx.tx.employee.findFirst({ where: { userId } });
    if (!employee) {
      throw new BadRequestException('La sesión no tiene un empleado asociado');
    }

    return this.solicitudCambioTurno.crearSolicitud(ctx.tx, {
      tenantId,
      employeeId: employee.id,
      fechaActual: parseFecha(dto.fechaActual, 'fechaActual'),
      turnoIdActual: dto.turnoIdActual ?? undefined,
      fechaNueva: parseFecha(dto.fechaNueva, 'fechaNueva'),
      turnoIdNuevo: dto.turnoIdNuevo ?? undefined,
      creadoPor: dto.creadoPor,
    });
  }

  @Get('cambios')
  @RequirePermission('shift.read')
  async listarSolicitudesCambio(
    @Req() request: Request,
    @Query('estado') estado?: string,
    @Query('employeeId') employeeId?: string,
    @Query('decididoPor') decididoPor?: string,
    @Query('fechaDesde') fechaDesde?: string,
    @Query('fechaHasta') fechaHasta?: string,
  ) {
    const ctx = getTenantContext();
    const { tenantId } = requireIdentity(ctx);

    const filtros: any = { tenantId };
    if (estado) filtros.estado = estado;
    if (employeeId) filtros.employeeId = employeeId;
    if (decididoPor) filtros.decididoPor = decididoPor;
    if (fechaDesde) filtros.fechaDesde = parseFecha(fechaDesde, 'fechaDesde');
    if (fechaHasta) filtros.fechaHasta = parseFecha(fechaHasta, 'fechaHasta');

    const solicitudes = await this.solicitudCambioTurno.listarSolicitudes(ctx.tx, filtros);
    return this.filtrarMotivoRechazoParaNoManagers(solicitudes, request);
  }

  @Get('cambios/mios')
  @RequirePermission('shift.read')
  async listarMisSolicitudesCambio(@Req() request: Request) {
    const ctx = getTenantContext();
    const { tenantId, userId } = requireIdentity(ctx);
    const employee = await ctx.tx.employee.findFirst({ where: { userId } });
    if (!employee) {
      throw new BadRequestException('La sesión no tiene un empleado asociado');
    }

    const solicitudes = await this.solicitudCambioTurno.listarMisSolicitudes(
      ctx.tx,
      tenantId,
      employee.id,
    );
    return this.filtrarMotivoRechazoParaNoManagers(solicitudes, request);
  }

  @Put('cambios/:id/aprobar')
  @RequirePermission('shift.manage')
  async aprobarSolicitudCambio(@Req() request: Request, @Param('id') id: string, @Body() dto: any) {
    if (!dto?.decididoPor) {
      throw new BadRequestException('decididoPor es obligatorio');
    }
    const ctx = getTenantContext();
    const solicitud = await this.solicitudCambioTurnoAplicador.aprobarSolicitud(
      ctx.tx,
      id,
      dto.decididoPor,
    );
    return this.filtrarMotivoRechazoParaNoManagers(solicitud, request);
  }

  @Put('cambios/:id/rechazar')
  @RequirePermission('shift.manage')
  async rechazarSolicitudCambio(@Req() request: Request, @Param('id') id: string, @Body() dto: any) {
    if (!dto?.decididoPor || !dto?.motivoRechazo) {
      throw new BadRequestException('decididoPor y motivoRechazo son obligatorios');
    }
    const ctx = getTenantContext();
    const solicitud = await this.solicitudCambioTurnoAplicador.rechazarSolicitud(
      ctx.tx,
      id,
      dto.decididoPor,
      dto.motivoRechazo,
    );
    return this.filtrarMotivoRechazoParaNoManagers(solicitud, request);
  }

  // --- Patrones de rotación ---
  @Get('patrones')
  @RequirePermission('shift.read')
  async listarPatrones(@Query('incluirInactivos') incluirInactivos?: string) {
    const ctx = getTenantContext();
    const { tenantId } = requireIdentity(ctx);
    return this.rotacionPatron.listarPatrones(ctx.tx, tenantId, incluirInactivos === 'true');
  }

  @Post('patrones')
  @RequirePermission('shift.manage')
  async crearPatron(@Body() dto: any) {
    if (!dto?.nombre || !dto?.secuencia || !Array.isArray(dto.secuencia)) {
      throw new BadRequestException('nombre y secuencia (array) son obligatorios');
    }
    const ctx = getTenantContext();
    const { tenantId, userId } = requireIdentity(ctx);
    return this.rotacionPatron.crearPatron(ctx.tx, {
      tenantId,
      nombre: dto.nombre,
      descripcion: dto.descripcion,
      secuencia: dto.secuencia,
      duracionCiclo: 7,
      creadoPor: userId,
    });
  }

  @Put('patrones/:id')
  @RequirePermission('shift.manage')
  async actualizarPatron(@Param('id') id: string, @Body() cambios: any) {
    const ctx = getTenantContext();
    const { userId } = requireIdentity(ctx);
    return this.rotacionPatron.actualizarPatron(ctx.tx, id, {
      ...cambios,
      actualizadoPor: userId,
    });
  }

  @Post('patrones/:id/aplicar')
  @RequirePermission('shift.manage')
  async aplicarPatron(@Param('id') patronId: string, @Body() dto: any) {
    if (!dto?.employeeIds || !Array.isArray(dto.employeeIds) || !dto?.desde || !dto?.hasta || !dto?.diaInicioCiclo) {
      throw new BadRequestException('employeeIds (array), desde, hasta y diaInicioCiclo son obligatorios');
    }
    const ctx = getTenantContext();
    const { tenantId, userId } = requireIdentity(ctx);
    return this.rotacionAplicador.aplicarPatron(ctx.tx, {
      tenantId,
      patronId,
      employeeIds: dto.employeeIds,
      desde: parseFecha(dto.desde, 'desde'),
      hasta: parseFecha(dto.hasta, 'hasta'),
      diaInicioCiclo: parseFecha(dto.diaInicioCiclo, 'diaInicioCiclo'),
      ajustes: dto.ajustes,
      creadoPor: userId,
    });
  }

  // --- Trabajo fuera de turno (fase 8) ---
  @Post('trabajo-adicional/solicitar')
  @RequirePermission('shift.read')
  async solicitarTrabajoAdicional(@Req() request: Request, @Body() dto: any) {
    if (!dto?.descripcionTarea || !dto?.fechaEstimada || dto?.horasEstimadas === undefined || !dto?.urgencia) {
      throw new BadRequestException(
        'descripcionTarea, fechaEstimada, horasEstimadas y urgencia son obligatorios',
      );
    }
    const ctx = getTenantContext();
    const { tenantId, userId } = requireIdentity(ctx);
    const employee = await ctx.tx.employee.findFirst({ where: { userId } });
    if (!employee) {
      throw new BadRequestException('La sesión no tiene un empleado asociado');
    }

    const fechaEstimada = parseFecha(dto.fechaEstimada, 'fechaEstimada');
    const solicitud = await this.solicitudTrabajoAdicional.crearSolicitud(ctx.tx, {
      tenantId,
      employeeIdSolicitante: employee.id,
      employeeIdAsignado: employee.id,
      descripcionTarea: dto.descripcionTarea,
      fechaEstimada,
      horasEstimadas: Number(dto.horasEstimadas),
      urgencia: dto.urgencia,
      creadoPor: userId,
    });

    try {
      await this.notificacion.notificarSolicitudTrabajoCreada(
        tenantId,
        employee.id,
        dto.descripcionTarea,
        fechaEstimada,
        Number(dto.horasEstimadas),
        dto.urgencia,
      );
    } catch {
      // No bloqueante: NotificationService ya loguea internamente sus errores.
    }

    return this.filtrarCamposPrivadosTrabajoAdicional(solicitud, request);
  }

  @Get('trabajo-adicional/mis-solicitudes')
  @RequirePermission('shift.read')
  async listarMisSolicitudesTrabajoAdicional(@Req() request: Request) {
    const ctx = getTenantContext();
    const { tenantId, userId } = requireIdentity(ctx);
    const employee = await ctx.tx.employee.findFirst({ where: { userId } });
    if (!employee) {
      throw new BadRequestException('La sesión no tiene un empleado asociado');
    }

    const solicitudes = await this.solicitudTrabajoAdicional.listarMisSolicitudes(
      ctx.tx,
      tenantId,
      employee.id,
    );
    return this.filtrarCamposPrivadosTrabajoAdicional(solicitudes, request);
  }

  @Get('trabajo-adicional/pendientes')
  @RequirePermission('shift.manage')
  async listarTrabajoAdicionalPendientes(
    @Req() request: Request,
    @Query('employeeId') employeeId?: string,
    @Query('fechaDesde') fechaDesde?: string,
    @Query('fechaHasta') fechaHasta?: string,
  ) {
    const ctx = getTenantContext();
    const { tenantId } = requireIdentity(ctx);

    const filtros: any = { tenantId, estado: 'PENDIENTE_APROBACION' };
    if (employeeId) filtros.employeeId = employeeId;
    if (fechaDesde) filtros.fechaDesde = parseFecha(fechaDesde, 'fechaDesde');
    if (fechaHasta) filtros.fechaHasta = parseFecha(fechaHasta, 'fechaHasta');

    const solicitudes = await this.solicitudTrabajoAdicional.listarSolicitudes(ctx.tx, filtros);
    return this.filtrarCamposPrivadosTrabajoAdicional(solicitudes, request);
  }

  @Get('trabajo-adicional/validar')
  @RequirePermission('shift.manage')
  async listarTrabajoAdicionalParaValidar(
    @Req() request: Request,
    @Query('employeeId') employeeId?: string,
    @Query('fechaDesde') fechaDesde?: string,
    @Query('fechaHasta') fechaHasta?: string,
  ) {
    const ctx = getTenantContext();
    const { tenantId } = requireIdentity(ctx);

    const filtros: any = { tenantId, estado: 'REPORTE_PENDIENTE_VALIDACION' };
    if (employeeId) filtros.employeeId = employeeId;
    if (fechaDesde) filtros.fechaDesde = parseFecha(fechaDesde, 'fechaDesde');
    if (fechaHasta) filtros.fechaHasta = parseFecha(fechaHasta, 'fechaHasta');

    const solicitudes = await this.solicitudTrabajoAdicional.listarSolicitudes(ctx.tx, filtros);
    return this.filtrarCamposPrivadosTrabajoAdicional(solicitudes, request);
  }

  @Put('trabajo-adicional/:id/aprobar')
  @RequirePermission('shift.manage')
  async aprobarTrabajoAdicional(@Req() request: Request, @Param('id') id: string) {
    const ctx = getTenantContext();
    const { tenantId, userId } = requireIdentity(ctx);
    const manager = await ctx.tx.employee.findFirst({ where: { userId } });
    if (!manager) {
      throw new BadRequestException('La sesión no tiene un empleado asociado');
    }
    const solicitud = await this.solicitudTrabajoAdicionalAplicador.aprobarSolicitud(
      ctx.tx,
      tenantId,
      id,
      manager.id,
    );
    return this.filtrarCamposPrivadosTrabajoAdicional(solicitud, request);
  }

  @Put('trabajo-adicional/:id/reasignar')
  @RequirePermission('shift.manage')
  async reasignarTrabajoAdicional(@Req() request: Request, @Param('id') id: string, @Body() dto: any) {
    if (!dto?.employeeIdNuevo) {
      throw new BadRequestException('employeeIdNuevo es obligatorio');
    }
    const ctx = getTenantContext();
    const { tenantId, userId } = requireIdentity(ctx);
    const manager = await ctx.tx.employee.findFirst({ where: { userId } });
    if (!manager) {
      throw new BadRequestException('La sesión no tiene un empleado asociado');
    }
    const solicitud = await this.solicitudTrabajoAdicionalAplicador.reasignarSolicitud(
      ctx.tx,
      tenantId,
      id,
      dto.employeeIdNuevo,
      manager.id,
    );
    return this.filtrarCamposPrivadosTrabajoAdicional(solicitud, request);
  }

  @Put('trabajo-adicional/:id/rechazar')
  @RequirePermission('shift.manage')
  async rechazarTrabajoAdicional(@Req() request: Request, @Param('id') id: string, @Body() dto: any) {
    const ctx = getTenantContext();
    const { tenantId, userId } = requireIdentity(ctx);
    const manager = await ctx.tx.employee.findFirst({ where: { userId } });
    if (!manager) {
      throw new BadRequestException('La sesión no tiene un empleado asociado');
    }
    const solicitud = await this.solicitudTrabajoAdicionalAplicador.rechazarSolicitud(
      ctx.tx,
      tenantId,
      id,
      manager.id,
      dto?.motivoRechazo,
    );
    return this.filtrarCamposPrivadosTrabajoAdicional(solicitud, request);
  }

  @Get('trabajo-adicional/:id')
  @RequirePermission('shift.read')
  async obtenerTrabajoAdicional(@Req() request: Request, @Param('id') id: string) {
    const ctx = getTenantContext();
    const solicitud = await this.solicitudTrabajoAdicional.obtenerSolicitud(ctx.tx, id);
    if (!solicitud) {
      throw new NotFoundException(`Solicitud ${id} no encontrada`);
    }

    const permissions = (request.session as any)?.permissions ?? [];
    const tienePermisoManage = permissions.includes('shift.manage');
    if (!tienePermisoManage) {
      const { userId } = requireIdentity(ctx);
      const employee = await ctx.tx.employee.findFirst({ where: { userId } });
      const esParticipante =
        !!employee &&
        (solicitud.employeeIdSolicitante === employee.id || solicitud.employeeIdAsignado === employee.id);
      if (!esParticipante) {
        throw new NotFoundException(`Solicitud ${id} no encontrada`);
      }
    }

    return this.filtrarCamposPrivadosTrabajoAdicional(solicitud, request);
  }

  @Post('trabajo-adicional/:id/reporte')
  @RequirePermission('shift.read')
  async enviarReporteTrabajoAdicional(@Req() request: Request, @Param('id') id: string, @Body() dto: any) {
    if (!dto?.reporteDescripcion || !dto?.reporteFotos) {
      throw new BadRequestException('reporteDescripcion y reporteFotos son obligatorios');
    }
    const ctx = getTenantContext();
    const { tenantId, userId } = requireIdentity(ctx);
    const employee = await ctx.tx.employee.findFirst({ where: { userId } });
    if (!employee) {
      throw new BadRequestException('La sesión no tiene un empleado asociado');
    }

    const solicitud = await this.solicitudTrabajoAdicional.enviarReporte(ctx.tx, {
      tenantId,
      id,
      employeeId: employee.id,
      reporteDescripcion: dto.reporteDescripcion,
      reporteFotos: dto.reporteFotos,
      reporteNotas: dto.reporteNotas,
    });

    if (solicitud.managerId) {
      try {
        await this.notificacion.notificarReporteEnviado(
          tenantId,
          solicitud.managerId,
          solicitud.descripcionTarea,
          solicitud.fechaEstimada,
        );
      } catch {
        // No bloqueante: NotificationService ya loguea internamente sus errores.
      }
    }

    return this.filtrarCamposPrivadosTrabajoAdicional(solicitud, request);
  }

  @Put('trabajo-adicional/:id/validar')
  @RequirePermission('shift.manage')
  async validarReporteTrabajoAdicional(@Req() request: Request, @Param('id') id: string) {
    const ctx = getTenantContext();
    const { tenantId, userId } = requireIdentity(ctx);
    const manager = await ctx.tx.employee.findFirst({ where: { userId } });
    if (!manager) {
      throw new BadRequestException('La sesión no tiene un empleado asociado');
    }
    const solicitud = await this.solicitudTrabajoAdicionalAplicador.validarReporte(
      ctx.tx,
      tenantId,
      id,
      manager.id,
    );
    return this.filtrarCamposPrivadosTrabajoAdicional(solicitud, request);
  }

  @Put('trabajo-adicional/:id/reporte-rechazar')
  @RequirePermission('shift.manage')
  async rechazarReporteTrabajoAdicional(@Req() request: Request, @Param('id') id: string, @Body() dto: any) {
    const ctx = getTenantContext();
    const { tenantId, userId } = requireIdentity(ctx);
    const manager = await ctx.tx.employee.findFirst({ where: { userId } });
    if (!manager) {
      throw new BadRequestException('La sesión no tiene un empleado asociado');
    }
    const solicitud = await this.solicitudTrabajoAdicionalAplicador.rechazarReporte(
      ctx.tx,
      tenantId,
      id,
      manager.id,
      dto?.motivo,
    );
    return this.filtrarCamposPrivadosTrabajoAdicional(solicitud, request);
  }
}
