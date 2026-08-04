import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';

/**
 * Servicio de notificaciones a empleados (email + in-app).
 *
 * No existe todavía infraestructura de envío de correo en el repo (sin
 * MailerService, sin paquete SMTP/SES/Resend, sin variables de entorno
 * MAIL_*). Mientras esa infraestructura no se incorpore, `enviarEmail`
 * actúa como adapter de un solo punto de entrada: registra el envío vía
 * Logger (mismo patrón que ExampleProcessor en common/queue) para que,
 * cuando se conecte un transporte real, solo haya que reemplazar el
 * cuerpo de ese método.
 *
 * Tampoco existe el modelo `NotificationRecord` en el schema de Prisma
 * (packages/database/prisma/schema.prisma), así que la notificación
 * in-app queda como no-op explícito (ver `crearNotificacionInApp`) hasta
 * que se agregue esa tabla.
 *
 * Las notificaciones son tareas de fondo no bloqueantes: cualquier error
 * (empleado sin usuario/email, fallo de "envío", etc.) se captura y se
 * loguea, nunca se propaga.
 */
@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  constructor(private readonly prisma: PrismaService) {}

  async notificarPatronAplicado(
    tenantId: string,
    empleadoIds: string[],
    patronNombre: string,
  ): Promise<void> {
    if (!empleadoIds || empleadoIds.length === 0) return;

    const mensaje = `Tu plan de turnos fue actualizado usando patrón: ${patronNombre}`;

    let empleados: Array<{ id: string; user: { email: string } | null }> = [];
    try {
      empleados = await this.prisma.employee.findMany({
        where: { id: { in: empleadoIds }, tenantId },
        select: { id: true, user: { select: { email: true } } },
      });
    } catch (e) {
      this.logger.error(
        `No se pudo obtener empleados para notificar patrón aplicado (tenant=${tenantId}): ${(e as Error).message}`,
      );
      return;
    }

    for (const employeeId of empleadoIds) {
      const empleado = empleados.find((e) => e.id === employeeId);

      try {
        if (!empleado?.user?.email) {
          this.logger.warn(
            `Empleado ${employeeId} no tiene usuario/email asociado; se omite notificación de patrón "${patronNombre}"`,
          );
        } else {
          await this.enviarEmail(empleado.user.email, 'Actualización de plan de turnos', mensaje);
        }

        await this.crearNotificacionInApp(tenantId, employeeId, mensaje);
      } catch (e) {
        this.logger.error(
          `Error notificando a empleado ${employeeId} sobre patrón "${patronNombre}": ${(e as Error).message}`,
        );
      }
    }
  }

  /**
   * Notifica al empleado que su solicitud de cambio de turno fue aprobada.
   * No bloqueante: cualquier error se captura y se loguea.
   */
  async notificarSolicitudAprobada(
    tenantId: string,
    employeeId: string,
    fechaNueva: Date,
    nombreTurno?: string | null,
  ): Promise<void> {
    const detalleTurno = nombreTurno ? ` (${nombreTurno})` : '';
    const mensaje = `Tu solicitud de cambio de turno para el ${fechaNueva.toDateString()}${detalleTurno} fue aprobada`;

    try {
      const empleado = await this.prisma.employee.findUnique({
        where: { id: employeeId },
        select: { id: true, user: { select: { email: true } } },
      });

      if (!empleado?.user?.email) {
        this.logger.warn(
          `Empleado ${employeeId} no tiene usuario/email asociado; se omite notificación de solicitud aprobada`,
        );
      } else {
        await this.enviarEmail(empleado.user.email, 'Solicitud de cambio de turno aprobada', mensaje);
      }

      await this.crearNotificacionInApp(tenantId, employeeId, mensaje);
    } catch (e) {
      this.logger.error(
        `Error notificando a empleado ${employeeId} sobre solicitud aprobada: ${(e as Error).message}`,
      );
    }
  }

  /**
   * Notifica al empleado que su solicitud de cambio de turno fue rechazada.
   * El motivoRechazo es de uso interno (manager/RRHH); no se incluye en el
   * mensaje enviado al empleado, solo se registra en logs para trazabilidad.
   * No bloqueante: cualquier error se captura y se loguea.
   */
  async notificarSolicitudRechazada(
    tenantId: string,
    employeeId: string,
    motivoRechazo?: string | null,
  ): Promise<void> {
    const mensaje = 'Tu solicitud de cambio de turno fue rechazada';

    try {
      const empleado = await this.prisma.employee.findUnique({
        where: { id: employeeId },
        select: { id: true, user: { select: { email: true } } },
      });

      if (!empleado?.user?.email) {
        this.logger.warn(
          `Empleado ${employeeId} no tiene usuario/email asociado; se omite notificación de solicitud rechazada`,
        );
      } else {
        await this.enviarEmail(empleado.user.email, 'Solicitud de cambio de turno rechazada', mensaje);
      }

      await this.crearNotificacionInApp(tenantId, employeeId, mensaje);
      this.logger.log(`Solicitud rechazada para empleado ${employeeId} (tenant=${tenantId}). Motivo: ${motivoRechazo ?? 'sin motivo'}`);
    } catch (e) {
      this.logger.error(
        `Error notificando a empleado ${employeeId} sobre solicitud rechazada: ${(e as Error).message}`,
      );
    }
  }

  /**
   * Notifica al empleado que su solicitud de trabajo adicional fue
   * aprobada. No bloqueante: cualquier error se captura y se loguea.
   */
  async notificarTrabajoAprobado(
    tenantId: string,
    employeeId: string,
    descripcionTarea: string,
  ): Promise<void> {
    const mensaje = `Tu solicitud de trabajo adicional fue aprobada. Tarea: ${descripcionTarea}. Envía tu reporte cuando completes.`;

    try {
      const empleado = await this.prisma.employee.findUnique({
        where: { id: employeeId },
        select: { id: true, user: { select: { email: true } } },
      });

      if (!empleado?.user?.email) {
        this.logger.warn(
          `Empleado ${employeeId} no tiene usuario/email asociado; se omite notificación de trabajo aprobado`,
        );
      } else {
        await this.enviarEmail(empleado.user.email, 'Trabajo adicional aprobado', mensaje);
      }

      await this.crearNotificacionInApp(tenantId, employeeId, mensaje);
    } catch (e) {
      this.logger.error(
        `Error notificando a empleado ${employeeId} sobre trabajo aprobado: ${(e as Error).message}`,
      );
    }
  }

  /**
   * Notifica al empleado (nuevo asignado) que se le reasignó trabajo
   * adicional. No bloqueante: cualquier error se captura y se loguea.
   */
  async notificarTrabajoReasignado(
    tenantId: string,
    employeeId: string,
    descripcionTarea: string,
    fechaEstimada: Date,
    horasEstimadas: number,
  ): Promise<void> {
    const mensaje = `Se te asignó trabajo adicional: ${descripcionTarea}. Fecha: ${fechaEstimada.toDateString()}. Horas estimadas: ${horasEstimadas}.`;

    try {
      const empleado = await this.prisma.employee.findUnique({
        where: { id: employeeId },
        select: { id: true, user: { select: { email: true } } },
      });

      if (!empleado?.user?.email) {
        this.logger.warn(
          `Empleado ${employeeId} no tiene usuario/email asociado; se omite notificación de trabajo reasignado`,
        );
      } else {
        await this.enviarEmail(empleado.user.email, 'Trabajo adicional asignado', mensaje);
      }

      await this.crearNotificacionInApp(tenantId, employeeId, mensaje);
    } catch (e) {
      this.logger.error(
        `Error notificando a empleado ${employeeId} sobre trabajo reasignado: ${(e as Error).message}`,
      );
    }
  }

  /**
   * Notifica al empleado que su solicitud de trabajo adicional fue
   * rechazada. El motivoRechazo es de uso interno (manager/RRHH); no se
   * incluye en el mensaje enviado al empleado, solo se registra en logs
   * para trazabilidad. No bloqueante: cualquier error se captura y se
   * loguea.
   */
  async notificarTrabajoRechazado(
    tenantId: string,
    employeeId: string,
    motivoRechazo?: string | null,
  ): Promise<void> {
    const mensaje = 'Tu solicitud de trabajo adicional fue rechazada';

    try {
      const empleado = await this.prisma.employee.findUnique({
        where: { id: employeeId },
        select: { id: true, user: { select: { email: true } } },
      });

      if (!empleado?.user?.email) {
        this.logger.warn(
          `Empleado ${employeeId} no tiene usuario/email asociado; se omite notificación de trabajo rechazado`,
        );
      } else {
        await this.enviarEmail(empleado.user.email, 'Trabajo adicional rechazado', mensaje);
      }

      await this.crearNotificacionInApp(tenantId, employeeId, mensaje);
      this.logger.log(`Trabajo adicional rechazado para empleado ${employeeId} (tenant=${tenantId}). Motivo: ${motivoRechazo ?? 'sin motivo'}`);
    } catch (e) {
      this.logger.error(
        `Error notificando a empleado ${employeeId} sobre trabajo rechazado: ${(e as Error).message}`,
      );
    }
  }

  /**
   * Notifica al empleado que su reporte de trabajo adicional fue validado
   * y se registró el compensatorio correspondiente. No bloqueante:
   * cualquier error se captura y se loguea.
   */
  async notificarReporteValidado(
    tenantId: string,
    employeeId: string,
    descripcionTarea: string,
    diasCompensatorios: number,
  ): Promise<void> {
    const mensaje = `Tu reporte fue validado. Compensatorio registrado: ${diasCompensatorios} día(s).`;

    try {
      const empleado = await this.prisma.employee.findUnique({
        where: { id: employeeId },
        select: { id: true, user: { select: { email: true } } },
      });

      if (!empleado?.user?.email) {
        this.logger.warn(
          `Empleado ${employeeId} no tiene usuario/email asociado; se omite notificación de reporte validado`,
        );
      } else {
        await this.enviarEmail(empleado.user.email, 'Reporte de trabajo adicional validado', mensaje);
      }

      await this.crearNotificacionInApp(tenantId, employeeId, mensaje);
    } catch (e) {
      this.logger.error(
        `Error notificando a empleado ${employeeId} sobre reporte validado: ${(e as Error).message}`,
      );
    }
  }

  /**
   * Notifica al empleado que su reporte de trabajo adicional fue
   * rechazado y necesita reentrega. El motivo es de uso interno
   * (manager/RRHH); no se incluye en el mensaje enviado al empleado, solo
   * se registra en logs para trazabilidad. No bloqueante: cualquier error
   * se captura y se loguea.
   */
  async notificarReportePedidoReentrega(
    tenantId: string,
    employeeId: string,
    motivo?: string | null,
  ): Promise<void> {
    const mensaje = 'Tu reporte fue rechazado y necesita reentrega. Por favor reenvía fotos y descripción.';

    try {
      const empleado = await this.prisma.employee.findUnique({
        where: { id: employeeId },
        select: { id: true, user: { select: { email: true } } },
      });

      if (!empleado?.user?.email) {
        this.logger.warn(
          `Empleado ${employeeId} no tiene usuario/email asociado; se omite notificación de reporte rechazado`,
        );
      } else {
        await this.enviarEmail(empleado.user.email, 'Reporte de trabajo adicional rechazado', mensaje);
      }

      await this.crearNotificacionInApp(tenantId, employeeId, mensaje);
      this.logger.log(`Reporte de trabajo adicional rechazado para empleado ${employeeId} (tenant=${tenantId}). Motivo: ${motivo ?? 'sin motivo'}`);
    } catch (e) {
      this.logger.error(
        `Error notificando a empleado ${employeeId} sobre reporte rechazado: ${(e as Error).message}`,
      );
    }
  }

  /**
   * Notifica al manager del empleado solicitante que se creó una nueva
   * solicitud de trabajo adicional. El manager se resuelve vía la
   * auto-relación Employee.managerId del solicitante; si el solicitante no
   * tiene manager asignado, se omite la notificación (no hay a quién
   * notificar). No bloqueante: cualquier error se captura y se loguea.
   */
  async notificarSolicitudTrabajoCreada(
    tenantId: string,
    employeeIdSolicitante: string,
    descripcionTarea: string,
    fechaEstimada: Date,
    horasEstimadas: number,
    urgencia: string,
  ): Promise<void> {
    try {
      const solicitante = await this.prisma.employee.findUnique({
        where: { id: employeeIdSolicitante },
        select: { managerId: true, nombres: true, apellidos: true },
      });

      if (!solicitante?.managerId) {
        this.logger.warn(
          `Empleado ${employeeIdSolicitante} no tiene manager asignado; se omite notificación de solicitud de trabajo adicional creada`,
        );
        return;
      }

      const nombreEmpleado = [solicitante.nombres, solicitante.apellidos].filter(Boolean).join(' ');
      const mensaje = `${nombreEmpleado} solicita trabajo adicional para el ${fechaEstimada.toDateString()}: ${descripcionTarea}. Horas: ${horasEstimadas}. Urgencia: ${urgencia}.`;

      const manager = await this.prisma.employee.findUnique({
        where: { id: solicitante.managerId },
        select: { user: { select: { email: true } } },
      });

      if (!manager?.user?.email) {
        this.logger.warn(
          `Manager ${solicitante.managerId} no tiene usuario/email asociado; se omite email de solicitud de trabajo adicional creada`,
        );
      } else {
        await this.enviarEmail(manager.user.email, 'Nueva solicitud de trabajo adicional', mensaje);
      }

      await this.crearNotificacionInApp(tenantId, solicitante.managerId, mensaje);
    } catch (e) {
      this.logger.error(
        `Error notificando a manager sobre solicitud de trabajo adicional creada por ${employeeIdSolicitante}: ${(e as Error).message}`,
      );
    }
  }

  /**
   * Notifica al manager que aprobó/reasignó el trabajo adicional que el
   * empleado asignado entregó su reporte de ejecución. managerId es el
   * Employee.id del manager, tomado directamente de la solicitud (no se
   * resuelve vía auto-relación). No bloqueante: cualquier error se captura
   * y se loguea.
   */
  async notificarReporteEnviado(
    tenantId: string,
    managerId: string,
    descripcionTarea: string,
    fechaEstimada: Date,
  ): Promise<void> {
    const mensaje = `Se entregó un reporte de trabajo adicional: ${descripcionTarea} (${fechaEstimada.toDateString()}).`;

    try {
      const manager = await this.prisma.employee.findUnique({
        where: { id: managerId },
        select: { id: true, user: { select: { email: true } } },
      });

      if (!manager?.user?.email) {
        this.logger.warn(
          `Manager ${managerId} no tiene usuario/email asociado; se omite notificación de reporte enviado`,
        );
      } else {
        await this.enviarEmail(manager.user.email, 'Reporte de trabajo adicional entregado', mensaje);
      }

      await this.crearNotificacionInApp(tenantId, managerId, mensaje);
    } catch (e) {
      this.logger.error(
        `Error notificando a manager ${managerId} sobre reporte enviado: ${(e as Error).message}`,
      );
    }
  }

  /**
   * Notifica al empleado B que recibió una propuesta de intercambio de
   * turno. No bloqueante: cualquier error se captura y se loguea.
   */
  async notificarIntercambioPropuesto(
    tenantId: string,
    employeeIdA: string,
    employeeIdB: string,
    fecha: Date,
    mensajeA?: string | null,
  ): Promise<void> {
    const mensaje = `Un compañero te propone intercambiar el turno del ${fecha.toDateString()}.` +
      (mensajeA ? ` Mensaje: ${mensajeA}` : '');

    try {
      const empleadoB = await this.prisma.employee.findUnique({
        where: { id: employeeIdB },
        select: { id: true, user: { select: { email: true } } },
      });

      if (!empleadoB?.user?.email) {
        this.logger.warn(
          `Empleado ${employeeIdB} no tiene usuario/email asociado; se omite notificación de intercambio propuesto`,
        );
      } else {
        await this.enviarEmail(empleadoB.user.email, 'Nueva propuesta de intercambio de turno', mensaje);
      }

      await this.crearNotificacionInApp(tenantId, employeeIdB, mensaje);
    } catch (e) {
      this.logger.error(
        `Error notificando a empleado ${employeeIdB} sobre intercambio propuesto: ${(e as Error).message}`,
      );
    }
  }

  /**
   * Notifica al empleado A que B rechazó su propuesta de intercambio. El
   * motivoRechazo es de uso interno; no se incluye en el mensaje, solo en
   * logs. No bloqueante.
   */
  async notificarIntercambioRechazadoPorB(
    tenantId: string,
    employeeIdA: string,
    motivoRechazo?: string | null,
  ): Promise<void> {
    const mensaje = 'Tu propuesta de intercambio de turno fue rechazada';

    try {
      const empleadoA = await this.prisma.employee.findUnique({
        where: { id: employeeIdA },
        select: { id: true, user: { select: { email: true } } },
      });

      if (!empleadoA?.user?.email) {
        this.logger.warn(
          `Empleado ${employeeIdA} no tiene usuario/email asociado; se omite notificación de intercambio rechazado por B`,
        );
      } else {
        await this.enviarEmail(empleadoA.user.email, 'Propuesta de intercambio rechazada', mensaje);
      }

      await this.crearNotificacionInApp(tenantId, employeeIdA, mensaje);
      this.logger.log(`Intercambio rechazado por B para empleado ${employeeIdA} (tenant=${tenantId}). Motivo: ${motivoRechazo ?? 'sin motivo'}`);
    } catch (e) {
      this.logger.error(
        `Error notificando a empleado ${employeeIdA} sobre intercambio rechazado por B: ${(e as Error).message}`,
      );
    }
  }

  /**
   * Notifica al manager del empleado A (resuelto vía Employee.managerId,
   * mismo patrón que notificarSolicitudTrabajoCreada) que el intercambio
   * fue aceptado por B y queda pendiente de su aprobación. No bloqueante.
   */
  async notificarIntercambioAceptadoPorB(
    tenantId: string,
    employeeIdA: string,
    employeeIdB: string,
    fecha: Date,
  ): Promise<void> {
    try {
      const empleadoA = await this.prisma.employee.findUnique({
        where: { id: employeeIdA },
        select: { managerId: true, nombres: true, apellidos: true },
      });

      if (!empleadoA?.managerId) {
        this.logger.warn(
          `Empleado ${employeeIdA} no tiene manager asignado; se omite notificación de intercambio aceptado por B`,
        );
        return;
      }

      const nombreEmpleado = [empleadoA.nombres, empleadoA.apellidos].filter(Boolean).join(' ');
      const mensaje = `Intercambio de turno aceptado entre ${nombreEmpleado || employeeIdA} y su compañero para el ${fecha.toDateString()}. Pendiente de tu aprobación.`;

      const manager = await this.prisma.employee.findUnique({
        where: { id: empleadoA.managerId },
        select: { user: { select: { email: true } } },
      });

      if (!manager?.user?.email) {
        this.logger.warn(
          `Manager ${empleadoA.managerId} no tiene usuario/email asociado; se omite email de intercambio aceptado por B`,
        );
      } else {
        await this.enviarEmail(manager.user.email, 'Intercambio de turno pendiente de aprobación', mensaje);
      }

      await this.crearNotificacionInApp(tenantId, empleadoA.managerId, mensaje);
    } catch (e) {
      this.logger.error(
        `Error notificando a manager sobre intercambio aceptado por B (A=${employeeIdA}): ${(e as Error).message}`,
      );
    }
  }

  /**
   * Notifica a A y B que el intercambio fue aprobado y sus turnos se
   * intercambiaron. fueAutomatico distingue si lo resolvió el manager o el
   * sistema (48h sin decisión, o llegó la fecha del turno). No bloqueante.
   */
  async notificarIntercambioAprobado(
    tenantId: string,
    employeeIdA: string,
    employeeIdB: string,
    fecha: Date,
    fueAutomatico: boolean,
  ): Promise<void> {
    const mensaje = `Intercambio de turno aprobado para el ${fecha.toDateString()}. Tus turnos han sido intercambiados.` +
      (fueAutomatico ? ' (aprobado automáticamente, sin decisión manual del manager)' : '');

    for (const employeeId of [employeeIdA, employeeIdB]) {
      try {
        const empleado = await this.prisma.employee.findUnique({
          where: { id: employeeId },
          select: { id: true, user: { select: { email: true } } },
        });

        if (!empleado?.user?.email) {
          this.logger.warn(
            `Empleado ${employeeId} no tiene usuario/email asociado; se omite notificación de intercambio aprobado`,
          );
        } else {
          await this.enviarEmail(empleado.user.email, 'Intercambio de turno aprobado', mensaje);
        }

        await this.crearNotificacionInApp(tenantId, employeeId, mensaje);
      } catch (e) {
        this.logger.error(
          `Error notificando a empleado ${employeeId} sobre intercambio aprobado: ${(e as Error).message}`,
        );
      }
    }
  }

  /**
   * Notifica a A y B que el intercambio fue rechazado (por el manager, o
   * automáticamente por el sistema — turno modificado desde la propuesta,
   * o fecha alcanzada sin respuesta de B). motivoRechazo se incluye en el
   * mensaje porque en los casos automáticos es información que ambos
   * necesitan para entender qué pasó. No bloqueante.
   */
  async notificarIntercambioRechazado(
    tenantId: string,
    employeeIdA: string,
    employeeIdB: string,
    motivoRechazo?: string | null,
  ): Promise<void> {
    const mensaje = 'Intercambio de turno rechazado' + (motivoRechazo ? `. Motivo: ${motivoRechazo}` : '');

    for (const employeeId of [employeeIdA, employeeIdB]) {
      try {
        const empleado = await this.prisma.employee.findUnique({
          where: { id: employeeId },
          select: { id: true, user: { select: { email: true } } },
        });

        if (!empleado?.user?.email) {
          this.logger.warn(
            `Empleado ${employeeId} no tiene usuario/email asociado; se omite notificación de intercambio rechazado`,
          );
        } else {
          await this.enviarEmail(empleado.user.email, 'Intercambio de turno rechazado', mensaje);
        }

        await this.crearNotificacionInApp(tenantId, employeeId, mensaje);
      } catch (e) {
        this.logger.error(
          `Error notificando a empleado ${employeeId} sobre intercambio rechazado: ${(e as Error).message}`,
        );
      }
    }
  }

  /**
   * Punto de entrada único de envío de email. Sin transporte real
   * configurado en el repo; se deja registrado vía Logger para no bloquear
   * el flujo de negocio. Reemplazar el cuerpo cuando se integre un
   * MailerService/SMTP/SES/Resend.
   */
  private async enviarEmail(destinatario: string, asunto: string, mensaje: string): Promise<void> {
    this.logger.log(`[email] Para: ${destinatario} | Asunto: ${asunto} | Mensaje: ${mensaje}`);
  }

  /**
   * No-op documentado: el modelo NotificationRecord no existe en el
   * schema de Prisma (packages/database/prisma/schema.prisma). Cuando se
   * agregue, este método debe crear el registro in-app real.
   */
  private async crearNotificacionInApp(
    _tenantId: string,
    _employeeId: string,
    _mensaje: string,
  ): Promise<void> {
    return Promise.resolve();
  }
}
