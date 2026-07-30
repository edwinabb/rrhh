'use client';

import { useEffect, useState, useRef, useMemo } from 'react';
import { useAuth } from '@/components/auth-context';
import {
  listarMisCambios, solicitarCambio, CambioSolicitud, EstadoCambio, Turno, listarTurnos, obtenerPlan, Asignacion,
} from './shifts-api';

export function MisCambiosTab() {
  const { me } = useAuth();
  const [cambios, setCambios] = useState<CambioSolicitud[]>([]);
  const [turnos, setTurnos] = useState<Turno[]>([]);
  const [turnoHoy, setTurnoHoy] = useState<Asignacion | null>(null);
  const [estadoFiltro, setEstadoFiltro] = useState<EstadoCambio | 'TODOS'>('TODOS');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({ fechaNueva: '', turnoIdNuevo: '' });
  const [isSaving, setIsSaving] = useState(false);
  const [reintentar, setReintentar] = useState<CambioSolicitud | null>(null);
  const modalHeadingId = useRef('cambio-form-heading');

  const hoy = new Date();
  const hoyStr = hoy.toISOString().slice(0, 10);

  // Cargar datos iniciales
  useEffect(() => {
    if (!me?.userId) return;
    refrescar();
    listarTurnos().then(setTurnos).catch((e) => setError((e as Error).message));
    // Cargar asignación de hoy
    obtenerPlan(hoyStr, hoyStr, me.userId)
      .then((asignaciones) => {
        if (asignaciones.length > 0) {
          setTurnoHoy(asignaciones[0]);
        }
      })
      .catch(() => undefined); // No es crítico si falla
  }, [me?.userId]);

  async function refrescar() {
    if (!me?.userId) return;
    setError(null);
    setIsLoading(true);
    try {
      const cambiosData = await listarMisCambios();
      setCambios(cambiosData);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setIsLoading(false);
    }
  }

  const cambiosFiltrados = useMemo(() => {
    if (estadoFiltro === 'TODOS') return cambios;
    return cambios.filter((c) => c.estado === estadoFiltro);
  }, [cambios, estadoFiltro]);

  const handleAbrirModal = (cambioParaReintentar?: CambioSolicitud) => {
    setError(null);
    setSuccess(null);
    if (cambioParaReintentar) {
      setReintentar(cambioParaReintentar);
      setForm({ fechaNueva: cambioParaReintentar.fechaNueva, turnoIdNuevo: cambioParaReintentar.turnoIdNuevo });
    } else {
      setReintentar(null);
      setForm({ fechaNueva: '', turnoIdNuevo: '' });
    }
    setShowModal(true);
  };

  const handleCerrarModal = () => {
    if (!isSaving) {
      setShowModal(false);
      setForm({ fechaNueva: '', turnoIdNuevo: '' });
      setReintentar(null);
    }
  };

  // Handle Escape key to close modal
  useEffect(() => {
    if (!showModal) return;
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isSaving) {
        handleCerrarModal();
      }
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [showModal, isSaving]);

  const validarFormulario = (): string | null => {
    if (!form.fechaNueva) return 'Debe seleccionar una fecha';
    if (!form.turnoIdNuevo) return 'Debe seleccionar un turno';

    const fechaNuevaDate = new Date(form.fechaNueva);
    const hoyDate = new Date(hoyStr);
    hoyDate.setHours(0, 0, 0, 0);

    if (fechaNuevaDate <= hoyDate) {
      return 'La fecha debe ser futura (posterior a hoy)';
    }

    if (form.fechaNueva === hoyStr) {
      return 'La fecha debe ser diferente a la de hoy';
    }

    return null;
  };

  const handleGuardar = async () => {
    const validacion = validarFormulario();
    if (validacion) {
      setError(validacion);
      return;
    }

    if (!turnoHoy || !turnoHoy.turnoId) {
      setError('No se pudo determinar tu turno actual');
      return;
    }

    setError(null);
    setSuccess(null);
    setIsSaving(true);
    try {
      await solicitarCambio({
        fechaActual: hoyStr,
        turnoIdActual: turnoHoy.turnoId,
        fechaNueva: form.fechaNueva,
        turnoIdNuevo: form.turnoIdNuevo,
        creadoPor: me!.userId,
      });
      setSuccess('Cambio de turno solicitado exitosamente');
      handleCerrarModal();
      await refrescar();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setIsSaving(false);
    }
  };

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget && !isSaving) {
      handleCerrarModal();
    }
  };

  // Utilidades de formato
  function getNombreTurno(turnoId: string | null): string {
    if (!turnoId) return 'Descanso';
    const turno = turnos.find((t) => t.id === turnoId);
    return turno ? turno.nombre : `Turno ${turnoId.slice(0, 8)}`;
  }

  function getColorEstado(estado: EstadoCambio): string {
    if (estado === 'PENDIENTE') return 'bg-yellow-100 text-yellow-800';
    if (estado === 'APROBADA') return 'bg-emerald-100 text-emerald-800';
    return 'bg-red-100 text-red-800';
  }

  return (
    <div className="space-y-6 text-sm">
      {error && <p className="rounded bg-red-50 px-3 py-2 text-red-700">{error}</p>}
      {success && <p className="rounded bg-emerald-50 px-3 py-2 text-emerald-700">{success}</p>}

      {/* Encabezado con filtro y botón */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <label className="font-medium text-slate-700">Estado:</label>
          <select
            value={estadoFiltro}
            onChange={(e) => setEstadoFiltro(e.target.value as EstadoCambio | 'TODOS')}
            className="rounded border border-slate-300 px-3 py-1.5"
          >
            <option value="TODOS">Todos</option>
            <option value="PENDIENTE">Pendientes</option>
            <option value="APROBADA">Aprobados</option>
            <option value="RECHAZADA">Rechazados</option>
          </select>
        </div>
        <button
          onClick={() => handleAbrirModal()}
          disabled={isLoading || !turnoHoy}
          className="rounded bg-slate-900 px-4 py-2 font-medium text-white hover:bg-slate-800 disabled:opacity-50"
        >
          + NUEVO CAMBIO
        </button>
      </div>

      {/* Información del turno actual */}
      {turnoHoy && (
        <div className="rounded border border-slate-200 bg-slate-50 p-3">
          <p className="text-slate-600">
            <span className="font-medium">Turno actual:</span> {getNombreTurno(turnoHoy.turnoId)} ({hoyStr})
          </p>
        </div>
      )}

      {/* Tabla de solicitudes */}
      {isLoading ? (
        <p className="text-slate-500">Cargando solicitudes...</p>
      ) : cambiosFiltrados.length === 0 ? (
        <p className="rounded bg-slate-50 px-3 py-3 text-slate-500">
          {cambios.length === 0 ? 'No hay solicitudes de cambio.' : 'No hay solicitudes en este estado.'}
        </p>
      ) : (
        <div className="space-y-3">
          {cambiosFiltrados.map((cambio) => (
            <div key={cambio.id} className="rounded border border-slate-200 bg-white p-4">
              <div className="mb-3 flex items-start justify-between">
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="text-slate-600">
                      <span className="font-medium">Cambio del:</span> {cambio.fechaActual}
                    </span>
                    <span className="text-slate-600">
                      (<span className="font-medium">{getNombreTurno(cambio.turnoIdActual)}</span>)
                    </span>
                    <span className="text-slate-400">→</span>
                    <span className="text-slate-600">
                      <span className="font-medium">{cambio.fechaNueva}</span>
                    </span>
                    <span className="text-slate-600">
                      (<span className="font-medium">{getNombreTurno(cambio.turnoIdNuevo)}</span>)
                    </span>
                  </div>
                  <div className="text-xs text-slate-500">
                    Solicitado: {cambio.creadoEn.slice(0, 10)}
                  </div>
                </div>
                <span className={`rounded px-2 py-1 font-medium ${getColorEstado(cambio.estado)}`}>
                  {cambio.estado}
                </span>
              </div>

              {cambio.estado === 'RECHAZADA' && cambio.motivoRechazo && (
                <div className="mb-3 rounded bg-red-50 p-2 text-red-700">
                  <p className="text-xs font-medium">Motivo del rechazo:</p>
                  <p className="text-xs">{cambio.motivoRechazo}</p>
                </div>
              )}

              {cambio.estado === 'RECHAZADA' && (
                <button
                  onClick={() => handleAbrirModal(cambio)}
                  className="rounded border border-slate-300 px-3 py-1 text-xs font-medium hover:bg-slate-50"
                >
                  [Reintentar]
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Modal de formulario */}
      {showModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50"
          onClick={handleBackdropClick}
          role="presentation"
        >
          <div
            className="w-full max-w-md rounded-lg bg-white p-6 shadow-lg"
            role="dialog"
            aria-modal="true"
            aria-labelledby={modalHeadingId.current}
          >
            <h2 id={modalHeadingId.current} className="mb-4 text-lg font-semibold">
              {reintentar ? 'Reintentar cambio de turno' : 'Solicitar cambio de turno'}
            </h2>

            {error && (
              <p className="mb-4 rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
            )}

            <div className="space-y-4">
              {/* Turno actual (read-only) */}
              {turnoHoy && (
                <div>
                  <label className="block text-sm font-medium text-slate-700">
                    Turno actual
                  </label>
                  <input
                    type="text"
                    value={`${getNombreTurno(turnoHoy.turnoId)} (${hoyStr})`}
                    disabled
                    className="mt-1 block w-full rounded border border-slate-300 bg-slate-50 px-3 py-2 text-slate-500"
                  />
                </div>
              )}

              {/* Fecha nueva */}
              <div>
                <label htmlFor="fecha-nueva" className="block text-sm font-medium text-slate-700">
                  Fecha solicitada (futura)
                </label>
                <input
                  id="fecha-nueva"
                  type="date"
                  value={form.fechaNueva}
                  onChange={(e) => setForm({ ...form, fechaNueva: e.target.value })}
                  min={new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10)}
                  disabled={isSaving}
                  className="mt-1 block w-full rounded border border-slate-300 px-3 py-2"
                />
              </div>

              {/* Turno solicitado */}
              <div>
                <label htmlFor="turno-nuevo" className="block text-sm font-medium text-slate-700">
                  Tipo de turno solicitado
                </label>
                <select
                  id="turno-nuevo"
                  value={form.turnoIdNuevo}
                  onChange={(e) => setForm({ ...form, turnoIdNuevo: e.target.value })}
                  disabled={isSaving}
                  className="mt-1 block w-full rounded border border-slate-300 px-3 py-2"
                >
                  <option value="">— Seleccionar —</option>
                  {turnos.map((turno) => (
                    <option key={turno.id} value={turno.id}>
                      {turno.nombre}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Acciones */}
            <div className="mt-6 flex justify-end gap-3">
              <button
                onClick={handleCerrarModal}
                disabled={isSaving}
                className="rounded border border-slate-300 px-4 py-2 font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                onClick={handleGuardar}
                disabled={isSaving}
                className="rounded bg-slate-900 px-4 py-2 font-medium text-white hover:bg-slate-800 disabled:opacity-50"
              >
                {isSaving ? 'Guardando...' : 'Solicitar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
