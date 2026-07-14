'use client';

import { createContext, useContext, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getMe, type Me } from '@/lib/api-client';

interface AuthContextValue {
  me: Me | null;
  loading: boolean;
  hasPermission: (code: string) => boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getMe()
      .then((result) => {
        if (cancelled) return;
        if (result === null) {
          router.replace('/login');
          return;
        }
        setMe(result);
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setError('No se pudo verificar la sesión. Revisa tu conexión e intenta nuevamente.');
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [router]);

  if (error) {
    return (
      <main className="flex min-h-screen items-center justify-center px-4">
        <p className="text-sm text-red-600">{error}</p>
      </main>
    );
  }

  if (loading || !me) {
    return (
      <main className="flex min-h-screen items-center justify-center px-4">
        <p className="text-sm text-slate-500">Cargando...</p>
      </main>
    );
  }

  const value: AuthContextValue = {
    me,
    loading: false,
    hasPermission: (code) => me.permissions.includes(code),
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth debe usarse dentro de <AuthProvider>');
  }
  return ctx;
}
