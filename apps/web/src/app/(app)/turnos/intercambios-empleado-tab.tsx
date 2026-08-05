'use client';

import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/components/auth-context';
import { EmpleadoResumen, listarEmpleados } from '../vacaciones/vacations-api';
import {
  IntercambioTurno, proponerIntercambio, listarMisPropuestasIntercambio,
  listarPropuestasParaMiIntercambio, aceptarIntercambio, rechazarIntercambioPorB,
} from './shifts-api';

const COLOR_ESTADO: Record<string, string> = {
  PENDIENTE_ACEPTACION_B: 'bg-yellow-100 text-yellow-800',
  ACEPTADA_POR_B: 'bg-blue-100 text-blue-800',
  RECHAZADA_POR_B: 'bg-red-100 text-red-800',
  APROBADA_MANAGER: 'bg-emerald-100 text-emerald-800',
  AUTO_APROBADA: 'bg-emerald-100 text-emerald-800',
  RECHAZADA_MANAGER: 'bg-red-100 text-red-800',
  RECHAZADA_AUTOMATICA: 'bg-red-100 text-red-800',
};

export function IntercambiosEmpleadoTab() {
  const { me } = useAuth();
  const [misPropuestas, setMisPropuestas] = useState<IntercambioTurno[]>([]);
  const [propuestasParaMi, setPropuestasParaMi] = useState<IntercambioTurno[]>([]);
  const [empleados, setEmpleados] = useState<EmpleadoResumen[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({ employeeIdB: '', fecha: '', mensajeA: '' });
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!me?.userId) return;
    refrescar();
    listarEmpleados().then(setEmpleados).catch((e) => setError((e as Error).message));
  }, [me?.userId]);

  async function refrescar() {
    setError(null);
    setIsLoading(true);
    try {
      const [mias, paraMi] = await Promise.all([
        listarMisPropuestasIntercambio(),
        listarPropuestasParaMiIntercambio(),
      ]);
      setMisPropuestas(mias);
      setPropuestasParaMi(paraMi);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setIsLoading(false);
    }
  }

  const nombreEmpleado = useMemo(
    () => (id: string) => {
      const emp = empleados.find((e) => e.id === id);
      return emp ? `${emp.nombres} ${emp.apellidos}` : id.slice(0, 8);
    },
    [empleados],
  );

  const handleProponer = async () => {
    if (!form.employeeIdB || !form.fecha) {
      setError('Debe seleccionar un empleado y una fecha');
      return;
    }
    setError(null);
    setSuccess(null);
    setIsSaving(true);
    try {
      await proponerIntercambio(form);
      setSuccess('Propuesta de intercambio enviada');
      setShowModal(false);
      setForm({ employeeIdB: '', fecha: '', mensajeA: '' });
      await refrescar();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setIsSaving(false);
    }
  };

  const handleAceptar = async (id: string) => {
    setError(null);
    try {
      await aceptarIntercambio(id);
      setSuccess('Intercambio aceptado, pendiente de aprobación del manager');
      await refrescar();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const handleRechazar = async (id: string) => {
    setError(null);
    try {
      await rechazarIntercambioPorB(id);
      setSuccess('Propuesta rechazada');
      await refrescar();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div className="space-y-6 text-sm">
      {error && <p className="rounded bg-red-50 px-3 py-2 text-red-700">{error}</p>}
      {success && <p className="rounded bg-emerald-50 px-3 py-2 text-emerald-700">{success}</p>}

      <div className="flex items-center justify-between">
        <h2 className="font-semibold text-slate-800">Propuestas para mí</h2>
        <button
          onClick={() => setShowModal(true)}
          className="rounded bg-slate-900 px-4 py-2 font-medium text-white hover:bg-slate-800"
        >
          + PROPONER INTERCAMBIO
        </button>
      </div>

      {isLoading ? (
        <p className="text-slate-500">Cargando...</p>
      ) : propuestasParaMi.length === 0 ? (
        <p className="rounded bg-slate-50 px-3 py-3 text-slate-500">No tienes propuestas pendientes.</p>
      ) : (
        <div className="space-y-3">
          {propuestasParaMi.map((it) => (
            <div key={it.id} className="rounded border border-slate-200 bg-white p-4">
              <div className="mb-2 flex items-start justify-between">
                <div>
                  <p className="text-slate-700">
                    <span className="font-medium">{nombreEmpleado(it.employeeIdA)}</span> propone intercambiar el{' '}
                    <span className="font-medium">{it.fecha.slice(0, 10)}</span>
                  </p>
                  {it.mensajeA && <p className="mt-1 text-xs text-slate-500">Mensaje: {it.mensajeA}</p>}
                </div>
                <span className={`rounded px-2 py-1 text-xs font-medium ${COLOR_ESTADO[it.estado] ?? ''}`}>
                  {it.estado}
                </span>
              </div>
              {it.estado === 'PENDIENTE_ACEPTACION_B' && (
                <div className="mt-2 flex gap-2">
                  <button
                    onClick={() => handleAceptar(it.id)}
                    className="rounded bg-emerald-600 px-3 py-1 text-xs font-medium text-white hover:bg-emerald-700"
                  >
                    Aceptar
                  </button>
                  <button
                    onClick={() => handleRechazar(it.id)}
                    className="rounded border border-slate-300 px-3 py-1 text-xs font-medium hover:bg-slate-50"
                  >
                    Rechazar
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <h2 className="font-semibold text-slate-800">Mis propuestas</h2>
      {misPropuestas.length === 0 ? (
        <p className="rounded bg-slate-50 px-3 py-3 text-slate-500">No has propuesto ningún intercambio.</p>
      ) : (
        <div className="space-y-3">
          {misPropuestas.map((it) => (
            <div key={it.id} className="rounded border border-slate-200 bg-white p-4">
              <div className="flex items-start justify-between">
                <p className="text-slate-700">
                  Propuesta a <span className="font-medium">{nombreEmpleado(it.employeeIdB)}</span> para el{' '}
                  <span className="font-medium">{it.fecha.slice(0, 10)}</span>
                </p>
                <span className={`rounded px-2 py-1 text-xs font-medium ${COLOR_ESTADO[it.estado] ?? ''}`}>
                  {it.estado}
                </span>
              </div>
              {it.motivoRechazo && (
                <p className="mt-2 rounded bg-red-50 p-2 text-xs text-red-700">Motivo: {it.motivoRechazo}</p>
              )}
            </div>
          ))}
        </div>
      )}

      {showModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50"
          onClick={(e) => e.target === e.currentTarget && !isSaving && setShowModal(false)}
          role="presentation"
        >
          <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-lg" role="dialog" aria-modal="true">
            <h2 className="mb-4 text-lg font-semibold">Proponer intercambio de turno</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700">Empleado</label>
                <select
                  value={form.employeeIdB}
                  onChange={(e) => setForm({ ...form, employeeIdB: e.target.value })}
                  disabled={isSaving}
                  className="mt-1 block w-full rounded border border-slate-300 px-3 py-2"
                >
                  <option value="">— Seleccionar —</option>
                  {empleados.filter((e) => e.id !== me?.userId).map((emp) => (
                    <option key={emp.id} value={emp.id}>{emp.nombres} {emp.apellidos}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700">Fecha (futura)</label>
                <input
                  type="date"
                  value={form.fecha}
                  onChange={(e) => setForm({ ...form, fecha: e.target.value })}
                  min={new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10)}
                  disabled={isSaving}
                  className="mt-1 block w-full rounded border border-slate-300 px-3 py-2"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700">Mensaje (opcional)</label>
                <textarea
                  value={form.mensajeA}
                  onChange={(e) => setForm({ ...form, mensajeA: e.target.value })}
                  disabled={isSaving}
                  className="mt-1 block w-full rounded border border-slate-300 px-3 py-2"
                  rows={2}
                />
              </div>
            </div>
            <div className="mt-6 flex justify-end gap-3">
              <button
                onClick={() => setShowModal(false)}
                disabled={isSaving}
                className="rounded border border-slate-300 px-4 py-2 font-medium text-slate-700 hover:bg-slate-50"
              >
                Cancelar
              </button>
              <button
                onClick={handleProponer}
                disabled={isSaving}
                className="rounded bg-slate-900 px-4 py-2 font-medium text-white hover:bg-slate-800 disabled:opacity-50"
              >
                {isSaving ? 'Enviando...' : 'Proponer'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
