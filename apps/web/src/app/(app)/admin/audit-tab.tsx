'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  ApiError,
  fetchAuditLog,
  formatDateTime,
  formatJsonValue,
  type AuditLogEntry,
} from './admin-api';

const ACTION_STYLES: Record<string, string> = {
  INSERT: 'bg-emerald-50 text-emerald-700',
  UPDATE: 'bg-amber-50 text-amber-700',
  DELETE: 'bg-red-50 text-red-700',
};

function shortId(id: string | null): string {
  if (!id) return '—';
  return id.length > 8 ? `${id.slice(0, 8)}…` : id;
}

/**
 * GET /audit-log: filtros reales del endpoint = tabla y registroId.
 * Devuelve como máximo 200 entradas, más recientes primero (sin paginación).
 */
export default function AuditTab() {
  const [entries, setEntries] = useState<AuditLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [tabla, setTabla] = useState('');
  const [registroId, setRegistroId] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const load = useCallback(async (filters: { tabla?: string; registroId?: string }) => {
    setLoading(true);
    setError(null);
    try {
      setEntries(await fetchAuditLog(filters));
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : 'No se pudo cargar el log de auditoría.',
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load({});
  }, [load]);

  function handleFilter(e: React.FormEvent) {
    e.preventDefault();
    void load({
      tabla: tabla.trim() || undefined,
      registroId: registroId.trim() || undefined,
    });
  }

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-5">
      <div className="mb-4">
        <h2 className="text-sm font-semibold text-slate-900">Log de auditoría</h2>
        <p className="mt-1 text-sm text-slate-500">
          Registro inmutable (append-only a nivel de base de datos). Se muestran las últimas 200
          entradas, más recientes primero.
        </p>
      </div>

      <form onSubmit={handleFilter} className="mb-4 flex flex-wrap items-end gap-3">
        <div>
          <label className="mb-1 block text-sm font-medium" htmlFor="filtro-tabla">
            Tabla
          </label>
          <input
            id="filtro-tabla"
            type="text"
            value={tabla}
            onChange={(e) => setTabla(e.target.value)}
            placeholder="Ej: employee"
            className="rounded border border-slate-300 px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium" htmlFor="filtro-registro">
            ID de registro
          </label>
          <input
            id="filtro-registro"
            type="text"
            value={registroId}
            onChange={(e) => setRegistroId(e.target.value)}
            placeholder="UUID del registro"
            className="w-72 rounded border border-slate-300 px-3 py-2 text-sm"
          />
        </div>
        <button
          type="submit"
          disabled={loading}
          className="rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          Filtrar
        </button>
      </form>

      {loading && <p className="text-sm text-slate-500">Cargando...</p>}
      {error && <p className="text-sm text-red-600">{error}</p>}

      {!loading && !error && entries.length === 0 && (
        <p className="text-sm text-slate-500">No hay entradas de auditoría para los filtros dados.</p>
      )}

      {!loading && !error && entries.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-slate-500">
                <th className="py-2 pr-4 font-medium">Fecha</th>
                <th className="py-2 pr-4 font-medium">Usuario</th>
                <th className="py-2 pr-4 font-medium">Tabla</th>
                <th className="py-2 pr-4 font-medium">Acción</th>
                <th className="py-2 pr-4 font-medium">Registro</th>
                <th className="py-2 font-medium">Detalle</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => {
                const key = String(entry.id);
                const expanded = expandedId === key;
                return (
                  <FragmentRow
                    key={key}
                    entry={entry}
                    expanded={expanded}
                    onToggle={() => setExpandedId(expanded ? null : key)}
                  />
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function FragmentRow({
  entry,
  expanded,
  onToggle,
}: {
  entry: AuditLogEntry;
  expanded: boolean;
  onToggle: () => void;
}) {
  const actionClass = ACTION_STYLES[entry.accion] ?? 'bg-slate-100 text-slate-700';
  return (
    <>
      <tr className="border-b border-slate-100 align-top">
        <td className="whitespace-nowrap py-2 pr-4 text-slate-700">
          {formatDateTime(entry.createdAt)}
        </td>
        <td className="py-2 pr-4 font-mono text-xs text-slate-600" title={entry.userId ?? undefined}>
          {entry.userId ? shortId(entry.userId) : 'Sistema'}
        </td>
        <td className="py-2 pr-4 font-mono text-xs text-slate-700">{entry.tabla}</td>
        <td className="py-2 pr-4">
          <span className={`rounded px-2 py-0.5 text-xs font-medium ${actionClass}`}>
            {entry.accion}
          </span>
        </td>
        <td
          className="py-2 pr-4 font-mono text-xs text-slate-600"
          title={entry.registroId ?? undefined}
        >
          {shortId(entry.registroId)}
        </td>
        <td className="py-2">
          <button
            type="button"
            onClick={onToggle}
            className="text-xs font-medium text-slate-500 underline hover:text-slate-900"
          >
            {expanded ? 'Ocultar valores' : 'Ver valores'}
          </button>
        </td>
      </tr>
      {expanded && (
        <tr className="border-b border-slate-100 bg-slate-50">
          <td colSpan={6} className="px-3 py-3">
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <p className="mb-1 text-xs font-medium text-slate-500">Valores anteriores</p>
                <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all rounded border border-slate-200 bg-white p-2 font-mono text-xs text-slate-700">
                  {formatJsonValue(entry.valoresAnteriores)}
                </pre>
              </div>
              <div>
                <p className="mb-1 text-xs font-medium text-slate-500">Valores nuevos</p>
                <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all rounded border border-slate-200 bg-white p-2 font-mono text-xs text-slate-700">
                  {formatJsonValue(entry.valoresNuevos)}
                </pre>
              </div>
            </div>
            {(entry.ipOrigen || entry.requestId) && (
              <p className="mt-2 text-xs text-slate-500">
                {entry.ipOrigen ? `IP: ${entry.ipOrigen}` : ''}
                {entry.ipOrigen && entry.requestId ? ' · ' : ''}
                {entry.requestId ? `Request: ${entry.requestId}` : ''}
              </p>
            )}
          </td>
        </tr>
      )}
    </>
  );
}
