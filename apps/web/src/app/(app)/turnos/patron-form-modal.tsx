'use client';

import { useEffect, useState, useRef } from 'react';
import { RotacionPatron, TipoDiaPatron } from './shifts-api';

export interface PatronFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (patron: { nombre: string; descripcion?: string; secuencia: TipoDiaPatron[] }) => Promise<void>;
  patron?: RotacionPatron;
  isLoading?: boolean;
}

const PRESETS = [
  { label: '[2-2-2-1]', secuencia: ['DIA', 'DIA', 'NOCHE', 'NOCHE', 'DESC', 'DESC', 'DESC'] as TipoDiaPatron[] },
  { label: '[3-3-1]', secuencia: ['DIA', 'DIA', 'DIA', 'NOCHE', 'NOCHE', 'NOCHE', 'DESC'] as TipoDiaPatron[] },
  { label: '[3-2-2]', secuencia: ['DIA', 'DIA', 'DIA', 'NOCHE', 'NOCHE', 'DESC', 'DESC'] as TipoDiaPatron[] },
];

export function PatronFormModal({ isOpen, onClose, onSave, patron, isLoading }: PatronFormModalProps) {
  const [nombre, setNombre] = useState('');
  const [descripcion, setDescripcion] = useState('');
  const [secuencia, setSecuencia] = useState<TipoDiaPatron[]>(['DIA', 'NOCHE', 'DESC', 'DIA', 'NOCHE', 'DESC', 'DESC']);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const headingId = useRef('patron-form-heading');

  // Initialize form with patron data if editing
  useEffect(() => {
    if (patron) {
      setNombre(patron.nombre);
      setDescripcion(patron.descripcion || '');
      setSecuencia(patron.secuencia);
    } else {
      setNombre('');
      setDescripcion('');
      setSecuencia(['DIA', 'NOCHE', 'DESC', 'DIA', 'NOCHE', 'DESC', 'DESC']);
    }
    setError(null);
  }, [patron, isOpen]);

  // Handle Escape key to close modal
  useEffect(() => {
    if (!isOpen) return;
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isSaving && !isLoading) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [isOpen, onClose, isSaving, isLoading]);

  const handleSave = async () => {
    if (!nombre.trim()) {
      setError('El nombre del patrón es obligatorio');
      return;
    }

    if (secuencia.length !== 7) {
      setError('La secuencia debe tener exactamente 7 días');
      return;
    }

    setError(null);
    setIsSaving(true);
    try {
      await onSave({
        nombre: nombre.trim(),
        descripcion: descripcion.trim() || undefined,
        secuencia,
      });
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setIsSaving(false);
    }
  };

  const handlePresetClick = (presetSecuencia: TipoDiaPatron[]) => {
    setSecuencia(presetSecuencia);
  };

  const handleDayChange = (index: number, value: TipoDiaPatron) => {
    const newSecuencia = [...secuencia];
    newSecuencia[index] = value;
    setSecuencia(newSecuencia);
  };

  if (!isOpen) return null;

  const handleBackdropClick = (e: React.MouseEvent) => {
    // Only close if clicking directly on backdrop, not on dialog content
    if (e.target === e.currentTarget && !isSaving && !isLoading) {
      onClose();
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50"
      onClick={handleBackdropClick}
      role="presentation"
    >
      <div
        className="w-full max-w-2xl rounded-lg bg-white p-6 shadow-lg"
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId.current}
      >
        <h2 id={headingId.current} className="mb-4 text-lg font-semibold">
          {patron ? 'Editar patrón' : 'Crear nuevo patrón'}
        </h2>

        {error && (
          <p className="mb-4 rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
        )}

        <div className="space-y-4">
          {/* Nombre */}
          <div>
            <label htmlFor="patron-nombre" className="block text-sm font-medium text-slate-700">
              Nombre del patrón
            </label>
            <input
              id="patron-nombre"
              type="text"
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              placeholder="Ej: Turno Administrativo"
              className="mt-1 block w-full rounded border border-slate-300 px-3 py-2"
              disabled={isSaving || isLoading}
            />
          </div>

          {/* Descripción */}
          <div>
            <label htmlFor="patron-descripcion" className="block text-sm font-medium text-slate-700">
              Descripción (opcional)
            </label>
            <input
              id="patron-descripcion"
              type="text"
              value={descripcion}
              onChange={(e) => setDescripcion(e.target.value)}
              placeholder="Ej: Rotación de 2 días, 2 noches, 3 descansos"
              className="mt-1 block w-full rounded border border-slate-300 px-3 py-2"
              disabled={isSaving || isLoading}
            />
          </div>

          {/* Duración del ciclo (readonly) */}
          <div>
            <label htmlFor="patron-duracion" className="block text-sm font-medium text-slate-700">
              Duración del ciclo (días)
            </label>
            <input
              id="patron-duracion"
              type="number"
              value={7}
              disabled
              className="mt-1 block w-full rounded border border-slate-300 bg-slate-50 px-3 py-2 text-slate-500"
            />
          </div>

          {/* Quick presets */}
          <div>
            <p className="mb-2 text-sm font-medium text-slate-700">Presets rápidos</p>
            <div className="flex flex-wrap gap-2">
              {PRESETS.map((preset) => (
                <button
                  key={preset.label}
                  onClick={() => handlePresetClick(preset.secuencia)}
                  disabled={isSaving || isLoading}
                  className="rounded border border-slate-300 px-3 py-1 text-sm hover:bg-slate-50 disabled:opacity-50"
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </div>

          {/* Secuencia */}
          <div>
            <p className="mb-3 text-sm font-medium text-slate-700">Secuencia de 7 días</p>
            <div className="grid grid-cols-7 gap-2">
              {secuencia.map((dia, index) => (
                <div key={index} className="flex flex-col items-center">
                  <label htmlFor={`patron-day-${index}`} className="text-xs text-slate-500">
                    Día {index + 1}
                  </label>
                  <select
                    id={`patron-day-${index}`}
                    value={dia}
                    onChange={(e) => handleDayChange(index, e.target.value as TipoDiaPatron)}
                    disabled={isSaving || isLoading}
                    className="mt-1 rounded border border-slate-300 px-2 py-1 text-sm"
                    aria-label={`Día ${index + 1} de la secuencia`}
                  >
                    <option value="DIA">DÍA</option>
                    <option value="NOCHE">NOCHE</option>
                    <option value="DESC">DESC</option>
                  </select>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="mt-6 flex justify-end gap-3">
          <button
            onClick={onClose}
            disabled={isSaving || isLoading}
            className="rounded border border-slate-300 px-4 py-2 font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            onClick={handleSave}
            disabled={isSaving || isLoading}
            className="rounded bg-slate-900 px-4 py-2 font-medium text-white hover:bg-slate-800 disabled:opacity-50"
          >
            {isSaving || isLoading ? 'Guardando...' : 'Guardar'}
          </button>
        </div>
      </div>
    </div>
  );
}
