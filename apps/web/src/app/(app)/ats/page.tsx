'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/components/auth-context';
import {
  cerrarVacante,
  crearVacante,
  formatRangoSalarial,
  listarVacantes,
  type Vacante,
} from './ats-api';
import { VacanteBadge } from './badges';

function NuevaVacanteForm({
  onCreated,
  onCancel,
}: {
  onCreated: (vacante: Vacante) => void;
  onCancel: () => void;
}) {
  const [titulo, setTitulo] = useState('');
  const [descripcion, setDescripcion] = useState('');
  const [requisitos, setRequisitos] = useState('');
  const [salarioMin, setSalarioMin] = useState('');
  const [salarioMax, setSalarioMax] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const min = salarioMin.trim() === '' ? undefined : Number(salarioMin);
    const max = salarioMax.trim() === '' ? undefined : Number(salarioMax);
    if ((min !== undefined && (Number.isNaN(min) || min < 0)) ||
        (max !== undefined && (Number.isNaN(max) || max < 0))) {
      setError('Los salarios deben ser números válidos.');
      return;
    }
    if (min !== undefined && max !== undefined && min > max) {
      setError('El salario mínimo no puede ser mayor que el máximo.');
      return;
    }

    setSaving(true);
    try {
      const vacante = await crearVacante({
        titulo: titulo.trim(),
        descripcion: descripcion.trim(),
        // Estructura libre en el backend: se envía como lista de líneas.
        requisitos: requisitos
          .split('\n')
          .map((linea) => linea.trim())
          .filter(Boolean),
        salarioMin: min,
        salarioMax: max,
      });
      onCreated(vacante);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo crear la vacante.');
      setSaving(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="mb-6 rounded-lg border border-slate-200 bg-white p-6 shadow-sm"
    >
      <h2 className="mb-4 text-base font-semibold">Nueva vacante</h2>

      <label className="mb-1 block text-sm font-medium" htmlFor="titulo">
        Título
      </label>
      <input
        id="titulo"
        type="text"
        required
        value={titulo}
        onChange={(e) => setTitulo(e.target.value)}
        className="mb-4 w-full rounded border border-slate-300 px-3 py-2 text-sm"
      />

      <label className="mb-1 block text-sm font-medium" htmlFor="descripcion">
        Descripción
      </label>
      <textarea
        id="descripcion"
        required
        rows={3}
        value={descripcion}
        onChange={(e) => setDescripcion(e.target.value)}
        className="mb-4 w-full rounded border border-slate-300 px-3 py-2 text-sm"
      />

      <label className="mb-1 block text-sm font-medium" htmlFor="requisitos">
        Requisitos (uno por línea)
      </label>
      <textarea
        id="requisitos"
        rows={4}
        value={requisitos}
        onChange={(e) => setRequisitos(e.target.value)}
        placeholder={'Ej.:\n3 años de experiencia en ventas\nInglés intermedio'}
        className="mb-4 w-full rounded border border-slate-300 px-3 py-2 text-sm"
      />

      <div className="mb-4 grid grid-cols-2 gap-4">
        <div>
          <label className="mb-1 block text-sm font-medium" htmlFor="salarioMin">
            Salario mínimo (S/)
          </label>
          <input
            id="salarioMin"
            type="number"
            min="0"
            step="0.01"
            value={salarioMin}
            onChange={(e) => setSalarioMin(e.target.value)}
            className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium" htmlFor="salarioMax">
            Salario máximo (S/)
          </label>
          <input
            id="salarioMax"
            type="number"
            min="0"
            step="0.01"
            value={salarioMax}
            onChange={(e) => setSalarioMax(e.target.value)}
            className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
          />
        </div>
      </div>

      {error && <p className="mb-4 text-sm text-red-600">{error}</p>}

      <div className="flex gap-3">
        <button
          type="submit"
          disabled={saving}
          className="rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {saving ? 'Creando...' : 'Crear vacante'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          className="rounded border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50"
        >
          Cancelar
        </button>
      </div>
    </form>
  );
}

export default function AtsPage() {
  const { hasPermission } = useAuth();
  const canManage = hasPermission('ats.manage');

  const [vacantes, setVacantes] = useState<Vacante[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [closingId, setClosingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setVacantes(await listarVacantes());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudieron cargar las vacantes.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleCerrar(vacante: Vacante) {
    if (!window.confirm(`¿Cerrar la vacante "${vacante.titulo}"? Esta acción es definitiva.`)) {
      return;
    }
    setActionError(null);
    setClosingId(vacante.id);
    try {
      const actualizada = await cerrarVacante(vacante.id);
      setVacantes((prev) => prev.map((v) => (v.id === actualizada.id ? actualizada : v)));
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : 'No se pudo cerrar la vacante.',
      );
    } finally {
      setClosingId(null);
    }
  }

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-semibold">Reclutamiento</h1>
        {canManage && !showForm && (
          <button
            type="button"
            onClick={() => setShowForm(true)}
            className="rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white"
          >
            Nueva vacante
          </button>
        )}
      </div>

      {showForm && (
        <NuevaVacanteForm
          onCreated={(vacante) => {
            setVacantes((prev) => [vacante, ...prev]);
            setShowForm(false);
          }}
          onCancel={() => setShowForm(false)}
        />
      )}

      {actionError && <p className="mb-4 text-sm text-red-600">{actionError}</p>}

      {loading ? (
        <p className="text-sm text-slate-500">Cargando...</p>
      ) : error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4">
          <p className="text-sm text-red-700">{error}</p>
          <button
            type="button"
            onClick={() => void load()}
            className="mt-2 rounded border border-red-300 px-3 py-1.5 text-sm text-red-700 hover:bg-red-100"
          >
            Reintentar
          </button>
        </div>
      ) : vacantes.length === 0 ? (
        <p className="text-sm text-slate-500">No hay vacantes registradas.</p>
      ) : (
        <ul className="space-y-3">
          {vacantes.map((vacante) => (
            <li
              key={vacante.id}
              className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <Link
                      href={`/ats/${vacante.id}`}
                      className="truncate text-sm font-semibold text-slate-900 hover:underline"
                    >
                      {vacante.titulo}
                    </Link>
                    <VacanteBadge estado={vacante.estado} />
                  </div>
                  <p className="mt-1 line-clamp-2 text-sm text-slate-600">
                    {vacante.descripcion}
                  </p>
                  <p className="mt-1 text-sm text-slate-500">
                    Salario: {formatRangoSalarial(vacante)}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Link
                    href={`/ats/${vacante.id}`}
                    className="rounded border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100"
                  >
                    Ver detalle
                  </Link>
                  {canManage && vacante.estado !== 'CERRADA' && (
                    <button
                      type="button"
                      onClick={() => void handleCerrar(vacante)}
                      disabled={closingId === vacante.id}
                      className="rounded border border-red-300 px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
                    >
                      {closingId === vacante.id ? 'Cerrando...' : 'Cerrar'}
                    </button>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
