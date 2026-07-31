'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/components/auth-context';
import { actualizarPatron, crearPatron, listarPatrones, RotacionPatron, TipoDiaPatron } from './shifts-api';
import { PatronFormModal } from './patron-form-modal';

export function PatronesCatalogoTab() {
  const { hasPermission } = useAuth();
  const puedeGestionar = hasPermission('shift.manage');
  const [patrones, setPatrones] = useState<RotacionPatron[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedPatron, setSelectedPatron] = useState<RotacionPatron | undefined>(undefined);
  const [isLoading, setIsLoading] = useState(false);

  async function refrescar() {
    try {
      const data = await listarPatrones(true);
      setPatrones(data);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  useEffect(() => {
    refrescar();
  }, []);

  const handleNew = () => {
    setSelectedPatron(undefined);
    setIsModalOpen(true);
  };

  const handleEdit = (patron: RotacionPatron) => {
    setSelectedPatron(patron);
    setIsModalOpen(true);
  };

  const handleDuplicate = async (patron: RotacionPatron) => {
    setError(null);
    try {
      const newName = `${patron.nombre} (copia)`;
      await crearPatron({
        nombre: newName,
        descripcion: patron.descripcion || undefined,
        secuencia: patron.secuencia,
      });
      await refrescar();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const handleDeactivate = async (patron: RotacionPatron) => {
    setError(null);
    try {
      await actualizarPatron(patron.id, { activo: false });
      await refrescar();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const handleActivate = async (patron: RotacionPatron) => {
    setError(null);
    try {
      await actualizarPatron(patron.id, { activo: true });
      await refrescar();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const handleSavePatron = async (data: {
    nombre: string;
    descripcion?: string;
    secuencia: TipoDiaPatron[];
  }) => {
    setError(null);
    setIsLoading(true);
    try {
      if (selectedPatron) {
        await actualizarPatron(selectedPatron.id, {
          nombre: data.nombre,
          descripcion: data.descripcion,
          secuencia: data.secuencia,
        });
      } else {
        await crearPatron(data);
      }
      await refrescar();
    } catch (e) {
      setError((e as Error).message);
      throw e;
    } finally {
      setIsLoading(false);
    }
  };

  const formatSecuencia = (secuencia: TipoDiaPatron[]): string => {
    const labels = { DIA: 'D', NOCHE: 'N', DESC: '-' };
    return secuencia.map((s) => labels[s]).join(' ');
  };

  const filteredPatrones = puedeGestionar ? patrones : patrones.filter((p) => p.activo);

  return (
    <div className="space-y-4">
      {error && <p className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      {puedeGestionar && (
        <button
          onClick={handleNew}
          className="rounded bg-slate-900 px-4 py-2 font-medium text-white hover:bg-slate-800"
        >
          + NUEVO PATRÓN
        </button>
      )}

      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-left text-slate-500">
            <th className="py-2">Nombre</th>
            <th>Descripción</th>
            <th>Ciclo</th>
            <th>Secuencia</th>
            <th>Estado</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {filteredPatrones.map((patron) => (
            <tr key={patron.id} className="border-b border-slate-100">
              <td className="py-2 font-medium">{patron.nombre}</td>
              <td className="text-slate-600">{patron.descripcion || '—'}</td>
              <td>{patron.duracionCiclo} días</td>
              <td className="font-mono text-xs">{formatSecuencia(patron.secuencia)}</td>
              <td className="text-sm">{patron.activo ? 'Activo' : 'Inactivo'}</td>
              <td>
                {puedeGestionar && (
                  <div className="flex gap-1">
                    <button
                      onClick={() => handleEdit(patron)}
                      className="rounded border border-slate-300 px-2 py-1 text-xs hover:bg-slate-50"
                      title="Editar"
                    >
                      Editar
                    </button>
                    <button
                      onClick={() => handleDuplicate(patron)}
                      className="rounded border border-slate-300 px-2 py-1 text-xs hover:bg-slate-50"
                      title="Duplicar"
                    >
                      Duplicar
                    </button>
                    {patron.activo ? (
                      <button
                        onClick={() => handleDeactivate(patron)}
                        className="rounded border border-slate-300 px-2 py-1 text-xs hover:bg-red-50"
                        title="Desactivar"
                      >
                        Desactivar
                      </button>
                    ) : (
                      <button
                        onClick={() => handleActivate(patron)}
                        className="rounded border border-slate-300 px-2 py-1 text-xs hover:bg-green-50"
                        title="Activar"
                      >
                        Activar
                      </button>
                    )}
                  </div>
                )}
              </td>
            </tr>
          ))}
          {filteredPatrones.length === 0 && (
            <tr>
              <td colSpan={6} className="py-4 text-center text-slate-500">
                Sin patrones definidos.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      <PatronFormModal
        isOpen={isModalOpen}
        onClose={() => {
          setIsModalOpen(false);
          setSelectedPatron(undefined);
        }}
        onSave={handleSavePatron}
        patron={selectedPatron}
        isLoading={isLoading}
      />
    </div>
  );
}
