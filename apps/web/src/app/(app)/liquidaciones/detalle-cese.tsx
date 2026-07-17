'use client';

import { useState } from 'react';
import { useAuth } from '@/components/auth-context';
import { anularCese, aprobarCese, Cese, pagarCese, semaforoPlazo } from './termination-api';

function soles(n: string | number | null): string {
  return n == null ? '—' : `S/ ${Number(n).toFixed(2)}`;
}

export function DetalleCese({ cese, onCambio }: { cese: Cese; onCambio: (c: Cese) => void }) {
  const { hasPermission } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const semaforo = semaforoPlazo(cese);

  async function ejecutar(accion: () => Promise<Cese>) {
    setError(null);
    setOcupado(true);
    try {
      onCambio(await accion());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setOcupado(false);
    }
  }

  async function onAnular() {
    const motivo = window.prompt('Motivo de anulación (obligatorio):');
    if (!motivo) return;
    await ejecutar(() => anularCese(cese.id, motivo));
  }

  return (
    <div className="space-y-4 rounded border border-slate-200 bg-white p-4 text-sm">
      <div className="flex items-center justify-between">
        <h2 className="font-medium">
          {cese.employee ? `${cese.employee.apellidos}, ${cese.employee.nombres}` : cese.employeeId} — {cese.motivo}
        </h2>
        <div className="flex items-center gap-2">
          <span className="rounded bg-slate-100 px-2 py-0.5 text-xs">{cese.estado}</span>
          <span className={`rounded px-2 py-0.5 text-xs ${semaforo.className}`}>{semaforo.label}</span>
        </div>
      </div>
      <p className="text-slate-600">
        Cese: {cese.fechaCese.slice(0, 10)} · Límite de pago (48h): {cese.fechaLimitePago.slice(0, 10)}
      </p>
      {/* Recordatorios de documentos de subida manual (spec §6) */}
      {cese.motivo === 'RENUNCIA' && (
        <p className="rounded bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Recuerda subir la carta de renuncia al legajo (tipo CARTA_RENUNCIA).
        </p>
      )}
      <p className="rounded bg-slate-50 px-3 py-2 text-xs text-slate-600">
        Si la actividad lo requiere (Ley 29783), sube el examen médico de retiro al legajo (tipo
        EXAMEN_MEDICO_RETIRO).
      </p>
      {error && <p className="rounded bg-red-50 px-3 py-2 text-red-700">{error}</p>}

      {cese.componentes && (
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b border-slate-200 text-left text-slate-500">
              <th className="py-1">Concepto</th>
              <th>Base legal</th>
              <th className="text-right">Monto</th>
            </tr>
          </thead>
          <tbody>
            {[...cese.componentes.ingresos, ...cese.componentes.deducciones].map((l, i) => (
              <tr key={i} className="border-b border-slate-100">
                <td className="py-1">{l.concepto}</td>
                <td className="text-slate-500">{l.baseLegal}</td>
                <td className={`text-right ${l.monto < 0 ? 'text-red-700' : ''}`}>{soles(l.monto)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr><td colSpan={2} className="py-1 font-medium">Total bruto</td><td className="text-right">{soles(cese.totalBruto)}</td></tr>
            <tr><td colSpan={2} className="py-1 font-medium">Deducciones</td><td className="text-right">{soles(cese.totalDeducciones)}</td></tr>
            <tr className="border-t border-slate-300"><td colSpan={2} className="py-1 font-semibold">NETO A PAGAR</td><td className="text-right font-semibold">{soles(cese.netoPagar)}</td></tr>
          </tfoot>
        </table>
      )}

      <div className="flex gap-2">
        {cese.estado === 'CALCULADA' && hasPermission('termination.approve') && (
          <button onClick={() => ejecutar(() => aprobarCese(cese.id))} disabled={ocupado} className="rounded bg-emerald-700 px-3 py-2 font-medium text-white disabled:opacity-50">
            Aprobar (genera documentos)
          </button>
        )}
        {cese.estado === 'APROBADA' && hasPermission('termination.approve') && (
          <button onClick={() => ejecutar(() => pagarCese(cese.id))} disabled={ocupado} className="rounded bg-slate-900 px-3 py-2 font-medium text-white disabled:opacity-50">
            Registrar pago
          </button>
        )}
        {cese.estado !== 'PAGADA' && cese.estado !== 'ANULADA' && hasPermission('termination.approve') && (
          <button onClick={onAnular} disabled={ocupado} className="rounded border border-red-300 px-3 py-2 font-medium text-red-700 disabled:opacity-50">
            Anular
          </button>
        )}
        {(cese.estado === 'APROBADA' || cese.estado === 'PAGADA') && (
          <a href={`/legajo?employeeId=${cese.employeeId}`} className="rounded border border-slate-300 px-3 py-2 font-medium text-slate-700">
            Ver documentos en el legajo
          </a>
        )}
      </div>
    </div>
  );
}
