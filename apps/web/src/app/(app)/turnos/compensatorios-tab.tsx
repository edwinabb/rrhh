'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/components/auth-context';
import { EmpleadoResumen, listarEmpleados } from '../vacaciones/vacations-api';
import { Movimiento, obtenerLibro, registrarMovimiento } from './shifts-api';

const TIPO_LABELS: Record<string, string> = {
  GANADO: 'Ganado (día adicional)',
  GOZADO: 'Gozado',
  AJUSTE_INICIAL: 'Ajuste inicial',
};

export function CompensatoriosTab() {
  const { hasPermission } = useAuth();
  const puedeResolver = hasPermission('shift.resolve');
  const [empleados, setEmpleados] = useState<EmpleadoResumen[]>([]);
  const [employeeId, setEmployeeId] = useState('');
  const [saldo, setSaldo] = useState<number | null>(null);
  const [movimientos, setMovimientos] = useState<Movimiento[]>([]);
  const [ajuste, setAjuste] = useState({ dias: '', motivo: '' });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listarEmpleados().then(setEmpleados).catch((e) => setError(e.message));
  }, []);

  async function cargar(id: string) {
    setEmployeeId(id);
    setError(null);
    if (!id) { setSaldo(null); setMovimientos([]); return; }
    try {
      const libro = await obtenerLibro(id);
      setSaldo(libro.saldo);
      setMovimientos(libro.movimientos);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function onAjusteInicial() {
    if (!employeeId || !ajuste.dias || !ajuste.motivo) return;
    setError(null);
    try {
      await registrarMovimiento({
        employeeId,
        tipo: 'AJUSTE_INICIAL',
        dias: Number(ajuste.dias),
        fechaReferencia: new Date().toISOString().slice(0, 10),
        motivo: ajuste.motivo,
      });
      setAjuste({ dias: '', motivo: '' });
      await cargar(employeeId);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <div className="space-y-4 text-sm">
      {error && <p className="rounded bg-red-50 px-3 py-2 text-red-700">{error}</p>}
      <div className="flex items-end gap-3">
        <label>Empleado
          <select value={employeeId} onChange={(e) => cargar(e.target.value)} className="mt-1 block w-72 rounded border border-slate-300 px-2 py-1.5">
            <option value="">— Seleccionar —</option>
            {empleados.map((e) => (
              <option key={e.id} value={e.id}>{e.apellidos}, {e.nombres} ({e.numeroDocumento})</option>
            ))}
          </select>
        </label>
        {saldo !== null && (
          <span className={`rounded px-3 py-2 font-medium ${saldo < 0 ? 'bg-red-100 text-red-800' : 'bg-emerald-100 text-emerald-800'}`}>
            Saldo: {saldo} día(s)
          </span>
        )}
      </div>
      {puedeResolver && employeeId && (
        <div className="flex items-end gap-2 rounded border border-slate-200 bg-white p-3">
          <label>Ajuste inicial (días)<input type="number" value={ajuste.dias} onChange={(e) => setAjuste({ ...ajuste, dias: e.target.value })} className="mt-1 block w-24 rounded border border-slate-300 px-2 py-1.5" /></label>
          <label className="grow">Motivo (obligatorio)<input value={ajuste.motivo} onChange={(e) => setAjuste({ ...ajuste, motivo: e.target.value })} className="mt-1 block w-full rounded border border-slate-300 px-2 py-1.5" /></label>
          <button onClick={onAjusteInicial} disabled={!ajuste.dias || !ajuste.motivo} className="rounded bg-slate-900 px-3 py-2 font-medium text-white disabled:opacity-50">Registrar</button>
        </div>
      )}
      {employeeId && (
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b border-slate-200 text-left text-slate-500">
              <th className="py-2">Fecha ref.</th><th>Tipo</th><th>Días</th><th>Motivo</th><th>Registrado</th>
            </tr>
          </thead>
          <tbody>
            {movimientos.map((m) => (
              <tr key={m.id} className="border-b border-slate-100">
                <td className="py-2">{m.fechaReferencia.slice(0, 10)}</td>
                <td>{TIPO_LABELS[m.tipo]}</td>
                <td className={Number(m.dias) < 0 ? 'text-red-700' : 'text-emerald-700'}>{Number(m.dias) > 0 ? '+' : ''}{Number(m.dias)}</td>
                <td className="text-slate-600">{m.motivo ?? '—'}</td>
                <td className="text-slate-500">{m.creadoEn.slice(0, 10)}</td>
              </tr>
            ))}
            {movimientos.length === 0 && <tr><td colSpan={5} className="py-4 text-slate-500">Sin movimientos.</td></tr>}
          </tbody>
        </table>
      )}
    </div>
  );
}
