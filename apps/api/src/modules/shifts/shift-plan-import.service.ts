import { Injectable } from '@nestjs/common';
import { ShiftPlanService, TipoDiaPlan } from './shift-plan.service';

export interface ErrorFilaImport {
  fila: number;
  mensaje: string;
}

export interface ResultadoImportPlan {
  procesadas: number;
  omitidas: number;
  errores: ErrorFilaImport[];
}

const HEADER = 'numero_documento,fecha,turno';
const FECHA_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const BOM = '﻿';

/**
 * Import del plan de turnos por CSV (spec §5): `numero_documento,fecha,turno`
 * donde turno = código del catálogo, DESCANSO o COMPENSATORIO. Upsert por
 * fila (re-importar actualiza), errores por fila sin abortar — mismo patrón
 * que AttendanceImportService.
 */
@Injectable()
export class ShiftPlanImportService {
  constructor(private readonly shiftPlan: ShiftPlanService) {}

  generarPlantilla(): string {
    return (
      BOM +
      [
        HEADER,
        '45678901,2026-08-01,DIA',
        '45678901,2026-08-02,NOCHE',
        '45678901,2026-08-03,DESCANSO',
        '45678901,2026-08-04,COMPENSATORIO',
      ].join('\r\n') +
      '\r\n'
    );
  }

  async importarCsv(
    tx: any,
    contenidoCsv: string,
    tenantId: string,
    creadoPor: string,
  ): Promise<ResultadoImportPlan> {
    const resultado: ResultadoImportPlan = { procesadas: 0, omitidas: 0, errores: [] };
    const turnos = await tx.turno.findMany({ where: { activo: true } });
    const turnosPorCodigo = new Map<string, any>(turnos.map((t: any) => [t.codigo, t]));
    const empleadosPorDocumento = new Map<string, any | null>();

    const lineas = contenidoCsv.replace(/^﻿/, '').split(/\r?\n/);
    for (let i = 0; i < lineas.length; i++) {
      const numeroFila = i + 1;
      const linea = (lineas[i] ?? '').trim();
      if (linea === '') continue;

      const campos = linea.split(',').map((c) => c.trim());
      if (campos[0]?.toLowerCase() === 'numero_documento') continue;

      if (campos.length !== 3) {
        resultado.errores.push({ fila: numeroFila, mensaje: `Se esperaban 3 columnas y llegaron ${campos.length}` });
        continue;
      }
      const [numeroDocumento = '', fechaStr = '', turnoStr = ''] = campos;

      if (!FECHA_REGEX.test(fechaStr)) {
        resultado.errores.push({ fila: numeroFila, mensaje: `Fecha inválida: "${fechaStr}" (YYYY-MM-DD)` });
        continue;
      }
      const [anio = 0, mes = 0, dia = 0] = fechaStr.split('-').map(Number);
      const fecha = new Date(anio, mes - 1, dia);
      if (fecha.getFullYear() !== anio || fecha.getMonth() !== mes - 1 || fecha.getDate() !== dia) {
        resultado.errores.push({ fila: numeroFila, mensaje: `Fecha inexistente: "${fechaStr}"` });
        continue;
      }

      if (!empleadosPorDocumento.has(numeroDocumento)) {
        empleadosPorDocumento.set(
          numeroDocumento,
          await tx.employee.findFirst({ where: { numeroDocumento } }),
        );
      }
      const employee = empleadosPorDocumento.get(numeroDocumento);
      if (!employee) {
        resultado.errores.push({ fila: numeroFila, mensaje: `Trabajador con documento "${numeroDocumento}" no encontrado` });
        continue;
      }

      let tipoDia: TipoDiaPlan;
      let turnoId: string | undefined;
      const clave = turnoStr.toUpperCase();
      if (clave === 'DESCANSO') {
        tipoDia = 'DESCANSO';
      } else if (clave === 'COMPENSATORIO') {
        tipoDia = 'DESCANSO_COMPENSATORIO';
      } else {
        const turno = turnosPorCodigo.get(clave);
        if (!turno) {
          resultado.errores.push({ fila: numeroFila, mensaje: `Turno inexistente o inactivo: "${turnoStr}"` });
          continue;
        }
        tipoDia = 'TURNO';
        turnoId = turno.id;
      }

      try {
        await this.shiftPlan.upsertAsignacion(tx, {
          tenantId,
          employeeId: employee.id,
          fecha,
          tipoDia,
          turnoId,
          creadoPor,
          forzarSinSaldo: false,
        });
        resultado.procesadas += 1;
      } catch (error) {
        resultado.errores.push({ fila: numeroFila, mensaje: (error as Error).message });
      }
    }
    return resultado;
  }
}
