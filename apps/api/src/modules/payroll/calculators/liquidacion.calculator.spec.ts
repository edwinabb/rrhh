import { calcularLiquidacion, LiquidacionCeseInput } from './liquidacion.calculator';

/** Input base: renuncia, régimen general, sin vacaciones pendientes ni deudas. */
function inputBase(overrides: Partial<LiquidacionCeseInput> = {}): LiquidacionCeseInput {
  return {
    motivo: 'RENUNCIA',
    regimen: 'general',
    fechaCese: new Date('2026-07-15'),
    remuneracionComputable: 3000,
    factorRegimenCtsGrati: 1,
    cts: {
      gratificacionSemestralPercibida: 3000,
      mesesCompletosDesdeUltimoDeposito: 2,
      diasAdicionales: 15,
    },
    gratificacionTrunca: {
      mesesCompletos: 1,
      afiliadoEps: false,
      tasaBonifEssalud: 0.09,
      tasaBonifEps: 0.0675,
    },
    vacaciones: { periodos: [], excluidoIndemnizacion: false },
    remuneracionesPendientes: [],
    gratificacionExtraordinaria: 0,
    indemnizacionDespido: null,
    deducciones: {
      pension: {
        sistema: 'onp',
        tasaOnp: 0.13,
        aportacionObligatoriaAfp: 0.1,
        comisionAfp: 0.016,
        tipoComision: 'flujo',
        primaSeguroAfp: 0.0174,
        topeRemuneracionMaximaAsegurable: 16950,
      },
      quinta: {
        uit: 5350,
        deduccionUit: 7,
        tramos: [
          { hasta: 5 * 5350, tasa: 0.08 },
          { hasta: 20 * 5350, tasa: 0.14 },
          { hasta: 35 * 5350, tasa: 0.17 },
          { hasta: 45 * 5350, tasa: 0.2 },
          { hasta: Infinity, tasa: 0.3 },
        ],
        rentaPagadaEnElAnio: 0,
        retencionesYaEfectuadas: 0,
      },
    },
    ...overrides,
  };
}

describe('calcularLiquidacion (motor de cese)', () => {
  it('renuncia general: CTS trunca + grati trunca con bonificación extraordinaria', () => {
    const r = calcularLiquidacion(inputBase());
    // CTS: computable 3000 + 3000/6 = 3500; fracción 2/6 + 15/180 → 3500×0.41667 = 1458.33
    const cts = r.ingresos.find((l) => l.concepto === 'CTS trunca')!;
    expect(cts.monto).toBeCloseTo(1458.33, 2);
    // Grati trunca: 3000 × 1/6 = 500; bonificación 9% = 45
    const grati = r.ingresos.find((l) => l.concepto === 'Gratificación trunca')!;
    expect(grati.monto).toBe(500);
    const bonif = r.ingresos.find((l) => l.concepto === 'Bonificación extraordinaria (Ley 30334)')!;
    expect(bonif.monto).toBe(45);
    expect(r.totalBruto).toBeCloseTo(1458.33 + 500 + 45, 1);
  });

  it('MYPE micro: CTS y gratificación en 0 (factor 0), vacaciones sí se pagan', () => {
    const r = calcularLiquidacion(
      inputBase({
        regimen: 'mype_micro',
        factorRegimenCtsGrati: 0,
        vacaciones: {
          periodos: [
            {
              periodoInicio: new Date('2026-01-15'),
              periodoFin: new Date('2027-01-14'),
              diasGanados: 15,
              diasGozados: 0,
              estado: 'EN_CURSO',
            },
          ],
          excluidoIndemnizacion: false,
        },
      }),
    );
    expect(r.ingresos.find((l) => l.concepto === 'CTS trunca')).toBeUndefined();
    expect(r.ingresos.find((l) => l.concepto === 'Gratificación trunca')).toBeUndefined();
    expect(r.ingresos.find((l) => l.concepto === 'Vacaciones truncas')!.monto).toBeCloseTo(750, 2);
  });

  it('MYPE pequeña: CTS y grati al 50%', () => {
    const r = calcularLiquidacion(inputBase({ regimen: 'mype_pequena', factorRegimenCtsGrati: 0.5 }));
    expect(r.ingresos.find((l) => l.concepto === 'CTS trunca')!.monto).toBeCloseTo(729.17, 2);
    expect(r.ingresos.find((l) => l.concepto === 'Gratificación trunca')!.monto).toBe(250);
  });

  it('despido arbitrario: agrega la indemnización (inafecta a deducciones)', () => {
    const r = calcularLiquidacion(
      inputBase({
        motivo: 'DESPIDO_ARBITRARIO',
        indemnizacionDespido: {
          tipoContrato: 'indeterminado',
          aniosCompletos: 2,
          mesesAdicionales: 0,
          diasAdicionales: 0,
          mesesRestantesContrato: 0,
          topeRemuneraciones: 12,
          mypeParams: {
            mype_pequena: { diasPorAnio: 20, topeDias: 120 },
            mype_micro: { diasPorAnio: 10, topeDias: 90 },
          },
        },
      }),
    );
    // 1.5 × 3000 × 2 = 9000
    expect(r.ingresos.find((l) => l.concepto === 'Indemnización por despido arbitrario')!.monto).toBe(9000);
    // ONP se calcula solo sobre afectos (aquí: 0 — no hay vacaciones ni pendientes)
    expect(r.deducciones.find((l) => l.concepto.startsWith('Retención ONP'))).toBeUndefined();
  });

  it('mutuo disenso: incluye la gratificación extraordinaria negociada, inafecta', () => {
    const r = calcularLiquidacion(
      inputBase({ motivo: 'MUTUO_DISENSO', gratificacionExtraordinaria: 5000 }),
    );
    expect(
      r.ingresos.find((l) => l.concepto === 'Gratificación extraordinaria por cese')!.monto,
    ).toBe(5000);
  });

  it('matriz de afectación: ONP solo sobre vacaciones + pendientes; 5ta también sobre grati', () => {
    const r = calcularLiquidacion(
      inputBase({
        vacaciones: {
          periodos: [
            {
              periodoInicio: new Date('2025-07-15'),
              periodoFin: new Date('2026-07-14'),
              diasGanados: 30,
              diasGozados: 0,
              estado: 'VENCIDO_PENDIENTE',
            },
          ],
          excluidoIndemnizacion: false,
        },
        remuneracionesPendientes: [{ concepto: 'Sueldo julio (15 días)', monto: 1500 }],
      }),
    );
    // Afecto a pensión: devengadas 3000 + pendientes 1500 = 4500 → ONP 13% = 585
    expect(r.deducciones.find((l) => l.concepto === 'Retención ONP')!.monto).toBe(-585);
    // Afecto a 5ta: 3000 + 1500 + grati 500 + bonif 45 = 5045 < 7 UIT → sin retención
    expect(r.deducciones.find((l) => l.concepto === 'Retención 5ta categoría')).toBeUndefined();
    expect(r.netoPagar).toBeCloseTo(r.totalBruto - 585, 2);
  });

  it('5ta categoría: proyección anual con renta ya pagada, neta de retenciones efectuadas', () => {
    const r = calcularLiquidacion(
      inputBase({
        remuneracionesPendientes: [{ concepto: 'Sueldo julio', monto: 3000 }],
        deducciones: {
          ...inputBase().deducciones,
          quinta: {
            ...inputBase().deducciones.quinta,
            rentaPagadaEnElAnio: 60000,
            retencionesYaEfectuadas: 1500,
          },
        },
      }),
    );
    // Renta anual = 60000 + afectos5ta (3000 + grati 500 + bonif 45) = 63545; neta = 63545 − 37450 = 26095
    // Impuesto: 8% × 26095 = 2087.60; retención = 2087.60 − 1500 = 587.60
    expect(r.deducciones.find((l) => l.concepto === 'Retención 5ta categoría')!.monto).toBeCloseTo(
      -587.6,
      2,
    );
  });

  it('todos los montos redondeados a 2 decimales y el neto cuadra', () => {
    const r = calcularLiquidacion(inputBase());
    for (const linea of [...r.ingresos, ...r.deducciones]) {
      expect(linea.monto).toBeCloseTo(Math.round(linea.monto * 100) / 100, 10);
    }
    const bruto = r.ingresos.reduce((s, l) => s + l.monto, 0);
    const ded = r.deducciones.reduce((s, l) => s + l.monto, 0); // negativos
    expect(r.netoPagar).toBeCloseTo(bruto + ded, 2);
  });
});
