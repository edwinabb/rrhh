import {
  PayrollExportMapperService,
  ConceptoCalculado,
  PlanillaDetalleRow,
} from './payroll-export-mapper.service';

const conceptos: ConceptoCalculado[] = [
  { codigo: '0121', nombre: 'Remuneracion basica', monto: 2000 },
  { codigo: '0201', nombre: 'Asignacion familiar', monto: 113 },
];

function crearTxConConfig(config: any) {
  return {
    tenantPayrollExportConfig: {
      findUnique: jest.fn().mockResolvedValue(config),
    },
  };
}

describe('PayrollExportMapperService', () => {
  let service: PayrollExportMapperService;

  beforeEach(() => {
    service = new PayrollExportMapperService();
  });

  describe('mapearConceptosA18', () => {
    it('en modo devengado_igual_pagado el monto pagado es igual al devengado', () => {
      const filas = service.mapearConceptosA18(
        conceptos,
        '01',
        '12345678',
        'devengado_igual_pagado',
      );

      expect(filas).toHaveLength(2);
      expect(filas[0]).toEqual({
        tipoDocumento: '01',
        numeroDocumento: '12345678',
        codigoConceptoSunat: '0121',
        montoDevengado: 2000,
        montoPagado: 2000,
      });
      expect(filas[1]!.montoDevengado).toBe(113);
      expect(filas[1]!.montoPagado).toBe(113);
    });

    it('en modo devengado_con_descuentos el monto pagado es el 95% del devengado', () => {
      const filas = service.mapearConceptosA18(
        conceptos,
        '01',
        '12345678',
        'devengado_con_descuentos',
      );

      expect(filas[0]!.montoDevengado).toBe(2000);
      expect(filas[0]!.montoPagado).toBeCloseTo(1900, 6);
      expect(filas[1]!.montoDevengado).toBe(113);
      expect(filas[1]!.montoPagado).toBeCloseTo(107.35, 6);
    });

    it('trata cualquier montoMode desconocido como devengado_igual_pagado', () => {
      const filas = service.mapearConceptosA18(
        conceptos,
        '01',
        '12345678',
        'modo_inexistente',
      );

      expect(filas[0]!.montoPagado).toBe(filas[0]!.montoDevengado);
      expect(filas[1]!.montoPagado).toBe(filas[1]!.montoDevengado);
    });

    it('retorna un arreglo vacio cuando no hay conceptos', () => {
      const filas = service.mapearConceptosA18(
        [],
        '01',
        '12345678',
        'devengado_con_descuentos',
      );

      expect(filas).toEqual([]);
    });

    it('propaga tipoDocumento y numeroDocumento a todas las filas generadas', () => {
      const filas = service.mapearConceptosA18(
        conceptos,
        '04',
        'CE998877',
        'devengado_igual_pagado',
      );

      expect(filas.every((f) => f.tipoDocumento === '04')).toBe(true);
      expect(filas.every((f) => f.numeroDocumento === 'CE998877')).toBe(true);
    });

    it('mantiene montos en cero sin alterarlos en ningun modo', () => {
      const enCero: ConceptoCalculado[] = [
        { codigo: '0999', nombre: 'Concepto sin monto', monto: 0 },
      ];

      const igual = service.mapearConceptosA18(
        enCero,
        '01',
        '12345678',
        'devengado_igual_pagado',
      );
      const conDescuentos = service.mapearConceptosA18(
        enCero,
        '01',
        '12345678',
        'devengado_con_descuentos',
      );

      expect(igual[0]!.montoPagado).toBe(0);
      expect(conDescuentos[0]!.montoDevengado).toBe(0);
      expect(conDescuentos[0]!.montoPagado).toBe(0);
    });
  });

  describe('filtrarConceptosExcluidos', () => {
    const filas: PlanillaDetalleRow[] = [
      {
        tipoDocumento: '01',
        numeroDocumento: '12345678',
        codigoConceptoSunat: '0121',
        montoDevengado: 2000,
        montoPagado: 2000,
      },
      {
        tipoDocumento: '01',
        numeroDocumento: '12345678',
        codigoConceptoSunat: '0700',
        montoDevengado: 2113,
        montoPagado: 2113,
      },
    ];

    it('elimina las filas cuyo codigo esta en la lista de excluidos', () => {
      const resultado = service.filtrarConceptosExcluidos(filas, ['0700']);

      expect(resultado).toHaveLength(1);
      expect(resultado[0]!.codigoConceptoSunat).toBe('0121');
    });

    it('retorna las filas sin cambios cuando la lista de excluidos esta vacia', () => {
      const resultado = service.filtrarConceptosExcluidos(filas, []);

      expect(resultado).toBe(filas);
      expect(resultado).toHaveLength(2);
    });

    it('retorna un arreglo vacio cuando todos los codigos estan excluidos', () => {
      const resultado = service.filtrarConceptosExcluidos(filas, [
        '0121',
        '0700',
      ]);

      expect(resultado).toEqual([]);
    });

    it('ignora codigos excluidos que no aparecen en las filas', () => {
      const resultado = service.filtrarConceptosExcluidos(filas, ['9999']);

      expect(resultado).toHaveLength(2);
    });

    it('no muta el arreglo original al filtrar', () => {
      const copia = [...filas];
      service.filtrarConceptosExcluidos(filas, ['0700']);

      expect(filas).toEqual(copia);
      expect(filas).toHaveLength(2);
    });
  });

  describe('obtenerConfig', () => {
    it('retorna la configuracion existente del tenant', async () => {
      const guardada = {
        tenantId: 'tenant-1',
        montoMode: 'devengado_con_descuentos',
        formatoExportar: 'csv',
        conceptosExcluidos: ['0700'],
        camposSensibles: ['numeroCuenta'],
      };
      const tx = crearTxConConfig(guardada);

      const config = await service.obtenerConfig(tx, 'tenant-1');

      expect(config).toEqual(guardada);
      expect(tx.tenantPayrollExportConfig.findUnique).toHaveBeenCalledWith({
        where: { tenantId: 'tenant-1' },
      });
    });

    it('retorna los defaults cuando el tenant no tiene configuracion', async () => {
      const tx = crearTxConConfig(null);

      const config = await service.obtenerConfig(tx, 'tenant-sin-config');

      expect(config).toEqual({
        montoMode: 'devengado_igual_pagado',
        formatoExportar: 'pipe',
        conceptosExcluidos: [],
        camposSensibles: [],
      });
    });

    it('retorna los defaults cuando findUnique resuelve undefined', async () => {
      const tx = crearTxConConfig(undefined);

      const config = await service.obtenerConfig(tx, 'tenant-x');

      expect(config.montoMode).toBe('devengado_igual_pagado');
      expect(config.formatoExportar).toBe('pipe');
      expect(config.conceptosExcluidos).toEqual([]);
      expect(config.camposSensibles).toEqual([]);
    });

    it('los defaults se integran con el mapeo y el filtrado sin excluir nada', async () => {
      const tx = crearTxConConfig(null);

      const config = await service.obtenerConfig(tx, 'tenant-sin-config');
      const filas = service.mapearConceptosA18(
        conceptos,
        '01',
        '12345678',
        config.montoMode,
      );
      const resultado = service.filtrarConceptosExcluidos(
        filas,
        config.conceptosExcluidos,
      );

      expect(resultado).toHaveLength(2);
      expect(resultado[0]!.montoPagado).toBe(resultado[0]!.montoDevengado);
    });
  });
});
