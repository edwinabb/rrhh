import { BadRequestException, Injectable } from '@nestjs/common';

/**
 * Importación de novedades de planilla por CSV (Fase 1).
 *
 * Formato del CSV (separador coma, encoding UTF-8, decimales con punto):
 *
 *   numero_documento,dias_laborados,horas_extra_25,horas_extra_35,bonificaciones,descuentos
 *   45678901,30,4,0,250.00,0
 *
 * - numero_documento: documento del trabajador (resuelto dentro del tenant).
 * - dias_laborados: entero 0-31; vacío = null (sin prorrateo, mes completo).
 * - horas_extra_25 / horas_extra_35: horas de sobretiempo al 25% / 35% (>= 0).
 * - bonificaciones / descuentos: montos en soles (>= 0).
 *
 * El parser es propio (sin dependencias): tolera CRLF, BOM UTF-8, líneas
 * vacías y campos entrecomillados simples ("..."). La validación es POR FILA:
 * una fila inválida se acumula en `errores` y NO persiste, pero no aborta el
 * import del resto. Persistencia por upsert sobre (tenantId, employeeId,
 * periodo): re-importar actualiza, nunca duplica.
 */

export interface ErrorFilaImport {
  fila: number;
  mensaje: string;
}

export interface ReporteImport {
  procesadas: number;
  omitidas: number;
  errores: ErrorFilaImport[];
}

const CABECERA = [
  'numero_documento',
  'dias_laborados',
  'horas_extra_25',
  'horas_extra_35',
  'bonificaciones',
  'descuentos',
] as const;

const BOM = '﻿';

/** Divide una línea CSV por comas respetando campos entre comillas dobles simples. */
function dividirLineaCsv(linea: string): string[] {
  const campos: string[] = [];
  let actual = '';
  let entreComillas = false;
  for (let i = 0; i < linea.length; i++) {
    const ch = linea[i];
    if (ch === '"') {
      entreComillas = !entreComillas;
    } else if (ch === ',' && !entreComillas) {
      campos.push(actual.trim());
      actual = '';
    } else {
      actual += ch;
    }
  }
  campos.push(actual.trim());
  return campos;
}

/** Número >= 0 con punto decimal; campo vacío = default. Lanza con mensaje si es inválido. */
function parseDecimalNoNegativo(valor: string, nombre: string, porDefecto = 0): number {
  if (valor === '') return porDefecto;
  const n = Number(valor);
  if (!Number.isFinite(n)) {
    throw new Error(`${nombre} no es un número válido: "${valor}"`);
  }
  if (n < 0) {
    throw new Error(`${nombre} no puede ser negativo: ${n}`);
  }
  return n;
}

@Injectable()
export class PayrollImportService {
  /** Plantilla descargable: BOM UTF-8 (para Excel) + cabecera + 2 filas de ejemplo. */
  generarPlantilla(): string {
    return (
      BOM +
      CABECERA.join(',') +
      '\n' +
      '45678901,30,4,0,250.00,0\n' +
      '41234567,28,0,2.5,0,100.00\n'
    );
  }

  /**
   * Importa el CSV de novedades para un período YYYY-MM. Valida fila por fila
   * (los errores se acumulan, no abortan) y hace upsert de PlanillaNovedad por
   * (tenantId, employeeId, periodo). La fila con error no persiste.
   */
  async importarCsv(tx: any, periodo: string, contenidoCsv: string): Promise<ReporteImport> {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(periodo)) {
      throw new BadRequestException(`Período inválido: "${periodo}" (formato esperado YYYY-MM)`);
    }
    if (typeof contenidoCsv !== 'string' || contenidoCsv.trim() === '') {
      throw new BadRequestException('El contenido CSV está vacío');
    }

    // Tolerar BOM y CRLF; conservar el índice real de línea para reportar la fila.
    const lineas = contenidoCsv.replace(BOM, '').split(/\r?\n/);

    const errores: ErrorFilaImport[] = [];
    let procesadas = 0;

    // Fila 1: cabecera obligatoria.
    const cabecera = dividirLineaCsv(lineas[0] ?? '').map((c) => c.toLowerCase());
    if (CABECERA.some((esperada, i) => cabecera[i] !== esperada)) {
      throw new BadRequestException(
        `Cabecera inválida. Se esperaba: ${CABECERA.join(',')}`,
      );
    }

    for (let i = 1; i < lineas.length; i++) {
      const fila = i + 1; // 1-based, contando la cabecera
      const linea = (lineas[i] ?? '').trim();
      if (linea === '') continue; // líneas vacías (p.ej. final del archivo) se ignoran

      try {
        const campos = dividirLineaCsv(linea);
        if (campos.length !== CABECERA.length) {
          throw new Error(
            `Se esperaban ${CABECERA.length} columnas y se encontraron ${campos.length}`,
          );
        }

        const [documento = '', diasRaw = '', he25Raw = '', he35Raw = '', bonifRaw = '', descRaw = ''] =
          campos;

        if (documento === '') {
          throw new Error('numero_documento vacío');
        }

        let diasLaborados: number | null = null;
        if (diasRaw !== '') {
          const dias = Number(diasRaw);
          if (!Number.isInteger(dias) || dias < 0 || dias > 31) {
            throw new Error(`dias_laborados debe ser un entero entre 0 y 31: "${diasRaw}"`);
          }
          diasLaborados = dias;
        }

        const horasExtra25 = parseDecimalNoNegativo(he25Raw, 'horas_extra_25');
        const horasExtra35 = parseDecimalNoNegativo(he35Raw, 'horas_extra_35');
        const bonificaciones = parseDecimalNoNegativo(bonifRaw, 'bonificaciones');
        const descuentos = parseDecimalNoNegativo(descRaw, 'descuentos');

        // Resolución del trabajador por documento dentro del tenant (RLS ya
        // acota la sesión al tenant de la request).
        const empleado = await tx.employee.findFirst({
          where: { numeroDocumento: documento },
        });
        if (!empleado) {
          throw new Error(`No existe trabajador con documento ${documento} en el tenant`);
        }

        const valores = {
          diasLaborados,
          horasExtra25,
          horasExtra35,
          bonificaciones,
          descuentos,
          fuente: 'csv',
        };
        await tx.planillaNovedad.upsert({
          where: {
            tenantId_employeeId_periodo: {
              tenantId: empleado.tenantId,
              employeeId: empleado.id,
              periodo,
            },
          },
          update: valores,
          create: {
            tenantId: empleado.tenantId,
            employeeId: empleado.id,
            periodo,
            ...valores,
          },
        });
        procesadas++;
      } catch (error) {
        errores.push({ fila, mensaje: (error as Error).message });
      }
    }

    return { procesadas, omitidas: errores.length, errores };
  }
}
