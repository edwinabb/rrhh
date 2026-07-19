'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/components/auth-context';
import {
  exportarNovedades, intercambiar, obtenerCumplimiento, registrarMovimiento, ReporteEmpleado,
} from './shifts-api';
import { EmpleadoResumen, listarEmpleados } from '../vacaciones/vacations-api';

export function CumplimientoTab() {
  const { hasPermission } = useAuth();
  const puedeResolver = hasPermission('shift.resolve');
  const puedeExportar = hasPermission('shift.manage');
  const hoy = new Date();
  const [periodo, setPeriodo] = useState(`${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}`);
  const [empleados, setEmpleados] = useState<ReporteEmpleado[]>([]);
  const [todosEmpleados, setTodosEmpleados] = useState<EmpleadoResumen[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [mensaje, setMensaje] = useState<string | null>(null);

  async function refrescar() {
    setError(null);
    try {
      const r = await obtenerCumplimiento(periodo);
      setEmpleados(r.empleados);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => { refrescar(); }, [periodo]);
  useEffect(() => { listarEmpleados().then(setTodosEmpleados).catch(() => undefined); }, []);

  async function onExportar() {
    setError(null);
    try {
      const csv = await exportarNovedades(periodo);
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `novedades-turnos-${periodo}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function onConfirmarGanado(emp: ReporteEmpleado, fecha: string) {
    setError(null);
    setMensaje(null);
    try {
      await registrarMovimiento({ employeeId: emp.employeeId, tipo: 'GANADO', dias: 1, fechaReferencia: fecha, motivo: `Día adicional trabajado el ${fecha}` });
      setMensaje(`Compensatorio +1 registrado para ${emp.apellidos}`);
      await refrescar();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function onIntercambio(emp: ReporteEmpleado, fecha: string) {
    const documento = window.prompt('Documento del empleado con quien intercambió (el titular que no vino):');
    if (!documento) return;
    const otro = todosEmpleados.find((e) => e.numeroDocumento === documento.trim());
    if (!otro) return setError(`No se encontró empleado con documento "${documento}"`);
    setError(null);
    setMensaje(null);
    try {
      await intercambiar({ fecha, employeeIdA: emp.employeeId, employeeIdB: otro.id });
      setMensaje(`Intercambio registrado: ${emp.apellidos} ↔ ${otro.apellidos} (${fecha})`);
      await refrescar();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <div className="space-y-4 text-sm">
      {error && <p className="rounded bg-red-50 px-3 py-2 text-red-700">{error}</p>}
      {mensaje && <p className="rounded bg-emerald-50 px-3 py-2 text-emerald-700">{mensaje}</p>}
      <div className="flex items-end gap-3">
        <label>Período<input type="month" value={periodo} onChange={(e) => setPeriodo(e.target.value)} className="mt-1 block rounded border border-slate-300 px-2 py-1.5" /></label>
        {puedeExportar && (
          <button onClick={onExportar} className="rounded border border-slate-300 px-3 py-2">Exportar novedades (CSV nómina)</button>
        )}
      </div>
      <table className="w-full border-collapse">
        <thead>
          <tr className="border-b border-slate-200 text-left text-slate-500">
            <th className="py-2">Empleado</th><th>Plan</th><th>Trabajados</th><th>Faltas</th>
            <th>Tardanzas</th><th>Déficit</th><th>Comp. (saldo)</th><th>Pendientes</th>
          </tr>
        </thead>
        <tbody>
          {empleados.map((e) => (
            <tr key={e.employeeId} className="border-b border-slate-100 align-top">
              <td className="py-2">{e.apellidos}, {e.nombres}</td>
              <td>{e.diasPlanificados}</td>
              <td>{e.diasTrabajados}</td>
              <td className={e.faltas > 0 ? 'font-medium text-red-700' : ''}>{e.faltas}{e.faltasJustificadas > 0 ? ` (+${e.faltasJustificadas} just.)` : ''}</td>
              <td className={e.diasTardanza > 0 ? 'text-amber-700' : ''}>{e.diasTardanza} días · {e.minutosTardanza} min</td>
              <td className={e.minutosDeficit > 0 ? 'text-amber-700' : ''}>{e.minutosDeficit} min</td>
              <td>{e.compensatorios.saldoActual} (ini {e.compensatorios.saldoInicial}, +{e.compensatorios.ganados}, {e.compensatorios.gozados})</td>
              <td>
                {e.pendientesSinPlan.map((p) => (
                  <div key={p.fecha} className="mb-1 rounded bg-amber-50 px-2 py-1 text-xs">
                    <span className="font-medium">{p.fecha}</span> trabajó sin turno.
                    {p.contraparteSugerida && <span className="text-slate-600"> {p.contraparteSugerida}.</span>}
                    {puedeResolver && (
                      <span className="ml-1">
                        <button onClick={() => onIntercambio(e, p.fecha)} className="mr-1 underline">Intercambio</button>
                        <button onClick={() => onConfirmarGanado(e, p.fecha)} className="underline">Día adicional (+1)</button>
                      </span>
                    )}
                  </div>
                ))}
                {e.alertasConfianza.map((a) => (
                  <div key={a} className="mb-1 rounded bg-sky-50 px-2 py-1 text-xs text-sky-800">{a}</div>
                ))}
                {e.pendientesSinPlan.length === 0 && e.alertasConfianza.length === 0 && (
                  <span className="text-slate-400">—</span>
                )}
              </td>
            </tr>
          ))}
          {empleados.length === 0 && <tr><td colSpan={8} className="py-4 text-slate-500">Sin personal con plan de turnos en el período.</td></tr>}
        </tbody>
      </table>
      <p className="text-xs text-slate-500">
        La falta de un titular se cruza contra su saldo marcando ese día como DC en la pestaña Plan (registra el gozado −1).
      </p>
    </div>
  );
}
