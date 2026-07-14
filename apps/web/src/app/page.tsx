import Link from 'next/link';

export default function HomePage() {
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="text-center">
        <h1 className="text-2xl font-semibold">HRMS Perú</h1>
        <p className="mt-2 text-slate-600">
          Backend Fases 0–4 operativo (Nómina, Asistencia, Legajo y ATS) — los dashboards web
          llegan en el siguiente ciclo.
        </p>
        <Link
          href="/login"
          className="mt-6 inline-block rounded bg-slate-900 px-6 py-2.5 text-sm font-medium text-white hover:bg-slate-700"
        >
          Iniciar sesión
        </Link>
      </div>
    </main>
  );
}
