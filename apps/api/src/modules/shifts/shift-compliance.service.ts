import { BadRequestException, Injectable } from '@nestjs/common';
import { NormativeParameterService } from '../normative-params/normative-parameter.service';

export interface ReporteEmpleado {
  employeeId: string;
  nombres: string;
  apellidos: string;
  numeroDocumento: string;
  diasPlanificados: number;
  diasTrabajados: number;
  faltas: number;
  faltasJustificadas: number;
  diasTardanza: number;
  minutosTardanza: number;
  minutosDeficit: number;
  pendientesSinPlan: Array<{ fecha: string; contraparteSugerida: string | null }>;
  compensatorios: { saldoInicial: number; ganados: number; gozados: number; saldoActual: number };
  /** Solo personal de confianza: una nota por semana que exceda las 48 h. */
  alertasConfianza: string[];
}

export interface ReporteCumplimiento {
  periodo: string;
  empleados: ReporteEmpleado[];
}

const PERIODO_REGEX = /^\d{4}-(0[1-9]|1[0-2])$/;
const CSV_HEADER = 'numero_documento,dias_laborados,horas_extra_25,horas_extra_35,bonificaciones,descuentos';
const JORNADA_SEMANAL_MAXIMA_DEFAULT = 48;

/** Lunes (00:00) de la semana de la fecha dada. */
function lunesDe(fecha: Date): Date {
  const d = new Date(fecha);
  d.setHours(0, 0, 0, 0);
  const dia = d.getDay(); // 0 = domingo
  d.setDate(d.getDate() - (dia === 0 ? 6 : dia - 1));
  return d;
}

/**
 * Reporte de cumplimiento del período (spec §7): compara plan vs. resúmenes,
 * detecta faltas (día TURNO pasado sin resumen), empareja pendientes sinPlan
 * con su contraparte del mismo día y agrega el libro de compensatorios.
 * El export CSV es compatible con POST /payroll/:periodo/import — RRHH decide
 * los montos (columnas de montos vacías a propósito).
 */
@Injectable()
export class ShiftComplianceService {
  constructor(private readonly normativeParams?: NormativeParameterService) {}

  async generarReporte(tx: any, periodo: string): Promise<ReporteCumplimiento> {
    if (!PERIODO_REGEX.test(periodo)) {
      throw new BadRequestException(`Período inválido: "${periodo}" (formato YYYY-MM)`);
    }
    const [anio = 0, mes = 0] = periodo.split('-').map(Number);
    const desde = new Date(anio, mes - 1, 1);
    const hasta = new Date(anio, mes, 0, 23, 59, 59, 999);
    const hoy = new Date();

    // Parámetro normativo configurable (48 h por defecto, D.Leg. 854)
    const jornadaSemanalMaxima = this.normativeParams
      ? (((await this.normativeParams.resolve(tx, 'JORNADA_SEMANAL_MAXIMA', hasta)) as number) ??
        JORNADA_SEMANAL_MAXIMA_DEFAULT)
      : JORNADA_SEMANAL_MAXIMA_DEFAULT;

    const [asignaciones, resumenes, movimientos, empleados, contratos] = await Promise.all([
      tx.turnoAsignacion.findMany({ where: { fecha: { gte: desde, lte: hasta } } }),
      tx.asistenciaResumen.findMany({ where: { fecha: { gte: desde, lte: hasta } } }),
      tx.compensatorioMovimiento.findMany({}),
      tx.employee.findMany({}),
      tx.contrato.findMany({ where: { personalDeConfianza: true } }),
    ]);
    const idsConfianza = new Set<string>(contratos.map((c: any) => c.employeeId));

    const empleadosPorId = new Map<string, any>(empleados.map((e: any) => [e.id, e]));
    // Empleados con actividad de turnos en el período (plan, resumen sinPlan o movimientos)
    const idsConPlan = new Set<string>(asignaciones.map((a: any) => a.employeeId));
    for (const r of resumenes) if (r.sinPlan) idsConPlan.add(r.employeeId);

    // Índices por empleado|fecha para faltas y contrapartes
    const resumenPorClave = new Map<string, any>();
    for (const r of resumenes) {
      resumenPorClave.set(`${r.employeeId}|${new Date(r.fecha).toISOString().slice(0, 10)}`, r);
    }
    const turnosPorFecha = new Map<string, any[]>();
    for (const a of asignaciones) {
      if (a.tipoDia !== 'TURNO') continue;
      const clave = new Date(a.fecha).toISOString().slice(0, 10);
      if (!turnosPorFecha.has(clave)) turnosPorFecha.set(clave, []);
      turnosPorFecha.get(clave)!.push(a);
    }

    const reporte: ReporteEmpleado[] = [];
    for (const employeeId of idsConPlan) {
      const empleado = empleadosPorId.get(employeeId);
      if (!empleado) continue;

      const asignacionesEmp = asignaciones.filter((a: any) => a.employeeId === employeeId);
      const resumenesEmp = resumenes.filter((r: any) => r.employeeId === employeeId);

      let faltas = 0;
      let faltasJustificadas = 0;
      for (const a of asignacionesEmp) {
        if (a.tipoDia !== 'TURNO') continue;
        const fecha = new Date(a.fecha);
        if (fecha.getTime() >= hoy.getTime()) continue; // futuro: aún no evaluable
        const resumen = resumenPorClave.get(`${employeeId}|${fecha.toISOString().slice(0, 10)}`);
        if (!resumen || resumen.falta) {
          if (resumen?.justificado) faltasJustificadas += 1;
          else faltas += 1;
        }
      }

      const pendientesSinPlan = resumenesEmp
        .filter((r: any) => r.sinPlan)
        .map((r: any) => {
          const clave = new Date(r.fecha).toISOString().slice(0, 10);
          const contraparte = (turnosPorFecha.get(clave) ?? []).find((a: any) => {
            const resumenTitular = resumenPorClave.get(`${a.employeeId}|${clave}`);
            return !resumenTitular || resumenTitular.falta;
          });
          const empContraparte = contraparte ? empleadosPorId.get(contraparte.employeeId) : null;
          return {
            fecha: clave,
            contraparteSugerida: empContraparte
              ? `${empContraparte.apellidos}, ${empContraparte.nombres} tenía turno y no marcó`
              : null,
          };
        });

      const movimientosEmp = movimientos.filter((m: any) => m.employeeId === employeeId);
      const enPeriodo = (m: any) =>
        new Date(m.creadoEn).getTime() >= desde.getTime() && new Date(m.creadoEn).getTime() <= hasta.getTime();
      const saldoInicial = movimientosEmp
        .filter((m: any) => new Date(m.creadoEn).getTime() < desde.getTime())
        .reduce((s: number, m: any) => s + Number(m.dias), 0);
      const ganados = movimientosEmp
        .filter((m: any) => enPeriodo(m) && Number(m.dias) > 0 && m.tipo !== 'AJUSTE_INICIAL')
        .reduce((s: number, m: any) => s + Number(m.dias), 0);
      const gozados = movimientosEmp
        .filter((m: any) => enPeriodo(m) && Number(m.dias) < 0)
        .reduce((s: number, m: any) => s + Number(m.dias), 0);
      const saldoActual = movimientosEmp.reduce((s: number, m: any) => s + Number(m.dias), 0);

      const conHoras = resumenesEmp.filter((r: any) => r.horasTrabajadas > 0);
      const conTardanza = resumenesEmp.filter((r: any) => r.tardanzaMinutos > 0);

      // Nota informativa para personal de confianza (spec §4.5): horas por
      // semana lunes-domingo > JORNADA_SEMANAL_MAXIMA. NO alimenta nómina.
      const alertasConfianza: string[] = [];
      if (idsConfianza.has(employeeId)) {
        const horasPorSemana = new Map<string, number>();
        for (const r of resumenesEmp) {
          const semana = lunesDe(new Date(r.fecha)).toISOString().slice(0, 10);
          horasPorSemana.set(semana, (horasPorSemana.get(semana) ?? 0) + r.horasTrabajadas);
        }
        for (const [semana, horas] of horasPorSemana) {
          if (horas > jornadaSemanalMaxima) {
            alertasConfianza.push(
              `Semana del ${semana}: ${Math.round(horas * 100) / 100} h trabajadas (excede las ${jornadaSemanalMaxima} h semanales — informativo, sin efecto en nómina)`,
            );
          }
        }
      }

      reporte.push({
        employeeId,
        nombres: empleado.nombres,
        apellidos: empleado.apellidos,
        numeroDocumento: empleado.numeroDocumento,
        diasPlanificados: asignacionesEmp.filter((a: any) => a.tipoDia === 'TURNO').length,
        diasTrabajados: conHoras.length,
        faltas,
        faltasJustificadas,
        diasTardanza: conTardanza.length,
        minutosTardanza: conTardanza.reduce((s: number, r: any) => s + r.tardanzaMinutos, 0),
        minutosDeficit: resumenesEmp.reduce((s: number, r: any) => s + (r.deficitMinutos ?? 0), 0),
        pendientesSinPlan,
        compensatorios: { saldoInicial, ganados, gozados, saldoActual },
        alertasConfianza,
      });
    }

    reporte.sort((a, b) => a.apellidos.localeCompare(b.apellidos));
    return { periodo, empleados: reporte };
  }

  async exportarNovedadesCsv(tx: any, periodo: string): Promise<string> {
    const { empleados } = await this.generarReporte(tx, periodo);
    const filas = empleados.map(
      (e) => `${e.numeroDocumento},${e.diasTrabajados},,,,`,
    );
    return [CSV_HEADER, ...filas].join('\r\n') + '\r\n';
  }
}
