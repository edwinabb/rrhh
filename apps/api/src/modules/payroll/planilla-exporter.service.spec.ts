import { PlanillaExporter } from './planilla-exporter.service';

describe('PlanillaExporter.exportarE18', () => {
  it('genera una linea por concepto, separada por "|", con el formato exacto de la Estructura 18', () => {
    const exporter = new PlanillaExporter();

    const salida = exporter.exportarE18([
      {
        tipoDocumento: '01',
        numeroDocumento: '12345678',
        codigoConceptoSunat: '0121', // Alimentacion principal en dinero
        montoDevengado: 100,
        montoPagado: 100,
      },
    ]);

    expect(salida).toBe('01|12345678|0121|100.00|100.00');
  });

  it('genera una linea por cada concepto cuando el trabajador tiene varios', () => {
    const exporter = new PlanillaExporter();

    const salida = exporter.exportarE18([
      {
        tipoDocumento: '01',
        numeroDocumento: '11111111',
        codigoConceptoSunat: '0121',
        montoDevengado: 2000,
        montoPagado: 2000,
      },
      {
        tipoDocumento: '01',
        numeroDocumento: '11111111',
        codigoConceptoSunat: '0201',
        montoDevengado: 113,
        montoPagado: 113,
      },
    ]);

    expect(salida.split('\n')).toHaveLength(2);
  });

  it('rechaza codigos excluidos explicitamente por la Estructura 18 (totales calculados, no declarables)', () => {
    const exporter = new PlanillaExporter();

    expect(() =>
      exporter.exportarE18([
        {
          tipoDocumento: '01',
          numeroDocumento: '11111111',
          codigoConceptoSunat: '0100',
          montoDevengado: 100,
          montoPagado: 100,
        },
      ]),
    ).toThrow(/no se declara/i);
  });

  it('formatea montos con precision de 2 decimales', () => {
    const exporter = new PlanillaExporter();

    const salida = exporter.exportarE18([
      {
        tipoDocumento: '01',
        numeroDocumento: '12345678',
        codigoConceptoSunat: '0121',
        montoDevengado: 100.456,
        montoPagado: 100.999,
      },
    ]);

    expect(salida).toContain('100.46');
    expect(salida).toContain('101.00');
  });
});
