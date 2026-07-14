'use client';

import { useState } from 'react';
import {
  fmtHora,
  registrarMarcacion,
  type EmployeeLite,
  type TipoMarcacion,
} from './attendance-api';

interface Mensaje {
  kind: 'ok' | 'warn' | 'error';
  text: string;
}

const MENSAJE_CLASSES: Record<Mensaje['kind'], string> = {
  ok: 'border-green-200 bg-green-50 text-green-800',
  warn: 'border-amber-200 bg-amber-50 text-amber-800',
  error: 'border-red-200 bg-red-50 text-red-800',
};

/** Pide la ubicación al navegador; null si la niega, falla o no existe. */
function obtenerCoordenadas(): Promise<{ latitud: number; longitud: number } | null> {
  return new Promise((resolve) => {
    if (typeof navigator === 'undefined' || !('geolocation' in navigator)) {
      resolve(null);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ latitud: pos.coords.latitude, longitud: pos.coords.longitude }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 },
    );
  });
}

export function MarcarCard({
  ownEmployee,
  cargandoEmpleado,
  onMarcacionRegistrada,
}: {
  /** Registro de empleado vinculado al usuario logueado (null si no existe). */
  ownEmployee: EmployeeLite | null;
  cargandoEmpleado: boolean;
  /** Notifica al padre para refrescar el resumen del mes. */
  onMarcacionRegistrada: () => void;
}) {
  const [marcando, setMarcando] = useState<TipoMarcacion | null>(null);
  const [mensajes, setMensajes] = useState<Mensaje[]>([]);

  async function marcar(tipo: TipoMarcacion) {
    if (!ownEmployee || !ownEmployee.sedeId) return;
    setMarcando(tipo);
    setMensajes([]);

    const coords = await obtenerCoordenadas();
    try {
      const marcacion = await registrarMarcacion({
        employeeId: ownEmployee.id,
        sedeId: ownEmployee.sedeId,
        tipo,
        ...(coords ?? {}),
      });

      const nuevos: Mensaje[] = [];
      if (!coords) {
        nuevos.push({
          kind: 'warn',
          text: 'El navegador no entregó tu ubicación (GPS denegado o no disponible); la marcación se envió sin coordenadas.',
        });
      }
      if (marcacion.bloqueado) {
        nuevos.push({
          kind: 'error',
          text: `Marcación bloqueada: ${marcacion.motivoBloqueo ?? 'motivo no especificado'}. El intento quedó registrado para auditoría.`,
        });
      } else if (marcacion.requiereAutorizacion) {
        nuevos.push({
          kind: 'warn',
          text: `Marcación registrada a las ${fmtHora(marcacion.timestamp)}, pero requiere autorización de un supervisor${
            marcacion.motivoBloqueo ? ` (${marcacion.motivoBloqueo})` : ''
          }.`,
        });
      } else {
        nuevos.push({
          kind: 'ok',
          text: `${tipo === 'ENTRADA' ? 'Entrada' : 'Salida'} registrada a las ${fmtHora(
            marcacion.timestamp,
          )}.${marcacion.ubicacionValidada ? ' Ubicación validada dentro de la sede.' : ''}`,
        });
      }
      setMensajes(nuevos);
      if (!marcacion.bloqueado) {
        onMarcacionRegistrada();
      }
    } catch (err) {
      setMensajes([
        {
          kind: 'error',
          text: err instanceof Error ? err.message : 'No se pudo registrar la marcación.',
        },
      ]);
    } finally {
      setMarcando(null);
    }
  }

  const sinEmpleado = !cargandoEmpleado && (!ownEmployee || !ownEmployee.sedeId);
  const deshabilitado = cargandoEmpleado || sinEmpleado || marcando !== null;

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
      <h2 className="text-base font-semibold">Marcar asistencia</h2>
      <p className="mt-1 text-sm text-slate-500">
        Al marcar se solicitará tu ubicación para validar el geofence de la sede.
      </p>

      {cargandoEmpleado && <p className="mt-4 text-sm text-slate-500">Cargando...</p>}
      {sinEmpleado && (
        <p className="mt-4 text-sm text-amber-700">
          Tu usuario no está vinculado a un registro de empleado con sede asignada, por lo
          que no puedes marcar asistencia desde aquí.
        </p>
      )}

      <div className="mt-4 flex gap-3">
        <button
          type="button"
          onClick={() => marcar('ENTRADA')}
          disabled={deshabilitado}
          className="rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
        >
          {marcando === 'ENTRADA' ? 'Marcando...' : 'Marcar ENTRADA'}
        </button>
        <button
          type="button"
          onClick={() => marcar('SALIDA')}
          disabled={deshabilitado}
          className="rounded border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50"
        >
          {marcando === 'SALIDA' ? 'Marcando...' : 'Marcar SALIDA'}
        </button>
      </div>

      {mensajes.length > 0 && (
        <div className="mt-4 space-y-2">
          {mensajes.map((m, i) => (
            <p key={i} className={`rounded border px-3 py-2 text-sm ${MENSAJE_CLASSES[m.kind]}`}>
              {m.text}
            </p>
          ))}
        </div>
      )}
    </section>
  );
}
