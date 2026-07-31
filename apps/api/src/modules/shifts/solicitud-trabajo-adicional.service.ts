import { Injectable, ConflictException, BadRequestException, NotFoundException } from '@nestjs/common';
import { CompensatorioService } from './compensatorio.service';
import { NormativeParameterService } from '../normative-params/normative-parameter.service';

export type UrgenciaTrabajoAdicional = 'NORMAL' | 'URGENTE';
export type EstadoSolicitudTrabajoAdicional =
  | 'PENDIENTE_APROBACION'
  | 'APROBADA'
  | 'REASIGNADA'
  | 'RECHAZADA'
  | 'REPORTE_PENDIENTE_VALIDACION'
  | 'REPORTE_RECHAZADO'
  | 'VALIDADA';

export interface CrearSolicitudInput {
  tenantId: string;
  employeeIdSolicitante: string;
  employeeIdAsignado: string;
  descripcionTarea: string;
  fechaEstimada: Date;
  horasEstimadas: number;
  urgencia: UrgenciaTrabajoAdicional;
  creadoPor: string;
}

export interface FiltroSolicitudes {
  tenantId: string;
  estado?: EstadoSolicitudTrabajoAdicional;
  employeeId?: string;
  fechaDesde?: Date;
  fechaHasta?: Date;
}

export interface EnviarReporteInput {
  tenantId: string;
  id: string;
  employeeId: string;
  reporteDescripcion: string;
  reporteFotos: string[];
  reporteNotas?: string;
}

const ESTADOS_NO_TERMINALES_DUPLICADO: readonly EstadoSolicitudTrabajoAdicional[] = [
  'PENDIENTE_APROBACION',
  'APROBADA',
  'REASIGNADA',
  'REPORTE_PENDIENTE_VALIDACION',
];

const JORNADA_SEMANAL_MAXIMA_DEFAULT = 48;

/** Lunes (00:00) de la semana de la fecha dada. */
function lunesDe(fecha: Date): Date {
  const d = new Date(fecha);
  d.setHours(0, 0, 0, 0);
  const dia = d.getDay(); // 0 = domingo
  d.setDate(d.getDate() - (dia === 0 ? 6 : dia - 1));
  return d;
}

/** Domingo (23:59:59.999) de la semana de la fecha dada. */
function domingoDe(fecha: Date): Date {
  const lunes = lunesDe(fecha);
  const d = new Date(lunes);
  d.setDate(d.getDate() + 6);
  d.setHours(23, 59, 59, 999);
  return d;
}

/**
 * Trabajo fuera de turno (fase 8): un empleado propone realizar una tarea
 * fuera de su turno asignado a cambio de compensación. Flujo:
 * PENDIENTE_APROBACION → APROBADA/RECHAZADA/REASIGNADA, seguido opcionalmente
 * de un reporte de ejecución (APROBADA/REASIGNADA/REPORTE_RECHAZADO →
 * REPORTE_PENDIENTE_VALIDACION → VALIDADA/REPORTE_RECHAZADO, reintentos
 * infinitos). Los campos "privados" (causaHorasExtras/horasAcumuladas/
 * saldoCompensatorios) se calculan siempre aquí; el filtrado por rol de
 * caller (manager vs. no-manager) es responsabilidad del controller.
 */
@Injectable()
export class SolicitudTrabajoAdicionalService {
  constructor(
    private readonly compensatorios: CompensatorioService,
    private readonly normativeParams?: NormativeParameterService,
  ) {}

  async crearSolicitud(tx: any, input: CrearSolicitudInput): Promise<any> {
    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);

    if (new Date(input.fechaEstimada) < hoy) {
      throw new BadRequestException('La fecha estimada no puede estar en el pasado');
    }

    if (!(input.horasEstimadas > 0) || input.horasEstimadas > 12) {
      throw new BadRequestException('horasEstimadas debe ser mayor a 0 y menor o igual a 12');
    }

    const empleado = await tx.employee.findUnique({ where: { id: input.employeeIdSolicitante } });
    if (!empleado) {
      throw new NotFoundException(`Empleado ${input.employeeIdSolicitante} no encontrado`);
    }
    if (empleado.estado !== 'activo') {
      throw new BadRequestException('El empleado solicitante no está activo');
    }

    const duplicado = await tx.solicitudTrabajoAdicional.findFirst({
      where: {
        tenantId: input.tenantId,
        employeeIdSolicitante: input.employeeIdSolicitante,
        fechaEstimada: input.fechaEstimada,
        estado: { in: ESTADOS_NO_TERMINALES_DUPLICADO },
      },
    });
    if (duplicado) {
      throw new ConflictException('Ya existe una solicitud de trabajo adicional para esa fecha');
    }

    // Indicadores privados (solo visibles para manager; el filtrado ocurre en el controller)
    const lunes = lunesDe(input.fechaEstimada);
    const domingo = domingoDe(input.fechaEstimada);
    const resumenesSemana = await tx.asistenciaResumen.findMany({
      where: {
        employeeId: input.employeeIdSolicitante,
        fecha: { gte: lunes, lte: domingo },
      },
    });
    const horasSemanaAcumuladas = resumenesSemana.reduce(
      (total: number, r: any) => total + Number(r.horasTrabajadas ?? 0),
      0,
    );
    const horasAcumuladas = horasSemanaAcumuladas + input.horasEstimadas;

    const jornadaSemanalMaxima = this.normativeParams
      ? (((await this.normativeParams.resolve(tx, 'JORNADA_SEMANAL_MAXIMA', input.fechaEstimada)) as number) ??
        JORNADA_SEMANAL_MAXIMA_DEFAULT)
      : JORNADA_SEMANAL_MAXIMA_DEFAULT;
    const causaHorasExtras = horasAcumuladas > jornadaSemanalMaxima;

    const saldoCompensatorios = await this.compensatorios.obtenerSaldo(tx, input.employeeIdSolicitante);

    return tx.solicitudTrabajoAdicional.create({
      data: {
        tenantId: input.tenantId,
        employeeIdSolicitante: input.employeeIdSolicitante,
        employeeIdAsignado: input.employeeIdAsignado,
        descripcionTarea: input.descripcionTarea,
        fechaEstimada: input.fechaEstimada,
        horasEstimadas: input.horasEstimadas,
        urgencia: input.urgencia,
        causaHorasExtras,
        horasAcumuladas,
        saldoCompensatorios,
        estado: 'PENDIENTE_APROBACION',
        creadoPor: input.creadoPor,
      },
    });
  }

  async listarSolicitudes(tx: any, filtros: FiltroSolicitudes): Promise<any[]> {
    return tx.solicitudTrabajoAdicional.findMany({
      where: {
        tenantId: filtros.tenantId,
        ...(filtros.estado && { estado: filtros.estado }),
        ...(filtros.employeeId && {
          OR: [
            { employeeIdSolicitante: filtros.employeeId },
            { employeeIdAsignado: filtros.employeeId },
          ],
        }),
        ...((filtros.fechaDesde || filtros.fechaHasta) && {
          fechaEstimada: {
            ...(filtros.fechaDesde && { gte: filtros.fechaDesde }),
            ...(filtros.fechaHasta && { lte: filtros.fechaHasta }),
          },
        }),
      },
      orderBy: { creadoEn: 'desc' },
    });
  }

  async listarMisSolicitudes(tx: any, tenantId: string, employeeId: string): Promise<any[]> {
    return this.listarSolicitudes(tx, { tenantId, employeeId });
  }

  async obtenerSolicitud(tx: any, id: string): Promise<any | null> {
    return tx.solicitudTrabajoAdicional.findUnique({ where: { id } });
  }

  async actualizarEstado(
    tx: any,
    id: string,
    nuevoEstado: 'APROBADA' | 'RECHAZADA' | 'VALIDADA' | 'REPORTE_RECHAZADO',
    managerId: string,
    motivoRechazo?: string,
  ): Promise<any> {
    const solicitud = await tx.solicitudTrabajoAdicional.findUnique({ where: { id } });
    if (!solicitud) {
      throw new NotFoundException(`Solicitud ${id} no encontrada`);
    }

    const transicionesValidas: Record<string, readonly string[]> = {
      PENDIENTE_APROBACION: ['APROBADA', 'RECHAZADA'],
      REPORTE_PENDIENTE_VALIDACION: ['VALIDADA', 'REPORTE_RECHAZADO'],
    };
    const permitidos = transicionesValidas[solicitud.estado];
    if (!permitidos || !permitidos.includes(nuevoEstado)) {
      throw new BadRequestException(
        `No se puede transicionar de ${solicitud.estado} a ${nuevoEstado}`,
      );
    }

    const esRechazo = nuevoEstado === 'RECHAZADA' || nuevoEstado === 'REPORTE_RECHAZADO';

    return tx.solicitudTrabajoAdicional.update({
      where: { id },
      data: {
        estado: nuevoEstado,
        managerId,
        actualizadoPor: managerId,
        ...(esRechazo && { motivoRechazo: motivoRechazo ?? null }),
      },
    });
  }

  async enviarReporte(tx: any, input: EnviarReporteInput): Promise<any> {
    const solicitud = await tx.solicitudTrabajoAdicional.findFirst({
      where: { id: input.id, tenantId: input.tenantId },
    });
    if (!solicitud) {
      throw new NotFoundException(`Solicitud ${input.id} no encontrada`);
    }

    if (solicitud.employeeIdAsignado !== input.employeeId) {
      throw new BadRequestException('Solo el empleado asignado puede enviar el reporte');
    }

    const estadosPermitidos: readonly string[] = ['APROBADA', 'REASIGNADA', 'REPORTE_RECHAZADO'];
    if (!estadosPermitidos.includes(solicitud.estado)) {
      throw new BadRequestException(
        `No se puede enviar reporte desde el estado ${solicitud.estado}`,
      );
    }

    if (!input.reporteDescripcion?.trim()) {
      throw new BadRequestException('reporteDescripcion es obligatoria');
    }
    if (!input.reporteFotos || input.reporteFotos.length < 2) {
      throw new BadRequestException('reporteFotos requiere al menos 2 fotos');
    }

    return tx.solicitudTrabajoAdicional.update({
      where: { id: input.id },
      data: {
        reporteDescripcion: input.reporteDescripcion,
        reporteFotos: input.reporteFotos,
        reporteNotas: input.reporteNotas ?? null,
        reporteEnviadoEn: new Date(),
        estado: 'REPORTE_PENDIENTE_VALIDACION',
        actualizadoPor: input.employeeId,
      },
    });
  }
}
