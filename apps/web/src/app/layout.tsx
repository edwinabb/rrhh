import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'HRMS Perú',
  description: 'Sistema de Gestión de Recursos Humanos con Cumplimiento Normativo Peruano',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es-PE">
      <body className="min-h-screen bg-slate-50 text-slate-900 antialiased">{children}</body>
    </html>
  );
}
