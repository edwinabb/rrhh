import { Inject, Injectable, Optional } from '@nestjs/common';

/**
 * Resultado crudo de una verificación biométrica contra el dispositivo/proveedor.
 */
export interface BiometricMatchResult {
  match: boolean;
  /** Confianza del match, entre 0.0 y 1.0 */
  score: number;
}

/**
 * Contrato que debe cumplir cualquier proveedor biométrico
 * (dispositivo de huella, API de reconocimiento facial, etc.).
 *
 * En MVP se usa MockBiometricProvider; en producción se registra
 * una implementación real bajo el mismo token.
 */
export interface BiometricProvider {
  verificar(employeeId: string, muestra: string): Promise<BiometricMatchResult>;
}

/** Token de inyección para el proveedor biométrico activo. */
export const BIOMETRIC_PROVIDER = 'BIOMETRIC_PROVIDER';

/**
 * Proveedor mock determinístico para MVP y tests.
 *
 * Convención de muestras (base64 simulado):
 * - empieza con "valid" -> match con confianza alta (0.95)
 * - empieza con "weak"  -> match con confianza baja (0.5)
 * - cualquier otra      -> no match (score 0)
 */
@Injectable()
export class MockBiometricProvider implements BiometricProvider {
  private static readonly SCORE_VALIDO = 0.95;
  private static readonly SCORE_DEBIL = 0.5;

  async verificar(_employeeId: string, muestra: string): Promise<BiometricMatchResult> {
    if (muestra.startsWith('valid')) {
      return { match: true, score: MockBiometricProvider.SCORE_VALIDO };
    }
    if (muestra.startsWith('weak')) {
      return { match: true, score: MockBiometricProvider.SCORE_DEBIL };
    }
    return { match: false, score: 0 };
  }
}

/**
 * Resultado normalizado que consume el resto del módulo de asistencia
 * (ej. AttendanceService al validar una marcación con biometría requerida).
 */
export interface BiometricResult {
  valido: boolean;
  /** Confianza reportada por el proveedor, 0.0 a 1.0 */
  confianza: number;
  /** Presente solo cuando la identidad fue verificada */
  employeeId?: string;
  /** Mensaje de error normalizado cuando valido === false */
  error?: string;
}

/**
 * Orquesta la verificación biométrica delegando en el proveedor inyectado
 * y normalizando cualquier error del dispositivo a un BiometricResult,
 * de modo que los consumidores nunca reciban excepciones del hardware.
 */
@Injectable()
export class BiometricIntegrationService {
  private readonly provider: BiometricProvider;

  constructor(
    @Optional() @Inject(BIOMETRIC_PROVIDER) provider?: BiometricProvider,
  ) {
    // Fallback al mock para MVP si el módulo no registra un proveedor real.
    this.provider = provider ?? new MockBiometricProvider();
  }

  /**
   * Verifica la identidad de un empleado contra una muestra biométrica.
   *
   * @param employeeId      id del Employee cuya identidad se verifica
   * @param muestra         captura biométrica (base64) enviada por el cliente
   * @param umbralConfianza parámetro normativo de la configuración del tenant
   *                        (0.0 a 1.0); no se hardcodea aquí para que cada
   *                        tenant defina su propia exigencia
   */
  async verificarIdentidad(
    employeeId: string,
    muestra: string,
    umbralConfianza: number,
  ): Promise<BiometricResult> {
    if (umbralConfianza < 0 || umbralConfianza > 1) {
      return {
        valido: false,
        confianza: 0,
        error: `Umbral de confianza inválido: ${umbralConfianza} (debe estar entre 0 y 1)`,
      };
    }

    if (!muestra || muestra.trim() === '') {
      return {
        valido: false,
        confianza: 0,
        error: 'Muestra biométrica vacía',
      };
    }

    let resultado: BiometricMatchResult;
    try {
      resultado = await this.provider.verificar(employeeId, muestra);
    } catch (err) {
      // Normalización: los fallos del hardware/API externa no deben
      // propagarse como excepciones al flujo de marcación.
      const detalle = err instanceof Error ? err.message : String(err);
      return {
        valido: false,
        confianza: 0,
        error: `Error del dispositivo biométrico: ${detalle}`,
      };
    }

    if (!resultado.match) {
      return {
        valido: false,
        confianza: resultado.score,
        error: 'La muestra biométrica no coincide con la registrada',
      };
    }

    if (resultado.score < umbralConfianza) {
      return {
        valido: false,
        confianza: resultado.score,
        error:
          `Confianza biométrica insuficiente: ${resultado.score.toFixed(2)} ` +
          `(umbral requerido: ${umbralConfianza.toFixed(2)})`,
      };
    }

    return {
      valido: true,
      confianza: resultado.score,
      employeeId,
    };
  }
}
