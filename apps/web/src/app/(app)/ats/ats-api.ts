import { apiFetch } from '@/lib/api-client';

// ---------------------------------------------------------------------------
// Tipos espejo de la API ATS (apps/api/src/modules/ats)
// ---------------------------------------------------------------------------

export type EstadoVacante = 'ABIERTA' | 'PAUSADA' | 'CERRADA';

export type EstadoCandidato =
  | 'APLICADO'
  | 'REVISADO'
  | 'ENTREVISTA'
  | 'OFERTA'
  | 'RECHAZADO'
  | 'CONTRATADO';

export interface Vacante {
  id: string;
  tenantId: string;
  titulo: string;
  descripcion: string;
  /** Estructura libre (JSON): la UI la envía como lista de líneas. */
  requisitos: unknown;
  /** Decimal de Prisma: puede llegar serializado como string. */
  salarioMin: number | string | null;
  salarioMax: number | string | null;
  sedeId: string | null;
  estado: EstadoVacante;
  creadoEn: string;
  cerradaEn: string | null;
}

export interface CvExperiencia {
  empresa: string;
  cargo: string;
  desde: string | null;
  hasta: string | null;
}

export interface CvFormacion {
  institucion: string;
  titulo: string;
  anio: number | null;
}

export interface CvParseado {
  nombreCompleto: string;
  email: string | null;
  telefono: string | null;
  experiencia: CvExperiencia[];
  habilidades: string[];
  formacion: CvFormacion[];
  idiomas: string[];
}

export interface Candidato {
  id: string;
  tenantId: string;
  vacanteId: string;
  nombreCompleto: string;
  email: string;
  telefono: string | null;
  estado: EstadoCandidato;
  cvParseado: CvParseado | null;
  employeeId?: string | null;
  creadoEn?: string;
  /** Presente solo en la respuesta de registro si el CV no pudo parsearse. */
  advertencia?: string;
}

export interface CandidatoNota {
  id: string;
  candidatoId: string;
  autorId: string;
  nota: string;
  creadaEn?: string;
}

export interface EmployeeRow {
  id: string;
  nombres: string;
  apellidos: string;
  estado: string;
}

/**
 * Máquina de estados del pipeline (espejo de candidate.service.ts):
 * APLICADO → REVISADO → ENTREVISTA → OFERTA → (CONTRATADO | RECHAZADO).
 * RECHAZADO es alcanzable desde cualquier estado no terminal.
 */
export const TRANSICIONES_CANDIDATO: Record<EstadoCandidato, EstadoCandidato[]> = {
  APLICADO: ['REVISADO', 'RECHAZADO'],
  REVISADO: ['ENTREVISTA', 'RECHAZADO'],
  ENTREVISTA: ['OFERTA', 'RECHAZADO'],
  OFERTA: ['CONTRATADO', 'RECHAZADO'],
  RECHAZADO: [],
  CONTRATADO: [],
};

// ---------------------------------------------------------------------------
// Fetch helper (extiende apiFetch: errores legibles + redirección en 401)
// ---------------------------------------------------------------------------

async function atsRequest<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await apiFetch(path, init);
  } catch {
    throw new Error('No se pudo conectar con el servidor. Intenta nuevamente.');
  }

  if (res.status === 401) {
    window.location.href = '/login';
    throw new Error('Sesión expirada. Redirigiendo al inicio de sesión...');
  }

  if (!res.ok) {
    let message = `Error del servidor (${res.status}).`;
    try {
      const body = (await res.json()) as { message?: string | string[] };
      if (body?.message) {
        message = Array.isArray(body.message) ? body.message.join('. ') : body.message;
      }
    } catch {
      // cuerpo no-JSON: se mantiene el mensaje genérico
    }
    throw new Error(message);
  }

  return (await res.json()) as T;
}

// ---------------------------------------------------------------------------
// Endpoints ATS
// ---------------------------------------------------------------------------

export function listarVacantes(estado?: EstadoVacante): Promise<Vacante[]> {
  const query = estado ? `?estado=${estado}` : '';
  return atsRequest<Vacante[]>(`/ats/vacantes${query}`);
}

export interface CrearVacanteInput {
  titulo: string;
  descripcion: string;
  requisitos: unknown;
  salarioMin?: number;
  salarioMax?: number;
}

export function crearVacante(input: CrearVacanteInput): Promise<Vacante> {
  return atsRequest<Vacante>('/ats/vacantes', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function cerrarVacante(id: string): Promise<Vacante> {
  return atsRequest<Vacante>(`/ats/vacantes/${id}/cerrar`, { method: 'PUT' });
}

export interface RegistrarCandidatoInput {
  nombreCompleto: string;
  email: string;
  telefono?: string;
  cvTexto: string;
  consentimientoLpdp: boolean;
}

export function registrarCandidato(
  vacanteId: string,
  input: RegistrarCandidatoInput,
): Promise<Candidato> {
  return atsRequest<Candidato>(`/ats/vacantes/${vacanteId}/candidatos`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function cambiarEstadoCandidato(
  candidatoId: string,
  estado: EstadoCandidato,
): Promise<Candidato> {
  return atsRequest<Candidato>(`/ats/candidatos/${candidatoId}/estado`, {
    method: 'PUT',
    body: JSON.stringify({ estado }),
  });
}

export function agregarNotaCandidato(
  candidatoId: string,
  nota: string,
): Promise<CandidatoNota> {
  return atsRequest<CandidatoNota>(`/ats/candidatos/${candidatoId}/notas`, {
    method: 'POST',
    body: JSON.stringify({ nota }),
  });
}

export function contratarCandidato(
  candidatoId: string,
  employeeId: string,
): Promise<Candidato> {
  return atsRequest<Candidato>(`/ats/candidatos/${candidatoId}/contratar`, {
    method: 'PUT',
    body: JSON.stringify({ employeeId }),
  });
}

/** Lista de empleados (para vincular al contratar). Requiere employee.read. */
export function listarEmployees(): Promise<EmployeeRow[]> {
  return atsRequest<EmployeeRow[]>('/employees');
}

// ---------------------------------------------------------------------------
// Presentación
// ---------------------------------------------------------------------------

/** Formatea un salario (Decimal serializado como string o number) en soles. */
export function formatSalario(valor: number | string | null | undefined): string | null {
  if (valor === null || valor === undefined || valor === '') return null;
  const n = Number(valor);
  if (Number.isNaN(n)) return String(valor);
  return `S/ ${n.toLocaleString('es-PE', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

export function formatRangoSalarial(vacante: Vacante): string {
  const min = formatSalario(vacante.salarioMin);
  const max = formatSalario(vacante.salarioMax);
  if (min && max) return `${min} – ${max}`;
  if (min) return `Desde ${min}`;
  if (max) return `Hasta ${max}`;
  return 'No especificado';
}
