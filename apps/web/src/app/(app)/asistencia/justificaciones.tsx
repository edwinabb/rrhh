'use client';

import { useEffect, useState } from 'react';
import {
  crearJustificacion,
  fetchJustificacionesPendientes,
  fmtFecha,
  hoyISO,
  MOTIVO_LABELS,
  resolverJustificacion,
  type EmployeeLite,
  type Justificacion,
  type MotivoJustificacion,
} from './attendance-api';

const MOTIVOS = Object.keys(MOTIVO_LABELS) as MotivoJustificacion[];

export function Justificaciones({
  ownEmployee,
  cargandoEmpleado,
  puedeAprobar,
  nombresPorEmpleado,
}: {
  ownEmployee: EmployeeLite | null;
  cargandoEmpleado: boolean;
  puedeAprobar: boolean;
  nombresPorEmpleado: Map<string, string>;
}) {
  // --- Formulario de creación ---
  const [motivo, setMotivo] = useState<MotivoJustificacion>('TARDANZA');
  const [fecha, setFecha] = useState(hoyISO());
  const [descripcion, setDescripcion] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [formOk, setFormOk] = useState<string | null>(null);

  // --- Pendientes (aprobador) ---
  // El backend hoy no expone GET de justificaciones: se intenta y, si no
  // existe, se degrada a la lista de justificaciones creadas en esta sesión.
  const [pendientes, setPendientes] = useState<Justificacion[]>([]);
  const [listadoDisponible, setListadoDisponible] = useState<boolean | null>(null);
  const [listaError, setListaError] = useState<string | null>(null);
  const [resolviendoId, setResolviendoId] = useState<string | null>(null);
  const [rechazandoId, setRechazandoId] = useState<string | null>(null);
  const [motivoRechazo, setMotivoRechazo] = useState('');
  const [resolverError, setResolverError] = useState<string | null>(null);
  const [resolverOk, setResolverOk] = useState<string | null>(null);

  useEffect(() => {
    if (!puedeAprobar) return;
    let cancelled = false;
    fetchJustificacionesPendientes()
      .then((lista) => {
        if (cancelled) return;
        if (lista === null) {
          setListadoDisponible(false);
        } else {
          setListadoDisponible(true);
          setPendientes(lista.filter((j) => j.estado === 'PENDIENTE'));
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setListadoDisponible(false);
        setListaError(
          err instanceof Error
            ? err.message
            : 'No se pudo obtener las justificaciones pendientes.',
        );
      });
    return () => {
      cancelled = true;
    };
  }, [puedeAprobar]);

  async function handleCrear(e: React.FormEvent) {
    e.preventDefault();
    if (!ownEmployee) return;
    setFormError(null);
    setFormOk(null);
    setEnviando(true);
    try {
      const creada = await crearJustificacion({
        employeeId: ownEmployee.id,
        motivo,
        fecha,
        descripcion: descripcion.trim(),
      });
      setFormOk(
        `Justificación de ${MOTIVO_LABELS[creada.motivo]} para el ${fmtFecha(
          creada.fecha,
        )} enviada. Queda pendiente de aprobación.`,
      );
      setDescripcion('');
      // Visible de inmediato para el aprobador de esta misma sesión
      setPendientes((prev) => [creada, ...prev]);
    } catch (err) {
      setFormError(
        err instanceof Error ? err.message : 'No se pudo enviar la justificación.',
      );
    } finally {
      setEnviando(false);
    }
  }

  async function handleResolver(id: string, aprobar: boolean) {
    setResolverError(null);
    setResolverOk(null);
    setResolviendoId(id);
    try {
      const resuelta = await resolverJustificacion(
        id,
        aprobar,
        aprobar ? undefined : motivoRechazo.trim(),
      );
      setPendientes((prev) => prev.filter((j) => j.id !== id));
      setRechazandoId(null);
      setMotivoRechazo('');
      setResolverOk(
        resuelta.estado === 'APROBADA'
          ? 'Justificación aprobada. El día dejará de contar como falta.'
          : 'Justificación rechazada.',
      );
    } catch (err) {
      setResolverError(
        err instanceof Error ? err.message : 'No se pudo resolver la justificación.',
      );
    } finally {
      setResolviendoId(null);
    }
  }

  const sinEmpleado = !cargandoEmpleado && !ownEmployee;

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
      <h2 className="text-base font-semibold">Justificaciones</h2>
      <p className="mt-1 text-sm text-slate-500">
        Solicita la justificación de una tardanza, falta o permiso.
      </p>

      {/* ---------------- Formulario de creación ---------------- */}
      {sinEmpleado ? (
        <p className="mt-4 text-sm text-amber-700">
          Tu usuario no está vinculado a un registro de empleado; no puedes crear
          justificaciones propias.
        </p>
      ) : (
        <form onSubmit={handleCrear} className="mt-4 max-w-lg space-y-4">
          <div className="flex gap-4">
            <div className="flex-1">
              <label className="mb-1 block text-sm font-medium" htmlFor="just-motivo">
                Motivo
              </label>
              <select
                id="just-motivo"
                value={motivo}
                onChange={(e) => setMotivo(e.target.value as MotivoJustificacion)}
                className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
              >
                {MOTIVOS.map((m) => (
                  <option key={m} value={m}>
                    {MOTIVO_LABELS[m]}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex-1">
              <label className="mb-1 block text-sm font-medium" htmlFor="just-fecha">
                Fecha
              </label>
              <input
                id="just-fecha"
                type="date"
                required
                value={fecha}
                onChange={(e) => setFecha(e.target.value)}
                className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium" htmlFor="just-descripcion">
              Descripción
            </label>
            <textarea
              id="just-descripcion"
              required
              rows={3}
              value={descripcion}
              onChange={(e) => setDescripcion(e.target.value)}
              placeholder="Detalle del motivo (visible para quien aprueba)"
              className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
            />
          </div>

          {formError && <p className="text-sm text-red-600">{formError}</p>}
          {formOk && <p className="text-sm text-green-700">{formOk}</p>}

          <button
            type="submit"
            disabled={enviando || cargandoEmpleado || descripcion.trim().length === 0}
            className="rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
          >
            {enviando ? 'Enviando...' : 'Enviar justificación'}
          </button>
        </form>
      )}

      {/* ---------------- Pendientes de aprobación ---------------- */}
      {puedeAprobar && (
        <div className="mt-8 border-t border-slate-200 pt-6">
          <h3 className="text-sm font-semibold">Pendientes de aprobación</h3>

          {listadoDisponible === null && (
            <p className="mt-2 text-sm text-slate-500">Cargando...</p>
          )}
          {listadoDisponible === false && (
            <p className="mt-2 text-sm text-slate-500">
              La API aún no expone el listado de justificaciones pendientes; aquí se
              muestran solo las creadas durante esta sesión.
            </p>
          )}
          {listaError && <p className="mt-2 text-sm text-red-600">{listaError}</p>}
          {resolverError && <p className="mt-2 text-sm text-red-600">{resolverError}</p>}
          {resolverOk && <p className="mt-2 text-sm text-green-700">{resolverOk}</p>}

          {listadoDisponible !== null && pendientes.length === 0 && (
            <p className="mt-2 text-sm text-slate-500">No hay justificaciones pendientes.</p>
          )}

          <ul className="mt-3 space-y-3">
            {pendientes.map((j) => (
              <li key={j.id} className="rounded border border-slate-200 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="text-sm">
                    <p className="font-medium">
                      {nombresPorEmpleado.get(j.employeeId) ?? `Empleado ${j.employeeId.slice(0, 8)}`}
                      <span className="ml-2 rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
                        {MOTIVO_LABELS[j.motivo] ?? j.motivo}
                      </span>
                    </p>
                    <p className="mt-1 text-slate-600">
                      {fmtFecha(j.fecha)} — {j.descripcion}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => handleResolver(j.id, true)}
                      disabled={resolviendoId !== null}
                      className="rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
                    >
                      {resolviendoId === j.id ? 'Procesando...' : 'Aprobar'}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setRechazandoId(rechazandoId === j.id ? null : j.id);
                        setMotivoRechazo('');
                      }}
                      disabled={resolviendoId !== null}
                      className="rounded border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50"
                    >
                      Rechazar
                    </button>
                  </div>
                </div>

                {rechazandoId === j.id && (
                  <div className="mt-3 flex gap-2">
                    <input
                      type="text"
                      value={motivoRechazo}
                      onChange={(e) => setMotivoRechazo(e.target.value)}
                      placeholder="Motivo del rechazo (obligatorio)"
                      className="flex-1 rounded border border-slate-300 px-3 py-2 text-sm"
                    />
                    <button
                      type="button"
                      onClick={() => handleResolver(j.id, false)}
                      disabled={resolviendoId !== null || motivoRechazo.trim().length === 0}
                      className="rounded bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-500 disabled:opacity-50"
                    >
                      Confirmar rechazo
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
