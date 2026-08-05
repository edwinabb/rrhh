'use client';

import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/components/auth-context';
import { EmpleadoResumen, listarEmpleados } from '../vacaciones/vacations-api';
import {
  IntercambioTurno, listarIntercambiosPendientes, aprobarIntercambio, rechazarIntercambioManager,
} from './shifts-api';

export function IntercambiosManagerTab() {
  const { hasPermission } = useAuth();
  const puedeGestionar = hasPermission('shift.resolve');

  const [pendientes, setPendientes] = useState<IntercambioTurno[]>([]);
  const [empleados, setEmpleados] = useState<EmpleadoResumen[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [motivoPorId, setMotivoPorId] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!puedeGestionar) return;
    refrescar();
    listarEmpleados().then(setEmpleados).catch((e) => setError((e as Error).message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [puedeGestionar]);

  async function refrescar() {
    setError(null);
    setIsLoading(true);
    try {
      setPendientes(await listarIntercambiosPendientes());
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

  const handleAprobar = async (id: string) => {
    setError(null);
    try {
      await aprobarIntercambio(id);
      setSuccess('Intercambio aprobado');
      await refrescar();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const handleRechazar = async (id: string) => {
    setError(null);
    try {
      await rechazarIntercambioManager(id, motivoPorId[id]);
      setSuccess('Intercambio rechazado');
      await refrescar();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  if (!puedeGestionar) {
    return (
      <div className="rounded bg-yellow-50 px-4 py-3 text-yellow-800">
        <p className="font-medium">Acceso denegado</p>
        <p className="text-sm">No tienes permisos para gestionar intercambios de turno.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 text-sm">
      {error && <p className="rounded bg-red-50 px-3 py-2 text-red-700">{error}</p>}
      {success && <p className="rounded bg-emerald-50 px-3 py-2 text-emerald-700">{success}</p>}

      <h2 className="font-semibold text-slate-800">Intercambios pendientes de aprobación</h2>

      {isLoading ? (
        <p className="text-slate-500">Cargando...</p>
      ) : pendientes.length === 0 ? (
        <p className="rounded bg-slate-50 px-3 py-3 text-slate-500">No hay intercambios pendientes.</p>
      ) : (
        <div className="space-y-3">
          {pendientes.map((it) => (
            <div key={it.id} className="rounded border border-slate-200 bg-white p-4">
              <div className="mb-3">
                <p className="text-slate-700">
                  <span className="font-medium">{nombreEmpleado(it.employeeIdA)}</span> ({it.turnoActualA}) ↔{' '}
                  <span className="font-medium">{nombreEmpleado(it.employeeIdB)}</span> ({it.turnoActualB})
                </p>
                <p className="text-xs text-slate-500">Fecha: {it.fecha.slice(0, 10)}</p>
              </div>
              <input
                type="text"
                placeholder="Motivo de rechazo (opcional)"
                value={motivoPorId[it.id] ?? ''}
                onChange={(e) => setMotivoPorId({ ...motivoPorId, [it.id]: e.target.value })}
                className="mb-3 block w-full rounded border border-slate-300 px-3 py-1.5 text-xs"
              />
              <div className="flex gap-2">
                <button
                  onClick={() => handleAprobar(it.id)}
                  className="rounded bg-emerald-600 px-3 py-1 text-xs font-medium text-white hover:bg-emerald-700"
                >
                  Aprobar
                </button>
                <button
                  onClick={() => handleRechazar(it.id)}
                  className="rounded border border-slate-300 px-3 py-1 text-xs font-medium hover:bg-slate-50"
                >
                  Rechazar
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
