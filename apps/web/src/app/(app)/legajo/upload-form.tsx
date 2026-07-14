'use client';

import { useRef, useState } from 'react';
import {
  SesionExpiradaError,
  TIPO_LABELS,
  TIPOS_DOCUMENTO,
  uploadDocument,
  type TipoDocumento,
} from './api';

interface UploadFormProps {
  employeeId: string;
  /** Se invoca tras subir con éxito para que el padre recargue el legajo. */
  onUploaded: () => void;
  onSessionExpired: () => void;
}

export function UploadForm({ employeeId, onUploaded, onSessionExpired }: UploadFormProps) {
  const [tipo, setTipo] = useState<TipoDocumento>('CONTRATO');
  const [file, setFile] = useState<File | null>(null);
  const [requiereConsentimiento, setRequiereConsentimiento] = useState(false);
  const [subiendo, setSubiendo] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exito, setExito] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setExito(null);
    if (!file) {
      setError('Selecciona un archivo.');
      return;
    }
    setSubiendo(true);
    try {
      await uploadDocument({ employeeId, tipo, file, requiereConsentimiento });
      setExito(`Documento "${file.name}" subido correctamente.`);
      setFile(null);
      setRequiereConsentimiento(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
      onUploaded();
    } catch (err) {
      if (err instanceof SesionExpiradaError) return onSessionExpired();
      setError(err instanceof Error ? err.message : 'No se pudo subir el documento');
    } finally {
      setSubiendo(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-lg border border-slate-200 bg-white p-4"
    >
      <h2 className="mb-3 text-sm font-semibold">Subir documento</h2>

      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="mb-1 block text-sm font-medium" htmlFor="tipo-documento">
            Tipo
          </label>
          <select
            id="tipo-documento"
            value={tipo}
            onChange={(e) => setTipo(e.target.value as TipoDocumento)}
            className="rounded border border-slate-300 px-3 py-2 text-sm"
          >
            {TIPOS_DOCUMENTO.map((t) => (
              <option key={t} value={t}>
                {TIPO_LABELS[t]}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium" htmlFor="archivo">
            Archivo
          </label>
          <input
            id="archivo"
            ref={fileInputRef}
            type="file"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="block text-sm text-slate-700 file:mr-3 file:rounded file:border file:border-slate-300 file:bg-white file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-slate-700 hover:file:bg-slate-100"
          />
        </div>

        <label className="flex items-center gap-2 py-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={requiereConsentimiento}
            onChange={(e) => setRequiereConsentimiento(e.target.checked)}
            className="rounded border-slate-300"
          />
          Contiene datos sensibles (requiere consentimiento)
        </label>

        <button
          type="submit"
          disabled={subiendo}
          className="rounded bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {subiendo ? 'Subiendo...' : 'Subir'}
        </button>
      </div>

      <p className="mt-2 text-xs text-slate-500">
        Si el empleado ya tiene un documento activo del mismo tipo, se guardará como una nueva
        versión.
      </p>

      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
      {exito && <p className="mt-2 text-sm text-green-700">{exito}</p>}
    </form>
  );
}
