'use client';

import { useState } from 'react';
import {
  deleteDocument,
  downloadDocument,
  formatBytes,
  formatFecha,
  SesionExpiradaError,
  TIPO_LABELS,
  type Documento,
} from './api';

interface DocumentsTableProps {
  documentos: Documento[];
  /** Muestra la columna Tipo (útil en búsqueda; en el legajo ya se agrupa por tipo). */
  mostrarTipo?: boolean;
  canDelete: boolean;
  /** Se invoca tras eliminar con éxito para que el padre recargue los datos. */
  onDeleted: () => void;
  onSessionExpired: () => void;
}

export function DocumentsTable({
  documentos,
  mostrarTipo = false,
  canDelete,
  onDeleted,
  onSessionExpired,
}: DocumentsTableProps) {
  const [error, setError] = useState<string | null>(null);
  const [descargandoId, setDescargandoId] = useState<string | null>(null);
  const [aEliminar, setAEliminar] = useState<Documento | null>(null);
  const [motivo, setMotivo] = useState('');
  const [eliminando, setEliminando] = useState(false);
  const [errorModal, setErrorModal] = useState<string | null>(null);

  async function handleDownload(doc: Documento) {
    setError(null);
    setDescargandoId(doc.id);
    try {
      await downloadDocument(doc.id);
    } catch (e) {
      if (e instanceof SesionExpiradaError) return onSessionExpired();
      setError(e instanceof Error ? e.message : 'No se pudo descargar el documento');
    } finally {
      setDescargandoId(null);
    }
  }

  function abrirModalEliminar(doc: Documento) {
    setMotivo('');
    setErrorModal(null);
    setAEliminar(doc);
  }

  async function handleDelete(e: React.FormEvent) {
    e.preventDefault();
    if (!aEliminar) return;
    if (motivo.trim() === '') {
      setErrorModal('El motivo de eliminación es obligatorio.');
      return;
    }
    setErrorModal(null);
    setEliminando(true);
    try {
      await deleteDocument(aEliminar.id, motivo.trim());
      setAEliminar(null);
      onDeleted();
    } catch (err) {
      if (err instanceof SesionExpiradaError) return onSessionExpired();
      setErrorModal(err instanceof Error ? err.message : 'No se pudo eliminar el documento');
    } finally {
      setEliminando(false);
    }
  }

  if (documentos.length === 0) {
    return <p className="text-sm text-slate-500">No hay documentos.</p>;
  }

  return (
    <div>
      {error && <p className="mb-2 text-sm text-red-600">{error}</p>}

      <div className="overflow-x-auto rounded border border-slate-200">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-slate-600">
            <tr>
              <th className="px-3 py-2 font-medium">Archivo</th>
              {mostrarTipo && <th className="px-3 py-2 font-medium">Tipo</th>}
              <th className="px-3 py-2 font-medium">Tamaño</th>
              <th className="px-3 py-2 font-medium">Subido el</th>
              <th className="px-3 py-2 font-medium">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {documentos.map((doc) => (
              <tr key={doc.id} className="border-b border-slate-100 last:border-b-0">
                <td className="px-3 py-2 text-slate-900">
                  {doc.nombreArchivo}
                  {doc.requiereConsentimiento && (
                    <span
                      className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800"
                      title="Contiene datos personales sensibles (Ley 29733)"
                    >
                      Sensible
                    </span>
                  )}
                </td>
                {mostrarTipo && (
                  <td className="px-3 py-2 text-slate-700">
                    {TIPO_LABELS[doc.tipo] ?? doc.tipo}
                  </td>
                )}
                <td className="px-3 py-2 text-slate-700">{formatBytes(doc.tamanoBytes)}</td>
                <td className="px-3 py-2 text-slate-700">{formatFecha(doc.creadoEn)}</td>
                <td className="px-3 py-2">
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => handleDownload(doc)}
                      disabled={descargandoId === doc.id}
                      className="rounded border border-slate-300 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50"
                    >
                      {descargandoId === doc.id ? 'Descargando...' : 'Descargar'}
                    </button>
                    {canDelete && (
                      <button
                        type="button"
                        onClick={() => abrirModalEliminar(doc)}
                        className="rounded border border-red-300 px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-50"
                      >
                        Eliminar
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {aEliminar && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 px-4">
          <form
            onSubmit={handleDelete}
            className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-6 shadow-sm"
          >
            <h2 className="mb-2 text-base font-semibold">Eliminar documento</h2>
            <p className="mb-4 text-sm text-slate-600">
              Vas a eliminar <span className="font-medium">{aEliminar.nombreArchivo}</span>. La
              eliminación es lógica y queda auditada; el motivo es obligatorio (Ley 29733).
            </p>

            <label className="mb-1 block text-sm font-medium" htmlFor="motivo-eliminacion">
              Motivo de eliminación
            </label>
            <textarea
              id="motivo-eliminacion"
              required
              rows={3}
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              className="mb-3 w-full rounded border border-slate-300 px-3 py-2 text-sm"
              placeholder="Ej.: documento cargado por error, solicitud del titular..."
            />

            {errorModal && <p className="mb-3 text-sm text-red-600">{errorModal}</p>}

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setAEliminar(null)}
                disabled={eliminando}
                className="rounded border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={eliminando}
                className="rounded bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
              >
                {eliminando ? 'Eliminando...' : 'Eliminar'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
