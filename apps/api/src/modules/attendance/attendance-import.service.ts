import { Injectable } from '@nestjs/common';
import {
  construirResumenDia,
  ConfiguracionResumenDia,
  MarcacionDia,
} from './calculators/asistencia-resumen.calculator';
import {
  calcularHorasExtraDiarias,
  JORNADA_MAXIMA_DIARIA_LEGAL,
} from './calculators/horas-extra.calculator';
import { TurnoRecalculoService } from './turno-recalculo.service';

/**
 * Import de marcaciones de asistencia desde un sistema biométrico externo
 * (reloj marcador) vía archivo CSV.
 *
 * FORMATO CSV (separador coma, encoding UTF-8, BOM tolerado, CRLF tolerado):
 *
 *   numero_documento,fecha,hora,tipo
 *   45678901,2026-07-01,08:02,ENTRADA
 *   45678901,2026-07-01,17:35,SALIDA
 *
 * - numero_documento: documento del trabajador (resolución de Employee dentro
 *   del tenant por numeroDocumento).
 * - fecha: YYYY-MM-DD. hora: HH:mm (24h). tipo: ENTRADA | SALIDA.
 * - Columna 5 opcional: tipo_identificacion (HUELLA | FACIAL | PIN | MANUAL |
 *   QR). Default: HUELLA (origen típico: reloj biométrico de huella).
 * - Campos con comillas dobles simples soportados ("valor, con coma").
 *
 * Reglas:
 * - Validación POR FILA: un error no aborta el import — se acumula en
 *   `errores` (con el número de línea del archivo, 1-based) y la fila no
 *   persiste. Se retorna { procesadas, omitidas, errores }.
 * - DEDUP: si ya existe una marcación del mismo employee+timestamp+tipo, la
 *   fila se cuenta como omitida (permite re-importar el mismo archivo sin
 *   duplicar — el import es idempotente).
 * - Append-only (SUNAFIL): las marcaciones solo se crean, nunca se editan.
 *   Al no haber GPS en un import, ubicacionValidada = false y sin bloqueo.
 * - Tras procesar todas las filas, por cada (employee, fecha) afectado que
 *   tenga ENTRADA y SALIDA se recalcula el AsistenciaResumen (upsert con
 *   construirResumenDia) y las HorasExtra DIARIAS (upsert con
 *   calcularHorasExtraDiarias) — mismo mapeo que AttendanceService.
 */

export interface ErrorFilaImport {
  /** Número de línea en el archivo (1-based, contando el header). */
  fila: number;
  mensaje: string;
}

export interface ResultadoImport {
  /** Filas válidas persistidas como Marcacion. */
  procesadas: number;
  /** Filas duplicadas (ya existía employee+timestamp+tipo). */
  omitidas: number;
  /** Errores por fila (la fila con error no persiste). */
  errores: ErrorFilaImport[];
}

const TIPOS_MARCACION = ['ENTRADA', 'SALIDA'] as const;
const TIPOS_IDENTIFICACION = ['HUELLA', 'FACIAL', 'PIN', 'MANUAL', 'QR'] as const;
const TIPO_IDENTIFICACION_DEFAULT = 'HUELLA';

const HEADER_PLANTILLA = 'numero_documento,fecha,hora,tipo';
const BOM = '﻿';

const FECHA_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const HORA_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * Parsea una línea CSV separada por comas, con soporte de campos entre
 * comillas dobles simples ("valor, con coma" y "" como comilla escapada).
 * Parser manual: el proyecto no admite dependencias npm nuevas.
 */
function parsearLineaCsv(linea: string): string[] {
  const campos: string[] = [];
  let actual = '';
  let entreComillas = false;

  for (let i = 0; i < linea.length; i++) {
    const caracter = linea[i];
    if (entreComillas) {
      if (caracter === '"') {
        if (linea[i + 1] === '"') {
          actual += '"'; // comilla escapada ("")
          i++;
        } else {
          entreComillas = false;
        }
      } else {
        actual += caracter;
      }
    } else if (caracter === '"') {
      entreComillas = true;
    } else if (caracter === ',') {
      campos.push(actual.trim());
      actual = '';
    } else {
      actual += caracter;
    }
  }
  campos.push(actual.trim());
  return campos;
}

/**
 * Combina fecha (YYYY-MM-DD) y hora (HH:mm) en un Date local, o null si el
 * formato es inválido o la fecha no existe en el calendario (ej. 2026-13-45).
 */
function parsearTimestamp(fecha: string, hora: string): Date | null {
  if (!FECHA_REGEX.test(fecha) || !HORA_REGEX.test(hora)) {
    return null;
  }
  const [anio = 0, mes = 0, dia = 0] = fecha.split('-').map(Number);
  const [horas = 0, minutos = 0] = hora.split(':').map(Number);
  const timestamp = new Date(anio, mes - 1, dia, horas, minutos, 0, 0);
  // Date normaliza desbordes (mes 13 → enero siguiente): se rechazan
  if (
    timestamp.getFullYear() !== anio ||
    timestamp.getMonth() !== mes - 1 ||
    timestamp.getDate() !== dia
  ) {
    return null;
  }
  return timestamp;
}

/** Inicio del día (00:00:00.000 local) de la fecha dada. */
function inicioDelDia(fecha: Date): Date {
  const d = new Date(fecha);
  d.setHours(0, 0, 0, 0);
  return d;
}

/** Fin del día (23:59:59.999 local) de la fecha dada. */
function finDelDia(fecha: Date): Date {
  const d = new Date(fecha);
  d.setHours(23, 59, 59, 999);
  return d;
}

@Injectable()
export class AttendanceImportService {
  constructor(private readonly turnoRecalculo?: TurnoRecalculoService) {}

  /**
   * Plantilla CSV descargable: BOM UTF-8 (para que Excel detecte el
   * encoding) + header + 2 filas de ejemplo. CRLF para compatibilidad Excel.
   */
  generarPlantilla(): string {
    return (
      BOM +
      [
        HEADER_PLANTILLA,
        '45678901,2026-07-01,08:02,ENTRADA',
        '45678901,2026-07-01,17:35,SALIDA',
      ].join('\r\n') +
      '\r\n'
    );
  }

  /**
   * Importa el contenido de un CSV de marcaciones (ver formato en el
   * docstring del módulo). Validación por fila sin abortar; dedup por
   * employee+timestamp+tipo; al final recalcula resumen y horas extra
   * diarias de cada (employee, fecha) afectado que tenga ENTRADA y SALIDA.
   *
   * @param tx        Cliente/tx de Prisma con RLS del tenant (ctx.tx).
   * @param contenidoCsv Contenido completo del archivo CSV.
   * @param creadoPor User id que ejecuta el import (audit trail inmutable).
   */
  async importarCsv(
    tx: any,
    contenidoCsv: string,
    creadoPor: string,
  ): Promise<ResultadoImport> {
    // Configuración del tenant (obligatoria): el tx ya está acotado al
    // tenant por RLS, y de aquí sale el tenantId para las escrituras.
    const config = await tx.configuracionAsistencia.findFirst();
    if (!config) {
      throw new Error('Configuración de asistencia no encontrada para el tenant');
    }
    const tenantId: string = config.tenantId;

    const resultado: ResultadoImport = { procesadas: 0, omitidas: 0, errores: [] };

    // Cache de empleados por documento (evita repetir findFirst por fila)
    const empleadosPorDocumento = new Map<string, any | null>();
    // Días afectados a recalcular: clave employeeId|YYYY-MM-DD
    const diasAfectados = new Map<string, { employeeId: string; fecha: Date; timestampEjemplo: Date }>();

    const lineas = contenidoCsv.replace(/^﻿/, '').split(/\r?\n/);

    for (let i = 0; i < lineas.length; i++) {
      const numeroFila = i + 1; // línea del archivo, 1-based (incluye header)
      const linea = (lineas[i] ?? '').trim();
      if (linea === '') {
        continue; // líneas vacías (incluida la final) se ignoran
      }

      const campos = parsearLineaCsv(linea);

      // Header (primera columna literal del formato): se ignora
      if (campos[0]?.toLowerCase() === 'numero_documento') {
        continue;
      }

      if (campos.length < 4 || campos.length > 5) {
        resultado.errores.push({
          fila: numeroFila,
          mensaje: `Número de columnas inválido: se esperaban 4 o 5 y llegaron ${campos.length}`,
        });
        continue;
      }

      const [numeroDocumento = '', fecha = '', hora = '', tipo = ''] = campos;
      const tipoIdentificacion = campos[4] || TIPO_IDENTIFICACION_DEFAULT;

      if (!numeroDocumento) {
        resultado.errores.push({ fila: numeroFila, mensaje: 'numero_documento vacío' });
        continue;
      }

      const timestamp = parsearTimestamp(fecha, hora);
      if (!timestamp) {
        resultado.errores.push({
          fila: numeroFila,
          mensaje: `Fecha u hora inválida: "${fecha}" "${hora}" (formatos: YYYY-MM-DD y HH:mm)`,
        });
        continue;
      }

      if (!TIPOS_MARCACION.includes(tipo as any)) {
        resultado.errores.push({
          fila: numeroFila,
          mensaje: `Tipo de marcación inválido: "${tipo}" (válidos: ${TIPOS_MARCACION.join(', ')})`,
        });
        continue;
      }

      if (!TIPOS_IDENTIFICACION.includes(tipoIdentificacion as any)) {
        resultado.errores.push({
          fila: numeroFila,
          mensaje: `Tipo de identificación inválido: "${tipoIdentificacion}" (válidos: ${TIPOS_IDENTIFICACION.join(', ')})`,
        });
        continue;
      }

      // Resolución del trabajador por documento dentro del tenant (RLS)
      if (!empleadosPorDocumento.has(numeroDocumento)) {
        empleadosPorDocumento.set(
          numeroDocumento,
          await tx.employee.findFirst({ where: { numeroDocumento } }),
        );
      }
      const employee = empleadosPorDocumento.get(numeroDocumento);
      if (!employee) {
        resultado.errores.push({
          fila: numeroFila,
          mensaje: `Trabajador con documento "${numeroDocumento}" no encontrado en el tenant`,
        });
        continue;
      }

      // DEDUP: mismo employee+timestamp+tipo ya registrado → omitida
      const duplicada = await tx.marcacion.findFirst({
        where: { tenantId, employeeId: employee.id, timestamp, tipo },
      });
      if (duplicada) {
        resultado.omitidas += 1;
        this.marcarDiaAfectado(diasAfectados, employee.id, timestamp);
        continue;
      }

      // Append-only: create, nunca update. Import externo = sin GPS →
      // ubicacionValidada=false; sin bloqueo (el reloj ya validó identidad).
      await tx.marcacion.create({
        data: {
          tenantId,
          employeeId: employee.id,
          sedeId: employee.sedeId,
          tipo,
          timestamp,
          tipoIdentificacion,
          ubicacionValidada: false,
          bloqueado: false,
          creadoPor,
        },
      });
      resultado.procesadas += 1;
      this.marcarDiaAfectado(diasAfectados, employee.id, timestamp);
    }

    // Recalcular resumen + horas extra diarias de cada día afectado
    for (const { employeeId, fecha, timestampEjemplo } of diasAfectados.values()) {
      const manejadoPorTurno = this.turnoRecalculo
        ? await this.turnoRecalculo.recalcularConTurno(
            tx, tenantId, employeeId, timestampEjemplo, config,
          )
        : false;
      if (!manejadoPorTurno) {
        await this.recalcularResumenDelDia(tx, tenantId, employeeId, fecha, config);
      }
    }

    return resultado;
  }

  /** Registra el (employee, fecha) como pendiente de recálculo (dedup por día). */
  private marcarDiaAfectado(
    diasAfectados: Map<string, { employeeId: string; fecha: Date; timestampEjemplo: Date }>,
    employeeId: string,
    timestamp: Date,
  ): void {
    const fecha = inicioDelDia(timestamp);
    const clave = `${employeeId}|${fecha.toISOString()}`;
    if (!diasAfectados.has(clave)) {
      diasAfectados.set(clave, { employeeId, fecha, timestampEjemplo: timestamp });
    }
  }

  /**
   * Recalcula el AsistenciaResumen (upsert) del día con las marcaciones
   * válidas y upserta HorasExtra DIARIAS si hay exceso de jornada. Solo
   * actúa si el día tiene ENTRADA y SALIDA (un día a medias se resolverá
   * cuando llegue la contraparte, igual que en el flujo de marcación).
   * Mismo mapeo de campos que AttendanceService.recalcularResumenDelDia.
   */
  private async recalcularResumenDelDia(
    tx: any,
    tenantId: string,
    employeeId: string,
    fecha: Date,
    config: any,
  ): Promise<void> {
    const marcacionesDelDia = await tx.marcacion.findMany({
      where: {
        tenantId,
        employeeId,
        bloqueado: false,
        tipo: { in: ['ENTRADA', 'SALIDA'] },
        timestamp: { gte: inicioDelDia(fecha), lte: finDelDia(fecha) },
      },
      orderBy: { timestamp: 'asc' },
    });

    const tieneEntrada = marcacionesDelDia.some((m: any) => m.tipo === 'ENTRADA');
    const tieneSalida = marcacionesDelDia.some((m: any) => m.tipo === 'SALIDA');
    if (!tieneEntrada || !tieneSalida) {
      return;
    }

    const justificacionAprobada = await tx.justificacion.findFirst({
      where: { tenantId, employeeId, fecha, estado: 'APROBADA' },
    });

    const configResumen: ConfiguracionResumenDia = {
      horaInicioDia: config.horaEntradaEstandar,
      minutosToleranciaEntrada: config.toleranciaTardanzaMinutos,
      horasJornada: config.horasJornada ?? JORNADA_MAXIMA_DIARIA_LEGAL,
    };

    const marcaciones: MarcacionDia[] = marcacionesDelDia.map((m: any) => ({
      tipo: m.tipo as MarcacionDia['tipo'],
      timestampActual: m.timestamp,
    }));

    const resumen = construirResumenDia(
      marcaciones,
      configResumen,
      justificacionAprobada ? { id: justificacionAprobada.id } : undefined,
    );

    const datosResumen = {
      horaEntrada: resumen.horaEntrada,
      horaSalida: resumen.horaSalida,
      horasTrabajadas: resumen.horasTrabajadas,
      horasExtrasDiarias: calcularHorasExtraDiarias(
        resumen.horasTrabajadas,
        config.horasJornada ?? JORNADA_MAXIMA_DIARIA_LEGAL,
      ),
      falta: resumen.falta,
      tardanzaMinutos: resumen.tardanzaMinutos,
      justificado: resumen.justificado,
    };

    await tx.asistenciaResumen.upsert({
      where: { tenantId_employeeId_fecha: { tenantId, employeeId, fecha } },
      update: datosResumen,
      create: { tenantId, employeeId, fecha, ...datosResumen },
    });

    if (datosResumen.horasExtrasDiarias > 0) {
      await tx.horasExtra.upsert({
        where: {
          tenantId_employeeId_fecha_tipo: {
            tenantId,
            employeeId,
            fecha,
            tipo: 'DIARIAS',
          },
        },
        update: { horasCalculadas: datosResumen.horasExtrasDiarias },
        create: {
          tenantId,
          employeeId,
          fecha,
          tipo: 'DIARIAS',
          horasCalculadas: datosResumen.horasExtrasDiarias,
        },
      });
    }
  }
}
