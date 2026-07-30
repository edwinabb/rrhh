import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { SolicitudCambioTurnoService } from './solicitud-cambio-turno.service';
import { ShiftPlanService } from './shift-plan.service';
import { NotificationService } from '../../common/services/notification.service';

/**
 * Orquesta el flujo de aprobación/rechazo de una SolicitudCambioTurno dentro
 * de una transacción: aplica (o no) el nuevo turnoAsignacion vía
 * ShiftPlanService, actualiza el estado de la solicitud vía
 * SolicitudCambioTurnoService, y dispara notificaciones no bloqueantes.
 *
 * No duplica las validaciones de SolicitudCambioTurnoService.crearSolicitud
 * (Task 2): asume que la solicitud almacenada es válida y solo revalida que
 * las referencias de turno sigan existiendo (consistencia de snapshot).
 */
@Injectable()
export class SolicitudCambioTurnoAplicadorService {
  constructor(
    private readonly solicitudCambioTurno: SolicitudCambioTurnoService,
    private readonly shiftPlan: ShiftPlanService,
    private readonly notificationService: NotificationService,
  ) {}

  async aprobarSolicitud(tx: any, solicitudId: string, decididoPor: string): Promise<any> {
    const solicitud = await this.obtenerPendiente(tx, solicitudId);

    let nombreTurno: string | null = null;
    if (solicitud.turnoIdNuevo) {
      const turnoNuevo = await tx.turno.findUnique({ where: { id: solicitud.turnoIdNuevo } });
      if (!turnoNuevo || turnoNuevo.tenantId !== solicitud.tenantId) {
        throw new BadRequestException('El turno nuevo indicado no existe en el catálogo');
      }
      nombreTurno = turnoNuevo.nombre;
    }

    // NOTA: se marca APROBADA antes de aplicar el turnoAsignacion. El
    // orden inverso (aplicar y luego actualizarEstado) haría que la
    // revalidación de conflicto de actualizarEstado (Task 2) detecte como
    // "ocupado" el propio turnoAsignacion recién creado por esta misma
    // llamada (su tipoDia sería TURNO/DESCANSO_COMPENSATORIO, distinto de
    // 'DESCANSO'), disparando un ConflictException espurio en el flujo
    // feliz. Validar-y-decidir primero, aplicar después, evita ese
    // falso positivo y preserva la revalidación de "snapshot" contra el
    // estado previo a esta operación.
    const actualizada = await this.solicitudCambioTurno.actualizarEstado(
      tx,
      solicitudId,
      'APROBADA',
      decididoPor,
    );

    await this.shiftPlan.upsertAsignacion(tx, {
      tenantId: solicitud.tenantId,
      employeeId: solicitud.employeeId,
      fecha: solicitud.fechaNueva,
      tipoDia: solicitud.turnoIdNuevo ? 'TURNO' : 'DESCANSO',
      ...(solicitud.turnoIdNuevo && { turnoId: solicitud.turnoIdNuevo }),
      creadoPor: solicitud.creadoPor,
    });

    try {
      await this.notificationService.notificarSolicitudAprobada(
        solicitud.tenantId,
        solicitud.employeeId,
        solicitud.fechaNueva,
        nombreTurno,
      );
    } catch {
      // No bloqueante: NotificationService ya loguea internamente sus errores.
    }

    return actualizada;
  }

  async rechazarSolicitud(
    tx: any,
    solicitudId: string,
    decididoPor: string,
    motivoRechazo: string,
  ): Promise<any> {
    const solicitud = await this.obtenerPendiente(tx, solicitudId);

    const actualizada = await this.solicitudCambioTurno.actualizarEstado(
      tx,
      solicitudId,
      'RECHAZADA',
      decididoPor,
      motivoRechazo,
    );

    try {
      await this.notificationService.notificarSolicitudRechazada(
        solicitud.tenantId,
        solicitud.employeeId,
        motivoRechazo,
      );
    } catch {
      // No bloqueante: NotificationService ya loguea internamente sus errores.
    }

    return actualizada;
  }

  private async obtenerPendiente(tx: any, solicitudId: string): Promise<any> {
    const solicitud = await tx.solicitudCambioTurno.findUnique({ where: { id: solicitudId } });
    if (!solicitud) {
      throw new NotFoundException(`Solicitud ${solicitudId} no encontrada`);
    }
    if (solicitud.estado !== 'PENDIENTE') {
      throw new BadRequestException('Solo se pueden decidir solicitudes en estado PENDIENTE');
    }
    return solicitud;
  }
}
