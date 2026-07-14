'use client';

import { useEffect, useState } from 'react';
import { ApiError, fetchEmployees, type EmployeeRow } from './admin-api';

const TIPO_DOC_LABELS: Record<string, string> = {
  '01': 'DNI',
  '04': 'CE',
  '07': 'Pasaporte',
};

const ESTADO_STYLES: Record<string, string> = {
  activo: 'bg-emerald-50 text-emerald-700',
  cesado: 'bg-slate-100 text-slate-500',
};

function documento(emp: EmployeeRow): string {
  if (!emp.numeroDocumento) return '—';
  const tipo = emp.tipoDocumento ? (TIPO_DOC_LABELS[emp.tipoDocumento] ?? emp.tipoDocumento) : '';
  return tipo ? `${tipo} ${emp.numeroDocumento}` : emp.numeroDocumento;
}

/**
 * GET /employees devuelve las filas del tenant (para RRHH/Admin la tabla base;
 * para otros roles una vista con menos columnas). La API no incluye el nombre
 * de la sede, solo su ID.
 */
export default function EmployeesTab() {
  const [employees, setEmployees] = useState<EmployeeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchEmployees()
      .then((rows) => {
        if (!cancelled) setEmployees(rows);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(
            err instanceof ApiError ? err.message : 'No se pudo cargar la lista de empleados.',
          );
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-5">
      <div className="mb-4">
        <h2 className="text-sm font-semibold text-slate-900">Empleados</h2>
        <p className="mt-1 text-sm text-slate-500">
          Empleados registrados en la empresa. {employees.length > 0 && `Total: ${employees.length}.`}
        </p>
      </div>

      {loading && <p className="text-sm text-slate-500">Cargando...</p>}
      {error && <p className="text-sm text-red-600">{error}</p>}

      {!loading && !error && employees.length === 0 && (
        <p className="text-sm text-slate-500">No hay empleados registrados.</p>
      )}

      {!loading && !error && employees.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-slate-500">
                <th className="py-2 pr-4 font-medium">Documento</th>
                <th className="py-2 pr-4 font-medium">Nombres</th>
                <th className="py-2 pr-4 font-medium">Sede</th>
                <th className="py-2 font-medium">Estado</th>
              </tr>
            </thead>
            <tbody>
              {employees.map((emp) => (
                <tr key={emp.id} className="border-b border-slate-100">
                  <td className="whitespace-nowrap py-2 pr-4 font-mono text-xs text-slate-700">
                    {documento(emp)}
                  </td>
                  <td className="py-2 pr-4 text-slate-900">
                    {emp.nombres} {emp.apellidos}
                  </td>
                  <td
                    className="py-2 pr-4 font-mono text-xs text-slate-600"
                    title={emp.sedeId}
                  >
                    {emp.sedeId ? `${emp.sedeId.slice(0, 8)}…` : '—'}
                  </td>
                  <td className="py-2">
                    <span
                      className={`rounded px-2 py-0.5 text-xs font-medium ${
                        ESTADO_STYLES[emp.estado] ?? 'bg-slate-100 text-slate-700'
                      }`}
                    >
                      {emp.estado}
                    </span>
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
