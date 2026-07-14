/**
 * Calculador puro de marcaciones de asistencia (Fase 2).
 *
 * Valida una marcación (entrada/salida) contra:
 *  - Geofence de la sede (fórmula de Haversine).
 *  - Confianza biométrica (umbral configurable por tenant).
 *  - Secuencia lógica del día (ENTRADA sin salida pendiente; SALIDA con
 *    entrada previa).
 *  - Tardanza contra hora de entrada estándar + tolerancia del tenant.
 *
 * Todos los umbrales y parámetros normativos llegan como argumentos
 * (config del tenant) — nada hardcodeado. Sin side effects.
 * Ver docs/superpowers/specs/2026-07-14-fase2-asistencia-design.md, sección 3.1.
 */

export type TipoMarcacion = 'ENTRADA' | 'SALIDA';

export interface GeofenceParams {
  latitud: number;
  longitud: number;
  radioMetros: number;
}

/** Configuración de validación del tenant (ConfiguracionAsistencia). */
export interface ConfigValidacionMarcacion {
  requiereGeofencing: boolean;
  /** Si true, fuera del radio no bloquea: requiere autorización manual. */
  permitirFueraGeofence: boolean;
  requiereBiometria: boolean;
  /** Confianza mínima del match biométrico, 0.0 a 1.0 (ej. 0.8). */
  umbralConfianzaBiometria: number;
  /** Hora de entrada estándar en formato HH:mm (ej. "08:00"). */
  horaEntradaEstandar: string;
  /** Minutos de tolerancia antes de contar tardanza. */
  toleranciaMinutos: number;
}

export interface ValidarMarcacionInput {
  tipo: TipoMarcacion;
  timestamp: Date;
  latitud?: number;
  longitud?: number;
  /** Confianza del match biométrico, 0.0 a 1.0. */
  scoreBiometria?: number;
  /** true si existe una ENTRADA sin SALIDA registrada el mismo día. */
  tieneEntradaPendiente: boolean;
  geofence?: GeofenceParams;
  config: ConfigValidacionMarcacion;
}

export interface ResultadoValidacionMarcacion {
  /** true si la ubicación quedó validada dentro del geofence (o no aplica). */
  ubicacionValidada: boolean;
  /** Distancia a la sede en metros; null si no hubo coordenadas/geofence. */
  distanciaMetros: number | null;
  bloqueado: boolean;
  motivoBloqueo?: string;
  /** true si la marcación puede registrarse pero requiere autorización manual. */
  requiereAutorizacion: boolean;
  motivosAutorizacion: string[];
  /** Minutos de tardanza más allá de la tolerancia (solo ENTRADA; 0 si no aplica). */
  tardanzaMinutos: number;
}

/** Radio medio terrestre en metros (constante geodésica de Haversine). */
const RADIO_TIERRA_METROS = 6371000;

const gradosARadianes = (grados: number): number => (grados * Math.PI) / 180;

/**
 * Distancia en metros entre dos coordenadas GPS (fórmula de Haversine).
 * @pure
 */
export function distanciaMetros(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const deltaLat = gradosARadianes(lat2 - lat1);
  const deltaLng = gradosARadianes(lng2 - lng1);

  const a =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(gradosARadianes(lat1)) *
      Math.cos(gradosARadianes(lat2)) *
      Math.sin(deltaLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return RADIO_TIERRA_METROS * c;
}

/** Parsea "HH:mm" y lo proyecta sobre la fecha (local) del timestamp dado. */
function horaEnFechaDe(referencia: Date, horaHHmm: string): Date {
  const [horas = 0, minutos = 0] = horaHHmm.split(':').map(Number);
  const fecha = new Date(referencia);
  fecha.setHours(horas, minutos, 0, 0);
  return fecha;
}

/**
 * Calcula minutos de tardanza de una ENTRADA contra la hora estándar +
 * tolerancia del tenant. Dentro de la tolerancia (inclusive) → 0.
 * @pure
 */
function calcularTardanzaMinutos(
  timestamp: Date,
  horaEntradaEstandar: string,
  toleranciaMinutos: number,
): number {
  const horaEstandar = horaEnFechaDe(timestamp, horaEntradaEstandar);
  const limiteTolerancia = new Date(
    horaEstandar.getTime() + toleranciaMinutos * 60_000,
  );

  if (timestamp.getTime() <= limiteTolerancia.getTime()) {
    return 0;
  }
  return Math.ceil((timestamp.getTime() - limiteTolerancia.getTime()) / 60_000);
}

/**
 * Valida una marcación de asistencia. Sin side effects: toda la información
 * de contexto (config del tenant, geofence de la sede, estado de secuencia
 * del día) llega en el input.
 * @pure
 */
export function validarMarcacion(
  input: ValidarMarcacionInput,
): ResultadoValidacionMarcacion {
  const { config, geofence } = input;
  const motivosBloqueo: string[] = [];
  const motivosAutorizacion: string[] = [];

  // --- 1. Secuencia entrada/salida del día ---
  if (input.tipo === 'ENTRADA' && input.tieneEntradaPendiente) {
    motivosBloqueo.push(
      'Ya existe una entrada sin salida registrada el mismo día (doble ENTRADA)',
    );
  }
  if (input.tipo === 'SALIDA' && !input.tieneEntradaPendiente) {
    motivosBloqueo.push('SALIDA sin ENTRADA previa registrada el mismo día');
  }

  // --- 2. Geofencing ---
  let ubicacionValidada = !config.requiereGeofencing;
  let distancia: number | null = null;

  if (config.requiereGeofencing) {
    const tieneCoordenadas =
      typeof input.latitud === 'number' && typeof input.longitud === 'number';

    if (!tieneCoordenadas || !geofence) {
      motivosBloqueo.push(
        'Geofencing requerido: faltan coordenadas GPS o geofence de la sede',
      );
    } else {
      distancia = distanciaMetros(
        input.latitud!,
        input.longitud!,
        geofence.latitud,
        geofence.longitud,
      );

      if (distancia <= geofence.radioMetros) {
        ubicacionValidada = true;
      } else if (config.permitirFueraGeofence) {
        motivosAutorizacion.push(
          `Marcación fuera de sede (${distancia.toFixed(0)} m, radio permitido ` +
            `${geofence.radioMetros} m): requiere autorización`,
        );
      } else {
        motivosBloqueo.push(
          `Ubicación fuera de sede: ${distancia.toFixed(0)} m del centro ` +
            `(radio permitido ${geofence.radioMetros} m)`,
        );
      }
    }
  }

  // --- 3. Biometría ---
  if (config.requiereBiometria) {
    if (typeof input.scoreBiometria !== 'number') {
      motivosBloqueo.push('Biometría requerida pero no proporcionada');
    } else if (input.scoreBiometria < config.umbralConfianzaBiometria) {
      // Score bajo no bloquea: pasa a autorización manual del supervisor.
      motivosAutorizacion.push(
        `Confianza biométrica baja: ${input.scoreBiometria.toFixed(2)} ` +
          `(mínimo ${config.umbralConfianzaBiometria}): requiere autorización manual`,
      );
    }
  }

  // --- 4. Tardanza (solo ENTRADA) ---
  const tardanzaMinutos =
    input.tipo === 'ENTRADA'
      ? calcularTardanzaMinutos(
          input.timestamp,
          config.horaEntradaEstandar,
          config.toleranciaMinutos,
        )
      : 0;

  const bloqueado = motivosBloqueo.length > 0;

  return {
    ubicacionValidada,
    distanciaMetros: distancia,
    bloqueado,
    motivoBloqueo: bloqueado ? motivosBloqueo[0] : undefined,
    // El bloqueo tiene prioridad: una marcación bloqueada no se registra,
    // por lo que no queda pendiente de autorización.
    requiereAutorizacion: !bloqueado && motivosAutorizacion.length > 0,
    motivosAutorizacion: bloqueado ? [] : motivosAutorizacion,
    tardanzaMinutos,
  };
}
