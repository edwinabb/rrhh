'use client';

import { useRef, useState } from 'react';
import { useAuth } from '@/components/auth-context';
import { apiFetch } from '@/lib/api-client';

// ---------------------------------------------------------------------------
// Tipos — shape real del reporte de import de la API
// (ver attendance-import.service.ts y payroll-import.service.ts:
//  { procesadas, omitidas, errores: [{ fila, mensaje }] })
// ---------------------------------------------------------------------------

interface ErrorFilaImport {
  fila: number;
  mensaje: string;
}

interface ReporteImport {
  procesadas: number;
  omitidas: number;
  errores: ErrorFilaImport[];
}

export interface CsvImportCardProps {
  titulo: string;
  descripcion: string;
  /** Path de la API que retorna la plantilla CSV descargable (GET). */
  plantillaUrl: string;
  /** Path de la API que recibe POST { csv } y retorna el reporte. */
  importUrl: string;
  /** Código de permiso requerido; sin él la tarjeta no se renderiza. */
  permiso: string;
  /** Notifica al padre tras un import con filas procesadas (para refrescar datos). */
  onImportado?: () => void;
}

/** Extrae un mensaje legible del cuerpo de error de la API (formato NestJS). */
async function mensajeDeError(res: Response, fallback: string): Promise<string> {
  try {
    const body = (await res.json()) as { message?: string | string[] };
    if (typeof body.message === 'string' && body.message.trim().length > 0) {
      return body.message;
    }
    if (Array.isArray(body.message) && body.message.length > 0) {
      return body.message.join('. ');
    }
  } catch {
    // cuerpo no-JSON: usar fallback
  }
  return fallback;
}

/** filename del Content-Disposition ('attachment; filename="x.csv"'), o null. */
function filenameDeContentDisposition(header: string | null): string | null {
  if (!header) return null;
  const match = /filename\s*=\s*"?([^";]+)"?/i.exec(header);
  return match?.[1]?.trim() ?? null;
}

/** Lee el archivo como texto UTF-8 (el backend tolera BOM y CRLF). */
function leerArchivoComoTexto(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(new Error('No se pudo leer el archivo seleccionado.'));
    reader.readAsText(file, 'utf-8');
  });
}

/**
 * Tarjeta reutilizable de import CSV: descarga de plantilla + selección de
 * archivo + POST { csv } + reporte por fila (procesadas / omitidas / errores).
 * Solo visible si el usuario tiene el permiso indicado.
 */
export function CsvImportCard({
  titulo,
  descripcion,
  plantillaUrl,
  importUrl,
  permiso,
  onImportado,
}: CsvImportCardProps) {
  const { hasPermission } = useAuth();

  const inputRef = useRef<HTMLInputElement>(null);
  const [archivo, setArchivo] = useState<File | null>(null);
  const [descargando, setDescargando] = useState(false);
  const [importando, setImportando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reporte, setReporte] = useState<ReporteImport | null>(null);

  if (!hasPermission(permiso)) return null;

  async function descargarPlantilla() {
    setError(null);
    setDescargando(true);
    try {
      const res = await apiFetch(plantillaUrl);
      if (!res.ok) {
        throw new Error(await mensajeDeError(res, 'No se pudo descargar la plantilla.'));
      }
      const blob = await res.blob();
      const filename =
        filenameDeContentDisposition(res.headers.get('Content-Disposition')) ??
        'plantilla.csv';

      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(
        err instanceof Error && err.message
          ? err.message
          : 'No se pudo descargar la plantilla.',
      );
    } finally {
      setDescargando(false);
    }
  }

  async function importar() {
    if (!archivo) return;
    setError(null);
    setReporte(null);
    setImportando(true);
    try {
      const csv = await leerArchivoComoTexto(archivo);
      const res = await apiFetch(importUrl, {
        method: 'POST',
        body: JSON.stringify({ csv }),
      });
      if (!res.ok) {
        throw new Error(await mensajeDeError(res, 'No se pudo importar el archivo.'));
      }
      const body = (await res.json()) as ReporteImport;
      setReporte({
        procesadas: body.procesadas ?? 0,
        omitidas: body.omitidas ?? 0,
        errores: Array.isArray(body.errores) ? body.errores : [],
      });
      // Permite volver a importar el mismo archivo corregido sin recargar
      setArchivo(null);
      if (inputRef.current) inputRef.current.value = '';
      if ((body.procesadas ?? 0) > 0) onImportado?.();
    } catch (err) {
      setError(
        err instanceof Error && err.message
          ? err.message
          : 'No se pudo importar el archivo.',
      );
    } finally {
      setImportando(false);
    }
  }

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
      <h2 className="text-sm font-semibold text-slate-900">{titulo}</h2>
      <p className="mt-1 text-sm text-slate-500">{descripcion}</p>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={descargarPlantilla}
          disabled={descargando}
          className="rounded border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50"
        >
          {descargando ? 'Descargando...' : 'Descargar plantilla CSV'}
        </button>

        <input
          ref={inputRef}
          type="file"
          accept=".csv,text/csv"
          onChange={(e) => {
            setError(null);
            setReporte(null);
            setArchivo(e.target.files?.[0] ?? null);
          }}
          className="text-sm text-slate-600 file:mr-3 file:rounded file:border file:border-slate-300 file:bg-white file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-slate-700 hover:file:bg-slate-100"
        />

        <button
          type="button"
          onClick={importar}
          disabled={!archivo || importando}
          className="rounded bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {importando ? 'Importando...' : 'Importar'}
        </button>
      </div>

      {importando && <p className="mt-3 text-sm text-slate-500">Procesando archivo...</p>}

      {error && (
        <p className="mt-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      {reporte && (
        <div className="mt-4 space-y-2">
          <p className="rounded border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">
            {reporte.procesadas}{' '}
            {reporte.procesadas === 1 ? 'fila procesada' : 'filas procesadas'}
          </p>
          {reporte.omitidas > 0 && (
            <p className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
              {reporte.omitidas} {reporte.omitidas === 1 ? 'omitida' : 'omitidas'}{' '}
              (duplicados)
            </p>
          )}
          {reporte.errores.length > 0 && (
            <div className="overflow-x-auto rounded border border-red-200">
              <table className="min-w-full text-sm">
                <thead className="bg-red-50 text-left text-red-900">
                  <tr>
                    <th className="px-3 py-2 font-medium">Fila</th>
                    <th className="px-3 py-2 font-medium">Error</th>
                  </tr>
                </thead>
                <tbody>
                  {reporte.errores.map((e, i) => (
                    <tr key={`${e.fila}-${i}`} className="border-t border-red-100">
                      <td className="px-3 py-2 text-red-700">{e.fila}</td>
                      <td className="px-3 py-2 text-red-700">{e.mensaje}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
