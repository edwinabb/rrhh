'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/components/auth-context';
import {
  ApiError,
  KNOWN_PARAM_CODES,
  createNormativeParamVersion,
  formatDate,
  formatJsonValue,
  resolveNormativeParam,
  type NormativeParamRecord,
} from './admin-api';

interface ParamRow {
  codigo: string;
  /** null = sin valor vigente a la fecha consultada (404 del endpoint). */
  valor: unknown | null;
  vigente: boolean;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * GET /normative-params solo resuelve un código a una fecha ({codigo, fecha, valor}),
 * no expone listado ni vigencias históricas. La tabla se arma resolviendo los
 * códigos conocidos del sistema a la fecha elegida; la vigencia desde/hasta y la
 * descripción solo están disponibles en la respuesta del POST (nueva versión).
 */
export default function ParamsTab() {
  const { hasPermission } = useAuth();
  const canWrite = hasPermission('normative_param.write');

  const [fecha, setFecha] = useState(todayIso());
  const [rows, setRows] = useState<ParamRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Códigos extra consultados manualmente (además de los conocidos del seed).
  const [extraCodes, setExtraCodes] = useState<string[]>([]);
  const [customCode, setCustomCode] = useState('');

  const loadParams = useCallback(async (fechaConsulta: string, codes: string[]) => {
    setLoading(true);
    setError(null);
    try {
      const allCodes = [...KNOWN_PARAM_CODES, ...codes];
      const results = await Promise.all(
        allCodes.map(async (codigo): Promise<ParamRow> => {
          try {
            const resolved = await resolveNormativeParam(codigo, fechaConsulta);
            return { codigo, valor: resolved.valor, vigente: true };
          } catch (err) {
            if (err instanceof ApiError && err.status === 404) {
              return { codigo, valor: null, vigente: false };
            }
            throw err;
          }
        }),
      );
      setRows(results);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : 'No se pudieron cargar los parámetros normativos.',
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadParams(fecha, extraCodes);
  }, [fecha, extraCodes, loadParams]);

  function handleAddCustomCode(e: React.FormEvent) {
    e.preventDefault();
    const code = customCode.trim().toUpperCase();
    if (!code) return;
    if (!extraCodes.includes(code) && !(KNOWN_PARAM_CODES as readonly string[]).includes(code)) {
      setExtraCodes((prev) => [...prev, code]);
    }
    setCustomCode('');
  }

  return (
    <div className="space-y-6">
      <section className="rounded-lg border border-slate-200 bg-white p-5">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">Parámetros normativos vigentes</h2>
            <p className="mt-1 text-sm text-slate-500">
              Valores resueltos por vigencia a la fecha consultada (la API no expone el historial
              completo, solo el valor vigente por código).
            </p>
          </div>
          <div className="flex items-end gap-3">
            <div>
              <label className="mb-1 block text-sm font-medium" htmlFor="fecha-consulta">
                Fecha de consulta
              </label>
              <input
                id="fecha-consulta"
                type="date"
                value={fecha}
                onChange={(e) => setFecha(e.target.value)}
                className="rounded border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
            <form onSubmit={handleAddCustomCode} className="flex items-end gap-2">
              <div>
                <label className="mb-1 block text-sm font-medium" htmlFor="codigo-extra">
                  Consultar otro código
                </label>
                <input
                  id="codigo-extra"
                  type="text"
                  value={customCode}
                  onChange={(e) => setCustomCode(e.target.value)}
                  placeholder="EJ: MI_PARAMETRO"
                  className="rounded border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
              <button
                type="submit"
                className="rounded border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
              >
                Agregar
              </button>
            </form>
          </div>
        </div>

        {loading && <p className="text-sm text-slate-500">Cargando...</p>}
        {error && <p className="text-sm text-red-600">{error}</p>}

        {!loading && !error && (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500">
                  <th className="py-2 pr-4 font-medium">Código</th>
                  <th className="py-2 pr-4 font-medium">Valor vigente</th>
                  <th className="py-2 font-medium">Estado</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.codigo} className="border-b border-slate-100">
                    <td className="py-2 pr-4 font-mono text-xs text-slate-900">{row.codigo}</td>
                    <td className="py-2 pr-4">
                      {row.vigente ? (
                        <pre className="whitespace-pre-wrap break-all font-mono text-xs text-slate-700">
                          {formatJsonValue(row.valor)}
                        </pre>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                    <td className="py-2">
                      {row.vigente ? (
                        <span className="rounded bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">
                          Vigente
                        </span>
                      ) : (
                        <span className="rounded bg-red-50 px-2 py-0.5 text-xs font-medium text-red-600">
                          Sin valor vigente
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {canWrite && (
        <NewVersionForm onCreated={() => void loadParams(fecha, extraCodes)} />
      )}
    </div>
  );
}

function NewVersionForm({ onCreated }: { onCreated: () => void }) {
  const [codigo, setCodigo] = useState('');
  const [valorText, setValorText] = useState('');
  const [vigenciaDesde, setVigenciaDesde] = useState(todayIso());
  const [descripcion, setDescripcion] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<NormativeParamRecord | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setCreated(null);

    // Validación JSON en cliente antes de enviar.
    let valor: unknown;
    try {
      valor = JSON.parse(valorText);
    } catch {
      setError('El valor debe ser JSON válido. Ejemplos: 5350, 0.09 o {"tasa": 0.25}');
      return;
    }

    setSubmitting(true);
    try {
      const record = await createNormativeParamVersion({
        codigo: codigo.trim().toUpperCase(),
        valor,
        vigenciaDesde,
        descripcion: descripcion.trim() || undefined,
      });
      setCreated(record);
      setCodigo('');
      setValorText('');
      setDescripcion('');
      onCreated();
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : 'No se pudo registrar la nueva versión.',
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-5">
      <h2 className="text-sm font-semibold text-slate-900">Nueva versión de parámetro</h2>
      <p className="mt-1 text-sm text-slate-500">
        Nunca se edita una versión anterior: se cierra su vigencia y se registra una nueva
        (el historial queda preservado para recalcular períodos pasados).
      </p>

      <form onSubmit={handleSubmit} className="mt-4 grid max-w-2xl gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-sm font-medium" htmlFor="np-codigo">
              Código
            </label>
            <input
              id="np-codigo"
              type="text"
              required
              value={codigo}
              onChange={(e) => setCodigo(e.target.value)}
              placeholder="UIT"
              className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium" htmlFor="np-vigencia">
              Vigencia desde
            </label>
            <input
              id="np-vigencia"
              type="date"
              required
              value={vigenciaDesde}
              onChange={(e) => setVigenciaDesde(e.target.value)}
              className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium" htmlFor="np-valor">
            Valor (JSON)
          </label>
          <textarea
            id="np-valor"
            required
            rows={3}
            value={valorText}
            onChange={(e) => setValorText(e.target.value)}
            placeholder='5350  ·  0.09  ·  {"tasa25": 0.25, "tasa35": 0.35}'
            className="w-full rounded border border-slate-300 px-3 py-2 font-mono text-xs"
          />
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium" htmlFor="np-descripcion">
            Descripción (opcional)
          </label>
          <input
            id="np-descripcion"
            type="text"
            value={descripcion}
            onChange={(e) => setDescripcion(e.target.value)}
            placeholder="Ej: UIT 2027 según D.S. publicado en El Peruano"
            className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
          />
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        {created && (
          <div className="rounded border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
            <p className="font-medium text-slate-900">Versión registrada correctamente</p>
            <p className="mt-1">
              <span className="font-mono text-xs">{created.codigo}</span> · vigente desde{' '}
              {formatDate(created.vigenciaDesde)}
              {created.descripcion ? ` · ${created.descripcion}` : ''}
            </p>
            <pre className="mt-1 whitespace-pre-wrap break-all font-mono text-xs">
              {formatJsonValue(created.valor)}
            </pre>
          </div>
        )}

        <div>
          <button
            type="submit"
            disabled={submitting}
            className="rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {submitting ? 'Registrando...' : 'Registrar nueva versión'}
          </button>
        </div>
      </form>
    </section>
  );
}
