'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/components/auth-context';
import {
  agregarNotaCandidato,
  cambiarEstadoCandidato,
  contratarCandidato,
  formatRangoSalarial,
  listarEmployees,
  listarVacantes,
  registrarCandidato,
  TRANSICIONES_CANDIDATO,
  type Candidato,
  type CandidatoNota,
  type CvParseado,
  type EmployeeRow,
  type EstadoCandidato,
  type Vacante,
} from '../ats-api';
import { CandidatoBadge, VacanteBadge } from '../badges';

// ---------------------------------------------------------------------------
// CV parseado (JSON estructurado por Claude) renderizado legible
// ---------------------------------------------------------------------------

function CvParseadoView({ cv }: { cv: CvParseado }) {
  return (
    <div className="mt-3 rounded border border-slate-200 bg-slate-50 p-3 text-sm">
      <p className="mb-2 font-medium text-slate-900">CV analizado</p>

      {cv.experiencia.length > 0 && (
        <div className="mb-3">
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
            Experiencia
          </p>
          <ul className="space-y-1">
            {cv.experiencia.map((exp, i) => (
              <li key={i} className="text-slate-700">
                <span className="font-medium">{exp.cargo}</span>
                {exp.empresa && <> — {exp.empresa}</>}
                {(exp.desde || exp.hasta) && (
                  <span className="text-slate-500">
                    {' '}
                    ({exp.desde ?? '¿?'} – {exp.hasta ?? 'actual'})
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {cv.habilidades.length > 0 && (
        <div className="mb-3">
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
            Habilidades
          </p>
          <div className="flex flex-wrap gap-1">
            {cv.habilidades.map((h, i) => (
              <span
                key={i}
                className="rounded bg-white px-2 py-0.5 text-xs text-slate-700 ring-1 ring-slate-200"
              >
                {h}
              </span>
            ))}
          </div>
        </div>
      )}

      {cv.formacion.length > 0 && (
        <div className="mb-3">
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
            Formación
          </p>
          <ul className="space-y-1">
            {cv.formacion.map((f, i) => (
              <li key={i} className="text-slate-700">
                <span className="font-medium">{f.titulo}</span>
                {f.institucion && <> — {f.institucion}</>}
                {f.anio !== null && <span className="text-slate-500"> ({f.anio})</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {cv.idiomas.length > 0 && (
        <div>
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
            Idiomas
          </p>
          <p className="text-slate-700">{cv.idiomas.join(', ')}</p>
        </div>
      )}

      {cv.experiencia.length === 0 &&
        cv.habilidades.length === 0 &&
        cv.formacion.length === 0 &&
        cv.idiomas.length === 0 && (
          <p className="text-slate-500">El CV no contiene secciones estructuradas.</p>
        )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tarjeta de candidato: estado, notas, CV, contratar
// ---------------------------------------------------------------------------

function CandidatoCard({
  candidato,
  notas,
  canManage,
  canReadEmployees,
  onUpdated,
  onNotaAgregada,
}: {
  candidato: Candidato;
  notas: CandidatoNota[];
  canManage: boolean;
  canReadEmployees: boolean;
  onUpdated: (candidato: Candidato) => void;
  onNotaAgregada: (candidatoId: string, nota: CandidatoNota) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [changing, setChanging] = useState(false);

  const [nota, setNota] = useState('');
  const [savingNota, setSavingNota] = useState(false);
  const [showCv, setShowCv] = useState(false);

  const [hiring, setHiring] = useState(false);
  const [showHireForm, setShowHireForm] = useState(false);
  const [employees, setEmployees] = useState<EmployeeRow[] | null>(null);
  const [employeesError, setEmployeesError] = useState<string | null>(null);
  const [employeeId, setEmployeeId] = useState('');

  // En OFERTA la contratación se hace con el botón "Contratar" (vincula el
  // Employee); el select solo ofrece el resto de transiciones válidas.
  const transiciones = TRANSICIONES_CANDIDATO[candidato.estado].filter(
    (e) => e !== 'CONTRATADO',
  );

  async function handleCambiarEstado(nuevoEstado: EstadoCandidato) {
    if (
      nuevoEstado === 'RECHAZADO' &&
      !window.confirm(`¿Rechazar a ${candidato.nombreCompleto}?`)
    ) {
      return;
    }
    setError(null);
    setChanging(true);
    try {
      onUpdated(await cambiarEstadoCandidato(candidato.id, nuevoEstado));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo cambiar el estado.');
    } finally {
      setChanging(false);
    }
  }

  async function handleAgregarNota(e: React.FormEvent) {
    e.preventDefault();
    if (!nota.trim()) return;
    setError(null);
    setSavingNota(true);
    try {
      const creada = await agregarNotaCandidato(candidato.id, nota.trim());
      onNotaAgregada(candidato.id, creada);
      setNota('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo agregar la nota.');
    } finally {
      setSavingNota(false);
    }
  }

  async function handleAbrirContratar() {
    setShowHireForm(true);
    setEmployeesError(null);
    if (canReadEmployees && employees === null) {
      try {
        setEmployees(await listarEmployees());
      } catch (err) {
        setEmployees([]);
        setEmployeesError(
          err instanceof Error
            ? `No se pudo cargar la lista de empleados: ${err.message}. Ingresa el ID manualmente.`
            : 'No se pudo cargar la lista de empleados. Ingresa el ID manualmente.',
        );
      }
    }
  }

  async function handleContratar(e: React.FormEvent) {
    e.preventDefault();
    if (!employeeId.trim()) {
      setError('Selecciona o ingresa el empleado (Employee) ya creado a vincular.');
      return;
    }
    setError(null);
    setHiring(true);
    try {
      onUpdated(await contratarCandidato(candidato.id, employeeId.trim()));
      setShowHireForm(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo contratar al candidato.');
    } finally {
      setHiring(false);
    }
  }

  const useEmployeeSelect =
    canReadEmployees && employees !== null && employees.length > 0 && !employeesError;

  return (
    <li className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-slate-900">
              {candidato.nombreCompleto}
            </span>
            <CandidatoBadge estado={candidato.estado} />
          </div>
          <p className="mt-0.5 text-sm text-slate-600">
            {candidato.email}
            {candidato.telefono && <> · {candidato.telefono}</>}
          </p>
          {candidato.advertencia && (
            <p className="mt-1 text-sm text-amber-700">{candidato.advertencia}</p>
          )}
        </div>

        {canManage && (
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {transiciones.length > 0 && (
              <select
                value=""
                disabled={changing}
                onChange={(e) => {
                  const nuevo = e.target.value as EstadoCandidato;
                  if (nuevo) void handleCambiarEstado(nuevo);
                }}
                className="rounded border border-slate-300 px-2 py-1.5 text-sm disabled:opacity-50"
              >
                <option value="" disabled>
                  {changing ? 'Cambiando...' : 'Cambiar estado...'}
                </option>
                {transiciones.map((estado) => (
                  <option key={estado} value={estado}>
                    {estado === 'RECHAZADO' ? 'Rechazar' : `Pasar a ${estado}`}
                  </option>
                ))}
              </select>
            )}
            {candidato.estado === 'OFERTA' && !showHireForm && (
              <button
                type="button"
                onClick={() => void handleAbrirContratar()}
                className="rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-white"
              >
                Contratar
              </button>
            )}
          </div>
        )}
      </div>

      {canManage && showHireForm && candidato.estado === 'OFERTA' && (
        <form
          onSubmit={handleContratar}
          className="mt-3 rounded border border-slate-200 bg-slate-50 p-3"
        >
          <label className="mb-1 block text-sm font-medium" htmlFor={`emp-${candidato.id}`}>
            Empleado a vincular (registro Employee ya creado — D.Leg. 728)
          </label>
          {employeesError && (
            <p className="mb-2 text-sm text-amber-700">{employeesError}</p>
          )}
          {useEmployeeSelect ? (
            <select
              id={`emp-${candidato.id}`}
              value={employeeId}
              onChange={(e) => setEmployeeId(e.target.value)}
              className="mb-3 w-full rounded border border-slate-300 px-3 py-2 text-sm"
            >
              <option value="">Selecciona un empleado...</option>
              {employees!.map((emp) => (
                <option key={emp.id} value={emp.id}>
                  {emp.apellidos}, {emp.nombres}
                </option>
              ))}
            </select>
          ) : canReadEmployees && employees === null ? (
            <p className="mb-3 text-sm text-slate-500">Cargando...</p>
          ) : (
            <input
              id={`emp-${candidato.id}`}
              type="text"
              value={employeeId}
              onChange={(e) => setEmployeeId(e.target.value)}
              placeholder="ID del empleado"
              className="mb-3 w-full rounded border border-slate-300 px-3 py-2 text-sm"
            />
          )}
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={hiring}
              className="rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
            >
              {hiring ? 'Contratando...' : 'Confirmar contratación'}
            </button>
            <button
              type="button"
              onClick={() => setShowHireForm(false)}
              disabled={hiring}
              className="rounded border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-100 disabled:opacity-50"
            >
              Cancelar
            </button>
          </div>
        </form>
      )}

      {canManage && (
        <div className="mt-3">
          {candidato.cvParseado ? (
            <>
              <button
                type="button"
                onClick={() => setShowCv((v) => !v)}
                className="text-sm font-medium text-slate-700 underline hover:text-slate-900"
              >
                {showCv ? 'Ocultar CV analizado' : 'Ver CV analizado'}
              </button>
              {showCv && <CvParseadoView cv={candidato.cvParseado} />}
            </>
          ) : (
            <p className="text-sm text-slate-500">
              CV sin análisis automático disponible.
            </p>
          )}
        </div>
      )}

      {canManage && (
        <div className="mt-3 border-t border-slate-100 pt-3">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
            Notas internas
          </p>
          {notas.length > 0 && (
            <ul className="mb-2 space-y-1">
              {notas.map((n) => (
                <li key={n.id} className="rounded bg-slate-50 px-2 py-1 text-sm text-slate-700">
                  {n.nota}
                </li>
              ))}
            </ul>
          )}
          <form onSubmit={handleAgregarNota} className="flex gap-2">
            <input
              type="text"
              value={nota}
              onChange={(e) => setNota(e.target.value)}
              placeholder="Agregar nota interna..."
              className="w-full rounded border border-slate-300 px-3 py-1.5 text-sm"
            />
            <button
              type="submit"
              disabled={savingNota || !nota.trim()}
              className="shrink-0 rounded border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50"
            >
              {savingNota ? 'Guardando...' : 'Agregar'}
            </button>
          </form>
        </div>
      )}

      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
    </li>
  );
}

// ---------------------------------------------------------------------------
// Registro de candidato (con consentimiento LPDP obligatorio)
// ---------------------------------------------------------------------------

function RegistrarCandidatoForm({
  vacanteId,
  onRegistered,
}: {
  vacanteId: string;
  onRegistered: (candidato: Candidato) => void;
}) {
  const [nombre, setNombre] = useState('');
  const [email, setEmail] = useState('');
  const [telefono, setTelefono] = useState('');
  const [cvTexto, setCvTexto] = useState('');
  const [consentimiento, setConsentimiento] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!consentimiento) {
      setError('El consentimiento LPDP es obligatorio para registrar al candidato.');
      return;
    }
    setSaving(true);
    try {
      const candidato = await registrarCandidato(vacanteId, {
        nombreCompleto: nombre.trim(),
        email: email.trim(),
        telefono: telefono.trim() || undefined,
        cvTexto,
        consentimientoLpdp: true,
      });
      onRegistered(candidato);
      setNombre('');
      setEmail('');
      setTelefono('');
      setCvTexto('');
      setConsentimiento(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo registrar al candidato.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm"
    >
      <h2 className="mb-4 text-base font-semibold">Registrar candidato</h2>

      <div className="mb-4 grid gap-4 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-sm font-medium" htmlFor="cand-nombre">
            Nombre completo
          </label>
          <input
            id="cand-nombre"
            type="text"
            required
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium" htmlFor="cand-email">
            Correo electrónico
          </label>
          <input
            id="cand-email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
          />
        </div>
      </div>

      <label className="mb-1 block text-sm font-medium" htmlFor="cand-telefono">
        Teléfono (opcional)
      </label>
      <input
        id="cand-telefono"
        type="tel"
        value={telefono}
        onChange={(e) => setTelefono(e.target.value)}
        className="mb-4 w-full rounded border border-slate-300 px-3 py-2 text-sm"
      />

      <label className="mb-1 block text-sm font-medium" htmlFor="cand-cv">
        CV (texto plano)
      </label>
      <textarea
        id="cand-cv"
        required
        rows={8}
        value={cvTexto}
        onChange={(e) => setCvTexto(e.target.value)}
        placeholder="Pega aquí el contenido del CV en texto plano. Será analizado automáticamente."
        className="mb-4 w-full rounded border border-slate-300 px-3 py-2 text-sm"
      />

      <label className="mb-4 flex items-start gap-2 text-sm text-slate-700">
        <input
          type="checkbox"
          required
          checked={consentimiento}
          onChange={(e) => setConsentimiento(e.target.checked)}
          className="mt-0.5 h-4 w-4 rounded border-slate-300"
        />
        <span>
          El candidato otorga su consentimiento libre, previo, expreso e informado para
          el tratamiento de sus datos personales con fines de este proceso de selección,
          conforme a la Ley N.º 29733 — Ley de Protección de Datos Personales — y su
          reglamento. <span className="font-medium">(Obligatorio)</span>
        </span>
      </label>

      {error && <p className="mb-4 text-sm text-red-600">{error}</p>}

      <button
        type="submit"
        disabled={saving}
        className="rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        {saving ? 'Registrando (analizando CV)...' : 'Registrar candidato'}
      </button>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Página de detalle de vacante
// ---------------------------------------------------------------------------

export default function VacanteDetallePage({ params }: { params: { id: string } }) {
  const { hasPermission } = useAuth();
  const canManage = hasPermission('ats.manage');
  const canApply = hasPermission('ats.apply');
  const canReadEmployees = hasPermission('employee.read');

  const [vacante, setVacante] = useState<Vacante | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // La API aún no expone GET de candidatos: se muestran los candidatos
  // registrados o gestionados durante esta sesión.
  const [candidatos, setCandidatos] = useState<Candidato[]>([]);
  const [notasPorCandidato, setNotasPorCandidato] = useState<
    Record<string, CandidatoNota[]>
  >({});

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const vacantes = await listarVacantes();
      const encontrada = vacantes.find((v) => v.id === params.id) ?? null;
      if (!encontrada) {
        setError('Vacante no encontrada.');
      }
      setVacante(encontrada);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo cargar la vacante.');
    } finally {
      setLoading(false);
    }
  }, [params.id]);

  useEffect(() => {
    void load();
  }, [load]);

  function handleCandidatoUpdated(actualizado: Candidato) {
    setCandidatos((prev) =>
      prev.map((c) => (c.id === actualizado.id ? { ...c, ...actualizado } : c)),
    );
  }

  function handleNotaAgregada(candidatoId: string, nota: CandidatoNota) {
    setNotasPorCandidato((prev) => ({
      ...prev,
      [candidatoId]: [...(prev[candidatoId] ?? []), nota],
    }));
  }

  if (loading) {
    return <p className="text-sm text-slate-500">Cargando...</p>;
  }

  if (error || !vacante) {
    return (
      <div className="mx-auto max-w-3xl">
        <p className="mb-4 text-sm text-red-600">{error ?? 'Vacante no encontrada.'}</p>
        <Link
          href="/ats"
          className="rounded border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100"
        >
          Volver a Reclutamiento
        </Link>
      </div>
    );
  }

  const requisitos = Array.isArray(vacante.requisitos)
    ? (vacante.requisitos as unknown[]).map(String).filter(Boolean)
    : null;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <Link href="/ats" className="text-sm text-slate-500 hover:underline">
          ← Volver a Reclutamiento
        </Link>
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-semibold">{vacante.titulo}</h1>
          <VacanteBadge estado={vacante.estado} />
        </div>
        <p className="mt-2 whitespace-pre-line text-sm text-slate-700">
          {vacante.descripcion}
        </p>
        <p className="mt-2 text-sm text-slate-600">
          <span className="font-medium">Salario:</span> {formatRangoSalarial(vacante)}
        </p>
        {requisitos && requisitos.length > 0 ? (
          <div className="mt-3">
            <p className="text-sm font-medium text-slate-900">Requisitos</p>
            <ul className="mt-1 list-inside list-disc text-sm text-slate-700">
              {requisitos.map((req, i) => (
                <li key={i}>{req}</li>
              ))}
            </ul>
          </div>
        ) : vacante.requisitos && typeof vacante.requisitos === 'object' &&
          Object.keys(vacante.requisitos as object).length > 0 ? (
          <div className="mt-3">
            <p className="text-sm font-medium text-slate-900">Requisitos</p>
            <pre className="mt-1 overflow-x-auto rounded bg-slate-50 p-2 text-xs text-slate-700">
              {JSON.stringify(vacante.requisitos, null, 2)}
            </pre>
          </div>
        ) : null}
      </div>

      <div>
        <h2 className="mb-3 text-base font-semibold">Candidatos</h2>
        <p className="mb-3 text-sm text-slate-500">
          La API aún no expone el listado histórico de candidatos: aquí se muestran los
          candidatos registrados o gestionados durante esta sesión.
        </p>
        {candidatos.length === 0 ? (
          <p className="text-sm text-slate-500">
            Aún no se han registrado candidatos en esta sesión.
          </p>
        ) : (
          <ul className="space-y-3">
            {candidatos.map((candidato) => (
              <CandidatoCard
                key={candidato.id}
                candidato={candidato}
                notas={notasPorCandidato[candidato.id] ?? []}
                canManage={canManage}
                canReadEmployees={canReadEmployees}
                onUpdated={handleCandidatoUpdated}
                onNotaAgregada={handleNotaAgregada}
              />
            ))}
          </ul>
        )}
      </div>

      {canApply && vacante.estado === 'ABIERTA' && (
        <RegistrarCandidatoForm
          vacanteId={vacante.id}
          onRegistered={(candidato) =>
            setCandidatos((prev) => [candidato, ...prev])
          }
        />
      )}
      {canApply && vacante.estado !== 'ABIERTA' && (
        <p className="text-sm text-slate-500">
          Esta vacante no acepta nuevos candidatos (estado {vacante.estado}).
        </p>
      )}
    </div>
  );
}
