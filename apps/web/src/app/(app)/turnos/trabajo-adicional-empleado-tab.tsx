'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  enviarReporteTrabajo,
  listarMisTrabajos,
  solicitarTrabajoAdicional,
  EstadoTrabajoAdicional,
  SolicitudTrabajoAdicional,
} from './shifts-api';

const SUB_TABS = [
  { id: 'solicitar', label: 'Solicitar' },
  { id: 'mis-trabajos', label: 'Mis Trabajos' },
] as const;

const MAX_FOTO_BYTES = 5 * 1024 * 1024;
const MIN_FOTOS = 2;
const TIPOS_PERMITIDOS = ['image/jpeg', 'image/png'];

function fechaMinima(): string {
  return new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function getColorEstado(estado: EstadoTrabajoAdicional): string {
  if (estado === 'PENDIENTE_APROBACION') return 'bg-yellow-100 text-yellow-800';
  if (estado === 'APROBADA' || estado === 'REASIGNADA' || estado === 'VALIDADA') {
    return 'bg-emerald-100 text-emerald-800';
  }
  if (estado === 'RECHAZADA' || estado === 'REPORTE_RECHAZADO') return 'bg-red-100 text-red-800';
  if (estado === 'REPORTE_PENDIENTE_VALIDACION') return 'bg-orange-100 text-orange-800';
  return 'bg-slate-100 text-slate-800';
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('No se pudo leer el archivo'));
    reader.readAsDataURL(file);
  });
}

export function TrabajoAdicionalEmpleadoTab() {
  const [subTab, setSubTab] = useState<(typeof SUB_TABS)[number]['id']>('solicitar');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // --- Solicitar ---
  const [form, setForm] = useState({
    descripcionTarea: '',
    fechaEstimada: '',
    horasEstimadas: '',
    urgencia: 'NORMAL' as 'NORMAL' | 'URGENTE',
  });
  const [isSaving, setIsSaving] = useState(false);

  // --- Mis Trabajos ---
  const [trabajos, setTrabajos] = useState<SolicitudTrabajoAdicional[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [estadoFiltro, setEstadoFiltro] = useState<EstadoTrabajoAdicional | 'TODOS'>('TODOS');

  // --- Modal de reporte ---
  const [showModal, setShowModal] = useState(false);
  const [solicitudReporte, setSolicitudReporte] = useState<SolicitudTrabajoAdicional | null>(null);
  const [reporteDescripcion, setReporteDescripcion] = useState('');
  const [reporteNotas, setReporteNotas] = useState('');
  const [fotos, setFotos] = useState<File[]>([]);
  const [isSavingReporte, setIsSavingReporte] = useState(false);
  const modalHeadingId = useRef('reporte-form-heading');

  useEffect(() => {
    if (subTab === 'mis-trabajos') {
      refrescar();
    }
  }, [subTab]);

  async function refrescar() {
    setError(null);
    setIsLoading(true);
    try {
      const data = await listarMisTrabajos();
      setTrabajos(data);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setIsLoading(false);
    }
  }

  const trabajosFiltrados = useMemo(() => {
    if (estadoFiltro === 'TODOS') return trabajos;
    return trabajos.filter((t) => t.estado === estadoFiltro);
  }, [trabajos, estadoFiltro]);

  // --- Solicitar handlers ---
  function validarFormularioSolicitud(): string | null {
    if (!form.descripcionTarea.trim()) return 'Debe ingresar una descripción de la tarea';
    if (!form.fechaEstimada) return 'Debe seleccionar una fecha';

    const fechaDate = new Date(form.fechaEstimada);
    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);
    if (fechaDate <= hoy) return 'La fecha debe ser futura (posterior a hoy)';

    const horas = Number(form.horasEstimadas);
    if (!form.horasEstimadas || Number.isNaN(horas)) return 'Debe ingresar las horas estimadas';
    if (horas <= 0 || horas > 12) return 'Las horas estimadas deben ser mayores a 0 y hasta 12';

    return null;
  }

  async function handleSolicitar() {
    const validacion = validarFormularioSolicitud();
    if (validacion) {
      setError(validacion);
      return;
    }

    setError(null);
    setSuccess(null);
    setIsSaving(true);
    try {
      await solicitarTrabajoAdicional({
        descripcionTarea: form.descripcionTarea,
        fechaEstimada: form.fechaEstimada,
        horasEstimadas: Number(form.horasEstimadas),
        urgencia: form.urgencia,
      });
      setSuccess('Solicitud creada. Manager revisará en breve.');
      setForm({ descripcionTarea: '', fechaEstimada: '', horasEstimadas: '', urgencia: 'NORMAL' });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setIsSaving(false);
    }
  }

  // --- Modal handlers ---
  function handleAbrirModal(solicitud: SolicitudTrabajoAdicional) {
    setError(null);
    setSuccess(null);
    setSolicitudReporte(solicitud);
    setReporteDescripcion('');
    setReporteNotas('');
    setFotos([]);
    setShowModal(true);
  }

  function handleCerrarModal() {
    if (isSavingReporte) return;
    setShowModal(false);
    setSolicitudReporte(null);
    setReporteDescripcion('');
    setReporteNotas('');
    setFotos([]);
  }

  useEffect(() => {
    if (!showModal) return;
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isSavingReporte) {
        handleCerrarModal();
      }
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [showModal, isSavingReporte]);

  function handleBackdropClick(e: React.MouseEvent) {
    if (e.target === e.currentTarget && !isSavingReporte) {
      handleCerrarModal();
    }
  }

  function handleSeleccionarFotos(e: React.ChangeEvent<HTMLInputElement>) {
    const seleccionadas = Array.from(e.target.files ?? []);
    e.target.value = '';
    if (seleccionadas.length === 0) return;

    for (const file of seleccionadas) {
      if (!TIPOS_PERMITIDOS.includes(file.type)) {
        setError(`Formato no permitido: ${file.name}. Solo se permiten JPG o PNG.`);
        return;
      }
      if (file.size > MAX_FOTO_BYTES) {
        setError(`El archivo ${file.name} supera el tamaño máximo de 5MB.`);
        return;
      }
    }

    setError(null);
    setFotos((prev) => [...prev, ...seleccionadas]);
  }

  function handleQuitarFoto(index: number) {
    setFotos((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleEnviarReporte() {
    if (!solicitudReporte) return;

    if (!reporteDescripcion.trim()) {
      setError('Debe ingresar la descripción de las actividades realizadas');
      return;
    }
    if (fotos.length < MIN_FOTOS) {
      setError(`Debe adjuntar al menos ${MIN_FOTOS} fotos`);
      return;
    }

    setError(null);
    setSuccess(null);
    setIsSavingReporte(true);
    try {
      const reporteFotos = await Promise.all(fotos.map((f) => readFileAsDataUrl(f)));
      await enviarReporteTrabajo(solicitudReporte.id, {
        reporteDescripcion,
        reporteFotos,
        reporteNotas: reporteNotas.trim() ? reporteNotas : undefined,
      });
      setSuccess('Reporte enviado. Manager validará en breve.');
      handleCerrarModal();
      await refrescar();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setIsSavingReporte(false);
    }
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

      {subTab === 'solicitar' && (
        <div className="max-w-lg space-y-4">
          <div>
            <label htmlFor="descripcion-tarea" className="block text-sm font-medium text-slate-700">
              Descripción de la tarea
            </label>
            <textarea
              id="descripcion-tarea"
              value={form.descripcionTarea}
              onChange={(e) => setForm({ ...form, descripcionTarea: e.target.value })}
              disabled={isSaving}
              rows={4}
              className="mt-1 block w-full rounded border border-slate-300 px-3 py-2"
            />
          </div>

          <div>
            <label htmlFor="fecha-estimada" className="block text-sm font-medium text-slate-700">
              Fecha estimada (futura)
            </label>
            <input
              id="fecha-estimada"
              type="date"
              value={form.fechaEstimada}
              onChange={(e) => setForm({ ...form, fechaEstimada: e.target.value })}
              min={fechaMinima()}
              disabled={isSaving}
              className="mt-1 block w-full rounded border border-slate-300 px-3 py-2"
            />
          </div>

          <div>
            <label htmlFor="horas-estimadas" className="block text-sm font-medium text-slate-700">
              Horas estimadas (máx. 12)
            </label>
            <input
              id="horas-estimadas"
              type="number"
              min={0.5}
              max={12}
              step={0.5}
              value={form.horasEstimadas}
              onChange={(e) => setForm({ ...form, horasEstimadas: e.target.value })}
              disabled={isSaving}
              className="mt-1 block w-full rounded border border-slate-300 px-3 py-2"
            />
          </div>

          <div>
            <label htmlFor="urgencia" className="block text-sm font-medium text-slate-700">
              Urgencia
            </label>
            <select
              id="urgencia"
              value={form.urgencia}
              onChange={(e) => setForm({ ...form, urgencia: e.target.value as 'NORMAL' | 'URGENTE' })}
              disabled={isSaving}
              className="mt-1 block w-full rounded border border-slate-300 px-3 py-2"
            >
              <option value="NORMAL">Normal</option>
              <option value="URGENTE">Urgente</option>
            </select>
          </div>

          <button
            onClick={handleSolicitar}
            disabled={isSaving}
            className="rounded bg-slate-900 px-4 py-2 font-medium text-white hover:bg-slate-800 disabled:opacity-50"
          >
            {isSaving ? 'Enviando...' : 'Solicitar'}
          </button>
        </div>
      )}

      {subTab === 'mis-trabajos' && (
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <label className="font-medium text-slate-700">Estado:</label>
            <select
              value={estadoFiltro}
              onChange={(e) => setEstadoFiltro(e.target.value as EstadoTrabajoAdicional | 'TODOS')}
              className="rounded border border-slate-300 px-3 py-1.5"
            >
              <option value="TODOS">Todos</option>
              <option value="PENDIENTE_APROBACION">Pendientes de aprobación</option>
              <option value="APROBADA">Aprobados</option>
              <option value="REASIGNADA">Reasignados</option>
              <option value="RECHAZADA">Rechazados</option>
              <option value="REPORTE_PENDIENTE_VALIDACION">Reporte pendiente de validación</option>
              <option value="REPORTE_RECHAZADO">Reporte rechazado</option>
              <option value="VALIDADA">Validados</option>
            </select>
          </div>

          {isLoading ? (
            <p className="text-slate-500">Cargando trabajos...</p>
          ) : trabajosFiltrados.length === 0 ? (
            <p className="rounded bg-slate-50 px-3 py-3 text-slate-500">
              {trabajos.length === 0 ? 'No hay solicitudes de trabajo adicional.' : 'No hay solicitudes en este estado.'}
            </p>
          ) : (
            <div className="space-y-3">
              {trabajosFiltrados.map((trabajo) => (
                <div key={trabajo.id} className="rounded border border-slate-200 bg-white p-4">
                  <div className="mb-3 flex items-start justify-between gap-4">
                    <div className="space-y-1">
                      <p className="font-medium text-slate-800">{trabajo.descripcionTarea}</p>
                      <p className="text-slate-600">
                        <span className="font-medium">Fecha:</span> {trabajo.fechaEstimada.slice(0, 10)}
                        {' · '}
                        <span className="font-medium">Horas:</span> {trabajo.horasEstimadas}
                      </p>
                      <div className="flex items-center gap-2">
                        <span
                          className={`rounded px-2 py-0.5 text-xs font-medium ${
                            trabajo.urgencia === 'URGENTE' ? 'bg-red-100 text-red-800' : 'bg-slate-100 text-slate-700'
                          }`}
                        >
                          {trabajo.urgencia}
                        </span>
                      </div>
                    </div>
                    <span className={`rounded px-2 py-1 text-xs font-medium ${getColorEstado(trabajo.estado)}`}>
                      {trabajo.estado}
                    </span>
                  </div>

                  {(trabajo.estado === 'RECHAZADA' || trabajo.estado === 'REPORTE_RECHAZADO') && trabajo.motivoRechazo && (
                    <div className="mb-3 rounded bg-red-50 p-2 text-red-700">
                      <p className="text-xs font-medium">Motivo del rechazo:</p>
                      <p className="text-xs">{trabajo.motivoRechazo}</p>
                    </div>
                  )}

                  {(trabajo.estado === 'APROBADA' || trabajo.estado === 'REASIGNADA') && (
                    <button
                      onClick={() => handleAbrirModal(trabajo)}
                      className="rounded border border-slate-300 px-3 py-1 text-xs font-medium hover:bg-slate-50"
                    >
                      [+ Enviar Reporte]
                    </button>
                  )}

                  {trabajo.estado === 'REPORTE_RECHAZADO' && (
                    <button
                      onClick={() => handleAbrirModal(trabajo)}
                      className="rounded border border-slate-300 px-3 py-1 text-xs font-medium hover:bg-slate-50"
                    >
                      [+ Reintentar Reporte]
                    </button>
                  )}

                  {trabajo.estado === 'VALIDADA' && (
                    <p className="text-xs font-medium text-emerald-700">Reporte Validado ✓</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Modal de reporte */}
      {showModal && solicitudReporte && (
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
              Enviar reporte de trabajo
            </h2>

            {error && (
              <p className="mb-4 rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
            )}

            <div className="space-y-4">
              <div>
                <label htmlFor="reporte-descripcion" className="block text-sm font-medium text-slate-700">
                  Descripción de actividades realizadas
                </label>
                <textarea
                  id="reporte-descripcion"
                  value={reporteDescripcion}
                  onChange={(e) => setReporteDescripcion(e.target.value)}
                  disabled={isSavingReporte}
                  rows={4}
                  className="mt-1 block w-full rounded border border-slate-300 px-3 py-2"
                />
              </div>

              <div>
                <label htmlFor="reporte-fotos" className="block text-sm font-medium text-slate-700">
                  Fotos (mínimo {MIN_FOTOS}, JPG/PNG, máx. 5MB c/u)
                </label>
                <input
                  id="reporte-fotos"
                  type="file"
                  accept="image/jpeg,image/png"
                  multiple
                  onChange={handleSeleccionarFotos}
                  disabled={isSavingReporte}
                  className="mt-1 block w-full text-sm"
                />
                {fotos.length > 0 && (
                  <ul className="mt-2 space-y-1">
                    {fotos.map((f, i) => (
                      <li key={`${f.name}-${i}`} className="flex items-center justify-between rounded bg-slate-50 px-2 py-1 text-xs">
                        <span className="truncate">{f.name}</span>
                        <button
                          onClick={() => handleQuitarFoto(i)}
                          disabled={isSavingReporte}
                          className="ml-2 text-red-600 hover:underline disabled:opacity-50"
                        >
                          Quitar
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div>
                <label htmlFor="reporte-notas" className="block text-sm font-medium text-slate-700">
                  Notas (opcional)
                </label>
                <textarea
                  id="reporte-notas"
                  value={reporteNotas}
                  onChange={(e) => setReporteNotas(e.target.value)}
                  disabled={isSavingReporte}
                  rows={2}
                  className="mt-1 block w-full rounded border border-slate-300 px-3 py-2"
                />
              </div>
            </div>

            <div className="mt-6 flex justify-end gap-3">
              <button
                onClick={handleCerrarModal}
                disabled={isSavingReporte}
                className="rounded border border-slate-300 px-4 py-2 font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                onClick={handleEnviarReporte}
                disabled={isSavingReporte}
                className="rounded bg-slate-900 px-4 py-2 font-medium text-white hover:bg-slate-800 disabled:opacity-50"
              >
                {isSavingReporte ? 'Enviando...' : 'Enviar Reporte'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
