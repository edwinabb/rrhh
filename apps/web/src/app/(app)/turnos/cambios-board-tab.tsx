'use client';

import { useEffect, useState, useRef, useMemo } from 'react';
import { useAuth } from '@/components/auth-context';
import { EmpleadoResumen, listarEmpleados } from '../vacaciones/vacations-api';
import {
  listarCambios, aprobarCambio, rechazarCambio, CambioSolicitud, EstadoCambio, Turno, listarTurnos,
} from './shifts-api';

export function CambiosBoardTab() {
  const { me, hasPermission } = useAuth();
  const puedeGestionar = hasPermission('shift.manage');

  const [cambios, setCambios] = useState<CambioSolicitud[]>([]);
  const [turnos, setTurnos] = useState<Turno[]>([]);
  const [empleados, setEmpleados] = useState<EmpleadoResumen[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  // Filtros
  const [empleadoFiltro, setEmpleadoFiltro] = useState<string>('');
  const [fechaDesde, setFechaDesde] = useState<string>('');
  const [fechaHasta, setFechaHasta] = useState<string>('');

  // Modal para rechazar
  const [showModalRechazo, setShowModalRechazo] = useState(false);
  const [cambioSeleccionado, setCambioSeleccionado] = useState<CambioSolicitud | null>(null);
  const [motivoRechazo, setMotivoRechazo] = useState<string>('');
  const [isRejectingState, setIsRejectingState] = useState(false);

  // Ref para modal
  const modalHeadingId = useRef('rechazo-modal-heading');

  // Cargar datos iniciales
  useEffect(() => {
    if (!puedeGestionar) return;
    refrescar();
    listarTurnos().then(setTurnos).catch((e) => setError((e as Error).message));
    listarEmpleados().then(setEmpleados).catch((e) => setError((e as Error).message));
  }, [puedeGestionar]);

  async function refrescar() {
    setError(null);
    setIsLoading(true);
    try {
      const filtros: any = {};
      if (empleadoFiltro) filtros.employeeId = empleadoFiltro;
      if (fechaDesde) filtros.fechaDesde = fechaDesde;
      if (fechaHasta) filtros.fechaHasta = fechaHasta;

      const cambiosData = await listarCambios(filtros);
      setCambios(cambiosData);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setIsLoading(false);
    }
  }

  // Agrupar cambios por estado
  const cambiosPorEstado = useMemo(() => {
    return {
      PENDIENTE: cambios.filter((c) => c.estado === 'PENDIENTE'),
      APROBADA: cambios.filter((c) => c.estado === 'APROBADA'),
      RECHAZADA: cambios.filter((c) => c.estado === 'RECHAZADA'),
    };
  }, [cambios]);

  // Obtener nombre del empleado
  function getNombreEmpleado(employeeId: string): string {
    const emp = empleados.find((e) => e.id === employeeId);
    return emp ? `${emp.apellidos}, ${emp.nombres}` : `Empleado ${employeeId.slice(0, 8)}`;
  }

  // Obtener nombre del turno
  function getNombreTurno(turnoId: string | null): string {
    if (!turnoId) return 'Descanso';
    const turno = turnos.find((t) => t.id === turnoId);
    return turno ? turno.nombre : `Turno ${turnoId.slice(0, 8)}`;
  }

  // Abrir modal de rechazo
  const handleAbrirRechazo = (cambio: CambioSolicitud) => {
    setCambioSeleccionado(cambio);
    setMotivoRechazo('');
    setShowModalRechazo(true);
  };

  // Cerrar modal de rechazo
  const handleCerrarRechazo = () => {
    if (!isRejectingState) {
      setShowModalRechazo(false);
      setCambioSeleccionado(null);
      setMotivoRechazo('');
    }
  };

  // Handle Escape key para cerrar modal
  useEffect(() => {
    if (!showModalRechazo) return;
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isRejectingState) {
        handleCerrarRechazo();
      }
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [showModalRechazo, isRejectingState]);

  // Aprobar cambio
  async function handleAprobar(cambio: CambioSolicitud) {
    setError(null);
    setSuccess(null);
    try {
      await aprobarCambio(cambio.id, me!.userId);
      setSuccess(`Cambio aprobado: ${getNombreEmpleado(cambio.employeeId)}`);
      // Actualizar el cambio en la lista
      setCambios((prev) =>
        prev.map((c) =>
          c.id === cambio.id ? { ...c, estado: 'APROBADA' as EstadoCambio } : c,
        ),
      );
    } catch (e) {
      setError((e as Error).message);
    }
  }

  // Rechazar cambio
  async function handleConfirmarRechazo() {
    if (!cambioSeleccionado || !motivoRechazo.trim()) {
      setError('Debe ingresar un motivo de rechazo');
      return;
    }

    setError(null);
    setSuccess(null);
    setIsRejectingState(true);
    try {
      await rechazarCambio(cambioSeleccionado.id, me!.userId, motivoRechazo);
      setSuccess(`Cambio rechazado: ${getNombreEmpleado(cambioSeleccionado.employeeId)}`);
      // Actualizar el cambio en la lista
      setCambios((prev) =>
        prev.map((c) =>
          c.id === cambioSeleccionado.id
            ? { ...c, estado: 'RECHAZADA' as EstadoCambio, motivoRechazo }
            : c,
        ),
      );
      handleCerrarRechazo();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setIsRejectingState(false);
    }
  }

  // Handle backdrop click para cerrar modal
  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget && !isRejectingState) {
      handleCerrarRechazo();
    }
  };

  if (!puedeGestionar) {
    return (
      <div className="rounded bg-yellow-50 px-4 py-3 text-yellow-800">
        <p className="font-medium">Acceso denegado</p>
        <p className="text-sm">No tienes permisos para gestionar cambios de turno.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 text-sm">
      {error && <p className="rounded bg-red-50 px-3 py-2 text-red-700">{error}</p>}
      {success && <p className="rounded bg-emerald-50 px-3 py-2 text-emerald-700">{success}</p>}

      {/* Filtros */}
      <div className="space-y-3 rounded bg-slate-50 p-4">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <div>
            <label htmlFor="empleado-filtro" className="block text-xs font-medium text-slate-700">
              Empleado
            </label>
            <select
              id="empleado-filtro"
              value={empleadoFiltro}
              onChange={(e) => setEmpleadoFiltro(e.target.value)}
              className="mt-1 block w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
            >
              <option value="">— Todos —</option>
              {empleados.map((emp) => (
                <option key={emp.id} value={emp.id}>
                  {emp.apellidos}, {emp.nombres}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="fecha-desde" className="block text-xs font-medium text-slate-700">
              Desde
            </label>
            <input
              id="fecha-desde"
              type="date"
              value={fechaDesde}
              onChange={(e) => setFechaDesde(e.target.value)}
              className="mt-1 block w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
            />
          </div>
          <div>
            <label htmlFor="fecha-hasta" className="block text-xs font-medium text-slate-700">
              Hasta
            </label>
            <input
              id="fecha-hasta"
              type="date"
              value={fechaHasta}
              onChange={(e) => setFechaHasta(e.target.value)}
              className="mt-1 block w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
            />
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <button
            onClick={() => {
              setEmpleadoFiltro('');
              setFechaDesde('');
              setFechaHasta('');
            }}
            className="rounded border border-slate-300 px-3 py-1.5 text-xs hover:bg-slate-100"
          >
            Limpiar
          </button>
          <button
            onClick={refrescar}
            disabled={isLoading}
            className="rounded bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50"
          >
            {isLoading ? 'Cargando...' : 'Filtrar'}
          </button>
        </div>
      </div>

      {/* Tablero Kanban 3 columnas */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {/* PENDIENTE */}
        <div className="space-y-2 rounded bg-yellow-50 p-3">
          <h2 className="font-semibold text-yellow-900">
            PENDIENTE <span className="text-sm font-normal">({cambiosPorEstado.PENDIENTE.length})</span>
          </h2>
          <div className="space-y-2">
            {cambiosPorEstado.PENDIENTE.map((cambio) => (
              <div key={cambio.id} className="rounded bg-white p-3 shadow-sm">
                <div className="mb-2 space-y-1">
                  <p className="font-medium text-slate-900">{getNombreEmpleado(cambio.employeeId)}</p>
                  <p className="text-xs text-slate-500">
                    <span className="font-medium">Actual:</span> {cambio.fechaActual} · {getNombreTurno(cambio.turnoIdActual)}
                  </p>
                  <p className="text-xs text-slate-500">
                    <span className="font-medium">Nueva:</span> {cambio.fechaNueva} · {getNombreTurno(cambio.turnoIdNuevo)}
                  </p>
                  <p className="text-xs text-slate-400">
                    Solicitado: {cambio.creadoEn.slice(0, 10)}
                  </p>
                </div>
                <div className="flex gap-2 border-t border-slate-200 pt-2">
                  <button
                    onClick={() => handleAprobar(cambio)}
                    className="flex-1 rounded bg-emerald-600 px-2 py-1 text-xs font-medium text-white hover:bg-emerald-700"
                  >
                    Aprobar
                  </button>
                  <button
                    onClick={() => handleAbrirRechazo(cambio)}
                    className="flex-1 rounded bg-red-600 px-2 py-1 text-xs font-medium text-white hover:bg-red-700"
                  >
                    Rechazar
                  </button>
                </div>
              </div>
            ))}
            {cambiosPorEstado.PENDIENTE.length === 0 && (
              <p className="text-xs text-slate-500">Sin solicitudes pendientes</p>
            )}
          </div>
        </div>

        {/* APROBADA */}
        <div className="space-y-2 rounded bg-emerald-50 p-3">
          <h2 className="font-semibold text-emerald-900">
            APROBADA <span className="text-sm font-normal">({cambiosPorEstado.APROBADA.length})</span>
          </h2>
          <div className="space-y-2">
            {cambiosPorEstado.APROBADA.map((cambio) => (
              <div key={cambio.id} className="rounded bg-white p-3 shadow-sm">
                <div className="space-y-1">
                  <p className="font-medium text-slate-900">{getNombreEmpleado(cambio.employeeId)}</p>
                  <p className="text-xs text-slate-500">
                    <span className="font-medium">Actual:</span> {cambio.fechaActual} · {getNombreTurno(cambio.turnoIdActual)}
                  </p>
                  <p className="text-xs text-slate-500">
                    <span className="font-medium">Nueva:</span> {cambio.fechaNueva} · {getNombreTurno(cambio.turnoIdNuevo)}
                  </p>
                  <p className="text-xs text-slate-400">
                    Solicitado: {cambio.creadoEn.slice(0, 10)}
                  </p>
                </div>
              </div>
            ))}
            {cambiosPorEstado.APROBADA.length === 0 && (
              <p className="text-xs text-slate-500">Sin solicitudes aprobadas</p>
            )}
          </div>
        </div>

        {/* RECHAZADA */}
        <div className="space-y-2 rounded bg-red-50 p-3">
          <h2 className="font-semibold text-red-900">
            RECHAZADA <span className="text-sm font-normal">({cambiosPorEstado.RECHAZADA.length})</span>
          </h2>
          <div className="space-y-2">
            {cambiosPorEstado.RECHAZADA.map((cambio) => (
              <div key={cambio.id} className="rounded bg-white p-3 shadow-sm">
                <div className="mb-2 space-y-1">
                  <p className="font-medium text-slate-900">{getNombreEmpleado(cambio.employeeId)}</p>
                  <p className="text-xs text-slate-500">
                    <span className="font-medium">Actual:</span> {cambio.fechaActual} · {getNombreTurno(cambio.turnoIdActual)}
                  </p>
                  <p className="text-xs text-slate-500">
                    <span className="font-medium">Nueva:</span> {cambio.fechaNueva} · {getNombreTurno(cambio.turnoIdNuevo)}
                  </p>
                  <p className="text-xs text-slate-400">
                    Solicitado: {cambio.creadoEn.slice(0, 10)}
                  </p>
                </div>
                {cambio.motivoRechazo && (
                  <div className="rounded bg-red-100 p-2 text-xs text-red-800">
                    <p className="font-medium">Motivo:</p>
                    <p>{cambio.motivoRechazo}</p>
                  </div>
                )}
              </div>
            ))}
            {cambiosPorEstado.RECHAZADA.length === 0 && (
              <p className="text-xs text-slate-500">Sin solicitudes rechazadas</p>
            )}
          </div>
        </div>
      </div>

      {/* Modal de rechazo */}
      {showModalRechazo && cambioSeleccionado && (
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
              Rechazar cambio de turno
            </h2>

            <div className="mb-4 space-y-2 rounded bg-slate-50 p-3 text-sm">
              <p className="font-medium text-slate-900">{getNombreEmpleado(cambioSeleccionado.employeeId)}</p>
              <p className="text-xs text-slate-600">
                {cambioSeleccionado.fechaActual} ({getNombreTurno(cambioSeleccionado.turnoIdActual)}) →{' '}
                {cambioSeleccionado.fechaNueva} ({getNombreTurno(cambioSeleccionado.turnoIdNuevo)})
              </p>
            </div>

            <div className="mb-4">
              <label htmlFor="motivo-rechazo" className="block text-sm font-medium text-slate-700">
                Motivo del rechazo
              </label>
              <textarea
                id="motivo-rechazo"
                value={motivoRechazo}
                onChange={(e) => setMotivoRechazo(e.target.value)}
                disabled={isRejectingState}
                placeholder="Explica brevemente por qué se rechaza este cambio..."
                className="mt-2 block w-full rounded border border-slate-300 px-3 py-2 text-sm"
                rows={3}
              />
            </div>

            {error && (
              <p className="mb-4 rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
            )}

            <div className="flex justify-end gap-3">
              <button
                onClick={handleCerrarRechazo}
                disabled={isRejectingState}
                className="rounded border border-slate-300 px-4 py-2 font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                onClick={handleConfirmarRechazo}
                disabled={isRejectingState || !motivoRechazo.trim()}
                className="rounded bg-red-600 px-4 py-2 font-medium text-white hover:bg-red-700 disabled:opacity-50"
              >
                {isRejectingState ? 'Rechazando...' : 'Confirmar rechazo'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
