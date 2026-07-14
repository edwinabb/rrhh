import {
  distanciaMetros,
  validarMarcacion,
  ValidarMarcacionInput,
} from './marcacion.calculator';

// Coordenadas de referencia: Plaza de Armas de Lima
const SEDE_LAT = -12.0464;
const SEDE_LNG = -77.0428;

const geofenceBase = {
  latitud: SEDE_LAT,
  longitud: SEDE_LNG,
  radioMetros: 100,
};

// Configuración del tenant: todos los umbrales llegan como parámetros
const configBase = {
  requiereGeofencing: true,
  permitirFueraGeofence: false,
  requiereBiometria: true,
  umbralConfianzaBiometria: 0.8,
  horaEntradaEstandar: '08:00',
  toleranciaMinutos: 15,
};

function inputBase(overrides: Partial<ValidarMarcacionInput> = {}): ValidarMarcacionInput {
  return {
    tipo: 'ENTRADA',
    timestamp: new Date('2026-07-14T08:05:00'),
    latitud: SEDE_LAT,
    longitud: SEDE_LNG,
    scoreBiometria: 0.95,
    tieneEntradaPendiente: false,
    geofence: geofenceBase,
    config: configBase,
    ...overrides,
  };
}

describe('distanciaMetros (Haversine)', () => {
  it('retorna ~0 para coordenadas idénticas', () => {
    const d = distanciaMetros(SEDE_LAT, SEDE_LNG, SEDE_LAT, SEDE_LNG);
    expect(d).toBeCloseTo(0, 3);
  });

  it('calcula ~111 metros para 0.001 grados de latitud de diferencia', () => {
    // 1 grado de latitud ≈ 111.19 km sobre el radio medio terrestre
    const d = distanciaMetros(SEDE_LAT, SEDE_LNG, SEDE_LAT + 0.001, SEDE_LNG);
    expect(d).toBeGreaterThan(105);
    expect(d).toBeLessThan(115);
  });

  it('calcula distancia de varios km entre Lima Centro y San Isidro', () => {
    const d = distanciaMetros(-12.0464, -77.0428, -12.0936, -77.0337);
    expect(d).toBeGreaterThan(4000);
    expect(d).toBeLessThan(7000);
  });

  it('es simétrica (distancia A→B = B→A)', () => {
    const ida = distanciaMetros(-12.0464, -77.0428, -12.0936, -77.0337);
    const vuelta = distanciaMetros(-12.0936, -77.0337, -12.0464, -77.0428);
    expect(ida).toBeCloseTo(vuelta, 6);
  });
});

describe('validarMarcacion — geofencing', () => {
  it('valida ubicación cuando la marcación está dentro del radio del geofence', () => {
    const r = validarMarcacion(inputBase());

    expect(r.ubicacionValidada).toBe(true);
    expect(r.bloqueado).toBe(false);
    expect(r.requiereAutorizacion).toBe(false);
    expect(r.distanciaMetros).not.toBeNull();
    expect(r.distanciaMetros!).toBeLessThanOrEqual(geofenceBase.radioMetros);
  });

  it('bloquea la marcación fuera del geofence cuando la config no lo permite', () => {
    // ~0.01 grados ≈ 1.1 km del centro de la sede
    const r = validarMarcacion(
      inputBase({ latitud: SEDE_LAT + 0.01, longitud: SEDE_LNG }),
    );

    expect(r.ubicacionValidada).toBe(false);
    expect(r.bloqueado).toBe(true);
    expect(r.motivoBloqueo).toContain('fuera');
    expect(r.requiereAutorizacion).toBe(false);
  });

  it('permite marcación fuera del geofence con autorización si la config lo habilita', () => {
    const r = validarMarcacion(
      inputBase({
        latitud: SEDE_LAT + 0.01,
        longitud: SEDE_LNG,
        config: { ...configBase, permitirFueraGeofence: true },
      }),
    );

    expect(r.ubicacionValidada).toBe(false);
    expect(r.bloqueado).toBe(false);
    expect(r.requiereAutorizacion).toBe(true);
  });

  it('bloquea si el geofencing es requerido y no llegan coordenadas', () => {
    const r = validarMarcacion(
      inputBase({ latitud: undefined, longitud: undefined }),
    );

    expect(r.bloqueado).toBe(true);
    expect(r.motivoBloqueo).toContain('coordenadas');
  });

  it('no exige ubicación cuando el geofencing está deshabilitado en la config', () => {
    const r = validarMarcacion(
      inputBase({
        latitud: undefined,
        longitud: undefined,
        geofence: undefined,
        config: { ...configBase, requiereGeofencing: false },
      }),
    );

    expect(r.bloqueado).toBe(false);
    expect(r.ubicacionValidada).toBe(true);
    expect(r.distanciaMetros).toBeNull();
  });
});

describe('validarMarcacion — biometría', () => {
  it('requiere autorización manual cuando el score biométrico está bajo el umbral', () => {
    const r = validarMarcacion(inputBase({ scoreBiometria: 0.6 }));

    expect(r.bloqueado).toBe(false);
    expect(r.requiereAutorizacion).toBe(true);
    expect(r.motivosAutorizacion.join(' ')).toContain('biom');
  });

  it('acepta score biométrico igual al umbral (límite inclusivo)', () => {
    const r = validarMarcacion(inputBase({ scoreBiometria: 0.8 }));

    expect(r.bloqueado).toBe(false);
    expect(r.requiereAutorizacion).toBe(false);
  });

  it('bloquea si la biometría es requerida y no llega score', () => {
    const r = validarMarcacion(inputBase({ scoreBiometria: undefined }));

    expect(r.bloqueado).toBe(true);
    expect(r.motivoBloqueo).toContain('Biometr');
  });

  it('no exige biometría cuando la config no la requiere', () => {
    const r = validarMarcacion(
      inputBase({
        scoreBiometria: undefined,
        config: { ...configBase, requiereBiometria: false },
      }),
    );

    expect(r.bloqueado).toBe(false);
    expect(r.requiereAutorizacion).toBe(false);
  });
});

describe('validarMarcacion — secuencia entrada/salida', () => {
  it('bloquea una doble ENTRADA (ya existe una entrada sin salida el mismo día)', () => {
    const r = validarMarcacion(inputBase({ tieneEntradaPendiente: true }));

    expect(r.bloqueado).toBe(true);
    expect(r.motivoBloqueo).toContain('entrada');
  });

  it('bloquea una SALIDA sin ENTRADA previa el mismo día', () => {
    const r = validarMarcacion(
      inputBase({
        tipo: 'SALIDA',
        timestamp: new Date('2026-07-14T17:00:00'),
        tieneEntradaPendiente: false,
      }),
    );

    expect(r.bloqueado).toBe(true);
    expect(r.motivoBloqueo).toContain('SALIDA');
  });

  it('acepta una SALIDA con ENTRADA previa pendiente el mismo día', () => {
    const r = validarMarcacion(
      inputBase({
        tipo: 'SALIDA',
        timestamp: new Date('2026-07-14T17:00:00'),
        tieneEntradaPendiente: true,
      }),
    );

    expect(r.bloqueado).toBe(false);
  });
});

describe('validarMarcacion — tardanza', () => {
  it('no marca tardanza si la entrada está dentro de la tolerancia', () => {
    // Hora estándar 08:00, tolerancia 15 min → 08:14 no es tardanza
    const r = validarMarcacion(
      inputBase({ timestamp: new Date('2026-07-14T08:14:00') }),
    );

    expect(r.tardanzaMinutos).toBe(0);
    expect(r.bloqueado).toBe(false);
  });

  it('no marca tardanza justo en el límite de la tolerancia (08:15 inclusive)', () => {
    const r = validarMarcacion(
      inputBase({ timestamp: new Date('2026-07-14T08:15:00') }),
    );

    expect(r.tardanzaMinutos).toBe(0);
  });

  it('calcula los minutos de tardanza cuando la entrada excede la tolerancia', () => {
    // 08:27 con estándar 08:00 + 15 de tolerancia → 12 minutos de tardanza
    const r = validarMarcacion(
      inputBase({ timestamp: new Date('2026-07-14T08:27:00') }),
    );

    expect(r.tardanzaMinutos).toBe(12);
    expect(r.bloqueado).toBe(false);
  });

  it('no calcula tardanza para marcaciones de SALIDA', () => {
    const r = validarMarcacion(
      inputBase({
        tipo: 'SALIDA',
        timestamp: new Date('2026-07-14T18:30:00'),
        tieneEntradaPendiente: true,
      }),
    );

    expect(r.tardanzaMinutos).toBe(0);
  });

  it('respeta una tolerancia distinta configurada por el tenant', () => {
    const r = validarMarcacion(
      inputBase({
        timestamp: new Date('2026-07-14T08:27:00'),
        config: { ...configBase, toleranciaMinutos: 30 },
      }),
    );

    expect(r.tardanzaMinutos).toBe(0);
  });
});

describe('validarMarcacion — combinación de validaciones', () => {
  it('acumula múltiples motivos de autorización (fuera de geofence permitido + biometría baja)', () => {
    const r = validarMarcacion(
      inputBase({
        latitud: SEDE_LAT + 0.01,
        scoreBiometria: 0.5,
        config: { ...configBase, permitirFueraGeofence: true },
      }),
    );

    expect(r.bloqueado).toBe(false);
    expect(r.requiereAutorizacion).toBe(true);
    expect(r.motivosAutorizacion.length).toBeGreaterThanOrEqual(2);
  });

  it('el bloqueo tiene prioridad: una marcación bloqueada no queda como requiereAutorizacion', () => {
    // Fuera de geofence (no permitido) + biometría baja → bloqueada
    const r = validarMarcacion(
      inputBase({ latitud: SEDE_LAT + 0.01, scoreBiometria: 0.5 }),
    );

    expect(r.bloqueado).toBe(true);
    expect(r.requiereAutorizacion).toBe(false);
  });

  it('no muta el input (función pura)', () => {
    const input = inputBase();
    const copia = JSON.parse(JSON.stringify(input));

    validarMarcacion(input);

    expect(JSON.parse(JSON.stringify(input))).toEqual(copia);
  });
});
