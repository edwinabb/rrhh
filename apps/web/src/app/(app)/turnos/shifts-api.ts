import { apiFetch } from '@/lib/api-client';

export interface Turno {
  id: string;
  codigo: string;
  nombre: string;
  horaInicio: string;
  horaFin: string;
  horasEsperadas: string | number;
  toleranciaMinutos: number;
  activo: boolean;
}

export type TipoDiaPlan = 'TURNO' | 'DESCANSO' | 'DESCANSO_COMPENSATORIO';

export interface Asignacion {
  id: string;
  employeeId: string;
  fecha: string;
  tipoDia: TipoDiaPlan;
  turnoId: string | null;
  notas: string | null;
  turno?: { codigo: string; nombre: string; horaInicio: string; horaFin: string } | null;
  employee?: { nombres: string; apellidos: string; numeroDocumento: string };
}

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
  alertasConfianza: string[];
}

export interface Movimiento {
  id: string;
  tipo: 'GANADO' | 'GOZADO' | 'AJUSTE_INICIAL';
  dias: string | number;
  fechaReferencia: string;
  motivo: string | null;
  creadoEn: string;
}

async function ok<T>(res: Response, accion: string): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const msg =
      typeof body.message === 'string'
        ? body.message
        : Array.isArray(body.faltantes)
          ? body.faltantes.join('; ')
          : `No se pudo ${accion}`;
    throw new Error(msg);
  }
  return res.json() as Promise<T>;
}

export const listarTurnos = async (incluirInactivos = false): Promise<Turno[]> =>
  ok(await apiFetch(`/turnos?incluirInactivos=${incluirInactivos}`), 'listar turnos');

export async function crearTurno(input: Omit<Turno, 'id' | 'activo'>): Promise<Turno> {
  return ok(await apiFetch('/turnos', { method: 'POST', body: JSON.stringify(input) }), 'crear el turno');
}

export async function actualizarTurno(id: string, cambios: Partial<Turno>): Promise<Turno> {
  return ok(await apiFetch(`/turnos/${id}`, { method: 'PUT', body: JSON.stringify(cambios) }), 'actualizar el turno');
}

export const obtenerPlan = async (desde: string, hasta: string, employeeId?: string): Promise<Asignacion[]> =>
  ok(
    await apiFetch(`/turnos/plan?desde=${desde}&hasta=${hasta}${employeeId ? `&employeeId=${employeeId}` : ''}`),
    'cargar el plan',
  );

export async function upsertAsignacion(input: {
  employeeId: string; fecha: string; tipoDia: TipoDiaPlan; turnoId?: string; notas?: string; forzarSinSaldo?: boolean;
}): Promise<Asignacion> {
  return ok(await apiFetch('/turnos/plan', { method: 'PUT', body: JSON.stringify(input) }), 'guardar la asignación');
}

export const descargarPlantillaPlan = async (): Promise<string> => {
  const res = await apiFetch('/turnos/plan/plantilla');
  if (!res.ok) throw new Error('No se pudo descargar la plantilla');
  return res.text();
};

export async function importarPlan(contenido: string): Promise<{ procesadas: number; omitidas: number; errores: Array<{ fila: number; mensaje: string }> }> {
  return ok(await apiFetch('/turnos/plan/import', { method: 'POST', body: JSON.stringify({ contenido }) }), 'importar el plan');
}

export async function intercambiar(input: { fecha: string; employeeIdA: string; employeeIdB: string }): Promise<unknown> {
  return ok(await apiFetch('/turnos/intercambio', { method: 'POST', body: JSON.stringify(input) }), 'registrar el intercambio');
}

export async function registrarMovimiento(input: {
  employeeId: string; tipo: 'GANADO' | 'AJUSTE_INICIAL'; dias: number; fechaReferencia: string; motivo?: string;
}): Promise<Movimiento> {
  return ok(await apiFetch('/turnos/compensatorios', { method: 'POST', body: JSON.stringify(input) }), 'registrar el movimiento');
}

export const obtenerLibro = async (employeeId: string): Promise<{ saldo: number; movimientos: Movimiento[] }> =>
  ok(await apiFetch(`/turnos/compensatorios/${employeeId}`), 'cargar el libro');

export const obtenerCumplimiento = async (periodo: string): Promise<{ periodo: string; empleados: ReporteEmpleado[] }> =>
  ok(await apiFetch(`/turnos/cumplimiento/${periodo}`), 'cargar el reporte');

export const exportarNovedades = async (periodo: string): Promise<string> => {
  const r = await ok<{ csv: string }>(
    await apiFetch(`/turnos/cumplimiento/${periodo}/export`),
    'exportar novedades',
  );
  return r.csv;
};

export type TipoDiaPatron = 'DIA' | 'NOCHE' | 'DESC';

export interface RotacionPatron {
  id: string;
  nombre: string;
  descripcion?: string | null;
  secuencia: TipoDiaPatron[];
  duracionCiclo: number;
  activo: boolean;
  creadoEn: string;
  creadoPor: string;
  actualizadoEn: string;
  actualizadoPor: string;
}

export const listarPatrones = async (incluirInactivos = false): Promise<RotacionPatron[]> => {
  // Query string boolean is converted to "true"/"false" string by URL search params.
  // Backend checks: incluirInactivos === 'true', so this format is correct.
  const res = await apiFetch(`/turnos/patrones?incluirInactivos=${incluirInactivos}`);
  if (!res.ok) {
    throw new Error('No se pudo listar los patrones');
  }
  const patrones = await res.json();
  return patrones.map((p: any) => ({
    ...p,
    secuencia: Array.isArray(p.secuencia) ? p.secuencia : JSON.parse(p.secuencia),
  }));
};

export async function crearPatron(input: {
  nombre: string;
  descripcion?: string;
  secuencia: TipoDiaPatron[];
}): Promise<RotacionPatron> {
  return ok(
    await apiFetch('/turnos/patrones', { method: 'POST', body: JSON.stringify(input) }),
    'crear el patrón',
  );
}

export async function actualizarPatron(
  id: string,
  cambios: Partial<Omit<RotacionPatron, 'id' | 'creadoEn' | 'creadoPor' | 'actualizadoEn' | 'actualizadoPor'>>,
): Promise<RotacionPatron> {
  return ok(
    await apiFetch(`/turnos/patrones/${id}`, { method: 'PUT', body: JSON.stringify(cambios) }),
    'actualizar el patrón',
  );
}

export async function aplicarPatron(
  patronId: string,
  input: {
    employeeIds: string[];
    desde: string;
    hasta: string;
    diaInicioCiclo: string;
    ajustes?: Array<{ fecha: string; tipoDia: TipoDiaPatron }>;
  },
): Promise<{ procesadas: number; errores: Array<{ employeeId: string; mensaje: string }> }> {
  return ok(
    await apiFetch(`/turnos/patrones/${patronId}/aplicar`, { method: 'POST', body: JSON.stringify(input) }),
    'aplicar el patrón',
  );
}

// ---------------------------------------------------------------------------
// Cambios de Turno (Shift Change Requests)
// ---------------------------------------------------------------------------

export type EstadoCambio = 'PENDIENTE' | 'APROBADA' | 'RECHAZADA';

export interface CambioSolicitud {
  id: string;
  employeeId: string;
  fechaActual: string;
  turnoIdActual: string | null;
  fechaNueva: string;
  turnoIdNuevo: string;
  estado: EstadoCambio;
  motivoRechazo?: string | null;
  creadoEn: string;
  actualizadoEn: string;
  turnoActual?: { codigo: string; nombre: string; horaInicio: string; horaFin: string } | null;
  turnoNuevo?: { codigo: string; nombre: string; horaInicio: string; horaFin: string } | null;
}

export const listarMisCambios = async (): Promise<CambioSolicitud[]> =>
  ok(await apiFetch('/turnos/cambios/mios'), 'listar mis cambios');

export async function solicitarCambio(input: {
  fechaActual: string;
  turnoIdActual: string | null;
  fechaNueva: string;
  turnoIdNuevo: string;
  creadoPor: string;
}): Promise<CambioSolicitud> {
  return ok(
    await apiFetch('/turnos/cambios', { method: 'POST', body: JSON.stringify(input) }),
    'solicitar el cambio',
  );
}

export interface FiltrosCambios {
  estado?: EstadoCambio;
  employeeId?: string;
  decididoPor?: string;
  fechaDesde?: string;
  fechaHasta?: string;
}

export const listarCambios = async (filtros?: FiltrosCambios): Promise<CambioSolicitud[]> => {
  const params = new URLSearchParams();
  if (filtros?.estado) params.append('estado', filtros.estado);
  if (filtros?.employeeId) params.append('employeeId', filtros.employeeId);
  if (filtros?.decididoPor) params.append('decididoPor', filtros.decididoPor);
  if (filtros?.fechaDesde) params.append('fechaDesde', filtros.fechaDesde);
  if (filtros?.fechaHasta) params.append('fechaHasta', filtros.fechaHasta);

  const qs = params.toString();
  return ok(await apiFetch(`/turnos/cambios${qs ? `?${qs}` : ''}`), 'listar cambios');
};

export const aprobarCambio = async (id: string, decididoPor: string): Promise<CambioSolicitud> =>
  ok(
    await apiFetch(`/turnos/cambios/${id}/aprobar`, { method: 'PUT', body: JSON.stringify({ decididoPor }) }),
    'aprobar el cambio',
  );

export const rechazarCambio = async (id: string, decididoPor: string, motivoRechazo: string): Promise<CambioSolicitud> =>
  ok(
    await apiFetch(`/turnos/cambios/${id}/rechazar`, { method: 'PUT', body: JSON.stringify({ decididoPor, motivoRechazo }) }),
    'rechazar el cambio',
  );
