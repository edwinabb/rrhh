'use client';

import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/components/auth-context';
import { EmpleadoResumen, listarEmpleados } from '../vacaciones/vacations-api';
import {
  Asignacion, descargarPlantillaPlan, importarPlan, listarTurnos, obtenerPlan,
  TipoDiaPlan, Turno, upsertAsignacion,
} from './shifts-api';

function diasDelMes(periodo: string): string[] {
  const [anio = 0, mes = 0] = periodo.split('-').map(Number);
  const total = new Date(anio, mes, 0).getDate();
  return Array.from({ length: total }, (_, i) => `${periodo}-${String(i + 1).padStart(2, '0')}`);
}

function etiqueta(a: Asignacion | undefined): string {
  if (!a) return '';
  if (a.tipoDia === 'DESCANSO') return 'D';
  if (a.tipoDia === 'DESCANSO_COMPENSATORIO') return 'DC';
  return a.turno?.codigo ?? 'T';
}

export function PlanTab() {
  const { hasPermission } = useAuth();
  const puedeGestionar = hasPermission('shift.manage');
  const hoy = new Date();
  const [periodo, setPeriodo] = useState(`${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}`);
  const [empleados, setEmpleados] = useState<EmpleadoResumen[]>([]);
  const [turnos, setTurnos] = useState<Turno[]>([]);
  const [plan, setPlan] = useState<Asignacion[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [resultadoImport, setResultadoImport] = useState<string | null>(null);
  const [celda, setCelda] = useState<{ employeeId: string; fecha: string } | null>(null);
  const [valorCelda, setValorCelda] = useState('');

  const dias = useMemo(() => diasDelMes(periodo), [periodo]);
  const planPorClave = useMemo(() => {
    const m = new Map<string, Asignacion>();
    for (const a of plan) m.set(`${a.employeeId}|${a.fecha.slice(0, 10)}`, a);
    return m;
  }, [plan]);

  async function refrescar() {
    setError(null);
    try {
      const [d0, dN] = [dias[0], dias[dias.length - 1]];
      setPlan(await obtenerPlan(d0!, dN!));
    } catch (e) {
      setError((e as Error).message);
    }
  }

  useEffect(() => {
    listarEmpleados().then(setEmpleados).catch((e) => setError(e.message));
    listarTurnos().then(setTurnos).catch((e) => setError(e.message));
  }, []);
  useEffect(() => { refrescar(); }, [periodo]);

  async function onGuardarCelda() {
    if (!celda || !valorCelda) return setCelda(null);
    setError(null);
    try {
      const clave = valorCelda.toUpperCase();
      let tipoDia: TipoDiaPlan = 'TURNO';
      let turnoId: string | undefined;
      if (clave === 'D') tipoDia = 'DESCANSO';
      else if (clave === 'DC') tipoDia = 'DESCANSO_COMPENSATORIO';
      else {
        const turno = turnos.find((t) => t.codigo === clave);
        if (!turno) throw new Error(`Turno "${clave}" no existe (usa un código del catálogo, D o DC)`);
        turnoId = turno.id;
      }
      await upsertAsignacion({ employeeId: celda.employeeId, fecha: celda.fecha, tipoDia, turnoId });
      setCelda(null);
      setValorCelda('');
      await refrescar();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function onImportar(archivo: File) {
    setError(null);
    setResultadoImport(null);
    try {
      const r = await importarPlan(await archivo.text());
      setResultadoImport(
        `Procesadas: ${r.procesadas} · Omitidas: ${r.omitidas} · Errores: ${r.errores.length}` +
          (r.errores.length ? ` — ${r.errores.slice(0, 5).map((e) => `fila ${e.fila}: ${e.mensaje}`).join(' | ')}` : ''),
      );
      await refrescar();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function onPlantilla() {
    const contenido = await descargarPlantillaPlan();
    const blob = new Blob([contenido], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'plantilla-plan-turnos.csv';
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-4">
      {error && <p className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {resultadoImport && <p className="rounded bg-slate-50 px-3 py-2 text-sm text-slate-700">{resultadoImport}</p>}
      <div className="flex items-end gap-3 text-sm">
        <label>Período<input type="month" value={periodo} onChange={(e) => setPeriodo(e.target.value)} className="mt-1 block rounded border border-slate-300 px-2 py-1.5" /></label>
        {puedeGestionar && (
          <>
            <button onClick={onPlantilla} className="rounded border border-slate-300 px-3 py-2">Descargar plantilla CSV</button>
            <label className="rounded bg-slate-900 px-3 py-2 font-medium text-white">
              Importar plan CSV
              <input type="file" accept=".csv" className="hidden" onChange={(e) => e.target.files?.[0] && onImportar(e.target.files[0])} />
            </label>
          </>
        )}
      </div>
      <div className="overflow-x-auto">
        <table className="border-collapse text-xs">
          <thead>
            <tr>
              <th className="sticky left-0 bg-white py-1 pr-2 text-left">Empleado</th>
              {dias.map((d) => <th key={d} className="min-w-[28px] px-0.5 text-slate-500">{d.slice(8)}</th>)}
            </tr>
          </thead>
          <tbody>
            {empleados.map((emp) => (
              <tr key={emp.id} className="border-t border-slate-100">
                <td className="sticky left-0 bg-white py-1 pr-2">{emp.apellidos}, {emp.nombres}</td>
                {dias.map((d) => {
                  const asignacion = planPorClave.get(`${emp.id}|${d}`);
                  const esCelda = celda?.employeeId === emp.id && celda?.fecha === d;
                  return (
                    <td key={d} className="border border-slate-100 p-0 text-center">
                      {esCelda ? (
                        <input
                          autoFocus
                          value={valorCelda}
                          onChange={(e) => setValorCelda(e.target.value)}
                          onBlur={onGuardarCelda}
                          onKeyDown={(e) => e.key === 'Enter' && onGuardarCelda()}
                          className="w-10 border-0 bg-amber-50 px-0.5 py-1 text-center"
                        />
                      ) : (
                        <button
                          disabled={!puedeGestionar}
                          onClick={() => { setCelda({ employeeId: emp.id, fecha: d }); setValorCelda(etiqueta(asignacion)); }}
                          className={`h-6 w-full ${asignacion?.tipoDia === 'TURNO' ? 'bg-sky-50' : asignacion ? 'bg-emerald-50' : ''}`}
                        >
                          {etiqueta(asignacion)}
                        </button>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-slate-500">Escribe el código del turno (ej. DIA, NOCHE), D = descanso, DC = descanso compensatorio. Enter para guardar.</p>
    </div>
  );
}
