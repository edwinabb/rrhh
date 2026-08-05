import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { CompensatorioService } from './compensatorio.service';
import { NotificationService } from '../../common/services/notification.service';
import type { MotivoResolucionIntercambio } from './intercambio-turno.service';

const HORAS_PLAZO_MANAGER = 48;

/**
 * Orquesta las decisiones del manager (aprobar/rechazar) y el barrido
 * perezoso que resuelve automáticamente los intercambios ACEPTADA_POR_B
 * cuando pasan 48h sin decisión, o cuando la fecha del turno llega antes
 * (ver diseño §4.2/§4.3). No hay cron en el repo: `barrido` se llama al
 * inicio de cada endpoint del módulo (Task 5), no en background.
 */
@Injectable()
export class IntercambioTurnoAplicadorService {
  constructor(
    private readonly compensatorios: CompensatorioService,
    private readonly notificationService: NotificationService,
  ) {}

  async barrido(tx: any, tenantId: string): Promise<void> {
    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);

    const sinRespuestaB = await tx.intercambioTurno.findMany({
      where: { tenantId, estado: 'PENDIENTE_ACEPTACION_B', fecha: { lte: hoy } },
    });
    for (const it of sinRespuestaB) {
      await this.cerrarSinEjecutar(tx, it, 'FECHA_ALCANZADA_SIN_RESPUESTA_B');
    }

    const limitePlazo = new Date();
    limitePlazo.setHours(limitePlazo.getHours() - HORAS_PLAZO_MANAGER);

    const aceptadas = await tx.intercambioTurno.findMany({
      where: { tenantId, estado: 'ACEPTADA_POR_B' },
    });
    for (const it of aceptadas) {
      const porFecha = it.fecha <= hoy;
      const porPlazo = !porFecha && it.aceptadoEn && it.aceptadoEn <= limitePlazo;
      if (porFecha || porPlazo) {
        await this.ejecutarSwap(tx, it, {
          decididoPor: null,
          estadoAprobado: 'AUTO_APROBADA',
          motivoResolucion: porFecha ? 'FECHA_ALCANZADA' : 'PLAZO_48H',
        });
      }
    }
  }

  async aprobar(tx: any, tenantId: string, id: string, managerId: string): Promise<any> {
    await this.barrido(tx, tenantId);
    const it = await this.obtenerAceptadaPorB(tx, id);
    return this.ejecutarSwap(tx, it, { decididoPor: managerId, estadoAprobado: 'APROBADA_MANAGER' });
  }

  async rechazarManager(
    tx: any,
    tenantId: string,
    id: string,
    managerId: string,
    motivoRechazo?: string,
  ): Promise<any> {
    await this.barrido(tx, tenantId);
    const it = await this.obtenerAceptadaPorB(tx, id);
    return this.cerrarSinEjecutar(tx, it, undefined, {
      decididoPor: managerId,
      motivoRechazo,
      estado: 'RECHAZADA_MANAGER',
    });
  }

  private async obtenerAceptadaPorB(tx: any, id: string): Promise<any> {
    const it = await tx.intercambioTurno.findUnique({ where: { id } });
    if (!it) {
      throw new NotFoundException(`Intercambio ${id} no encontrado`);
    }
    if (it.estado !== 'ACEPTADA_POR_B') {
      throw new BadRequestException(
        `Este intercambio ya no está pendiente de tu decisión (estado actual: ${it.estado})`,
      );
    }
    return it;
  }

  private async ejecutarSwap(
    tx: any,
    it: any,
    opts: { decididoPor: string | null; estadoAprobado: 'APROBADA_MANAGER' | 'AUTO_APROBADA'; motivoResolucion?: MotivoResolucionIntercambio },
  ): Promise<any> {
    const [asigA, asigB] = await Promise.all([
      tx.turnoAsignacion.findUnique({
        where: { tenantId_employeeId_fecha: { tenantId: it.tenantId, employeeId: it.employeeIdA, fecha: it.fecha } },
      }),
      tx.turnoAsignacion.findUnique({
        where: { tenantId_employeeId_fecha: { tenantId: it.tenantId, employeeId: it.employeeIdB, fecha: it.fecha } },
      }),
    ]);

    const turnoModificado = !asigA || !asigB || asigA.tipoDia !== it.turnoActualA || asigB.tipoDia !== it.turnoActualB;
    if (turnoModificado) {
      return this.cerrarSinEjecutar(tx, it, 'TURNO_MODIFICADO');
    }

    const { a, b } = await this.compensatorios.intercambiar(tx, {
      tenantId: it.tenantId,
      fecha: it.fecha,
      employeeIdA: it.employeeIdA,
      employeeIdB: it.employeeIdB,
      creadoPor: opts.decididoPor ?? it.employeeIdA,
    });

    const actualizado = await tx.intercambioTurno.update({
      where: { id: it.id },
      data: {
        estado: opts.estadoAprobado,
        motivoResolucion: opts.motivoResolucion ?? null,
        decididoPor: opts.decididoPor,
        decididoEn: new Date(),
        turnoAsignacionAId: a.id,
        turnoAsignacionBId: b.id,
      },
    });

    try {
      await this.notificationService.notificarIntercambioAprobado(
        it.tenantId, it.employeeIdA, it.employeeIdB, it.fecha, opts.estadoAprobado === 'AUTO_APROBADA',
      );
    } catch {
      // No bloqueante: NotificationService ya loguea internamente sus errores.
    }

    return actualizado;
  }

  private async cerrarSinEjecutar(
    tx: any,
    it: any,
    motivoResolucion?: MotivoResolucionIntercambio,
    manual?: { decididoPor: string; motivoRechazo?: string; estado: 'RECHAZADA_MANAGER' },
  ): Promise<any> {
    const estado = manual?.estado ?? 'RECHAZADA_AUTOMATICA';
    const motivoRechazo = manual?.motivoRechazo ?? (motivoResolucion ? this.describirMotivo(motivoResolucion) : null);

    const actualizado = await tx.intercambioTurno.update({
      where: { id: it.id },
      data: {
        estado,
        motivoResolucion: motivoResolucion ?? null,
        motivoRechazo,
        decididoPor: manual?.decididoPor ?? null,
        decididoEn: new Date(),
      },
    });

    try {
      await this.notificationService.notificarIntercambioRechazado(
        it.tenantId, it.employeeIdA, it.employeeIdB, motivoRechazo ?? undefined,
      );
    } catch {
      // No bloqueante: NotificationService ya loguea internamente sus errores.
    }

    return actualizado;
  }

  private describirMotivo(motivo: MotivoResolucionIntercambio): string {
    if (motivo === 'TURNO_MODIFICADO') return 'El turno de uno de los empleados cambió desde la propuesta';
    if (motivo === 'FECHA_ALCANZADA_SIN_RESPUESTA_B') return 'La fecha del turno llegó sin respuesta del empleado B';
    return '';
  }
}
