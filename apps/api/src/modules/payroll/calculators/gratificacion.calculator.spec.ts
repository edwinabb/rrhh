import { calcularGratificacion } from './gratificacion.calculator';

describe('calcularGratificacion', () => {
  it('calcula el monto completo para 6 meses trabajados, con bonificacion extraordinaria EsSalud (9%)', () => {
    const resultado = calcularGratificacion({
      sueldo: 2000,
      asignacionFamiliar: 113, // 10% de RMV=1130
      conceptosRemunerativosRegulares: 0,
      mesesCompletos: 6,
      afiliadoEps: false,
      tasaBonifEssalud: 0.09,
      tasaBonifEps: 0.0675,
    });

    const sueldoComputable = 2113; // 2000 + 113
    expect(resultado.montoGratificacion).toBeCloseTo(sueldoComputable, 2);
    expect(resultado.bonificacionExtraordinaria).toBeCloseTo(sueldoComputable * 0.09, 2);
  });

  it('usa la tasa reducida de bonificacion extraordinaria (6.75%) cuando el trabajador esta afiliado a EPS', () => {
    const resultado = calcularGratificacion({
      sueldo: 2000,
      asignacionFamiliar: 0,
      conceptosRemunerativosRegulares: 0,
      mesesCompletos: 6,
      afiliadoEps: true,
      tasaBonifEssalud: 0.09,
      tasaBonifEps: 0.0675,
    });

    expect(resultado.bonificacionExtraordinaria).toBeCloseTo(2000 * 0.0675, 2);
  });

  it('prorratea por meses completos trabajados en el semestre (regimen MYPE con ingreso a mitad de semestre)', () => {
    const resultado = calcularGratificacion({
      sueldo: 1200, // ejemplo de sueldo bajo, tipico de MYPE
      asignacionFamiliar: 0,
      conceptosRemunerativosRegulares: 0,
      mesesCompletos: 3,
      afiliadoEps: false,
      tasaBonifEssalud: 0.09,
      tasaBonifEps: 0.0675,
    });

    const sueldoComputable = 1200;
    expect(resultado.montoGratificacion).toBeCloseTo(sueldoComputable * (3 / 6), 2);
  });
});
