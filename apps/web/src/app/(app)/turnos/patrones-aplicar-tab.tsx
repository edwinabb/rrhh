'use client';

import { useEffect, useState, useRef } from 'react';
import { useAuth } from '@/components/auth-context';
import { listarPatrones, RotacionPatron, TipoDiaPatron, aplicarPatron } from './shifts-api';
import { listarEmpleados, EmpleadoResumen } from '../vacaciones/vacations-api';

interface PreviewDay {
  fecha: string;
  tipoDia: TipoDiaPatron;
  empleados: string[];
}

function generarPreview(
  patron: RotacionPatron,
  desde: string,
  hasta: string,
  diaInicioCiclo: string,
  employeeIds: string[],
): PreviewDay[] {
  const desdeDate = new Date(desde);
  const hastaDate = new Date(hasta);
  const inicioDate = new Date(diaInicioCiclo);

  const dias: PreviewDay[] = [];
  const secuencia = patron.secuencia;

  // Calcular el índice inicial del ciclo
  const diferenciaDias = Math.floor((desdeDate.getTime() - inicioDate.getTime()) / (1000 * 60 * 60 * 24));
  let indiceInicial = diferenciaDias % secuencia.length;
  if (indiceInicial < 0) indiceInicial += secuencia.length;

  // Generar preview para cada día en el rango
  let fecha = new Date(desdeDate);
  while (fecha <= hastaDate) {
    const indiceActual = (indiceInicial + dias.length) % secuencia.length;
    dias.push({
      fecha: fecha.toISOString().split('T')[0],
      tipoDia: secuencia[indiceActual],
      empleados: employeeIds,
    });
    fecha.setDate(fecha.getDate() + 1);
  }

  return dias;
}

function esFechaFutura(fecha: string): boolean {
  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);
  const fechaDate = new Date(fecha);
  return fechaDate >= hoy;
}

export function PatronesAplicarTab() {
  const { hasPermission } = useAuth();
  const puedeGestionar = hasPermission('shift.manage');
  const [patrones, setPatrones] = useState<RotacionPatron[]>([]);
  const [empleados, setEmpleados] = useState<EmpleadoResumen[]>([]);
  const [selectedPatronId, setSelectedPatronId] = useState<string>('');
  const [selectedEmployeeIds, setSelectedEmployeeIds] = useState<Set<string>>(new Set());
  const [desde, setDesde] = useState<string>('');
  const [hasta, setHasta] = useState<string>('');
  const [diaInicioCiclo, setDiaInicioCiclo] = useState<string>('');
  const [preview, setPreview] = useState<PreviewDay[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [ajustes, setAjustes] = useState<Map<string, TipoDiaPatron>>(new Map());
  const [showConfirm, setShowConfirm] = useState(false);
  const confirmHeadingId = useRef('confirm-heading');

  async function refrescarDatos() {
    try {
      const [p, e] = await Promise.all([
        listarPatrones(true),
        listarEmpleados(),
      ]);
      setPatrones(p);
      setEmpleados(e);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  useEffect(() => {
    if (puedeGestionar) {
      refrescarDatos();
    }
  }, [puedeGestionar]);

  // Actualizar preview cuando cambien los parámetros
  useEffect(() => {
    if (selectedPatronId && desde && hasta && diaInicioCiclo && selectedEmployeeIds.size > 0) {
      const patron = patrones.find((p) => p.id === selectedPatronId);
      if (patron) {
        const preview = generarPreview(
          patron,
          desde,
          hasta,
          diaInicioCiclo,
          Array.from(selectedEmployeeIds),
        );
        setPreview(preview);
        setAjustes(new Map());
        setIsEditing(false);
      }
    } else {
      setPreview([]);
      setAjustes(new Map());
      setIsEditing(false);
    }
  }, [selectedPatronId, desde, hasta, diaInicioCiclo, selectedEmployeeIds, patrones]);

  const handleAjusteChange = (fecha: string, tipoDia: TipoDiaPatron) => {
    setAjustes((prev) => {
      const next = new Map(prev);
      next.set(fecha, tipoDia);
      return next;
    });
  };

  const handleToggleEmployee = (employeeId: string) => {
    const newSet = new Set(selectedEmployeeIds);
    if (newSet.has(employeeId)) {
      newSet.delete(employeeId);
    } else {
      newSet.add(employeeId);
    }
    setSelectedEmployeeIds(newSet);
  };

  const validarFormulario = (): string | null => {
    if (!selectedPatronId) return 'Debe seleccionar un patrón';
    if (selectedEmployeeIds.size === 0) return 'Debe seleccionar al menos un empleado';
    if (!desde) return 'Debe ingresar la fecha de inicio';
    if (!hasta) return 'Debe ingresar la fecha de fin';
    if (!diaInicioCiclo) return 'Debe seleccionar el día de inicio del ciclo';
    if (!esFechaFutura(desde)) return 'La fecha de inicio debe ser futura';
    if (!esFechaFutura(hasta)) return 'La fecha de fin debe ser futura';
    if (desde > hasta) return 'La fecha de inicio debe ser anterior a la de fin';
    if (!esFechaFutura(diaInicioCiclo)) return 'El día de inicio del ciclo debe ser futuro';
    return null;
  };

  const handleInyectar = async () => {
    setError(null);
    const validacion = validarFormulario();
    if (validacion) {
      setError(validacion);
      return;
    }
    setShowConfirm(true);
  };

  const handleConfirmar = async () => {
    setShowConfirm(false);
    setIsLoading(true);
    setError(null);
    setSuccess(null);
    try {
      const ajustesArray = Array.from(ajustes.entries()).map(([fecha, tipoDia]) => ({ fecha, tipoDia }));
      const resultado = await aplicarPatron(selectedPatronId, {
        employeeIds: Array.from(selectedEmployeeIds),
        desde,
        hasta,
        diaInicioCiclo,
        ...(ajustesArray.length > 0 ? { ajustes: ajustesArray } : {}),
      });
      setSuccess(`Patrón aplicado: ${resultado.procesadas} empleados procesados${resultado.errores.length > 0 ? `, ${resultado.errores.length} errores` : ''}`);
      // Limpiar formulario
      setSelectedPatronId('');
      setSelectedEmployeeIds(new Set());
      setDesde('');
      setHasta('');
      setDiaInicioCiclo('');
      setPreview([]);
      setAjustes(new Map());
      setIsEditing(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setIsLoading(false);
    }
  };

  if (!puedeGestionar) {
    return (
      <div className="rounded bg-yellow-50 px-3 py-2 text-sm text-yellow-700">
        No tiene permisos para aplicar patrones. Requiere permiso: shift.manage
      </div>
    );
  }

  const selectedPatron = patrones.find((p) => p.id === selectedPatronId);

  return (
    <div className="space-y-6">
      {error && <p className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {success && <p className="rounded bg-green-50 px-3 py-2 text-sm text-green-700">{success}</p>}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Selector de patrón */}
        <div>
          <label htmlFor="patron-select" className="block text-sm font-medium text-slate-700">
            Seleccionar patrón
          </label>
          <select
            id="patron-select"
            value={selectedPatronId}
            onChange={(e) => setSelectedPatronId(e.target.value)}
            className="mt-1 block w-full rounded border border-slate-300 px-3 py-2"
            disabled={isLoading}
          >
            <option value="">-- Elegir un patrón --</option>
            {patrones
              .filter((p) => p.activo)
              .map((patron) => (
                <option key={patron.id} value={patron.id}>
                  {patron.nombre}
                </option>
              ))}
          </select>
          {selectedPatron && (
            <p className="mt-2 text-sm text-slate-600">
              Ciclo: {selectedPatron.secuencia.map((t) => (t === 'DIA' ? 'D' : t === 'NOCHE' ? 'N' : '-')).join(' ')}
            </p>
          )}
        </div>

        {/* Rango de fechas */}
        <div className="space-y-3">
          <div>
            <label htmlFor="fecha-desde" className="block text-sm font-medium text-slate-700">
              Desde (fecha)
            </label>
            <input
              id="fecha-desde"
              type="date"
              value={desde}
              onChange={(e) => setDesde(e.target.value)}
              className="mt-1 block w-full rounded border border-slate-300 px-3 py-2"
              disabled={isLoading}
            />
          </div>
          <div>
            <label htmlFor="fecha-hasta" className="block text-sm font-medium text-slate-700">
              Hasta (fecha)
            </label>
            <input
              id="fecha-hasta"
              type="date"
              value={hasta}
              onChange={(e) => setHasta(e.target.value)}
              className="mt-1 block w-full rounded border border-slate-300 px-3 py-2"
              disabled={isLoading}
            />
          </div>
        </div>

        {/* Día de inicio del ciclo */}
        <div>
          <label htmlFor="dia-inicio-ciclo" className="block text-sm font-medium text-slate-700">
            Día de inicio del ciclo
          </label>
          <input
            id="dia-inicio-ciclo"
            type="date"
            value={diaInicioCiclo}
            onChange={(e) => setDiaInicioCiclo(e.target.value)}
            className="mt-1 block w-full rounded border border-slate-300 px-3 py-2"
            disabled={isLoading}
          />
        </div>
      </div>

      {/* Multi-select de empleados */}
      <div>
        <label className="block text-sm font-medium text-slate-700 mb-2">
          Empleados ({selectedEmployeeIds.size} seleccionados)
        </label>
        <div className="rounded border border-slate-300 p-3 max-h-48 overflow-y-auto bg-white">
          {empleados.length > 0 ? (
            <div className="space-y-2">
              {empleados.map((emp) => (
                <label key={emp.id} className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={selectedEmployeeIds.has(emp.id)}
                    onChange={() => handleToggleEmployee(emp.id)}
                    disabled={isLoading}
                    className="rounded border-slate-300"
                  />
                  <span className="text-sm text-slate-700">
                    {emp.nombres} {emp.apellidos}
                  </span>
                </label>
              ))}
            </div>
          ) : (
            <p className="text-sm text-slate-500">Cargando empleados...</p>
          )}
        </div>
      </div>

      {/* Vista previa de 30 días */}
      {preview.length > 0 && (
        <div>
          <h3 className="text-sm font-medium text-slate-700 mb-3">
            Vista previa (30 días)
          </h3>
          <div
            className="rounded border border-slate-200 p-4 overflow-x-auto"
            role="grid"
            aria-label="30-day shift preview grid"
          >
            <div className="grid gap-0" style={{ gridTemplateColumns: 'repeat(7, minmax(60px, 1fr))' }}>
              {/* Encabezados de días de semana */}
              {['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'].map((dia) => (
                <div key={dia} className="bg-slate-100 px-1 py-2 text-center text-xs font-semibold text-slate-600 border border-slate-200">
                  {dia}
                </div>
              ))}
              {/* Celdas de días */}
              {preview.map((day, idx) => {
                const dayOfWeek = new Date(day.fecha).getDay();
                const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
                const tipoEfectivo = ajustes.get(day.fecha) ?? day.tipoDia;
                const fueAjustado = ajustes.has(day.fecha);
                const colorMap: Record<TipoDiaPatron, string> = {
                  DIA: 'bg-blue-50',
                  NOCHE: 'bg-purple-50',
                  DESC: 'bg-green-50',
                };
                const labelMap: Record<TipoDiaPatron, string> = {
                  DIA: 'D',
                  NOCHE: 'N',
                  DESC: '-',
                };
                return (
                  <div
                    key={idx}
                    className={`min-h-12 border border-slate-200 px-1 py-1 text-center text-xs ${colorMap[tipoEfectivo]} ${isWeekend ? 'border-slate-300 font-semibold' : ''} ${fueAjustado ? 'ring-2 ring-inset ring-amber-400' : ''}`}
                  >
                    <div className="font-semibold text-slate-900">{new Date(day.fecha).getDate()}</div>
                    {isEditing ? (
                      <select
                        aria-label={`Tipo de día para ${day.fecha}`}
                        value={tipoEfectivo}
                        onChange={(e) => handleAjusteChange(day.fecha, e.target.value as TipoDiaPatron)}
                        disabled={isLoading}
                        className="mt-1 w-full rounded border border-slate-300 bg-white text-[10px] px-0.5 py-0.5"
                      >
                        <option value="DIA">D</option>
                        <option value="NOCHE">N</option>
                        <option value="DESC">-</option>
                      </select>
                    ) : (
                      <div className="text-slate-600">{labelMap[tipoEfectivo]}</div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
          <div className="mt-2 flex gap-4 text-xs text-slate-600">
            <div className="flex items-center gap-1">
              <div className="w-3 h-3 bg-blue-50 border border-slate-200" />
              Día
            </div>
            <div className="flex items-center gap-1">
              <div className="w-3 h-3 bg-purple-50 border border-slate-200" />
              Noche
            </div>
            <div className="flex items-center gap-1">
              <div className="w-3 h-3 bg-green-50 border border-slate-200" />
              Descanso
            </div>
          </div>
        </div>
      )}

      {/* Botones de acción */}
      {preview.length > 0 && (
        <div className="flex items-center gap-3 justify-end">
          {ajustes.size > 0 && (
            <span className="text-xs text-amber-700">
              {ajustes.size} día{ajustes.size !== 1 ? 's' : ''} ajustado{ajustes.size !== 1 ? 's' : ''}
            </span>
          )}
          {isEditing && ajustes.size > 0 && (
            <button
              onClick={() => setAjustes(new Map())}
              disabled={isLoading}
              className="rounded border border-slate-300 px-4 py-2 font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              Descartar cambios
            </button>
          )}
          <button
            onClick={() => setIsEditing(!isEditing)}
            disabled={isLoading}
            className="rounded border border-slate-300 px-4 py-2 font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            {isEditing ? 'Listo' : 'Ajustar'}
          </button>
          <button
            onClick={handleInyectar}
            disabled={isLoading || preview.length === 0}
            className="rounded bg-slate-900 px-4 py-2 font-medium text-white hover:bg-slate-800 disabled:opacity-50"
          >
            {isLoading ? 'Procesando...' : 'Inyectar'}
          </button>
        </div>
      )}

      {/* Diálogo de confirmación */}
      {showConfirm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50"
          onClick={() => !isLoading && setShowConfirm(false)}
          role="presentation"
        >
          <div
            className="w-full max-w-sm rounded-lg bg-white p-6 shadow-lg"
            role="dialog"
            aria-modal="true"
            aria-labelledby={confirmHeadingId.current}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id={confirmHeadingId.current} className="mb-4 text-lg font-semibold">
              Confirmar inyección
            </h2>
            <p className="mb-4 text-sm text-slate-700">
              Esto aplicará el patrón a {selectedEmployeeIds.size} empleado{selectedEmployeeIds.size !== 1 ? 's' : ''} desde{' '}
              {desde} hasta {hasta}
              {ajustes.size > 0
                ? `, con ${ajustes.size} ajuste${ajustes.size !== 1 ? 's' : ''} manual${ajustes.size !== 1 ? 'es' : ''} sobre la vista previa`
                : ''}
              . ¿Está seguro?
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setShowConfirm(false)}
                disabled={isLoading}
                className="rounded border border-slate-300 px-4 py-2 font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                onClick={handleConfirmar}
                disabled={isLoading}
                className="rounded bg-slate-900 px-4 py-2 font-medium text-white hover:bg-slate-800 disabled:opacity-50"
              >
                {isLoading ? 'Inyectando...' : 'Confirmar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
