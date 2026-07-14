const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

/** Todas las llamadas incluyen la cookie de sesión (httpOnly) — nunca se maneja un token en JS. */
export async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${API_BASE_URL}${path}`, {
    ...init,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  });
}

export async function login(email: string, password: string): Promise<void> {
  const res = await apiFetch('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) {
    throw new Error('Credenciales inválidas');
  }
}

export async function logout(): Promise<void> {
  const res = await apiFetch('/auth/logout', { method: 'POST' });
  if (!res.ok) {
    throw new Error('No se pudo cerrar la sesión');
  }
}

export interface Me {
  userId: string;
  tenantId: string;
  pgRole: 'app_rrhh' | 'app_manager' | 'app_employee' | 'app_admin';
  permissions: string[];
}

/** Retorna la identidad de la sesión actual, o null si no hay sesión (401). */
export async function getMe(): Promise<Me | null> {
  const res = await apiFetch('/auth/me');
  if (res.status === 401) return null;
  if (!res.ok) {
    throw new Error('No se pudo obtener la sesión');
  }
  return (await res.json()) as Me;
}

/** Error de sesión no autenticada (HTTP 401): el llamador debe redirigir a /login. */
export class UnauthorizedError extends Error {
  constructor() {
    super('Sesión no autenticada');
    this.name = 'UnauthorizedError';
  }
}

/** Intenta extraer un mensaje legible del cuerpo de error de la API (formato NestJS). */
async function parseApiError(res: Response, fallback: string): Promise<string> {
  try {
    const body = (await res.json()) as { message?: string | string[] };
    if (typeof body.message === 'string') return body.message;
    if (Array.isArray(body.message)) return body.message.join(', ');
  } catch {
    // cuerpo no-JSON: usar fallback
  }
  return fallback;
}

// ---------------------------------------------------------------------------
// Nómina (payroll)
// ---------------------------------------------------------------------------

export interface ConceptoCalculado {
  codigo: string;
  nombre: string;
  monto: number;
}

/** Detalle por empleado; el endpoint actual NO lo retorna, pero se tipa por si la API lo agrega. */
export interface PlanillaDetalleEmpleado {
  employeeId?: string;
  nombre?: string;
  conceptosCalculados?: ConceptoCalculado[];
  netoPagar?: number;
}

/** Shape real de POST /payroll/:periodo/procesar (ver payroll-run.service.ts). */
export interface PlanillaProcesada {
  id: string;
  estado: string;
  /** No presente hoy en la respuesta del backend; se renderiza solo si llega. */
  detalles?: PlanillaDetalleEmpleado[];
}

export async function procesarPlanilla(periodo: string): Promise<PlanillaProcesada> {
  const res = await apiFetch(`/payroll/${encodeURIComponent(periodo)}/procesar`, {
    method: 'POST',
  });
  if (res.status === 401) throw new UnauthorizedError();
  if (res.status === 403) {
    throw new Error('No tienes permiso para procesar la planilla.');
  }
  if (!res.ok) {
    throw new Error(await parseApiError(res, 'No se pudo procesar la planilla.'));
  }
  return (await res.json()) as PlanillaProcesada;
}

/** Los endpoints de export retornan hoy un stub { mensaje } (pendiente de conexión a BD). */
export interface ExportacionPlanilla {
  mensaje?: string;
}

export async function exportarPlanilla(
  periodo: string,
  formato: 'plame' | 'telecredito',
): Promise<ExportacionPlanilla> {
  const res = await apiFetch(`/payroll/${encodeURIComponent(periodo)}/export/${formato}`);
  if (res.status === 401) throw new UnauthorizedError();
  if (res.status === 403) {
    throw new Error('No tienes permiso para exportar la planilla.');
  }
  if (!res.ok) {
    throw new Error(await parseApiError(res, 'No se pudo generar la exportación.'));
  }
  return (await res.json()) as ExportacionPlanilla;
}
