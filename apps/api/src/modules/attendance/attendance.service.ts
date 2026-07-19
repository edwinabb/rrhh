import { Injectable } from '@nestjs/common';
import {
  validarMarcacion,
  ConfigValidacionMarcacion,
  TipoMarcacion,
} from './calculators/marcacion.calculator';
import {
  construirResumenDia,
  MarcacionDia,
  ConfiguracionResumenDia,
} from './calculators/asistencia-resumen.calculator';
import {
  calcularHorasExtraDiarias,
  JORNADA_MAXIMA_DIARIA_LEGAL,
} from './calculators/horas-extra.calculator';
import { TurnoRecalculoService } from './turno-recalculo.service';

export interface RegistrarMarcacionInput {
  tenantId: string;
  employeeId: string;
  sedeId: string;
  tipo: TipoMarcacion; // 'ENTRADA' | 'SALIDA'
  timestamp: Date;
  latitud?: number;
  longitud?: number;
  scoreBiometria?: number;
  tipoIdentificacion?: string;
  dispositivoId?: string;
  /** User id que registra la marcación (audit trail inmutable). */
  creadoPor: string;
}

export interface CrearJustificacionInput {
  tenantId: string;
  employeeId: string;
  marcacionId?: string;
  motivo: string; // enum MotivoJustificacion
  fecha: Date;
  descripcion: string;
  documentoUrl?: string;
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

/**
 * Orquestador del módulo de asistencia (Fase 2). Mismo patrón que
 * PayrollRunService: cada método recibe el cliente/tx de Prisma como
 * parámetro (el controller decide la transacción) y toda la lógica de
 * negocio vive en los calculadores puros de ./calculators — aquí solo
 * se lee contexto, se invocan calculadores y se persiste el resultado.
 *
 * Principio append-only (SUNAFIL): las marcaciones SOLO se crean, nunca
 * se actualizan. Un intento inválido se persiste con bloqueado=true como
 * evidencia de auditoría, y no altera el resumen diario ni las horas extra.
 */
@Injectable()
export class AttendanceService {
  constructor(private readonly turnoRecalculo?: TurnoRecalculoService) {}

  /**
   * Registra una marcación de ENTRADA/SALIDA:
   * 1. Lee ConfiguracionAsistencia del tenant y el Geofence activo de la sede.
   * 2. Lee las marcaciones previas del día para derivar la secuencia
   *    (¿hay ENTRADA sin SALIDA pendiente?).
   * 3. Valida con el calculador puro (geofence, biometría, secuencia, tardanza).
   * 4. Persiste la marcación (create, nunca update). Si quedó bloqueada,
   *    termina ahí (registro de auditoría del intento).
   * 5. Si es SALIDA válida: recalcula el AsistenciaResumen del día (upsert)
   *    e inserta HorasExtra DIARIAS si excede la jornada.
   */
  async registrarMarcacion(tx: any, input: RegistrarMarcacionInput) {
    const { tenantId, employeeId, sedeId } = input;

    // 1. Configuración del tenant (obligatoria)
    const config = await tx.configuracionAsistencia.findUnique({
      where: { tenantId },
    });
    if (!config) {
      throw new Error(
        `Configuración de asistencia no encontrada para el tenant ${tenantId}`,
      );
    }

    // 2. Geofence activo de la sede (puede no existir si el tenant no lo exige)
    const geofence = await tx.geofence.findFirst({
      where: { tenantId, sedeId, activo: true },
    });

    // 3. Marcaciones previas (no bloqueadas) del día para derivar la secuencia
    const marcacionesPrevias = await tx.marcacion.findMany({
      where: {
        tenantId,
        employeeId,
        bloqueado: false,
        tipo: { in: ['ENTRADA', 'SALIDA'] },
        timestamp: { gte: inicioDelDia(input.timestamp), lte: finDelDia(input.timestamp) },
      },
      orderBy: { timestamp: 'asc' },
    });

    const entradas = marcacionesPrevias.filter((m: any) => m.tipo === 'ENTRADA').length;
    const salidas = marcacionesPrevias.filter((m: any) => m.tipo === 'SALIDA').length;
    const tieneEntradaPendiente = entradas > salidas;

    // 4. Validación pura (todos los umbrales vienen de la config del tenant)
    const configValidacion: ConfigValidacionMarcacion = {
      requiereGeofencing: config.requiereGeofence,
      // El schema aún no modela esta opción por tenant: por defecto, fuera
      // del geofence bloquea (comportamiento más estricto).
      permitirFueraGeofence: config.permitirFueraGeofence ?? false,
      requiereBiometria: config.requiereBiometria,
      umbralConfianzaBiometria: config.umbralConfianzaBiometria,
      horaEntradaEstandar: config.horaEntradaEstandar,
      toleranciaMinutos: config.toleranciaTardanzaMinutos,
    };

    const validacion = validarMarcacion({
      tipo: input.tipo,
      timestamp: input.timestamp,
      latitud: input.latitud,
      longitud: input.longitud,
      scoreBiometria: input.scoreBiometria,
      tieneEntradaPendiente,
      geofence: geofence
        ? {
            latitud: geofence.latitud,
            longitud: geofence.longitud,
            radioMetros: geofence.radioMetros,
          }
        : undefined,
      config: configValidacion,
    });

    // 5. Persistir SIEMPRE (append-only): el intento bloqueado queda como
    //    evidencia de auditoría con su motivo, nunca se edita después.
    const marcacion = await tx.marcacion.create({
      data: {
        tenantId,
        employeeId,
        sedeId,
        tipo: input.tipo,
        timestamp: input.timestamp,
        latitud: input.latitud,
        longitud: input.longitud,
        distanciaSedeMetros: validacion.distanciaMetros,
        ubicacionValidada: validacion.ubicacionValidada,
        tipoIdentificacion: input.tipoIdentificacion,
        scoreBiometria: input.scoreBiometria,
        dispositivoId: input.dispositivoId,
        bloqueado: validacion.bloqueado,
        motivoBloqueo: validacion.motivoBloqueo,
        requiereAutorizacion: validacion.requiereAutorizacion,
        creadoPor: input.creadoPor,
      },
    });

    // Una marcación bloqueada no participa del resumen ni de horas extra
    if (validacion.bloqueado) {
      return marcacion;
    }

    // 6. SALIDA válida → recálculo. Primero el flujo de turnos (fecha de
    //    turno); si el empleado no tiene plan, el flujo estándar de siempre.
    if (input.tipo === 'SALIDA') {
      const manejadoPorTurno = this.turnoRecalculo
        ? await this.turnoRecalculo.recalcularConTurno(
            tx, tenantId, employeeId, input.timestamp, config,
          )
        : false;
      if (!manejadoPorTurno) {
        await this.recalcularResumenDelDia(
          tx,
          tenantId,
          employeeId,
          input.timestamp,
          config,
          [...marcacionesPrevias, marcacion],
        );
      }
    }

    return marcacion;
  }

  /** Crea una Justificacion en estado PENDIENTE (flujo de aprobación aparte). */
  async crearJustificacion(tx: any, input: CrearJustificacionInput) {
    return tx.justificacion.create({
      data: {
        tenantId: input.tenantId,
        employeeId: input.employeeId,
        marcacionId: input.marcacionId,
        motivo: input.motivo,
        fecha: inicioDelDia(input.fecha),
        descripcion: input.descripcion,
        documentoUrl: input.documentoUrl,
        estado: 'PENDIENTE',
      },
    });
  }

  /**
   * Resuelve una justificación: transición PENDIENTE → APROBADA/RECHAZADA.
   * - Rechazar exige motivoRechazo (trazabilidad para el trabajador).
   * - Aprobar marca justificado=true (y falta=false) en el AsistenciaResumen
   *   de esa fecha; si el resumen no existe aún (falta sin marcaciones),
   *   se crea con la justificación aplicada.
   */
  async resolverJustificacion(
    tx: any,
    id: string,
    aprobar: boolean,
    aprobadoPor: string,
    motivoRechazo?: string,
  ) {
    const justificacion = await tx.justificacion.findUnique({ where: { id } });
    if (!justificacion) {
      throw new Error(`Justificación no encontrada: ${id}`);
    }
    if (justificacion.estado !== 'PENDIENTE') {
      throw new Error(
        `Solo se puede resolver una justificación PENDIENTE (estado actual: ${justificacion.estado})`,
      );
    }
    if (!aprobar && !motivoRechazo) {
      throw new Error('Rechazar una justificación requiere motivo de rechazo');
    }

    const actualizada = await tx.justificacion.update({
      where: { id },
      data: {
        estado: aprobar ? 'APROBADA' : 'RECHAZADA',
        aprobadoPor,
        aprobadoEn: new Date(),
        motivoRechazo: aprobar ? null : motivoRechazo,
      },
    });

    if (aprobar) {
      const fecha = inicioDelDia(justificacion.fecha);
      await tx.asistenciaResumen.upsert({
        where: {
          tenantId_employeeId_fecha: {
            tenantId: justificacion.tenantId,
            employeeId: justificacion.employeeId,
            fecha,
          },
        },
        update: { justificado: true, falta: false },
        create: {
          tenantId: justificacion.tenantId,
          employeeId: justificacion.employeeId,
          fecha,
          horasTrabajadas: 0,
          horasExtrasDiarias: 0,
          falta: false,
          tardanzaMinutos: 0,
          justificado: true,
        },
      });
    }

    return actualizada;
  }

  /**
   * Recalcula el AsistenciaResumen (upsert) del día a partir de todas las
   * marcaciones válidas, e inserta/actualiza HorasExtra DIARIAS si las horas
   * trabajadas exceden la jornada máxima diaria (D.Leg. 854 por defecto).
   */
  private async recalcularResumenDelDia(
    tx: any,
    tenantId: string,
    employeeId: string,
    fechaReferencia: Date,
    config: any,
    marcacionesDelDia: Array<{ tipo: string; timestamp: Date }>,
  ) {
    const fecha = inicioDelDia(fechaReferencia);

    // Justificación aprobada de esa fecha (si existe) para el flag del resumen
    const justificacionAprobada = await tx.justificacion.findFirst({
      where: { tenantId, employeeId, fecha, estado: 'APROBADA' },
    });

    const configResumen: ConfiguracionResumenDia = {
      horaInicioDia: config.horaEntradaEstandar,
      minutosToleranciaEntrada: config.toleranciaTardanzaMinutos,
      horasJornada: config.horasJornada ?? JORNADA_MAXIMA_DIARIA_LEGAL,
    };

    const marcaciones: MarcacionDia[] = marcacionesDelDia.map((m) => ({
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

    // Horas extra diarias: solo si hay exceso sobre la jornada
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
