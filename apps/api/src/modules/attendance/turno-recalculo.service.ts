import { Injectable } from '@nestjs/common';
import {
  atribuirFechaTurno,
  construirVentanaTurno,
  VentanaCandidata,
} from './calculators/ventana-turno.calculator';
import { evaluarCumplimientoTurno } from './calculators/turno-cumplimiento.calculator';
import { MarcacionDia } from './calculators/asistencia-resumen.calculator';

const DIA_MS = 24 * 3_600_000;

function inicioDelDia(fecha: Date): Date {
  const d = new Date(fecha);
  d.setHours(0, 0, 0, 0);
  return d;
}

/**
 * Recalcula el AsistenciaResumen por FECHA DE TURNO (spec §4.1/§6): resuelve
 * si la marcación de referencia cae en la ventana de un turno asignado
 * (fechas D−1..D+1) y persiste el cumplimiento en la fecha del turno. Si el
 * empleado tiene plan en el mes pero la marcación no corresponde a ningún
 * turno, el día calendario se marca sinPlan=true (pendiente de resolución
 * RRHH). Si el empleado no tiene plan alguno en el mes, retorna false y el
 * caller usa el flujo estándar (retrocompatibilidad).
 */
@Injectable()
export class TurnoRecalculoService {
  async recalcularConTurno(
    tx: any,
    tenantId: string,
    employeeId: string,
    timestampReferencia: Date,
    config: any,
  ): Promise<boolean> {
    const dia = inicioDelDia(timestampReferencia);
    const inicioMes = new Date(dia.getFullYear(), dia.getMonth(), 1);
    const finMes = new Date(dia.getFullYear(), dia.getMonth() + 1, 0, 23, 59, 59, 999);

    const tienePlanEnMes = await tx.turnoAsignacion.count({
      where: { tenantId, employeeId, fecha: { gte: inicioMes, lte: finMes } },
    });
    if (tienePlanEnMes === 0) return false;

    // Turnos asignados D−1..D+1 (una ventana nocturna de la víspera puede
    // contener la marcación de hoy)
    const asignaciones = await tx.turnoAsignacion.findMany({
      where: {
        tenantId,
        employeeId,
        tipoDia: 'TURNO',
        fecha: { gte: new Date(dia.getTime() - DIA_MS), lte: new Date(dia.getTime() + DIA_MS) },
      },
      include: { turno: true },
    });

    const candidatas: VentanaCandidata[] = asignaciones.map((a: any) => ({
      fecha: inicioDelDia(new Date(a.fecha)),
      ventana: construirVentanaTurno(
        inicioDelDia(new Date(a.fecha)),
        { horaInicio: a.turno.horaInicio, horaFin: a.turno.horaFin },
        config.ventanaAntesTurnoMinutos ?? 120,
        config.ventanaDespuesTurnoMinutos ?? 240,
      ),
    }));

    const fechaTurno = atribuirFechaTurno(timestampReferencia, candidatas);

    if (fechaTurno === null) {
      // Con plan en el mes pero sin turno para esta marcación: día sinPlan
      await this.upsertResumenSinPlan(tx, tenantId, employeeId, dia);
      return true;
    }

    const asignacion = asignaciones.find(
      (a: any) => inicioDelDia(new Date(a.fecha)).getTime() === fechaTurno.getTime(),
    );
    const candidata = candidatas.find((c) => c.fecha.getTime() === fechaTurno.getTime())!;
    const turno = asignacion.turno;

    const marcacionesVentana = await tx.marcacion.findMany({
      where: {
        tenantId,
        employeeId,
        bloqueado: false,
        tipo: { in: ['ENTRADA', 'SALIDA'] },
        timestamp: { gte: candidata.ventana.inicioVentana, lte: candidata.ventana.finVentana },
      },
      orderBy: { timestamp: 'asc' },
    });

    const justificacionAprobada = await tx.justificacion.findFirst({
      where: { tenantId, employeeId, fecha: fechaTurno, estado: 'APROBADA' },
    });

    const marcaciones: MarcacionDia[] = marcacionesVentana.map((m: any) => ({
      tipo: m.tipo,
      timestampActual: m.timestamp,
    }));

    const r = evaluarCumplimientoTurno({
      ventana: candidata.ventana,
      horasEsperadas: turno.horasEsperadas.toNumber
        ? turno.horasEsperadas.toNumber()
        : Number(turno.horasEsperadas),
      toleranciaMinutos: turno.toleranciaMinutos,
      marcaciones,
      justificacionAprobada: justificacionAprobada ? { id: justificacionAprobada.id } : undefined,
    });

    // Personal de confianza (D.S. 007-2002-TR, spec §4.5): sin horas extra a
    // nómina; el exceso semanal se informa solo en el reporte de cumplimiento.
    const contrato = await tx.contrato.findFirst({
      where: { employeeId },
      orderBy: { fechaInicio: 'desc' },
    });
    const esConfianza = contrato?.personalDeConfianza === true;

    const datos = {
      horaEntrada: r.horaEntrada,
      horaSalida: r.horaSalida,
      horasTrabajadas: r.horasTrabajadas,
      horasExtrasDiarias: esConfianza ? 0 : r.horasExtras,
      falta: r.falta,
      tardanzaMinutos: r.tardanzaMinutos,
      justificado: r.justificado,
      turnoId: turno.id,
      minutosRetraso: r.minutosRetraso,
      salidaEsperada: r.salidaEsperada,
      deficitMinutos: r.deficitMinutos,
      sinPlan: false,
    };

    await tx.asistenciaResumen.upsert({
      where: { tenantId_employeeId_fecha: { tenantId, employeeId, fecha: fechaTurno } },
      update: datos,
      create: { tenantId, employeeId, fecha: fechaTurno, ...datos },
    });

    if (!esConfianza && r.horasExtras > 0) {
      await tx.horasExtra.upsert({
        where: {
          tenantId_employeeId_fecha_tipo: {
            tenantId,
            employeeId,
            fecha: fechaTurno,
            tipo: 'DIARIAS',
          },
        },
        update: { horasCalculadas: r.horasExtras },
        create: {
          tenantId,
          employeeId,
          fecha: fechaTurno,
          tipo: 'DIARIAS',
          horasCalculadas: r.horasExtras,
        },
      });
    }

    return true;
  }

  /** Día trabajado sin turno: horas por diferencia simple + flag sinPlan. */
  private async upsertResumenSinPlan(
    tx: any,
    tenantId: string,
    employeeId: string,
    fecha: Date,
  ): Promise<void> {
    const finDia = new Date(fecha.getTime() + DIA_MS - 1);
    const marcacionesDia = await tx.marcacion.findMany({
      where: {
        tenantId,
        employeeId,
        bloqueado: false,
        tipo: { in: ['ENTRADA', 'SALIDA'] },
        timestamp: { gte: fecha, lte: finDia },
      },
      orderBy: { timestamp: 'asc' },
    });
    const entradas = marcacionesDia.filter((m: any) => m.tipo === 'ENTRADA');
    const salidas = marcacionesDia.filter((m: any) => m.tipo === 'SALIDA');
    const horaEntrada = entradas[0]?.timestamp ?? null;
    const horaSalida = salidas[salidas.length - 1]?.timestamp ?? null;
    const horasTrabajadas =
      horaEntrada && horaSalida
        ? Math.round(((horaSalida.getTime() - horaEntrada.getTime()) / 3_600_000) * 100) / 100
        : 0;

    const datos = {
      horaEntrada,
      horaSalida,
      horasTrabajadas,
      horasExtrasDiarias: 0,
      falta: false,
      tardanzaMinutos: 0,
      justificado: false,
      turnoId: null,
      minutosRetraso: 0,
      salidaEsperada: null,
      deficitMinutos: 0,
      sinPlan: true,
    };
    await tx.asistenciaResumen.upsert({
      where: { tenantId_employeeId_fecha: { tenantId, employeeId, fecha } },
      update: datos,
      create: { tenantId, employeeId, fecha, ...datos },
    });
  }
}
