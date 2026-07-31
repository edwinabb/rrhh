'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/components/auth-context';
import { actualizarTurno, crearTurno, listarTurnos, Turno } from './shifts-api';

export function CatalogoTab() {
  const { hasPermission } = useAuth();
  const puedeGestionar = hasPermission('shift.manage');
  const [turnos, setTurnos] = useState<Turno[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [nuevo, setNuevo] = useState({ codigo: '', nombre: '', horaInicio: '08:00', horaFin: '20:00', horasEsperadas: '12', toleranciaMinutos: '30' });

  async function refrescar() {
    try {
      setTurnos(await listarTurnos(true));
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => { refrescar(); }, []);

  async function onCrear() {
    setError(null);
    try {
      await crearTurno({
        codigo: nuevo.codigo, nombre: nuevo.nombre, horaInicio: nuevo.horaInicio, horaFin: nuevo.horaFin,
        horasEsperadas: Number(nuevo.horasEsperadas), toleranciaMinutos: Number(nuevo.toleranciaMinutos),
      });
      setNuevo({ codigo: '', nombre: '', horaInicio: '08:00', horaFin: '20:00', horasEsperadas: '12', toleranciaMinutos: '30' });
      await refrescar();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function onToggleActivo(t: Turno) {
    setError(null);
    try {
      await actualizarTurno(t.id, { activo: !t.activo });
      await refrescar();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <div className="space-y-4">
      {error && <p className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {puedeGestionar && (
        <div className="flex flex-wrap items-end gap-2 rounded border border-slate-200 bg-white p-3 text-sm">
          <label>Código<input value={nuevo.codigo} onChange={(e) => setNuevo({ ...nuevo, codigo: e.target.value })} className="mt-1 block w-24 rounded border border-slate-300 px-2 py-1.5" /></label>
          <label>Nombre<input value={nuevo.nombre} onChange={(e) => setNuevo({ ...nuevo, nombre: e.target.value })} className="mt-1 block w-56 rounded border border-slate-300 px-2 py-1.5" /></label>
          <label>Inicio<input value={nuevo.horaInicio} onChange={(e) => setNuevo({ ...nuevo, horaInicio: e.target.value })} className="mt-1 block w-20 rounded border border-slate-300 px-2 py-1.5" /></label>
          <label>Fin<input value={nuevo.horaFin} onChange={(e) => setNuevo({ ...nuevo, horaFin: e.target.value })} className="mt-1 block w-20 rounded border border-slate-300 px-2 py-1.5" /></label>
          <label>Horas<input type="number" value={nuevo.horasEsperadas} onChange={(e) => setNuevo({ ...nuevo, horasEsperadas: e.target.value })} className="mt-1 block w-20 rounded border border-slate-300 px-2 py-1.5" /></label>
          <label>Tolerancia (min)<input type="number" value={nuevo.toleranciaMinutos} onChange={(e) => setNuevo({ ...nuevo, toleranciaMinutos: e.target.value })} className="mt-1 block w-24 rounded border border-slate-300 px-2 py-1.5" /></label>
          <button onClick={onCrear} disabled={!nuevo.codigo || !nuevo.nombre} className="rounded bg-slate-900 px-3 py-2 font-medium text-white disabled:opacity-50">Crear turno</button>
        </div>
      )}
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-left text-slate-500">
            <th className="py-2">Código</th><th>Nombre</th><th>Horario</th><th>Horas</th><th>Tolerancia</th><th>Estado</th><th />
          </tr>
        </thead>
        <tbody>
          {turnos.map((t) => (
            <tr key={t.id} className="border-b border-slate-100">
              <td className="py-2 font-medium">{t.codigo}</td>
              <td>{t.nombre}</td>
              <td>{t.horaInicio}–{t.horaFin}{t.horaFin <= t.horaInicio ? ' (+1 día)' : ''}</td>
              <td>{Number(t.horasEsperadas)}</td>
              <td>{t.toleranciaMinutos} min</td>
              <td>{t.activo ? 'Activo' : 'Inactivo'}</td>
              <td>
                {puedeGestionar && (
                  <button onClick={() => onToggleActivo(t)} className="rounded border border-slate-300 px-2 py-1 text-xs">
                    {t.activo ? 'Desactivar' : 'Activar'}
                  </button>
                )}
              </td>
            </tr>
          ))}
          {turnos.length === 0 && <tr><td colSpan={7} className="py-4 text-slate-500">Sin turnos definidos.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}
