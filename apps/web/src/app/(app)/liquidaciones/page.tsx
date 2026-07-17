'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/components/auth-context';
import { Cese, detalleCese, listarCeses, semaforoPlazo } from './termination-api';
import { WizardCese } from './wizard-cese';
import { DetalleCese } from './detalle-cese';

export default function LiquidacionesPage() {
  const { hasPermission } = useAuth();
  const [ceses, setCeses] = useState<Cese[]>([]);
  const [seleccionado, setSeleccionado] = useState<Cese | null>(null);
  const [mostrarWizard, setMostrarWizard] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refrescar() {
    try {
      setCeses(await listarCeses());
    } catch (e) {
      setError((e as Error).message);
    }
  }

  useEffect(() => {
    refrescar();
  }, []);

  async function seleccionar(id: string) {
    setError(null);
    try {
      setSeleccionado(await detalleCese(id));
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Ceses y liquidaciones</h1>
        {hasPermission('termination.manage') && (
          <button onClick={() => setMostrarWizard((v) => !v)} className="rounded bg-slate-900 px-3 py-2 text-sm font-medium text-white">
            {mostrarWizard ? 'Cerrar wizard' : 'Nuevo cese'}
          </button>
        )}
      </div>
      {error && <p className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      {mostrarWizard && (
        <WizardCese
          onTerminado={(cese) => {
            setMostrarWizard(false);
            setSeleccionado(cese);
            refrescar();
          }}
        />
      )}

      {seleccionado && (
        <DetalleCese
          cese={seleccionado}
          onCambio={(c) => {
            setSeleccionado(c);
            refrescar();
          }}
        />
      )}

      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-left text-slate-500">
            <th className="py-2">Empleado</th>
            <th>Motivo</th>
            <th>Fecha de cese</th>
            <th>Estado</th>
            <th>Plazo 48h</th>
            <th className="text-right">Neto</th>
          </tr>
        </thead>
        <tbody>
          {ceses.map((c) => {
            const s = semaforoPlazo(c);
            return (
              <tr key={c.id} onClick={() => seleccionar(c.id)} className="cursor-pointer border-b border-slate-100 hover:bg-slate-50">
                <td className="py-2">{c.employee ? `${c.employee.apellidos}, ${c.employee.nombres}` : c.employeeId}</td>
                <td>{c.motivo}</td>
                <td>{c.fechaCese.slice(0, 10)}</td>
                <td>{c.estado}</td>
                <td><span className={`rounded px-2 py-0.5 text-xs ${s.className}`}>{s.label}</span></td>
                <td className="text-right">{c.netoPagar != null ? `S/ ${Number(c.netoPagar).toFixed(2)}` : '—'}</td>
              </tr>
            );
          })}
          {ceses.length === 0 && (
            <tr><td colSpan={6} className="py-4 text-slate-500">Sin ceses registrados.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
