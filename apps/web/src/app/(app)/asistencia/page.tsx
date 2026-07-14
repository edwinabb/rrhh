'use client';

import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/components/auth-context';
import { fetchEmployees, periodoActual, type EmployeeLite } from './attendance-api';
import { MarcarCard } from './marcar-card';
import { ResumenMes } from './resumen-mes';
import { Justificaciones } from './justificaciones';
import { DashboardEquipo } from './dashboard-equipo';

export default function AsistenciaPage() {
  const { me, hasPermission } = useAuth();

  const [empleados, setEmpleados] = useState<EmployeeLite[] | null>(null);
  const [empleadosError, setEmpleadosError] = useState<string | null>(null);
  const [periodo, setPeriodo] = useState(periodoActual());
  // Incrementa tras cada marcación exitosa para refrescar resumen y dashboard
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    fetchEmployees()
      .then((rows) => {
        if (!cancelled) setEmpleados(rows);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setEmpleados([]);
          setEmpleadosError(
            err instanceof Error
              ? err.message
              : 'No se pudo obtener la lista de empleados.',
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const cargandoEmpleado = empleados === null;

  /** Registro de empleado vinculado al usuario logueado (para marcar/justificar). */
  const ownEmployee = useMemo(
    () => empleados?.find((e) => e.userId !== null && e.userId === me?.userId) ?? null,
    [empleados, me],
  );

  const nombresPorEmpleado = useMemo(() => {
    const map = new Map<string, string>();
    for (const e of empleados ?? []) {
      map.set(e.id, `${e.nombres} ${e.apellidos}`.trim());
    }
    return map;
  }, [empleados]);

  const puedeVerEquipo = hasPermission('attendance.read.team');

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">Asistencia</h1>
        <label className="flex items-center gap-2 text-sm text-slate-600">
          Período
          <input
            type="month"
            value={periodo}
            onChange={(e) => {
              if (e.target.value) setPeriodo(e.target.value);
            }}
            className="rounded border border-slate-300 px-3 py-1.5 text-sm"
          />
        </label>
      </div>

      {empleadosError && (
        <p className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {empleadosError}
        </p>
      )}

      {hasPermission('attendance.mark') && (
        <MarcarCard
          ownEmployee={ownEmployee}
          cargandoEmpleado={cargandoEmpleado}
          onMarcacionRegistrada={() => setRefreshKey((n) => n + 1)}
        />
      )}

      <ResumenMes
        periodo={periodo}
        refreshKey={refreshKey}
        // Con permiso de equipo se listan todos (RLS acota por rol); si no, solo el propio
        employeeId={puedeVerEquipo ? undefined : ownEmployee?.id}
        nombresPorEmpleado={nombresPorEmpleado}
      />

      {hasPermission('attendance.justify') && (
        <Justificaciones
          ownEmployee={ownEmployee}
          cargandoEmpleado={cargandoEmpleado}
          puedeAprobar={hasPermission('attendance.approve')}
          nombresPorEmpleado={nombresPorEmpleado}
        />
      )}

      {puedeVerEquipo && (
        <DashboardEquipo
          periodo={periodo}
          refreshKey={refreshKey}
          nombresPorEmpleado={nombresPorEmpleado}
        />
      )}
    </div>
  );
}
