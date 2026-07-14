'use client';

import Link from 'next/link';
import { useAuth } from '@/components/auth-context';

interface ModuleCard {
  href: string;
  title: string;
  description: string;
  /** El módulo se muestra solo si el usuario tiene ALGUNO de estos permisos. */
  anyPermission: string[];
}

const MODULES: ModuleCard[] = [
  {
    href: '/asistencia',
    title: 'Asistencia',
    description: 'Marcaciones, tardanzas, faltas y justificaciones del período.',
    anyPermission: ['attendance.read'],
  },
  {
    href: '/nomina',
    title: 'Nómina',
    description: 'Procesamiento de planillas con cálculo normativo peruano.',
    anyPermission: ['payroll.process'],
  },
  {
    href: '/legajo',
    title: 'Legajo',
    description: 'Documentos del empleado: búsqueda, descarga y completitud del legajo.',
    anyPermission: ['documents.read'],
  },
  {
    href: '/ats',
    title: 'Reclutamiento',
    description: 'Vacantes, candidatos y pipeline de selección.',
    anyPermission: ['ats.read'],
  },
  {
    href: '/admin',
    title: 'Administración',
    description: 'Parámetros normativos versionados y log de auditoría.',
    anyPermission: ['normative_param.write', 'audit_log.read'],
  },
];

export default function DashboardPage() {
  const { hasPermission } = useAuth();

  const visible = MODULES.filter((m) => m.anyPermission.some((p) => hasPermission(p)));

  return (
    <div>
      <h1 className="text-xl font-semibold">Inicio</h1>
      <p className="mt-1 text-sm text-slate-600">
        Selecciona un módulo para comenzar.
      </p>

      {visible.length === 0 ? (
        <p className="mt-6 text-sm text-slate-500">
          Tu cuenta no tiene módulos habilitados. Contacta al administrador del sistema.
        </p>
      ) : (
        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {visible.map((m) => (
            <Link
              key={m.href}
              href={m.href}
              className="block rounded-lg border border-slate-200 bg-white p-5 shadow-sm hover:border-slate-300 hover:shadow"
            >
              <h2 className="text-sm font-semibold">{m.title}</h2>
              <p className="mt-1 text-sm text-slate-600">{m.description}</p>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
