import {
  BiometricIntegrationService,
  BiometricProvider,
  MockBiometricProvider,
} from './biometric-integration.service';

describe('MockBiometricProvider', () => {
  const provider = new MockBiometricProvider();

  it('devuelve match con confianza alta (0.95) para muestras que empiezan con "valid"', async () => {
    const resultado = await provider.verificar('emp-1', 'valid-huella-base64');
    expect(resultado.match).toBe(true);
    expect(resultado.score).toBe(0.95);
  });

  it('devuelve match débil (0.5) para muestras que empiezan con "weak"', async () => {
    const resultado = await provider.verificar('emp-1', 'weak-huella-base64');
    expect(resultado.match).toBe(true);
    expect(resultado.score).toBe(0.5);
  });

  it('devuelve no-match (score 0) para cualquier otra muestra', async () => {
    const resultado = await provider.verificar('emp-1', 'garbage-data');
    expect(resultado.match).toBe(false);
    expect(resultado.score).toBe(0);
  });

  it('es determinístico: la misma muestra produce siempre el mismo resultado', async () => {
    const a = await provider.verificar('emp-1', 'valid-xyz');
    const b = await provider.verificar('emp-1', 'valid-xyz');
    expect(a).toEqual(b);
  });
});

describe('BiometricIntegrationService', () => {
  const UMBRAL = 0.8; // umbral de confianza normativo, provisto por la configuración del tenant

  const crearServicio = (provider: BiometricProvider) =>
    new BiometricIntegrationService(provider);

  it('acepta la identidad cuando el provider hace match con score >= umbral', async () => {
    const service = crearServicio(new MockBiometricProvider());

    const resultado = await service.verificarIdentidad('emp-1', 'valid-huella', UMBRAL);

    expect(resultado.valido).toBe(true);
    expect(resultado.confianza).toBe(0.95);
    expect(resultado.employeeId).toBe('emp-1');
    expect(resultado.error).toBeUndefined();
  });

  it('rechaza cuando el score está por debajo del umbral aunque haya match', async () => {
    const service = crearServicio(new MockBiometricProvider());

    const resultado = await service.verificarIdentidad('emp-1', 'weak-huella', UMBRAL);

    expect(resultado.valido).toBe(false);
    expect(resultado.confianza).toBe(0.5);
    expect(resultado.error).toContain('Confianza biométrica insuficiente');
  });

  it('rechaza cuando el provider no encuentra match', async () => {
    const service = crearServicio(new MockBiometricProvider());

    const resultado = await service.verificarIdentidad('emp-1', 'otra-cosa', UMBRAL);

    expect(resultado.valido).toBe(false);
    expect(resultado.confianza).toBe(0);
    expect(resultado.error).toContain('no coincide');
  });

  it('normaliza errores del dispositivo: si el provider lanza, devuelve resultado inválido sin propagar la excepción', async () => {
    const providerConFalla: BiometricProvider = {
      verificar: jest.fn().mockRejectedValue(new Error('device timeout')),
    };
    const service = crearServicio(providerConFalla);

    const resultado = await service.verificarIdentidad('emp-1', 'valid-huella', UMBRAL);

    expect(resultado.valido).toBe(false);
    expect(resultado.confianza).toBe(0);
    expect(resultado.error).toContain('Error del dispositivo biométrico');
    expect(resultado.error).toContain('device timeout');
  });

  it('rechaza muestras vacías sin invocar al provider', async () => {
    const providerEspiado: BiometricProvider = { verificar: jest.fn() };
    const service = crearServicio(providerEspiado);

    const resultado = await service.verificarIdentidad('emp-1', '', UMBRAL);

    expect(resultado.valido).toBe(false);
    expect(resultado.error).toContain('Muestra biométrica vacía');
    expect(providerEspiado.verificar).not.toHaveBeenCalled();
  });

  it('rechaza umbrales fuera del rango [0, 1] como error de configuración', async () => {
    const providerEspiado: BiometricProvider = { verificar: jest.fn() };
    const service = crearServicio(providerEspiado);

    const resultado = await service.verificarIdentidad('emp-1', 'valid-huella', 1.5);

    expect(resultado.valido).toBe(false);
    expect(resultado.error).toContain('Umbral de confianza inválido');
    expect(providerEspiado.verificar).not.toHaveBeenCalled();
  });
});
