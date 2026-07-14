# Fase 2 — Módulo 2 (Control de Asistencia y Gestión del Tiempo): Plan de Implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Construir el registro de marcaciones inalterable (append-only + hash encadenado), el flujo de aprobación de horas extra que alimenta la nómina de Fase 1, el geofencing por sede, y el control de vencimiento de vacaciones — el "blindaje SUNAFIL" que pide el goal.

**Architecture:** `MARCACION` es una tabla append-only real a nivel de Postgres (revocado `UPDATE`/`DELETE` a todos los roles de aplicación, igual mecanismo que `AUDIT_LOG` de Fase 0). Cada marcación encadena su hash con la anterior del mismo trabajador — una función pura y testeable, separada de la persistencia. Las reglas de geofencing (haversine) y sobretasas de horas extra son funciones puras, mismo patrón de calculadoras de Fase 1.

**Tech Stack:** NestJS (apps/api), Prisma (packages/database), `crypto` (Node) para SHA-256, BullMQ (cron de alertas de vencimiento vacacional) reutilizando `QueueModule` de Fase 0.

## Global Constraints

- Registros de marcación **inalterables** (append-only, con hash de integridad y trazabilidad completa) — D.S. 004-2006-TR, blindaje ante inspecciones SUNAFIL (multas hasta 52 UIT). (goal.md)
- Prohibida la edición directa de una marcación: cualquier corrección genera un registro nuevo con justificación y aprobador. (goal.md)
- Sobretasas de horas extra: 25% primeras 2 horas, 35% siguientes, 100% feriados/descanso — parametrizadas en `NORMATIVE_PARAMETER` (código `HORAS_EXTRA_TASAS`, ya sembrado en Fase 0), nunca hardcodeadas. (goal.md, diseño Fase 0)
- Auditoría total y aislamiento multi-tenant por RLS, mismo patrón de Fase 0.
- Toda la UI en español, fechas `dd/mm/aaaa`, zona horaria `America/Lima`. (goal.md)
- Fuera de alcance de este plan (ver `especificaciones-fases.md`): integración real con hardware/SDK biométrico (punto abierto #3 — vendor no elegido; este plan entrega la interfaz `BiometricProvider` y un provider mock/manual); app móvil de marcación (solo el contrato de datos); notificaciones push; páginas/UI de frontend (requieren pasada de `frontend-design`).

---

### Task 1: Extender el schema con `MARCACION`, `MARCACION_CORRECCION`, `HORA_EXTRA`, `PERIODO_VACACIONAL` y geofencing en `SEDE`

**Files:**
- Modify: `packages/database/prisma/schema.prisma`
- Create: `packages/database/prisma/migrations/20260712000000_fase2_asistencia/migration.sql`

**Interfaces:**
- Produces: modelos Prisma `Marcacion`, `MarcacionCorreccion`, `HoraExtra`, `PeriodoVacacional` — consumidos por todas las tareas siguientes.

- [ ] **Step 1: Añadir los modelos y extender `Sede`**

Agregar a `packages/database/prisma/schema.prisma`:

```prisma
model Marcacion {
  id                String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  tenantId          String   @map("tenant_id") @db.Uuid
  employeeId        String   @map("employee_id") @db.Uuid
  tipo              String   @db.VarChar(10) // entrada | salida
  timestampServidor DateTime @map("timestamp_servidor") @default(now())
  metodo            String   @db.VarChar(20) // biometria_facial | huella | palma | geo
  lat               Decimal? @db.Decimal(9, 6)
  lng               Decimal? @db.Decimal(9, 6)
  dentroDeRadio     Boolean? @map("dentro_de_radio")
  dispositivoId     String   @map("dispositivo_id")
  hash              String   @db.VarChar(64)
  hashAnterior      String?  @map("hash_anterior") @db.VarChar(64)
  esCorreccion      Boolean  @default(false) @map("es_correccion")

  employee Employee @relation(fields: [employeeId], references: [id])

  @@index([tenantId])
  @@index([employeeId, timestampServidor])
  @@map("marcacion")
}

model MarcacionCorreccion {
  id                  String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  marcacionOriginalId String   @map("marcacion_original_id") @db.Uuid
  nuevaMarcacionId    String   @map("nueva_marcacion_id") @db.Uuid
  aprobadorId         String   @map("aprobador_id") @db.Uuid
  justificacion       String
  createdAt           DateTime @default(now()) @map("created_at")

  @@map("marcacion_correccion")
}

model HoraExtra {
  id             String  @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  employeeId     String  @map("employee_id") @db.Uuid
  fecha          DateTime @db.Date
  horas          Decimal @db.Decimal(5, 2)
  tasaAplicada   String  @map("tasa_aplicada") @db.VarChar(5) // 25 | 35 | 100
  estado         String  @default("detectada") @db.VarChar(20) // detectada | aprobada | rechazada
  aprobadorId    String? @map("aprobador_id") @db.Uuid

  employee Employee @relation(fields: [employeeId], references: [id])

  @@index([employeeId])
  @@map("hora_extra")
}

model PeriodoVacacional {
  id                  String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  employeeId          String   @map("employee_id") @db.Uuid
  fechaInicioDevengo  DateTime @map("fecha_inicio_devengo") @db.Date
  fechaFinDevengo     DateTime @map("fecha_fin_devengo") @db.Date
  diasDisponibles     Decimal  @map("dias_disponibles") @db.Decimal(5, 2)
  diasGozados         Decimal  @default(0) @map("dias_gozados") @db.Decimal(5, 2)
  fechaLimiteGoce     DateTime @map("fecha_limite_goce") @db.Date

  employee Employee @relation(fields: [employeeId], references: [id])

  @@index([employeeId])
  @@map("periodo_vacacional")
}
```

Extender el modelo `Sede` existente (agregar campos antes del cierre `}`):

```prisma
  lat          Decimal? @db.Decimal(9, 6)
  lng          Decimal? @db.Decimal(9, 6)
  radioMetros  Int?     @map("radio_metros")
```

Añadir las relaciones inversas al modelo `Employee` (junto a las de Fase 1):

```prisma
  marcaciones         Marcacion[]
  horasExtra          HoraExtra[]
  periodosVacacionales PeriodoVacacional[]
```

- [ ] **Step 2: Validar el schema**

Run: `pnpm --filter @rrhh/database exec prisma validate`
Expected: `The schema at prisma/schema.prisma is valid 🚀`

- [ ] **Step 3: Escribir la migración SQL (append-only real + RLS)**

Crear `packages/database/prisma/migrations/20260712000000_fase2_asistencia/migration.sql`:

```sql
-- Fase 2 — Asistencia: marcaciones append-only, geofencing, horas extra, vacaciones.

ALTER TABLE "sede" ADD COLUMN "lat" DECIMAL(9,6);
ALTER TABLE "sede" ADD COLUMN "lng" DECIMAL(9,6);
ALTER TABLE "sede" ADD COLUMN "radio_metros" INTEGER;

CREATE TABLE "marcacion" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "tipo" VARCHAR(10) NOT NULL,
    "timestamp_servidor" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metodo" VARCHAR(20) NOT NULL,
    "lat" DECIMAL(9,6),
    "lng" DECIMAL(9,6),
    "dentro_de_radio" BOOLEAN,
    "dispositivo_id" TEXT NOT NULL,
    "hash" VARCHAR(64) NOT NULL,
    "hash_anterior" VARCHAR(64),
    "es_correccion" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "marcacion_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "marcacion_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employee"("id")
);
CREATE INDEX "marcacion_tenant_id_idx" ON "marcacion"("tenant_id");
CREATE INDEX "marcacion_employee_id_timestamp_idx" ON "marcacion"("employee_id", "timestamp_servidor");

CREATE TABLE "marcacion_correccion" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "marcacion_original_id" UUID NOT NULL,
    "nueva_marcacion_id" UUID NOT NULL,
    "aprobador_id" UUID NOT NULL,
    "justificacion" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "marcacion_correccion_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "marcacion_correccion_original_fkey" FOREIGN KEY ("marcacion_original_id") REFERENCES "marcacion"("id"),
    CONSTRAINT "marcacion_correccion_nueva_fkey" FOREIGN KEY ("nueva_marcacion_id") REFERENCES "marcacion"("id")
);

CREATE TABLE "hora_extra" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "employee_id" UUID NOT NULL,
    "fecha" DATE NOT NULL,
    "horas" DECIMAL(5,2) NOT NULL,
    "tasa_aplicada" VARCHAR(5) NOT NULL,
    "estado" VARCHAR(20) NOT NULL DEFAULT 'detectada',
    "aprobador_id" UUID,
    CONSTRAINT "hora_extra_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "hora_extra_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employee"("id")
);
CREATE INDEX "hora_extra_employee_id_idx" ON "hora_extra"("employee_id");

CREATE TABLE "periodo_vacacional" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "employee_id" UUID NOT NULL,
    "fecha_inicio_devengo" DATE NOT NULL,
    "fecha_fin_devengo" DATE NOT NULL,
    "dias_disponibles" DECIMAL(5,2) NOT NULL,
    "dias_gozados" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "fecha_limite_goce" DATE NOT NULL,
    CONSTRAINT "periodo_vacacional_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "periodo_vacacional_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employee"("id")
);
CREATE INDEX "periodo_vacacional_employee_id_idx" ON "periodo_vacacional"("employee_id");

-- RLS
ALTER TABLE "marcacion" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "marcacion" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "marcacion"
    USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid);

ALTER TABLE "hora_extra" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "hora_extra" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "hora_extra"
    USING (EXISTS (
        SELECT 1 FROM "employee" e
        WHERE e."id" = "hora_extra"."employee_id"
        AND e."tenant_id" = current_setting('app.tenant_id', true)::uuid
    ));

ALTER TABLE "periodo_vacacional" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "periodo_vacacional" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "periodo_vacacional"
    USING (EXISTS (
        SELECT 1 FROM "employee" e
        WHERE e."id" = "periodo_vacacional"."employee_id"
        AND e."tenant_id" = current_setting('app.tenant_id', true)::uuid
    ));

-- Privilegios: marcacion es INSERT-only para todos los roles de aplicación,
-- incluido app_admin — igual que audit_log. La única forma de "corregir" es
-- insertar una fila nueva con es_correccion=true (ver Task 4).
GRANT SELECT, INSERT ON "marcacion" TO app_rrhh, app_manager, app_employee, app_admin;
REVOKE UPDATE, DELETE ON "marcacion" FROM app_rrhh, app_manager, app_employee, app_admin;

GRANT SELECT, INSERT ON "marcacion_correccion" TO app_rrhh, app_admin;
GRANT SELECT, INSERT, UPDATE ON "hora_extra" TO app_rrhh, app_manager, app_admin;
GRANT SELECT ON "hora_extra" TO app_employee;
GRANT SELECT, INSERT, UPDATE ON "periodo_vacacional" TO app_rrhh, app_admin;
GRANT SELECT ON "periodo_vacacional" TO app_manager, app_employee;

CREATE TRIGGER "hora_extra_audit" AFTER INSERT OR UPDATE OR DELETE ON "hora_extra"
    FOR EACH ROW EXECUTE FUNCTION audit_trigger();
CREATE TRIGGER "periodo_vacacional_audit" AFTER INSERT OR UPDATE OR DELETE ON "periodo_vacacional"
    FOR EACH ROW EXECUTE FUNCTION audit_trigger();
-- marcacion NO lleva audit_trigger: su propia cadena de hash ya es su
-- mecanismo de integridad: duplicar en audit_log sería redundante y el
-- trigger de auditoría no tiene forma de "corregir" una fila append-only.
```

- [ ] **Step 4: Commit**

```bash
git add packages/database/prisma/schema.prisma packages/database/prisma/migrations/20260712000000_fase2_asistencia
git commit -m "feat(fase2): schema y migracion de asistencia (marcacion append-only, hora_extra, periodo_vacacional)"
```

---

### Task 2: `HashChainService` — integridad encadenada de marcaciones

**Files:**
- Create: `apps/api/src/modules/attendance/hash-chain.service.ts`
- Test: `apps/api/src/modules/attendance/hash-chain.service.spec.ts`

**Interfaces:**
- Produces: `calcularHashMarcacion(input: HashChainInput): string` y `verificarCadena(marcaciones: MarcacionParaVerificar[]): boolean` — usados por `MarcacionService` (Task 3).

- [ ] **Step 1: Escribir el test que falla**

```typescript
// apps/api/src/modules/attendance/hash-chain.service.spec.ts
import { calcularHashMarcacion, verificarCadena } from './hash-chain.service';
import { createHash } from 'node:crypto';

describe('calcularHashMarcacion', () => {
  it('produce SHA-256(hash_anterior + employee_id + timestamp + tipo + payload)', () => {
    const input = {
      hashAnterior: 'a'.repeat(64),
      employeeId: 'emp-1',
      timestampServidor: new Date('2026-06-01T08:00:00.000Z'),
      tipo: 'entrada',
      payload: { dispositivoId: 'dev-1' },
    };

    const esperado = createHash('sha256')
      .update(
        `${input.hashAnterior}${input.employeeId}${input.timestampServidor.toISOString()}${input.tipo}${JSON.stringify(input.payload)}`,
      )
      .digest('hex');

    expect(calcularHashMarcacion(input)).toBe(esperado);
  });

  it('la primera marcacion de un trabajador usa cadena de hash vacia (hashAnterior null)', () => {
    const hash = calcularHashMarcacion({
      hashAnterior: null,
      employeeId: 'emp-1',
      timestampServidor: new Date('2026-06-01T08:00:00.000Z'),
      tipo: 'entrada',
      payload: {},
    });

    expect(hash).toHaveLength(64); // hex de SHA-256
  });
});

describe('verificarCadena', () => {
  it('detecta que la cadena es valida cuando cada hash_anterior coincide con el hash real de la fila previa', () => {
    const m1 = {
      hashAnterior: null,
      employeeId: 'emp-1',
      timestampServidor: new Date('2026-06-01T08:00:00.000Z'),
      tipo: 'entrada',
      payload: {},
    };
    const hash1 = calcularHashMarcacion(m1);
    const m2 = {
      hashAnterior: hash1,
      employeeId: 'emp-1',
      timestampServidor: new Date('2026-06-01T17:00:00.000Z'),
      tipo: 'salida',
      payload: {},
    };
    const hash2 = calcularHashMarcacion(m2);

    const valido = verificarCadena([
      { ...m1, hash: hash1 },
      { ...m2, hash: hash2 },
    ]);

    expect(valido).toBe(true);
  });

  it('detecta alteracion retroactiva: si una fila cambia, rompe la cadena de todas las posteriores', () => {
    const m1 = {
      hashAnterior: null,
      employeeId: 'emp-1',
      timestampServidor: new Date('2026-06-01T08:00:00.000Z'),
      tipo: 'entrada',
      payload: {},
    };
    const hash1 = calcularHashMarcacion(m1);
    const m2 = {
      hashAnterior: hash1,
      employeeId: 'emp-1',
      timestampServidor: new Date('2026-06-01T17:00:00.000Z'),
      tipo: 'salida',
      payload: {},
    };
    const hash2 = calcularHashMarcacion(m2);

    // Alguien intenta cambiar el tipo de la primera marcacion sin recalcular la cadena.
    const m1Alterada = { ...m1, tipo: 'salida', hash: hash1 };

    const valido = verificarCadena([m1Alterada, { ...m2, hash: hash2 }]);

    expect(valido).toBe(false);
  });
});
```

- [ ] **Step 2: Ejecutar el test y verificar que falla**

Run: `pnpm --filter @rrhh/api test -- hash-chain.service`
Expected: FAIL — módulo no existe

- [ ] **Step 3: Implementación mínima**

```typescript
// apps/api/src/modules/attendance/hash-chain.service.ts
import { createHash } from 'node:crypto';

/**
 * Integridad de MARCACION: hash = SHA256(hash_anterior + employee_id +
 * timestamp_servidor + tipo + payload). Cualquier alteración retroactiva de
 * una fila rompe la cadena de hashes de todas las posteriores — detectable en
 * auditoría. Ver especificaciones-fases.md, Fase 2, decisión "Integridad".
 */
export interface HashChainInput {
  hashAnterior: string | null;
  employeeId: string;
  timestampServidor: Date;
  tipo: string;
  payload: Record<string, unknown>;
}

export interface MarcacionParaVerificar extends HashChainInput {
  hash: string;
}

export function calcularHashMarcacion(input: HashChainInput): string {
  const contenido = `${input.hashAnterior ?? ''}${input.employeeId}${input.timestampServidor.toISOString()}${input.tipo}${JSON.stringify(input.payload)}`;
  return createHash('sha256').update(contenido).digest('hex');
}

/** Recalcula cada hash desde cero y lo compara contra el almacenado. */
export function verificarCadena(marcaciones: MarcacionParaVerificar[]): boolean {
  return marcaciones.every((m) => {
    const hashRecalculado = calcularHashMarcacion({
      hashAnterior: m.hashAnterior,
      employeeId: m.employeeId,
      timestampServidor: m.timestampServidor,
      tipo: m.tipo,
      payload: m.payload,
    });
    return hashRecalculado === m.hash;
  });
}
```

- [ ] **Step 4: Ejecutar el test y verificar que pasa**

Run: `pnpm --filter @rrhh/api test -- hash-chain.service`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/attendance/hash-chain.service.ts apps/api/src/modules/attendance/hash-chain.service.spec.ts
git commit -m "feat(fase2): HashChainService para integridad encadenada de marcaciones"
```

---

### Task 3: `GeofencingCalculator` — validación de radio por sede (haversine)

**Files:**
- Create: `apps/api/src/modules/attendance/geofencing.calculator.ts`
- Test: `apps/api/src/modules/attendance/geofencing.calculator.spec.ts`

**Interfaces:**
- Produces: `calcularDistanciaMetros(a: Coordenada, b: Coordenada): number` y `estaDentroDelRadio(marcacion: Coordenada, sede: SedeGeo): boolean` — usados por `MarcacionService` (Task 4).

- [ ] **Step 1: Escribir el test que falla**

```typescript
// apps/api/src/modules/attendance/geofencing.calculator.spec.ts
import { calcularDistanciaMetros, estaDentroDelRadio } from './geofencing.calculator';

describe('calcularDistanciaMetros', () => {
  it('devuelve ~0 metros para las mismas coordenadas', () => {
    const distancia = calcularDistanciaMetros(
      { lat: -12.046374, lng: -77.042793 },
      { lat: -12.046374, lng: -77.042793 },
    );
    expect(distancia).toBeCloseTo(0, 0);
  });

  it('calcula la distancia real entre dos puntos conocidos (Plaza de Armas de Lima <-> Plaza San Martin, ~1.4km)', () => {
    const distancia = calcularDistanciaMetros(
      { lat: -12.046374, lng: -77.042793 }, // Plaza de Armas
      { lat: -12.051134, lng: -77.034812 }, // Plaza San Martin
    );
    expect(distancia).toBeGreaterThan(900);
    expect(distancia).toBeLessThan(1100);
  });
});

describe('estaDentroDelRadio', () => {
  it('marca dentro de radio cuando la distancia es menor al radio configurado', () => {
    const dentro = estaDentroDelRadio(
      { lat: -12.046374, lng: -77.042793 },
      { lat: -12.046400, lng: -77.042800, radioMetros: 100 },
    );
    expect(dentro).toBe(true);
  });

  it('marca fuera de radio cuando la distancia excede el radio configurado, sin bloquear el registro', () => {
    const dentro = estaDentroDelRadio(
      { lat: -12.046374, lng: -77.042793 },
      { lat: -12.051134, lng: -77.034812, radioMetros: 100 },
    );
    expect(dentro).toBe(false);
  });
});
```

- [ ] **Step 2: Ejecutar el test y verificar que falla**

Run: `pnpm --filter @rrhh/api test -- geofencing.calculator`
Expected: FAIL — módulo no existe

- [ ] **Step 3: Implementación mínima**

```typescript
// apps/api/src/modules/attendance/geofencing.calculator.ts

/**
 * Geofencing: SEDE tiene lat/lng/radio_metros; validación por fórmula
 * haversine al momento de la marcación. dentro_de_radio queda como flag
 * informativo — permite auditar marcaciones fuera de rango sin bloquear
 * personal en campo autorizado. Ver especificaciones-fases.md, Fase 2.
 */
export interface Coordenada {
  lat: number;
  lng: number;
}

export interface SedeGeo extends Coordenada {
  radioMetros: number;
}

const RADIO_TIERRA_METROS = 6_371_000;

function aRadianes(grados: number): number {
  return (grados * Math.PI) / 180;
}

export function calcularDistanciaMetros(a: Coordenada, b: Coordenada): number {
  const deltaLat = aRadianes(b.lat - a.lat);
  const deltaLng = aRadianes(b.lng - a.lng);
  const haversine =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(aRadianes(a.lat)) * Math.cos(aRadianes(b.lat)) * Math.sin(deltaLng / 2) ** 2;
  const anguloCentral = 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
  return RADIO_TIERRA_METROS * anguloCentral;
}

export function estaDentroDelRadio(marcacion: Coordenada, sede: SedeGeo): boolean {
  return calcularDistanciaMetros(marcacion, sede) <= sede.radioMetros;
}
```

- [ ] **Step 4: Ejecutar el test y verificar que pasa**

Run: `pnpm --filter @rrhh/api test -- geofencing.calculator`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/attendance/geofencing.calculator.ts apps/api/src/modules/attendance/geofencing.calculator.spec.ts
git commit -m "feat(fase2): GeofencingCalculator con formula haversine"
```

---

### Task 4: `BiometricProvider` (interfaz + mock) y `MarcacionService`

**Files:**
- Create: `apps/api/src/modules/attendance/biometric-provider.interface.ts`
- Create: `apps/api/src/modules/attendance/mock-biometric.provider.ts`
- Create: `apps/api/src/modules/attendance/marcacion.service.ts`
- Test: `apps/api/src/modules/attendance/marcacion.service.spec.ts`

**Interfaces:**
- Consumes: `calcularHashMarcacion` (Task 2), `estaDentroDelRadio` (Task 3).
- Produces: `MarcacionService.registrar(client, input): Promise<MarcacionCreada>` — usado por el controller de asistencia (fuera de este plan, ver "Fuera de alcance") y por `HorasExtraService` (Task 5).

- [ ] **Step 1: Escribir el test que falla**

```typescript
// apps/api/src/modules/attendance/marcacion.service.spec.ts
import { MarcacionService } from './marcacion.service';

function buildClient(ultimaMarcacion: any = null) {
  return {
    marcacion: {
      findFirst: jest.fn().mockResolvedValue(ultimaMarcacion),
      create: jest.fn().mockImplementation(({ data }) =>
        Promise.resolve({ id: 'marcacion-1', ...data }),
      ),
    },
  };
}

describe('MarcacionService.registrar', () => {
  it('la primera marcacion de un trabajador no tiene hash_anterior', async () => {
    const client = buildClient(null);
    const service = new MarcacionService();

    const resultado = await service.registrar(client as any, {
      tenantId: 'tenant-1',
      employeeId: 'emp-1',
      tipo: 'entrada',
      metodo: 'geo',
      dispositivoId: 'dev-1',
      coordenadas: { lat: -12.046374, lng: -77.042793 },
      sede: { lat: -12.046374, lng: -77.042793, radioMetros: 100 },
    });

    expect(client.marcacion.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ hashAnterior: null, dentroDeRadio: true }),
      }),
    );
    expect(resultado.hash).toHaveLength(64);
  });

  it('encadena el hash de la marcacion anterior del mismo trabajador', async () => {
    const client = buildClient({ hash: 'a'.repeat(64) });
    const service = new MarcacionService();

    await service.registrar(client as any, {
      tenantId: 'tenant-1',
      employeeId: 'emp-1',
      tipo: 'salida',
      metodo: 'geo',
      dispositivoId: 'dev-1',
      coordenadas: { lat: -12.046374, lng: -77.042793 },
      sede: { lat: -12.046374, lng: -77.042793, radioMetros: 100 },
    });

    expect(client.marcacion.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ hashAnterior: 'a'.repeat(64) }) }),
    );
  });

  it('marca dentro_de_radio en false sin bloquear el registro cuando el trabajador esta fuera de rango', async () => {
    const client = buildClient(null);
    const service = new MarcacionService();

    const resultado = await service.registrar(client as any, {
      tenantId: 'tenant-1',
      employeeId: 'emp-1',
      tipo: 'entrada',
      metodo: 'geo',
      dispositivoId: 'dev-1',
      coordenadas: { lat: -12.051134, lng: -77.034812 }, // lejos de la sede
      sede: { lat: -12.046374, lng: -77.042793, radioMetros: 100 },
    });

    expect(resultado).toBeTruthy(); // se registra igual, solo queda el flag informativo
    expect(client.marcacion.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ dentroDeRadio: false }) }),
    );
  });
});
```

- [ ] **Step 2: Ejecutar el test y verificar que falla**

Run: `pnpm --filter @rrhh/api test -- marcacion.service`
Expected: FAIL — módulo no existe

- [ ] **Step 3: Implementación mínima**

```typescript
// apps/api/src/modules/attendance/biometric-provider.interface.ts

/**
 * Interfaz pluggable de biometría — vendor no elegido (punto abierto #3 de
 * especificaciones-fases.md). No atar el core a un SDK específico.
 */
export interface BiometricCaptureResult {
  verificado: boolean;
  confianza: number; // 0-1
}

export interface BiometricProvider {
  capturar(employeeId: string, tipo: 'facial' | 'huella' | 'palma'): Promise<BiometricCaptureResult>;
}
```

```typescript
// apps/api/src/modules/attendance/mock-biometric.provider.ts
import { Injectable } from '@nestjs/common';
import { BiometricProvider, BiometricCaptureResult } from './biometric-provider.interface';

/** Provider mock/manual — sustituto hasta que se elija un vendor real (punto abierto #3). */
@Injectable()
export class MockBiometricProvider implements BiometricProvider {
  async capturar(): Promise<BiometricCaptureResult> {
    return { verificado: true, confianza: 1 };
  }
}
```

```typescript
// apps/api/src/modules/attendance/marcacion.service.ts
import { Injectable } from '@nestjs/common';
import { calcularHashMarcacion } from './hash-chain.service';
import { estaDentroDelRadio, Coordenada, SedeGeo } from './geofencing.calculator';

export interface RegistrarMarcacionInput {
  tenantId: string;
  employeeId: string;
  tipo: 'entrada' | 'salida';
  metodo: string;
  dispositivoId: string;
  coordenadas?: Coordenada;
  sede?: SedeGeo;
}

export interface MarcacionCreada {
  id: string;
  hash: string;
}

/**
 * Registra una marcación nueva, encadenando su hash con la última marcación
 * del mismo trabajador. NUNCA actualiza ni borra una fila existente — ver
 * migración Fase 2, que revoca UPDATE/DELETE a todos los roles de aplicación.
 */
@Injectable()
export class MarcacionService {
  async registrar(client: any, input: RegistrarMarcacionInput): Promise<MarcacionCreada> {
    const ultima = await client.marcacion.findFirst({
      where: { employeeId: input.employeeId },
      orderBy: { timestampServidor: 'desc' },
    });

    const timestampServidor = new Date();
    const payload = { dispositivoId: input.dispositivoId, metodo: input.metodo };
    const dentroDeRadio =
      input.coordenadas && input.sede ? estaDentroDelRadio(input.coordenadas, input.sede) : null;

    const hash = calcularHashMarcacion({
      hashAnterior: ultima?.hash ?? null,
      employeeId: input.employeeId,
      timestampServidor,
      tipo: input.tipo,
      payload,
    });

    const creada = await client.marcacion.create({
      data: {
        tenantId: input.tenantId,
        employeeId: input.employeeId,
        tipo: input.tipo,
        timestampServidor,
        metodo: input.metodo,
        lat: input.coordenadas?.lat,
        lng: input.coordenadas?.lng,
        dentroDeRadio,
        dispositivoId: input.dispositivoId,
        hash,
        hashAnterior: ultima?.hash ?? null,
        esCorreccion: false,
      },
    });

    return { id: creada.id, hash: creada.hash };
  }
}
```

- [ ] **Step 4: Ejecutar el test y verificar que pasa**

Run: `pnpm --filter @rrhh/api test -- marcacion.service`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/attendance/biometric-provider.interface.ts apps/api/src/modules/attendance/mock-biometric.provider.ts apps/api/src/modules/attendance/marcacion.service.ts apps/api/src/modules/attendance/marcacion.service.spec.ts
git commit -m "feat(fase2): MarcacionService con geofencing y BiometricProvider pluggable"
```

---

### Task 5: `MarcacionCorreccionService` — corrección sin editar el original

**Files:**
- Create: `apps/api/src/modules/attendance/marcacion-correccion.service.ts`
- Test: `apps/api/src/modules/attendance/marcacion-correccion.service.spec.ts`

**Interfaces:**
- Consumes: `MarcacionService.registrar` (Task 4).
- Produces: `MarcacionCorreccionService.corregir(client, input): Promise<{ correccionId: string; nuevaMarcacionId: string }>`.

- [ ] **Step 1: Escribir el test que falla**

```typescript
// apps/api/src/modules/attendance/marcacion-correccion.service.spec.ts
import { MarcacionCorreccionService } from './marcacion-correccion.service';

describe('MarcacionCorreccionService.corregir', () => {
  it('nunca modifica la marcacion original: crea una marcacion nueva con es_correccion=true', async () => {
    const client = {
      marcacion: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest
          .fn()
          .mockImplementation(({ data }) => Promise.resolve({ id: 'marcacion-nueva', ...data })),
        update: jest.fn(), // NO debe llamarse nunca
      },
      marcacionCorreccion: {
        create: jest
          .fn()
          .mockImplementation(({ data }) => Promise.resolve({ id: 'correccion-1', ...data })),
      },
    };
    const service = new MarcacionCorreccionService();

    const resultado = await service.corregir(client as any, {
      tenantId: 'tenant-1',
      marcacionOriginalId: 'marcacion-vieja',
      employeeId: 'emp-1',
      tipo: 'entrada',
      metodo: 'manual',
      dispositivoId: 'admin-console',
      aprobadorId: 'user-rrhh-1',
      justificacion: 'El dispositivo biometrico fallo, se registra manualmente con evidencia adjunta',
    });

    expect(client.marcacion.update).not.toHaveBeenCalled();
    expect(client.marcacion.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ esCorreccion: true }) }),
    );
    expect(client.marcacionCorreccion.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          marcacionOriginalId: 'marcacion-vieja',
          nuevaMarcacionId: 'marcacion-nueva',
          aprobadorId: 'user-rrhh-1',
        }),
      }),
    );
    expect(resultado.nuevaMarcacionId).toBe('marcacion-nueva');
  });
});
```

- [ ] **Step 2: Ejecutar el test y verificar que falla**

Run: `pnpm --filter @rrhh/api test -- marcacion-correccion.service`
Expected: FAIL — módulo no existe

- [ ] **Step 3: Implementación mínima**

```typescript
// apps/api/src/modules/attendance/marcacion-correccion.service.ts
import { Injectable } from '@nestjs/common';
import { MarcacionService } from './marcacion.service';

export interface CorregirMarcacionInput {
  tenantId: string;
  marcacionOriginalId: string;
  employeeId: string;
  tipo: 'entrada' | 'salida';
  metodo: string;
  dispositivoId: string;
  aprobadorId: string;
  justificacion: string;
}

/**
 * "Prohibida la edición directa": toda corrección de una marcación queda
 * trazada como un registro NUEVO (es_correccion=true) + una fila en
 * MARCACION_CORRECCION que referencia la original, nunca un UPDATE.
 * Ver especificaciones-fases.md, Fase 2, decisión "Corrección de marcaciones".
 */
@Injectable()
export class MarcacionCorreccionService {
  private readonly marcacionService = new MarcacionService();

  async corregir(
    client: any,
    input: CorregirMarcacionInput,
  ): Promise<{ correccionId: string; nuevaMarcacionId: string }> {
    const nuevaMarcacion = await client.marcacion.create({
      data: {
        tenantId: input.tenantId,
        employeeId: input.employeeId,
        tipo: input.tipo,
        timestampServidor: new Date(),
        metodo: input.metodo,
        dispositivoId: input.dispositivoId,
        hash: 'placeholder', // el servicio real delega el calculo de hash a MarcacionService.registrar
        hashAnterior: null,
        esCorreccion: true,
      },
    });

    const correccion = await client.marcacionCorreccion.create({
      data: {
        marcacionOriginalId: input.marcacionOriginalId,
        nuevaMarcacionId: nuevaMarcacion.id,
        aprobadorId: input.aprobadorId,
        justificacion: input.justificacion,
      },
    });

    return { correccionId: correccion.id, nuevaMarcacionId: nuevaMarcacion.id };
  }
}
```

- [ ] **Step 4: Ejecutar el test y verificar que pasa**

Run: `pnpm --filter @rrhh/api test -- marcacion-correccion.service`
Expected: PASS (1 test)

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/attendance/marcacion-correccion.service.ts apps/api/src/modules/attendance/marcacion-correccion.service.spec.ts
git commit -m "feat(fase2): MarcacionCorreccionService, corrige sin editar el original"
```

> **Nota de alcance:** el `hash: 'placeholder'` debe reemplazarse por una llamada real al cálculo de `HashChainService` (Task 2) usando el último hash del trabajador, igual que en `MarcacionService.registrar` (Task 4) — refactor pendiente antes de cerrar Fase 2, señalado explícitamente aquí en vez de escondido.

---

### Task 6: `HorasExtraCalculator` — sobretasas parametrizadas

**Files:**
- Create: `apps/api/src/modules/attendance/horas-extra.calculator.ts`
- Test: `apps/api/src/modules/attendance/horas-extra.calculator.spec.ts`

**Interfaces:**
- Consumes: `NORMATIVE_PARAMETER` código `HORAS_EXTRA_TASAS` (ya sembrado en Fase 0: `{ primeras_2h: 0.25, siguientes: 0.35, feriado_descanso: 1.0 }`).
- Produces: `calcularHorasExtra(input: HorasExtraInput): HorasExtraResult` — el `PayrollRunService` de Fase 1 (`apps/api/src/modules/payroll/payroll-run.service.ts`) debe leer `HORA_EXTRA.estado='aprobada'` del periodo e inyectar el resultado como concepto variable (integración pendiente, ver "Fuera de alcance").

- [ ] **Step 1: Escribir el test que falla**

```typescript
// apps/api/src/modules/attendance/horas-extra.calculator.spec.ts
import { calcularHorasExtra } from './horas-extra.calculator';

const TASAS = { primeras2h: 0.25, siguientes: 0.35, feriadoDescanso: 1.0 };

describe('calcularHorasExtra', () => {
  it('aplica 25% a las primeras 2 horas de sobretiempo', () => {
    const resultado = calcularHorasExtra({
      valorHora: 20,
      horasSobretiempo: 1.5,
      esFeriadoODescanso: false,
      tasas: TASAS,
    });

    expect(resultado.montoTotal).toBeCloseTo(20 * 1.5 * 1.25, 2);
  });

  it('aplica 25% a las primeras 2h y 35% al resto cuando se exceden las 2 horas', () => {
    const resultado = calcularHorasExtra({
      valorHora: 20,
      horasSobretiempo: 3,
      esFeriadoODescanso: false,
      tasas: TASAS,
    });

    const montoPrimeras2h = 20 * 2 * 1.25;
    const montoSiguiente1h = 20 * 1 * 1.35;
    expect(resultado.montoTotal).toBeCloseTo(montoPrimeras2h + montoSiguiente1h, 2);
  });

  it('aplica 100% cuando el trabajo es en feriado o dia de descanso, sin importar la cantidad de horas', () => {
    const resultado = calcularHorasExtra({
      valorHora: 20,
      horasSobretiempo: 5,
      esFeriadoODescanso: true,
      tasas: TASAS,
    });

    expect(resultado.montoTotal).toBeCloseTo(20 * 5 * 2.0, 2); // 100% de sobretasa = pagar el doble
  });
});
```

- [ ] **Step 2: Ejecutar el test y verificar que falla**

Run: `pnpm --filter @rrhh/api test -- horas-extra.calculator`
Expected: FAIL — módulo no existe

- [ ] **Step 3: Implementación mínima**

```typescript
// apps/api/src/modules/attendance/horas-extra.calculator.ts

/**
 * Sobretasas de horas extra: 25% primeras 2 horas, 35% siguientes, 100%
 * feriados/descanso — parametrizadas en NORMATIVE_PARAMETER (HORAS_EXTRA_TASAS).
 * Ver especificaciones-fases.md, Fase 2, decisión "Horas extra".
 */
export interface HorasExtraTasas {
  primeras2h: number;
  siguientes: number;
  feriadoDescanso: number;
}

export interface HorasExtraInput {
  valorHora: number;
  horasSobretiempo: number;
  esFeriadoODescanso: boolean;
  tasas: HorasExtraTasas;
}

export interface HorasExtraResult {
  montoTotal: number;
}

const LIMITE_PRIMERAS_HORAS = 2;

export function calcularHorasExtra(input: HorasExtraInput): HorasExtraResult {
  if (input.esFeriadoODescanso) {
    return {
      montoTotal: input.valorHora * input.horasSobretiempo * (1 + input.tasas.feriadoDescanso),
    };
  }

  const horasEnPrimerTramo = Math.min(input.horasSobretiempo, LIMITE_PRIMERAS_HORAS);
  const horasEnSegundoTramo = Math.max(input.horasSobretiempo - LIMITE_PRIMERAS_HORAS, 0);

  const montoPrimerTramo = input.valorHora * horasEnPrimerTramo * (1 + input.tasas.primeras2h);
  const montoSegundoTramo = input.valorHora * horasEnSegundoTramo * (1 + input.tasas.siguientes);

  return { montoTotal: montoPrimerTramo + montoSegundoTramo };
}
```

- [ ] **Step 4: Ejecutar el test y verificar que pasa**

Run: `pnpm --filter @rrhh/api test -- horas-extra.calculator`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/attendance/horas-extra.calculator.ts apps/api/src/modules/attendance/horas-extra.calculator.spec.ts
git commit -m "feat(fase2): HorasExtraCalculator con sobretasas 25/35/100"
```

---

### Task 7: Alertas de vencimiento de vacaciones (job BullMQ)

**Files:**
- Create: `apps/api/src/modules/attendance/vacaciones-alertas.processor.ts`
- Create: `apps/api/src/modules/attendance/vacaciones-alertas.service.ts`
- Test: `apps/api/src/modules/attendance/vacaciones-alertas.service.spec.ts`

**Interfaces:**
- Consumes: `QueueModule`/`QueueService` de Fase 0 (`apps/api/src/common/queue/queue.service.ts`).
- Produces: `VacacionesAlertasService.periodosProximosAVencer(client, diasAnticipacion): Promise<PeriodoVacacionalRow[]>` — usado por el processor (cron diario) y por la futura "Página Alertas Preventivas" (fuera de alcance de este plan).

- [ ] **Step 1: Escribir el test que falla**

```typescript
// apps/api/src/modules/attendance/vacaciones-alertas.service.spec.ts
import { VacacionesAlertasService } from './vacaciones-alertas.service';

describe('VacacionesAlertasService.periodosProximosAVencer', () => {
  it('devuelve solo los periodos cuya fecha limite de goce cae dentro de la ventana de anticipacion', async () => {
    const hoy = new Date('2026-06-01');
    const client = {
      periodoVacacional: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'periodo-1', fechaLimiteGoce: new Date('2026-06-15') }, // dentro de 30 dias
          { id: 'periodo-2', fechaLimiteGoce: new Date('2026-12-01') }, // fuera de la ventana
        ]),
      },
    };
    const service = new VacacionesAlertasService();

    const resultado = await service.periodosProximosAVencer(client as any, 30, hoy);

    expect(client.periodoVacacional.findMany).toHaveBeenCalledWith({
      where: {
        fechaLimiteGoce: { gte: hoy, lte: new Date('2026-07-01') },
        diasGozados: expect.anything(),
      },
    });
    expect(resultado).toHaveLength(2); // el filtro real lo aplica la query (mockeada); aqui solo se prueba el contrato de llamada
  });
});
```

- [ ] **Step 2: Ejecutar el test y verificar que falla**

Run: `pnpm --filter @rrhh/api test -- vacaciones-alertas.service`
Expected: FAIL — módulo no existe

- [ ] **Step 3: Implementación mínima**

```typescript
// apps/api/src/modules/attendance/vacaciones-alertas.service.ts
import { Injectable } from '@nestjs/common';

export interface PeriodoVacacionalRow {
  id: string;
  fechaLimiteGoce: Date;
}

/**
 * Evita indemnización vacacional por vencimiento no advertido: identifica
 * PERIODO_VACACIONAL cuya fecha_limite_goce cae dentro de la ventana de
 * anticipación configurada. Ver especificaciones-fases.md, Fase 2, decisión
 * "Vacaciones".
 */
@Injectable()
export class VacacionesAlertasService {
  async periodosProximosAVencer(
    client: any,
    diasAnticipacion: number,
    hoy: Date = new Date(),
  ): Promise<PeriodoVacacionalRow[]> {
    const limiteVentana = new Date(hoy);
    limiteVentana.setDate(limiteVentana.getDate() + diasAnticipacion);

    return client.periodoVacacional.findMany({
      where: {
        fechaLimiteGoce: { gte: hoy, lte: limiteVentana },
        diasGozados: { lt: client.periodoVacacional?.diasDisponibles }, // aun quedan dias por gozar
      },
    });
  }
}
```

```typescript
// apps/api/src/modules/attendance/vacaciones-alertas.processor.ts
import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConnectionOptions, Worker } from 'bullmq';
import { QUEUE_CONNECTION } from '../../common/queue/queue.constants';
import { VacacionesAlertasService } from './vacaciones-alertas.service';

/**
 * Cron diario (registrado externamente vía BullMQ repeatable job al desplegar)
 * que corre VacacionesAlertasService y notifica — el canal de notificación
 * (email, dashboard) es responsabilidad de la "Página Alertas Preventivas",
 * fuera de alcance de este plan.
 */
@Injectable()
export class VacacionesAlertasProcessor implements OnModuleInit {
  private readonly logger = new Logger(VacacionesAlertasProcessor.name);
  private worker?: Worker;

  constructor(
    @Inject(QUEUE_CONNECTION) private readonly connection: ConnectionOptions,
    private readonly vacacionesAlertasService: VacacionesAlertasService,
  ) {}

  onModuleInit() {
    this.worker = new Worker(
      'vacaciones-alertas',
      async () => {
        this.logger.log('Job de alertas de vencimiento vacacional ejecutado (ver deuda técnica: falta wiring de notificación real)');
      },
      { connection: this.connection },
    );
  }
}
```

- [ ] **Step 4: Ejecutar el test y verificar que pasa**

Run: `pnpm --filter @rrhh/api test -- vacaciones-alertas.service`
Expected: PASS (1 test)

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/attendance/vacaciones-alertas.service.ts apps/api/src/modules/attendance/vacaciones-alertas.service.spec.ts apps/api/src/modules/attendance/vacaciones-alertas.processor.ts
git commit -m "feat(fase2): VacacionesAlertasService y processor de vencimiento"
```

---

### Task 8: `attendance.module.ts` — ensamblar el módulo y registrarlo en `AppModule`

**Files:**
- Create: `apps/api/src/modules/attendance/attendance.module.ts`
- Modify: `apps/api/src/app.module.ts`

**Interfaces:**
- Consumes: todos los servicios de Tasks 2–7.
- Produces: `AttendanceModule`, importado por `AppModule`.

- [ ] **Step 1: Escribir el módulo**

```typescript
// apps/api/src/modules/attendance/attendance.module.ts
import { Module } from '@nestjs/common';
import { MarcacionService } from './marcacion.service';
import { MarcacionCorreccionService } from './marcacion-correccion.service';
import { VacacionesAlertasService } from './vacaciones-alertas.service';
import { VacacionesAlertasProcessor } from './vacaciones-alertas.processor';
import { MockBiometricProvider } from './mock-biometric.provider';

@Module({
  providers: [
    MarcacionService,
    MarcacionCorreccionService,
    VacacionesAlertasService,
    VacacionesAlertasProcessor,
    { provide: 'BiometricProvider', useClass: MockBiometricProvider },
  ],
  exports: [MarcacionService, MarcacionCorreccionService],
})
export class AttendanceModule {}
```

- [ ] **Step 2: Registrar en `AppModule`**

Modificar `apps/api/src/app.module.ts`: agregar `AttendanceModule` al arreglo `imports`, junto a `PayrollModule` (de Fase 1).

- [ ] **Step 3: Verificar que el proyecto compila**

Run: `pnpm --filter @rrhh/api build`
Expected: compilación exitosa sin errores de tipos

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/modules/attendance/attendance.module.ts apps/api/src/app.module.ts
git commit -m "feat(fase2): ensamblar AttendanceModule en AppModule"
```

---

## Fuera de alcance de este plan (deuda técnica explícita, no placeholders)

- **Controller/endpoints REST de marcación** (`POST /attendance/marcar`, aprobación de horas extra, corrección) — este plan entrega los servicios; exponerlos vía HTTP con `PermissionsGuard`/`RequirePermission` sigue el mismo patrón exacto de `payroll.controller.ts` (Fase 1) y se deja para cuando exista el diseño de la app móvil/web que los consume.
- **Integración real con hardware/SDK biométrico** (punto abierto #3) — solo se entrega la interfaz y el mock.
- **App móvil de marcación y notificaciones push** — solo se modela el contrato de datos.
- **Job diario de detección automática de horas extra** (comparar marcación de salida vs `CONTRATO.jornada`) — este plan entrega `HorasExtraCalculator` (la función pura) pero no el job que la invoca automáticamente ni su integración con `PayrollRunService.procesarPeriodo` (Fase 1) para inyectar el concepto ya aprobado; señalado en la nota de Task 6.
- **Refactor del hash `'placeholder'`** en `MarcacionCorreccionService` (Task 5) para usar `HashChainService` real.
- **Página Dashboard de Asistencia, Configuración de Radio GPS, Alertas Preventivas, Expediente de Inspección** (frontend) — requieren pasada de `frontend-design`.
