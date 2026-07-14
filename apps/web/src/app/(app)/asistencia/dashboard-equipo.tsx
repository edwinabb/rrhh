'use client';

import { useEffect, useState } from 'react';
import { fetchDashboard, type DashboardEquipo as Dashboard } from './attendance-api';

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-slate-200 p-4">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="mt-1 text-lg font-semibold text-slate-900">{value}</p>
    </div>
  );
}

export function DashboardEquipo({
  periodo,
  refreshKey,
  nombresPorEmpleado,
}: {
  periodo: string;
  refreshKey: number;
  nombresPorEmpleado: Map<string, string>;
}) {
  const [data, setData] = useState<Dashboard | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setError(null);
    fetchDashboard(periodo)
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(
            err instanceof Error
              ? err.message
              : 'No se pudo obtener el dashboard del equipo.',
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [periodo, refreshKey]);

  const horasPorEmpleado = data
    ? Object.entries(data.horasComputablesPorEmpleado)
    : [];

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
      <h2 className="text-base font-semibold">Dashboard de equipo</h2>
      <p className="mt-1 text-sm text-slate-500">
        Indicadores agregados del período {periodo}
      </p>

      {error && <p className="mt-4 text-sm text-red-600">{error}</p>}
      {!error && data === null && <p className="mt-4 text-sm text-slate-500">Cargando...</p>}

      {!error && data !== null && (
        <>
          <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
            <Kpi label="Empleados con registros" value={String(data.totalEmpleados)} />
            <Kpi
              label="Tasa de asistencia"
              value={
                data.tasaAsistencia === null
                  ? '—'
                  : `${(data.tasaAsistencia * 100).toFixed(0)}%`
              }
            />
            <Kpi label="Faltas injustificadas" value={String(data.faltasInjustificadas)} />
            <Kpi label="Faltas justificadas" value={String(data.faltasJustificadas)} />
            <Kpi label="Días con tardanza" value={String(data.diasConTardanza)} />
            <Kpi label="Tardanza acumulada" value={`${data.totalTardanzaMinutos} min`} />
            <Kpi label="Horas trabajadas" value={data.totalHorasTrabajadas.toFixed(2)} />
            <Kpi label="Horas extra" value={data.totalHorasExtra.toFixed(2)} />
          </div>

          {horasPorEmpleado.length > 0 && (
            <div className="mt-6 overflow-x-auto">
              <h3 className="text-sm font-semibold">Horas computables por empleado</h3>
              <table className="mt-2 w-full max-w-md text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-slate-500">
                    <th className="py-2 pr-4 font-medium">Empleado</th>
                    <th className="py-2 font-medium">Horas</th>
                  </tr>
                </thead>
                <tbody>
                  {horasPorEmpleado.map(([employeeId, horas]) => (
                    <tr key={employeeId} className="border-b border-slate-100">
                      <td className="py-2 pr-4">
                        {nombresPorEmpleado.get(employeeId) ?? employeeId.slice(0, 8)}
                      </td>
                      <td className="py-2">{horas.toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </section>
  );
}
