'use client';

import { useEffect, useRef, useState } from 'react';
import { useAuth } from '@/components/auth-context';
import { EmpleadoResumen, listarEmpleados } from '../vacaciones/vacations-api';
import {
  aprobarTrabajoAdicional,
  listarPendientesTrabajo,
  listarReportesValidar,
  pedirReentregaReporte,
  reasignarTrabajoAdicional,
  rechazarTrabajoAdicional,
  SolicitudTrabajoAdicional,
  validarReporteTrabajo,
} from './shifts-api';

const SUB_TABS = [
  { id: 'pendientes', label: 'Pendientes de Aprobación' },
  { id: 'validar', label: 'Validar Reportes' },
] as const;

export function TrabajoAdicionalManagerTab() {
  const { me, hasPermission } = useAuth();
  const puedeGestionar = hasPermission('shift.manage');

  const [subTab, setSubTab] = useState<(typeof SUB_TABS)[number]['id']>('pendientes');
  const [empleados, setEmpleados] = useState<EmpleadoResumen[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // --- Pendientes de Aprobación ---
  const [pendientes, setPendientes] = useState<SolicitudTrabajoAdicional[]>([]);
  const [isLoadingPendientes, setIsLoadingPendientes] = useState(false);
  const [empleadoFiltroPendientes, setEmpleadoFiltroPendientes] = useState('');
  const [urgenciaFiltro, setUrgenciaFiltro] = useState<'NORMAL' | 'URGENTE' | ''>('');
  const [fechaDesdePendientes, setFechaDesdePendientes] = useState('');
  const [fechaHastaPendientes, setFechaHastaPendientes] = useState('');

  // --- Validar Reportes ---
  const [reportes, setReportes] = useState<SolicitudTrabajoAdicional[]>([]);
  const [isLoadingReportes, setIsLoadingReportes] = useState(false);
  const [empleadoFiltroReportes, setEmpleadoFiltroReportes] = useState('');
  const [fechaDesdeReportes, setFechaDesdeReportes] = useState('');
  const [fechaHastaReportes, setFechaHastaReportes] = useState('');

  // --- Modal Reasignar ---
  const [showModalReasignar, setShowModalReasignar] = useState(false);
  const [solicitudReasignar, setSolicitudReasignar] = useState<SolicitudTrabajoAdicional | null>(null);
  const [employeeIdNuevo, setEmployeeIdNuevo] = useState('');
  const [isReasignando, setIsReasignando] = useState(false);
  const reasignarHeadingId = useRef('reasignar-modal-heading');

  // --- Modal Rechazar (pendientes) ---
  const [showModalRechazo, setShowModalRechazo] = useState(false);
  const [solicitudRechazo, setSolicitudRechazo] = useState<SolicitudTrabajoAdicional | null>(null);
  const [motivoRechazo, setMotivoRechazo] = useState('');
  const [isRechazando, setIsRechazando] = useState(false);
  const rechazoHeadingId = useRef('rechazo-modal-heading');

  // --- Modal Pedir Reentrega (validar) ---
  const [showModalReentrega, setShowModalReentrega] = useState(false);
  const [solicitudReentrega, setSolicitudReentrega] = useState<SolicitudTrabajoAdicional | null>(null);
  const [motivoReentrega, setMotivoReentrega] = useState('');
  const [isPidiendoReentrega, setIsPidiendoReentrega] = useState(false);
  const reentregaHeadingId = useRef('reentrega-modal-heading');

  // --- Lightbox de foto de reporte ---
  const [fotoLightbox, setFotoLightbox] = useState<string | null>(null);
  const fotoLightboxHeadingId = useRef('foto-lightbox-heading');

  useEffect(() => {
    if (!puedeGestionar) return;
    listarEmpleados().then(setEmpleados).catch((e) => setError((e as Error).message));
    refrescarPendientes();
    refrescarReportes();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [puedeGestionar]);

  function getNombreEmpleado(employeeId: string): string {
    const emp = empleados.find((e) => e.id === employeeId);
    return emp ? `${emp.apellidos}, ${emp.nombres}` : `Empleado ${employeeId.slice(0, 8)}`;
  }

  async function refrescarPendientes() {
    setError(null);
    setIsLoadingPendientes(true);
    try {
      const filtros: { employeeId?: string; fechaDesde?: string; fechaHasta?: string } = {};
      if (empleadoFiltroPendientes) filtros.employeeId = empleadoFiltroPendientes;
      if (fechaDesdePendientes) filtros.fechaDesde = fechaDesdePendientes;
      if (fechaHastaPendientes) filtros.fechaHasta = fechaHastaPendientes;

      let data = await listarPendientesTrabajo(filtros);
      if (urgenciaFiltro) data = data.filter((s) => s.urgencia === urgenciaFiltro);
      setPendientes(data);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setIsLoadingPendientes(false);
    }
  }

  async function refrescarReportes() {
    setError(null);
    setIsLoadingReportes(true);
    try {
      const filtros: { employeeId?: string; fechaDesde?: string; fechaHasta?: string } = {};
      if (empleadoFiltroReportes) filtros.employeeId = empleadoFiltroReportes;
      if (fechaDesdeReportes) filtros.fechaDesde = fechaDesdeReportes;
      if (fechaHastaReportes) filtros.fechaHasta = fechaHastaReportes;

      const data = await listarReportesValidar(filtros);
      setReportes(data);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setIsLoadingReportes(false);
    }
  }

  // --- Aprobar ---
  async function handleAprobar(solicitud: SolicitudTrabajoAdicional) {
    setError(null);
    setSuccess(null);
    try {
      await aprobarTrabajoAdicional(solicitud.id, me!.userId);
      setSuccess(`Solicitud aprobada: ${getNombreEmpleado(solicitud.employeeIdAsignado)}`);
      setPendientes((prev) => prev.filter((s) => s.id !== solicitud.id));
    } catch (e) {
      setError((e as Error).message);
    }
  }

  // --- Reasignar ---
  function handleAbrirReasignar(solicitud: SolicitudTrabajoAdicional) {
    setError(null);
    setSuccess(null);
    setSolicitudReasignar(solicitud);
    setEmployeeIdNuevo('');
    setShowModalReasignar(true);
  }

  function handleCerrarReasignar() {
    if (isReasignando) return;
    setShowModalReasignar(false);
    setSolicitudReasignar(null);
    setEmployeeIdNuevo('');
  }

  async function handleConfirmarReasignar() {
    if (!solicitudReasignar || !employeeIdNuevo) {
      setError('Debe seleccionar un empleado');
      return;
    }
    setError(null);
    setSuccess(null);
    setIsReasignando(true);
    try {
      await reasignarTrabajoAdicional(solicitudReasignar.id, me!.userId, employeeIdNuevo);
      setSuccess(`Solicitud reasignada a ${getNombreEmpleado(employeeIdNuevo)}`);
      setPendientes((prev) => prev.filter((s) => s.id !== solicitudReasignar.id));
      handleCerrarReasignar();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setIsReasignando(false);
    }
  }

  // --- Rechazar (pendientes) ---
  function handleAbrirRechazo(solicitud: SolicitudTrabajoAdicional) {
    setError(null);
    setSuccess(null);
    setSolicitudRechazo(solicitud);
    setMotivoRechazo('');
    setShowModalRechazo(true);
  }

  function handleCerrarRechazo() {
    if (isRechazando) return;
    setShowModalRechazo(false);
    setSolicitudRechazo(null);
    setMotivoRechazo('');
  }

  async function handleConfirmarRechazo() {
    if (!solicitudRechazo || !motivoRechazo.trim()) {
      setError('Debe ingresar un motivo de rechazo');
      return;
    }
    setError(null);
    setSuccess(null);
    setIsRechazando(true);
    try {
      await rechazarTrabajoAdicional(solicitudRechazo.id, me!.userId, motivoRechazo);
      setSuccess(`Solicitud rechazada: ${getNombreEmpleado(solicitudRechazo.employeeIdAsignado)}`);
      setPendientes((prev) => prev.filter((s) => s.id !== solicitudRechazo.id));
      handleCerrarRechazo();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setIsRechazando(false);
    }
  }

  // --- Validar reporte ---
  async function handleValidar(solicitud: SolicitudTrabajoAdicional) {
    setError(null);
    setSuccess(null);
    try {
      await validarReporteTrabajo(solicitud.id, me!.userId);
      setSuccess('Compensatorio registrado');
      setReportes((prev) => prev.filter((s) => s.id !== solicitud.id));
    } catch (e) {
      setError((e as Error).message);
    }
  }

  // --- Pedir reentrega ---
  function handleAbrirReentrega(solicitud: SolicitudTrabajoAdicional) {
    setError(null);
    setSuccess(null);
    setSolicitudReentrega(solicitud);
    setMotivoReentrega('');
    setShowModalReentrega(true);
  }

  function handleCerrarReentrega() {
    if (isPidiendoReentrega) return;
    setShowModalReentrega(false);
    setSolicitudReentrega(null);
    setMotivoReentrega('');
  }

  async function handleConfirmarReentrega() {
    if (!solicitudReentrega || !motivoReentrega.trim()) {
      setError('Debe ingresar un motivo');
      return;
    }
    setError(null);
    setSuccess(null);
    setIsPidiendoReentrega(true);
    try {
      await pedirReentregaReporte(solicitudReentrega.id, me!.userId, motivoReentrega);
      setSuccess(`Reentrega solicitada: ${getNombreEmpleado(solicitudReentrega.employeeIdAsignado)}`);
      setReportes((prev) => prev.filter((s) => s.id !== solicitudReentrega.id));
      handleCerrarReentrega();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setIsPidiendoReentrega(false);
    }
  }

  // --- Escape key handlers ---
  useEffect(() => {
    if (!showModalReasignar && !showModalRechazo && !showModalReentrega && !fotoLightbox) return;
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (showModalReasignar) handleCerrarReasignar();
      if (showModalRechazo) handleCerrarRechazo();
      if (showModalReentrega) handleCerrarReentrega();
      if (fotoLightbox) handleCerrarFotoLightbox();
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    showModalReasignar,
    showModalRechazo,
    showModalReentrega,
    fotoLightbox,
    isReasignando,
    isRechazando,
    isPidiendoReentrega,
  ]);

  function handleBackdropClickReasignar(e: React.MouseEvent) {
    if (e.target === e.currentTarget) handleCerrarReasignar();
  }
  function handleBackdropClickRechazo(e: React.MouseEvent) {
    if (e.target === e.currentTarget) handleCerrarRechazo();
  }
  function handleBackdropClickReentrega(e: React.MouseEvent) {
    if (e.target === e.currentTarget) handleCerrarReentrega();
  }
  function handleBackdropClickFotoLightbox(e: React.MouseEvent) {
    if (e.target === e.currentTarget) handleCerrarFotoLightbox();
  }

  function abrirFoto(foto: string) {
    setFotoLightbox(foto);
  }

  function handleCerrarFotoLightbox() {
    setFotoLightbox(null);
  }

  if (!puedeGestionar) {
    return (
      <div className="rounded bg-yellow-50 px-4 py-3 text-yellow-800">
        <p className="font-medium">Acceso denegado</p>
        <p className="text-sm">No tienes permisos para gestionar trabajo fuera de turno.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 text-sm">
      {/* Sub-tabs */}
      <div className="flex gap-1 border-b border-slate-200">
        {SUB_TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => {
              setSubTab(t.id);
              setError(null);
              setSuccess(null);
            }}
            className={`px-3 py-2 text-sm font-medium ${
              subTab === t.id ? 'border-b-2 border-slate-900 text-slate-900' : 'text-slate-500'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {error && <p className="rounded bg-red-50 px-3 py-2 text-red-700">{error}</p>}
      {success && <p className="rounded bg-emerald-50 px-3 py-2 text-emerald-700">{success}</p>}

      {subTab === 'pendientes' && (
        <div className="space-y-4">
          {/* Filtros */}
          <div className="space-y-3 rounded bg-slate-50 p-4">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
              <div>
                <label htmlFor="empleado-filtro-pendientes" className="block text-xs font-medium text-slate-700">
                  Empleado
                </label>
                <select
                  id="empleado-filtro-pendientes"
                  value={empleadoFiltroPendientes}
                  onChange={(e) => setEmpleadoFiltroPendientes(e.target.value)}
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
                <label htmlFor="urgencia-filtro" className="block text-xs font-medium text-slate-700">
                  Urgencia
                </label>
                <select
                  id="urgencia-filtro"
                  value={urgenciaFiltro}
                  onChange={(e) => setUrgenciaFiltro(e.target.value as 'NORMAL' | 'URGENTE' | '')}
                  className="mt-1 block w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
                >
                  <option value="">— Todas —</option>
                  <option value="NORMAL">Normal</option>
                  <option value="URGENTE">Urgente</option>
                </select>
              </div>
              <div>
                <label htmlFor="fecha-desde-pendientes" className="block text-xs font-medium text-slate-700">
                  Desde
                </label>
                <input
                  id="fecha-desde-pendientes"
                  type="date"
                  value={fechaDesdePendientes}
                  onChange={(e) => setFechaDesdePendientes(e.target.value)}
                  className="mt-1 block w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
                />
              </div>
              <div>
                <label htmlFor="fecha-hasta-pendientes" className="block text-xs font-medium text-slate-700">
                  Hasta
                </label>
                <input
                  id="fecha-hasta-pendientes"
                  type="date"
                  value={fechaHastaPendientes}
                  onChange={(e) => setFechaHastaPendientes(e.target.value)}
                  className="mt-1 block w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => {
                  setEmpleadoFiltroPendientes('');
                  setUrgenciaFiltro('');
                  setFechaDesdePendientes('');
                  setFechaHastaPendientes('');
                }}
                className="rounded border border-slate-300 px-3 py-1.5 text-xs hover:bg-slate-100"
              >
                Limpiar
              </button>
              <button
                onClick={refrescarPendientes}
                disabled={isLoadingPendientes}
                className="rounded bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50"
              >
                {isLoadingPendientes ? 'Cargando...' : 'Filtrar'}
              </button>
            </div>
          </div>

          {/* Lista */}
          {isLoadingPendientes ? (
            <p className="text-slate-500">Cargando solicitudes...</p>
          ) : pendientes.length === 0 ? (
            <p className="rounded bg-slate-50 px-3 py-3 text-slate-500">No hay solicitudes pendientes de aprobación.</p>
          ) : (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {pendientes.map((s) => (
                <div key={s.id} className="rounded border border-slate-200 bg-white p-4">
                  <div className="mb-2 flex items-start justify-between gap-2">
                    <p className="font-medium text-slate-900">{getNombreEmpleado(s.employeeIdAsignado)}</p>
                    <span
                      className={`rounded px-2 py-0.5 text-xs font-medium ${
                        s.urgencia === 'URGENTE' ? 'bg-red-100 text-red-800' : 'bg-slate-100 text-slate-700'
                      }`}
                    >
                      {s.urgencia}
                    </span>
                  </div>
                  <p className="mb-1 text-slate-700">{s.descripcionTarea}</p>
                  <p className="mb-2 text-xs text-slate-500">
                    <span className="font-medium">Fecha:</span> {s.fechaEstimada.slice(0, 10)}
                    {' · '}
                    <span className="font-medium">Horas:</span> {s.horasEstimadas}
                  </p>

                  <div className="mb-3 space-y-1 rounded bg-amber-50 p-2 text-xs">
                    <p>
                      <span className="font-medium">¿Causa horas extras?</span>{' '}
                      <span className={s.causaHorasExtras ? 'font-bold text-red-700' : 'text-slate-700'}>
                        {s.causaHorasExtras ? 'SÍ' : 'NO'}
                      </span>
                    </p>
                    <p>
                      <span className="font-medium">Horas acumuladas:</span> {s.horasAcumuladas ?? 0}h
                    </p>
                    <p>
                      <span className="font-medium">Saldo compensatorios:</span> {s.saldoCompensatorios ?? 0} día(s)
                    </p>
                  </div>

                  <div className="flex flex-wrap gap-2 border-t border-slate-200 pt-2">
                    <button
                      onClick={() => handleAprobar(s)}
                      className="rounded bg-emerald-600 px-2 py-1 text-xs font-medium text-white hover:bg-emerald-700"
                    >
                      Aprobar
                    </button>
                    <button
                      onClick={() => handleAbrirReasignar(s)}
                      className="rounded bg-slate-700 px-2 py-1 text-xs font-medium text-white hover:bg-slate-800"
                    >
                      Reasignar
                    </button>
                    <button
                      onClick={() => handleAbrirRechazo(s)}
                      className="rounded bg-red-600 px-2 py-1 text-xs font-medium text-white hover:bg-red-700"
                    >
                      Rechazar
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {subTab === 'validar' && (
        <div className="space-y-4">
          {/* Filtros */}
          <div className="space-y-3 rounded bg-slate-50 p-4">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <div>
                <label htmlFor="empleado-filtro-reportes" className="block text-xs font-medium text-slate-700">
                  Empleado
                </label>
                <select
                  id="empleado-filtro-reportes"
                  value={empleadoFiltroReportes}
                  onChange={(e) => setEmpleadoFiltroReportes(e.target.value)}
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
                <label htmlFor="fecha-desde-reportes" className="block text-xs font-medium text-slate-700">
                  Desde
                </label>
                <input
                  id="fecha-desde-reportes"
                  type="date"
                  value={fechaDesdeReportes}
                  onChange={(e) => setFechaDesdeReportes(e.target.value)}
                  className="mt-1 block w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
                />
              </div>
              <div>
                <label htmlFor="fecha-hasta-reportes" className="block text-xs font-medium text-slate-700">
                  Hasta
                </label>
                <input
                  id="fecha-hasta-reportes"
                  type="date"
                  value={fechaHastaReportes}
                  onChange={(e) => setFechaHastaReportes(e.target.value)}
                  className="mt-1 block w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => {
                  setEmpleadoFiltroReportes('');
                  setFechaDesdeReportes('');
                  setFechaHastaReportes('');
                }}
                className="rounded border border-slate-300 px-3 py-1.5 text-xs hover:bg-slate-100"
              >
                Limpiar
              </button>
              <button
                onClick={refrescarReportes}
                disabled={isLoadingReportes}
                className="rounded bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50"
              >
                {isLoadingReportes ? 'Cargando...' : 'Filtrar'}
              </button>
            </div>
          </div>

          {/* Lista */}
          {isLoadingReportes ? (
            <p className="text-slate-500">Cargando reportes...</p>
          ) : reportes.length === 0 ? (
            <p className="rounded bg-slate-50 px-3 py-3 text-slate-500">No hay reportes pendientes de validación.</p>
          ) : (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {reportes.map((s) => (
                <div key={s.id} className="rounded border border-slate-200 bg-white p-4">
                  <p className="font-medium text-slate-900">{getNombreEmpleado(s.employeeIdAsignado)}</p>
                  <p className="mb-1 text-slate-700">{s.descripcionTarea}</p>
                  <p className="mb-2 text-xs text-slate-500">
                    <span className="font-medium">Fecha:</span> {s.fechaEstimada.slice(0, 10)}
                    {' · '}
                    <span className="font-medium">Horas:</span> {s.horasEstimadas}
                  </p>

                  {s.reporteDescripcion && (
                    <p className="mb-2 line-clamp-3 text-xs text-slate-600">{s.reporteDescripcion}</p>
                  )}

                  {s.reporteFotos.length > 0 && (
                    <div className="mb-2 flex flex-wrap gap-2">
                      {s.reporteFotos.map((foto, i) => (
                        <img
                          key={i}
                          src={foto}
                          alt={`Foto ${i + 1}`}
                          onClick={() => abrirFoto(foto)}
                          className="h-16 w-16 cursor-pointer rounded object-cover"
                        />
                      ))}
                    </div>
                  )}

                  {s.reporteNotas && (
                    <p className="mb-2 rounded bg-slate-50 p-2 text-xs text-slate-600">
                      <span className="font-medium">Notas:</span> {s.reporteNotas}
                    </p>
                  )}

                  <div className="flex flex-wrap gap-2 border-t border-slate-200 pt-2">
                    <button
                      onClick={() => handleValidar(s)}
                      className="rounded bg-emerald-600 px-2 py-1 text-xs font-medium text-white hover:bg-emerald-700"
                    >
                      Validar
                    </button>
                    <button
                      onClick={() => handleAbrirReentrega(s)}
                      className="rounded bg-red-600 px-2 py-1 text-xs font-medium text-white hover:bg-red-700"
                    >
                      Pedir Reentrega
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Modal Reasignar */}
      {showModalReasignar && solicitudReasignar && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50"
          onClick={handleBackdropClickReasignar}
          role="presentation"
        >
          <div
            className="w-full max-w-md rounded-lg bg-white p-6 shadow-lg"
            role="dialog"
            aria-modal="true"
            aria-labelledby={reasignarHeadingId.current}
          >
            <h2 id={reasignarHeadingId.current} className="mb-4 text-lg font-semibold">
              Reasignar trabajo adicional
            </h2>

            <div className="mb-4 space-y-2 rounded bg-slate-50 p-3 text-sm">
              <p className="font-medium text-slate-900">{getNombreEmpleado(solicitudReasignar.employeeIdAsignado)}</p>
              <p className="text-xs text-slate-600">{solicitudReasignar.descripcionTarea}</p>
            </div>

            <div className="mb-4">
              <label htmlFor="empleado-nuevo" className="block text-sm font-medium text-slate-700">
                Nuevo empleado asignado
              </label>
              <select
                id="empleado-nuevo"
                value={employeeIdNuevo}
                onChange={(e) => setEmployeeIdNuevo(e.target.value)}
                disabled={isReasignando}
                className="mt-2 block w-full rounded border border-slate-300 px-3 py-2 text-sm"
              >
                <option value="">— Seleccionar —</option>
                {empleados
                  .filter((emp) => emp.id !== solicitudReasignar.employeeIdAsignado)
                  .map((emp) => (
                    <option key={emp.id} value={emp.id}>
                      {emp.apellidos}, {emp.nombres}
                    </option>
                  ))}
              </select>
            </div>

            {error && (
              <p className="mb-4 rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
            )}

            <div className="flex justify-end gap-3">
              <button
                onClick={handleCerrarReasignar}
                disabled={isReasignando}
                className="rounded border border-slate-300 px-4 py-2 font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                onClick={handleConfirmarReasignar}
                disabled={isReasignando || !employeeIdNuevo}
                className="rounded bg-slate-900 px-4 py-2 font-medium text-white hover:bg-slate-800 disabled:opacity-50"
              >
                {isReasignando ? 'Reasignando...' : 'Confirmar reasignación'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Rechazar (pendientes) */}
      {showModalRechazo && solicitudRechazo && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50"
          onClick={handleBackdropClickRechazo}
          role="presentation"
        >
          <div
            className="w-full max-w-md rounded-lg bg-white p-6 shadow-lg"
            role="dialog"
            aria-modal="true"
            aria-labelledby={rechazoHeadingId.current}
          >
            <h2 id={rechazoHeadingId.current} className="mb-4 text-lg font-semibold">
              Rechazar trabajo adicional
            </h2>

            <div className="mb-4 space-y-2 rounded bg-slate-50 p-3 text-sm">
              <p className="font-medium text-slate-900">{getNombreEmpleado(solicitudRechazo.employeeIdAsignado)}</p>
              <p className="text-xs text-slate-600">{solicitudRechazo.descripcionTarea}</p>
            </div>

            <div className="mb-4">
              <label htmlFor="motivo-rechazo-trabajo" className="block text-sm font-medium text-slate-700">
                Motivo del rechazo
              </label>
              <textarea
                id="motivo-rechazo-trabajo"
                value={motivoRechazo}
                onChange={(e) => setMotivoRechazo(e.target.value)}
                disabled={isRechazando}
                placeholder="Explica brevemente por qué se rechaza esta solicitud..."
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
                disabled={isRechazando}
                className="rounded border border-slate-300 px-4 py-2 font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                onClick={handleConfirmarRechazo}
                disabled={isRechazando || !motivoRechazo.trim()}
                className="rounded bg-red-600 px-4 py-2 font-medium text-white hover:bg-red-700 disabled:opacity-50"
              >
                {isRechazando ? 'Rechazando...' : 'Confirmar rechazo'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Pedir Reentrega (validar) */}
      {showModalReentrega && solicitudReentrega && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50"
          onClick={handleBackdropClickReentrega}
          role="presentation"
        >
          <div
            className="w-full max-w-md rounded-lg bg-white p-6 shadow-lg"
            role="dialog"
            aria-modal="true"
            aria-labelledby={reentregaHeadingId.current}
          >
            <h2 id={reentregaHeadingId.current} className="mb-4 text-lg font-semibold">
              Pedir reentrega de reporte
            </h2>

            <div className="mb-4 space-y-2 rounded bg-slate-50 p-3 text-sm">
              <p className="font-medium text-slate-900">{getNombreEmpleado(solicitudReentrega.employeeIdAsignado)}</p>
              <p className="text-xs text-slate-600">{solicitudReentrega.descripcionTarea}</p>
            </div>

            <div className="mb-4">
              <label htmlFor="motivo-reentrega" className="block text-sm font-medium text-slate-700">
                Motivo
              </label>
              <textarea
                id="motivo-reentrega"
                value={motivoReentrega}
                onChange={(e) => setMotivoReentrega(e.target.value)}
                disabled={isPidiendoReentrega}
                placeholder="Explica qué falta corregir en el reporte..."
                className="mt-2 block w-full rounded border border-slate-300 px-3 py-2 text-sm"
                rows={3}
              />
            </div>

            {error && (
              <p className="mb-4 rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
            )}

            <div className="flex justify-end gap-3">
              <button
                onClick={handleCerrarReentrega}
                disabled={isPidiendoReentrega}
                className="rounded border border-slate-300 px-4 py-2 font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                onClick={handleConfirmarReentrega}
                disabled={isPidiendoReentrega || !motivoReentrega.trim()}
                className="rounded bg-red-600 px-4 py-2 font-medium text-white hover:bg-red-700 disabled:opacity-50"
              >
                {isPidiendoReentrega ? 'Enviando...' : 'Confirmar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Lightbox de foto de reporte */}
      {fotoLightbox && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-80"
          onClick={handleBackdropClickFotoLightbox}
          role="presentation"
        >
          <div
            className="max-h-[90vh] max-w-[90vw]"
            role="dialog"
            aria-modal="true"
            aria-labelledby={fotoLightboxHeadingId.current}
          >
            <h2 id={fotoLightboxHeadingId.current} className="sr-only">
              Foto de reporte ampliada
            </h2>
            <img
              src={fotoLightbox}
              alt="Foto de reporte ampliada"
              className="max-h-[90vh] max-w-[90vw] cursor-pointer rounded object-contain"
              onClick={handleCerrarFotoLightbox}
            />
          </div>
        </div>
      )}
    </div>
  );
}
