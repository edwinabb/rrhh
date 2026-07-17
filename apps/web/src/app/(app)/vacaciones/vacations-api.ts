import { apiFetch } from '@/lib/api-client';

export interface VacacionPeriodo {
  id: string;
  employeeId: string;
  periodoInicio: string;
  periodoFin: string;
  diasGanados: number;
  diasGozados: string | number;
  estado: 'EN_CURSO' | 'VENCIDO_PENDIENTE' | 'GOZADO' | 'LIQUIDADO';
  notas: string | null;
}

async function ok<T>(res: Response, accion: string): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(typeof body.message === 'string' ? body.message : `No se pudo ${accion}`);
  }
  return res.json() as Promise<T>;
}

export async function listarPeriodos(employeeId: string): Promise<VacacionPeriodo[]> {
  return ok(await apiFetch(`/vacaciones/periodos?employeeId=${employeeId}`), 'listar los períodos');
}

export async function crearPeriodo(employeeId: string, periodoInicio: string): Promise<VacacionPeriodo> {
  return ok(
    await apiFetch('/vacaciones/periodos', {
      method: 'POST',
      body: JSON.stringify({ employeeId, periodoInicio }),
    }),
    'crear el período',
  );
}

export async function actualizarPeriodo(
  id: string,
  cambios: { diasGozados?: number; estado?: VacacionPeriodo['estado']; notas?: string },
): Promise<VacacionPeriodo> {
  return ok(
    await apiFetch(`/vacaciones/periodos/${id}`, { method: 'PUT', body: JSON.stringify(cambios) }),
    'actualizar el período',
  );
}

export interface EmpleadoResumen {
  id: string;
  nombres: string;
  apellidos: string;
  numeroDocumento: string;
}

export async function listarEmpleados(): Promise<EmpleadoResumen[]> {
  return ok(await apiFetch('/employees'), 'listar empleados');
}
