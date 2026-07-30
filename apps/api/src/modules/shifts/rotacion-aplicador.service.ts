import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { ShiftPlanService } from './shift-plan.service';
import { NotificationService } from '../../common/services/notification.service';

export interface AplicarPatronInput {
  tenantId: string;
  patronId: string;
  employeeIds: string[];
  desde: Date;
  hasta: Date;
  diaInicioCiclo: Date;  // Lunes de inicio
  ajustes?: { fecha: Date; tipoDia: string }[];
  creadoPor: string;
}

@Injectable()
export class RotacionAplicadorService {
  constructor(
    private readonly shiftPlan: ShiftPlanService,
    private readonly notificationService: NotificationService,
  ) {}

  async aplicarPatron(tx: any, input: AplicarPatronInput): Promise<{ procesadas: number; errores: any[] }> {
    // Validar fechas futuras (Global Constraint)
    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);
    if (input.desde < hoy) {
      throw new BadRequestException('La fecha "desde" no puede estar en el pasado');
    }
    if (input.hasta < hoy) {
      throw new BadRequestException('La fecha "hasta" no puede estar en el pasado');
    }

    // Obtener patrón
    const patron = await tx.rotacionPatron.findUnique({ where: { id: input.patronId } });
    if (!patron) throw new NotFoundException('Patrón no encontrado');

    const secuencia = JSON.parse(patron.secuencia);
    let procesadas = 0;
    const errores: any[] = [];

    // Para cada empleado
    for (const employeeId of input.employeeIds) {
      // Validar que empleado existe y está activo
      const emp = await tx.employee.findUnique({ where: { id: employeeId } });
      if (!emp || emp.estado === 'cesado') {
        errores.push({ employeeId, mensaje: 'Empleado no encontrado o cesado' });
        continue;
      }

      // Iterar fechas desde hasta, cycling secuencia
      let fechaActual = new Date(input.desde);
      let diaEnCiclo = this.calcularDiaEnCiclo(input.diaInicioCiclo, fechaActual);

      while (fechaActual <= input.hasta) {
        const tipoDia = secuencia[diaEnCiclo % 7];

        // Aplicar ajustes manuales si existen
        const ajuste = input.ajustes?.find(a =>
          new Date(a.fecha).toDateString() === fechaActual.toDateString()
        );
        const tipoDiaFinal = ajuste?.tipoDia ?? tipoDia;

        try {
          const esTurno = tipoDiaFinal === 'DIA' || tipoDiaFinal === 'NOCHE';
          let turnoId: string | undefined;
          if (esTurno) {
            const turno = await tx.turno.findUnique({
              where: { tenantId_codigo: { tenantId: input.tenantId, codigo: tipoDiaFinal } },
            });
            if (!turno) {
              errores.push({ employeeId, fecha: fechaActual, mensaje: `Turno catálogo "${tipoDiaFinal}" no existe para el tenant` });
              fechaActual.setDate(fechaActual.getDate() + 1);
              diaEnCiclo++;
              continue;
            }
            turnoId = turno.id;
          }

          await this.shiftPlan.upsertAsignacion(tx, {
            tenantId: input.tenantId,
            employeeId,
            fecha: fechaActual,
            tipoDia: esTurno ? 'TURNO' : (tipoDiaFinal as 'DESCANSO' | 'DESCANSO_COMPENSATORIO'),
            ...(turnoId && { turnoId }),
            creadoPor: input.creadoPor,
          });
          procesadas++;
        } catch (e) {
          errores.push({ employeeId, fecha: fechaActual, mensaje: (e as Error).message });
        }

        fechaActual.setDate(fechaActual.getDate() + 1);
        diaEnCiclo++;
      }
    }

    // Notificación no bloqueante a los empleados afectados (email + in-app).
    await this.notificationService.notificarPatronAplicado(
      input.tenantId,
      input.employeeIds,
      patron.nombre,
    );

    return { procesadas, errores };
  }

  private calcularDiaEnCiclo(diaInicioCiclo: Date, fecha: Date): number {
    const diffMs = fecha.getTime() - diaInicioCiclo.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    return diffDays;
  }
}
