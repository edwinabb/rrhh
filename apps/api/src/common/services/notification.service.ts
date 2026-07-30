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
