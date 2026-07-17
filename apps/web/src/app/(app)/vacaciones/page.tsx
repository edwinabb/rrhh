'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/components/auth-context';
import {
  actualizarPeriodo,
  crearPeriodo,
  EmpleadoResumen,
  listarEmpleados,
  listarPeriodos,
  VacacionPeriodo,
} from './vacations-api';

const ESTADO_LABELS: Record<string, string> = {
  EN_CURSO: 'En curso',
  VENCIDO_PENDIENTE: 'Vencido pendiente',
  GOZADO: 'Gozado',
  LIQUIDADO: 'Liquidado',
};

/** Un período vencido hace más de 10 meses sin gozar está próximo a generar indemnización (art. 23 D.Leg. 713). */
function alertaIndemnizacion(p: VacacionPeriodo): boolean {
  if (p.estado !== 'VENCIDO_PENDIENTE') return false;
  const limite = new Date(p.periodoFin);
  limite.setMonth(limite.getMonth() + 10);
  return Date.now() > limite.getTime();
}

export default function VacacionesPage() {
  const { hasPermission } = useAuth();
  const puedeGestionar = hasPermission('vacation.manage');
  const [empleados, setEmpleados] = useState<EmpleadoResumen[]>([]);
  const [employeeId, setEmployeeId] = useState('');
  const [periodos, setPeriodos] = useState<VacacionPeriodo[]>([]);
  const [nuevoInicio, setNuevoInicio] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);

  useEffect(() => {
    listarEmpleados().then(setEmpleados).catch((e) => setError(e.message));
  }, []);

  async function cargar(id: string) {
    setEmployeeId(id);
    setError(null);
    if (!id) return setPeriodos([]);
    setCargando(true);
    try {
      setPeriodos(await listarPeriodos(id));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCargando(false);
    }
  }

  async function onCrear() {
    if (!employeeId || !nuevoInicio) return;
    setError(null);
    try {
      await crearPeriodo(employeeId, nuevoInicio);
      setNuevoInicio('');
      await cargar(employeeId);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function onGozados(p: VacacionPeriodo, valor: string) {
    const dias = Number(valor);
    if (Number.isNaN(dias)) return;
    setError(null);
    try {
      await actualizarPeriodo(p.id, { diasGozados: dias });
      await cargar(employeeId);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Récord vacacional</h1>
      {error && <p className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      <div className="flex items-end gap-3">
        <label className="block text-sm">
          Empleado
          <select
            value={employeeId}
            onChange={(e) => cargar(e.target.value)}
            className="mt-1 block w-72 rounded border border-slate-300 px-2 py-1.5"
          >
            <option value="">— Seleccionar —</option>
            {empleados.map((e) => (
              <option key={e.id} value={e.id}>
                {e.apellidos}, {e.nombres} ({e.numeroDocumento})
              </option>
            ))}
          </select>
        </label>
        {puedeGestionar && employeeId && (
          <>
            <label className="block text-sm">
              Inicio del período (aniversario)
              <input
                type="date"
                value={nuevoInicio}
                onChange={(e) => setNuevoInicio(e.target.value)}
                className="mt-1 block rounded border border-slate-300 px-2 py-1.5"
              />
            </label>
            <button
              onClick={onCrear}
              disabled={!nuevoInicio}
              className="rounded bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              Agregar período
            </button>
          </>
        )}
      </div>

      {cargando && <p className="text-sm text-slate-500">Cargando…</p>}
      {employeeId && !cargando && (
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-slate-500">
              <th className="py-2">Período</th>
              <th>Ganados</th>
              <th>Gozados</th>
              <th>Pendientes</th>
              <th>Estado</th>
              <th>Alerta</th>
            </tr>
          </thead>
          <tbody>
            {periodos.map((p) => (
              <tr key={p.id} className="border-b border-slate-100">
                <td className="py-2">
                  {p.periodoInicio.slice(0, 10)} → {p.periodoFin.slice(0, 10)}
                </td>
                <td>{p.diasGanados}</td>
                <td>
                  {puedeGestionar && p.estado !== 'LIQUIDADO' ? (
                    <input
                      type="number"
                      defaultValue={Number(p.diasGozados)}
                      min={0}
                      max={p.diasGanados}
                      onBlur={(e) => onGozados(p, e.target.value)}
                      className="w-20 rounded border border-slate-300 px-2 py-1"
                    />
                  ) : (
                    Number(p.diasGozados)
                  )}
                </td>
                <td>{p.diasGanados - Number(p.diasGozados)}</td>
                <td>{ESTADO_LABELS[p.estado]}</td>
                <td>
                  {alertaIndemnizacion(p) && (
                    <span className="rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-800">
                      Riesgo de indemnización (art. 23)
                    </span>
                  )}
                </td>
              </tr>
            ))}
            {periodos.length === 0 && (
              <tr>
                <td colSpan={6} className="py-4 text-slate-500">
                  Sin períodos registrados.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      )}
    </div>
  );
}
