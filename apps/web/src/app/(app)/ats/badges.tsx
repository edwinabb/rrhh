import type { EstadoCandidato, EstadoVacante } from './ats-api';

const VACANTE_BADGE: Record<EstadoVacante, string> = {
  ABIERTA: 'bg-green-100 text-green-800',
  PAUSADA: 'bg-amber-100 text-amber-800',
  CERRADA: 'bg-slate-200 text-slate-600',
};

const CANDIDATO_BADGE: Record<EstadoCandidato, string> = {
  APLICADO: 'bg-slate-100 text-slate-700',
  REVISADO: 'bg-blue-100 text-blue-800',
  ENTREVISTA: 'bg-violet-100 text-violet-800',
  OFERTA: 'bg-amber-100 text-amber-800',
  CONTRATADO: 'bg-green-100 text-green-800',
  RECHAZADO: 'bg-red-100 text-red-700',
};

export function VacanteBadge({ estado }: { estado: EstadoVacante }) {
  return (
    <span
      className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${
        VACANTE_BADGE[estado] ?? 'bg-slate-100 text-slate-700'
      }`}
    >
      {estado}
    </span>
  );
}

export function CandidatoBadge({ estado }: { estado: EstadoCandidato }) {
  return (
    <span
      className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${
        CANDIDATO_BADGE[estado] ?? 'bg-slate-100 text-slate-700'
      }`}
    >
      {estado}
    </span>
  );
}
