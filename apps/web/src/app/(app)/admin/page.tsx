'use client';

import { useMemo, useState } from 'react';
import { useAuth } from '@/components/auth-context';
import ParamsTab from './params-tab';
import AuditTab from './audit-tab';
import EmployeesTab from './employees-tab';

type TabId = 'params' | 'audit' | 'employees';

interface TabDef {
  id: TabId;
  label: string;
  permission: string;
}

const TABS: TabDef[] = [
  { id: 'params', label: 'Parámetros normativos', permission: 'normative_param.read' },
  { id: 'audit', label: 'Auditoría', permission: 'audit_log.read' },
  { id: 'employees', label: 'Empleados', permission: 'employee.read' },
];

export default function AdminPage() {
  const { hasPermission } = useAuth();

  const visibleTabs = useMemo(
    () => TABS.filter((tab) => hasPermission(tab.permission)),
    [hasPermission],
  );

  const [activeTab, setActiveTab] = useState<TabId | null>(visibleTabs[0]?.id ?? null);

  if (visibleTabs.length === 0) {
    return (
      <div>
        <h1 className="text-xl font-semibold">Administración</h1>
        <p className="mt-4 text-sm text-slate-500">
          No tienes permisos para ver las secciones de administración.
        </p>
      </div>
    );
  }

  const current = visibleTabs.some((t) => t.id === activeTab) ? activeTab : visibleTabs[0].id;

  return (
    <div>
      <h1 className="text-xl font-semibold">Administración</h1>

      <div className="mt-4 border-b border-slate-200">
        <nav className="-mb-px flex gap-4">
          {visibleTabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`border-b-2 px-1 pb-2 text-sm font-medium ${
                current === tab.id
                  ? 'border-slate-900 text-slate-900'
                  : 'border-transparent text-slate-500 hover:text-slate-700'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      <div className="mt-6">
        {current === 'params' && <ParamsTab />}
        {current === 'audit' && <AuditTab />}
        {current === 'employees' && <EmployeesTab />}
      </div>
    </div>
  );
}
