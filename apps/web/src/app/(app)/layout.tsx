'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { AuthProvider, useAuth } from '@/components/auth-context';
import { logout } from '@/lib/api-client';

interface NavItem {
  href: string;
  label: string;
  /** Si está definido, el enlace se muestra solo si el usuario tiene ALGUNO de estos permisos. */
  anyPermission?: string[];
}

const NAV_ITEMS: NavItem[] = [
  { href: '/', label: 'Inicio' },
  { href: '/asistencia', label: 'Asistencia', anyPermission: ['attendance.read'] },
  { href: '/nomina', label: 'Nómina', anyPermission: ['payroll.process'] },
  { href: '/vacaciones', label: 'Vacaciones', anyPermission: ['vacation.read'] },
  { href: '/turnos', label: 'Turnos', anyPermission: ['shift.read'] },
  { href: '/liquidaciones', label: 'Liquidaciones', anyPermission: ['termination.read'] },
  { href: '/legajo', label: 'Legajo', anyPermission: ['documents.read'] },
  { href: '/ats', label: 'Reclutamiento', anyPermission: ['ats.read'] },
  {
    href: '/admin',
    label: 'Administración',
    anyPermission: ['normative_param.write', 'audit_log.read'],
  },
];

const PG_ROLE_LABELS: Record<string, string> = {
  app_rrhh: 'RRHH',
  app_manager: 'Gerente',
  app_employee: 'Empleado',
  app_admin: 'Administrador',
};

function Sidebar() {
  const { hasPermission } = useAuth();
  const pathname = usePathname();

  const visible = NAV_ITEMS.filter(
    (item) => !item.anyPermission || item.anyPermission.some((p) => hasPermission(p)),
  );

  return (
    <aside className="flex w-56 shrink-0 flex-col border-r border-slate-200 bg-white">
      <div className="border-b border-slate-200 px-4 py-4">
        <span className="text-sm font-semibold">HRMS Perú</span>
      </div>
      <nav className="flex-1 space-y-1 px-2 py-3">
        {visible.map((item) => {
          const active =
            item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`block rounded px-3 py-2 text-sm ${
                active
                  ? 'bg-slate-900 font-medium text-white'
                  : 'text-slate-700 hover:bg-slate-100'
              }`}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}

function Header() {
  const { me } = useAuth();
  const router = useRouter();
  const [loggingOut, setLoggingOut] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleLogout() {
    setError(null);
    setLoggingOut(true);
    try {
      await logout();
      router.replace('/login');
    } catch {
      setError('No se pudo cerrar la sesión. Intenta nuevamente.');
      setLoggingOut(false);
    }
  }

  const roleLabel = me ? (PG_ROLE_LABELS[me.pgRole] ?? me.pgRole) : '';

  return (
    <header className="flex items-center justify-between border-b border-slate-200 bg-white px-6 py-3">
      <span className="text-sm text-slate-600">
        Rol: <span className="font-medium text-slate-900">{roleLabel}</span>
      </span>
      <div className="flex items-center gap-3">
        {error && <span className="text-sm text-red-600">{error}</span>}
        <button
          type="button"
          onClick={handleLogout}
          disabled={loggingOut}
          className="rounded border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50"
        >
          {loggingOut ? 'Cerrando...' : 'Cerrar sesión'}
        </button>
      </div>
    </header>
  );
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <div className="flex min-h-screen">
        <Sidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <Header />
          <main className="flex-1 p-6">{children}</main>
        </div>
      </div>
    </AuthProvider>
  );
}
