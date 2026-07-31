import { Injectable, NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { SolicitudTrabajoAdicionalService } from './solicitud-trabajo-adicional.service';
import { CompensatorioService } from './compensatorio.service';
import { NotificationService } from '../../common/services/notification.service';

const ESTADOS_NO_TERMINALES_DUPLICADO: readonly string[] = [
  'PENDIENTE_APROBACION',
  'APROBADA',
  'REASIGNADA',
  'REPORTE_PENDIENTE_VALIDACION',
];

/**
 * Orquesta el flujo de aprobación/reasignación/rechazo de una
 * SolicitudTrabajoAdicional (y su reporte de ejecución) dentro de una
 * transacción: actualiza el estado vía SolicitudTrabajoAdicionalService (o,
 * para la reasignación, directamente sobre la fila cuando la transición no
 * es una de las que SolicitudTrabajoAdicionalService.actualizarEstado
 * soporta), registra el movimiento compensatorio correspondiente cuando
 * aplica, y dispara notificaciones no bloqueantes.
 *
 * No duplica las validaciones de SolicitudTrabajoAdicionalService.crearSolicitud
 * (Task 2): asume que la solicitud almacenada es válida.
 */
@Injectable()
export class SolicitudTrabajoAdicionalAplicadorService {
  constructor(
    private readonly solicitudTrabajoAdicional: SolicitudTrabajoAdicionalService,
    private readonly compensatorios: CompensatorioService,
    private readonly notificationService: NotificationService,
  ) {}

  async aprobarSolicitud(tx: any, tenantId: string, id: string, managerId: string): Promise<any> {
    const solicitud = await this.obtenerPendienteAprobacion(tx, id);

    const actualizada = await this.solicitudTrabajoAdicional.actualizarEstado(
      tx,
      id,
      'APROBADA',
      managerId,
    );

    try {
      await this.notificationService.notificarTrabajoAprobado(
        tenantId,
        solicitud.employeeIdAsignado,
        solicitud.descripcionTarea,
      );
    } catch {
      // No bloqueante: NotificationService ya loguea internamente sus errores.
    }

    return actualizada;
  }

  async reasignarSolicitud(
    tx: any,
    tenantId: string,
    id: string,
    employeeIdNuevo: string,
    managerId: string,
  ): Promise<any> {
    const solicitud = await this.obtenerPendienteAprobacion(tx, id);

    const empleadoNuevo = await tx.employee.findUnique({ where: { id: employeeIdNuevo } });
    if (!empleadoNuevo || empleadoNuevo.estado !== 'activo') {
      throw new BadRequestException('El empleado nuevo indicado no está activo');
    }

    const duplicado = await tx.solicitudTrabajoAdicional.findFirst({
      where: {
        id: { not: id },
        tenantId,
        employeeIdAsignado: employeeIdNuevo,
        fechaEstimada: solicitud.fechaEstimada,
        estado: { in: ESTADOS_NO_TERMINALES_DUPLICADO },
      },
    });
    if (duplicado) {
      throw new ConflictException(
        'Ya existe una solicitud de trabajo adicional para ese empleado en esa fecha',
      );
    }

    const actualizada = await tx.solicitudTrabajoAdicional.update({
      where: { id },
      data: {
        employeeIdAsignado: employeeIdNuevo,
        estado: 'REASIGNADA',
        managerId,
        actualizadoPor: managerId,
      },
    });

    try {
      await this.notificationService.notificarTrabajoReasignado(
        tenantId,
        employeeIdNuevo,
        solicitud.descripcionTarea,
        solicitud.fechaEstimada,
        solicitud.horasEstimadas,
      );
    } catch {
      // No bloqueante: NotificationService ya loguea internamente sus errores.
    }

    return actualizada;
  }

  async rechazarSolicitud(
    tx: any,
    tenantId: string,
    id: string,
    managerId: string,
    motivoRechazo?: string,
  ): Promise<any> {
    const solicitud = await this.obtenerPendienteAprobacion(tx, id);

    const actualizada = await this.solicitudTrabajoAdicional.actualizarEstado(
      tx,
      id,
      'RECHAZADA',
      managerId,
      motivoRechazo,
    );

    try {
      await this.notificationService.notificarTrabajoRechazado(
        tenantId,
        solicitud.employeeIdSolicitante,
        motivoRechazo,
      );
    } catch {
      // No bloqueante: NotificationService ya loguea internamente sus errores.
    }

    return actualizada;
  }

  async validarReporte(tx: any, tenantId: string, id: string, managerId: string): Promise<any> {
    const solicitud = await this.obtenerPendienteValidacion(tx, id);

    const actualizada = await this.solicitudTrabajoAdicional.actualizarEstado(
      tx,
      id,
      'VALIDADA',
      managerId,
    );

    const dias = Math.round((solicitud.horasEstimadas / 8) * 100) / 100;
    await this.compensatorios.registrarMovimiento(tx, {
      tenantId,
      employeeId: solicitud.employeeIdAsignado,
      tipo: 'GANADO',
      dias,
      fechaReferencia: solicitud.fechaEstimada,
      motivo: 'Trabajo adicional: ' + solicitud.descripcionTarea,
      creadoPor: managerId,
    });

    try {
      await this.notificationService.notificarReporteValidado(
        tenantId,
        solicitud.employeeIdAsignado,
        solicitud.descripcionTarea,
        dias,
      );
    } catch {
      // No bloqueante: NotificationService ya loguea internamente sus errores.
    }

    return actualizada;
  }

  async rechazarReporte(
    tx: any,
    tenantId: string,
    id: string,
    managerId: string,
    motivo?: string,
  ): Promise<any> {
    const solicitud = await this.obtenerPendienteValidacion(tx, id);

    const actualizada = await this.solicitudTrabajoAdicional.actualizarEstado(
      tx,
      id,
      'REPORTE_RECHAZADO',
      managerId,
      motivo,
    );

    try {
      await this.notificationService.notificarReportePedidoReentrega(
        tenantId,
        solicitud.employeeIdAsignado,
        motivo,
      );
    } catch {
      // No bloqueante: NotificationService ya loguea internamente sus errores.
    }

    return actualizada;
  }

  private async obtenerPendienteAprobacion(tx: any, id: string): Promise<any> {
    const solicitud = await tx.solicitudTrabajoAdicional.findUnique({ where: { id } });
    if (!solicitud) {
      throw new NotFoundException(`Solicitud ${id} no encontrada`);
    }
    if (solicitud.estado !== 'PENDIENTE_APROBACION') {
      throw new BadRequestException(
        'Solo se pueden decidir solicitudes en estado PENDIENTE_APROBACION',
      );
    }
    return solicitud;
  }

  private async obtenerPendienteValidacion(tx: any, id: string): Promise<any> {
    const solicitud = await tx.solicitudTrabajoAdicional.findUnique({ where: { id } });
    if (!solicitud) {
      throw new NotFoundException(`Solicitud ${id} no encontrada`);
    }
    if (solicitud.estado !== 'REPORTE_PENDIENTE_VALIDACION') {
      throw new BadRequestException(
        'Solo se pueden validar reportes en estado REPORTE_PENDIENTE_VALIDACION',
      );
    }
    return solicitud;
  }
}
