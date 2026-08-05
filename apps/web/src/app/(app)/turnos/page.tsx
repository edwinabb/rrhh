'use client';

import { useState } from 'react';
import { CatalogoTab } from './catalogo-tab';
import { PlanTab } from './plan-tab';
import { CumplimientoTab } from './cumplimiento-tab';
import { CompensatoriosTab } from './compensatorios-tab';
import { PatronesCatalogoTab } from './patrones-catalogo-tab';
import { PatronesAplicarTab } from './patrones-aplicar-tab';
import { MisCambiosTab } from './mis-cambios-tab';
import { CambiosBoardTab } from './cambios-board-tab';
import { TrabajoAdicionalEmpleadoTab } from './trabajo-adicional-empleado-tab';
import { TrabajoAdicionalManagerTab } from './trabajo-adicional-manager-tab';
import { IntercambiosEmpleadoTab } from './intercambios-empleado-tab';
import { IntercambiosManagerTab } from './intercambios-manager-tab';

const TABS = [
  { id: 'plan', label: 'Plan' },
  { id: 'cumplimiento', label: 'Cumplimiento' },
  { id: 'compensatorios', label: 'Compensatorios' },
  { id: 'catalogo', label: 'Catálogo' },
  { id: 'patrones', label: 'Patrones Catálogo' },
  { id: 'aplicar', label: 'Aplicar Patrones' },
  { id: 'mis-cambios', label: 'Mis Cambios' },
  { id: 'cambios-board', label: 'Cambios (Manager)' },
  { id: 'trabajo-adicional-empleado', label: 'Trabajo Adicional' },
  { id: 'trabajo-adicional-manager', label: 'Trabajo Adicional (Manager)' },
  { id: 'intercambios-empleado', label: 'Intercambios' },
  { id: 'intercambios-manager', label: 'Intercambios (Manager)' },
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
      {tab === 'patrones' && <PatronesCatalogoTab />}
      {tab === 'aplicar' && <PatronesAplicarTab />}
      {tab === 'mis-cambios' && <MisCambiosTab />}
      {tab === 'cambios-board' && <CambiosBoardTab />}
      {tab === 'trabajo-adicional-empleado' && <TrabajoAdicionalEmpleadoTab />}
      {tab === 'trabajo-adicional-manager' && <TrabajoAdicionalManagerTab />}
      {tab === 'intercambios-empleado' && <IntercambiosEmpleadoTab />}
      {tab === 'intercambios-manager' && <IntercambiosManagerTab />}
    </div>
  );
}
