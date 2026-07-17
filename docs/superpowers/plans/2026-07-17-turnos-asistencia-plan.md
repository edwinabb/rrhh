# Control de Asistencia por Turnos — Plan de Implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implementar el control de asistencia por turnos según `docs/superpowers/specs/2026-07-17-turnos-asistencia-design.md`: catálogo de turnos, plan empleado×fecha (CSV + web), cálculo correcto de turnos que cruzan medianoche, gracia 29:59 + compensación minuto a minuto, saldo de descansos compensatorios (libro mayor), intercambios A↔B, reporte de cumplimiento y frontend `/turnos`.

**Architecture:** Dos calculadores puros nuevos en `attendance/calculators` (ventana de captura y cumplimiento de turno) + servicio compartido `TurnoRecalculoService` que intercepta el recálculo del resumen diario (marcación en vivo e import del reloj) cuando el empleado tiene plan; módulo NestJS nuevo `shifts` (catálogo, plan, import CSV, compensatorios, intercambios, reporte); frontend Next.js con página `/turnos` de 4 pestañas. Retrocompatible: sin plan ⇒ flujo actual intacto.

**Tech Stack:** NestJS + TypeScript, Prisma + PostgreSQL (RLS), Jest (TDD), Next.js 14 + Tailwind.

## Global Constraints

- Monorepo pnpm: tests con `pnpm --filter @rrhh/api test -- <pattern>`; web con `--filter @rrhh/web`.
- Los services NO abren transacciones: reciben `tx` (cliente Prisma) como primer parámetro; el controller lo saca de `getTenantContext()`.
- Toda tabla nueva: RLS (`ENABLE`+`FORCE`+política `tenant_isolation` sobre `current_setting('app.tenant_id', true)::uuid`), GRANTs explícitos (`app_admin`, `app_rrhh`, `app_manager`, `app_employee`) y trigger `audit_trigger()` — patrón de `20260715000000_cese_liquidacion/migration.sql`.
- Marcaciones append-only (SUNAFIL): nunca UPDATE/DELETE sobre `marcacion`.
- Sin class-validator: DTOs como clases planas + validación manual (patrón del proyecto).
- Sin dependencias npm nuevas (parser CSV manual ya existente como referencia).
- Los 246 tests existentes deben seguir en verde tras cada tarea (una excepción controlada en Task 5: se ajusta la semántica de tolerancia `>` → `>=` y sus tests).
- NUNCA ejecutar `next build` con el dev server de la web corriendo (comparten `.next`).
- Comentarios y nombres de dominio en español; commits en español con prefijo convencional.
- Gracia de puntualidad: `toleranciaMinutos = 30` significa "hasta 29:59 no es tarde; a los 30:00 exactos ya es tarde" (comparación `>=` sobre minutos enteros).

## File Structure

```
packages/database/prisma/schema.prisma                                   (modificar: Turno, TurnoAsignacion, CompensatorioMovimiento, enums, campos en AsistenciaResumen y ConfiguracionAsistencia)
packages/database/prisma/migrations/20260718000000_turnos_asistencia/migration.sql (crear)
packages/database/seed.ts                                                (modificar: permisos shift.*)
apps/api/src/modules/attendance/calculators/ventana-turno.calculator.ts  (crear + spec)
apps/api/src/modules/attendance/calculators/turno-cumplimiento.calculator.ts (crear + spec)
apps/api/src/modules/attendance/calculators/asistencia-resumen.calculator.ts (modificar: tolerancia >=)
apps/api/src/modules/attendance/turno-recalculo.service.ts               (crear + spec)
apps/api/src/modules/attendance/attendance.service.ts                    (modificar: delegar a TurnoRecalculoService)
apps/api/src/modules/attendance/attendance-import.service.ts             (modificar: ídem)
apps/api/src/modules/attendance/attendance.module.ts                     (modificar: provider + export)
apps/api/src/modules/shifts/shift-plan.service.ts                        (crear + spec)
apps/api/src/modules/shifts/shift-plan-import.service.ts                 (crear + spec)
apps/api/src/modules/shifts/compensatorio.service.ts                     (crear + spec)
apps/api/src/modules/shifts/shift-compliance.service.ts                  (crear + spec)
apps/api/src/modules/shifts/shifts.controller.ts                        (crear)
apps/api/src/modules/shifts/shifts.module.ts                            (crear)
apps/api/src/app.module.ts                                               (modificar: registrar ShiftsModule)
apps/web/src/app/(app)/turnos/shifts-api.ts                              (crear)
apps/web/src/app/(app)/turnos/catalogo-tab.tsx                           (crear)
apps/web/src/app/(app)/turnos/plan-tab.tsx                               (crear)
apps/web/src/app/(app)/turnos/cumplimiento-tab.tsx                       (crear)
apps/web/src/app/(app)/turnos/compensatorios-tab.tsx                     (crear)
apps/web/src/app/(app)/turnos/page.tsx                                   (crear)
apps/web/src/app/(app)/layout.tsx                                        (modificar: item "Turnos")
docs/RESUMEN_SISTEMA.md, docs/PENDIENTES.md                              (modificar al final)
```

---

### Task 1: Schema Prisma + migración (Turno, TurnoAsignacion, CompensatorioMovimiento, campos nuevos)

**Files:**
- Modify: `packages/database/prisma/schema.prisma`
- Create: `packages/database/prisma/migrations/20260718000000_turnos_asistencia/migration.sql`

**Interfaces:**
- Produces: modelos Prisma `Turno`, `TurnoAsignacion`, `CompensatorioMovimiento`; enums `TipoDiaPlan`, `TipoMovimientoCompensatorio`; campos nuevos en `AsistenciaResumen` (`turnoId`, `minutosRetraso`, `salidaEsperada`, `deficitMinutos`, `sinPlan`) y en `ConfiguracionAsistencia` (`ventanaAntesTurnoMinutos`, `ventanaDespuesTurnoMinutos`). Consumidos por todas las tareas siguientes.

- [ ] **Step 1: Editar `schema.prisma`**

1. En `AsistenciaResumen`, después de `justificado`:

```prisma
  // Control por turnos (null/0/false para personal con horario estándar)
  turnoId         String?   @map("turno_id") @db.Uuid
  minutosRetraso  Int       @default(0) @map("minutos_retraso")
  salidaEsperada  DateTime? @map("salida_esperada")
  deficitMinutos  Int       @default(0) @map("deficit_minutos")
  sinPlan         Boolean   @default(false) @map("sin_plan")
```

2. En `ConfiguracionAsistencia`, después de `toleranciaTardanzaMinutos`:

```prisma
  // Ventana de captura de marcaciones alrededor del turno asignado (spec §4.1)
  ventanaAntesTurnoMinutos   Int @default(120) @map("ventana_antes_turno_minutos")
  ventanaDespuesTurnoMinutos Int @default(240) @map("ventana_despues_turno_minutos")
```

3. Al final de la sección Fase 2 (después de `ConfiguracionAsistencia`):

```prisma
// ---------------------------------------------------------------------------
// Control de asistencia por turnos.
// Ver docs/superpowers/specs/2026-07-17-turnos-asistencia-design.md.
// ---------------------------------------------------------------------------

model Turno {
  id                String  @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  tenantId          String  @map("tenant_id") @db.Uuid
  codigo            String  @db.VarChar(20)
  nombre            String  @db.VarChar(80)
  horaInicio        String  @map("hora_inicio") @db.VarChar(5) // HH:mm
  horaFin           String  @map("hora_fin") @db.VarChar(5) // HH:mm; <= horaInicio => cruza medianoche
  horasEsperadas    Decimal @map("horas_esperadas") @db.Decimal(4, 2)
  toleranciaMinutos Int     @default(30) @map("tolerancia_minutos")
  activo            Boolean @default(true)

  creadoEn      DateTime @default(now()) @map("creado_en")
  actualizadoEn DateTime @updatedAt @map("actualizado_en")

  tenant       Tenant            @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  asignaciones TurnoAsignacion[]

  @@unique([tenantId, codigo])
  @@map("turno")
}

enum TipoDiaPlan {
  TURNO
  DESCANSO
  DESCANSO_COMPENSATORIO

  @@map("tipo_dia_plan")
}

model TurnoAsignacion {
  id         String      @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  tenantId   String      @map("tenant_id") @db.Uuid
  employeeId String      @map("employee_id") @db.Uuid
  fecha      DateTime    @db.Date
  tipoDia    TipoDiaPlan @map("tipo_dia")
  turnoId    String?     @map("turno_id") @db.Uuid // obligatorio si tipoDia = TURNO
  notas      String?     @db.Text

  creadoEn      DateTime @default(now()) @map("creado_en")
  actualizadoEn DateTime @updatedAt @map("actualizado_en")

  tenant   Tenant   @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  employee Employee @relation(fields: [employeeId], references: [id], onDelete: Cascade)
  turno    Turno?   @relation(fields: [turnoId], references: [id])

  @@unique([tenantId, employeeId, fecha])
  @@index([tenantId, fecha])
  @@map("turno_asignacion")
}

enum TipoMovimientoCompensatorio {
  GANADO
  GOZADO
  AJUSTE_INICIAL

  @@map("tipo_movimiento_compensatorio")
}

// Libro mayor de descansos compensatorios: append-only, saldo = suma de dias.
model CompensatorioMovimiento {
  id                String                      @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  tenantId          String                      @map("tenant_id") @db.Uuid
  employeeId        String                      @map("employee_id") @db.Uuid
  tipo              TipoMovimientoCompensatorio
  dias              Decimal                     @db.Decimal(4, 2) // GANADO > 0, GOZADO < 0 (reversión > 0), AJUSTE_INICIAL ±n
  fechaReferencia   DateTime                    @map("fecha_referencia") @db.Date
  turnoAsignacionId String?                     @map("turno_asignacion_id") @db.Uuid
  motivo            String?                     @db.Text // obligatorio en AJUSTE_INICIAL
  creadoPor         String                      @map("creado_por") @db.Uuid
  creadoEn          DateTime                    @default(now()) @map("creado_en")

  tenant   Tenant   @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  employee Employee @relation(fields: [employeeId], references: [id], onDelete: Cascade)

  @@index([tenantId, employeeId])
  @@map("compensatorio_movimiento")
}
```

4. En `Employee`, junto a `vacacionPeriodos`:

```prisma
  turnoAsignaciones        TurnoAsignacion[]
  compensatorioMovimientos CompensatorioMovimiento[]
```

5. En `Tenant`, junto a `vacacionPeriodos`:

```prisma
  turnos                   Turno[]
  turnoAsignaciones        TurnoAsignacion[]
  compensatorioMovimientos CompensatorioMovimiento[]
```

- [ ] **Step 2: Crear la migración manual**

Crear `packages/database/prisma/migrations/20260718000000_turnos_asistencia/migration.sql`:

```sql
-- Control de asistencia por turnos: catálogo, plan empleado×fecha, libro de
-- compensatorios y campos de cumplimiento en el resumen diario.
-- Patrón RLS/GRANT/auditoría de 20260715000000_cese_liquidacion.

-- 1. Campos nuevos en tablas existentes
ALTER TABLE "asistencia_resumen"
  ADD COLUMN "turno_id" UUID,
  ADD COLUMN "minutos_retraso" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "salida_esperada" TIMESTAMP(3),
  ADD COLUMN "deficit_minutos" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "sin_plan" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "configuracion_asistencia"
  ADD COLUMN "ventana_antes_turno_minutos" INTEGER NOT NULL DEFAULT 120,
  ADD COLUMN "ventana_despues_turno_minutos" INTEGER NOT NULL DEFAULT 240;

-- 2. Enums y tablas nuevas
CREATE TYPE "tipo_dia_plan" AS ENUM ('TURNO', 'DESCANSO', 'DESCANSO_COMPENSATORIO');
CREATE TYPE "tipo_movimiento_compensatorio" AS ENUM ('GANADO', 'GOZADO', 'AJUSTE_INICIAL');

CREATE TABLE "turno" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "codigo" VARCHAR(20) NOT NULL,
    "nombre" VARCHAR(80) NOT NULL,
    "hora_inicio" VARCHAR(5) NOT NULL,
    "hora_fin" VARCHAR(5) NOT NULL,
    "horas_esperadas" DECIMAL(4,2) NOT NULL,
    "tolerancia_minutos" INTEGER NOT NULL DEFAULT 30,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "turno_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "turno_tenant_id_codigo_key" UNIQUE ("tenant_id", "codigo"),
    CONSTRAINT "turno_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE
);

CREATE TABLE "turno_asignacion" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "fecha" DATE NOT NULL,
    "tipo_dia" "tipo_dia_plan" NOT NULL,
    "turno_id" UUID,
    "notas" TEXT,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "turno_asignacion_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "turno_asignacion_tenant_id_employee_id_fecha_key" UNIQUE ("tenant_id", "employee_id", "fecha"),
    CONSTRAINT "turno_asignacion_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE,
    CONSTRAINT "turno_asignacion_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employee"("id") ON DELETE CASCADE,
    CONSTRAINT "turno_asignacion_turno_id_fkey" FOREIGN KEY ("turno_id") REFERENCES "turno"("id")
);
CREATE INDEX "turno_asignacion_tenant_id_fecha_idx" ON "turno_asignacion"("tenant_id", "fecha");

CREATE TABLE "compensatorio_movimiento" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "tipo" "tipo_movimiento_compensatorio" NOT NULL,
    "dias" DECIMAL(4,2) NOT NULL,
    "fecha_referencia" DATE NOT NULL,
    "turno_asignacion_id" UUID,
    "motivo" TEXT,
    "creado_por" UUID NOT NULL,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "compensatorio_movimiento_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "compensatorio_movimiento_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE,
    CONSTRAINT "compensatorio_movimiento_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employee"("id") ON DELETE CASCADE
);
CREATE INDEX "compensatorio_movimiento_tenant_id_employee_id_idx" ON "compensatorio_movimiento"("tenant_id", "employee_id");

-- 3. RLS
ALTER TABLE "turno" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "turno" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "turno"
    USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid);

ALTER TABLE "turno_asignacion" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "turno_asignacion" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "turno_asignacion"
    USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid);

ALTER TABLE "compensatorio_movimiento" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "compensatorio_movimiento" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "compensatorio_movimiento"
    USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid);

-- 4. Privilegios. Catálogo y plan: escribe RRHH/Admin; todos leen (el empleado
--    consulta su propio plan vía service). Libro de compensatorios: append-only
--    (sin UPDATE/DELETE para nadie; una corrección es un movimiento inverso).
GRANT SELECT ON "turno" TO app_rrhh, app_admin, app_manager, app_employee;
GRANT INSERT, UPDATE ON "turno" TO app_rrhh, app_admin;
GRANT SELECT ON "turno_asignacion" TO app_rrhh, app_admin, app_manager, app_employee;
GRANT INSERT, UPDATE ON "turno_asignacion" TO app_rrhh, app_admin;
GRANT SELECT ON "compensatorio_movimiento" TO app_rrhh, app_admin, app_manager, app_employee;
GRANT INSERT ON "compensatorio_movimiento" TO app_rrhh, app_admin;

-- 5. Auditoría inmutable
CREATE TRIGGER "turno_audit" AFTER INSERT OR UPDATE OR DELETE ON "turno"
    FOR EACH ROW EXECUTE FUNCTION audit_trigger();
CREATE TRIGGER "turno_asignacion_audit" AFTER INSERT OR UPDATE OR DELETE ON "turno_asignacion"
    FOR EACH ROW EXECUTE FUNCTION audit_trigger();
CREATE TRIGGER "compensatorio_movimiento_audit" AFTER INSERT OR UPDATE OR DELETE ON "compensatorio_movimiento"
    FOR EACH ROW EXECUTE FUNCTION audit_trigger();
```

- [ ] **Step 3: Aplicar migración y regenerar cliente**

Run: `cd packages/database && pnpm migrate:deploy && pnpm prisma generate`
Expected: `1 migration applied` y cliente regenerado sin errores.

- [ ] **Step 4: Verificar que la API compila y los tests siguen en verde**

Run: `pnpm --filter @rrhh/api test`
Expected: 246 tests PASS (los campos nuevos tienen defaults; nada los consume aún).

- [ ] **Step 5: Commit**

```bash
git add packages/database/prisma/schema.prisma packages/database/prisma/migrations/20260718000000_turnos_asistencia/
git commit -m "feat(turnos): schema y migración de catálogo, plan, compensatorios y campos de cumplimiento"
```

---

### Task 2: Seed — permisos `shift.*`

**Files:**
- Modify: `packages/database/seed.ts`

**Interfaces:**
- Produces: permisos `shift.read`, `shift.manage`, `shift.resolve` (usados por el controller en Task 11 y el sidebar en Task 14).

- [ ] **Step 1: Agregar al array `PERMISSIONS`** (después del bloque `vacation.*`):

```typescript
  { code: 'shift.read', descripcion: 'Ver catálogo de turnos, plan y cumplimiento', esSensible: false },
  { code: 'shift.manage', descripcion: 'Gestionar catálogo de turnos, plan e import CSV', esSensible: false },
  { code: 'shift.resolve', descripcion: 'Resolver pendientes: intercambios y movimientos de compensatorios', esSensible: true },
```

- [ ] **Step 2: Asignar a los roles en `SYSTEM_ROLES`**

- Admin: `shift.read`, `shift.manage`, `shift.resolve`.
- RRHH: `shift.read`, `shift.manage`, `shift.resolve`.
- Manager: `shift.read`.
- Employee: sin cambios (consulta su plan vía endpoint de sesión, sin permiso).

- [ ] **Step 3: Ejecutar el seed (idempotente)**

Run: `cd packages/database && pnpm run seed`
Expected: termina sin errores; re-ejecutar no duplica filas.

- [ ] **Step 4: Commit**

```bash
git add packages/database/seed.ts
git commit -m "feat(turnos): permisos shift.read/manage/resolve"
```

---

### Task 3: `ventana-turno.calculator` — ventana de captura y atribución de fecha de turno

**Files:**
- Create: `apps/api/src/modules/attendance/calculators/ventana-turno.calculator.ts`
- Test: `apps/api/src/modules/attendance/calculators/ventana-turno.calculator.spec.ts`

**Interfaces:**
- Produces: `construirVentanaTurno(fecha, turno, margenAntesMinutos, margenDespuesMinutos): VentanaTurno` y `atribuirFechaTurno(timestamp, candidatas): Date | null` con tipos `TurnoHorario { horaInicio: string; horaFin: string }` y `VentanaTurno { inicioVentana; finVentana; inicioTurno; finTurno }` — consumidos por `turno-cumplimiento.calculator` (Task 4) y `TurnoRecalculoService` (Task 6).

- [ ] **Step 1: Escribir los tests que fallan**

```typescript
// apps/api/src/modules/attendance/calculators/ventana-turno.calculator.spec.ts
import { atribuirFechaTurno, construirVentanaTurno } from './ventana-turno.calculator';

const DIA = { horaInicio: '08:00', horaFin: '20:00' };
const NOCHE = { horaInicio: '20:00', horaFin: '08:00' };

describe('construirVentanaTurno', () => {
  it('turno diurno: ventana [inicio − 2h, fin + 4h] el mismo día', () => {
    const v = construirVentanaTurno(new Date(2026, 6, 20), DIA, 120, 240);
    expect(v.inicioTurno).toEqual(new Date(2026, 6, 20, 8, 0));
    expect(v.finTurno).toEqual(new Date(2026, 6, 20, 20, 0));
    expect(v.inicioVentana).toEqual(new Date(2026, 6, 20, 6, 0));
    expect(v.finVentana).toEqual(new Date(2026, 6, 20, 24, 0)); // 00:00 del 21
  });

  it('turno nocturno (horaFin <= horaInicio): el fin cae al día siguiente', () => {
    const v = construirVentanaTurno(new Date(2026, 6, 20), NOCHE, 120, 240);
    expect(v.inicioTurno).toEqual(new Date(2026, 6, 20, 20, 0));
    expect(v.finTurno).toEqual(new Date(2026, 6, 21, 8, 0));
    expect(v.finVentana).toEqual(new Date(2026, 6, 21, 12, 0));
  });
});

describe('atribuirFechaTurno', () => {
  const candidatas = [
    { fecha: new Date(2026, 6, 20), ventana: construirVentanaTurno(new Date(2026, 6, 20), NOCHE, 120, 240) },
    { fecha: new Date(2026, 6, 22), ventana: construirVentanaTurno(new Date(2026, 6, 22), NOCHE, 120, 240) },
  ];

  it('la salida de las 08:03 del día siguiente pertenece al turno de la víspera', () => {
    expect(atribuirFechaTurno(new Date(2026, 6, 21, 8, 3), candidatas)).toEqual(new Date(2026, 6, 20));
  });

  it('la entrada de las 19:55 pertenece al turno de ese día', () => {
    expect(atribuirFechaTurno(new Date(2026, 6, 20, 19, 55), candidatas)).toEqual(new Date(2026, 6, 20));
  });

  it('marcación fuera de toda ventana → null', () => {
    expect(atribuirFechaTurno(new Date(2026, 6, 21, 15, 0), candidatas)).toBeNull();
  });

  it('solape: gana la ventana con inicio de turno más cercano', () => {
    const solapadas = [
      { fecha: new Date(2026, 6, 20), ventana: construirVentanaTurno(new Date(2026, 6, 20), DIA, 120, 600) },
      { fecha: new Date(2026, 6, 20), ventana: construirVentanaTurno(new Date(2026, 6, 20), NOCHE, 120, 240) },
    ];
    // 19:00: dentro de ambas; inicio NOCHE (20:00) está a 1h vs DIA (08:00) a 11h
    expect(atribuirFechaTurno(new Date(2026, 6, 20, 19, 0), solapadas)).toEqual(new Date(2026, 6, 20));
  });
});
```

- [ ] **Step 2: Verificar que falla**

Run: `pnpm --filter @rrhh/api test -- ventana-turno`
Expected: FAIL — `Cannot find module './ventana-turno.calculator'`

- [ ] **Step 3: Implementación mínima**

```typescript
// apps/api/src/modules/attendance/calculators/ventana-turno.calculator.ts
/**
 * Ventana de captura de marcaciones de un turno asignado (spec §4.1):
 * [inicio del turno − margenAntes, fin del turno + margenDespues]. Si
 * horaFin <= horaInicio el turno cruza medianoche y el fin cae en el día
 * siguiente. Toda marcación dentro de la ventana se atribuye a la FECHA DEL
 * TURNO (no a la fecha calendario); en solapes gana el inicio más cercano.
 * @pure
 */
export interface TurnoHorario {
  horaInicio: string; // HH:mm
  horaFin: string; // HH:mm
}

export interface VentanaTurno {
  inicioVentana: Date;
  finVentana: Date;
  inicioTurno: Date;
  finTurno: Date;
}

export interface VentanaCandidata {
  fecha: Date;
  ventana: VentanaTurno;
}

const MS_POR_MINUTO = 60_000;

function horaEnFecha(fecha: Date, horaHHmm: string): Date {
  const [horas = 0, minutos = 0] = horaHHmm.split(':').map(Number);
  const d = new Date(fecha);
  d.setHours(horas, minutos, 0, 0);
  return d;
}

export function construirVentanaTurno(
  fecha: Date,
  turno: TurnoHorario,
  margenAntesMinutos: number,
  margenDespuesMinutos: number,
): VentanaTurno {
  const inicioTurno = horaEnFecha(fecha, turno.horaInicio);
  let finTurno = horaEnFecha(fecha, turno.horaFin);
  if (finTurno.getTime() <= inicioTurno.getTime()) {
    finTurno = new Date(finTurno.getTime() + 24 * 60 * MS_POR_MINUTO); // cruza medianoche
  }
  return {
    inicioTurno,
    finTurno,
    inicioVentana: new Date(inicioTurno.getTime() - margenAntesMinutos * MS_POR_MINUTO),
    finVentana: new Date(finTurno.getTime() + margenDespuesMinutos * MS_POR_MINUTO),
  };
}

export function atribuirFechaTurno(
  timestamp: Date,
  candidatas: VentanaCandidata[],
): Date | null {
  let mejor: VentanaCandidata | null = null;
  let mejorDistancia = Infinity;
  for (const candidata of candidatas) {
    const { inicioVentana, finVentana, inicioTurno } = candidata.ventana;
    if (timestamp.getTime() < inicioVentana.getTime() || timestamp.getTime() > finVentana.getTime()) {
      continue;
    }
    const distancia = Math.abs(timestamp.getTime() - inicioTurno.getTime());
    if (distancia < mejorDistancia) {
      mejor = candidata;
      mejorDistancia = distancia;
    }
  }
  return mejor ? mejor.fecha : null;
}
```

- [ ] **Step 4: Verificar que pasa**

Run: `pnpm --filter @rrhh/api test -- ventana-turno`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/attendance/calculators/ventana-turno.calculator.ts apps/api/src/modules/attendance/calculators/ventana-turno.calculator.spec.ts
git commit -m "feat(turnos): calculador de ventana de captura con atribución de fecha de turno"
```

---

### Task 4: `turno-cumplimiento.calculator` — retraso, tardanza, compensación, déficit

**Files:**
- Create: `apps/api/src/modules/attendance/calculators/turno-cumplimiento.calculator.ts`
- Test: `apps/api/src/modules/attendance/calculators/turno-cumplimiento.calculator.spec.ts`

**Interfaces:**
- Consumes: `VentanaTurno` (Task 3), `MarcacionDia` (asistencia-resumen.calculator).
- Produces: `evaluarCumplimientoTurno(input: CumplimientoTurnoInput): CumplimientoTurnoResult` — consumido por `TurnoRecalculoService` (Task 6).

- [ ] **Step 1: Escribir los tests que fallan**

```typescript
// apps/api/src/modules/attendance/calculators/turno-cumplimiento.calculator.spec.ts
import { construirVentanaTurno } from './ventana-turno.calculator';
import { evaluarCumplimientoTurno } from './turno-cumplimiento.calculator';

const NOCHE = { horaInicio: '20:00', horaFin: '08:00' };
const DIA = { horaInicio: '08:30', horaFin: '18:00' };

function marca(tipo: 'ENTRADA' | 'SALIDA', d: Date) {
  return { tipo, timestampActual: d } as const;
}

describe('evaluarCumplimientoTurno', () => {
  const ventanaNoche = construirVentanaTurno(new Date(2026, 6, 20), NOCHE, 120, 240);
  const baseNoche = { ventana: ventanaNoche, horasEsperadas: 12, toleranciaMinutos: 30 };

  it('turno NOCHE puntual y completo: 12.13 h en un solo día, sin retraso ni déficit', () => {
    const r = evaluarCumplimientoTurno({
      ...baseNoche,
      marcaciones: [
        marca('ENTRADA', new Date(2026, 6, 20, 19, 55)),
        marca('SALIDA', new Date(2026, 6, 21, 8, 3)),
      ],
    });
    expect(r.horasTrabajadas).toBeCloseTo(12.13, 2);
    expect(r.minutosRetraso).toBe(0);
    expect(r.tardanzaMinutos).toBe(0);
    expect(r.deficitMinutos).toBe(0);
    expect(r.falta).toBe(false);
  });

  it('gracia: 29 min de retraso no es tardanza formal pero sí exige compensación', () => {
    const ventana = construirVentanaTurno(new Date(2026, 6, 20), DIA, 120, 240);
    const r = evaluarCumplimientoTurno({
      ventana,
      horasEsperadas: 9.5,
      toleranciaMinutos: 30,
      marcaciones: [
        marca('ENTRADA', new Date(2026, 6, 20, 8, 59)), // 29 min tarde
        marca('SALIDA', new Date(2026, 6, 20, 18, 29)), // compensó
      ],
    });
    expect(r.minutosRetraso).toBe(29);
    expect(r.tardanzaMinutos).toBe(0); // dentro de la gracia
    expect(r.salidaEsperada).toEqual(new Date(2026, 6, 20, 18, 29));
    expect(r.deficitMinutos).toBe(0);
  });

  it('a los 30:00 exactos ya es tardanza formal (>=), contada desde la hora oficial', () => {
    const ventana = construirVentanaTurno(new Date(2026, 6, 20), DIA, 120, 240);
    const r = evaluarCumplimientoTurno({
      ventana,
      horasEsperadas: 9.5,
      toleranciaMinutos: 30,
      marcaciones: [
        marca('ENTRADA', new Date(2026, 6, 20, 9, 0)), // 30 min exactos
        marca('SALIDA', new Date(2026, 6, 20, 18, 30)),
      ],
    });
    expect(r.minutosRetraso).toBe(30);
    expect(r.tardanzaMinutos).toBe(30);
    expect(r.deficitMinutos).toBe(0); // compensó saliendo 18:30
  });

  it('no compensa: sale a la hora normal con 20 min de retraso → déficit 20', () => {
    const ventana = construirVentanaTurno(new Date(2026, 6, 20), DIA, 120, 240);
    const r = evaluarCumplimientoTurno({
      ventana,
      horasEsperadas: 9.5,
      toleranciaMinutos: 30,
      marcaciones: [
        marca('ENTRADA', new Date(2026, 6, 20, 8, 50)),
        marca('SALIDA', new Date(2026, 6, 20, 18, 0)),
      ],
    });
    expect(r.minutosRetraso).toBe(20);
    expect(r.salidaEsperada).toEqual(new Date(2026, 6, 20, 18, 20));
    expect(r.deficitMinutos).toBe(20);
  });

  it('horas extra: lo trabajado después de la salida esperada (la compensación no cuenta)', () => {
    const r = evaluarCumplimientoTurno({
      ...baseNoche,
      marcaciones: [
        marca('ENTRADA', new Date(2026, 6, 20, 20, 10)), // 10 min retraso
        marca('SALIDA', new Date(2026, 6, 21, 9, 10)), // esperada 08:10 → 1h extra
      ],
    });
    expect(r.minutosRetraso).toBe(10);
    expect(r.horasExtras).toBeCloseTo(1, 2);
    expect(r.deficitMinutos).toBe(0);
  });

  it('sin marcaciones: falta (salvo justificación aprobada)', () => {
    const sinJust = evaluarCumplimientoTurno({ ...baseNoche, marcaciones: [] });
    expect(sinJust.falta).toBe(true);
    const conJust = evaluarCumplimientoTurno({
      ...baseNoche,
      marcaciones: [],
      justificacionAprobada: { id: 'j-1' },
    });
    expect(conJust.falta).toBe(false);
    expect(conJust.justificado).toBe(true);
  });

  it('entrada sin salida: inconsistente, sin horas', () => {
    const r = evaluarCumplimientoTurno({
      ...baseNoche,
      marcaciones: [marca('ENTRADA', new Date(2026, 6, 20, 19, 58))],
    });
    expect(r.inconsistente).toBe(true);
    expect(r.horasTrabajadas).toBe(0);
  });
});
```

- [ ] **Step 2: Verificar que falla**

Run: `pnpm --filter @rrhh/api test -- turno-cumplimiento`
Expected: FAIL — `Cannot find module './turno-cumplimiento.calculator'`

- [ ] **Step 3: Implementación mínima**

```typescript
// apps/api/src/modules/attendance/calculators/turno-cumplimiento.calculator.ts
/**
 * Cumplimiento de un turno asignado (spec §4.2):
 * - minutosRetraso: entrada real − inicio de turno (ceil), aunque esté en gracia.
 * - tardanzaMinutos: solo si minutosRetraso >= tolerancia (a los 30:00 ya es
 *   tarde); se cuenta desde la hora oficial.
 * - salidaEsperada = fin de turno + minutosRetraso (compensación minuto a minuto).
 * - deficitMinutos = max(salida esperada − salida real, horas esperadas −
 *   trabajadas, 0) en minutos.
 * - horasExtras = max(0, salida real − salida esperada) en horas.
 * @pure
 */
import { MarcacionDia } from './asistencia-resumen.calculator';
import { VentanaTurno } from './ventana-turno.calculator';

export interface CumplimientoTurnoInput {
  ventana: VentanaTurno;
  horasEsperadas: number;
  toleranciaMinutos: number;
  marcaciones: MarcacionDia[];
  justificacionAprobada?: { id: string };
}

export interface CumplimientoTurnoResult {
  horaEntrada: Date | null;
  horaSalida: Date | null;
  horasTrabajadas: number;
  minutosRetraso: number;
  tardanzaMinutos: number;
  salidaEsperada: Date | null;
  deficitMinutos: number;
  horasExtras: number;
  falta: boolean;
  justificado: boolean;
  justificacionId: string | null;
  inconsistente: boolean;
}

const MS_POR_MINUTO = 60_000;
const MS_POR_HORA = 3_600_000;

function redondear2(valor: number): number {
  return Math.round(valor * 100) / 100;
}

export function evaluarCumplimientoTurno(input: CumplimientoTurnoInput): CumplimientoTurnoResult {
  const entradas = input.marcaciones
    .filter((m) => m.tipo === 'ENTRADA')
    .sort((a, b) => a.timestampActual.getTime() - b.timestampActual.getTime());
  const salidas = input.marcaciones
    .filter((m) => m.tipo === 'SALIDA')
    .sort((a, b) => a.timestampActual.getTime() - b.timestampActual.getTime());

  const horaEntrada = entradas[0]?.timestampActual ?? null;
  const horaSalida = salidas[salidas.length - 1]?.timestampActual ?? null;
  const justificado = input.justificacionAprobada !== undefined;
  const sinMarcaciones = horaEntrada === null && horaSalida === null;
  const falta = sinMarcaciones && !justificado;
  const inconsistente = !sinMarcaciones && (horaEntrada === null || horaSalida === null);

  const minutosRetraso =
    horaEntrada !== null
      ? Math.max(
          0,
          Math.ceil((horaEntrada.getTime() - input.ventana.inicioTurno.getTime()) / MS_POR_MINUTO),
        )
      : 0;
  const tardanzaMinutos = minutosRetraso >= input.toleranciaMinutos ? minutosRetraso : 0;
  const salidaEsperada =
    horaEntrada !== null
      ? new Date(input.ventana.finTurno.getTime() + minutosRetraso * MS_POR_MINUTO)
      : null;

  let horasTrabajadas = 0;
  let deficitMinutos = 0;
  let horasExtras = 0;
  if (horaEntrada !== null && horaSalida !== null && salidaEsperada !== null) {
    horasTrabajadas = redondear2((horaSalida.getTime() - horaEntrada.getTime()) / MS_POR_HORA);
    const deficitSalida = Math.ceil(
      (salidaEsperada.getTime() - horaSalida.getTime()) / MS_POR_MINUTO,
    );
    const deficitHoras = Math.ceil((input.horasEsperadas - horasTrabajadas) * 60);
    deficitMinutos = Math.max(0, deficitSalida, deficitHoras);
    horasExtras = redondear2(
      Math.max(0, (horaSalida.getTime() - salidaEsperada.getTime()) / MS_POR_HORA),
    );
  }

  return {
    horaEntrada,
    horaSalida,
    horasTrabajadas,
    minutosRetraso,
    tardanzaMinutos,
    salidaEsperada,
    deficitMinutos,
    horasExtras,
    falta,
    justificado,
    justificacionId: input.justificacionAprobada?.id ?? null,
    inconsistente,
  };
}
```

- [ ] **Step 4: Verificar que pasa**

Run: `pnpm --filter @rrhh/api test -- turno-cumplimiento`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/attendance/calculators/turno-cumplimiento.calculator.ts apps/api/src/modules/attendance/calculators/turno-cumplimiento.calculator.spec.ts
git commit -m "feat(turnos): calculador de cumplimiento con gracia 29:59, compensación y déficit"
```

---

### Task 5: Ajuste de tolerancia `>` → `>=` en el resumen estándar

**Files:**
- Modify: `apps/api/src/modules/attendance/calculators/asistencia-resumen.calculator.ts:120`
- Modify: `apps/api/src/modules/attendance/calculators/asistencia-resumen.calculator.spec.ts`

**Interfaces:**
- Produces: semántica unificada de gracia para TODO el personal — llegar exactamente al minuto de tolerancia YA es tarde (consistente con `turno-cumplimiento.calculator`).

- [ ] **Step 1: Agregar el test del límite exacto al spec existente** (dentro del `describe` de `construirResumenDia`):

```typescript
  it('llegar exactamente al minuto de tolerancia ya es tardanza (>=)', () => {
    const resumen = construirResumenDia(
      [
        { tipo: 'ENTRADA', timestampActual: new Date(2026, 6, 20, 8, 30) }, // tolerancia 30 sobre 08:00
        { tipo: 'SALIDA', timestampActual: new Date(2026, 6, 20, 17, 0) },
      ],
      { horaInicioDia: '08:00', minutosToleranciaEntrada: 30, horasJornada: 8 },
    );
    expect(resumen.tardanzaMinutos).toBe(30);
  });
```

- [ ] **Step 2: Verificar que falla**

Run: `pnpm --filter @rrhh/api test -- asistencia-resumen`
Expected: FAIL — el test nuevo espera 30 y recibe 0 (la comparación actual es `>` estricta).

- [ ] **Step 3: Cambiar la comparación**

En `asistencia-resumen.calculator.ts`, reemplazar:

```typescript
    if (horaEntrada.getTime() > limiteTolerancia.getTime()) {
```

por:

```typescript
    // >=: llegar exactamente al minuto de tolerancia ya es tarde (la gracia
    // es de tolerancia − 1 seg, ej. 29:59 con tolerancia 30). Spec turnos §1.
    if (horaEntrada.getTime() >= limiteTolerancia.getTime()) {
```

- [ ] **Step 4: Correr la suite del calculador y luego la completa**

Run: `pnpm --filter @rrhh/api test -- asistencia-resumen`
Expected: PASS. Si algún test existente asumía que llegar exactamente al límite no era tarde, ajustar ese test restándole 1 minuto a la entrada (la nueva semántica es la correcta según el spec).
Run: `pnpm --filter @rrhh/api test`
Expected: todo verde.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/attendance/calculators/asistencia-resumen.calculator.ts apps/api/src/modules/attendance/calculators/asistencia-resumen.calculator.spec.ts
git commit -m "fix(asistencia): llegar exactamente al minuto de tolerancia ya cuenta como tardanza"
```

---

### Task 6: `TurnoRecalculoService` — recálculo del resumen por fecha de turno

**Files:**
- Create: `apps/api/src/modules/attendance/turno-recalculo.service.ts`
- Test: `apps/api/src/modules/attendance/turno-recalculo.service.spec.ts`

**Interfaces:**
- Consumes: `construirVentanaTurno`, `atribuirFechaTurno` (Task 3), `evaluarCumplimientoTurno` (Task 4).
- Produces: `recalcularConTurno(tx, tenantId, employeeId, timestampReferencia, config): Promise<boolean>` — retorna `true` si el día fue manejado por el flujo de turnos (con o sin plan ese día) y `false` si el empleado no tiene plan en el mes (el caller usa el flujo estándar). Consumido por `AttendanceService` y `AttendanceImportService` (Task 7) y por los services de shifts (Tasks 8-9) para recálculos retroactivos.

- [ ] **Step 1: Escribir los tests que fallan**

```typescript
// apps/api/src/modules/attendance/turno-recalculo.service.spec.ts
import { TurnoRecalculoService } from './turno-recalculo.service';

const TURNO_NOCHE = {
  id: 'turno-noche',
  codigo: 'NOCHE',
  horaInicio: '20:00',
  horaFin: '08:00',
  horasEsperadas: { toNumber: () => 12 },
  toleranciaMinutos: 30,
};

const CONFIG = {
  horaEntradaEstandar: '08:00',
  toleranciaTardanzaMinutos: 30,
  horasJornada: 8,
  ventanaAntesTurnoMinutos: 120,
  ventanaDespuesTurnoMinutos: 240,
};

function mockTx(overrides: any = {}) {
  return {
    turnoAsignacion: { findMany: jest.fn().mockResolvedValue([]), count: jest.fn().mockResolvedValue(0) },
    marcacion: { findMany: jest.fn().mockResolvedValue([]) },
    justificacion: { findFirst: jest.fn().mockResolvedValue(null) },
    asistenciaResumen: { upsert: jest.fn() },
    horasExtra: { upsert: jest.fn() },
    ...overrides,
  };
}

describe('TurnoRecalculoService', () => {
  const service = new TurnoRecalculoService();

  it('empleado sin plan en el mes → false (flujo estándar)', async () => {
    const tx = mockTx();
    const manejado = await service.recalcularConTurno(
      tx, 't-1', 'emp-1', new Date(2026, 6, 21, 8, 3), CONFIG,
    );
    expect(manejado).toBe(false);
    expect(tx.asistenciaResumen.upsert).not.toHaveBeenCalled();
  });

  it('salida a las 08:03 del día siguiente: el resumen se upserta en la FECHA DEL TURNO', async () => {
    const tx = mockTx();
    tx.turnoAsignacion.count.mockResolvedValue(10); // tiene plan en el mes
    tx.turnoAsignacion.findMany.mockResolvedValue([
      { fecha: new Date(2026, 6, 20), tipoDia: 'TURNO', turno: TURNO_NOCHE },
    ]);
    tx.marcacion.findMany.mockResolvedValue([
      { tipo: 'ENTRADA', timestamp: new Date(2026, 6, 20, 19, 55) },
      { tipo: 'SALIDA', timestamp: new Date(2026, 6, 21, 8, 3) },
    ]);

    const manejado = await service.recalcularConTurno(
      tx, 't-1', 'emp-1', new Date(2026, 6, 21, 8, 3), CONFIG,
    );

    expect(manejado).toBe(true);
    const upsert = tx.asistenciaResumen.upsert.mock.calls[0][0];
    expect(upsert.where.tenantId_employeeId_fecha.fecha).toEqual(new Date(2026, 6, 20));
    expect(upsert.update.turnoId).toBe('turno-noche');
    expect(upsert.update.horasTrabajadas).toBeCloseTo(12.13, 2);
    expect(upsert.update.sinPlan).toBe(false);
  });

  it('horas extra del turno se upsertan en la fecha del turno', async () => {
    const tx = mockTx();
    tx.turnoAsignacion.count.mockResolvedValue(10);
    tx.turnoAsignacion.findMany.mockResolvedValue([
      { fecha: new Date(2026, 6, 20), tipoDia: 'TURNO', turno: TURNO_NOCHE },
    ]);
    tx.marcacion.findMany.mockResolvedValue([
      { tipo: 'ENTRADA', timestamp: new Date(2026, 6, 20, 20, 0) },
      { tipo: 'SALIDA', timestamp: new Date(2026, 6, 21, 9, 0) }, // 1h extra
    ]);

    await service.recalcularConTurno(tx, 't-1', 'emp-1', new Date(2026, 6, 21, 9, 0), CONFIG);

    const upsertHe = tx.horasExtra.upsert.mock.calls[0][0];
    expect(upsertHe.where.tenantId_employeeId_fecha_tipo.fecha).toEqual(new Date(2026, 6, 20));
    expect(upsertHe.create.horasCalculadas).toBeCloseTo(1, 2);
  });

  it('marcación fuera de toda ventana con plan en el mes → resumen del día calendario con sinPlan=true', async () => {
    const tx = mockTx();
    tx.turnoAsignacion.count.mockResolvedValue(10);
    tx.turnoAsignacion.findMany.mockResolvedValue([]); // sin turno D-1..D+1
    tx.marcacion.findMany.mockResolvedValue([
      { tipo: 'ENTRADA', timestamp: new Date(2026, 6, 22, 8, 0) },
      { tipo: 'SALIDA', timestamp: new Date(2026, 6, 22, 20, 0) },
    ]);

    const manejado = await service.recalcularConTurno(
      tx, 't-1', 'emp-1', new Date(2026, 6, 22, 20, 0), CONFIG,
    );

    expect(manejado).toBe(true);
    const upsert = tx.asistenciaResumen.upsert.mock.calls[0][0];
    expect(upsert.where.tenantId_employeeId_fecha.fecha).toEqual(new Date(2026, 6, 22));
    expect(upsert.update.sinPlan).toBe(true);
    expect(upsert.update.turnoId).toBeNull();
  });
});
```

- [ ] **Step 2: Verificar que falla**

Run: `pnpm --filter @rrhh/api test -- turno-recalculo`
Expected: FAIL — `Cannot find module './turno-recalculo.service'`

- [ ] **Step 3: Implementación**

```typescript
// apps/api/src/modules/attendance/turno-recalculo.service.ts
import { Injectable } from '@nestjs/common';
import {
  atribuirFechaTurno,
  construirVentanaTurno,
  VentanaCandidata,
} from './calculators/ventana-turno.calculator';
import { evaluarCumplimientoTurno } from './calculators/turno-cumplimiento.calculator';
import { MarcacionDia } from './calculators/asistencia-resumen.calculator';

const DIA_MS = 24 * 3_600_000;

function inicioDelDia(fecha: Date): Date {
  const d = new Date(fecha);
  d.setHours(0, 0, 0, 0);
  return d;
}

/**
 * Recalcula el AsistenciaResumen por FECHA DE TURNO (spec §4.1/§6): resuelve
 * si la marcación de referencia cae en la ventana de un turno asignado
 * (fechas D−1..D+1) y persiste el cumplimiento en la fecha del turno. Si el
 * empleado tiene plan en el mes pero la marcación no corresponde a ningún
 * turno, el día calendario se marca sinPlan=true (pendiente de resolución
 * RRHH). Si el empleado no tiene plan alguno en el mes, retorna false y el
 * caller usa el flujo estándar (retrocompatibilidad).
 */
@Injectable()
export class TurnoRecalculoService {
  async recalcularConTurno(
    tx: any,
    tenantId: string,
    employeeId: string,
    timestampReferencia: Date,
    config: any,
  ): Promise<boolean> {
    const dia = inicioDelDia(timestampReferencia);
    const inicioMes = new Date(dia.getFullYear(), dia.getMonth(), 1);
    const finMes = new Date(dia.getFullYear(), dia.getMonth() + 1, 0, 23, 59, 59, 999);

    const tienePlanEnMes = await tx.turnoAsignacion.count({
      where: { tenantId, employeeId, fecha: { gte: inicioMes, lte: finMes } },
    });
    if (tienePlanEnMes === 0) return false;

    // Turnos asignados D−1..D+1 (una ventana nocturna de la víspera puede
    // contener la marcación de hoy)
    const asignaciones = await tx.turnoAsignacion.findMany({
      where: {
        tenantId,
        employeeId,
        tipoDia: 'TURNO',
        fecha: { gte: new Date(dia.getTime() - DIA_MS), lte: new Date(dia.getTime() + DIA_MS) },
      },
      include: { turno: true },
    });

    const candidatas: VentanaCandidata[] = asignaciones.map((a: any) => ({
      fecha: inicioDelDia(new Date(a.fecha)),
      ventana: construirVentanaTurno(
        inicioDelDia(new Date(a.fecha)),
        { horaInicio: a.turno.horaInicio, horaFin: a.turno.horaFin },
        config.ventanaAntesTurnoMinutos ?? 120,
        config.ventanaDespuesTurnoMinutos ?? 240,
      ),
    }));

    const fechaTurno = atribuirFechaTurno(timestampReferencia, candidatas);

    if (fechaTurno === null) {
      // Con plan en el mes pero sin turno para esta marcación: día sinPlan
      await this.upsertResumenSinPlan(tx, tenantId, employeeId, dia);
      return true;
    }

    const asignacion = asignaciones.find(
      (a: any) => inicioDelDia(new Date(a.fecha)).getTime() === fechaTurno.getTime(),
    );
    const candidata = candidatas.find((c) => c.fecha.getTime() === fechaTurno.getTime())!;
    const turno = asignacion.turno;

    const marcacionesVentana = await tx.marcacion.findMany({
      where: {
        tenantId,
        employeeId,
        bloqueado: false,
        tipo: { in: ['ENTRADA', 'SALIDA'] },
        timestamp: { gte: candidata.ventana.inicioVentana, lte: candidata.ventana.finVentana },
      },
      orderBy: { timestamp: 'asc' },
    });

    const justificacionAprobada = await tx.justificacion.findFirst({
      where: { tenantId, employeeId, fecha: fechaTurno, estado: 'APROBADA' },
    });

    const marcaciones: MarcacionDia[] = marcacionesVentana.map((m: any) => ({
      tipo: m.tipo,
      timestampActual: m.timestamp,
    }));

    const r = evaluarCumplimientoTurno({
      ventana: candidata.ventana,
      horasEsperadas: turno.horasEsperadas.toNumber
        ? turno.horasEsperadas.toNumber()
        : Number(turno.horasEsperadas),
      toleranciaMinutos: turno.toleranciaMinutos,
      marcaciones,
      justificacionAprobada: justificacionAprobada ? { id: justificacionAprobada.id } : undefined,
    });

    const datos = {
      horaEntrada: r.horaEntrada,
      horaSalida: r.horaSalida,
      horasTrabajadas: r.horasTrabajadas,
      horasExtrasDiarias: r.horasExtras,
      falta: r.falta,
      tardanzaMinutos: r.tardanzaMinutos,
      justificado: r.justificado,
      turnoId: turno.id,
      minutosRetraso: r.minutosRetraso,
      salidaEsperada: r.salidaEsperada,
      deficitMinutos: r.deficitMinutos,
      sinPlan: false,
    };

    await tx.asistenciaResumen.upsert({
      where: { tenantId_employeeId_fecha: { tenantId, employeeId, fecha: fechaTurno } },
      update: datos,
      create: { tenantId, employeeId, fecha: fechaTurno, ...datos },
    });

    if (r.horasExtras > 0) {
      await tx.horasExtra.upsert({
        where: {
          tenantId_employeeId_fecha_tipo: {
            tenantId,
            employeeId,
            fecha: fechaTurno,
            tipo: 'DIARIAS',
          },
        },
        update: { horasCalculadas: r.horasExtras },
        create: {
          tenantId,
          employeeId,
          fecha: fechaTurno,
          tipo: 'DIARIAS',
          horasCalculadas: r.horasExtras,
        },
      });
    }

    return true;
  }

  /** Día trabajado sin turno: horas por diferencia simple + flag sinPlan. */
  private async upsertResumenSinPlan(
    tx: any,
    tenantId: string,
    employeeId: string,
    fecha: Date,
  ): Promise<void> {
    const finDia = new Date(fecha.getTime() + DIA_MS - 1);
    const marcacionesDia = await tx.marcacion.findMany({
      where: {
        tenantId,
        employeeId,
        bloqueado: false,
        tipo: { in: ['ENTRADA', 'SALIDA'] },
        timestamp: { gte: fecha, lte: finDia },
      },
      orderBy: { timestamp: 'asc' },
    });
    const entradas = marcacionesDia.filter((m: any) => m.tipo === 'ENTRADA');
    const salidas = marcacionesDia.filter((m: any) => m.tipo === 'SALIDA');
    const horaEntrada = entradas[0]?.timestamp ?? null;
    const horaSalida = salidas[salidas.length - 1]?.timestamp ?? null;
    const horasTrabajadas =
      horaEntrada && horaSalida
        ? Math.round(((horaSalida.getTime() - horaEntrada.getTime()) / 3_600_000) * 100) / 100
        : 0;

    const datos = {
      horaEntrada,
      horaSalida,
      horasTrabajadas,
      horasExtrasDiarias: 0,
      falta: false,
      tardanzaMinutos: 0,
      justificado: false,
      turnoId: null,
      minutosRetraso: 0,
      salidaEsperada: null,
      deficitMinutos: 0,
      sinPlan: true,
    };
    await tx.asistenciaResumen.upsert({
      where: { tenantId_employeeId_fecha: { tenantId, employeeId, fecha } },
      update: datos,
      create: { tenantId, employeeId, fecha, ...datos },
    });
  }
}
```

- [ ] **Step 4: Verificar que pasa**

Run: `pnpm --filter @rrhh/api test -- turno-recalculo`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/attendance/turno-recalculo.service.ts apps/api/src/modules/attendance/turno-recalculo.service.spec.ts
git commit -m "feat(turnos): servicio de recálculo del resumen por fecha de turno"
```

---

### Task 7: Integración en `AttendanceService` y `AttendanceImportService`

**Files:**
- Modify: `apps/api/src/modules/attendance/attendance.service.ts`
- Modify: `apps/api/src/modules/attendance/attendance-import.service.ts`
- Modify: `apps/api/src/modules/attendance/attendance.module.ts`
- Test: `apps/api/src/modules/attendance/attendance.service.spec.ts` (agregar describe)

**Interfaces:**
- Consumes: `TurnoRecalculoService.recalcularConTurno` (Task 6).
- Produces: ambos flujos (marcación en vivo e import del reloj) recalculan por fecha de turno cuando aplica. `AttendanceModule` exporta `TurnoRecalculoService` (consumido por `ShiftsModule` en Task 11).

- [ ] **Step 1: Agregar test al spec de AttendanceService**

```typescript
// agregar a attendance.service.spec.ts (usa los mocks/tx del spec existente)
describe('AttendanceService — integración con turnos', () => {
  it('si TurnoRecalculoService maneja el día, no se ejecuta el recálculo estándar', async () => {
    const turnoRecalculo = { recalcularConTurno: jest.fn().mockResolvedValue(true) } as any;
    const service = new AttendanceService(turnoRecalculo);
    const tx = crearTxValido(); // helper existente del spec (tx con config, geofence y sin previas)
    await service.registrarMarcacion(tx, {
      ...inputSalidaValida(), // helper existente del spec para una SALIDA válida
    });
    expect(turnoRecalculo.recalcularConTurno).toHaveBeenCalled();
    expect(tx.asistenciaResumen.upsert).not.toHaveBeenCalled();
  });
});
```

**Nota:** si el spec existente no tiene helpers `crearTxValido`/`inputSalidaValida`, construir el tx y el input igual que el test existente de "SALIDA válida recalcula el resumen" de ese spec (copiar su arrange). El servicio sin argumento de constructor debe seguir funcionando: los tests existentes crean `new AttendanceService()` y deben pasar sin cambios.

- [ ] **Step 2: Verificar que falla**

Run: `pnpm --filter @rrhh/api test -- attendance.service`
Expected: FAIL — el constructor no acepta argumentos / `recalcularConTurno` nunca es invocado.

- [ ] **Step 3: Modificar `AttendanceService`**

1. Import: `import { TurnoRecalculoService } from './turno-recalculo.service';`
2. Constructor (opcional para no romper specs existentes — mismo patrón que `CeseDocumentsService` en `TerminationService`):

```typescript
  constructor(private readonly turnoRecalculo?: TurnoRecalculoService) {}
```

3. En `registrarMarcacion`, reemplazar el bloque del paso 6 (`if (input.tipo === 'SALIDA') { await this.recalcularResumenDelDia(...) }`) por:

```typescript
    // 6. SALIDA válida → recálculo. Primero el flujo de turnos (fecha de
    //    turno); si el empleado no tiene plan, el flujo estándar de siempre.
    if (input.tipo === 'SALIDA') {
      const manejadoPorTurno = this.turnoRecalculo
        ? await this.turnoRecalculo.recalcularConTurno(
            tx, tenantId, employeeId, input.timestamp, config,
          )
        : false;
      if (!manejadoPorTurno) {
        await this.recalcularResumenDelDia(
          tx, tenantId, employeeId, input.timestamp, config,
          [...marcacionesPrevias, marcacion],
        );
      }
    }
```

- [ ] **Step 4: Modificar `AttendanceImportService`**

1. Import y constructor igual que en el paso anterior:

```typescript
  constructor(private readonly turnoRecalculo?: TurnoRecalculoService) {}
```

2. En `marcarDiaAfectado`, guardar además un timestamp de ejemplo del día (cambiar el value del Map a `{ employeeId, fecha, timestampEjemplo }`; al registrar por primera vez, `timestampEjemplo = timestamp`).
3. En el bucle final de `importarCsv`, reemplazar la llamada directa por:

```typescript
    for (const { employeeId, fecha, timestampEjemplo } of diasAfectados.values()) {
      const manejadoPorTurno = this.turnoRecalculo
        ? await this.turnoRecalculo.recalcularConTurno(
            tx, tenantId, employeeId, timestampEjemplo, config,
          )
        : false;
      if (!manejadoPorTurno) {
        await this.recalcularResumenDelDia(tx, tenantId, employeeId, fecha, config);
      }
    }
```

- [ ] **Step 5: Registrar y exportar en `attendance.module.ts`**

Agregar `TurnoRecalculoService` a `providers` y a `exports` del módulo (crear el array `exports` si no existe).

- [ ] **Step 6: Suite completa**

Run: `pnpm --filter @rrhh/api test`
Expected: todo verde (los tests existentes de attendance siguen pasando: constructor sin argumento ⇒ flujo estándar).

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/attendance/
git commit -m "feat(turnos): marcación en vivo e import del reloj recalculan por fecha de turno"
```

---

### Task 8: `ShiftPlanService` — catálogo + plan con GOZADO automático

**Files:**
- Create: `apps/api/src/modules/shifts/shift-plan.service.ts`
- Test: `apps/api/src/modules/shifts/shift-plan.service.spec.ts`

**Interfaces:**
- Produces: `listarTurnos(tx, incluirInactivos?)`, `crearTurno(tx, input)`, `actualizarTurno(tx, id, cambios)`, `obtenerPlan(tx, desde, hasta, employeeId?)`, `upsertAsignacion(tx, input: UpsertAsignacionInput)` con `UpsertAsignacionInput = { tenantId, employeeId, fecha: Date, tipoDia, turnoId?, notas?, creadoPor, forzarSinSaldo?: boolean }` — consumidos por el controller (Task 11) y el import (Task 9).

- [ ] **Step 1: Escribir los tests que fallan**

```typescript
// apps/api/src/modules/shifts/shift-plan.service.spec.ts
import { BadRequestException, UnprocessableEntityException } from '@nestjs/common';
import { ShiftPlanService } from './shift-plan.service';

function mockTx(overrides: any = {}) {
  return {
    turno: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue(null),
      findUnique: jest.fn().mockResolvedValue({ id: 'turno-1', activo: true }),
      create: jest.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 'turno-1', ...data })),
      update: jest.fn(),
    },
    employee: { findUnique: jest.fn().mockResolvedValue({ id: 'emp-1', estado: 'activo' }) },
    turnoAsignacion: {
      findUnique: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
      upsert: jest.fn().mockImplementation(({ create }: any) => Promise.resolve({ id: 'asig-1', ...create })),
    },
    compensatorioMovimiento: {
      aggregate: jest.fn().mockResolvedValue({ _sum: { dias: 0 } }),
      create: jest.fn(),
    },
    ...overrides,
  };
}

const service = new ShiftPlanService();

describe('ShiftPlanService — catálogo', () => {
  it('crearTurno valida formato HH:mm y horas > 0', async () => {
    const tx = mockTx();
    await expect(
      service.crearTurno(tx, { tenantId: 't-1', codigo: 'X', nombre: 'X', horaInicio: '25:00', horaFin: '08:00', horasEsperadas: 12 }),
    ).rejects.toThrow(BadRequestException);
    await expect(
      service.crearTurno(tx, { tenantId: 't-1', codigo: 'X', nombre: 'X', horaInicio: '08:00', horaFin: '20:00', horasEsperadas: 0 }),
    ).rejects.toThrow(BadRequestException);
  });

  it('crearTurno rechaza código duplicado (409)', async () => {
    const tx = mockTx();
    tx.turno.findFirst.mockResolvedValue({ id: 'ya-existe' });
    await expect(
      service.crearTurno(tx, { tenantId: 't-1', codigo: 'DIA', nombre: 'Día', horaInicio: '08:00', horaFin: '20:00', horasEsperadas: 12 }),
    ).rejects.toThrow('Ya existe un turno con código "DIA"');
  });
});

describe('ShiftPlanService — plan', () => {
  it('upsert TURNO exige turno existente y activo', async () => {
    const tx = mockTx();
    tx.turno.findUnique.mockResolvedValue({ id: 'turno-1', activo: false });
    await expect(
      service.upsertAsignacion(tx, { tenantId: 't-1', employeeId: 'emp-1', fecha: new Date(2026, 7, 1), tipoDia: 'TURNO', turnoId: 'turno-1', creadoPor: 'u-1' }),
    ).rejects.toThrow(BadRequestException);
  });

  it('rechaza asignar a empleado cesado', async () => {
    const tx = mockTx();
    tx.employee.findUnique.mockResolvedValue({ id: 'emp-1', estado: 'cesado' });
    await expect(
      service.upsertAsignacion(tx, { tenantId: 't-1', employeeId: 'emp-1', fecha: new Date(2026, 7, 1), tipoDia: 'DESCANSO', creadoPor: 'u-1' }),
    ).rejects.toThrow(BadRequestException);
  });

  it('DESCANSO_COMPENSATORIO con saldo > 0 registra GOZADO −1 vinculado', async () => {
    const tx = mockTx();
    tx.compensatorioMovimiento.aggregate.mockResolvedValue({ _sum: { dias: 2 } });
    await service.upsertAsignacion(tx, { tenantId: 't-1', employeeId: 'emp-1', fecha: new Date(2026, 7, 5), tipoDia: 'DESCANSO_COMPENSATORIO', creadoPor: 'u-1' });
    expect(tx.compensatorioMovimiento.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ tipo: 'GOZADO', dias: -1, turnoAsignacionId: 'asig-1' }),
      }),
    );
  });

  it('DESCANSO_COMPENSATORIO sin saldo → 422; con forzarSinSaldo + notas pasa', async () => {
    const tx = mockTx();
    await expect(
      service.upsertAsignacion(tx, { tenantId: 't-1', employeeId: 'emp-1', fecha: new Date(2026, 7, 5), tipoDia: 'DESCANSO_COMPENSATORIO', creadoPor: 'u-1' }),
    ).rejects.toThrow(UnprocessableEntityException);

    await service.upsertAsignacion(tx, { tenantId: 't-1', employeeId: 'emp-1', fecha: new Date(2026, 7, 5), tipoDia: 'DESCANSO_COMPENSATORIO', creadoPor: 'u-1', forzarSinSaldo: true, notas: 'autorizado por gerencia' });
    expect(tx.compensatorioMovimiento.create).toHaveBeenCalled();
  });

  it('cambiar un COMPENSATORIO previo a otro tipo registra la reversión (+1)', async () => {
    const tx = mockTx();
    tx.turnoAsignacion.findUnique.mockResolvedValue({ id: 'asig-1', tipoDia: 'DESCANSO_COMPENSATORIO' });
    await service.upsertAsignacion(tx, { tenantId: 't-1', employeeId: 'emp-1', fecha: new Date(2026, 7, 5), tipoDia: 'DESCANSO', creadoPor: 'u-1' });
    expect(tx.compensatorioMovimiento.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ tipo: 'GOZADO', dias: 1 }),
      }),
    );
  });
});
```

- [ ] **Step 2: Verificar que falla**

Run: `pnpm --filter @rrhh/api test -- shift-plan.service`
Expected: FAIL — `Cannot find module './shift-plan.service'`

- [ ] **Step 3: Implementación**

```typescript
// apps/api/src/modules/shifts/shift-plan.service.ts
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';

const HORA_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;
export type TipoDiaPlan = 'TURNO' | 'DESCANSO' | 'DESCANSO_COMPENSATORIO';

export interface CrearTurnoInput {
  tenantId: string;
  codigo: string;
  nombre: string;
  horaInicio: string;
  horaFin: string;
  horasEsperadas: number;
  toleranciaMinutos?: number;
}

export interface UpsertAsignacionInput {
  tenantId: string;
  employeeId: string;
  fecha: Date;
  tipoDia: TipoDiaPlan;
  turnoId?: string;
  notas?: string;
  creadoPor: string;
  /** Permite programar goce sin saldo (queda auditado; exige notas). */
  forzarSinSaldo?: boolean;
}

/**
 * Catálogo de turnos y plan empleado×fecha (spec §3.1/§3.2/§4.5). Asignar
 * DESCANSO_COMPENSATORIO registra GOZADO −1 en el libro; quitar/cambiar ese
 * día registra el movimiento inverso (+1) — el libro es append-only.
 */
@Injectable()
export class ShiftPlanService {
  async listarTurnos(tx: any, incluirInactivos = false): Promise<any[]> {
    return tx.turno.findMany({
      where: incluirInactivos ? {} : { activo: true },
      orderBy: { codigo: 'asc' },
    });
  }

  async crearTurno(tx: any, input: CrearTurnoInput): Promise<any> {
    this.validarHorario(input.horaInicio, input.horaFin, input.horasEsperadas);
    const existente = await tx.turno.findFirst({ where: { codigo: input.codigo } });
    if (existente) {
      throw new ConflictException(`Ya existe un turno con código "${input.codigo}"`);
    }
    return tx.turno.create({
      data: {
        tenantId: input.tenantId,
        codigo: input.codigo,
        nombre: input.nombre,
        horaInicio: input.horaInicio,
        horaFin: input.horaFin,
        horasEsperadas: input.horasEsperadas,
        toleranciaMinutos: input.toleranciaMinutos ?? 30,
      },
    });
  }

  async actualizarTurno(
    tx: any,
    id: string,
    cambios: Partial<Omit<CrearTurnoInput, 'tenantId' | 'codigo'>> & { activo?: boolean },
  ): Promise<any> {
    const turno = await tx.turno.findUnique({ where: { id } });
    if (!turno) throw new NotFoundException(`Turno ${id} no encontrado`);
    if (cambios.horaInicio !== undefined || cambios.horaFin !== undefined || cambios.horasEsperadas !== undefined) {
      this.validarHorario(
        cambios.horaInicio ?? turno.horaInicio,
        cambios.horaFin ?? turno.horaFin,
        cambios.horasEsperadas ?? Number(turno.horasEsperadas),
      );
    }
    return tx.turno.update({ where: { id }, data: cambios });
  }

  async obtenerPlan(tx: any, desde: Date, hasta: Date, employeeId?: string): Promise<any[]> {
    return tx.turnoAsignacion.findMany({
      where: { fecha: { gte: desde, lte: hasta }, ...(employeeId ? { employeeId } : {}) },
      include: {
        turno: { select: { codigo: true, nombre: true, horaInicio: true, horaFin: true } },
        employee: { select: { nombres: true, apellidos: true, numeroDocumento: true } },
      },
      orderBy: [{ employeeId: 'asc' }, { fecha: 'asc' }],
    });
  }

  async upsertAsignacion(tx: any, input: UpsertAsignacionInput): Promise<any> {
    const empleado = await tx.employee.findUnique({ where: { id: input.employeeId } });
    if (!empleado) throw new NotFoundException(`Empleado ${input.employeeId} no encontrado`);
    if (empleado.estado === 'cesado') {
      throw new BadRequestException('No se puede asignar plan a un empleado cesado');
    }

    if (input.tipoDia === 'TURNO') {
      if (!input.turnoId) throw new BadRequestException('tipoDia TURNO requiere turnoId');
      const turno = await tx.turno.findUnique({ where: { id: input.turnoId } });
      if (!turno || !turno.activo) {
        throw new BadRequestException('El turno no existe o está inactivo');
      }
    }

    const previa = await tx.turnoAsignacion.findUnique({
      where: {
        tenantId_employeeId_fecha: {
          tenantId: input.tenantId,
          employeeId: input.employeeId,
          fecha: input.fecha,
        },
      },
    });

    // Programar goce: exige saldo > 0 (o forzar con notas — spec §4.5)
    if (input.tipoDia === 'DESCANSO_COMPENSATORIO' && previa?.tipoDia !== 'DESCANSO_COMPENSATORIO') {
      const agregado = await tx.compensatorioMovimiento.aggregate({
        where: { employeeId: input.employeeId },
        _sum: { dias: true },
      });
      const saldo = Number(agregado._sum.dias ?? 0);
      if (saldo <= 0 && !input.forzarSinSaldo) {
        throw new UnprocessableEntityException({
          message: `El empleado no tiene saldo de compensatorios (saldo: ${saldo})`,
          saldo,
        });
      }
      if (saldo <= 0 && !input.notas) {
        throw new BadRequestException('Forzar goce sin saldo requiere notas');
      }
    }

    const asignacion = await tx.turnoAsignacion.upsert({
      where: {
        tenantId_employeeId_fecha: {
          tenantId: input.tenantId,
          employeeId: input.employeeId,
          fecha: input.fecha,
        },
      },
      update: {
        tipoDia: input.tipoDia,
        turnoId: input.tipoDia === 'TURNO' ? input.turnoId : null,
        notas: input.notas ?? null,
      },
      create: {
        tenantId: input.tenantId,
        employeeId: input.employeeId,
        fecha: input.fecha,
        tipoDia: input.tipoDia,
        turnoId: input.tipoDia === 'TURNO' ? input.turnoId : null,
        notas: input.notas ?? null,
      },
    });

    // Movimientos del libro (append-only): alta y reversión de goce
    if (input.tipoDia === 'DESCANSO_COMPENSATORIO' && previa?.tipoDia !== 'DESCANSO_COMPENSATORIO') {
      await tx.compensatorioMovimiento.create({
        data: {
          tenantId: input.tenantId,
          employeeId: input.employeeId,
          tipo: 'GOZADO',
          dias: -1,
          fechaReferencia: input.fecha,
          turnoAsignacionId: asignacion.id,
          creadoPor: input.creadoPor,
        },
      });
    } else if (previa?.tipoDia === 'DESCANSO_COMPENSATORIO' && input.tipoDia !== 'DESCANSO_COMPENSATORIO') {
      await tx.compensatorioMovimiento.create({
        data: {
          tenantId: input.tenantId,
          employeeId: input.employeeId,
          tipo: 'GOZADO',
          dias: 1,
          fechaReferencia: input.fecha,
          turnoAsignacionId: previa.id,
          motivo: 'Reversión: el día dejó de ser descanso compensatorio',
          creadoPor: input.creadoPor,
        },
      });
    }

    return asignacion;
  }

  private validarHorario(horaInicio: string, horaFin: string, horasEsperadas: number): void {
    if (!HORA_REGEX.test(horaInicio) || !HORA_REGEX.test(horaFin)) {
      throw new BadRequestException('horaInicio y horaFin deben tener formato HH:mm');
    }
    if (!(horasEsperadas > 0) || horasEsperadas > 24) {
      throw new BadRequestException('horasEsperadas debe ser mayor a 0 y hasta 24');
    }
  }
}
```

- [ ] **Step 4: Verificar que pasa**

Run: `pnpm --filter @rrhh/api test -- shift-plan.service`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/shifts/shift-plan.service.ts apps/api/src/modules/shifts/shift-plan.service.spec.ts
git commit -m "feat(turnos): catálogo y plan de turnos con goce de compensatorios en el libro"
```

---

### Task 9: `ShiftPlanImportService` + `CompensatorioService` (import CSV, saldo, movimientos, intercambio)

**Files:**
- Create: `apps/api/src/modules/shifts/shift-plan-import.service.ts`
- Create: `apps/api/src/modules/shifts/compensatorio.service.ts`
- Test: `apps/api/src/modules/shifts/shift-plan-import.service.spec.ts`
- Test: `apps/api/src/modules/shifts/compensatorio.service.spec.ts`

**Interfaces:**
- Consumes: `ShiftPlanService.upsertAsignacion` (Task 8), `TurnoRecalculoService` (Task 6, opcional para recálculo retroactivo).
- Produces: `ShiftPlanImportService.generarPlantilla(): string`, `importarCsv(tx, contenidoCsv, tenantId, creadoPor): Promise<{procesadas, omitidas, errores}>`; `CompensatorioService.obtenerSaldo(tx, employeeId)`, `obtenerLibro(tx, employeeId)`, `registrarMovimiento(tx, input)`, `intercambiar(tx, input)` — consumidos por el controller (Task 11).

- [ ] **Step 1: Tests de import que fallan**

```typescript
// apps/api/src/modules/shifts/shift-plan-import.service.spec.ts
import { ShiftPlanImportService } from './shift-plan-import.service';

function mockTx() {
  return {
    turno: { findMany: jest.fn().mockResolvedValue([{ id: 'turno-dia', codigo: 'DIA', activo: true }]) },
    employee: { findFirst: jest.fn().mockResolvedValue({ id: 'emp-1', estado: 'activo' }) },
  } as any;
}

describe('ShiftPlanImportService', () => {
  it('plantilla: header + ejemplos con DESCANSO y COMPENSATORIO', () => {
    const service = new ShiftPlanImportService({ upsertAsignacion: jest.fn() } as any);
    const plantilla = service.generarPlantilla();
    expect(plantilla).toContain('numero_documento,fecha,turno');
    expect(plantilla).toContain('DESCANSO');
  });

  it('importa filas válidas: turno por código, DESCANSO y COMPENSATORIO', async () => {
    const shiftPlan = { upsertAsignacion: jest.fn().mockResolvedValue({}) } as any;
    const service = new ShiftPlanImportService(shiftPlan);
    const csv = [
      'numero_documento,fecha,turno',
      '45678901,2026-08-01,DIA',
      '45678901,2026-08-02,DESCANSO',
      '45678901,2026-08-03,COMPENSATORIO',
    ].join('\n');
    const r = await service.importarCsv(mockTx(), csv, 't-1', 'u-1');
    expect(r.procesadas).toBe(3);
    expect(r.errores).toHaveLength(0);
    expect(shiftPlan.upsertAsignacion).toHaveBeenNthCalledWith(1, expect.anything(),
      expect.objectContaining({ tipoDia: 'TURNO', turnoId: 'turno-dia' }));
    expect(shiftPlan.upsertAsignacion).toHaveBeenNthCalledWith(3, expect.anything(),
      expect.objectContaining({ tipoDia: 'DESCANSO_COMPENSATORIO', forzarSinSaldo: false }));
  });

  it('errores por fila sin abortar: turno inexistente, empleado no encontrado, fecha inválida', async () => {
    const shiftPlan = { upsertAsignacion: jest.fn().mockResolvedValue({}) } as any;
    const service = new ShiftPlanImportService(shiftPlan);
    const tx = mockTx();
    tx.employee.findFirst.mockResolvedValueOnce({ id: 'emp-1', estado: 'activo' });
    const csv = [
      'numero_documento,fecha,turno',
      '45678901,2026-08-01,NOEXISTE',
      '99999999,2026-08-01,DIA',
      '45678901,2026-13-45,DIA',
    ].join('\n');
    tx.employee.findFirst.mockImplementation(({ where }: any) =>
      Promise.resolve(where.numeroDocumento === '45678901' ? { id: 'emp-1', estado: 'activo' } : null),
    );
    const r = await service.importarCsv(tx, csv, 't-1', 'u-1');
    expect(r.procesadas).toBe(0);
    expect(r.errores).toHaveLength(3);
    expect(r.errores.map((e) => e.fila)).toEqual([2, 3, 4]);
  });

  it('el 422 de goce sin saldo se acumula como error de fila', async () => {
    const shiftPlan = {
      upsertAsignacion: jest.fn().mockRejectedValue(Object.assign(new Error('sin saldo'), { status: 422 })),
    } as any;
    const service = new ShiftPlanImportService(shiftPlan);
    const csv = ['numero_documento,fecha,turno', '45678901,2026-08-03,COMPENSATORIO'].join('\n');
    const r = await service.importarCsv(mockTx(), csv, 't-1', 'u-1');
    expect(r.procesadas).toBe(0);
    expect(r.errores[0].mensaje).toContain('sin saldo');
  });
});
```

- [ ] **Step 2: Tests de compensatorios que fallan**

```typescript
// apps/api/src/modules/shifts/compensatorio.service.spec.ts
import { BadRequestException, UnprocessableEntityException } from '@nestjs/common';
import { CompensatorioService } from './compensatorio.service';

function mockTx(overrides: any = {}) {
  return {
    compensatorioMovimiento: {
      aggregate: jest.fn().mockResolvedValue({ _sum: { dias: 2 } }),
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 'mov-1', ...data })),
    },
    turnoAsignacion: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    employee: { findUnique: jest.fn().mockResolvedValue({ id: 'emp-1', numeroDocumento: '1' }) },
    marcacion: { findFirst: jest.fn().mockResolvedValue(null) },
    ...overrides,
  };
}

const service = new CompensatorioService();

describe('CompensatorioService — movimientos y saldo', () => {
  it('obtenerSaldo suma los días del libro', async () => {
    expect(await service.obtenerSaldo(mockTx(), 'emp-1')).toBe(2);
  });

  it('AJUSTE_INICIAL exige motivo', async () => {
    await expect(
      service.registrarMovimiento(mockTx(), {
        tenantId: 't-1', employeeId: 'emp-1', tipo: 'AJUSTE_INICIAL', dias: 3,
        fechaReferencia: new Date(2026, 7, 1), creadoPor: 'u-1',
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('GANADO debe ser positivo', async () => {
    await expect(
      service.registrarMovimiento(mockTx(), {
        tenantId: 't-1', employeeId: 'emp-1', tipo: 'GANADO', dias: -1,
        fechaReferencia: new Date(2026, 7, 1), creadoPor: 'u-1',
      }),
    ).rejects.toThrow(BadRequestException);
  });
});

describe('CompensatorioService — intercambio', () => {
  it('intercambia las asignaciones de A y B en la fecha (neutro para saldos)', async () => {
    const tx = mockTx();
    tx.turnoAsignacion.findUnique
      .mockResolvedValueOnce({ id: 'asig-a', tipoDia: 'DESCANSO', turnoId: null })
      .mockResolvedValueOnce({ id: 'asig-b', tipoDia: 'TURNO', turnoId: 'turno-noche' });
    await service.intercambiar(tx, {
      tenantId: 't-1', fecha: new Date(2026, 7, 10),
      employeeIdA: 'emp-a', employeeIdB: 'emp-b', creadoPor: 'u-1',
    });
    expect(tx.turnoAsignacion.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'asig-a' }, data: expect.objectContaining({ tipoDia: 'TURNO', turnoId: 'turno-noche' }) }),
    );
    expect(tx.turnoAsignacion.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'asig-b' }, data: expect.objectContaining({ tipoDia: 'DESCANSO', turnoId: null }) }),
    );
    expect(tx.compensatorioMovimiento.create).not.toHaveBeenCalled();
  });

  it('rechaza el intercambio si alguno no tiene asignación ese día (422)', async () => {
    const tx = mockTx();
    tx.turnoAsignacion.findUnique.mockResolvedValue(null);
    await expect(
      service.intercambiar(tx, {
        tenantId: 't-1', fecha: new Date(2026, 7, 10),
        employeeIdA: 'emp-a', employeeIdB: 'emp-b', creadoPor: 'u-1',
      }),
    ).rejects.toThrow(UnprocessableEntityException);
  });
});
```

- [ ] **Step 3: Verificar que fallan**

Run: `pnpm --filter @rrhh/api test -- "shift-plan-import|compensatorio"`
Expected: FAIL — módulos inexistentes.

- [ ] **Step 4: Implementar `ShiftPlanImportService`**

```typescript
// apps/api/src/modules/shifts/shift-plan-import.service.ts
import { Injectable } from '@nestjs/common';
import { ShiftPlanService, TipoDiaPlan } from './shift-plan.service';

export interface ErrorFilaImport {
  fila: number;
  mensaje: string;
}

export interface ResultadoImportPlan {
  procesadas: number;
  omitidas: number;
  errores: ErrorFilaImport[];
}

const HEADER = 'numero_documento,fecha,turno';
const FECHA_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const BOM = '﻿';

/**
 * Import del plan de turnos por CSV (spec §5): `numero_documento,fecha,turno`
 * donde turno = código del catálogo, DESCANSO o COMPENSATORIO. Upsert por
 * fila (re-importar actualiza), errores por fila sin abortar — mismo patrón
 * que AttendanceImportService.
 */
@Injectable()
export class ShiftPlanImportService {
  constructor(private readonly shiftPlan: ShiftPlanService) {}

  generarPlantilla(): string {
    return (
      BOM +
      [
        HEADER,
        '45678901,2026-08-01,DIA',
        '45678901,2026-08-02,NOCHE',
        '45678901,2026-08-03,DESCANSO',
        '45678901,2026-08-04,COMPENSATORIO',
      ].join('\r\n') +
      '\r\n'
    );
  }

  async importarCsv(
    tx: any,
    contenidoCsv: string,
    tenantId: string,
    creadoPor: string,
  ): Promise<ResultadoImportPlan> {
    const resultado: ResultadoImportPlan = { procesadas: 0, omitidas: 0, errores: [] };
    const turnos = await tx.turno.findMany({ where: { activo: true } });
    const turnosPorCodigo = new Map<string, any>(turnos.map((t: any) => [t.codigo, t]));
    const empleadosPorDocumento = new Map<string, any | null>();

    const lineas = contenidoCsv.replace(/^﻿/, '').split(/\r?\n/);
    for (let i = 0; i < lineas.length; i++) {
      const numeroFila = i + 1;
      const linea = (lineas[i] ?? '').trim();
      if (linea === '') continue;

      const campos = linea.split(',').map((c) => c.trim());
      if (campos[0]?.toLowerCase() === 'numero_documento') continue;

      if (campos.length !== 3) {
        resultado.errores.push({ fila: numeroFila, mensaje: `Se esperaban 3 columnas y llegaron ${campos.length}` });
        continue;
      }
      const [numeroDocumento = '', fechaStr = '', turnoStr = ''] = campos;

      if (!FECHA_REGEX.test(fechaStr)) {
        resultado.errores.push({ fila: numeroFila, mensaje: `Fecha inválida: "${fechaStr}" (YYYY-MM-DD)` });
        continue;
      }
      const [anio = 0, mes = 0, dia = 0] = fechaStr.split('-').map(Number);
      const fecha = new Date(anio, mes - 1, dia);
      if (fecha.getFullYear() !== anio || fecha.getMonth() !== mes - 1 || fecha.getDate() !== dia) {
        resultado.errores.push({ fila: numeroFila, mensaje: `Fecha inexistente: "${fechaStr}"` });
        continue;
      }

      let tipoDia: TipoDiaPlan;
      let turnoId: string | undefined;
      const clave = turnoStr.toUpperCase();
      if (clave === 'DESCANSO') {
        tipoDia = 'DESCANSO';
      } else if (clave === 'COMPENSATORIO') {
        tipoDia = 'DESCANSO_COMPENSATORIO';
      } else {
        const turno = turnosPorCodigo.get(turnoStr);
        if (!turno) {
          resultado.errores.push({ fila: numeroFila, mensaje: `Turno inexistente o inactivo: "${turnoStr}"` });
          continue;
        }
        tipoDia = 'TURNO';
        turnoId = turno.id;
      }

      if (!empleadosPorDocumento.has(numeroDocumento)) {
        empleadosPorDocumento.set(
          numeroDocumento,
          await tx.employee.findFirst({ where: { numeroDocumento } }),
        );
      }
      const employee = empleadosPorDocumento.get(numeroDocumento);
      if (!employee) {
        resultado.errores.push({ fila: numeroFila, mensaje: `Trabajador con documento "${numeroDocumento}" no encontrado` });
        continue;
      }

      try {
        await this.shiftPlan.upsertAsignacion(tx, {
          tenantId,
          employeeId: employee.id,
          fecha,
          tipoDia,
          turnoId,
          creadoPor,
          forzarSinSaldo: false,
        });
        resultado.procesadas += 1;
      } catch (error) {
        resultado.errores.push({ fila: numeroFila, mensaje: (error as Error).message });
      }
    }
    return resultado;
  }
}
```

- [ ] **Step 5: Implementar `CompensatorioService`**

```typescript
// apps/api/src/modules/shifts/compensatorio.service.ts
import {
  BadRequestException,
  Injectable,
  UnprocessableEntityException,
} from '@nestjs/common';

export type TipoMovimientoCompensatorio = 'GANADO' | 'GOZADO' | 'AJUSTE_INICIAL';

export interface RegistrarMovimientoInput {
  tenantId: string;
  employeeId: string;
  tipo: TipoMovimientoCompensatorio;
  dias: number;
  fechaReferencia: Date;
  motivo?: string;
  creadoPor: string;
}

export interface IntercambioInput {
  tenantId: string;
  fecha: Date;
  employeeIdA: string;
  employeeIdB: string;
  creadoPor: string;
}

/**
 * Libro mayor de descansos compensatorios e intercambios de turno (spec
 * §4.4/§4.5): saldo = suma de movimientos; el intercambio A↔B es neutro para
 * los saldos (nadie ganó ni gozó — trabajó uno en lugar del otro).
 */
@Injectable()
export class CompensatorioService {
  async obtenerSaldo(tx: any, employeeId: string): Promise<number> {
    const agregado = await tx.compensatorioMovimiento.aggregate({
      where: { employeeId },
      _sum: { dias: true },
    });
    return Number(agregado._sum.dias ?? 0);
  }

  async obtenerLibro(tx: any, employeeId: string): Promise<{ saldo: number; movimientos: any[] }> {
    const movimientos = await tx.compensatorioMovimiento.findMany({
      where: { employeeId },
      orderBy: { creadoEn: 'desc' },
    });
    return { saldo: await this.obtenerSaldo(tx, employeeId), movimientos };
  }

  async registrarMovimiento(tx: any, input: RegistrarMovimientoInput): Promise<any> {
    if (input.tipo === 'AJUSTE_INICIAL' && !input.motivo?.trim()) {
      throw new BadRequestException('AJUSTE_INICIAL requiere motivo');
    }
    if (input.tipo === 'GANADO' && !(input.dias > 0)) {
      throw new BadRequestException('Un movimiento GANADO debe tener días positivos');
    }
    if (input.tipo === 'GOZADO' && input.dias === 0) {
      throw new BadRequestException('Un movimiento GOZADO no puede ser 0');
    }
    return tx.compensatorioMovimiento.create({
      data: {
        tenantId: input.tenantId,
        employeeId: input.employeeId,
        tipo: input.tipo,
        dias: input.dias,
        fechaReferencia: input.fechaReferencia,
        motivo: input.motivo ?? null,
        creadoPor: input.creadoPor,
      },
    });
  }

  async intercambiar(tx: any, input: IntercambioInput): Promise<{ a: any; b: any }> {
    const [asigA, asigB] = await Promise.all([
      tx.turnoAsignacion.findUnique({
        where: {
          tenantId_employeeId_fecha: {
            tenantId: input.tenantId, employeeId: input.employeeIdA, fecha: input.fecha,
          },
        },
      }),
      tx.turnoAsignacion.findUnique({
        where: {
          tenantId_employeeId_fecha: {
            tenantId: input.tenantId, employeeId: input.employeeIdB, fecha: input.fecha,
          },
        },
      }),
    ]);
    const faltantes: string[] = [];
    if (!asigA) faltantes.push(`empleado A sin asignación el ${input.fecha.toISOString().slice(0, 10)}`);
    if (!asigB) faltantes.push(`empleado B sin asignación el ${input.fecha.toISOString().slice(0, 10)}`);
    if (faltantes.length > 0) {
      throw new UnprocessableEntityException({ message: 'Intercambio inválido', faltantes });
    }

    const [empA, empB] = await Promise.all([
      tx.employee.findUnique({ where: { id: input.employeeIdA } }),
      tx.employee.findUnique({ where: { id: input.employeeIdB } }),
    ]);

    const a = await tx.turnoAsignacion.update({
      where: { id: asigA.id },
      data: {
        tipoDia: asigB.tipoDia,
        turnoId: asigB.turnoId,
        notas: `Intercambio con ${empB?.numeroDocumento ?? input.employeeIdB}`,
      },
    });
    const b = await tx.turnoAsignacion.update({
      where: { id: asigB.id },
      data: {
        tipoDia: asigA.tipoDia,
        turnoId: asigA.turnoId,
        notas: `Intercambio con ${empA?.numeroDocumento ?? input.employeeIdA}`,
      },
    });
    return { a, b };
  }
}
```

- [ ] **Step 6: Verificar que pasan**

Run: `pnpm --filter @rrhh/api test -- "shift-plan-import|compensatorio"`
Expected: PASS (9 tests)

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/shifts/
git commit -m "feat(turnos): import CSV del plan, libro de compensatorios e intercambios"
```

---

### Task 10: `ShiftComplianceService` — reporte de cumplimiento + export de novedades

**Files:**
- Create: `apps/api/src/modules/shifts/shift-compliance.service.ts`
- Test: `apps/api/src/modules/shifts/shift-compliance.service.spec.ts`

**Interfaces:**
- Produces: `generarReporte(tx, periodo: string): Promise<ReporteCumplimiento>` y `exportarNovedadesCsv(tx, periodo: string): Promise<string>`. `ReporteCumplimiento = { periodo, empleados: ReporteEmpleado[] }` con `ReporteEmpleado = { employeeId, nombres, apellidos, numeroDocumento, diasPlanificados, diasTrabajados, faltas, faltasJustificadas, diasTardanza, minutosTardanza, minutosDeficit, pendientesSinPlan: Array<{fecha, contraparteSugerida}>, compensatorios: { saldoInicial, ganados, gozados, saldoActual } }` — consumido por el controller (Task 11) y el frontend (Task 13).

- [ ] **Step 1: Escribir los tests que fallan**

```typescript
// apps/api/src/modules/shifts/shift-compliance.service.spec.ts
import { BadRequestException } from '@nestjs/common';
import { ShiftComplianceService } from './shift-compliance.service';

const EMPLEADO = { id: 'emp-1', nombres: 'Ana', apellidos: 'Torres', numeroDocumento: '45678901' };

function mockTx(overrides: any = {}) {
  return {
    turnoAsignacion: { findMany: jest.fn().mockResolvedValue([]) },
    asistenciaResumen: { findMany: jest.fn().mockResolvedValue([]) },
    compensatorioMovimiento: { findMany: jest.fn().mockResolvedValue([]) },
    employee: { findMany: jest.fn().mockResolvedValue([EMPLEADO]) },
    ...overrides,
  };
}

const service = new ShiftComplianceService();

describe('ShiftComplianceService', () => {
  it('periodo inválido → 400', async () => {
    await expect(service.generarReporte(mockTx(), '2026-13')).rejects.toThrow(BadRequestException);
  });

  it('agrega por empleado: planificados, trabajados, tardanzas, déficit', async () => {
    const tx = mockTx();
    tx.turnoAsignacion.findMany.mockResolvedValue([
      { employeeId: 'emp-1', fecha: new Date(2026, 7, 3), tipoDia: 'TURNO' },
      { employeeId: 'emp-1', fecha: new Date(2026, 7, 4), tipoDia: 'TURNO' },
      { employeeId: 'emp-1', fecha: new Date(2026, 7, 5), tipoDia: 'DESCANSO' },
    ]);
    tx.asistenciaResumen.findMany.mockResolvedValue([
      { employeeId: 'emp-1', fecha: new Date(2026, 7, 3), horasTrabajadas: 12, tardanzaMinutos: 35, deficitMinutos: 0, falta: false, justificado: false, sinPlan: false },
      { employeeId: 'emp-1', fecha: new Date(2026, 7, 4), horasTrabajadas: 11.5, tardanzaMinutos: 0, deficitMinutos: 30, falta: false, justificado: false, sinPlan: false },
    ]);
    const r = await service.generarReporte(tx, '2026-08');
    const emp = r.empleados[0];
    expect(emp.diasPlanificados).toBe(2);
    expect(emp.diasTrabajados).toBe(2);
    expect(emp.diasTardanza).toBe(1);
    expect(emp.minutosTardanza).toBe(35);
    expect(emp.minutosDeficit).toBe(30);
  });

  it('falta: día TURNO pasado sin resumen; sinPlan empareja contraparte del mismo día', async () => {
    const tx = mockTx();
    tx.employee.findMany.mockResolvedValue([
      EMPLEADO,
      { id: 'emp-2', nombres: 'Carlos', apellidos: 'Mendoza', numeroDocumento: '87654321' },
    ]);
    tx.turnoAsignacion.findMany.mockResolvedValue([
      { employeeId: 'emp-2', fecha: new Date(2026, 7, 3), tipoDia: 'TURNO' },
    ]);
    tx.asistenciaResumen.findMany.mockResolvedValue([
      { employeeId: 'emp-1', fecha: new Date(2026, 7, 3), horasTrabajadas: 12, tardanzaMinutos: 0, deficitMinutos: 0, falta: false, justificado: false, sinPlan: true },
    ]);
    const r = await service.generarReporte(tx, '2026-08');
    const empA = r.empleados.find((e) => e.employeeId === 'emp-1')!;
    const empB = r.empleados.find((e) => e.employeeId === 'emp-2')!;
    expect(empB.faltas).toBe(1);
    expect(empA.pendientesSinPlan).toHaveLength(1);
    expect(empA.pendientesSinPlan[0].contraparteSugerida).toContain('Mendoza');
  });

  it('compensatorios: saldo inicial (antes del período), ganados/gozados del período y saldo actual', async () => {
    const tx = mockTx();
    tx.turnoAsignacion.findMany.mockResolvedValue([
      { employeeId: 'emp-1', fecha: new Date(2026, 7, 3), tipoDia: 'TURNO' },
    ]);
    tx.compensatorioMovimiento.findMany.mockResolvedValue([
      { employeeId: 'emp-1', tipo: 'AJUSTE_INICIAL', dias: 2, creadoEn: new Date(2026, 6, 1) },
      { employeeId: 'emp-1', tipo: 'GANADO', dias: 1, creadoEn: new Date(2026, 7, 10) },
      { employeeId: 'emp-1', tipo: 'GOZADO', dias: -1, creadoEn: new Date(2026, 7, 15) },
    ]);
    const r = await service.generarReporte(tx, '2026-08');
    expect(r.empleados[0].compensatorios).toEqual({
      saldoInicial: 2, ganados: 1, gozados: -1, saldoActual: 2,
    });
  });

  it('exportarNovedadesCsv: header compatible con el import de novedades de nómina', async () => {
    const tx = mockTx();
    tx.turnoAsignacion.findMany.mockResolvedValue([
      { employeeId: 'emp-1', fecha: new Date(2026, 7, 3), tipoDia: 'TURNO' },
    ]);
    tx.asistenciaResumen.findMany.mockResolvedValue([
      { employeeId: 'emp-1', fecha: new Date(2026, 7, 3), horasTrabajadas: 12, tardanzaMinutos: 0, deficitMinutos: 0, falta: false, justificado: false, sinPlan: false },
    ]);
    const csv = await service.exportarNovedadesCsv(tx, '2026-08');
    expect(csv).toContain('numero_documento,dias_laborados,horas_extra_25,horas_extra_35,bonificaciones,descuentos');
    expect(csv).toContain('45678901,1,,,,');
  });
});
```

- [ ] **Step 2: Verificar que falla**

Run: `pnpm --filter @rrhh/api test -- shift-compliance`
Expected: FAIL — `Cannot find module './shift-compliance.service'`

- [ ] **Step 3: Implementación**

```typescript
// apps/api/src/modules/shifts/shift-compliance.service.ts
import { BadRequestException, Injectable } from '@nestjs/common';

export interface ReporteEmpleado {
  employeeId: string;
  nombres: string;
  apellidos: string;
  numeroDocumento: string;
  diasPlanificados: number;
  diasTrabajados: number;
  faltas: number;
  faltasJustificadas: number;
  diasTardanza: number;
  minutosTardanza: number;
  minutosDeficit: number;
  pendientesSinPlan: Array<{ fecha: string; contraparteSugerida: string | null }>;
  compensatorios: { saldoInicial: number; ganados: number; gozados: number; saldoActual: number };
}

export interface ReporteCumplimiento {
  periodo: string;
  empleados: ReporteEmpleado[];
}

const PERIODO_REGEX = /^\d{4}-(0[1-9]|1[0-2])$/;
const CSV_HEADER = 'numero_documento,dias_laborados,horas_extra_25,horas_extra_35,bonificaciones,descuentos';

/**
 * Reporte de cumplimiento del período (spec §7): compara plan vs. resúmenes,
 * detecta faltas (día TURNO pasado sin resumen), empareja pendientes sinPlan
 * con su contraparte del mismo día y agrega el libro de compensatorios.
 * El export CSV es compatible con POST /payroll/:periodo/import — RRHH decide
 * los montos (columnas de montos vacías a propósito).
 */
@Injectable()
export class ShiftComplianceService {
  async generarReporte(tx: any, periodo: string): Promise<ReporteCumplimiento> {
    if (!PERIODO_REGEX.test(periodo)) {
      throw new BadRequestException(`Período inválido: "${periodo}" (formato YYYY-MM)`);
    }
    const [anio = 0, mes = 0] = periodo.split('-').map(Number);
    const desde = new Date(anio, mes - 1, 1);
    const hasta = new Date(anio, mes, 0, 23, 59, 59, 999);
    const hoy = new Date();

    const [asignaciones, resumenes, movimientos, empleados] = await Promise.all([
      tx.turnoAsignacion.findMany({ where: { fecha: { gte: desde, lte: hasta } } }),
      tx.asistenciaResumen.findMany({ where: { fecha: { gte: desde, lte: hasta } } }),
      tx.compensatorioMovimiento.findMany({}),
      tx.employee.findMany({}),
    ]);

    const empleadosPorId = new Map<string, any>(empleados.map((e: any) => [e.id, e]));
    // Empleados con actividad de turnos en el período (plan, resumen sinPlan o movimientos)
    const idsConPlan = new Set<string>(asignaciones.map((a: any) => a.employeeId));
    for (const r of resumenes) if (r.sinPlan) idsConPlan.add(r.employeeId);

    // Índices por empleado|fecha para faltas y contrapartes
    const resumenPorClave = new Map<string, any>();
    for (const r of resumenes) {
      resumenPorClave.set(`${r.employeeId}|${new Date(r.fecha).toISOString().slice(0, 10)}`, r);
    }
    const turnosPorFecha = new Map<string, any[]>();
    for (const a of asignaciones) {
      if (a.tipoDia !== 'TURNO') continue;
      const clave = new Date(a.fecha).toISOString().slice(0, 10);
      if (!turnosPorFecha.has(clave)) turnosPorFecha.set(clave, []);
      turnosPorFecha.get(clave)!.push(a);
    }

    const reporte: ReporteEmpleado[] = [];
    for (const employeeId of idsConPlan) {
      const empleado = empleadosPorId.get(employeeId);
      if (!empleado) continue;

      const asignacionesEmp = asignaciones.filter((a: any) => a.employeeId === employeeId);
      const resumenesEmp = resumenes.filter((r: any) => r.employeeId === employeeId);

      let faltas = 0;
      let faltasJustificadas = 0;
      for (const a of asignacionesEmp) {
        if (a.tipoDia !== 'TURNO') continue;
        const fecha = new Date(a.fecha);
        if (fecha.getTime() >= hoy.getTime()) continue; // futuro: aún no evaluable
        const resumen = resumenPorClave.get(`${employeeId}|${fecha.toISOString().slice(0, 10)}`);
        if (!resumen || resumen.falta) {
          if (resumen?.justificado) faltasJustificadas += 1;
          else faltas += 1;
        }
      }

      const pendientesSinPlan = resumenesEmp
        .filter((r: any) => r.sinPlan)
        .map((r: any) => {
          const clave = new Date(r.fecha).toISOString().slice(0, 10);
          const contraparte = (turnosPorFecha.get(clave) ?? []).find((a: any) => {
            const resumenTitular = resumenPorClave.get(`${a.employeeId}|${clave}`);
            return !resumenTitular || resumenTitular.falta;
          });
          const empContraparte = contraparte ? empleadosPorId.get(contraparte.employeeId) : null;
          return {
            fecha: clave,
            contraparteSugerida: empContraparte
              ? `${empContraparte.apellidos}, ${empContraparte.nombres} tenía turno y no marcó`
              : null,
          };
        });

      const movimientosEmp = movimientos.filter((m: any) => m.employeeId === employeeId);
      const enPeriodo = (m: any) =>
        new Date(m.creadoEn).getTime() >= desde.getTime() && new Date(m.creadoEn).getTime() <= hasta.getTime();
      const saldoInicial = movimientosEmp
        .filter((m: any) => new Date(m.creadoEn).getTime() < desde.getTime())
        .reduce((s: number, m: any) => s + Number(m.dias), 0);
      const ganados = movimientosEmp
        .filter((m: any) => enPeriodo(m) && Number(m.dias) > 0 && m.tipo !== 'AJUSTE_INICIAL')
        .reduce((s: number, m: any) => s + Number(m.dias), 0);
      const gozados = movimientosEmp
        .filter((m: any) => enPeriodo(m) && Number(m.dias) < 0)
        .reduce((s: number, m: any) => s + Number(m.dias), 0);
      const saldoActual = movimientosEmp.reduce((s: number, m: any) => s + Number(m.dias), 0);

      const conHoras = resumenesEmp.filter((r: any) => r.horasTrabajadas > 0);
      const conTardanza = resumenesEmp.filter((r: any) => r.tardanzaMinutos > 0);

      reporte.push({
        employeeId,
        nombres: empleado.nombres,
        apellidos: empleado.apellidos,
        numeroDocumento: empleado.numeroDocumento,
        diasPlanificados: asignacionesEmp.filter((a: any) => a.tipoDia === 'TURNO').length,
        diasTrabajados: conHoras.length,
        faltas,
        faltasJustificadas,
        diasTardanza: conTardanza.length,
        minutosTardanza: conTardanza.reduce((s: number, r: any) => s + r.tardanzaMinutos, 0),
        minutosDeficit: resumenesEmp.reduce((s: number, r: any) => s + (r.deficitMinutos ?? 0), 0),
        pendientesSinPlan,
        compensatorios: { saldoInicial, ganados, gozados, saldoActual },
      });
    }

    reporte.sort((a, b) => a.apellidos.localeCompare(b.apellidos));
    return { periodo, empleados: reporte };
  }

  async exportarNovedadesCsv(tx: any, periodo: string): Promise<string> {
    const { empleados } = await this.generarReporte(tx, periodo);
    const filas = empleados.map(
      (e) => `${e.numeroDocumento},${e.diasTrabajados},,,,`,
    );
    return [CSV_HEADER, ...filas].join('\r\n') + '\r\n';
  }
}
```

- [ ] **Step 4: Verificar que pasa**

Run: `pnpm --filter @rrhh/api test -- shift-compliance`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/shifts/shift-compliance.service.ts apps/api/src/modules/shifts/shift-compliance.service.spec.ts
git commit -m "feat(turnos): reporte de cumplimiento con pendientes, compensatorios y export de novedades"
```

---

### Task 11: Controller + module + registro en la app

**Files:**
- Create: `apps/api/src/modules/shifts/shifts.controller.ts`
- Create: `apps/api/src/modules/shifts/shifts.module.ts`
- Modify: `apps/api/src/app.module.ts`

**Interfaces:**
- Consumes: los 4 services de shifts (Tasks 8-10) y `TurnoRecalculoService` vía `AttendanceModule` (Task 7).
- Produces: endpoints REST del spec §5 — consumidos por el frontend (Tasks 12-13).

- [ ] **Step 1: Controller**

```typescript
// apps/api/src/modules/shifts/shifts.controller.ts
import {
  BadRequestException, Body, Controller, Get, Param, Post, Put, Query, UseGuards,
} from '@nestjs/common';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { getTenantContext, TenantContext } from '../../common/database/tenant-request-context';
import { ShiftPlanService, TipoDiaPlan } from './shift-plan.service';
import { ShiftPlanImportService } from './shift-plan-import.service';
import { CompensatorioService, TipoMovimientoCompensatorio } from './compensatorio.service';
import { ShiftComplianceService } from './shift-compliance.service';

const TIPOS_DIA: readonly TipoDiaPlan[] = ['TURNO', 'DESCANSO', 'DESCANSO_COMPENSATORIO'];
const TIPOS_MOVIMIENTO: readonly TipoMovimientoCompensatorio[] = ['GANADO', 'AJUSTE_INICIAL'];
const FECHA_REGEX = /^\d{4}-\d{2}-\d{2}$/;

function requireIdentity(ctx: TenantContext): { tenantId: string; userId: string } {
  if (!ctx.tenantId || !ctx.userId) {
    throw new BadRequestException('Request sin tenant o usuario resuelto');
  }
  return { tenantId: ctx.tenantId, userId: ctx.userId };
}

function parseFecha(valor: string, campo: string): Date {
  if (!FECHA_REGEX.test(valor ?? '')) {
    throw new BadRequestException(`${campo} inválida: "${valor}" (YYYY-MM-DD)`);
  }
  const [anio = 0, mes = 0, dia = 0] = valor.split('-').map(Number);
  const fecha = new Date(anio, mes - 1, dia);
  if (fecha.getFullYear() !== anio || fecha.getMonth() !== mes - 1 || fecha.getDate() !== dia) {
    throw new BadRequestException(`${campo} inexistente: "${valor}"`);
  }
  return fecha;
}

@Controller('turnos')
@UseGuards(PermissionsGuard)
export class ShiftsController {
  constructor(
    private readonly shiftPlan: ShiftPlanService,
    private readonly planImport: ShiftPlanImportService,
    private readonly compensatorios: CompensatorioService,
    private readonly compliance: ShiftComplianceService,
  ) {}

  // --- Catálogo ---
  @Get()
  @RequirePermission('shift.read')
  async listarTurnos(@Query('incluirInactivos') incluirInactivos?: string) {
    const ctx = getTenantContext();
    return this.shiftPlan.listarTurnos(ctx.tx, incluirInactivos === 'true');
  }

  @Post()
  @RequirePermission('shift.manage')
  async crearTurno(@Body() dto: any) {
    if (!dto?.codigo || !dto?.nombre || !dto?.horaInicio || !dto?.horaFin || !dto?.horasEsperadas) {
      throw new BadRequestException('codigo, nombre, horaInicio, horaFin y horasEsperadas son obligatorios');
    }
    const ctx = getTenantContext();
    const { tenantId } = requireIdentity(ctx);
    return this.shiftPlan.crearTurno(ctx.tx, {
      tenantId,
      codigo: dto.codigo,
      nombre: dto.nombre,
      horaInicio: dto.horaInicio,
      horaFin: dto.horaFin,
      horasEsperadas: Number(dto.horasEsperadas),
      toleranciaMinutos: dto.toleranciaMinutos !== undefined ? Number(dto.toleranciaMinutos) : undefined,
    });
  }

  @Put(':id')
  @RequirePermission('shift.manage')
  async actualizarTurno(@Param('id') id: string, @Body() cambios: any) {
    const ctx = getTenantContext();
    return this.shiftPlan.actualizarTurno(ctx.tx, id, cambios ?? {});
  }

  // --- Plan ---
  @Get('plan')
  @RequirePermission('shift.read')
  async obtenerPlan(
    @Query('desde') desde: string,
    @Query('hasta') hasta: string,
    @Query('employeeId') employeeId?: string,
  ) {
    const ctx = getTenantContext();
    return this.shiftPlan.obtenerPlan(ctx.tx, parseFecha(desde, 'desde'), parseFecha(hasta, 'hasta'), employeeId);
  }

  @Put('plan')
  @RequirePermission('shift.manage')
  async upsertAsignacion(@Body() dto: any) {
    if (!dto?.employeeId || !dto?.fecha || !dto?.tipoDia) {
      throw new BadRequestException('employeeId, fecha y tipoDia son obligatorios');
    }
    if (!TIPOS_DIA.includes(dto.tipoDia)) {
      throw new BadRequestException(`tipoDia inválido: "${dto.tipoDia}" (válidos: ${TIPOS_DIA.join(', ')})`);
    }
    const ctx = getTenantContext();
    const { tenantId, userId } = requireIdentity(ctx);
    return this.shiftPlan.upsertAsignacion(ctx.tx, {
      tenantId,
      employeeId: dto.employeeId,
      fecha: parseFecha(dto.fecha, 'fecha'),
      tipoDia: dto.tipoDia,
      turnoId: dto.turnoId,
      notas: dto.notas,
      creadoPor: userId,
      forzarSinSaldo: dto.forzarSinSaldo === true,
    });
  }

  @Get('plan/plantilla')
  @RequirePermission('shift.manage')
  plantilla() {
    return this.planImport.generarPlantilla();
  }

  @Post('plan/import')
  @RequirePermission('shift.manage')
  async importarPlan(@Body() dto: { contenido?: string }) {
    if (!dto?.contenido) throw new BadRequestException('contenido (CSV) es obligatorio');
    const ctx = getTenantContext();
    const { tenantId, userId } = requireIdentity(ctx);
    return this.planImport.importarCsv(ctx.tx, dto.contenido, tenantId, userId);
  }

  // --- Intercambio y compensatorios ---
  @Post('intercambio')
  @RequirePermission('shift.resolve')
  async intercambiar(@Body() dto: any) {
    if (!dto?.fecha || !dto?.employeeIdA || !dto?.employeeIdB) {
      throw new BadRequestException('fecha, employeeIdA y employeeIdB son obligatorios');
    }
    const ctx = getTenantContext();
    const { tenantId, userId } = requireIdentity(ctx);
    return this.compensatorios.intercambiar(ctx.tx, {
      tenantId,
      fecha: parseFecha(dto.fecha, 'fecha'),
      employeeIdA: dto.employeeIdA,
      employeeIdB: dto.employeeIdB,
      creadoPor: userId,
    });
  }

  @Post('compensatorios')
  @RequirePermission('shift.resolve')
  async registrarMovimiento(@Body() dto: any) {
    if (!dto?.employeeId || !dto?.tipo || dto?.dias === undefined || !dto?.fechaReferencia) {
      throw new BadRequestException('employeeId, tipo, dias y fechaReferencia son obligatorios');
    }
    if (!TIPOS_MOVIMIENTO.includes(dto.tipo)) {
      throw new BadRequestException(`tipo inválido: "${dto.tipo}" (válidos: ${TIPOS_MOVIMIENTO.join(', ')})`);
    }
    const ctx = getTenantContext();
    const { tenantId, userId } = requireIdentity(ctx);
    return this.compensatorios.registrarMovimiento(ctx.tx, {
      tenantId,
      employeeId: dto.employeeId,
      tipo: dto.tipo,
      dias: Number(dto.dias),
      fechaReferencia: parseFecha(dto.fechaReferencia, 'fechaReferencia'),
      motivo: dto.motivo,
      creadoPor: userId,
    });
  }

  @Get('compensatorios/:employeeId')
  @RequirePermission('shift.read')
  async libro(@Param('employeeId') employeeId: string) {
    const ctx = getTenantContext();
    return this.compensatorios.obtenerLibro(ctx.tx, employeeId);
  }

  // --- Cumplimiento ---
  @Get('cumplimiento/:periodo')
  @RequirePermission('shift.read')
  async cumplimiento(@Param('periodo') periodo: string) {
    const ctx = getTenantContext();
    return this.compliance.generarReporte(ctx.tx, periodo);
  }

  @Get('cumplimiento/:periodo/export')
  @RequirePermission('shift.manage')
  async exportNovedades(@Param('periodo') periodo: string) {
    const ctx = getTenantContext();
    return { csv: await this.compliance.exportarNovedadesCsv(ctx.tx, periodo) };
  }

  // --- Autoservicio: el empleado ve su propio plan ---
  @Get('mi-plan')
  async miPlan(@Query('desde') desde: string, @Query('hasta') hasta: string) {
    const ctx = getTenantContext();
    if (!ctx.employeeId) {
      throw new BadRequestException('La sesión no tiene un empleado asociado');
    }
    return this.shiftPlan.obtenerPlan(
      ctx.tx, parseFecha(desde, 'desde'), parseFecha(hasta, 'hasta'), ctx.employeeId,
    );
  }
}
```

**Nota `mi-plan`:** verificar en `tenant-request-context.ts` cómo se expone el empleado de la sesión (`ctx.employeeId` o similar). Si el contexto no lo expone, resolverlo con `tx.employee.findFirst({ where: { userId: ctx.userId } })` (ver cómo lo hace la página de asistencia / `GET /auth/me`). **Importante:** `@Get('plan')`, `@Get('plan/plantilla')` y `@Get('mi-plan')` deben declararse ANTES de `@Get(':id')` si se agrega una ruta por id de turno — en este controller no hay `@Get(':id')`, no hay conflicto.

- [ ] **Step 2: Module + registro**

```typescript
// apps/api/src/modules/shifts/shifts.module.ts
import { Module } from '@nestjs/common';
import { ShiftsController } from './shifts.controller';
import { ShiftPlanService } from './shift-plan.service';
import { ShiftPlanImportService } from './shift-plan-import.service';
import { CompensatorioService } from './compensatorio.service';
import { ShiftComplianceService } from './shift-compliance.service';
import { AttendanceModule } from '../attendance/attendance.module';

@Module({
  imports: [AttendanceModule],
  controllers: [ShiftsController],
  providers: [ShiftPlanService, ShiftPlanImportService, CompensatorioService, ShiftComplianceService],
})
export class ShiftsModule {}
```

En `app.module.ts`: importar `ShiftsModule` y agregarlo al array `imports` después de `TerminationModule`.

- [ ] **Step 3: Suite completa**

Run: `pnpm --filter @rrhh/api test`
Expected: todo verde.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/modules/shifts/ apps/api/src/app.module.ts
git commit -m "feat(turnos): endpoints REST de catálogo, plan, compensatorios, intercambio y cumplimiento"
```

---

### Task 12: Frontend — API client y pestañas Catálogo + Plan

**Files:**
- Create: `apps/web/src/app/(app)/turnos/shifts-api.ts`
- Create: `apps/web/src/app/(app)/turnos/catalogo-tab.tsx`
- Create: `apps/web/src/app/(app)/turnos/plan-tab.tsx`

**Interfaces:**
- Consumes: endpoints de Task 11; `listarEmpleados` de `../vacaciones/vacations-api` (reutilizado).
- Produces: `shifts-api.ts` (tipos + funciones fetch, consumido por Tasks 12-13); componentes `CatalogoTab` y `PlanTab` (consumidos por `page.tsx` en Task 13).

- [ ] **Step 1: API client**

```typescript
// apps/web/src/app/(app)/turnos/shifts-api.ts
import { apiFetch } from '@/lib/api-client';

export interface Turno {
  id: string;
  codigo: string;
  nombre: string;
  horaInicio: string;
  horaFin: string;
  horasEsperadas: string | number;
  toleranciaMinutos: number;
  activo: boolean;
}

export type TipoDiaPlan = 'TURNO' | 'DESCANSO' | 'DESCANSO_COMPENSATORIO';

export interface Asignacion {
  id: string;
  employeeId: string;
  fecha: string;
  tipoDia: TipoDiaPlan;
  turnoId: string | null;
  notas: string | null;
  turno?: { codigo: string; nombre: string; horaInicio: string; horaFin: string } | null;
  employee?: { nombres: string; apellidos: string; numeroDocumento: string };
}

export interface ReporteEmpleado {
  employeeId: string;
  nombres: string;
  apellidos: string;
  numeroDocumento: string;
  diasPlanificados: number;
  diasTrabajados: number;
  faltas: number;
  faltasJustificadas: number;
  diasTardanza: number;
  minutosTardanza: number;
  minutosDeficit: number;
  pendientesSinPlan: Array<{ fecha: string; contraparteSugerida: string | null }>;
  compensatorios: { saldoInicial: number; ganados: number; gozados: number; saldoActual: number };
}

export interface Movimiento {
  id: string;
  tipo: 'GANADO' | 'GOZADO' | 'AJUSTE_INICIAL';
  dias: string | number;
  fechaReferencia: string;
  motivo: string | null;
  creadoEn: string;
}

async function ok<T>(res: Response, accion: string): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const msg =
      typeof body.message === 'string'
        ? body.message
        : Array.isArray(body.faltantes)
          ? body.faltantes.join('; ')
          : `No se pudo ${accion}`;
    throw new Error(msg);
  }
  return res.json() as Promise<T>;
}

export const listarTurnos = async (incluirInactivos = false): Promise<Turno[]> =>
  ok(await apiFetch(`/turnos?incluirInactivos=${incluirInactivos}`), 'listar turnos');

export async function crearTurno(input: Omit<Turno, 'id' | 'activo'>): Promise<Turno> {
  return ok(await apiFetch('/turnos', { method: 'POST', body: JSON.stringify(input) }), 'crear el turno');
}

export async function actualizarTurno(id: string, cambios: Partial<Turno>): Promise<Turno> {
  return ok(await apiFetch(`/turnos/${id}`, { method: 'PUT', body: JSON.stringify(cambios) }), 'actualizar el turno');
}

export const obtenerPlan = async (desde: string, hasta: string, employeeId?: string): Promise<Asignacion[]> =>
  ok(
    await apiFetch(`/turnos/plan?desde=${desde}&hasta=${hasta}${employeeId ? `&employeeId=${employeeId}` : ''}`),
    'cargar el plan',
  );

export async function upsertAsignacion(input: {
  employeeId: string; fecha: string; tipoDia: TipoDiaPlan; turnoId?: string; notas?: string; forzarSinSaldo?: boolean;
}): Promise<Asignacion> {
  return ok(await apiFetch('/turnos/plan', { method: 'PUT', body: JSON.stringify(input) }), 'guardar la asignación');
}

export const descargarPlantillaPlan = async (): Promise<string> => {
  const res = await apiFetch('/turnos/plan/plantilla');
  if (!res.ok) throw new Error('No se pudo descargar la plantilla');
  return res.text();
};

export async function importarPlan(contenido: string): Promise<{ procesadas: number; omitidas: number; errores: Array<{ fila: number; mensaje: string }> }> {
  return ok(await apiFetch('/turnos/plan/import', { method: 'POST', body: JSON.stringify({ contenido }) }), 'importar el plan');
}

export async function intercambiar(input: { fecha: string; employeeIdA: string; employeeIdB: string }): Promise<unknown> {
  return ok(await apiFetch('/turnos/intercambio', { method: 'POST', body: JSON.stringify(input) }), 'registrar el intercambio');
}

export async function registrarMovimiento(input: {
  employeeId: string; tipo: 'GANADO' | 'AJUSTE_INICIAL'; dias: number; fechaReferencia: string; motivo?: string;
}): Promise<Movimiento> {
  return ok(await apiFetch('/turnos/compensatorios', { method: 'POST', body: JSON.stringify(input) }), 'registrar el movimiento');
}

export const obtenerLibro = async (employeeId: string): Promise<{ saldo: number; movimientos: Movimiento[] }> =>
  ok(await apiFetch(`/turnos/compensatorios/${employeeId}`), 'cargar el libro');

export const obtenerCumplimiento = async (periodo: string): Promise<{ periodo: string; empleados: ReporteEmpleado[] }> =>
  ok(await apiFetch(`/turnos/cumplimiento/${periodo}`), 'cargar el reporte');

export const exportarNovedades = async (periodo: string): Promise<string> => {
  const r = await ok<{ csv: string }>(
    await apiFetch(`/turnos/cumplimiento/${periodo}/export`),
    'exportar novedades',
  );
  return r.csv;
};
```

- [ ] **Step 2: Pestaña Catálogo**

```tsx
// apps/web/src/app/(app)/turnos/catalogo-tab.tsx
'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/components/auth-context';
import { actualizarTurno, crearTurno, listarTurnos, Turno } from './shifts-api';

export function CatalogoTab() {
  const { hasPermission } = useAuth();
  const puedeGestionar = hasPermission('shift.manage');
  const [turnos, setTurnos] = useState<Turno[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [nuevo, setNuevo] = useState({ codigo: '', nombre: '', horaInicio: '08:00', horaFin: '20:00', horasEsperadas: '12', toleranciaMinutos: '30' });

  async function refrescar() {
    try {
      setTurnos(await listarTurnos(true));
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => { refrescar(); }, []);

  async function onCrear() {
    setError(null);
    try {
      await crearTurno({
        codigo: nuevo.codigo, nombre: nuevo.nombre, horaInicio: nuevo.horaInicio, horaFin: nuevo.horaFin,
        horasEsperadas: Number(nuevo.horasEsperadas), toleranciaMinutos: Number(nuevo.toleranciaMinutos),
      });
      setNuevo({ codigo: '', nombre: '', horaInicio: '08:00', horaFin: '20:00', horasEsperadas: '12', toleranciaMinutos: '30' });
      await refrescar();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function onToggleActivo(t: Turno) {
    setError(null);
    try {
      await actualizarTurno(t.id, { activo: !t.activo });
      await refrescar();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <div className="space-y-4">
      {error && <p className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {puedeGestionar && (
        <div className="flex flex-wrap items-end gap-2 rounded border border-slate-200 bg-white p-3 text-sm">
          <label>Código<input value={nuevo.codigo} onChange={(e) => setNuevo({ ...nuevo, codigo: e.target.value })} className="mt-1 block w-24 rounded border border-slate-300 px-2 py-1.5" /></label>
          <label>Nombre<input value={nuevo.nombre} onChange={(e) => setNuevo({ ...nuevo, nombre: e.target.value })} className="mt-1 block w-56 rounded border border-slate-300 px-2 py-1.5" /></label>
          <label>Inicio<input value={nuevo.horaInicio} onChange={(e) => setNuevo({ ...nuevo, horaInicio: e.target.value })} className="mt-1 block w-20 rounded border border-slate-300 px-2 py-1.5" /></label>
          <label>Fin<input value={nuevo.horaFin} onChange={(e) => setNuevo({ ...nuevo, horaFin: e.target.value })} className="mt-1 block w-20 rounded border border-slate-300 px-2 py-1.5" /></label>
          <label>Horas<input type="number" value={nuevo.horasEsperadas} onChange={(e) => setNuevo({ ...nuevo, horasEsperadas: e.target.value })} className="mt-1 block w-20 rounded border border-slate-300 px-2 py-1.5" /></label>
          <label>Tolerancia (min)<input type="number" value={nuevo.toleranciaMinutos} onChange={(e) => setNuevo({ ...nuevo, toleranciaMinutos: e.target.value })} className="mt-1 block w-24 rounded border border-slate-300 px-2 py-1.5" /></label>
          <button onClick={onCrear} disabled={!nuevo.codigo || !nuevo.nombre} className="rounded bg-slate-900 px-3 py-2 font-medium text-white disabled:opacity-50">Crear turno</button>
        </div>
      )}
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-left text-slate-500">
            <th className="py-2">Código</th><th>Nombre</th><th>Horario</th><th>Horas</th><th>Tolerancia</th><th>Estado</th><th />
          </tr>
        </thead>
        <tbody>
          {turnos.map((t) => (
            <tr key={t.id} className="border-b border-slate-100">
              <td className="py-2 font-medium">{t.codigo}</td>
              <td>{t.nombre}</td>
              <td>{t.horaInicio}–{t.horaFin}{t.horaFin <= t.horaInicio ? ' (+1 día)' : ''}</td>
              <td>{Number(t.horasEsperadas)}</td>
              <td>{t.toleranciaMinutos} min</td>
              <td>{t.activo ? 'Activo' : 'Inactivo'}</td>
              <td>
                {puedeGestionar && (
                  <button onClick={() => onToggleActivo(t)} className="rounded border border-slate-300 px-2 py-1 text-xs">
                    {t.activo ? 'Desactivar' : 'Activar'}
                  </button>
                )}
              </td>
            </tr>
          ))}
          {turnos.length === 0 && <tr><td colSpan={7} className="py-4 text-slate-500">Sin turnos definidos.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 3: Pestaña Plan (grilla mensual + edición puntual + import)**

```tsx
// apps/web/src/app/(app)/turnos/plan-tab.tsx
'use client';

import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/components/auth-context';
import { EmpleadoResumen, listarEmpleados } from '../vacaciones/vacations-api';
import {
  Asignacion, descargarPlantillaPlan, importarPlan, listarTurnos, obtenerPlan,
  TipoDiaPlan, Turno, upsertAsignacion,
} from './shifts-api';

function diasDelMes(periodo: string): string[] {
  const [anio = 0, mes = 0] = periodo.split('-').map(Number);
  const total = new Date(anio, mes, 0).getDate();
  return Array.from({ length: total }, (_, i) => `${periodo}-${String(i + 1).padStart(2, '0')}`);
}

function etiqueta(a: Asignacion | undefined): string {
  if (!a) return '';
  if (a.tipoDia === 'DESCANSO') return 'D';
  if (a.tipoDia === 'DESCANSO_COMPENSATORIO') return 'DC';
  return a.turno?.codigo ?? 'T';
}

export function PlanTab() {
  const { hasPermission } = useAuth();
  const puedeGestionar = hasPermission('shift.manage');
  const hoy = new Date();
  const [periodo, setPeriodo] = useState(`${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}`);
  const [empleados, setEmpleados] = useState<EmpleadoResumen[]>([]);
  const [turnos, setTurnos] = useState<Turno[]>([]);
  const [plan, setPlan] = useState<Asignacion[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [resultadoImport, setResultadoImport] = useState<string | null>(null);
  const [celda, setCelda] = useState<{ employeeId: string; fecha: string } | null>(null);
  const [valorCelda, setValorCelda] = useState('');

  const dias = useMemo(() => diasDelMes(periodo), [periodo]);
  const planPorClave = useMemo(() => {
    const m = new Map<string, Asignacion>();
    for (const a of plan) m.set(`${a.employeeId}|${a.fecha.slice(0, 10)}`, a);
    return m;
  }, [plan]);

  async function refrescar() {
    setError(null);
    try {
      const [d0, dN] = [dias[0], dias[dias.length - 1]];
      setPlan(await obtenerPlan(d0!, dN!));
    } catch (e) {
      setError((e as Error).message);
    }
  }

  useEffect(() => {
    listarEmpleados().then(setEmpleados).catch((e) => setError(e.message));
    listarTurnos().then(setTurnos).catch((e) => setError(e.message));
  }, []);
  useEffect(() => { refrescar(); }, [periodo]);

  async function onGuardarCelda() {
    if (!celda || !valorCelda) return setCelda(null);
    setError(null);
    try {
      const clave = valorCelda.toUpperCase();
      let tipoDia: TipoDiaPlan = 'TURNO';
      let turnoId: string | undefined;
      if (clave === 'D') tipoDia = 'DESCANSO';
      else if (clave === 'DC') tipoDia = 'DESCANSO_COMPENSATORIO';
      else {
        const turno = turnos.find((t) => t.codigo === clave);
        if (!turno) throw new Error(`Turno "${clave}" no existe (usa un código del catálogo, D o DC)`);
        turnoId = turno.id;
      }
      await upsertAsignacion({ employeeId: celda.employeeId, fecha: celda.fecha, tipoDia, turnoId });
      setCelda(null);
      setValorCelda('');
      await refrescar();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function onImportar(archivo: File) {
    setError(null);
    setResultadoImport(null);
    try {
      const r = await importarPlan(await archivo.text());
      setResultadoImport(
        `Procesadas: ${r.procesadas} · Omitidas: ${r.omitidas} · Errores: ${r.errores.length}` +
          (r.errores.length ? ` — ${r.errores.slice(0, 5).map((e) => `fila ${e.fila}: ${e.mensaje}`).join(' | ')}` : ''),
      );
      await refrescar();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function onPlantilla() {
    const contenido = await descargarPlantillaPlan();
    const blob = new Blob([contenido], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'plantilla-plan-turnos.csv';
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-4">
      {error && <p className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {resultadoImport && <p className="rounded bg-slate-50 px-3 py-2 text-sm text-slate-700">{resultadoImport}</p>}
      <div className="flex items-end gap-3 text-sm">
        <label>Período<input type="month" value={periodo} onChange={(e) => setPeriodo(e.target.value)} className="mt-1 block rounded border border-slate-300 px-2 py-1.5" /></label>
        {puedeGestionar && (
          <>
            <button onClick={onPlantilla} className="rounded border border-slate-300 px-3 py-2">Descargar plantilla CSV</button>
            <label className="rounded bg-slate-900 px-3 py-2 font-medium text-white">
              Importar plan CSV
              <input type="file" accept=".csv" className="hidden" onChange={(e) => e.target.files?.[0] && onImportar(e.target.files[0])} />
            </label>
          </>
        )}
      </div>
      <div className="overflow-x-auto">
        <table className="border-collapse text-xs">
          <thead>
            <tr>
              <th className="sticky left-0 bg-white py-1 pr-2 text-left">Empleado</th>
              {dias.map((d) => <th key={d} className="min-w-[28px] px-0.5 text-slate-500">{d.slice(8)}</th>)}
            </tr>
          </thead>
          <tbody>
            {empleados.map((emp) => (
              <tr key={emp.id} className="border-t border-slate-100">
                <td className="sticky left-0 bg-white py-1 pr-2">{emp.apellidos}, {emp.nombres}</td>
                {dias.map((d) => {
                  const asignacion = planPorClave.get(`${emp.id}|${d}`);
                  const esCelda = celda?.employeeId === emp.id && celda?.fecha === d;
                  return (
                    <td key={d} className="border border-slate-100 p-0 text-center">
                      {esCelda ? (
                        <input
                          autoFocus
                          value={valorCelda}
                          onChange={(e) => setValorCelda(e.target.value)}
                          onBlur={onGuardarCelda}
                          onKeyDown={(e) => e.key === 'Enter' && onGuardarCelda()}
                          className="w-10 border-0 bg-amber-50 px-0.5 py-1 text-center"
                        />
                      ) : (
                        <button
                          disabled={!puedeGestionar}
                          onClick={() => { setCelda({ employeeId: emp.id, fecha: d }); setValorCelda(etiqueta(asignacion)); }}
                          className={`h-6 w-full ${asignacion?.tipoDia === 'TURNO' ? 'bg-sky-50' : asignacion ? 'bg-emerald-50' : ''}`}
                        >
                          {etiqueta(asignacion)}
                        </button>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-slate-500">Escribe el código del turno (ej. DIA, NOCHE), D = descanso, DC = descanso compensatorio. Enter para guardar.</p>
    </div>
  );
}
```

- [ ] **Step 4: Verificar tipos**

Run: `pnpm --filter @rrhh/web exec tsc --noEmit`
Expected: sin errores (los componentes aún no se montan en ninguna página; se montan en Task 13).

- [ ] **Step 5: Commit**

```bash
git add "apps/web/src/app/(app)/turnos/"
git commit -m "feat(web): API client de turnos, catálogo y grilla mensual del plan"
```

---

### Task 13: Frontend — pestañas Cumplimiento + Compensatorios y página `/turnos`

**Files:**
- Create: `apps/web/src/app/(app)/turnos/cumplimiento-tab.tsx`
- Create: `apps/web/src/app/(app)/turnos/compensatorios-tab.tsx`
- Create: `apps/web/src/app/(app)/turnos/page.tsx`

**Interfaces:**
- Consumes: `shifts-api.ts`, `CatalogoTab`, `PlanTab` (Task 12), `listarEmpleados` (vacations-api).
- Produces: página `/turnos` completa — visible con `shift.read`.

- [ ] **Step 1: Pestaña Cumplimiento (reporte + pendientes + export)**

```tsx
// apps/web/src/app/(app)/turnos/cumplimiento-tab.tsx
'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/components/auth-context';
import {
  exportarNovedades, intercambiar, obtenerCumplimiento, registrarMovimiento, ReporteEmpleado,
} from './shifts-api';
import { EmpleadoResumen, listarEmpleados } from '../vacaciones/vacations-api';

export function CumplimientoTab() {
  const { hasPermission } = useAuth();
  const puedeResolver = hasPermission('shift.resolve');
  const puedeExportar = hasPermission('shift.manage');
  const hoy = new Date();
  const [periodo, setPeriodo] = useState(`${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}`);
  const [empleados, setEmpleados] = useState<ReporteEmpleado[]>([]);
  const [todosEmpleados, setTodosEmpleados] = useState<EmpleadoResumen[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [mensaje, setMensaje] = useState<string | null>(null);

  async function refrescar() {
    setError(null);
    try {
      const r = await obtenerCumplimiento(periodo);
      setEmpleados(r.empleados);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => { refrescar(); }, [periodo]);
  useEffect(() => { listarEmpleados().then(setTodosEmpleados).catch(() => undefined); }, []);

  async function onExportar() {
    setError(null);
    try {
      const csv = await exportarNovedades(periodo);
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `novedades-turnos-${periodo}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function onConfirmarGanado(emp: ReporteEmpleado, fecha: string) {
    setError(null);
    setMensaje(null);
    try {
      await registrarMovimiento({ employeeId: emp.employeeId, tipo: 'GANADO', dias: 1, fechaReferencia: fecha, motivo: `Día adicional trabajado el ${fecha}` });
      setMensaje(`Compensatorio +1 registrado para ${emp.apellidos}`);
      await refrescar();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function onIntercambio(emp: ReporteEmpleado, fecha: string) {
    const documento = window.prompt('Documento del empleado con quien intercambió (el titular que no vino):');
    if (!documento) return;
    const otro = todosEmpleados.find((e) => e.numeroDocumento === documento.trim());
    if (!otro) return setError(`No se encontró empleado con documento "${documento}"`);
    setError(null);
    setMensaje(null);
    try {
      await intercambiar({ fecha, employeeIdA: emp.employeeId, employeeIdB: otro.id });
      setMensaje(`Intercambio registrado: ${emp.apellidos} ↔ ${otro.apellidos} (${fecha})`);
      await refrescar();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <div className="space-y-4 text-sm">
      {error && <p className="rounded bg-red-50 px-3 py-2 text-red-700">{error}</p>}
      {mensaje && <p className="rounded bg-emerald-50 px-3 py-2 text-emerald-700">{mensaje}</p>}
      <div className="flex items-end gap-3">
        <label>Período<input type="month" value={periodo} onChange={(e) => setPeriodo(e.target.value)} className="mt-1 block rounded border border-slate-300 px-2 py-1.5" /></label>
        {puedeExportar && (
          <button onClick={onExportar} className="rounded border border-slate-300 px-3 py-2">Exportar novedades (CSV nómina)</button>
        )}
      </div>
      <table className="w-full border-collapse">
        <thead>
          <tr className="border-b border-slate-200 text-left text-slate-500">
            <th className="py-2">Empleado</th><th>Plan</th><th>Trabajados</th><th>Faltas</th>
            <th>Tardanzas</th><th>Déficit</th><th>Comp. (saldo)</th><th>Pendientes</th>
          </tr>
        </thead>
        <tbody>
          {empleados.map((e) => (
            <tr key={e.employeeId} className="border-b border-slate-100 align-top">
              <td className="py-2">{e.apellidos}, {e.nombres}</td>
              <td>{e.diasPlanificados}</td>
              <td>{e.diasTrabajados}</td>
              <td className={e.faltas > 0 ? 'font-medium text-red-700' : ''}>{e.faltas}{e.faltasJustificadas > 0 ? ` (+${e.faltasJustificadas} just.)` : ''}</td>
              <td className={e.diasTardanza > 0 ? 'text-amber-700' : ''}>{e.diasTardanza} días · {e.minutosTardanza} min</td>
              <td className={e.minutosDeficit > 0 ? 'text-amber-700' : ''}>{e.minutosDeficit} min</td>
              <td>{e.compensatorios.saldoActual} (ini {e.compensatorios.saldoInicial}, +{e.compensatorios.ganados}, {e.compensatorios.gozados})</td>
              <td>
                {e.pendientesSinPlan.map((p) => (
                  <div key={p.fecha} className="mb-1 rounded bg-amber-50 px-2 py-1 text-xs">
                    <span className="font-medium">{p.fecha}</span> trabajó sin turno.
                    {p.contraparteSugerida && <span className="text-slate-600"> {p.contraparteSugerida}.</span>}
                    {puedeResolver && (
                      <span className="ml-1">
                        <button onClick={() => onIntercambio(e, p.fecha)} className="mr-1 underline">Intercambio</button>
                        <button onClick={() => onConfirmarGanado(e, p.fecha)} className="underline">Día adicional (+1)</button>
                      </span>
                    )}
                  </div>
                ))}
                {e.pendientesSinPlan.length === 0 && <span className="text-slate-400">—</span>}
              </td>
            </tr>
          ))}
          {empleados.length === 0 && <tr><td colSpan={8} className="py-4 text-slate-500">Sin personal con plan de turnos en el período.</td></tr>}
        </tbody>
      </table>
      <p className="text-xs text-slate-500">
        La falta de un titular se cruza contra su saldo marcando ese día como DC en la pestaña Plan (registra el gozado −1).
      </p>
    </div>
  );
}
```

- [ ] **Step 2: Pestaña Compensatorios (saldos + libro + ajuste inicial)**

```tsx
// apps/web/src/app/(app)/turnos/compensatorios-tab.tsx
'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/components/auth-context';
import { EmpleadoResumen, listarEmpleados } from '../vacaciones/vacations-api';
import { Movimiento, obtenerLibro, registrarMovimiento } from './shifts-api';

const TIPO_LABELS: Record<string, string> = {
  GANADO: 'Ganado (día adicional)',
  GOZADO: 'Gozado',
  AJUSTE_INICIAL: 'Ajuste inicial',
};

export function CompensatoriosTab() {
  const { hasPermission } = useAuth();
  const puedeResolver = hasPermission('shift.resolve');
  const [empleados, setEmpleados] = useState<EmpleadoResumen[]>([]);
  const [employeeId, setEmployeeId] = useState('');
  const [saldo, setSaldo] = useState<number | null>(null);
  const [movimientos, setMovimientos] = useState<Movimiento[]>([]);
  const [ajuste, setAjuste] = useState({ dias: '', motivo: '' });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listarEmpleados().then(setEmpleados).catch((e) => setError(e.message));
  }, []);

  async function cargar(id: string) {
    setEmployeeId(id);
    setError(null);
    if (!id) { setSaldo(null); setMovimientos([]); return; }
    try {
      const libro = await obtenerLibro(id);
      setSaldo(libro.saldo);
      setMovimientos(libro.movimientos);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function onAjusteInicial() {
    if (!employeeId || !ajuste.dias || !ajuste.motivo) return;
    setError(null);
    try {
      await registrarMovimiento({
        employeeId,
        tipo: 'AJUSTE_INICIAL',
        dias: Number(ajuste.dias),
        fechaReferencia: new Date().toISOString().slice(0, 10),
        motivo: ajuste.motivo,
      });
      setAjuste({ dias: '', motivo: '' });
      await cargar(employeeId);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <div className="space-y-4 text-sm">
      {error && <p className="rounded bg-red-50 px-3 py-2 text-red-700">{error}</p>}
      <div className="flex items-end gap-3">
        <label>Empleado
          <select value={employeeId} onChange={(e) => cargar(e.target.value)} className="mt-1 block w-72 rounded border border-slate-300 px-2 py-1.5">
            <option value="">— Seleccionar —</option>
            {empleados.map((e) => (
              <option key={e.id} value={e.id}>{e.apellidos}, {e.nombres} ({e.numeroDocumento})</option>
            ))}
          </select>
        </label>
        {saldo !== null && (
          <span className={`rounded px-3 py-2 font-medium ${saldo < 0 ? 'bg-red-100 text-red-800' : 'bg-emerald-100 text-emerald-800'}`}>
            Saldo: {saldo} día(s)
          </span>
        )}
      </div>
      {puedeResolver && employeeId && (
        <div className="flex items-end gap-2 rounded border border-slate-200 bg-white p-3">
          <label>Ajuste inicial (días)<input type="number" value={ajuste.dias} onChange={(e) => setAjuste({ ...ajuste, dias: e.target.value })} className="mt-1 block w-24 rounded border border-slate-300 px-2 py-1.5" /></label>
          <label className="grow">Motivo (obligatorio)<input value={ajuste.motivo} onChange={(e) => setAjuste({ ...ajuste, motivo: e.target.value })} className="mt-1 block w-full rounded border border-slate-300 px-2 py-1.5" /></label>
          <button onClick={onAjusteInicial} disabled={!ajuste.dias || !ajuste.motivo} className="rounded bg-slate-900 px-3 py-2 font-medium text-white disabled:opacity-50">Registrar</button>
        </div>
      )}
      {employeeId && (
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b border-slate-200 text-left text-slate-500">
              <th className="py-2">Fecha ref.</th><th>Tipo</th><th>Días</th><th>Motivo</th><th>Registrado</th>
            </tr>
          </thead>
          <tbody>
            {movimientos.map((m) => (
              <tr key={m.id} className="border-b border-slate-100">
                <td className="py-2">{m.fechaReferencia.slice(0, 10)}</td>
                <td>{TIPO_LABELS[m.tipo]}</td>
                <td className={Number(m.dias) < 0 ? 'text-red-700' : 'text-emerald-700'}>{Number(m.dias) > 0 ? '+' : ''}{Number(m.dias)}</td>
                <td className="text-slate-600">{m.motivo ?? '—'}</td>
                <td className="text-slate-500">{m.creadoEn.slice(0, 10)}</td>
              </tr>
            ))}
            {movimientos.length === 0 && <tr><td colSpan={5} className="py-4 text-slate-500">Sin movimientos.</td></tr>}
          </tbody>
        </table>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Página con las 4 pestañas**

```tsx
// apps/web/src/app/(app)/turnos/page.tsx
'use client';

import { useState } from 'react';
import { CatalogoTab } from './catalogo-tab';
import { PlanTab } from './plan-tab';
import { CumplimientoTab } from './cumplimiento-tab';
import { CompensatoriosTab } from './compensatorios-tab';

const TABS = [
  { id: 'plan', label: 'Plan' },
  { id: 'cumplimiento', label: 'Cumplimiento' },
  { id: 'compensatorios', label: 'Compensatorios' },
  { id: 'catalogo', label: 'Catálogo' },
] as const;

export default function TurnosPage() {
  const [tab, setTab] = useState<(typeof TABS)[number]['id']>('plan');

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Turnos</h1>
      <div className="flex gap-1 border-b border-slate-200">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-3 py-2 text-sm font-medium ${tab === t.id ? 'border-b-2 border-slate-900 text-slate-900' : 'text-slate-500'}`}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'plan' && <PlanTab />}
      {tab === 'cumplimiento' && <CumplimientoTab />}
      {tab === 'compensatorios' && <CompensatoriosTab />}
      {tab === 'catalogo' && <CatalogoTab />}
    </div>
  );
}
```

- [ ] **Step 4: Verificar tipos**

Run: `pnpm --filter @rrhh/web exec tsc --noEmit`
Expected: sin errores.

- [ ] **Step 5: Commit**

```bash
git add "apps/web/src/app/(app)/turnos/"
git commit -m "feat(web): página de turnos con cumplimiento, pendientes y libro de compensatorios"
```

---

### Task 14: Sidebar, documentación y verificación final

**Files:**
- Modify: `apps/web/src/app/(app)/layout.tsx`
- Modify: `docs/RESUMEN_SISTEMA.md`, `docs/PENDIENTES.md`

- [ ] **Step 1: Sidebar** — en `NAV_ITEMS` de `layout.tsx`, después de Asistencia:

```typescript
  { href: '/turnos', label: 'Turnos', anyPermission: ['shift.read'] },
```

- [ ] **Step 2: Documentación**

- `docs/RESUMEN_SISTEMA.md`: sección "Turnos" con la página y los endpoints de `/turnos`; actualizar la matriz de acceso (RRHH gestiona y resuelve; Manager solo lee; Employee ve su plan) y el conteo de tests.
- `docs/PENDIENTES.md`: registrar como pendientes futuros: patrones de rotación auto-generados (enfoque C descartado por YAGNI), aprobación de cambios de turno por el propio empleado, y validación de horas extra semanales para turnistas.

- [ ] **Step 3: Verificación completa**

Run: `pnpm --filter @rrhh/api test`
Expected: TODO verde (≈246 + ~38 nuevos).
Run: `pnpm --filter @rrhh/api exec tsc --noEmit`
Expected: sin errores.
Run: `pnpm --filter @rrhh/web exec tsc --noEmit`
Expected: sin errores.
Run (con el dev server APAGADO): `pnpm --filter @rrhh/web build`
Expected: build OK, 13/13 páginas.

Prueba manual E2E (docker + API + web + seed):
1. Login `rrhh@demo.pe` → `/turnos` → Catálogo: crear DIA (08:00–20:00, 12h, tol. 30) y NOCHE (20:00–08:00, 12h, tol. 30).
2. Plan: importar CSV con una semana de un empleado (3 turnos NOCHE + descansos) y editar una celda a mano.
3. `/asistencia` → importar CSV del reloj con una noche completa (ENTRADA 19:55 del lunes, SALIDA 08:03 del martes) → verificar en el resumen que el LUNES tiene ~12.13 h, sin tardanza, sin día inconsistente el martes.
4. Importar una llegada 20:31 (31 min tarde) → verificar tardanza formal y déficit si salió a la hora.
5. Cumplimiento: verificar el reporte, marcar un día trabajado sin plan como "Día adicional (+1)", programar el goce (celda DC en el Plan) y verificar el saldo en Compensatorios.
6. Exportar novedades CSV y validar el header contra la plantilla de nómina.

- [ ] **Step 4: Commit final**

```bash
git add "apps/web/src/app/(app)/layout.tsx" docs/RESUMEN_SISTEMA.md docs/PENDIENTES.md
git commit -m "feat(turnos): navegación, documentación y cierre del módulo de turnos"
```

---

## Cobertura del spec (self-check del plan)

| Requisito del spec | Task |
|---|---|
| §3.1 Turno (catálogo) | 1, 8 |
| §3.2 TurnoAsignacion (plan) | 1, 8, 9 |
| §3.3 CompensatorioMovimiento (libro) | 1, 8, 9 |
| §3.4 Campos nuevos AsistenciaResumen + ConfiguracionAsistencia | 1, 6 |
| §4.1 Ventana de captura / medianoche | 3, 6 |
| §4.2 Cumplimiento (gracia >=, compensación, déficit, extra) | 4, 5 |
| §4.3 Semana y día adicional | 10 (reporte), 13 (resolución +1) |
| §4.4 Resolución sinPlan (intercambio, ganado, cruce, error) | 9, 10, 13 (el cruce se opera marcando DC en el plan → Task 8; error → flujo de justificaciones existente) |
| §4.5 Goce programado con advertencia de saldo | 8 |
| §5 API y permisos | 2, 11 |
| §6 Integración marcación/import/recalculo retroactivo | 6, 7 |
| §7 Reporte + export novedades | 10, 13 |
| §8 Frontend | 12, 13, 14 |
| §9 Errores y validaciones | 8, 9, 11 |
| §10 Testing | 3-10, 14 |

