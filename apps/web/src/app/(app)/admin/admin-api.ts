import { apiFetch } from '@/lib/api-client';

/**
 * Helpers de API específicos de la sección Administración.
 * Usan apiFetch (cookie de sesión incluida). Un 401 en cualquier llamada
 * significa sesión expirada → se redirige a /login.
 */

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function handleResponse<T>(res: Response): Promise<T> {
  if (res.status === 401) {
    window.location.href = '/login';
    throw new ApiError('Sesión expirada', 401);
  }
  if (!res.ok) {
    let message = `Error ${res.status} del servidor`;
    try {
      const body = (await res.json()) as { message?: string | string[] };
      if (body?.message) {
        message = Array.isArray(body.message) ? body.message.join(', ') : String(body.message);
      }
    } catch {
      // cuerpo no-JSON: se mantiene el mensaje genérico
    }
    throw new ApiError(message, res.status);
  }
  return (await res.json()) as T;
}

// ---------------------------------------------------------------------------
// Parámetros normativos
// ---------------------------------------------------------------------------

/**
 * Códigos sembrados por el seed del sistema. GET /normative-params no expone
 * un listado completo (solo resuelve un código a una fecha), así que la tabla
 * se construye resolviendo cada código conocido.
 */
export const KNOWN_PARAM_CODES = [
  'UIT',
  'RMV',
  'ESSALUD_TASA',
  'ONP_TASA',
  'AFP_APORTE_OBLIGATORIO',
  'GRATIFICACION_BONIF_EXTRAORD',
  'HORAS_EXTRA_TASAS',
  'ASIGNACION_FAMILIAR_PCT',
  'QUINTA_DEDUCCION_UIT',
] as const;

export interface NormativeParamResolved {
  codigo: string;
  fecha: string;
  valor: unknown;
}

/** Resuelve el valor vigente de un código a una fecha (YYYY-MM-DD). 404 si no hay vigente. */
export async function resolveNormativeParam(
  codigo: string,
  fecha: string,
): Promise<NormativeParamResolved> {
  const qs = new URLSearchParams({ codigo, fecha });
  const res = await apiFetch(`/normative-params?${qs.toString()}`);
  return handleResponse<NormativeParamResolved>(res);
}

export interface NormativeParamRecord {
  id: string;
  codigo: string;
  valor: unknown;
  vigenciaDesde: string;
  vigenciaHasta: string | null;
  descripcion: string | null;
}

/** Registra una nueva versión (cierra la vigencia anterior, nunca edita). */
export async function createNormativeParamVersion(input: {
  codigo: string;
  valor: unknown;
  vigenciaDesde: string;
  descripcion?: string;
}): Promise<NormativeParamRecord> {
  const res = await apiFetch('/normative-params', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return handleResponse<NormativeParamRecord>(res);
}

// ---------------------------------------------------------------------------
// Auditoría
// ---------------------------------------------------------------------------

export interface AuditLogEntry {
  id: number | string;
  tenantId: string | null;
  userId: string | null; // null = acción de sistema
  tabla: string;
  registroId: string | null;
  accion: string; // INSERT | UPDATE | DELETE
  valoresAnteriores: unknown;
  valoresNuevos: unknown;
  ipOrigen: string | null;
  userAgent: string | null;
  requestId: string | null;
  createdAt: string;
}

/** GET /audit-log — filtros reales del endpoint: tabla y registroId. Máx. 200 filas, más recientes primero. */
export async function fetchAuditLog(filters: {
  tabla?: string;
  registroId?: string;
}): Promise<AuditLogEntry[]> {
  const qs = new URLSearchParams();
  if (filters.tabla) qs.set('tabla', filters.tabla);
  if (filters.registroId) qs.set('registroId', filters.registroId);
  const query = qs.toString();
  const res = await apiFetch(`/audit-log${query ? `?${query}` : ''}`);
  return handleResponse<AuditLogEntry[]>(res);
}

// ---------------------------------------------------------------------------
// Empleados
// ---------------------------------------------------------------------------

export interface EmployeeRow {
  id: string;
  nombres: string;
  apellidos: string;
  estado: string;
  tipoDocumento?: string;
  numeroDocumento?: string;
  sedeId?: string;
  [key: string]: unknown;
}

export async function fetchEmployees(): Promise<EmployeeRow[]> {
  const res = await apiFetch('/employees');
  return handleResponse<EmployeeRow[]>(res);
}

// ---------------------------------------------------------------------------
// Utilidades de presentación
// ---------------------------------------------------------------------------

/** Representación legible de un valor JSON (números y strings sin comillas extra). */
export function formatJsonValue(valor: unknown): string {
  if (valor === null || valor === undefined) return '—';
  if (typeof valor === 'number' || typeof valor === 'boolean') return String(valor);
  if (typeof valor === 'string') return valor;
  return JSON.stringify(valor, null, 2);
}

export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('es-PE', { dateStyle: 'short', timeStyle: 'medium' });
}

export function formatDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('es-PE', { timeZone: 'UTC' });
}
