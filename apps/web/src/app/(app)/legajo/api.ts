import { apiFetch } from '@/lib/api-client';

// ---------------------------------------------------------------------------
// Tipos (espejo de apps/api/src/modules/documents — el controller serializa
// BigInt como number y las fechas viajan como string ISO).
// ---------------------------------------------------------------------------

export type TipoDocumento =
  | 'CONTRATO'
  | 'CV'
  | 'DNI'
  | 'CERTIFICADO'
  | 'MEMO'
  | 'BOLETA'
  | 'OTRO';

export const TIPOS_DOCUMENTO: readonly TipoDocumento[] = [
  'CONTRATO',
  'CV',
  'DNI',
  'CERTIFICADO',
  'MEMO',
  'BOLETA',
  'OTRO',
];

export const TIPO_LABELS: Record<TipoDocumento, string> = {
  CONTRATO: 'Contrato',
  CV: 'Currículum (CV)',
  DNI: 'DNI',
  CERTIFICADO: 'Certificado',
  MEMO: 'Memo',
  BOLETA: 'Boleta',
  OTRO: 'Otro',
};

/** Tipos que todo legajo debería tener; se usan para marcar faltantes. */
export const TIPOS_REQUERIDOS: readonly TipoDocumento[] = ['CONTRATO', 'DNI', 'CV'];

export interface Employee {
  id: string;
  nombres: string;
  apellidos: string;
  estado: string;
}

export interface Documento {
  id: string;
  tenantId: string;
  employeeId: string;
  tipo: TipoDocumento;
  estado: string;
  nombreArchivo: string;
  mimeType: string;
  tamanoBytes: number;
  checksumMd5: string;
  subidoPor: string;
  requiereConsentimiento: boolean;
  creadoEn: string;
}

export interface LegajoView {
  employeeId: string;
  documentosPorTipo: Record<string, Documento[]>;
  tiposFaltantes: string[];
}

export interface DownloadResult {
  nombreArchivo: string;
  mimeType: string;
  contenidoBase64: string;
}

// ---------------------------------------------------------------------------
// Manejo de errores: 401 => sesión expirada (el caller redirige a /login);
// para el resto se intenta extraer el message del cuerpo NestJS.
// ---------------------------------------------------------------------------

export class SesionExpiradaError extends Error {
  constructor() {
    super('Sesión expirada');
    this.name = 'SesionExpiradaError';
  }
}

async function parseOrThrow<T>(res: Response, fallback: string): Promise<T> {
  if (res.status === 401) throw new SesionExpiradaError();
  if (!res.ok) {
    let mensaje = fallback;
    try {
      const body = (await res.json()) as { message?: string | string[] };
      if (Array.isArray(body?.message)) mensaje = body.message.join('. ');
      else if (typeof body?.message === 'string' && body.message) mensaje = body.message;
    } catch {
      // cuerpo no-JSON: se usa el fallback
    }
    throw new Error(mensaje);
  }
  return (await res.json()) as T;
}

// ---------------------------------------------------------------------------
// Llamadas
// ---------------------------------------------------------------------------

export async function fetchEmployees(): Promise<Employee[]> {
  const res = await apiFetch('/employees');
  return parseOrThrow<Employee[]>(res, 'No se pudo cargar la lista de empleados');
}

export async function fetchLegajo(employeeId: string): Promise<LegajoView> {
  const params = new URLSearchParams({ tiposRequeridos: TIPOS_REQUERIDOS.join(',') });
  const res = await apiFetch(
    `/documents/legajo/${encodeURIComponent(employeeId)}?${params.toString()}`,
  );
  return parseOrThrow<LegajoView>(res, 'No se pudo cargar el legajo');
}

export interface SearchFilters {
  employeeId?: string;
  tipo?: TipoDocumento | '';
  /** YYYY-MM-DD (input type="date") */
  desde?: string;
  /** YYYY-MM-DD (input type="date") */
  hasta?: string;
}

export async function searchDocuments(filtros: SearchFilters): Promise<Documento[]> {
  const params = new URLSearchParams();
  if (filtros.employeeId) params.set('employeeId', filtros.employeeId);
  if (filtros.tipo) params.set('tipo', filtros.tipo);
  if (filtros.desde) params.set('desde', new Date(`${filtros.desde}T00:00:00`).toISOString());
  if (filtros.hasta) params.set('hasta', new Date(`${filtros.hasta}T23:59:59.999`).toISOString());
  const qs = params.toString();
  const res = await apiFetch(`/documents/search${qs ? `?${qs}` : ''}`);
  return parseOrThrow<Documento[]>(res, 'No se pudo ejecutar la búsqueda');
}

export interface UploadInput {
  employeeId: string;
  tipo: TipoDocumento;
  file: File;
  requiereConsentimiento: boolean;
}

/** El API espera el contenido como base64 en JSON (no multipart). */
export async function uploadDocument(input: UploadInput): Promise<void> {
  const contenidoBase64 = await fileToBase64(input.file);
  const res = await apiFetch('/documents', {
    method: 'POST',
    body: JSON.stringify({
      employeeId: input.employeeId,
      tipo: input.tipo,
      nombreArchivo: input.file.name,
      mimeType: input.file.type || 'application/octet-stream',
      contenidoBase64,
      requiereConsentimiento: input.requiereConsentimiento,
    }),
  });
  await parseOrThrow<unknown>(res, 'No se pudo subir el documento');
}

/** Descarga el documento y dispara la descarga del navegador con el nombre original. */
export async function downloadDocument(documentId: string): Promise<void> {
  const res = await apiFetch(`/documents/${encodeURIComponent(documentId)}/download`);
  const data = await parseOrThrow<DownloadResult>(res, 'No se pudo descargar el documento');

  const blob = base64ToBlob(data.contenidoBase64, data.mimeType || 'application/octet-stream');
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = data.nombreArchivo || 'documento';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Eliminación lógica: el motivo es obligatorio (Ley 29733). */
export async function deleteDocument(documentId: string, motivo: string): Promise<void> {
  const res = await apiFetch(`/documents/${encodeURIComponent(documentId)}`, {
    method: 'DELETE',
    body: JSON.stringify({ motivo }),
  });
  await parseOrThrow<unknown>(res, 'No se pudo eliminar el documento');
}

// ---------------------------------------------------------------------------
// Helpers binarios
// ---------------------------------------------------------------------------

async function fileToBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binario = '';
  const CHUNK = 0x8000; // evita desbordar la pila de String.fromCharCode
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binario += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binario);
}

function base64ToBlob(base64: string, mimeType: string): Blob {
  const binario = atob(base64);
  const bytes = new Uint8Array(binario.length);
  for (let i = 0; i < binario.length; i++) {
    bytes[i] = binario.charCodeAt(i);
  }
  return new Blob([bytes], { type: mimeType });
}

// ---------------------------------------------------------------------------
// Formato
// ---------------------------------------------------------------------------

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatFecha(iso: string): string {
  const fecha = new Date(iso);
  if (Number.isNaN(fecha.getTime())) return '—';
  return fecha.toLocaleDateString('es-PE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

export function nombreEmpleado(e: Employee): string {
  return `${e.apellidos}, ${e.nombres}`;
}
