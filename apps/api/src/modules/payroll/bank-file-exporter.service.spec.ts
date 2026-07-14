import { BankFileExporter } from './bank-file-exporter.service';

describe('BankFileExporter.exportarBcp', () => {
  it('genera una linea de telecredito BCP por trabajador con cuenta bancaria', () => {
    const exporter = new BankFileExporter();

    const salida = exporter.exportarBcp([
      { numeroDocumento: '12345678', numeroCuenta: '19112345678901', monto: 2350.5 },
    ]);

    expect(salida).toBe('12345678|19112345678901|2350.50');
  });

  it('excluye trabajadores sin cuenta bancaria y los reporta como error de validacion', () => {
    const exporter = new BankFileExporter();

    expect(() =>
      exporter.exportarBcp([
        { numeroDocumento: '87654321', numeroCuenta: '', monto: 1500 },
      ]),
    ).toThrow(/sin cuenta bancaria/i);
  });

  it('genera multiples lineas cuando hay varios trabajadores', () => {
    const exporter = new BankFileExporter();

    const salida = exporter.exportarBcp([
      { numeroDocumento: '12345678', numeroCuenta: '19112345678901', monto: 2350.5 },
      { numeroDocumento: '87654321', numeroCuenta: '19187654321098', monto: 1800.0 },
    ]);

    expect(salida.split('\n')).toHaveLength(2);
  });

  it('formatea montos con precision de 2 decimales', () => {
    const exporter = new BankFileExporter();

    const salida = exporter.exportarBcp([
      { numeroDocumento: '12345678', numeroCuenta: '19112345678901', monto: 1500.456 },
    ]);

    expect(salida).toContain('1500.46');
  });
});
