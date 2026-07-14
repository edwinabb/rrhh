'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/components/auth-context';
import {
  fetchEmployees,
  fetchLegajo,
  nombreEmpleado,
  searchDocuments,
  SesionExpiradaError,
  TIPO_LABELS,
  TIPOS_DOCUMENTO,
  type Documento,
  type Employee,
  type LegajoView,
  type TipoDocumento,
} from './api';
import { DocumentsTable } from './documents-table';
import { UploadForm } from './upload-form';

type Tab = 'legajo' | 'busqueda';

export default function LegajoPage() {
  const { hasPermission } = useAuth();
  const router = useRouter();

  const canUpload = hasPermission('documents.upload');
  const canDelete = hasPermission('documents.delete');

  const onSessionExpired = useCallback(() => {
    router.replace('/login');
  }, [router]);

  // --- Empleados (selector compartido) ---
  const [empleados, setEmpleados] = useState<Employee[]>([]);
  const [cargandoEmpleados, setCargandoEmpleados] = useState(true);
  const [errorEmpleados, setErrorEmpleados] = useState<string | null>(null);
  const [employeeId, setEmployeeId] = useState('');

  useEffect(() => {
    let cancelled = false;
    fetchEmployees()
      .then((lista) => {
        if (cancelled) return;
        setEmpleados(lista);
        setCargandoEmpleados(false);
      })
      .catch((e) => {
        if (cancelled) return;
        if (e instanceof SesionExpiradaError) return onSessionExpired();
        setErrorEmpleados(
          e instanceof Error ? e.message : 'No se pudo cargar la lista de empleados',
        );
        setCargandoEmpleados(false);
      });
    return () => {
      cancelled = true;
    };
  }, [onSessionExpired]);

  // --- Legajo del empleado seleccionado ---
  const [legajo, setLegajo] = useState<LegajoView | null>(null);
  const [cargandoLegajo, setCargandoLegajo] = useState(false);
  const [errorLegajo, setErrorLegajo] = useState<string | null>(null);

  const cargarLegajo = useCallback(
    (id: string) => {
      setErrorLegajo(null);
      setCargandoLegajo(true);
      fetchLegajo(id)
        .then((vista) => {
          setLegajo(vista);
          setCargandoLegajo(false);
        })
        .catch((e) => {
          if (e instanceof SesionExpiradaError) return onSessionExpired();
          setErrorLegajo(e instanceof Error ? e.message : 'No se pudo cargar el legajo');
          setLegajo(null);
          setCargandoLegajo(false);
        });
    },
    [onSessionExpired],
  );

  useEffect(() => {
    if (!employeeId) {
      setLegajo(null);
      return;
    }
    cargarLegajo(employeeId);
  }, [employeeId, cargarLegajo]);

  const refrescarLegajo = useCallback(() => {
    if (employeeId) cargarLegajo(employeeId);
  }, [employeeId, cargarLegajo]);

  // --- Búsqueda ---
  const [tab, setTab] = useState<Tab>('legajo');
  const [filtroTipo, setFiltroTipo] = useState<TipoDocumento | ''>('');
  const [filtroDesde, setFiltroDesde] = useState('');
  const [filtroHasta, setFiltroHasta] = useState('');
  const [resultados, setResultados] = useState<Documento[] | null>(null);
  const [buscando, setBuscando] = useState(false);
  const [errorBusqueda, setErrorBusqueda] = useState<string | null>(null);

  async function handleBuscar(e?: React.FormEvent) {
    e?.preventDefault();
    setErrorBusqueda(null);
    setBuscando(true);
    try {
      const docs = await searchDocuments({
        employeeId: employeeId || undefined,
        tipo: filtroTipo,
        desde: filtroDesde || undefined,
        hasta: filtroHasta || undefined,
      });
      setResultados(docs);
    } catch (err) {
      if (err instanceof SesionExpiradaError) return onSessionExpired();
      setErrorBusqueda(err instanceof Error ? err.message : 'No se pudo ejecutar la búsqueda');
    } finally {
      setBuscando(false);
    }
  }

  // Tipos presentes en el legajo, ordenados según el enum para una vista estable.
  const tiposConDocumentos = legajo
    ? TIPOS_DOCUMENTO.filter((t) => (legajo.documentosPorTipo[t] ?? []).length > 0)
    : [];

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Legajo digital</h1>
        <p className="text-sm text-slate-600">
          Documentos del expediente de cada empleado, agrupados por tipo.
        </p>
      </div>

      {/* Selector de empleado */}
      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <label className="mb-1 block text-sm font-medium" htmlFor="empleado">
          Empleado
        </label>
        {cargandoEmpleados ? (
          <p className="text-sm text-slate-500">Cargando...</p>
        ) : errorEmpleados ? (
          <p className="text-sm text-red-600">{errorEmpleados}</p>
        ) : (
          <select
            id="empleado"
            value={employeeId}
            onChange={(e) => setEmployeeId(e.target.value)}
            className="w-full max-w-md rounded border border-slate-300 px-3 py-2 text-sm"
          >
            <option value="">— Selecciona un empleado —</option>
            {empleados.map((emp) => (
              <option key={emp.id} value={emp.id}>
                {nombreEmpleado(emp)}
                {emp.estado && emp.estado !== 'ACTIVO' ? ` (${emp.estado})` : ''}
              </option>
            ))}
          </select>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-slate-200">
        {(
          [
            { id: 'legajo', label: 'Legajo' },
            { id: 'busqueda', label: 'Búsqueda' },
          ] as { id: Tab; label: string }[]
        ).map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`rounded-t px-4 py-2 text-sm ${
              tab === t.id
                ? 'border border-b-0 border-slate-200 bg-white font-medium text-slate-900'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'legajo' && (
        <div className="space-y-4">
          {canUpload && employeeId && (
            <UploadForm
              employeeId={employeeId}
              onUploaded={refrescarLegajo}
              onSessionExpired={onSessionExpired}
            />
          )}

          {!employeeId && (
            <p className="text-sm text-slate-500">
              Selecciona un empleado para ver su legajo.
            </p>
          )}

          {employeeId && cargandoLegajo && (
            <p className="text-sm text-slate-500">Cargando...</p>
          )}
          {employeeId && errorLegajo && <p className="text-sm text-red-600">{errorLegajo}</p>}

          {employeeId && !cargandoLegajo && !errorLegajo && legajo && (
            <div className="space-y-4">
              {legajo.tiposFaltantes.length > 0 && (
                <div className="rounded-lg border border-amber-300 bg-amber-50 p-4">
                  <p className="text-sm font-medium text-amber-900">
                    Documentos requeridos faltantes
                  </p>
                  <p className="mt-1 text-sm text-amber-800">
                    {legajo.tiposFaltantes
                      .map((t) => TIPO_LABELS[t as TipoDocumento] ?? t)
                      .join(', ')}
                  </p>
                </div>
              )}

              {tiposConDocumentos.length === 0 ? (
                <p className="text-sm text-slate-500">
                  Este empleado aún no tiene documentos en su legajo.
                </p>
              ) : (
                tiposConDocumentos.map((tipo) => (
                  <section
                    key={tipo}
                    className="rounded-lg border border-slate-200 bg-white p-4"
                  >
                    <h2 className="mb-3 text-sm font-semibold">{TIPO_LABELS[tipo]}</h2>
                    <DocumentsTable
                      documentos={legajo.documentosPorTipo[tipo] ?? []}
                      canDelete={canDelete}
                      onDeleted={refrescarLegajo}
                      onSessionExpired={onSessionExpired}
                    />
                  </section>
                ))
              )}
            </div>
          )}
        </div>
      )}

      {tab === 'busqueda' && (
        <div className="space-y-4">
          <form
            onSubmit={handleBuscar}
            className="rounded-lg border border-slate-200 bg-white p-4"
          >
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <label className="mb-1 block text-sm font-medium" htmlFor="filtro-tipo">
                  Tipo
                </label>
                <select
                  id="filtro-tipo"
                  value={filtroTipo}
                  onChange={(e) => setFiltroTipo(e.target.value as TipoDocumento | '')}
                  className="rounded border border-slate-300 px-3 py-2 text-sm"
                >
                  <option value="">Todos</option>
                  {TIPOS_DOCUMENTO.map((t) => (
                    <option key={t} value={t}>
                      {TIPO_LABELS[t]}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium" htmlFor="filtro-desde">
                  Desde
                </label>
                <input
                  id="filtro-desde"
                  type="date"
                  value={filtroDesde}
                  onChange={(e) => setFiltroDesde(e.target.value)}
                  className="rounded border border-slate-300 px-3 py-2 text-sm"
                />
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium" htmlFor="filtro-hasta">
                  Hasta
                </label>
                <input
                  id="filtro-hasta"
                  type="date"
                  value={filtroHasta}
                  onChange={(e) => setFiltroHasta(e.target.value)}
                  className="rounded border border-slate-300 px-3 py-2 text-sm"
                />
              </div>

              <button
                type="submit"
                disabled={buscando}
                className="rounded bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
              >
                {buscando ? 'Buscando...' : 'Buscar'}
              </button>
            </div>
            <p className="mt-2 text-xs text-slate-500">
              La búsqueda se limita al empleado seleccionado arriba; si no hay empleado
              seleccionado, busca en todos.
            </p>
          </form>

          {errorBusqueda && <p className="text-sm text-red-600">{errorBusqueda}</p>}
          {buscando && <p className="text-sm text-slate-500">Cargando...</p>}

          {!buscando && resultados !== null && (
            <div className="rounded-lg border border-slate-200 bg-white p-4">
              <h2 className="mb-3 text-sm font-semibold">
                Resultados ({resultados.length})
              </h2>
              <DocumentsTable
                documentos={resultados}
                mostrarTipo
                canDelete={canDelete}
                onDeleted={() => {
                  handleBuscar();
                  refrescarLegajo();
                }}
                onSessionExpired={onSessionExpired}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
