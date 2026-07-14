import { apiFetch } from '@/lib/api-client';

// ---------------------------------------------------------------------------
// Tipos — shapes reales de la API (ver apps/api/src/modules/attendance)
// ---------------------------------------------------------------------------

export type TipoMarcacion = 'ENTRADA' | 'SALIDA';

export type MotivoJustificacion =
  | 'TARDANZA'
  | 'FALTA'
  | 'PERMISO'
  | 'LICENCIA'
  | 'CALAMIDAD'
  | 'EVENTO_EMPRESA'
  | 'TELETRABAJO';

export const MOTIVO_LABELS: Record<MotivoJustificacion, string> = {
  TARDANZA: 'Tardanza',
  FALTA: 'Falta',
  PERMISO: 'Permiso',
  LICENCIA: 'Licencia',
  CALAMIDAD: 'Calamidad doméstica',
  EVENTO_EMPRESA: 'Evento de empresa',
  TELETRABAJO: 'Teletrabajo',
};

/** Fila de `marcacion` que retorna POST /attendance/marcaciones. */
export interface Marcacion {
  id: string;
  employeeId: string;
  sedeId: string;
  tipo: TipoMarcacion | 'JUSTIFICACION';
  timestamp: string;
  latitud: number | null;
  longitud: number | null;
  distanciaSedeMetros: number | null;
  ubicacionValidada: boolean;
  bloqueado: boolean;
  motivoBloqueo: string | null;
  requiereAutorizacion: boolean;
}

/** Fila de `asistencia_resumen` (GET /attendance/resumen/:periodo). */
export interface ResumenDia {
  id: string;
  employeeId: string;
  fecha: string; // ISO — columna @db.Date (usar solo la parte YYYY-MM-DD)
  horaEntrada: string | null;
  horaSalida: string | null;
  horasTrabajadas: number;
  horasExtrasDiarias: number;
  falta: boolean;
  tardanzaMinutos: number;
  justificado: boolean;
}

export type EstadoJustificacion = 'PENDIENTE' | 'APROBADA' | 'RECHAZADA';

/** Fila de `justificacion` que retornan POST /justificaciones y PUT /resolver. */
export interface Justificacion {
  id: string;
  employeeId: string;
  marcacionId: string | null;
  motivo: MotivoJustificacion;
  fecha: string;
  descripcion: string;
  documentoUrl: string | null;
  estado: EstadoJustificacion;
  aprobadoPor: string | null;
  aprobadoEn: string | null;
  motivoRechazo: string | null;
  creadoEn: string;
}

/** Respuesta de GET /attendance/dashboard/:periodo. */
export interface DashboardEquipo {
  periodo: string;
  totalEmpleados: number;
  totalDiasRegistrados: number;
  tasaAsistencia: number | null; // 0..1 (null si no hay días registrados)
  faltasInjustificadas: number;
  faltasJustificadas: number;
  diasConTardanza: number;
  totalTardanzaMinutos: number;
  totalHorasTrabajadas: number;
  totalHorasExtra: number;
  horasComputablesPorEmpleado: Record<string, number>;
}

export interface EmployeeLite {
  id: string;
  userId: string | null;
  sedeId: string | null;
  nombres: string;
  apellidos: string;
}

// ---------------------------------------------------------------------------
// Manejo de errores común
// ---------------------------------------------------------------------------

/** Lanza Error con mensaje legible si la respuesta no es OK. 401 → /login. */
async function ensureOk(res: Response, fallback: string): Promise<Response> {
  if (res.ok) return res;
  if (res.status === 401) {
    window.location.href = '/login';
    throw new Error('Sesión expirada. Redirigiendo al inicio de sesión...');
  }
  let message = fallback;
  try {
    const body = (await res.json()) as { message?: string | string[] };
    if (typeof body.message === 'string' && body.message.trim().length > 0) {
      message = body.message;
    } else if (Array.isArray(body.message) && body.message.length > 0) {
      message = body.message.join('. ');
    }
  } catch {
    // cuerpo no-JSON: se usa el mensaje por defecto
  }
  throw new Error(message);
}

// ---------------------------------------------------------------------------
// Llamadas
// ---------------------------------------------------------------------------

/**
 * GET /employees. Para RRHH/Admin la API usa Prisma (claves camelCase); para
 * Manager/Empleado lee vistas SQL (claves snake_case). Aquí se normaliza.
 */
export async function fetchEmployees(): Promise<EmployeeLite[]> {
  const res = await ensureOk(
    await apiFetch('/employees'),
    'No se pudo obtener la lista de empleados',
  );
  const rows = (await res.json()) as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    id: String(r.id),
    userId: (r.userId ?? r.user_id ?? null) as string | null,
    sedeId: (r.sedeId ?? r.sede_id ?? null) as string | null,
    nombres: String(r.nombres ?? ''),
    apellidos: String(r.apellidos ?? ''),
  }));
}

export interface RegistrarMarcacionInput {
  employeeId: string;
  sedeId: string;
  tipo: TipoMarcacion;
  latitud?: number;
  longitud?: number;
}

export async function registrarMarcacion(
  input: RegistrarMarcacionInput,
): Promise<Marcacion> {
  const res = await ensureOk(
    await apiFetch('/attendance/marcaciones', {
      method: 'POST',
      body: JSON.stringify({ ...input, tipoIdentificacion: 'MANUAL' }),
    }),
    'No se pudo registrar la marcación',
  );
  return (await res.json()) as Marcacion;
}

export async function fetchResumen(
  periodo: string,
  employeeId?: string,
): Promise<ResumenDia[]> {
  const qs = employeeId ? `?employeeId=${encodeURIComponent(employeeId)}` : '';
  const res = await ensureOk(
    await apiFetch(`/attendance/resumen/${periodo}${qs}`),
    'No se pudo obtener el resumen del período',
  );
  const body = (await res.json()) as { periodo: string; resumenes: ResumenDia[] };
  return body.resumenes;
}

export interface CrearJustificacionInput {
  employeeId: string;
  motivo: MotivoJustificacion;
  fecha: string; // YYYY-MM-DD
  descripcion: string;
}

export async function crearJustificacion(
  input: CrearJustificacionInput,
): Promise<Justificacion> {
  const res = await ensureOk(
    await apiFetch('/attendance/justificaciones', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
    'No se pudo enviar la justificación',
  );
  return (await res.json()) as Justificacion;
}

export async function resolverJustificacion(
  id: string,
  aprobar: boolean,
  motivoRechazo?: string,
): Promise<Justificacion> {
  const res = await ensureOk(
    await apiFetch(`/attendance/justificaciones/${encodeURIComponent(id)}/resolver`, {
      method: 'PUT',
      body: JSON.stringify({ aprobar, ...(motivoRechazo ? { motivoRechazo } : {}) }),
    }),
    'No se pudo resolver la justificación',
  );
  return (await res.json()) as Justificacion;
}

export async function fetchDashboard(periodo: string): Promise<DashboardEquipo> {
  const res = await ensureOk(
    await apiFetch(`/attendance/dashboard/${periodo}`),
    'No se pudo obtener el dashboard del equipo',
  );
  return (await res.json()) as DashboardEquipo;
}

/**
 * Listado de justificaciones pendientes. El backend HOY no expone este
 * endpoint (solo POST y PUT /resolver); se intenta igualmente por si se
 * agrega. Retorna null si el endpoint no existe (404) para que la UI degrade
 * a la lista de la sesión.
 */
export async function fetchJustificacionesPendientes(): Promise<
  Justificacion[] | null
> {
  const res = await apiFetch('/attendance/justificaciones?estado=PENDIENTE');
  if (res.status === 404 || res.status === 405) return null;
  const ok = await ensureOk(res, 'No se pudo obtener las justificaciones pendientes');
  const body = (await ok.json()) as unknown;
  if (Array.isArray(body)) return body as Justificacion[];
  const wrapped = body as { justificaciones?: Justificacion[] };
  return Array.isArray(wrapped.justificaciones) ? wrapped.justificaciones : null;
}

// ---------------------------------------------------------------------------
// Utilidades de formato
// ---------------------------------------------------------------------------

/** 'YYYY-MM' del mes actual (para el selector de período). */
export function periodoActual(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

/** 'YYYY-MM-DD' de hoy en hora local (default del input date). */
export function hoyISO(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(
    now.getDate(),
  ).padStart(2, '0')}`;
}

/** Fecha @db.Date (ISO) → 'dd/mm/aaaa' sin desfase de zona horaria. */
export function fmtFecha(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
}

/** Timestamp ISO → hora local 'HH:mm' ('—' si es null). */
export function fmtHora(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString('es-PE', {
    hour: '2-digit',
    minute: '2-digit',
  });
}
