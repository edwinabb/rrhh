import { apiFetch } from '@/lib/api-client';

export type MotivoCese =
  | 'RENUNCIA'
  | 'TERMINO_CONTRATO'
  | 'MUTUO_DISENSO'
  | 'DESPIDO_ARBITRARIO'
  | 'FALLECIMIENTO';

export type EstadoCese = 'BORRADOR' | 'CALCULADA' | 'APROBADA' | 'PAGADA' | 'ANULADA';

export interface LineaLiquidacion {
  concepto: string;
  baseLegal: string;
  monto: number;
}

export interface Cese {
  id: string;
  employeeId: string;
  employee?: { nombres: string; apellidos: string; numeroDocumento: string };
  fechaCese: string;
  motivo: MotivoCese;
  estado: EstadoCese;
  inputSnapshot: any;
  componentes: { ingresos: LineaLiquidacion[]; deducciones: LineaLiquidacion[] } | null;
  totalBruto: string | number | null;
  totalDeducciones: string | number | null;
  netoPagar: string | number | null;
  fechaLimitePago: string;
  pagadoEn: string | null;
  pagoFueraDePlazo: boolean;
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

export const listarCeses = async (): Promise<Cese[]> => ok(await apiFetch('/ceses'), 'listar ceses');
export const detalleCese = async (id: string): Promise<Cese> => ok(await apiFetch(`/ceses/${id}`), 'cargar el cese');

export async function crearCese(input: { employeeId: string; fechaCese: string; motivo: MotivoCese }): Promise<Cese> {
  return ok(await apiFetch('/ceses', { method: 'POST', body: JSON.stringify(input) }), 'crear el cese');
}

export async function actualizarDatos(id: string, cambios: any): Promise<Cese> {
  return ok(await apiFetch(`/ceses/${id}/datos`, { method: 'PUT', body: JSON.stringify(cambios) }), 'guardar los datos');
}

export const calcularCese = async (id: string): Promise<Cese> =>
  ok(await apiFetch(`/ceses/${id}/calcular`, { method: 'POST' }), 'calcular');
export const aprobarCese = async (id: string): Promise<Cese> =>
  ok(await apiFetch(`/ceses/${id}/aprobar`, { method: 'POST' }), 'aprobar');
export const pagarCese = async (id: string): Promise<Cese> =>
  ok(await apiFetch(`/ceses/${id}/pagar`, { method: 'POST' }), 'registrar el pago');
export async function anularCese(id: string, motivo: string): Promise<Cese> {
  return ok(await apiFetch(`/ceses/${id}/anular`, { method: 'POST', body: JSON.stringify({ motivo }) }), 'anular');
}

/** Semáforo del plazo de 48h (D.S. 001-97-TR). */
export function semaforoPlazo(cese: Cese): { label: string; className: string } {
  if (cese.estado === 'PAGADA') {
    return cese.pagoFueraDePlazo
      ? { label: 'Pagado fuera de plazo', className: 'bg-red-100 text-red-800' }
      : { label: 'Pagado a tiempo', className: 'bg-emerald-100 text-emerald-800' };
  }
  if (cese.estado === 'ANULADA') return { label: '—', className: 'bg-slate-100 text-slate-500' };
  const restanteMs = new Date(cese.fechaLimitePago).getTime() + 86_399_999 - Date.now();
  if (restanteMs < 0) return { label: 'Plazo vencido', className: 'bg-red-100 text-red-800' };
  if (restanteMs < 24 * 3_600_000) return { label: 'Vence hoy', className: 'bg-amber-100 text-amber-800' };
  return { label: 'En plazo', className: 'bg-emerald-100 text-emerald-800' };
}
