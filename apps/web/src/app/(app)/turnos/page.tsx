'use client';

import { useState } from 'react';
import { CatalogoTab } from './catalogo-tab';
import { PlanTab } from './plan-tab';
import { CumplimientoTab } from './cumplimiento-tab';
import { CompensatoriosTab } from './compensatorios-tab';

const TABS = [
  { id: 'plan', label: 'Plan' },
  { id: 'cumplimiento', label: 'Cumplimiento' },
  { id: 'compensatorios', label: 'Compensatorios' },
  { id: 'catalogo', label: 'Catálogo' },
] as const;

export default function TurnosPage() {
  const [tab, setTab] = useState<(typeof TABS)[number]['id']>('plan');

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Turnos</h1>
      <div className="flex gap-1 border-b border-slate-200">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-3 py-2 text-sm font-medium ${tab === t.id ? 'border-b-2 border-slate-900 text-slate-900' : 'text-slate-500'}`}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'plan' && <PlanTab />}
      {tab === 'cumplimiento' && <CumplimientoTab />}
      {tab === 'compensatorios' && <CompensatoriosTab />}
      {tab === 'catalogo' && <CatalogoTab />}
    </div>
  );
}
