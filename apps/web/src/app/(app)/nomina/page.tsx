'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/components/auth-context';
import {
  exportarPlanilla,
  procesarPlanilla,
  UnauthorizedError,
  type PlanillaProcesada,
} from '@/lib/api-client';
import { ConceptosCard } from './conceptos-card';
import { ResultadoPlanilla } from './resultado-planilla';

type FormatoExport = 'plame' | 'telecredito';

const EXPORT_LABELS: Record<FormatoExport, string> = {
  plame: 'Exportar PLAME (E18)',
  telecredito: 'Exportar telecrédito BCP',
};

function periodoActual(): string {
  const ahora = new Date();
  return `${ahora.getFullYear()}-${String(ahora.getMonth() + 1).padStart(2, '0')}`;
}

export default function NominaPage() {
  const { hasPermission } = useAuth();
  const router = useRouter();

  const puedeProcesar = hasPermission('payroll.process');
  const puedeExportar = hasPermission('payroll.export');

  const [periodo, setPeriodo] = useState(periodoActual);

  // Procesamiento
  const [confirmando, setConfirmando] = useState(false);
  const [procesando, setProcesando] = useState(false);
  const [resultado, setResultado] = useState<PlanillaProcesada | null>(null);
  const [periodoProcesado, setPeriodoProcesado] = useState('');
  const [errorProceso, setErrorProceso] = useState<string | null>(null);

  // Exportaciones (stubs pendientes de conexión a BD)
  const [exportando, setExportando] = useState<FormatoExport | null>(null);
  const [exportacion, setExportacion] = useState<{
    formato: FormatoExport;
    mensaje: string;
  } | null>(null);
  const [errorExport, setErrorExport] = useState<string | null>(null);

  function manejarError(err: unknown, setError: (msg: string) => void, fallback: string) {
    if (err instanceof UnauthorizedError) {
      router.replace('/login');
      return;
    }
    setError(err instanceof Error && err.message ? err.message : fallback);
  }

  async function confirmarProcesamiento() {
    setConfirmando(false);
    setErrorProceso(null);
    setResultado(null);
    setProcesando(true);
    try {
      const res = await procesarPlanilla(periodo);
      setResultado(res);
      setPeriodoProcesado(periodo);
    } catch (err) {
      manejarError(err, setErrorProceso, 'No se pudo procesar la planilla.');
    } finally {
      setProcesando(false);
    }
  }

  async function handleExportar(formato: FormatoExport) {
    setErrorExport(null);
    setExportacion(null);
    setExportando(formato);
    try {
      const res = await exportarPlanilla(periodo, formato);
      setExportacion({
        formato,
        mensaje: res.mensaje ?? 'La API no retornó un mensaje.',
      });
    } catch (err) {
      manejarError(err, setErrorExport, 'No se pudo generar la exportación.');
    } finally {
      setExportando(null);
    }
  }

  const periodoValido = /^\d{4}-\d{2}$/.test(periodo);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Nómina</h1>
        <p className="mt-1 text-sm text-slate-500">
          Procesamiento de planilla y exportaciones del período seleccionado.
        </p>
      </div>

      {/* Procesar planilla */}
      <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-sm font-semibold text-slate-900">Procesar planilla</h2>
        <p className="mt-1 text-sm text-slate-500">
          Calcula los conceptos de todos los empleados activos del período y deja la planilla
          en estado &quot;procesado&quot;.
        </p>

        <div className="mt-4 flex flex-wrap items-end gap-3">
          <div>
            <label className="mb-1 block text-sm font-medium" htmlFor="periodo">
              Período
            </label>
            <input
              id="periodo"
              type="month"
              value={periodo}
              onChange={(e) => {
                setPeriodo(e.target.value);
                setConfirmando(false);
              }}
              className="rounded border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
          {puedeProcesar ? (
            <button
              type="button"
              onClick={() => setConfirmando(true)}
              disabled={procesando || confirmando || !periodoValido}
              className="rounded bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {procesando ? 'Procesando...' : 'Procesar planilla'}
            </button>
          ) : (
            <p className="text-sm text-slate-500">
              No tienes permiso para procesar la planilla.
            </p>
          )}
        </div>

        {!periodoValido && (
          <p className="mt-2 text-sm text-red-600">Selecciona un período válido (AAAA-MM).</p>
        )}

        {confirmando && (
          <div className="mt-4 rounded border border-amber-300 bg-amber-50 p-4">
            <p className="text-sm font-medium text-amber-900">
              ¿Confirmas procesar la planilla del período {periodo}?
            </p>
            <p className="mt-1 text-sm text-amber-800">
              Esta es una acción de negocio: se calcularán los conceptos de todos los
              empleados activos y la planilla quedará registrada como procesada.
            </p>
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={confirmarProcesamiento}
                className="rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-white"
              >
                Sí, procesar
              </button>
              <button
                type="button"
                onClick={() => setConfirmando(false)}
                className="rounded border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100"
              >
                Cancelar
              </button>
            </div>
          </div>
        )}

        {procesando && <p className="mt-4 text-sm text-slate-500">Cargando...</p>}

        {errorProceso && <p className="mt-4 text-sm text-red-600">{errorProceso}</p>}

        {resultado && <ResultadoPlanilla resultado={resultado} periodo={periodoProcesado} />}
      </section>

      {/* Exportaciones */}
      <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-sm font-semibold text-slate-900">Exportaciones</h2>
        <p className="mt-1 text-sm text-slate-500">
          Archivos para SUNAT (PLAME, Estructura 18) y pago masivo de haberes (telecrédito
          BCP) del período {periodo || 'seleccionado'}.
        </p>

        {puedeExportar ? (
          <div className="mt-4 flex flex-wrap gap-2">
            {(Object.keys(EXPORT_LABELS) as FormatoExport[]).map((formato) => (
              <button
                key={formato}
                type="button"
                onClick={() => handleExportar(formato)}
                disabled={exportando !== null || !periodoValido}
                className="rounded border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50"
              >
                {exportando === formato ? 'Cargando...' : EXPORT_LABELS[formato]}
              </button>
            ))}
          </div>
        ) : (
          <p className="mt-4 text-sm text-slate-500">
            No tienes permiso para exportar la planilla.
          </p>
        )}

        {errorExport && <p className="mt-4 text-sm text-red-600">{errorExport}</p>}

        {exportacion && (
          <div className="mt-4 rounded border border-slate-200 bg-slate-50 p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-amber-700">
              Pendiente de conexión a BD
            </p>
            <p className="mt-1 text-sm text-slate-700">
              {EXPORT_LABELS[exportacion.formato]}: {exportacion.mensaje}
            </p>
          </div>
        )}
      </section>

      <ConceptosCard />
    </div>
  );
}
