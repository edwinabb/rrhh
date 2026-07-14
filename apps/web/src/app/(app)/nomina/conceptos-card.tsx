'use client';

interface ConceptoInfo {
  nombre: string;
  descripcion: string;
}

const CONCEPTOS: ConceptoInfo[] = [
  {
    nombre: 'CTS',
    descripcion: 'Compensación por tiempo de servicios (depósitos de mayo y noviembre).',
  },
  {
    nombre: 'Gratificación',
    descripcion: 'Gratificaciones de julio y diciembre con bonificación extraordinaria (Ley 30334).',
  },
  {
    nombre: 'AFP / ONP',
    descripcion: 'Retención pensionaria según el sistema del trabajador (aporte, comisión y prima).',
  },
  {
    nombre: 'EsSalud',
    descripcion: 'Aporte del empleador al seguro social de salud (no afecta el neto del trabajador).',
  },
  {
    nombre: 'Asignación familiar',
    descripcion: 'Asignación por hijos o dependientes calculada sobre la RMV (Ley 25129).',
  },
  {
    nombre: 'Quinta categoría',
    descripcion: 'Retención del impuesto a la renta de quinta categoría con proyección anual progresiva.',
  },
  {
    nombre: 'Utilidades',
    descripcion: 'Participación de los trabajadores en las utilidades de la empresa.',
  },
  {
    nombre: 'Liquidación',
    descripcion: 'Liquidación de beneficios sociales al cese del trabajador (CTS trunca, gratificación trunca, vacaciones truncas).',
  },
];

/** Tarjeta informativa con los conceptos que calcula el motor de planillas. */
export function ConceptosCard() {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
      <h2 className="text-sm font-semibold text-slate-900">Conceptos que calcula el sistema</h2>
      <p className="mt-1 text-sm text-slate-500">
        Calculadoras implementadas y testeadas en el motor de planillas.
      </p>
      <ul className="mt-4 grid gap-3 sm:grid-cols-2">
        {CONCEPTOS.map((c) => (
          <li key={c.nombre} className="rounded border border-slate-200 px-3 py-2">
            <p className="text-sm font-medium text-slate-900">{c.nombre}</p>
            <p className="mt-0.5 text-sm text-slate-500">{c.descripcion}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
