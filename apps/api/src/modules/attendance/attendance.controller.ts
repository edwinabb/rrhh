import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import {
  getTenantContext,
  TenantContext,
} from '../../common/database/tenant-request-context';
import { AttendanceService } from './attendance.service';
import { AttendanceImportService } from './attendance-import.service';
import { BiometricIntegrationService } from './biometric-integration.service';
import { PayrollAttendanceExporterService } from './payroll-attendance-exporter.service';
import type { TipoMarcacion } from './calculators/marcacion.calculator';

// ---------------------------------------------------------------------------
// DTOs (sin class-validator: el proyecto no lo usa; validación mínima manual)
// ---------------------------------------------------------------------------

export class RegistrarMarcacionDto {
  employeeId!: string;
  sedeId!: string;
  tipo!: TipoMarcacion; // 'ENTRADA' | 'SALIDA'
  /** ISO 8601; si se omite se usa el momento del servidor (anti-manipulación). */
  timestamp?: string;
  latitud?: number;
  longitud?: number;
  tipoIdentificacion?: string; // enum TipoIdentificacion
  dispositivoId?: string;
  /** Captura biométrica (base64) a verificar contra el proveedor. */
  capturaBiometrica?: string;
  /** Score ya calculado por un dispositivo confiable (alternativa a la captura). */
  scoreBiometria?: number;
}

export class CrearJustificacionDto {
  employeeId!: string;
  marcacionId?: string;
  motivo!: string; // enum MotivoJustificacion
  /** Fecha del evento justificado (ISO 8601). */
  fecha!: string;
  descripcion!: string;
  documentoUrl?: string;
}

export class ResolverJustificacionDto {
  aprobar!: boolean;
  /** Obligatorio cuando aprobar === false (trazabilidad para el trabajador). */
  motivoRechazo?: string;
}

export class ImportarCsvDto {
  /** Contenido completo del archivo CSV (el frontend lo lee con FileReader). */
  csv!: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const PERIODO_REGEX = /^\d{4}-(0[1-9]|1[0-2])$/;

/**
 * Rango [primer día, último día] del período 'YYYY-MM' en UTC (las columnas
 * `fecha` son @db.Date). Mismo criterio que PayrollAttendanceExporterService.
 */
function rangoPeriodo(periodo: string): { gte: Date; lte: Date } {
  if (!PERIODO_REGEX.test(periodo)) {
    throw new BadRequestException(
      `Período inválido: "${periodo}" (formato esperado: YYYY-MM)`,
    );
  }
  const [anio = 0, mes = 0] = periodo.split('-').map(Number);
  return {
    gte: new Date(Date.UTC(anio, mes - 1, 1)),
    // Día 0 del mes siguiente = último día del mes del período
    lte: new Date(Date.UTC(anio, mes, 0)),
  };
}

/** tenantId/userId son nullables en el contexto; estos endpoints los exigen. */
function requireIdentity(ctx: TenantContext): { tenantId: string; userId: string } {
  if (!ctx.tenantId || !ctx.userId) {
    throw new BadRequestException('Request sin tenant o usuario resuelto');
  }
  return { tenantId: ctx.tenantId, userId: ctx.userId };
}

// ---------------------------------------------------------------------------
// Controller
// ---------------------------------------------------------------------------

@Controller('attendance')
@UseGuards(PermissionsGuard)
export class AttendanceController {
  constructor(
    private readonly attendanceService: AttendanceService,
    private readonly attendanceImportService: AttendanceImportService,
    private readonly biometricService: BiometricIntegrationService,
    private readonly payrollExporter: PayrollAttendanceExporterService,
  ) {}

  /**
   * GET /attendance/import/plantilla — descarga la plantilla CSV de ejemplo
   * para el import de marcaciones (con BOM UTF-8 para Excel).
   */
  @Get('import/plantilla')
  @RequirePermission('attendance.import')
  descargarPlantillaImport(@Res() res: Response) {
    const plantilla = this.attendanceImportService.generarPlantilla();
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="plantilla-asistencia.csv"',
    );
    res.send(plantilla);
  }

  /**
   * POST /attendance/import — importa marcaciones desde un CSV exportado por
   * un sistema biométrico externo. El frontend lee el archivo con FileReader
   * y envía el contenido como { csv: string }. Validación por fila: los
   * errores se acumulan y se retorna { procesadas, omitidas, errores }.
   */
  @Post('import')
  @RequirePermission('attendance.import')
  async importarCsv(@Body() dto: ImportarCsvDto) {
    const ctx = getTenantContext();
    const { userId } = requireIdentity(ctx);

    if (!dto.csv || typeof dto.csv !== 'string') {
      throw new BadRequestException('csv (string con el contenido del archivo) es obligatorio');
    }

    return this.attendanceImportService.importarCsv(ctx.tx, dto.csv, userId);
  }

  /**
   * POST /attendance/marcaciones — registra una marcación ENTRADA/SALIDA.
   * Append-only: los intentos inválidos también se persisten (bloqueados).
   */
  @Post('marcaciones')
  @RequirePermission('attendance.mark')
  async registrarMarcacion(@Body() dto: RegistrarMarcacionDto) {
    const ctx = getTenantContext();
    const { tenantId, userId } = requireIdentity(ctx);

    if (!dto.employeeId || !dto.sedeId || !dto.tipo) {
      throw new BadRequestException('employeeId, sedeId y tipo son obligatorios');
    }

    // Si llega una captura biométrica cruda, se obtiene el score del proveedor
    // con umbral 0: aquí solo interesa el score; el umbral del tenant lo aplica
    // el calculador puro dentro de registrarMarcacion (parámetro normativo de
    // ConfiguracionAsistencia, no se duplica la regla en el controller).
    let scoreBiometria = dto.scoreBiometria;
    if (dto.capturaBiometrica) {
      const bio = await this.biometricService.verificarIdentidad(
        dto.employeeId,
        dto.capturaBiometrica,
        0,
      );
      scoreBiometria = bio.confianza;
    }

    return this.attendanceService.registrarMarcacion(ctx.tx, {
      tenantId,
      employeeId: dto.employeeId,
      sedeId: dto.sedeId,
      tipo: dto.tipo,
      timestamp: dto.timestamp ? new Date(dto.timestamp) : new Date(),
      latitud: dto.latitud,
      longitud: dto.longitud,
      scoreBiometria,
      tipoIdentificacion: dto.tipoIdentificacion,
      dispositivoId: dto.dispositivoId,
      creadoPor: userId,
    });
  }

  /** POST /attendance/justificaciones — crea una justificación PENDIENTE. */
  @Post('justificaciones')
  @RequirePermission('attendance.justify')
  async crearJustificacion(@Body() dto: CrearJustificacionDto) {
    const ctx = getTenantContext();
    const { tenantId } = requireIdentity(ctx);

    if (!dto.employeeId || !dto.motivo || !dto.fecha || !dto.descripcion) {
      throw new BadRequestException(
        'employeeId, motivo, fecha y descripcion son obligatorios',
      );
    }
    const fecha = new Date(dto.fecha);
    if (Number.isNaN(fecha.getTime())) {
      throw new BadRequestException(`Fecha inválida: "${dto.fecha}"`);
    }

    return this.attendanceService.crearJustificacion(ctx.tx, {
      tenantId,
      employeeId: dto.employeeId,
      marcacionId: dto.marcacionId,
      motivo: dto.motivo,
      fecha,
      descripcion: dto.descripcion,
      documentoUrl: dto.documentoUrl,
    });
  }

  /**
   * PUT /attendance/justificaciones/:id/resolver — transición
   * PENDIENTE → APROBADA/RECHAZADA (rechazar exige motivoRechazo).
   */
  @Put('justificaciones/:id/resolver')
  @RequirePermission('attendance.approve')
  async resolverJustificacion(
    @Param('id') id: string,
    @Body() dto: ResolverJustificacionDto,
  ) {
    const ctx = getTenantContext();
    const { userId } = requireIdentity(ctx);

    if (typeof dto.aprobar !== 'boolean') {
      throw new BadRequestException('aprobar (boolean) es obligatorio');
    }

    return this.attendanceService.resolverJustificacion(
      ctx.tx,
      id,
      dto.aprobar,
      userId,
      dto.motivoRechazo,
    );
  }

  /**
   * GET /attendance/resumen/:periodo — resúmenes diarios del período
   * (YYYY-MM). RLS limita las filas visibles según el rol de la sesión
   * (un empleado solo ve las suyas). Filtro opcional ?employeeId=.
   */
  @Get('resumen/:periodo')
  @RequirePermission('attendance.read')
  async obtenerResumen(
    @Param('periodo') periodo: string,
    @Query('employeeId') employeeId?: string,
  ) {
    const ctx = getTenantContext();
    const fecha = rangoPeriodo(periodo);

    const resumenes = await ctx.tx.asistenciaResumen.findMany({
      where: { fecha, ...(employeeId ? { employeeId } : {}) },
      orderBy: [{ employeeId: 'asc' }, { fecha: 'asc' }],
    });

    return { periodo, resumenes };
  }

  /**
   * GET /attendance/dashboard/:periodo — indicadores agregados del equipo
   * para el período (YYYY-MM): tasa de asistencia, faltas, tardanzas y horas.
   * Solo lecturas: NO usa exportarHorasExtra (ese método marca los registros
   * como consumidos por nómina y es exclusivo del cierre de planilla).
   */
  @Get('dashboard/:periodo')
  @RequirePermission('attendance.read.team')
  async obtenerDashboard(@Param('periodo') periodo: string) {
    const ctx = getTenantContext();
    const fecha = rangoPeriodo(periodo);

    const [resumenes, horasExtra] = await Promise.all([
      ctx.tx.asistenciaResumen.findMany({ where: { fecha } }),
      ctx.tx.horasExtra.findMany({ where: { fecha } }),
    ]);

    // Horas computables por empleado (reutiliza el calculador puro vía el
    // exporter, misma regla que consumirá nómina: faltas justificadas computan)
    const horasComputables = await this.payrollExporter.exportarHorasComputables(
      ctx.tx,
      periodo,
    );

    const empleados = new Set(resumenes.map((r) => r.employeeId));
    const faltasInjustificadas = resumenes.filter((r) => r.falta && !r.justificado).length;
    const faltasJustificadas = resumenes.filter((r) => r.falta && r.justificado).length;
    const diasConTardanza = resumenes.filter((r) => r.tardanzaMinutos > 0).length;

    const redondear2 = (v: number) => Math.round(v * 100) / 100;
    const totalHorasTrabajadas = redondear2(
      resumenes.reduce((total, r) => total + r.horasTrabajadas, 0),
    );
    const totalTardanzaMinutos = resumenes.reduce((total, r) => total + r.tardanzaMinutos, 0);
    const totalHorasExtra = redondear2(
      horasExtra.reduce((total, h) => total + h.horasCalculadas, 0),
    );

    const totalDias = resumenes.length;
    const tasaAsistencia =
      totalDias === 0 ? null : redondear2((totalDias - faltasInjustificadas) / totalDias);

    return {
      periodo,
      totalEmpleados: empleados.size,
      totalDiasRegistrados: totalDias,
      tasaAsistencia,
      faltasInjustificadas,
      faltasJustificadas,
      diasConTardanza,
      totalTardanzaMinutos,
      totalHorasTrabajadas,
      totalHorasExtra,
      horasComputablesPorEmpleado: Object.fromEntries(horasComputables),
    };
  }
}
