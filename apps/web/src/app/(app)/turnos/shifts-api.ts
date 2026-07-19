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
