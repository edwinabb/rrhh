'use client';

import { useState } from 'react';
import type {
  ConceptoCalculado,
  PlanillaDetalleEmpleado,
  PlanillaProcesada,
} from '@/lib/api-client';

const formatoMoneda = new Intl.NumberFormat('es-PE', {
  style: 'currency',
  currency: 'PEN',
});

function formatearMonto(monto: number | undefined): string {
  return typeof monto === 'number' ? formatoMoneda.format(monto) : '—';
}

function FilaEmpleado({
  detalle,
  indice,
}: {
  detalle: PlanillaDetalleEmpleado;
  indice: number;
}) {
  const [abierto, setAbierto] = useState(false);
  const conceptos: ConceptoCalculado[] = Array.isArray(detalle.conceptosCalculados)
    ? detalle.conceptosCalculados
    : [];
  const etiqueta = detalle.nombre ?? detalle.employeeId ?? `Empleado ${indice + 1}`;

  return (
    <>
      <tr className="border-t border-slate-200">
        <td className="px-3 py-2">
          <button
            type="button"
            onClick={() => setAbierto((v) => !v)}
            className="text-sm text-slate-900 hover:underline"
            aria-expanded={abierto}
          >
            <span className="mr-2 inline-block w-3 text-slate-400">{abierto ? '−' : '+'}</span>
            {etiqueta}
          </button>
        </td>
        <td className="px-3 py-2 text-right text-sm text-slate-600">{conceptos.length}</td>
        <td className="px-3 py-2 text-right text-sm font-medium text-slate-900">
          {formatearMonto(detalle.netoPagar)}
        </td>
      </tr>
      {abierto && (
        <tr className="border-t border-slate-100 bg-slate-50">
          <td colSpan={3} className="px-3 py-2">
            {conceptos.length === 0 ? (
              <p className="text-sm text-slate-500">Sin conceptos calculados.</p>
            ) : (
              <table className="w-full">
                <thead>
                  <tr className="text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                    <th className="px-2 py-1">Código</th>
                    <th className="px-2 py-1">Concepto</th>
                    <th className="px-2 py-1 text-right">Monto</th>
                  </tr>
                </thead>
                <tbody>
                  {conceptos.map((c, i) => (
                    <tr key={`${c.codigo}-${i}`}>
                      <td className="px-2 py-1 text-sm text-slate-500">{c.codigo}</td>
                      <td className="px-2 py-1 text-sm text-slate-700">{c.nombre}</td>
                      <td
                        className={`px-2 py-1 text-right text-sm ${
                          c.monto < 0 ? 'text-red-600' : 'text-slate-900'
                        }`}
                      >
                        {formatearMonto(c.monto)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

/**
 * Renderiza el resultado real de POST /payroll/:periodo/procesar.
 * Hoy el backend retorna solo { id, estado }; si en el futuro incluye un
 * arreglo `detalles` por empleado, se muestra como tabla expandible.
 */
export function ResultadoPlanilla({
  resultado,
  periodo,
}: {
  resultado: PlanillaProcesada;
  periodo: string;
}) {
  const detalles = Array.isArray(resultado.detalles) ? resultado.detalles : null;

  return (
    <div className="mt-4 rounded border border-emerald-200 bg-emerald-50 p-4">
      <p className="text-sm font-medium text-emerald-800">
        Planilla del período {periodo} procesada correctamente.
      </p>
      <dl className="mt-2 space-y-1 text-sm text-slate-700">
        <div className="flex gap-2">
          <dt className="font-medium">ID de planilla:</dt>
          <dd className="break-all">{resultado.id}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="font-medium">Estado:</dt>
          <dd>{resultado.estado}</dd>
        </div>
      </dl>

      {detalles ? (
        <div className="mt-3 overflow-x-auto rounded border border-slate-200 bg-white">
          <table className="w-full">
            <thead>
              <tr className="text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                <th className="px-3 py-2">Empleado</th>
                <th className="px-3 py-2 text-right">Conceptos</th>
                <th className="px-3 py-2 text-right">Neto a pagar</th>
              </tr>
            </thead>
            <tbody>
              {detalles.map((d, i) => (
                <FilaEmpleado key={d.employeeId ?? i} detalle={d} indice={i} />
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="mt-3 text-sm text-slate-600">
          El detalle por empleado (conceptos calculados y neto a pagar) se guardó en el
          servidor, pero este endpoint aún no lo incluye en su respuesta.
        </p>
      )}
    </div>
  );
}
