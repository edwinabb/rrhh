'use client';

import { useEffect, useState } from 'react';
import { fetchResumen, fmtFecha, fmtHora, type ResumenDia } from './attendance-api';

export function ResumenMes({
  periodo,
  refreshKey,
  employeeId,
  nombresPorEmpleado,
}: {
  periodo: string;
  /** Incrementar para forzar recarga (ej. después de una marcación). */
  refreshKey: number;
  /** Si se define, filtra el resumen a ese empleado (?employeeId=). */
  employeeId?: string;
  nombresPorEmpleado: Map<string, string>;
}) {
  const [filas, setFilas] = useState<ResumenDia[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setFilas(null);
    setError(null);
    fetchResumen(periodo, employeeId)
      .then((resumenes) => {
        if (!cancelled) setFilas(resumenes);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : 'No se pudo obtener el resumen del período.',
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [periodo, employeeId, refreshKey]);

  const varios = filas ? new Set(filas.map((f) => f.employeeId)).size > 1 : false;

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
      <h2 className="text-base font-semibold">Resumen del mes</h2>
      <p className="mt-1 text-sm text-slate-500">Período {periodo}</p>

      {error && <p className="mt-4 text-sm text-red-600">{error}</p>}
      {!error && filas === null && <p className="mt-4 text-sm text-slate-500">Cargando...</p>}
      {!error && filas !== null && filas.length === 0 && (
        <p className="mt-4 text-sm text-slate-500">Sin registros para este período.</p>
      )}

      {!error && filas !== null && filas.length > 0 && (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-slate-500">
                {varios && <th className="py-2 pr-4 font-medium">Empleado</th>}
                <th className="py-2 pr-4 font-medium">Fecha</th>
                <th className="py-2 pr-4 font-medium">Entrada</th>
                <th className="py-2 pr-4 font-medium">Salida</th>
                <th className="py-2 pr-4 font-medium">Horas</th>
                <th className="py-2 pr-4 font-medium">Tardanza</th>
                <th className="py-2 pr-4 font-medium">Falta</th>
                <th className="py-2 font-medium">Justificado</th>
              </tr>
            </thead>
            <tbody>
              {filas.map((f) => (
                <tr key={f.id} className="border-b border-slate-100">
                  {varios && (
                    <td className="py-2 pr-4">
                      {nombresPorEmpleado.get(f.employeeId) ?? f.employeeId.slice(0, 8)}
                    </td>
                  )}
                  <td className="py-2 pr-4">{fmtFecha(f.fecha)}</td>
                  <td className="py-2 pr-4">{fmtHora(f.horaEntrada)}</td>
                  <td className="py-2 pr-4">{fmtHora(f.horaSalida)}</td>
                  <td className="py-2 pr-4">{f.horasTrabajadas.toFixed(2)}</td>
                  <td className="py-2 pr-4">
                    {f.tardanzaMinutos > 0 ? (
                      <span className="text-amber-700">{f.tardanzaMinutos} min</span>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="py-2 pr-4">
                    {f.falta ? <span className="font-medium text-red-600">Sí</span> : '—'}
                  </td>
                  <td className="py-2">
                    {f.justificado ? <span className="text-green-700">Sí</span> : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
