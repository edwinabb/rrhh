import { Injectable } from '@nestjs/common';
import {
  calcularHorasComputables,
  ResumenDia,
} from './calculators/asistencia-resumen.calculator';
import {
  calcularRecargo,
  JORNADA_MAXIMA_DIARIA_LEGAL,
  RecargoParams,
  TASAS_RECARGO_DLEG_854,
} from './calculators/horas-extra.calculator';

/** Horas computables (HC) de un empleado para el período, listas para nómina. */
export interface HorasComputablesEmpleado {
  horasComputables: number;
  faltasInjustificadas: number;
  tardanzasMinutos: number;
}

/** Horas extra del período repartidas por tramo de recargo (D.Leg. 854). */
export interface HorasExtraEmpleado {
  /** Horas extra pagadas con recargo del 25% (primer tramo diario). */
  horas25: number;
  /** Horas extra pagadas con recargo del 35% (a partir de la 3ra hora del día). */
  horas35: number;
}

/** Fila mínima de asistencia_resumen que consume este servicio. */
interface AsistenciaResumenRow {
  employeeId: string;
  horaEntrada: Date | null;
  horaSalida: Date | null;
  horasTrabajadas: number;
  falta: boolean;
  tardanzaMinutos: number;
  justificado: boolean;
}

/** Fila mínima de horas_extra que consume este servicio. */
interface HorasExtraRow {
  id: string;
  employeeId: string;
  horasCalculadas: number;
}

function redondear2(valor: number): number {
  return Math.round(valor * 100) / 100;
}

/**
 * Rango [primer día, último día] del período 'YYYY-MM' en UTC
 * (la columna `fecha` es @db.Date, sin componente horario).
 */
function rangoPeriodo(periodo: string): { gte: Date; lte: Date } {
  const [anio = 0, mes = 0] = periodo.split('-').map(Number);
  return {
    gte: new Date(Date.UTC(anio, mes - 1, 1)),
    // Día 0 del mes siguiente = último día del mes del período
    lte: new Date(Date.UTC(anio, mes, 0)),
  };
}

/**
 * Exportador de asistencia hacia nómina (integración Fase 2 → Fase 1).
 *
 * Patrón PayrollRunService: recibe el cliente transaccional (tx) como
 * parámetro para participar de la transacción/contexto RLS del llamador.
 * No contiene lógica de cálculo propia: HC y tramos de recargo viven en los
 * calculadores puros de ./calculators.
 */
@Injectable()
export class PayrollAttendanceExporterService {
  /**
   * HC (horas computables) del período por empleado, a partir de
   * asistencia_resumen: las faltas justificadas computan la jornada oficial
   * y las injustificadas no suman (regla en calcularHorasComputables).
   *
   * @param horasJornada jornada oficial diaria usada para valorizar faltas
   * justificadas; por defecto la jornada máxima legal (D.Leg. 854: 8h),
   * parametrizable por tenant/convenio.
   */
  async exportarHorasComputables(
    tx: any,
    periodo: string,
    horasJornada: number = JORNADA_MAXIMA_DIARIA_LEGAL,
  ): Promise<Map<string, HorasComputablesEmpleado>> {
    const resumenes: AsistenciaResumenRow[] = await tx.asistenciaResumen.findMany({
      where: { fecha: rangoPeriodo(periodo) },
    });

    // Agrupar resúmenes diarios por empleado
    const porEmpleado = new Map<string, AsistenciaResumenRow[]>();
    for (const resumen of resumenes) {
      const lista = porEmpleado.get(resumen.employeeId) ?? [];
      lista.push(resumen);
      porEmpleado.set(resumen.employeeId, lista);
    }

    const resultado = new Map<string, HorasComputablesEmpleado>();
    for (const [employeeId, filas] of porEmpleado) {
      // Adaptar la fila desnormalizada al contrato ResumenDia del calculador puro
      const dias: ResumenDia[] = filas.map((fila) => ({
        horaEntrada: fila.horaEntrada,
        horaSalida: fila.horaSalida,
        horasTrabajadas: fila.horasTrabajadas,
        falta: fila.falta,
        tardanzaMinutos: fila.tardanzaMinutos,
        justificado: fila.justificado,
        justificacionId: null,
        inconsistente: false,
      }));

      const hc = calcularHorasComputables(dias, horasJornada);
      resultado.set(employeeId, {
        horasComputables: hc.horasComputables,
        faltasInjustificadas: hc.faltasInjustificadas,
        tardanzasMinutos: filas.reduce((total, fila) => total + fila.tardanzaMinutos, 0),
      });
    }

    return resultado;
  }

  /**
   * Horas extra del período pendientes de nómina, repartidas por tramo de
   * recargo (D.Leg. 854: primeras 2h del día al 25%, siguientes al 35%).
   * El tramo se aplica por registro diario (así lo exige la norma: el corte
   * de 2 horas es por jornada, no acumulado del mes). Marca los registros
   * consumidos con incluido_en_nomina = true dentro de la misma transacción.
   *
   * @param recargoParams tramos/tasas de sobretiempo; por defecto los mínimos
   * legales, parametrizable por convenio más favorable.
   */
  async exportarHorasExtra(
    tx: any,
    periodo: string,
    recargoParams: RecargoParams = TASAS_RECARGO_DLEG_854,
  ): Promise<Map<string, HorasExtraEmpleado>> {
    const registros: HorasExtraRow[] = await tx.horasExtra.findMany({
      where: {
        incluidoEnNomina: false,
        fecha: rangoPeriodo(periodo),
      },
    });

    const resultado = new Map<string, HorasExtraEmpleado>();
    if (registros.length === 0) {
      return resultado;
    }

    for (const registro of registros) {
      // Solo interesa la partición de horas por tramo: valorHora = 1 (la
      // valorización monetaria la hace nómina con el valor hora del contrato)
      const recargo = calcularRecargo(registro.horasCalculadas, 1, recargoParams);

      const acumulado = resultado.get(registro.employeeId) ?? { horas25: 0, horas35: 0 };
      acumulado.horas25 = redondear2(acumulado.horas25 + recargo.horasPrimerTramo);
      acumulado.horas35 = redondear2(acumulado.horas35 + recargo.horasSegundoTramo);
      resultado.set(registro.employeeId, acumulado);
    }

    // Marcar como consumidos por nómina (misma transacción del llamador)
    await tx.horasExtra.updateMany({
      where: { id: { in: registros.map((registro) => registro.id) } },
      data: { incluidoEnNomina: true },
    });

    return resultado;
  }
}
