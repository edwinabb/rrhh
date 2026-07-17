'use client';

import { useEffect, useState } from 'react';
import { EmpleadoResumen, listarEmpleados } from '../vacaciones/vacations-api';
import { actualizarDatos, calcularCese, Cese, crearCese, MotivoCese } from './termination-api';

const MOTIVOS: Array<{ value: MotivoCese; label: string }> = [
  { value: 'RENUNCIA', label: 'Renuncia voluntaria' },
  { value: 'TERMINO_CONTRATO', label: 'Término de contrato' },
  { value: 'MUTUO_DISENSO', label: 'Mutuo disenso' },
  { value: 'DESPIDO_ARBITRARIO', label: 'Despido arbitrario' },
  { value: 'FALLECIMIENTO', label: 'Fallecimiento' },
];

export function WizardCese({ onTerminado }: { onTerminado: (cese: Cese) => void }) {
  const [paso, setPaso] = useState(1);
  const [empleados, setEmpleados] = useState<EmpleadoResumen[]>([]);
  const [employeeId, setEmployeeId] = useState('');
  const [fechaCese, setFechaCese] = useState('');
  const [motivo, setMotivo] = useState<MotivoCese>('RENUNCIA');
  const [cese, setCese] = useState<Cese | null>(null);
  const [snapshotJson, setSnapshotJson] = useState('');
  const [gratiExtra, setGratiExtra] = useState('0');
  const [derechohabientesJson, setDerechohabientesJson] = useState('[]');
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  useEffect(() => {
    listarEmpleados().then(setEmpleados).catch((e) => setError(e.message));
  }, []);

  async function paso1Crear() {
    setError(null);
    setOcupado(true);
    try {
      const creado = await crearCese({ employeeId, fechaCese, motivo });
      setCese(creado);
      setSnapshotJson(JSON.stringify(creado.inputSnapshot, null, 2));
      setPaso(2);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setOcupado(false);
    }
  }

  async function paso2Calcular() {
    if (!cese) return;
    setError(null);
    setOcupado(true);
    try {
      let snapshot: any;
      try {
        snapshot = JSON.parse(snapshotJson);
      } catch {
        throw new Error('El snapshot no es JSON válido');
      }
      if (motivo === 'MUTUO_DISENSO') snapshot.gratificacionExtraordinaria = Number(gratiExtra) || 0;
      if (motivo === 'FALLECIMIENTO') {
        try {
          snapshot.derechohabientes = JSON.parse(derechohabientesJson);
        } catch {
          throw new Error('Derechohabientes no es JSON válido');
        }
      }
      await actualizarDatos(cese.id, snapshot);
      const calculado = await calcularCese(cese.id);
      setCese(calculado);
      setPaso(3);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setOcupado(false);
    }
  }

  return (
    <div className="space-y-4 rounded border border-slate-200 bg-white p-4">
      <h2 className="font-medium">Nuevo cese — paso {paso} de 3</h2>
      {error && <p className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      {paso === 1 && (
        <div className="flex flex-wrap items-end gap-3 text-sm">
          <label>
            Empleado
            <select value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} className="mt-1 block w-72 rounded border border-slate-300 px-2 py-1.5">
              <option value="">— Seleccionar —</option>
              {empleados.map((e) => (
                <option key={e.id} value={e.id}>{e.apellidos}, {e.nombres}</option>
              ))}
            </select>
          </label>
          <label>
            Fecha de cese
            <input type="date" value={fechaCese} onChange={(e) => setFechaCese(e.target.value)} className="mt-1 block rounded border border-slate-300 px-2 py-1.5" />
          </label>
          <label>
            Motivo
            <select value={motivo} onChange={(e) => setMotivo(e.target.value as MotivoCese)} className="mt-1 block rounded border border-slate-300 px-2 py-1.5">
              {MOTIVOS.map((m) => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
            </select>
          </label>
          <button onClick={paso1Crear} disabled={!employeeId || !fechaCese || ocupado} className="rounded bg-slate-900 px-3 py-2 font-medium text-white disabled:opacity-50">
            {ocupado ? 'Creando…' : 'Crear y pre-llenar'}
          </button>
        </div>
      )}

      {paso === 2 && cese && (
        <div className="space-y-3 text-sm">
          <p className="text-slate-600">
            Revisa y corrige los datos pre-llenados (fuente: contrato, planillas, asistencia y récord
            vacacional). El cálculo usará exactamente este snapshot.
          </p>
          {motivo === 'MUTUO_DISENSO' && (
            <label className="block">
              Gratificación extraordinaria por cese (S/)
              <input type="number" value={gratiExtra} onChange={(e) => setGratiExtra(e.target.value)} className="mt-1 block w-48 rounded border border-slate-300 px-2 py-1.5" />
            </label>
          )}
          {motivo === 'FALLECIMIENTO' && (
            <label className="block">
              Derechohabientes (JSON: nombre, tipoDocumento, numeroDocumento, parentesco, porcentaje)
              <textarea value={derechohabientesJson} onChange={(e) => setDerechohabientesJson(e.target.value)} rows={4} className="mt-1 block w-full rounded border border-slate-300 px-2 py-1.5 font-mono text-xs" />
            </label>
          )}
          <textarea value={snapshotJson} onChange={(e) => setSnapshotJson(e.target.value)} rows={18} className="block w-full rounded border border-slate-300 px-2 py-1.5 font-mono text-xs" />
          <button onClick={paso2Calcular} disabled={ocupado} className="rounded bg-slate-900 px-3 py-2 font-medium text-white disabled:opacity-50">
            {ocupado ? 'Calculando…' : 'Calcular liquidación'}
          </button>
        </div>
      )}

      {paso === 3 && cese && (
        <div className="space-y-3 text-sm">
          <p className="text-emerald-700">Liquidación calculada.</p>
          <button onClick={() => onTerminado(cese)} className="rounded bg-slate-900 px-3 py-2 font-medium text-white">
            Ver desglose
          </button>
        </div>
      )}
    </div>
  );
}
