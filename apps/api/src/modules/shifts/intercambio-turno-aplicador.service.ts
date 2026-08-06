import { Injectable, Logger, NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { CompensatorioService } from './compensatorio.service';
import { NotificationService } from '../../common/services/notification.service';
import type { MotivoResolucionIntercambio } from './intercambio-turno.service';
import type { TenantContext } from '../../common/database/tenant-request-context';

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
  private readonly logger = new Logger(IntercambioTurnoAplicadorService.name);

  constructor(
    private readonly compensatorios: CompensatorioService,
    private readonly notificationService: NotificationService,
  ) {}

  async barrido(tx: any, tenantId: string, pgRole: TenantContext['pgRole']): Promise<void> {
    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);

    const sinRespuestaB = await tx.intercambioTurno.findMany({
      where: { tenantId, estado: 'PENDIENTE_ACEPTACION_B', fecha: { lte: hoy } },
    });
    for (const it of sinRespuestaB) {
      try {
        await this.cerrarSinEjecutar(tx, it, 'FECHA_ALCANZADA_SIN_RESPUESTA_B');
      } catch (err) {
        // Un registro con problemas (FK, permisos, race) no debe abortar el
        // barrido completo ni la transacción del caller — se loguea y se
        // sigue con el resto de los registros pendientes.
        this.logger.error(
          `barrido: fallo al cerrar sin ejecutar intercambio ${it.id}: ${(err as Error)?.message ?? err}`,
        );
      }
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
        try {
          await this.ejecutarSwap(tx, it, {
            decididoPor: null,
            estadoAprobado: 'AUTO_APROBADA',
            motivoResolucion: porFecha ? 'FECHA_ALCANZADA' : 'PLAZO_48H',
          }, pgRole);
        } catch (err) {
          // Mismo criterio: aislar el fallo de un registro para no tumbar
          // el barrido ni el request del endpoint que lo disparó.
          this.logger.error(
            `barrido: fallo al ejecutar swap del intercambio ${it.id}: ${(err as Error)?.message ?? err}`,
          );
        }
      }
    }
  }

  async aprobar(
    tx: any, tenantId: string, pgRole: TenantContext['pgRole'], id: string, managerId: string,
  ): Promise<any> {
    await this.barrido(tx, tenantId, pgRole);
    const it = await this.obtenerAceptadaPorB(tx, tenantId, id);
    const resultado = await this.ejecutarSwap(
      tx, it, { decididoPor: managerId, estadoAprobado: 'APROBADA_MANAGER' }, pgRole,
    );
    if (resultado === null) {
      throw new ConflictException(
        `El intercambio ${id} ya fue resuelto por otro proceso mientras se procesaba tu decisión`,
      );
    }
    return resultado;
  }

  async rechazarManager(
    tx: any,
    tenantId: string,
    pgRole: TenantContext['pgRole'],
    id: string,
    managerId: string,
    motivoRechazo?: string,
  ): Promise<any> {
    await this.barrido(tx, tenantId, pgRole);
    const it = await this.obtenerAceptadaPorB(tx, tenantId, id);
    const resultado = await this.cerrarSinEjecutar(tx, it, undefined, {
      decididoPor: managerId,
      motivoRechazo,
      estado: 'RECHAZADA_MANAGER',
    });
    if (resultado === null) {
      throw new ConflictException(
        `El intercambio ${id} ya fue resuelto por otro proceso mientras se procesaba tu decisión`,
      );
    }
    return resultado;
  }

  private async obtenerAceptadaPorB(tx: any, tenantId: string, id: string): Promise<any> {
    const it = await tx.intercambioTurno.findUnique({ where: { id } });
    if (!it || it.tenantId !== tenantId) {
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
    pgRole: TenantContext['pgRole'],
  ): Promise<any> {
    const [asigA, asigB] = await Promise.all([
      tx.turnoAsignacion.findUnique({
        where: { tenantId_employeeId_fecha: { tenantId: it.tenantId, employeeId: it.employeeIdA, fecha: it.fecha } },
      }),
      tx.turnoAsignacion.findUnique({
        where: { tenantId_employeeId_fecha: { tenantId: it.tenantId, employeeId: it.employeeIdB, fecha: it.fecha } },
      }),
    ]);

    // TODO(fase-9 review #5): el snapshot de propuesta solo guarda tipoDia
    // (turnoActualA/B), no el turnoId específico. Si B es reasignado a OTRO
    // turno que igual sea tipoDia==='TURNO', este chequeo no lo detecta y A
    // termina swapeado a un turno que nunca aceptó. Arreglo correcto requiere
    // columnas nuevas (turnoIdActualA/B) + su propia migración — fuera de
    // alcance de este fix wave, ver docs/PENDIENTES.md (Sprint 9, deuda técnica).
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
    }, pgRole);

    // Claim-check optimista (hallazgo #4 revisión fase 9): dos requests
    // concurrentes pueden leer el mismo registro ACEPTADA_POR_B y llegar
    // ambos hasta acá. El UPDATE condicionado a que el estado siga siendo
    // el que leímos (it.estado) hace que solo el primero en escribir gane;
    // el segundo ve count === 0 y no duplica la marca ni la notificación.
    const claim = await tx.intercambioTurno.updateMany({
      where: { id: it.id, estado: it.estado },
      data: {
        estado: opts.estadoAprobado,
        motivoResolucion: opts.motivoResolucion ?? null,
        decididoPor: opts.decididoPor,
        decididoEn: new Date(),
        turnoAsignacionAId: a.id,
        turnoAsignacionBId: b.id,
      },
    });

    if (claim.count === 0) {
      this.logger.warn(
        `ejecutarSwap: intercambio ${it.id} ya no está en estado '${it.estado}' (resuelto por otro proceso) — se omite marca y notificación`,
      );
      return null;
    }

    const actualizado = await tx.intercambioTurno.findUnique({ where: { id: it.id } });

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

    // Mismo claim-check optimista que en ejecutarSwap (hallazgo #4): el
    // UPDATE solo aplica si el registro sigue en el estado que leímos.
    const claim = await tx.intercambioTurno.updateMany({
      where: { id: it.id, estado: it.estado },
      data: {
        estado,
        motivoResolucion: motivoResolucion ?? null,
        motivoRechazo,
        decididoPor: manual?.decididoPor ?? null,
        decididoEn: new Date(),
      },
    });

    if (claim.count === 0) {
      this.logger.warn(
        `cerrarSinEjecutar: intercambio ${it.id} ya no está en estado '${it.estado}' (resuelto por otro proceso) — se omite marca y notificación`,
      );
      return null;
    }

    const actualizado = await tx.intercambioTurno.findUnique({ where: { id: it.id } });

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
