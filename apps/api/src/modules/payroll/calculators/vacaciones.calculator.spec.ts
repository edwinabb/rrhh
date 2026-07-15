import { calcularVacacionesCese } from './vacaciones.calculator';

describe('calcularVacacionesCese', () => {
  const base = {
    remuneracionComputable: 3000,
    fechaCese: new Date('2026-07-15'),
    excluidoIndemnizacion: false,
  };

  it('vacaciones truncas: proporcional del período en curso (meses completos + días/30) / 12', () => {
    const r = calcularVacacionesCese({
      ...base,
      periodos: [
        {
          periodoInicio: new Date('2026-03-01'),
          periodoFin: new Date('2027-02-28'),
          diasGanados: 30,
          diasGozados: 0,
          estado: 'EN_CURSO',
        },
      ],
    });
    // 4 meses completos (mar, abr, may, jun) + 14 días → (4 + 14/30) / 12 × 3000 = 1116.67
    expect(r.vacacionesTruncas).toBeCloseTo(1116.67, 2);
    expect(r.vacacionesDevengadas).toBe(0);
    expect(r.indemnizacionVacacional).toBe(0);
  });

  it('devengadas: días no gozados de períodos vencidos × valor-día vigente', () => {
    const r = calcularVacacionesCese({
      ...base,
      periodos: [
        {
          periodoInicio: new Date('2025-03-01'),
          periodoFin: new Date('2026-02-28'),
          diasGanados: 30,
          diasGozados: 10,
          estado: 'VENCIDO_PENDIENTE',
        },
      ],
    });
    // 20 días × (3000/30) = 2000. Vencido hace < 1 año a la fecha de cese → sin indemnización.
    expect(r.vacacionesDevengadas).toBe(2000);
    expect(r.indemnizacionVacacional).toBe(0);
  });

  it('indemnización vacacional (art. 23 D.Leg. 713): período vencido hace más de 1 año sin gozar', () => {
    const r = calcularVacacionesCese({
      ...base,
      periodos: [
        {
          periodoInicio: new Date('2024-03-01'),
          periodoFin: new Date('2025-02-28'),
          diasGanados: 30,
          diasGozados: 0,
          estado: 'VENCIDO_PENDIENTE',
        },
      ],
    });
    // periodoFin 2025-02-28 + 1 año = 2026-02-28 < fechaCese 2026-07-15 → indemnización
    expect(r.vacacionesDevengadas).toBe(3000); // 30 días no gozados
    expect(r.indemnizacionVacacional).toBe(3000); // una remuneración adicional
  });

  it('flag excluidoIndemnizacion (gerentes que deciden sus vacaciones) anula solo la indemnización', () => {
    const r = calcularVacacionesCese({
      ...base,
      excluidoIndemnizacion: true,
      periodos: [
        {
          periodoInicio: new Date('2024-03-01'),
          periodoFin: new Date('2025-02-28'),
          diasGanados: 30,
          diasGozados: 0,
          estado: 'VENCIDO_PENDIENTE',
        },
      ],
    });
    expect(r.vacacionesDevengadas).toBe(3000);
    expect(r.indemnizacionVacacional).toBe(0);
  });

  it('período GOZADO o LIQUIDADO no genera monto alguno', () => {
    const r = calcularVacacionesCese({
      ...base,
      periodos: [
        {
          periodoInicio: new Date('2025-03-01'),
          periodoFin: new Date('2026-02-28'),
          diasGanados: 30,
          diasGozados: 30,
          estado: 'GOZADO',
        },
      ],
    });
    expect(r.vacacionesDevengadas).toBe(0);
    expect(r.vacacionesTruncas).toBe(0);
    expect(r.indemnizacionVacacional).toBe(0);
  });

  it('MYPE (15 días ganados): trunca proporcional sobre 15/12 avos', () => {
    const r = calcularVacacionesCese({
      ...base,
      periodos: [
        {
          periodoInicio: new Date('2026-01-15'),
          periodoFin: new Date('2027-01-14'),
          diasGanados: 15,
          diasGozados: 0,
          estado: 'EN_CURSO',
        },
      ],
    });
    // 6 meses completos (15ene→15jul) + 0 días → 6/12 × (15/30 × 3000) = 750
    expect(r.vacacionesTruncas).toBeCloseTo(750, 2);
  });
});
