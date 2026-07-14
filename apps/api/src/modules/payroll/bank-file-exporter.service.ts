import { Injectable } from '@nestjs/common';

/**
 * Genera el archivo de telecrédito para pago masivo de haberes. Primera
 * implementación: BCP (código "002" de Tabla 36, ver
 * anexo2-tablas-parametricas.md). Arquitectura pensada para agregar
 * BBVA/Interbank/Scotiabank sin tocar PayrollRunService — cada banco es un
 * método/clase nueva con su propio layout de archivo.
 */
export interface BankFileRow {
  numeroDocumento: string;
  numeroCuenta: string;
  monto: number;
}

@Injectable()
export class BankFileExporter {
  exportarBcp(filas: BankFileRow[]): string {
    return filas
      .map((fila) => {
        if (!fila.numeroCuenta) {
          throw new Error(
            `Trabajador ${fila.numeroDocumento} sin cuenta bancaria registrada — no se puede incluir en el telecrédito`,
          );
        }
        return [fila.numeroDocumento, fila.numeroCuenta, fila.monto.toFixed(2)].join('|');
      })
      .join('\n');
  }
}
