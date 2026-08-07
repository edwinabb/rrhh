'use client';

import { useState } from 'react';
import Image from 'next/image';
import { login } from '@/lib/api-client';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await login(email, password);
      window.location.href = '/';
    } catch {
      setError('Correo o contraseña incorrectos.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="flex min-h-screen">
      {/* COLUMNA IZQUIERDA - IMAGEN */}
      <div className="hidden relative flex-1 overflow-hidden bg-gradient-to-br from-blue-500 to-purple-600 lg:flex lg:items-center lg:justify-center">
        <div className="absolute inset-0 bg-gradient-to-br from-blue-500/30 to-purple-600/30 z-10"></div>
        <Image
          src="/login-sistema.jpg"
          alt="Sistema RRHH"
          fill
          className="object-cover"
          priority
        />
      </div>

      {/* COLUMNA DERECHA - FORMULARIO */}
      <div className="flex w-full flex-1 items-center justify-center px-4 py-8 sm:px-6 lg:px-8 bg-white">
        <div className="w-full max-w-md">
          {/* LOGO YOFC */}
          <div className="mb-8 flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded bg-gradient-to-br from-blue-600 to-purple-600 text-white font-bold text-sm">
              Y
            </div>
            <span className="text-sm font-semibold text-gray-800">YOFC</span>
          </div>

          {/* TÍTULOS */}
          <div className="mb-8">
            <h1 className="text-3xl font-bold text-gray-900 mb-2">
              Sistema de RRHH
            </h1>
            <p className="text-sm text-gray-600">Inicio de sesión</p>
          </div>

          {/* FORMULARIO */}
          <form onSubmit={handleSubmit} className="space-y-5">
            {/* EMAIL */}
            <div>
              <label htmlFor="email" className="block text-sm font-semibold text-gray-900 mb-2">
                Correo Electrónico
              </label>
              <input
                id="email"
                type="email"
                required
                placeholder="admin@demo.pe"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-4 py-3 text-sm text-gray-900 placeholder-gray-400 transition-all duration-200 focus:border-blue-600 focus:outline-none focus:ring-4 focus:ring-blue-100"
              />
            </div>

            {/* PASSWORD */}
            <div>
              <label htmlFor="password" className="block text-sm font-semibold text-gray-900 mb-2">
                Contraseña
              </label>
              <input
                id="password"
                type="password"
                required
                placeholder="Ingresa tu contraseña"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-4 py-3 text-sm text-gray-900 placeholder-gray-400 transition-all duration-200 focus:border-blue-600 focus:outline-none focus:ring-4 focus:ring-blue-100"
              />
            </div>

            {/* ERROR MESSAGE */}
            {error && (
              <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700 border border-red-200">
                {error}
              </div>
            )}

            {/* BOTÓN LOGIN */}
            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-lg bg-gradient-to-r from-blue-600 to-purple-600 px-4 py-3 text-sm font-semibold text-white transition-all duration-200 hover:shadow-lg hover:-translate-y-0.5 active:translate-y-0 disabled:opacity-60 disabled:cursor-not-allowed disabled:hover:shadow-none disabled:hover:translate-y-0"
            >
              {loading ? 'Ingresando...' : 'Iniciar Sesión'}
            </button>
          </form>

          {/* FOOTER - VERSIÓN */}
          <div className="mt-10 border-t border-gray-200 pt-6 text-center text-xs text-gray-500">
            v1.5.0 - Sistema de Gestión de Recursos Humanos
          </div>
        </div>
      </div>
    </main>
  );
}
