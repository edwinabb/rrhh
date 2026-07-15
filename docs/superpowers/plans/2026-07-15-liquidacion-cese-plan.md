# Módulo de Cese y Liquidación — Plan de Implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implementar el módulo de cese y liquidación de beneficios sociales (Perú) según `docs/superpowers/specs/2026-07-15-liquidacion-cese-design.md`: flujo completo BORRADOR→CALCULADA→APROBADA→PAGADA, récord vacacional, calculadores puros con regímenes MYPE, deducciones, 4 documentos PDF al legajo y 2 páginas frontend.

**Architecture:** Módulo NestJS `termination` que orquesta calculadores puros nuevos/reescritos en `payroll/calculators` (mismo patrón de Fase 1: funciones sin efectos, parámetros normativos como argumentos), mini-módulo `vacations` (tabla `VacacionPeriodo`), PDFs con pdfkit archivados vía `DocumentService` existente, frontend Next.js con el patrón de páginas actual.

**Tech Stack:** NestJS + TypeScript, Prisma + PostgreSQL (RLS), Jest (TDD), pdfkit, Next.js 14 + Tailwind.

## Global Constraints

- Monorepo pnpm: tests con `pnpm --filter @rrhh/api test -- <pattern>`; el filtro de la web es `@rrhh/web`.
- TODO cálculo monetario redondea a 2 decimales con `Math.round(x * 100) / 100` (helper `redondear`).
- Los services NO abren transacciones: reciben `tx` (cliente Prisma) como primer parámetro; el controller lo obtiene de `getTenantContext()` (que expone `tx`, `tenantId`, `userId` — validar con el helper `requireIdentity` como en `documents.controller.ts`).
- Toda tabla nueva: RLS (`ENABLE`+`FORCE`+política `tenant_isolation` sobre `current_setting('app.tenant_id', true)::uuid`), GRANTs explícitos por rol de Postgres (`app_admin`, `app_rrhh`, `app_manager`, `app_employee`), y trigger `audit_trigger()` — patrón de `20260714200000_fase4_ats/migration.sql`.
- Parámetros normativos NUNCA hardcodeados en calculadores: se pasan como argumentos; los valores del seed se marcan "valor de referencia sin confirmar".
- Los 208 tests existentes deben seguir en verde tras cada tarea.
- NUNCA ejecutar `next build` con el dev server de la web corriendo (comparten `.next`).
- Sin class-validator: DTOs como clases planas + validación manual (patrón del proyecto).
- Comentarios y nombres de dominio en español (patrón del proyecto); commits en español con prefijo convencional.

## File Structure

```
packages/database/prisma/schema.prisma                                  (modificar: Cese, VacacionPeriodo, enums, quitar Liquidacion)
packages/database/prisma/migrations/20260715000000_cese_liquidacion/migration.sql  (crear)
packages/database/seed.ts                                               (modificar: permisos + parámetros nuevos)
apps/api/src/modules/payroll/calculators/vacaciones.calculator.ts       (crear + spec)
apps/api/src/modules/payroll/calculators/indemnizacion-despido.calculator.ts (crear + spec)
apps/api/src/modules/payroll/calculators/liquidacion.calculator.ts      (reescribir + spec)
apps/api/src/modules/vacations/vacations.service.ts                     (crear + spec)
apps/api/src/modules/vacations/vacations.controller.ts                  (crear)
apps/api/src/modules/vacations/vacations.module.ts                      (crear)
apps/api/src/modules/termination/termination.service.ts                 (crear + spec)
apps/api/src/modules/termination/cese-documents.service.ts              (crear + spec)
apps/api/src/modules/termination/termination.controller.ts              (crear)
apps/api/src/modules/termination/termination.module.ts                  (crear)
apps/api/src/app.module.ts                                              (modificar: registrar 2 módulos)
apps/web/src/app/(app)/vacaciones/page.tsx + vacations-api.ts           (crear)
apps/web/src/app/(app)/liquidaciones/page.tsx + termination-api.ts + wizard-cese.tsx + detalle-cese.tsx (crear)
apps/web/src/app/(app)/layout.tsx                                       (modificar: 2 items de sidebar)
docs/RESUMEN_SISTEMA.md, docs/PENDIENTES.md                             (modificar al final)
```

---

### Task 1: Schema Prisma + migración (Cese, VacacionPeriodo, MYPE, tipos de documento)

**Files:**
- Modify: `packages/database/prisma/schema.prisma`
- Create: `packages/database/prisma/migrations/20260715000000_cese_liquidacion/migration.sql`

**Interfaces:**
- Produces: modelos Prisma `Cese`, `VacacionPeriodo`, enums `MotivoCese`, `EstadoCese`, `EstadoVacacionPeriodo`; enum `TipoDocumento` ampliado; `Contrato.regimenLaboral` con valores `general | mype_micro | mype_pequena | agrario`. Consumidos por todas las tareas siguientes.

- [ ] **Step 1: Editar `schema.prisma`**

1. Eliminar el modelo `Liquidacion` completo (líneas ~331-341) y la relación `liquidacion Liquidacion?` en `Employee`.
2. Actualizar el comentario de `Contrato.regimenLaboral` a `// general | mype_micro | mype_pequena | agrario` y ampliar el varchar: `@db.VarChar(20)` se mantiene (cabe `mype_pequena`).
3. Agregar al enum `TipoDocumento`: `LIQUIDACION`, `CERTIFICADO_TRABAJO`, `CONSTANCIA_CESE`, `CERTIFICADO_RETENCION_5TA`, `CARTA_RENUNCIA`, `EXAMEN_MEDICO_RETIRO` (después de `BOLETA`).
4. Agregar al final de la sección Fase 1 (donde estaba `Liquidacion`):

```prisma
// ---------------------------------------------------------------------------
// Cese y liquidación de beneficios sociales (D.S. 001-97-TR: pago en 48h).
// Ver docs/superpowers/specs/2026-07-15-liquidacion-cese-design.md.
// ---------------------------------------------------------------------------

enum MotivoCese {
  RENUNCIA
  TERMINO_CONTRATO
  MUTUO_DISENSO
  DESPIDO_ARBITRARIO
  FALLECIMIENTO

  @@map("motivo_cese")
}

enum EstadoCese {
  BORRADOR
  CALCULADA
  APROBADA
  PAGADA
  ANULADA

  @@map("estado_cese")
}

model Cese {
  id         String     @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  tenantId   String     @map("tenant_id") @db.Uuid
  employeeId String     @map("employee_id") @db.Uuid
  fechaCese  DateTime   @map("fecha_cese") @db.Date
  motivo     MotivoCese
  estado     EstadoCese @default(BORRADOR)

  inputSnapshot Json  @map("input_snapshot")
  componentes   Json?
  totalBruto       Decimal? @map("total_bruto") @db.Decimal(12, 2)
  totalDeducciones Decimal? @map("total_deducciones") @db.Decimal(12, 2)
  netoPagar        Decimal? @map("neto_pagar") @db.Decimal(12, 2)

  gratificacionExtraordinaria Decimal @default(0) @map("gratificacion_extraordinaria") @db.Decimal(12, 2)
  derechohabientes            Json?

  fechaLimitePago  DateTime  @map("fecha_limite_pago") @db.Date
  aprobadoPor      String?   @map("aprobado_por") @db.Uuid
  aprobadoEn       DateTime? @map("aprobado_en")
  pagadoEn         DateTime? @map("pagado_en")
  pagoFueraDePlazo Boolean   @default(false) @map("pago_fuera_de_plazo")
  motivoAnulacion  String?   @map("motivo_anulacion") @db.Text

  creadoPor     String   @map("creado_por") @db.Uuid
  creadoEn      DateTime @default(now()) @map("creado_en")
  actualizadoEn DateTime @updatedAt @map("actualizado_en")

  tenant   Tenant   @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  employee Employee @relation(fields: [employeeId], references: [id])

  @@index([tenantId, estado])
  @@index([tenantId, employeeId])
  @@map("cese")
}

enum EstadoVacacionPeriodo {
  EN_CURSO
  VENCIDO_PENDIENTE
  GOZADO
  LIQUIDADO

  @@map("estado_vacacion_periodo")
}

model VacacionPeriodo {
  id            String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  tenantId      String   @map("tenant_id") @db.Uuid
  employeeId    String   @map("employee_id") @db.Uuid
  periodoInicio DateTime @map("periodo_inicio") @db.Date
  periodoFin    DateTime @map("periodo_fin") @db.Date
  diasGanados   Int      @map("dias_ganados")
  diasGozados   Decimal  @default(0) @map("dias_gozados") @db.Decimal(5, 2)
  estado        EstadoVacacionPeriodo @default(EN_CURSO)
  notas         String?  @db.Text
  creadoEn      DateTime @default(now()) @map("creado_en")
  actualizadoEn DateTime @updatedAt @map("actualizado_en")

  tenant   Tenant   @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  employee Employee @relation(fields: [employeeId], references: [id], onDelete: Cascade)

  @@unique([tenantId, employeeId, periodoInicio])
  @@index([tenantId, estado])
  @@map("vacacion_periodo")
}
```

5. En `Employee`, reemplazar `liquidacion Liquidacion?` por:

```prisma
  ceses                 Cese[]
  vacacionPeriodos      VacacionPeriodo[]
```

6. En `Tenant`, agregar junto a `planillaNovedades`:

```prisma
  ceses             Cese[]
  vacacionPeriodos  VacacionPeriodo[]
```

- [ ] **Step 2: Crear la migración manual**

Crear `packages/database/prisma/migrations/20260715000000_cese_liquidacion/migration.sql`:

```sql
-- Cese y liquidación de beneficios sociales + récord vacacional.
-- Patrón RLS/GRANT/auditoría de 20260714200000_fase4_ats.

-- 1. MYPE: separar micro y pequeña empresa (D.S. 013-2013-PRODUCE).
--    Los contratos 'mype' existentes migran a 'mype_pequena' (default
--    legalmente conservador: paga 50% en vez de 0%).
UPDATE "contrato" SET "regimen_laboral" = 'mype_pequena' WHERE "regimen_laboral" = 'mype';

-- 2. Tipos de documento nuevos para el cese.
ALTER TYPE "tipo_documento" ADD VALUE IF NOT EXISTS 'LIQUIDACION';
ALTER TYPE "tipo_documento" ADD VALUE IF NOT EXISTS 'CERTIFICADO_TRABAJO';
ALTER TYPE "tipo_documento" ADD VALUE IF NOT EXISTS 'CONSTANCIA_CESE';
ALTER TYPE "tipo_documento" ADD VALUE IF NOT EXISTS 'CERTIFICADO_RETENCION_5TA';
ALTER TYPE "tipo_documento" ADD VALUE IF NOT EXISTS 'CARTA_RENUNCIA';
ALTER TYPE "tipo_documento" ADD VALUE IF NOT EXISTS 'EXAMEN_MEDICO_RETIRO';

-- 3. Reemplazo del stub "liquidacion" de Fase 1 (solo contiene datos demo).
DROP TRIGGER IF EXISTS "liquidacion_audit" ON "liquidacion";
DROP TABLE IF EXISTS "liquidacion";

CREATE TYPE "motivo_cese" AS ENUM ('RENUNCIA', 'TERMINO_CONTRATO', 'MUTUO_DISENSO', 'DESPIDO_ARBITRARIO', 'FALLECIMIENTO');
CREATE TYPE "estado_cese" AS ENUM ('BORRADOR', 'CALCULADA', 'APROBADA', 'PAGADA', 'ANULADA');
CREATE TYPE "estado_vacacion_periodo" AS ENUM ('EN_CURSO', 'VENCIDO_PENDIENTE', 'GOZADO', 'LIQUIDADO');

CREATE TABLE "cese" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "fecha_cese" DATE NOT NULL,
    "motivo" "motivo_cese" NOT NULL,
    "estado" "estado_cese" NOT NULL DEFAULT 'BORRADOR',
    "input_snapshot" JSONB NOT NULL,
    "componentes" JSONB,
    "total_bruto" DECIMAL(12,2),
    "total_deducciones" DECIMAL(12,2),
    "neto_pagar" DECIMAL(12,2),
    "gratificacion_extraordinaria" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "derechohabientes" JSONB,
    "fecha_limite_pago" DATE NOT NULL,
    "aprobado_por" UUID,
    "aprobado_en" TIMESTAMP(3),
    "pagado_en" TIMESTAMP(3),
    "pago_fuera_de_plazo" BOOLEAN NOT NULL DEFAULT false,
    "motivo_anulacion" TEXT,
    "creado_por" UUID NOT NULL,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "cese_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "cese_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE,
    CONSTRAINT "cese_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employee"("id")
);
CREATE INDEX "cese_tenant_id_estado_idx" ON "cese"("tenant_id", "estado");
CREATE INDEX "cese_tenant_id_employee_id_idx" ON "cese"("tenant_id", "employee_id");
-- Regla de negocio a nivel BD: un solo cese vigente (no anulado) por empleado.
CREATE UNIQUE INDEX "cese_employee_vigente_key" ON "cese"("employee_id") WHERE "estado" <> 'ANULADA';

CREATE TABLE "vacacion_periodo" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "periodo_inicio" DATE NOT NULL,
    "periodo_fin" DATE NOT NULL,
    "dias_ganados" INTEGER NOT NULL,
    "dias_gozados" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "estado" "estado_vacacion_periodo" NOT NULL DEFAULT 'EN_CURSO',
    "notas" TEXT,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "vacacion_periodo_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "vacacion_periodo_tenant_id_employee_id_periodo_inicio_key" UNIQUE ("tenant_id", "employee_id", "periodo_inicio"),
    CONSTRAINT "vacacion_periodo_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE,
    CONSTRAINT "vacacion_periodo_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employee"("id") ON DELETE CASCADE
);
CREATE INDEX "vacacion_periodo_tenant_id_estado_idx" ON "vacacion_periodo"("tenant_id", "estado");

-- RLS
ALTER TABLE "cese" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "cese" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "cese"
    USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid);

ALTER TABLE "vacacion_periodo" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "vacacion_periodo" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "vacacion_periodo"
    USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid);

-- Privilegios: cese es dato salarial sensible — solo RRHH/Admin. Sin DELETE
-- (anular = UPDATE de estado a ANULADA). Vacaciones: manager consulta su equipo.
GRANT SELECT, INSERT, UPDATE ON "cese" TO app_rrhh, app_admin;
GRANT SELECT, INSERT, UPDATE ON "vacacion_periodo" TO app_rrhh, app_admin;
GRANT SELECT ON "vacacion_periodo" TO app_manager;

-- Auditoría inmutable
CREATE TRIGGER "cese_audit" AFTER INSERT OR UPDATE OR DELETE ON "cese"
    FOR EACH ROW EXECUTE FUNCTION audit_trigger();
CREATE TRIGGER "vacacion_periodo_audit" AFTER INSERT OR UPDATE OR DELETE ON "vacacion_periodo"
    FOR EACH ROW EXECUTE FUNCTION audit_trigger();
```

- [ ] **Step 3: Aplicar migración y regenerar cliente**

Run: `cd packages/database && pnpm migrate:deploy && pnpm prisma generate`
Expected: `1 migration applied` (o similar) y cliente regenerado sin errores. Si `migrate:deploy` no existe como script, usar `pnpm prisma migrate deploy`.

- [ ] **Step 4: Verificar que la API compila y los tests siguen en verde**

Run: `pnpm --filter @rrhh/api test`
Expected: 208 tests PASS (el modelo `Liquidacion` eliminado no se usa en ningún service — solo el calculador, que no toca Prisma).

- [ ] **Step 5: Commit**

```bash
git add packages/database/prisma/schema.prisma packages/database/prisma/migrations/20260715000000_cese_liquidacion/
git commit -m "feat(cese): schema y migración de cese, récord vacacional y MYPE micro/pequeña"
```

---

### Task 2: Seed — permisos y parámetros normativos del cese

**Files:**
- Modify: `packages/database/seed.ts`

**Interfaces:**
- Produces: permisos `termination.read`, `termination.manage`, `termination.approve`, `vacation.read`, `vacation.manage` (usados por controllers en Tasks 6 y 10 y el sidebar en Task 13); parámetros `INDEMNIZACION_TOPE_REMUNERACIONES`, `VACACIONES_DIAS_GENERAL`, `VACACIONES_DIAS_MYPE`, `MYPE_FACTOR_PEQUENA`, `MYPE_FACTOR_MICRO`, `INDEMNIZACION_MYPE` (consumidos por `TerminationService` en Task 8).

- [ ] **Step 1: Agregar permisos al array `PERMISSIONS`** (después del bloque `ats.*`):

```typescript
  { code: 'termination.read', descripcion: 'Ver ceses y liquidaciones', esSensible: true },
  { code: 'termination.manage', descripcion: 'Registrar ceses, corregir datos y calcular liquidaciones', esSensible: true },
  { code: 'termination.approve', descripcion: 'Aprobar, pagar y anular liquidaciones', esSensible: true },
  { code: 'vacation.read', descripcion: 'Ver récord vacacional', esSensible: false },
  { code: 'vacation.manage', descripcion: 'Gestionar el récord vacacional', esSensible: false },
```

- [ ] **Step 2: Asignar a los roles de sistema en `SYSTEM_ROLES`**

- Rol Admin: agregar los 5 códigos (`termination.read`, `termination.manage`, `termination.approve`, `vacation.read`, `vacation.manage`).
- Rol RRHH: agregar `termination.read`, `termination.manage`, `vacation.read`, `vacation.manage` (SIN `termination.approve` — separación de funciones, aprueba solo Admin).
- Rol Manager: agregar `vacation.read`.
- Rol Employee: sin cambios.

- [ ] **Step 3: Agregar parámetros a `NORMATIVE_PARAMETERS_SEED`** (todos con el sufijo "— valor de referencia sin confirmar" en la descripción, como los existentes):

```typescript
  {
    codigo: 'INDEMNIZACION_TOPE_REMUNERACIONES',
    valor: 12,
    descripcion: 'Tope de indemnización por despido arbitrario, en remuneraciones (régimen general) — valor de referencia sin confirmar',
  },
  {
    codigo: 'VACACIONES_DIAS_GENERAL',
    valor: 30,
    descripcion: 'Días de vacaciones por período — régimen general/agrario (D.Leg. 713) — valor de referencia sin confirmar',
  },
  {
    codigo: 'VACACIONES_DIAS_MYPE',
    valor: 15,
    descripcion: 'Días de vacaciones por período — micro y pequeña empresa — valor de referencia sin confirmar',
  },
  {
    codigo: 'MYPE_FACTOR_CTS_GRATI',
    valor: { mype_pequena: 0.5, mype_micro: 0 },
    descripcion: 'Factor de CTS/gratificación por régimen MYPE (D.S. 013-2013-PRODUCE) — valor de referencia sin confirmar',
  },
  {
    codigo: 'INDEMNIZACION_MYPE',
    valor: { mype_pequena: { diasPorAnio: 20, topeDias: 120 }, mype_micro: { diasPorAnio: 10, topeDias: 90 } },
    descripcion: 'Indemnización por despido en MYPE: remuneraciones diarias por año y tope — valor de referencia sin confirmar',
  },
```

- [ ] **Step 4: Ejecutar el seed (idempotente) y verificar**

Run: `cd packages/database && pnpm run seed`
Expected: termina sin errores; imprime el sembrado de permisos/roles/parámetros. Re-ejecutarlo no duplica filas.

- [ ] **Step 5: Commit**

```bash
git add packages/database/seed.ts
git commit -m "feat(cese): permisos termination/vacation y parámetros normativos de liquidación"
```

---

### Task 3: `vacaciones.calculator` — devengadas, truncas e indemnización vacacional

**Files:**
- Create: `apps/api/src/modules/payroll/calculators/vacaciones.calculator.ts`
- Test: `apps/api/src/modules/payroll/calculators/vacaciones.calculator.spec.ts`

**Interfaces:**
- Produces: `calcularVacacionesCese(input: VacacionesCeseInput): VacacionesCeseResult` — consumido por el motor de liquidación (Task 5). Tipos exactos definidos abajo.

- [ ] **Step 1: Escribir los tests que fallan**

```typescript
// apps/api/src/modules/payroll/calculators/vacaciones.calculator.spec.ts
import { calcularVacacionesCese } from './vacaciones.calculator';

describe('calcularVacacionesCese', () => {
  const base = {
    remuneracionComputable: 3000,
    fechaCese: new Date('2026-07-15'),
    excluidoIndemnizacion: false,
  };

  it('vacaciones truncas: proporcional del período en curso (meses completos + días/30) / 12', () => {
    const r = calcularVacacionesCese({
      ...base,
      periodos: [
        {
          periodoInicio: new Date('2026-03-01'),
          periodoFin: new Date('2027-02-28'),
          diasGanados: 30,
          diasGozados: 0,
          estado: 'EN_CURSO',
        },
      ],
    });
    // 4 meses completos (mar, abr, may, jun) + 14 días → (4 + 14/30) / 12 × 3000 = 1116.67
    expect(r.vacacionesTruncas).toBeCloseTo(1116.67, 2);
    expect(r.vacacionesDevengadas).toBe(0);
    expect(r.indemnizacionVacacional).toBe(0);
  });

  it('devengadas: días no gozados de períodos vencidos × valor-día vigente', () => {
    const r = calcularVacacionesCese({
      ...base,
      periodos: [
        {
          periodoInicio: new Date('2025-03-01'),
          periodoFin: new Date('2026-02-28'),
          diasGanados: 30,
          diasGozados: 10,
          estado: 'VENCIDO_PENDIENTE',
        },
      ],
    });
    // 20 días × (3000/30) = 2000. Vencido hace < 1 año a la fecha de cese → sin indemnización.
    expect(r.vacacionesDevengadas).toBe(2000);
    expect(r.indemnizacionVacacional).toBe(0);
  });

  it('indemnización vacacional (art. 23 D.Leg. 713): período vencido hace más de 1 año sin gozar', () => {
    const r = calcularVacacionesCese({
      ...base,
      periodos: [
        {
          periodoInicio: new Date('2024-03-01'),
          periodoFin: new Date('2025-02-28'),
          diasGanados: 30,
          diasGozados: 0,
          estado: 'VENCIDO_PENDIENTE',
        },
      ],
    });
    // periodoFin 2025-02-28 + 1 año = 2026-02-28 < fechaCese 2026-07-15 → indemnización
    expect(r.vacacionesDevengadas).toBe(3000); // 30 días no gozados
    expect(r.indemnizacionVacacional).toBe(3000); // una remuneración adicional
  });

  it('flag excluidoIndemnizacion (gerentes que deciden sus vacaciones) anula solo la indemnización', () => {
    const r = calcularVacacionesCese({
      ...base,
      excluidoIndemnizacion: true,
      periodos: [
        {
          periodoInicio: new Date('2024-03-01'),
          periodoFin: new Date('2025-02-28'),
          diasGanados: 30,
          diasGozados: 0,
          estado: 'VENCIDO_PENDIENTE',
        },
      ],
    });
    expect(r.vacacionesDevengadas).toBe(3000);
    expect(r.indemnizacionVacacional).toBe(0);
  });

  it('período GOZADO o LIQUIDADO no genera monto alguno', () => {
    const r = calcularVacacionesCese({
      ...base,
      periodos: [
        {
          periodoInicio: new Date('2025-03-01'),
          periodoFin: new Date('2026-02-28'),
          diasGanados: 30,
          diasGozados: 30,
          estado: 'GOZADO',
        },
      ],
    });
    expect(r.vacacionesDevengadas).toBe(0);
    expect(r.vacacionesTruncas).toBe(0);
    expect(r.indemnizacionVacacional).toBe(0);
  });

  it('MYPE (15 días ganados): trunca proporcional sobre 15/12 avos', () => {
    const r = calcularVacacionesCese({
      ...base,
      periodos: [
        {
          periodoInicio: new Date('2026-01-15'),
          periodoFin: new Date('2027-01-14'),
          diasGanados: 15,
          diasGozados: 0,
          estado: 'EN_CURSO',
        },
      ],
    });
    // 6 meses completos (15ene→15jul) + 0 días → 6/12 × (15/30 × 3000) = 750
    expect(r.vacacionesTruncas).toBeCloseTo(750, 2);
  });
});
```

- [ ] **Step 2: Verificar que falla**

Run: `pnpm --filter @rrhh/api test -- vacaciones.calculator`
Expected: FAIL — `Cannot find module './vacaciones.calculator'`

- [ ] **Step 3: Implementación mínima**

```typescript
// apps/api/src/modules/payroll/calculators/vacaciones.calculator.ts
/**
 * Vacaciones al cese (D.Leg. 713):
 * - Devengadas: días ganados no gozados de períodos vencidos × valor-día vigente.
 * - Truncas: proporcional del período EN_CURSO — (meses completos + días/30)/12
 *   sobre la remuneración vacacional del período (diasGanados/30 × computable).
 * - Indemnización (art. 23): una remuneración adicional por período vencido hace
 *   más de un año sin gozar; excluible para gerentes que deciden sus vacaciones.
 * Ver spec 2026-07-15-liquidacion-cese-design.md §4.2.
 */
export type EstadoPeriodoVacacional = 'EN_CURSO' | 'VENCIDO_PENDIENTE' | 'GOZADO' | 'LIQUIDADO';

export interface PeriodoVacacionalInput {
  periodoInicio: Date;
  periodoFin: Date;
  diasGanados: number;
  diasGozados: number;
  estado: EstadoPeriodoVacacional;
}

export interface VacacionesCeseInput {
  remuneracionComputable: number;
  fechaCese: Date;
  periodos: PeriodoVacacionalInput[];
  excluidoIndemnizacion: boolean;
}

export interface VacacionesCeseResult {
  vacacionesDevengadas: number;
  vacacionesTruncas: number;
  indemnizacionVacacional: number;
}

const DIAS_POR_MES = 30;
const MESES_POR_ANIO = 12;

function redondear(monto: number): number {
  return Math.round(monto * 100) / 100;
}

/** Meses calendario completos + días sueltos entre dos fechas (convención 30/360 del proyecto). */
function mesesYDias(desde: Date, hasta: Date): { meses: number; dias: number } {
  let meses =
    (hasta.getUTCFullYear() - desde.getUTCFullYear()) * 12 +
    (hasta.getUTCMonth() - desde.getUTCMonth());
  let dias = hasta.getUTCDate() - desde.getUTCDate();
  if (dias < 0) {
    meses -= 1;
    dias += DIAS_POR_MES;
  }
  return { meses: Math.max(0, meses), dias: Math.max(0, dias) };
}

function anioDespues(fecha: Date): Date {
  const d = new Date(fecha);
  d.setUTCFullYear(d.getUTCFullYear() + 1);
  return d;
}

export function calcularVacacionesCese(input: VacacionesCeseInput): VacacionesCeseResult {
  const valorDia = input.remuneracionComputable / DIAS_POR_MES;
  let devengadas = 0;
  let truncas = 0;
  let periodosConIndemnizacion = 0;

  for (const periodo of input.periodos) {
    if (periodo.estado === 'GOZADO' || periodo.estado === 'LIQUIDADO') continue;

    if (periodo.estado === 'VENCIDO_PENDIENTE') {
      const diasPendientes = Math.max(0, periodo.diasGanados - periodo.diasGozados);
      devengadas += diasPendientes * valorDia;
      if (
        diasPendientes > 0 &&
        anioDespues(periodo.periodoFin).getTime() < input.fechaCese.getTime()
      ) {
        periodosConIndemnizacion += 1;
      }
      continue;
    }

    // EN_CURSO: récord trunco proporcional al tiempo transcurrido del período.
    const { meses, dias } = mesesYDias(periodo.periodoInicio, input.fechaCese);
    const fraccion = meses / MESES_POR_ANIO + dias / (MESES_POR_ANIO * DIAS_POR_MES);
    const remuneracionVacacional =
      (periodo.diasGanados / DIAS_POR_MES) * input.remuneracionComputable;
    truncas += remuneracionVacacional * Math.min(1, fraccion);
  }

  const indemnizacion = input.excluidoIndemnizacion
    ? 0
    : periodosConIndemnizacion * input.remuneracionComputable;

  return {
    vacacionesDevengadas: redondear(devengadas),
    vacacionesTruncas: redondear(truncas),
    indemnizacionVacacional: redondear(indemnizacion),
  };
}
```

- [ ] **Step 4: Verificar que pasa**

Run: `pnpm --filter @rrhh/api test -- vacaciones.calculator`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/payroll/calculators/vacaciones.calculator.ts apps/api/src/modules/payroll/calculators/vacaciones.calculator.spec.ts
git commit -m "feat(cese): calculador de vacaciones al cese (devengadas, truncas, indemnización art. 23)"
```

---

### Task 4: `indemnizacion-despido.calculator`

**Files:**
- Create: `apps/api/src/modules/payroll/calculators/indemnizacion-despido.calculator.ts`
- Test: `apps/api/src/modules/payroll/calculators/indemnizacion-despido.calculator.spec.ts`

**Interfaces:**
- Produces: `calcularIndemnizacionDespido(input: IndemnizacionDespidoInput): IndemnizacionDespidoResult` — consumido por el motor (Task 5).

- [ ] **Step 1: Escribir los tests que fallan**

```typescript
// apps/api/src/modules/payroll/calculators/indemnizacion-despido.calculator.spec.ts
import { calcularIndemnizacionDespido } from './indemnizacion-despido.calculator';

describe('calcularIndemnizacionDespido', () => {
  const paramsGeneral = {
    topeRemuneraciones: 12,
    mypeParams: {
      mype_pequena: { diasPorAnio: 20, topeDias: 120 },
      mype_micro: { diasPorAnio: 10, topeDias: 90 },
    },
  };

  it('indeterminado (general): 1.5 remuneraciones por año + fracción proporcional', () => {
    const r = calcularIndemnizacionDespido({
      ...paramsGeneral,
      regimen: 'general',
      tipoContrato: 'indeterminado',
      remuneracionMensual: 3000,
      aniosCompletos: 3,
      mesesAdicionales: 6,
      diasAdicionales: 0,
      mesesRestantesContrato: 0,
    });
    // 1.5 × 3000 × (3 + 6/12) = 15750
    expect(r.monto).toBe(15750);
  });

  it('indeterminado (general): aplica el tope de 12 remuneraciones', () => {
    const r = calcularIndemnizacionDespido({
      ...paramsGeneral,
      regimen: 'general',
      tipoContrato: 'indeterminado',
      remuneracionMensual: 3000,
      aniosCompletos: 10,
      mesesAdicionales: 0,
      diasAdicionales: 0,
      mesesRestantesContrato: 0,
    });
    // 1.5 × 3000 × 10 = 45000 > tope 12 × 3000 = 36000
    expect(r.monto).toBe(36000);
    expect(r.topeAplicado).toBe(true);
  });

  it('plazo fijo (general): 1.5 remuneraciones por mes restante, con tope', () => {
    const r = calcularIndemnizacionDespido({
      ...paramsGeneral,
      regimen: 'general',
      tipoContrato: 'plazo_fijo',
      remuneracionMensual: 2000,
      aniosCompletos: 1,
      mesesAdicionales: 0,
      diasAdicionales: 0,
      mesesRestantesContrato: 4,
    });
    // 1.5 × 2000 × 4 = 12000 (< tope 24000)
    expect(r.monto).toBe(12000);
  });

  it('MYPE pequeña: 20 remuneraciones diarias por año, tope 120 días', () => {
    const r = calcularIndemnizacionDespido({
      ...paramsGeneral,
      regimen: 'mype_pequena',
      tipoContrato: 'indeterminado',
      remuneracionMensual: 1500, // remuneración diaria = 50
      aniosCompletos: 8,
      mesesAdicionales: 0,
      diasAdicionales: 0,
      mesesRestantesContrato: 0,
    });
    // 20 días × 8 años = 160 días > tope 120 → 120 × 50 = 6000
    expect(r.monto).toBe(6000);
    expect(r.topeAplicado).toBe(true);
  });

  it('MYPE micro: 10 remuneraciones diarias por año, tope 90 días', () => {
    const r = calcularIndemnizacionDespido({
      ...paramsGeneral,
      regimen: 'mype_micro',
      tipoContrato: 'indeterminado',
      remuneracionMensual: 1200, // diaria = 40
      aniosCompletos: 2,
      mesesAdicionales: 6,
      diasAdicionales: 0,
      mesesRestantesContrato: 0,
    });
    // 10 × 2.5 = 25 días × 40 = 1000
    expect(r.monto).toBe(1000);
    expect(r.topeAplicado).toBe(false);
  });
});
```

- [ ] **Step 2: Verificar que falla**

Run: `pnpm --filter @rrhh/api test -- indemnizacion-despido`
Expected: FAIL — `Cannot find module './indemnizacion-despido.calculator'`

- [ ] **Step 3: Implementación mínima**

```typescript
// apps/api/src/modules/payroll/calculators/indemnizacion-despido.calculator.ts
/**
 * Indemnización por despido arbitrario (D.S. 003-97-TR arts. 38 y 76):
 * - Indeterminado: 1.5 remuneraciones mensuales por año completo + fracción
 *   proporcional por meses/días; tope 12 remuneraciones.
 * - Plazo fijo: 1.5 remuneraciones por mes que falte al vencimiento; tope 12.
 * - MYPE (D.S. 013-2013-PRODUCE): pequeña 20 remuneraciones diarias/año (tope
 *   120 días); micro 10/año (tope 90 días).
 * Ver spec 2026-07-15-liquidacion-cese-design.md §4.3.
 */
export type RegimenLaboral = 'general' | 'mype_micro' | 'mype_pequena' | 'agrario';
export type TipoContratoIndemnizacion = 'indeterminado' | 'plazo_fijo';

export interface IndemnizacionMypeParams {
  diasPorAnio: number;
  topeDias: number;
}

export interface IndemnizacionDespidoInput {
  regimen: RegimenLaboral;
  tipoContrato: TipoContratoIndemnizacion;
  remuneracionMensual: number;
  aniosCompletos: number;
  mesesAdicionales: number;
  diasAdicionales: number;
  /** Solo plazo fijo: meses que faltan hasta el vencimiento pactado. */
  mesesRestantesContrato: number;
  topeRemuneraciones: number;
  mypeParams: { mype_pequena: IndemnizacionMypeParams; mype_micro: IndemnizacionMypeParams };
}

export interface IndemnizacionDespidoResult {
  monto: number;
  topeAplicado: boolean;
}

const FACTOR_GENERAL = 1.5;
const DIAS_POR_MES = 30;

function redondear(monto: number): number {
  return Math.round(monto * 100) / 100;
}

export function calcularIndemnizacionDespido(
  input: IndemnizacionDespidoInput,
): IndemnizacionDespidoResult {
  const aniosConFraccion =
    input.aniosCompletos + input.mesesAdicionales / 12 + input.diasAdicionales / 360;

  if (input.regimen === 'mype_micro' || input.regimen === 'mype_pequena') {
    const params = input.mypeParams[input.regimen];
    const remuneracionDiaria = input.remuneracionMensual / DIAS_POR_MES;
    const dias = params.diasPorAnio * aniosConFraccion;
    const diasConTope = Math.min(dias, params.topeDias);
    return {
      monto: redondear(diasConTope * remuneracionDiaria),
      topeAplicado: dias > params.topeDias,
    };
  }

  const base =
    input.tipoContrato === 'plazo_fijo'
      ? FACTOR_GENERAL * input.remuneracionMensual * input.mesesRestantesContrato
      : FACTOR_GENERAL * input.remuneracionMensual * aniosConFraccion;
  const tope = input.topeRemuneraciones * input.remuneracionMensual;

  return { monto: redondear(Math.min(base, tope)), topeAplicado: base > tope };
}
```

- [ ] **Step 4: Verificar que pasa**

Run: `pnpm --filter @rrhh/api test -- indemnizacion-despido`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/payroll/calculators/indemnizacion-despido.calculator.ts apps/api/src/modules/payroll/calculators/indemnizacion-despido.calculator.spec.ts
git commit -m "feat(cese): calculador de indemnización por despido arbitrario con topes por régimen"
```

---

### Task 5: Motor `liquidacion.calculator` (reescritura completa)

**Files:**
- Modify: `apps/api/src/modules/payroll/calculators/liquidacion.calculator.ts` (reescribir entero)
- Modify: `apps/api/src/modules/payroll/calculators/liquidacion.calculator.spec.ts` (reescribir entero — los 2 tests del stub se reemplazan)

**Interfaces:**
- Consumes: `calcularCtsTrunca` (cts.calculator), `calcularGratificacion` (gratificacion.calculator), `calcularVacacionesCese` (Task 3), `calcularIndemnizacionDespido` (Task 4), `calcularRetencionPensionaria` (afp-onp.calculator), `calcularRetencionQuinta` + `TramoQuinta` (quinta-categoria.calculator).
- Produces: `calcularLiquidacion(input: LiquidacionCeseInput): LiquidacionCeseResult` con `LineaLiquidacion = { concepto: string; baseLegal: string; monto: number }` — consumido por `TerminationService` (Task 8). **OJO:** el nombre exportado `calcularLiquidacion` se mantiene, pero la firma cambia; el único consumidor anterior era su propio spec.

- [ ] **Step 1: Reescribir el spec completo**

```typescript
// apps/api/src/modules/payroll/calculators/liquidacion.calculator.spec.ts
import { calcularLiquidacion, LiquidacionCeseInput } from './liquidacion.calculator';

/** Input base: renuncia, régimen general, sin vacaciones pendientes ni deudas. */
function inputBase(overrides: Partial<LiquidacionCeseInput> = {}): LiquidacionCeseInput {
  return {
    motivo: 'RENUNCIA',
    regimen: 'general',
    fechaCese: new Date('2026-07-15'),
    remuneracionComputable: 3000,
    factorRegimenCtsGrati: 1,
    cts: {
      gratificacionSemestralPercibida: 3000,
      mesesCompletosDesdeUltimoDeposito: 2,
      diasAdicionales: 15,
    },
    gratificacionTrunca: {
      mesesCompletos: 1,
      afiliadoEps: false,
      tasaBonifEssalud: 0.09,
      tasaBonifEps: 0.0675,
    },
    vacaciones: { periodos: [], excluidoIndemnizacion: false },
    remuneracionesPendientes: [],
    gratificacionExtraordinaria: 0,
    indemnizacionDespido: null,
    deducciones: {
      pension: {
        sistema: 'onp',
        tasaOnp: 0.13,
        aportacionObligatoriaAfp: 0.1,
        comisionAfp: 0.016,
        tipoComision: 'flujo',
        primaSeguroAfp: 0.0174,
        topeRemuneracionMaximaAsegurable: 16950,
      },
      quinta: {
        uit: 5350,
        deduccionUit: 7,
        tramos: [
          { hasta: 5 * 5350, tasa: 0.08 },
          { hasta: 20 * 5350, tasa: 0.14 },
          { hasta: 35 * 5350, tasa: 0.17 },
          { hasta: 45 * 5350, tasa: 0.2 },
          { hasta: Infinity, tasa: 0.3 },
        ],
        rentaPagadaEnElAnio: 0,
        retencionesYaEfectuadas: 0,
      },
    },
    ...overrides,
  };
}

describe('calcularLiquidacion (motor de cese)', () => {
  it('renuncia general: CTS trunca + grati trunca con bonificación extraordinaria', () => {
    const r = calcularLiquidacion(inputBase());
    // CTS: computable 3000 + 3000/6 = 3500; fracción 2/6 + 15/180 → 3500×0.41667 = 1458.33
    const cts = r.ingresos.find((l) => l.concepto === 'CTS trunca')!;
    expect(cts.monto).toBeCloseTo(1458.33, 2);
    // Grati trunca: 3000 × 1/6 = 500; bonificación 9% = 45
    const grati = r.ingresos.find((l) => l.concepto === 'Gratificación trunca')!;
    expect(grati.monto).toBe(500);
    const bonif = r.ingresos.find((l) => l.concepto === 'Bonificación extraordinaria (Ley 30334)')!;
    expect(bonif.monto).toBe(45);
    expect(r.totalBruto).toBeCloseTo(1458.33 + 500 + 45, 1);
  });

  it('MYPE micro: CTS y gratificación en 0 (factor 0), vacaciones sí se pagan', () => {
    const r = calcularLiquidacion(
      inputBase({
        regimen: 'mype_micro',
        factorRegimenCtsGrati: 0,
        vacaciones: {
          periodos: [
            {
              periodoInicio: new Date('2026-01-15'),
              periodoFin: new Date('2027-01-14'),
              diasGanados: 15,
              diasGozados: 0,
              estado: 'EN_CURSO',
            },
          ],
          excluidoIndemnizacion: false,
        },
      }),
    );
    expect(r.ingresos.find((l) => l.concepto === 'CTS trunca')).toBeUndefined();
    expect(r.ingresos.find((l) => l.concepto === 'Gratificación trunca')).toBeUndefined();
    expect(r.ingresos.find((l) => l.concepto === 'Vacaciones truncas')!.monto).toBeCloseTo(750, 2);
  });

  it('MYPE pequeña: CTS y grati al 50%', () => {
    const r = calcularLiquidacion(inputBase({ regimen: 'mype_pequena', factorRegimenCtsGrati: 0.5 }));
    expect(r.ingresos.find((l) => l.concepto === 'CTS trunca')!.monto).toBeCloseTo(729.17, 2);
    expect(r.ingresos.find((l) => l.concepto === 'Gratificación trunca')!.monto).toBe(250);
  });

  it('despido arbitrario: agrega la indemnización (inafecta a deducciones)', () => {
    const r = calcularLiquidacion(
      inputBase({
        motivo: 'DESPIDO_ARBITRARIO',
        indemnizacionDespido: {
          tipoContrato: 'indeterminado',
          aniosCompletos: 2,
          mesesAdicionales: 0,
          diasAdicionales: 0,
          mesesRestantesContrato: 0,
          topeRemuneraciones: 12,
          mypeParams: {
            mype_pequena: { diasPorAnio: 20, topeDias: 120 },
            mype_micro: { diasPorAnio: 10, topeDias: 90 },
          },
        },
      }),
    );
    // 1.5 × 3000 × 2 = 9000
    expect(r.ingresos.find((l) => l.concepto === 'Indemnización por despido arbitrario')!.monto).toBe(9000);
    // ONP se calcula solo sobre afectos (aquí: 0 — no hay vacaciones ni pendientes)
    expect(r.deducciones.find((l) => l.concepto.startsWith('Retención ONP'))).toBeUndefined();
  });

  it('mutuo disenso: incluye la gratificación extraordinaria negociada, inafecta', () => {
    const r = calcularLiquidacion(
      inputBase({ motivo: 'MUTUO_DISENSO', gratificacionExtraordinaria: 5000 }),
    );
    expect(
      r.ingresos.find((l) => l.concepto === 'Gratificación extraordinaria por cese')!.monto,
    ).toBe(5000);
  });

  it('matriz de afectación: ONP solo sobre vacaciones + pendientes; 5ta también sobre grati', () => {
    const r = calcularLiquidacion(
      inputBase({
        vacaciones: {
          periodos: [
            {
              periodoInicio: new Date('2025-07-15'),
              periodoFin: new Date('2026-07-14'),
              diasGanados: 30,
              diasGozados: 0,
              estado: 'VENCIDO_PENDIENTE',
            },
          ],
          excluidoIndemnizacion: false,
        },
        remuneracionesPendientes: [{ concepto: 'Sueldo julio (15 días)', monto: 1500 }],
      }),
    );
    // Afecto a pensión: devengadas 3000 + pendientes 1500 = 4500 → ONP 13% = 585
    expect(r.deducciones.find((l) => l.concepto === 'Retención ONP')!.monto).toBe(-585);
    // Afecto a 5ta: 3000 + 1500 + grati 500 + bonif 45 = 5045 < 7 UIT → sin retención
    expect(r.deducciones.find((l) => l.concepto === 'Retención 5ta categoría')).toBeUndefined();
    expect(r.netoPagar).toBeCloseTo(r.totalBruto - 585, 2);
  });

  it('5ta categoría: proyección anual con renta ya pagada, neta de retenciones efectuadas', () => {
    const r = calcularLiquidacion(
      inputBase({
        remuneracionesPendientes: [{ concepto: 'Sueldo julio', monto: 3000 }],
        deducciones: {
          ...inputBase().deducciones,
          quinta: {
            ...inputBase().deducciones.quinta,
            rentaPagadaEnElAnio: 60000,
            retencionesYaEfectuadas: 1500,
          },
        },
      }),
    );
    // Renta anual = 60000 + afectos5ta (3000 + grati 500 + bonif 45) = 63545; neta = 63545 − 37450 = 26095
    // Impuesto: 8% × 26095 = 2087.60; retención = 2087.60 − 1500 = 587.60
    expect(r.deducciones.find((l) => l.concepto === 'Retención 5ta categoría')!.monto).toBeCloseTo(
      -587.6,
      2,
    );
  });

  it('todos los montos redondeados a 2 decimales y el neto cuadra', () => {
    const r = calcularLiquidacion(inputBase());
    for (const linea of [...r.ingresos, ...r.deducciones]) {
      expect(linea.monto).toBeCloseTo(Math.round(linea.monto * 100) / 100, 10);
    }
    const bruto = r.ingresos.reduce((s, l) => s + l.monto, 0);
    const ded = r.deducciones.reduce((s, l) => s + l.monto, 0); // negativos
    expect(r.netoPagar).toBeCloseTo(bruto + ded, 2);
  });
});
```

- [ ] **Step 2: Verificar que falla**

Run: `pnpm --filter @rrhh/api test -- liquidacion.calculator`
Expected: FAIL — errores de tipos/firma (la implementación vieja no exporta `LiquidacionCeseInput`).

- [ ] **Step 3: Reescribir la implementación**

```typescript
// apps/api/src/modules/payroll/calculators/liquidacion.calculator.ts
import { calcularCtsTrunca } from './cts.calculator';
import { calcularGratificacion } from './gratificacion.calculator';
import {
  calcularVacacionesCese,
  PeriodoVacacionalInput,
} from './vacaciones.calculator';
import {
  calcularIndemnizacionDespido,
  IndemnizacionMypeParams,
  RegimenLaboral,
  TipoContratoIndemnizacion,
} from './indemnizacion-despido.calculator';
import { calcularRetencionPensionaria } from './afp-onp.calculator';
import { calcularRetencionQuinta, TramoQuinta } from './quinta-categoria.calculator';

/**
 * Motor de liquidación de beneficios sociales al cese (D.S. 001-97-TR: pago
 * dentro de 48h). Compone los calculadores puros según motivo y régimen y
 * aplica la matriz de afectación (spec §4.4):
 *   CTS e indemnizaciones → inafectas a todo.
 *   Gratificación trunca + bonificación → inafecta a pensión (Ley 30334), afecta a 5ta.
 *   Vacaciones y remuneraciones pendientes → afectas a pensión y 5ta.
 *   Gratificación extraordinaria por cese (mutuo disenso) → no remunerativa, inafecta.
 */
export type MotivoCese =
  | 'RENUNCIA'
  | 'TERMINO_CONTRATO'
  | 'MUTUO_DISENSO'
  | 'DESPIDO_ARBITRARIO'
  | 'FALLECIMIENTO';

export interface LineaLiquidacion {
  concepto: string;
  baseLegal: string;
  monto: number;
}

export interface RemuneracionPendiente {
  concepto: string;
  monto: number;
}

export interface IndemnizacionDespidoParams {
  tipoContrato: TipoContratoIndemnizacion;
  aniosCompletos: number;
  mesesAdicionales: number;
  diasAdicionales: number;
  mesesRestantesContrato: number;
  topeRemuneraciones: number;
  mypeParams: { mype_pequena: IndemnizacionMypeParams; mype_micro: IndemnizacionMypeParams };
}

export interface LiquidacionCeseInput {
  motivo: MotivoCese;
  regimen: RegimenLaboral;
  fechaCese: Date;
  remuneracionComputable: number;
  /** 1 (general/agrario), 0.5 (mype_pequena), 0 (mype_micro) — parámetro normativo. */
  factorRegimenCtsGrati: number;
  cts: {
    gratificacionSemestralPercibida: number;
    mesesCompletosDesdeUltimoDeposito: number;
    diasAdicionales: number;
  };
  gratificacionTrunca: {
    mesesCompletos: number;
    afiliadoEps: boolean;
    tasaBonifEssalud: number;
    tasaBonifEps: number;
  };
  vacaciones: { periodos: PeriodoVacacionalInput[]; excluidoIndemnizacion: boolean };
  remuneracionesPendientes: RemuneracionPendiente[];
  gratificacionExtraordinaria: number;
  indemnizacionDespido: IndemnizacionDespidoParams | null;
  deducciones: {
    pension: {
      sistema: 'afp' | 'onp';
      tasaOnp: number;
      aportacionObligatoriaAfp: number;
      comisionAfp: number;
      tipoComision: 'flujo' | 'mixta';
      primaSeguroAfp: number;
      topeRemuneracionMaximaAsegurable: number;
    };
    quinta: {
      uit: number;
      deduccionUit: number;
      tramos: TramoQuinta[];
      /** Remuneración afecta a 5ta ya percibida en el ejercicio. */
      rentaPagadaEnElAnio: number;
      /** Retenciones de 5ta ya efectuadas en el ejercicio. */
      retencionesYaEfectuadas: number;
    };
  };
}

export interface LiquidacionCeseResult {
  ingresos: LineaLiquidacion[];
  deducciones: LineaLiquidacion[];
  totalBruto: number;
  totalDeducciones: number;
  netoPagar: number;
}

function redondear(monto: number): number {
  return Math.round(monto * 100) / 100;
}

export function calcularLiquidacion(input: LiquidacionCeseInput): LiquidacionCeseResult {
  const ingresos: LineaLiquidacion[] = [];
  let afectoPension = 0;
  let afectoQuinta = 0;

  // 1. CTS trunca (inafecta) — factor de régimen MYPE.
  if (input.factorRegimenCtsGrati > 0) {
    const cts = calcularCtsTrunca({
      sueldo: input.remuneracionComputable,
      gratificacionSemestral: input.cts.gratificacionSemestralPercibida,
      mesesCompletosDesdeUltimoDeposito: input.cts.mesesCompletosDesdeUltimoDeposito,
      diasAdicionales: input.cts.diasAdicionales,
    });
    const monto = redondear(cts.montoDeposito * input.factorRegimenCtsGrati);
    if (monto > 0) {
      ingresos.push({ concepto: 'CTS trunca', baseLegal: 'D.S. 001-97-TR', monto });
    }
  }

  // 2. Gratificación trunca + bonificación extraordinaria (inafectas a pensión
  //    por Ley 30334; afectas a 5ta) — factor de régimen MYPE.
  if (input.factorRegimenCtsGrati > 0 && input.gratificacionTrunca.mesesCompletos > 0) {
    const grati = calcularGratificacion({
      sueldo: input.remuneracionComputable,
      asignacionFamiliar: 0, // ya incluida en remuneracionComputable
      conceptosRemunerativosRegulares: 0,
      mesesCompletos: input.gratificacionTrunca.mesesCompletos,
      afiliadoEps: input.gratificacionTrunca.afiliadoEps,
      tasaBonifEssalud: input.gratificacionTrunca.tasaBonifEssalud,
      tasaBonifEps: input.gratificacionTrunca.tasaBonifEps,
    });
    const montoGrati = redondear(grati.montoGratificacion * input.factorRegimenCtsGrati);
    const montoBonif = redondear(grati.bonificacionExtraordinaria * input.factorRegimenCtsGrati);
    if (montoGrati > 0) {
      ingresos.push({ concepto: 'Gratificación trunca', baseLegal: 'Ley 27735 / Ley 30334', monto: montoGrati });
      afectoQuinta += montoGrati;
    }
    if (montoBonif > 0) {
      ingresos.push({
        concepto: 'Bonificación extraordinaria (Ley 30334)',
        baseLegal: 'Ley 30334',
        monto: montoBonif,
      });
      afectoQuinta += montoBonif;
    }
  }

  // 3. Vacaciones (afectas a pensión y 5ta) + indemnización vacacional (inafecta).
  const vac = calcularVacacionesCese({
    remuneracionComputable: input.remuneracionComputable,
    fechaCese: input.fechaCese,
    periodos: input.vacaciones.periodos,
    excluidoIndemnizacion: input.vacaciones.excluidoIndemnizacion,
  });
  if (vac.vacacionesDevengadas > 0) {
    ingresos.push({ concepto: 'Vacaciones devengadas', baseLegal: 'D.Leg. 713', monto: vac.vacacionesDevengadas });
    afectoPension += vac.vacacionesDevengadas;
    afectoQuinta += vac.vacacionesDevengadas;
  }
  if (vac.vacacionesTruncas > 0) {
    ingresos.push({ concepto: 'Vacaciones truncas', baseLegal: 'D.Leg. 713 art. 22', monto: vac.vacacionesTruncas });
    afectoPension += vac.vacacionesTruncas;
    afectoQuinta += vac.vacacionesTruncas;
  }
  if (vac.indemnizacionVacacional > 0) {
    ingresos.push({
      concepto: 'Indemnización vacacional',
      baseLegal: 'D.Leg. 713 art. 23',
      monto: vac.indemnizacionVacacional,
    });
  }

  // 4. Remuneraciones pendientes (afectas a todo).
  for (const pendiente of input.remuneracionesPendientes) {
    const monto = redondear(pendiente.monto);
    if (monto <= 0) continue;
    ingresos.push({ concepto: pendiente.concepto, baseLegal: 'Remuneración devengada', monto });
    afectoPension += monto;
    afectoQuinta += monto;
  }

  // 5. Gratificación extraordinaria por cese (mutuo disenso — inafecta).
  if (input.motivo === 'MUTUO_DISENSO' && input.gratificacionExtraordinaria > 0) {
    ingresos.push({
      concepto: 'Gratificación extraordinaria por cese',
      baseLegal: 'Acuerdo de mutuo disenso (concepto no remunerativo)',
      monto: redondear(input.gratificacionExtraordinaria),
    });
  }

  // 6. Indemnización por despido arbitrario (inafecta).
  if (input.motivo === 'DESPIDO_ARBITRARIO' && input.indemnizacionDespido) {
    const ind = calcularIndemnizacionDespido({
      regimen: input.regimen,
      remuneracionMensual: input.remuneracionComputable,
      ...input.indemnizacionDespido,
    });
    if (ind.monto > 0) {
      ingresos.push({
        concepto: 'Indemnización por despido arbitrario',
        baseLegal: 'D.S. 003-97-TR arts. 34/38/76',
        monto: ind.monto,
      });
    }
  }

  // Deducciones.
  const deducciones: LineaLiquidacion[] = [];

  if (afectoPension > 0) {
    const pension = calcularRetencionPensionaria({
      ...input.deducciones.pension,
      remuneracion: afectoPension,
    });
    const monto = redondear(pension.montoRetenido);
    if (monto > 0) {
      deducciones.push({
        concepto: `Retención ${input.deducciones.pension.sistema === 'afp' ? 'AFP' : 'ONP'}`,
        baseLegal: input.deducciones.pension.sistema === 'afp' ? 'D.S. 054-97-EF' : 'D.L. 19990',
        monto: -monto,
      });
    }
  }

  if (afectoQuinta > 0) {
    const quinta = calcularRetencionQuinta({
      remuneracionProyectadaRestante: afectoQuinta,
      conceptosYaPagadosEnElAnio: input.deducciones.quinta.rentaPagadaEnElAnio,
      ingresosOtrasEntidadesDeclarados: 0,
      deduccionUit: input.deducciones.quinta.deduccionUit,
      uit: input.deducciones.quinta.uit,
      tramos: input.deducciones.quinta.tramos,
      mesesRestantes: 1, // al cese la retención es única, no mensualizada
    });
    const retencion = redondear(
      Math.max(0, quinta.impuestoAnualProyectado - input.deducciones.quinta.retencionesYaEfectuadas),
    );
    if (retencion > 0) {
      deducciones.push({
        concepto: 'Retención 5ta categoría',
        baseLegal: 'TUO Ley Impuesto a la Renta, D.S. 179-2004-EF',
        monto: -retencion,
      });
    }
  }

  const totalBruto = redondear(ingresos.reduce((s, l) => s + l.monto, 0));
  const totalDeducciones = redondear(deducciones.reduce((s, l) => s - l.monto, 0));

  return {
    ingresos,
    deducciones,
    totalBruto,
    totalDeducciones,
    netoPagar: redondear(totalBruto - totalDeducciones),
  };
}
```

- [ ] **Step 4: Verificar que pasa (y que nada más se rompió)**

Run: `pnpm --filter @rrhh/api test -- liquidacion.calculator`
Expected: PASS (8 tests)
Run: `pnpm --filter @rrhh/api test`
Expected: todo verde (el stub anterior solo era consumido por su propio spec — verificado en la exploración; `payroll-run.service.ts` no lo importa).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/payroll/calculators/liquidacion.calculator.ts apps/api/src/modules/payroll/calculators/liquidacion.calculator.spec.ts
git commit -m "feat(cese): motor de liquidación con matriz de afectación, regímenes MYPE y deducciones"
```

---

### Task 6: Módulo `vacations` (service + controller + module)

**Files:**
- Create: `apps/api/src/modules/vacations/vacations.service.ts`
- Create: `apps/api/src/modules/vacations/vacations.controller.ts`
- Create: `apps/api/src/modules/vacations/vacations.module.ts`
- Modify: `apps/api/src/app.module.ts`
- Test: `apps/api/src/modules/vacations/vacations.service.spec.ts`

**Interfaces:**
- Consumes: `NormativeParameterService.resolve(client, codigo, fecha)` (módulo `normative-params`), modelos Prisma `vacacionPeriodo`, `employee`, `contrato`.
- Produces: `VacationsService.listarPorEmpleado(tx, employeeId)`, `crearPeriodo(tx, input: CrearPeriodoInput)`, `actualizarPeriodo(tx, id, cambios: ActualizarPeriodoInput)` — consumidos por `TerminationService` (Task 7, pre-llenado) vía consulta directa a `tx.vacacionPeriodo` y por el frontend (Task 11).

- [ ] **Step 1: Escribir los tests que fallan**

```typescript
// apps/api/src/modules/vacations/vacations.service.spec.ts
import { BadRequestException } from '@nestjs/common';
import { VacationsService } from './vacations.service';

function mockTx(overrides: any = {}) {
  return {
    employee: { findUnique: jest.fn().mockResolvedValue({ id: 'emp-1', tenantId: 't-1' }) },
    contrato: {
      findFirst: jest.fn().mockResolvedValue({
        regimenLaboral: 'general',
        fechaInicio: new Date('2025-03-01'),
      }),
    },
    vacacionPeriodo: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue(null),
      findUnique: jest.fn(),
      create: jest.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 'vp-1', ...data })),
      update: jest.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 'vp-1', ...data })),
    },
    ...overrides,
  };
}

const normativeParams = {
  resolve: jest.fn((client: any, codigo: string) => {
    const valores: Record<string, unknown> = { VACACIONES_DIAS_GENERAL: 30, VACACIONES_DIAS_MYPE: 15 };
    return Promise.resolve(valores[codigo]);
  }),
} as any;

describe('VacationsService', () => {
  let service: VacationsService;
  beforeEach(() => {
    service = new VacationsService(normativeParams);
    jest.clearAllMocks();
  });

  it('crearPeriodo: periodoFin = inicio + 1 año − 1 día; diasGanados según régimen (general=30)', async () => {
    const tx = mockTx();
    const r = await service.crearPeriodo(tx, {
      tenantId: 't-1',
      employeeId: 'emp-1',
      periodoInicio: new Date('2026-03-01'),
    });
    expect(tx.vacacionPeriodo.create).toHaveBeenCalled();
    expect(r.diasGanados).toBe(30);
    expect(new Date(r.periodoFin).toISOString().slice(0, 10)).toBe('2027-02-28');
  });

  it('crearPeriodo: MYPE genera 15 días', async () => {
    const tx = mockTx({
      contrato: {
        findFirst: jest.fn().mockResolvedValue({
          regimenLaboral: 'mype_pequena',
          fechaInicio: new Date('2025-03-01'),
        }),
      },
    });
    const r = await service.crearPeriodo(tx, {
      tenantId: 't-1',
      employeeId: 'emp-1',
      periodoInicio: new Date('2026-03-01'),
    });
    expect(r.diasGanados).toBe(15);
  });

  it('actualizarPeriodo: rechaza diasGozados > diasGanados', async () => {
    const tx = mockTx();
    tx.vacacionPeriodo.findUnique.mockResolvedValue({ id: 'vp-1', diasGanados: 30, estado: 'EN_CURSO' });
    await expect(
      service.actualizarPeriodo(tx, 'vp-1', { diasGozados: 31 }),
    ).rejects.toThrow(BadRequestException);
  });

  it('actualizarPeriodo: gozar todos los días marca el período GOZADO', async () => {
    const tx = mockTx();
    tx.vacacionPeriodo.findUnique.mockResolvedValue({ id: 'vp-1', diasGanados: 30, estado: 'VENCIDO_PENDIENTE' });
    await service.actualizarPeriodo(tx, 'vp-1', { diasGozados: 30 });
    expect(tx.vacacionPeriodo.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ estado: 'GOZADO' }) }),
    );
  });
});
```

- [ ] **Step 2: Verificar que falla**

Run: `pnpm --filter @rrhh/api test -- vacations.service`
Expected: FAIL — `Cannot find module './vacations.service'`

- [ ] **Step 3: Implementar el service**

```typescript
// apps/api/src/modules/vacations/vacations.service.ts
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { NormativeParameterService } from '../normative-params/normative-parameter.service';

export interface CrearPeriodoInput {
  tenantId: string;
  employeeId: string;
  periodoInicio: Date;
}

export interface ActualizarPeriodoInput {
  diasGozados?: number;
  estado?: 'EN_CURSO' | 'VENCIDO_PENDIENTE' | 'GOZADO' | 'LIQUIDADO';
  notas?: string;
}

/**
 * Récord vacacional (D.Leg. 713). Fuente de verdad de los períodos y días
 * gozados; el módulo de cese lo lee para pre-llenar la liquidación. Mismo
 * patrón que DocumentService: los métodos reciben el tx de Prisma.
 */
@Injectable()
export class VacationsService {
  constructor(private readonly normativeParams: NormativeParameterService) {}

  async listarPorEmpleado(tx: any, employeeId: string): Promise<any[]> {
    return tx.vacacionPeriodo.findMany({
      where: { employeeId },
      orderBy: { periodoInicio: 'asc' },
    });
  }

  async crearPeriodo(tx: any, input: CrearPeriodoInput): Promise<any> {
    const contrato = await tx.contrato.findFirst({
      where: { employeeId: input.employeeId },
      orderBy: { fechaInicio: 'desc' },
    });
    if (!contrato) {
      throw new BadRequestException('El empleado no tiene contrato registrado');
    }

    const esMype =
      contrato.regimenLaboral === 'mype_micro' || contrato.regimenLaboral === 'mype_pequena';
    const diasGanados = (await this.normativeParams.resolve(
      tx,
      esMype ? 'VACACIONES_DIAS_MYPE' : 'VACACIONES_DIAS_GENERAL',
      input.periodoInicio,
    )) as number;

    const periodoFin = new Date(input.periodoInicio);
    periodoFin.setUTCFullYear(periodoFin.getUTCFullYear() + 1);
    periodoFin.setUTCDate(periodoFin.getUTCDate() - 1);

    return tx.vacacionPeriodo.create({
      data: {
        tenantId: input.tenantId,
        employeeId: input.employeeId,
        periodoInicio: input.periodoInicio,
        periodoFin,
        diasGanados,
      },
    });
  }

  async actualizarPeriodo(tx: any, id: string, cambios: ActualizarPeriodoInput): Promise<any> {
    const periodo = await tx.vacacionPeriodo.findUnique({ where: { id } });
    if (!periodo) throw new NotFoundException(`Período vacacional ${id} no encontrado`);
    if (periodo.estado === 'LIQUIDADO') {
      throw new BadRequestException('Un período LIQUIDADO no puede modificarse');
    }

    const data: Record<string, unknown> = {};
    if (cambios.notas !== undefined) data.notas = cambios.notas;
    if (cambios.estado !== undefined) data.estado = cambios.estado;
    if (cambios.diasGozados !== undefined) {
      if (cambios.diasGozados < 0 || cambios.diasGozados > periodo.diasGanados) {
        throw new BadRequestException(
          `diasGozados debe estar entre 0 y ${periodo.diasGanados}`,
        );
      }
      data.diasGozados = cambios.diasGozados;
      if (cambios.estado === undefined && cambios.diasGozados >= periodo.diasGanados) {
        data.estado = 'GOZADO';
      }
    }

    return tx.vacacionPeriodo.update({ where: { id }, data });
  }
}
```

- [ ] **Step 4: Verificar que pasa**

Run: `pnpm --filter @rrhh/api test -- vacations.service`
Expected: PASS (4 tests)

- [ ] **Step 5: Controller y module**

```typescript
// apps/api/src/modules/vacations/vacations.controller.ts
import { BadRequestException, Body, Controller, Get, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { getTenantContext } from '../../common/database/tenant-request-context';
import { VacationsService } from './vacations.service';

export class CrearPeriodoDto {
  employeeId!: string;
  /** ISO YYYY-MM-DD (aniversario de ingreso). */
  periodoInicio!: string;
}

export class ActualizarPeriodoDto {
  diasGozados?: number;
  estado?: 'EN_CURSO' | 'VENCIDO_PENDIENTE' | 'GOZADO' | 'LIQUIDADO';
  notas?: string;
}

@Controller('vacaciones')
@UseGuards(PermissionsGuard)
export class VacationsController {
  constructor(private readonly vacations: VacationsService) {}

  @Get('periodos')
  @RequirePermission('vacation.read')
  async listar(@Query('employeeId') employeeId: string) {
    if (!employeeId) throw new BadRequestException('employeeId es obligatorio');
    const ctx = getTenantContext();
    return this.vacations.listarPorEmpleado(ctx.tx, employeeId);
  }

  @Post('periodos')
  @RequirePermission('vacation.manage')
  async crear(@Body() dto: CrearPeriodoDto) {
    if (!dto?.employeeId || !dto?.periodoInicio) {
      throw new BadRequestException('employeeId y periodoInicio son obligatorios');
    }
    const fecha = new Date(dto.periodoInicio);
    if (Number.isNaN(fecha.getTime())) {
      throw new BadRequestException(`periodoInicio inválido: "${dto.periodoInicio}"`);
    }
    const ctx = getTenantContext();
    if (!ctx.tenantId) throw new BadRequestException('Request sin tenant resuelto');
    return this.vacations.crearPeriodo(ctx.tx, {
      tenantId: ctx.tenantId,
      employeeId: dto.employeeId,
      periodoInicio: fecha,
    });
  }

  @Put('periodos/:id')
  @RequirePermission('vacation.manage')
  async actualizar(@Param('id') id: string, @Body() dto: ActualizarPeriodoDto) {
    const ctx = getTenantContext();
    return this.vacations.actualizarPeriodo(ctx.tx, id, dto ?? {});
  }
}
```

```typescript
// apps/api/src/modules/vacations/vacations.module.ts
import { Module } from '@nestjs/common';
import { VacationsController } from './vacations.controller';
import { VacationsService } from './vacations.service';
import { NormativeParamsModule } from '../normative-params/normative-params.module';

@Module({
  imports: [NormativeParamsModule],
  controllers: [VacationsController],
  providers: [VacationsService],
  exports: [VacationsService],
})
export class VacationsModule {}
```

En `apps/api/src/app.module.ts`: importar `VacationsModule` y agregarlo al array `imports` (después de `AtsModule`).

- [ ] **Step 6: Verificar compilación y suite completa**

Run: `pnpm --filter @rrhh/api test`
Expected: todo verde.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/vacations/ apps/api/src/app.module.ts
git commit -m "feat(cese): módulo de récord vacacional (VacacionPeriodo) con CRUD y validaciones"
```

---

### Task 7: `TerminationService` — crear cese con pre-llenado + corregir datos

**Files:**
- Create: `apps/api/src/modules/termination/termination.service.ts`
- Test: `apps/api/src/modules/termination/termination.service.spec.ts`

**Interfaces:**
- Consumes: modelos Prisma `cese`, `employee`, `contrato`, `regimenPensionario`, `vacacionPeriodo`, `planillaNovedad`, `horasExtra`, `planillaDetalle`.
- Produces (usados por Tasks 8-10 y el controller):
  - `interface CeseSnapshot` (forma del `inputSnapshot` JSON — ver Step 3)
  - `crearCese(tx, input: CrearCeseInput): Promise<any>`
  - `actualizarDatos(tx, ceseId: string, snapshot: Partial<CeseSnapshot>): Promise<any>`
  - helper exportado `calcularFechaLimitePago(fechaCese: Date): Date` (+2 días calendario)

- [ ] **Step 1: Escribir los tests que fallan**

```typescript
// apps/api/src/modules/termination/termination.service.spec.ts
import { BadRequestException, ConflictException } from '@nestjs/common';
import { TerminationService, calcularFechaLimitePago } from './termination.service';

const CONTRATO = {
  id: 'c-1',
  regimenLaboral: 'general',
  tipoContrato: 'indeterminado',
  fechaInicio: new Date('2024-01-01'),
  fechaFin: null,
  jornada: { horasDia: 8 },
  remuneracionBasica: { toNumber: () => 3000 },
};

function mockTx(overrides: any = {}) {
  return {
    employee: {
      findUnique: jest.fn().mockResolvedValue({ id: 'emp-1', tenantId: 't-1', estado: 'activo' }),
      update: jest.fn(),
    },
    contrato: { findFirst: jest.fn().mockResolvedValue(CONTRATO) },
    regimenPensionario: {
      findFirst: jest.fn().mockResolvedValue({ sistema: 'onp', tipoComision: null }),
    },
    vacacionPeriodo: { findMany: jest.fn().mockResolvedValue([]), updateMany: jest.fn() },
    planillaNovedad: { findMany: jest.fn().mockResolvedValue([]) },
    horasExtra: { findMany: jest.fn().mockResolvedValue([]) },
    planillaDetalle: { findMany: jest.fn().mockResolvedValue([]) },
    cese: {
      findFirst: jest.fn().mockResolvedValue(null),
      findUnique: jest.fn(),
      create: jest.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 'cese-1', ...data })),
      update: jest.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 'cese-1', ...data })),
    },
    ...overrides,
  };
}

const normativeParams = { resolve: jest.fn().mockResolvedValue(undefined) } as any;

describe('TerminationService — crear y corregir', () => {
  let service: TerminationService;
  beforeEach(() => {
    service = new TerminationService(normativeParams);
    jest.clearAllMocks();
  });

  it('calcularFechaLimitePago: fecha de cese + 2 días calendario (48h, D.S. 001-97-TR)', () => {
    expect(calcularFechaLimitePago(new Date('2026-07-15')).toISOString().slice(0, 10)).toBe('2026-07-17');
  });

  it('crearCese: pre-llena el snapshot desde contrato y régimen pensionario', async () => {
    const tx = mockTx();
    const cese = await service.crearCese(tx, {
      tenantId: 't-1',
      employeeId: 'emp-1',
      fechaCese: new Date('2026-07-15'),
      motivo: 'RENUNCIA',
      creadoPor: 'user-1',
    });
    const snapshot = cese.inputSnapshot;
    expect(snapshot.regimen).toBe('general');
    expect(snapshot.remuneracionComputable).toBe(3000);
    expect(snapshot.sistemaPensionario).toBe('onp');
    // Cese 2026-07-15: último depósito CTS = mayo 2026 (cubre desde 1-may):
    // 2 meses completos (may, jun) + 14 días
    expect(snapshot.cts.mesesCompletosDesdeUltimoDeposito).toBe(2);
    expect(snapshot.cts.diasAdicionales).toBe(14);
    // Semestre grati jul-dic: 0 meses calendario completos al 15-jul
    expect(snapshot.gratificacionTrunca.mesesCompletos).toBe(0);
    // Pendiente: sueldo prorrateado 15/30 = 1500
    expect(snapshot.remuneracionesPendientes[0].monto).toBe(1500);
    expect(tx.cese.create).toHaveBeenCalled();
  });

  it('crearCese: rechaza empleado con cese vigente (409)', async () => {
    const tx = mockTx();
    tx.cese.findFirst.mockResolvedValue({ id: 'previo', estado: 'BORRADOR' });
    await expect(
      service.crearCese(tx, {
        tenantId: 't-1',
        employeeId: 'emp-1',
        fechaCese: new Date('2026-07-15'),
        motivo: 'RENUNCIA',
        creadoPor: 'user-1',
      }),
    ).rejects.toThrow(ConflictException);
  });

  it('crearCese: rechaza fechaCese anterior al inicio del contrato', async () => {
    const tx = mockTx();
    await expect(
      service.crearCese(tx, {
        tenantId: 't-1',
        employeeId: 'emp-1',
        fechaCese: new Date('2023-12-31'),
        motivo: 'RENUNCIA',
        creadoPor: 'user-1',
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('crearCese: TERMINO_CONTRATO exige contrato con fechaFin', async () => {
    const tx = mockTx();
    await expect(
      service.crearCese(tx, {
        tenantId: 't-1',
        employeeId: 'emp-1',
        fechaCese: new Date('2026-07-15'),
        motivo: 'TERMINO_CONTRATO',
        creadoPor: 'user-1',
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('actualizarDatos: mergea el snapshot y regresa el cese a BORRADOR', async () => {
    const tx = mockTx();
    tx.cese.findUnique.mockResolvedValue({
      id: 'cese-1',
      estado: 'CALCULADA',
      inputSnapshot: { regimen: 'general', remuneracionComputable: 3000 },
    });
    await service.actualizarDatos(tx, 'cese-1', { remuneracionComputable: 3200 });
    expect(tx.cese.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          estado: 'BORRADOR',
          inputSnapshot: expect.objectContaining({ remuneracionComputable: 3200 }),
        }),
      }),
    );
  });

  it('actualizarDatos: rechaza si el cese está APROBADA o posterior', async () => {
    const tx = mockTx();
    tx.cese.findUnique.mockResolvedValue({ id: 'cese-1', estado: 'APROBADA', inputSnapshot: {} });
    await expect(service.actualizarDatos(tx, 'cese-1', {})).rejects.toThrow(ConflictException);
  });
});
```

- [ ] **Step 2: Verificar que falla**

Run: `pnpm --filter @rrhh/api test -- termination.service`
Expected: FAIL — `Cannot find module './termination.service'`

- [ ] **Step 3: Implementar crear + actualizar**

```typescript
// apps/api/src/modules/termination/termination.service.ts
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { NormativeParameterService } from '../normative-params/normative-parameter.service';
import {
  calcularLiquidacion,
  MotivoCese,
} from '../payroll/calculators/liquidacion.calculator';
import { PeriodoVacacionalInput } from '../payroll/calculators/vacaciones.calculator';
import { RegimenLaboral } from '../payroll/calculators/indemnizacion-despido.calculator';

/**
 * Forma del inputSnapshot del Cese: TODOS los datos con los que se calcula la
 * liquidación, pre-llenados desde BD y corregibles por RRHH antes de calcular
 * (trazabilidad: la hoja de liquidación siempre puede reproducirse).
 */
export interface CeseSnapshot {
  regimen: RegimenLaboral;
  tipoContrato: 'indeterminado' | 'plazo_fijo';
  fechaInicioContrato: string; // ISO date
  fechaFinContrato: string | null;
  remuneracionComputable: number;
  sistemaPensionario: 'afp' | 'onp';
  afiliadoEps: boolean;
  excluidoIndemnizacionVacacional: boolean;
  cts: {
    gratificacionSemestralPercibida: number;
    mesesCompletosDesdeUltimoDeposito: number;
    diasAdicionales: number;
  };
  gratificacionTrunca: { mesesCompletos: number };
  vacaciones: PeriodoVacacionalInput[];
  remuneracionesPendientes: Array<{ concepto: string; monto: number }>;
  gratificacionExtraordinaria: number;
  derechohabientes: Array<{
    nombre: string;
    tipoDocumento: string;
    numeroDocumento: string;
    parentesco: string;
    porcentaje: number;
  }> | null;
  quinta: { rentaPagadaEnElAnio: number; retencionesYaEfectuadas: number };
}

export interface CrearCeseInput {
  tenantId: string;
  employeeId: string;
  fechaCese: Date;
  motivo: MotivoCese;
  creadoPor: string;
}

const DIAS_POR_MES = 30;

/** Plazo legal de pago: 48 horas desde el cese (D.S. 001-97-TR). */
export function calcularFechaLimitePago(fechaCese: Date): Date {
  const limite = new Date(fechaCese);
  limite.setUTCDate(limite.getUTCDate() + 2);
  return limite;
}

/** Meses calendario completos + días sueltos desde `desde` hasta `hasta` (30/360). */
function mesesYDias(desde: Date, hasta: Date): { meses: number; dias: number } {
  let meses =
    (hasta.getUTCFullYear() - desde.getUTCFullYear()) * 12 +
    (hasta.getUTCMonth() - desde.getUTCMonth());
  let dias = hasta.getUTCDate() - desde.getUTCDate();
  if (dias < 0) {
    meses -= 1;
    dias += DIAS_POR_MES;
  }
  return { meses: Math.max(0, meses), dias: Math.max(0, dias) };
}

/** Inicio del período CTS vigente a una fecha: 1-may (may-oct) o 1-nov (nov-abr). */
function inicioPeriodoCts(fecha: Date): Date {
  const mes = fecha.getUTCMonth(); // 0-based
  const anio = fecha.getUTCFullYear();
  if (mes >= 4 && mes <= 9) return new Date(Date.UTC(anio, 4, 1)); // may-oct
  if (mes >= 10) return new Date(Date.UTC(anio, 10, 1)); // nov-dic
  return new Date(Date.UTC(anio - 1, 10, 1)); // ene-abr → nov del año anterior
}

/** Inicio del semestre de gratificación: 1-ene (ene-jun) o 1-jul (jul-dic). */
function inicioSemestreGrati(fecha: Date): Date {
  const anio = fecha.getUTCFullYear();
  return fecha.getUTCMonth() < 6 ? new Date(Date.UTC(anio, 0, 1)) : new Date(Date.UTC(anio, 6, 1));
}

function redondear(monto: number): number {
  return Math.round(monto * 100) / 100;
}

@Injectable()
export class TerminationService {
  constructor(private readonly normativeParams: NormativeParameterService) {}

  async crearCese(tx: any, input: CrearCeseInput): Promise<any> {
    const empleado = await tx.employee.findUnique({ where: { id: input.employeeId } });
    if (!empleado) throw new NotFoundException(`Empleado ${input.employeeId} no encontrado`);

    const ceseVigente = await tx.cese.findFirst({
      where: { employeeId: input.employeeId, estado: { not: 'ANULADA' } },
    });
    if (ceseVigente || empleado.estado === 'cesado') {
      throw new ConflictException('El empleado ya tiene un cese vigente');
    }

    const contrato = await tx.contrato.findFirst({
      where: { employeeId: input.employeeId },
      orderBy: { fechaInicio: 'desc' },
    });
    if (!contrato) throw new BadRequestException('El empleado no tiene contrato registrado');
    if (input.fechaCese.getTime() < new Date(contrato.fechaInicio).getTime()) {
      throw new BadRequestException('La fecha de cese es anterior al inicio del contrato');
    }
    if (input.motivo === 'TERMINO_CONTRATO' && !contrato.fechaFin) {
      throw new BadRequestException(
        'TERMINO_CONTRATO requiere un contrato a plazo fijo (con fecha de fin)',
      );
    }

    const snapshot = await this.preLlenarSnapshot(tx, input, contrato);

    return tx.cese.create({
      data: {
        tenantId: input.tenantId,
        employeeId: input.employeeId,
        fechaCese: input.fechaCese,
        motivo: input.motivo,
        estado: 'BORRADOR',
        inputSnapshot: snapshot,
        fechaLimitePago: calcularFechaLimitePago(input.fechaCese),
        creadoPor: input.creadoPor,
      },
    });
  }

  async actualizarDatos(tx: any, ceseId: string, cambios: Partial<CeseSnapshot>): Promise<any> {
    const cese = await this.obtenerCese(tx, ceseId);
    if (cese.estado !== 'BORRADOR' && cese.estado !== 'CALCULADA') {
      throw new ConflictException(
        `Los datos solo se corrigen en BORRADOR o CALCULADA (estado actual: ${cese.estado})`,
      );
    }
    return tx.cese.update({
      where: { id: ceseId },
      data: {
        estado: 'BORRADOR', // toda corrección invalida el cálculo anterior
        inputSnapshot: { ...cese.inputSnapshot, ...cambios },
        componentes: null,
        totalBruto: null,
        totalDeducciones: null,
        netoPagar: null,
        ...(cambios.gratificacionExtraordinaria !== undefined
          ? { gratificacionExtraordinaria: cambios.gratificacionExtraordinaria }
          : {}),
        ...(cambios.derechohabientes !== undefined
          ? { derechohabientes: cambios.derechohabientes }
          : {}),
      },
    });
  }

  /** Pre-llenado del snapshot: mejores datos disponibles, todo corregible por RRHH. */
  private async preLlenarSnapshot(
    tx: any,
    input: CrearCeseInput,
    contrato: any,
  ): Promise<CeseSnapshot> {
    const remuneracion = contrato.remuneracionBasica.toNumber
      ? contrato.remuneracionBasica.toNumber()
      : Number(contrato.remuneracionBasica);

    const regimenPensionario = await tx.regimenPensionario.findFirst({
      where: { employeeId: input.employeeId },
    });

    // CTS: meses/días desde el inicio del período semestral vigente (may/nov),
    // sin exceder la fecha de ingreso si es posterior.
    const inicioCts = inicioPeriodoCts(input.fechaCese);
    const desdeCts =
      new Date(contrato.fechaInicio).getTime() > inicioCts.getTime()
        ? new Date(contrato.fechaInicio)
        : inicioCts;
    const cts = mesesYDias(desdeCts, input.fechaCese);

    // Gratificación trunca: meses calendario COMPLETOS del semestre en curso.
    const inicioGrati = inicioSemestreGrati(input.fechaCese);
    const desdeGrati =
      new Date(contrato.fechaInicio).getTime() > inicioGrati.getTime()
        ? new Date(contrato.fechaInicio)
        : inicioGrati;
    const grati = mesesYDias(desdeGrati, input.fechaCese);

    // Vacaciones: períodos con saldo del récord vacacional.
    const periodos = await tx.vacacionPeriodo.findMany({
      where: { employeeId: input.employeeId, estado: { in: ['EN_CURSO', 'VENCIDO_PENDIENTE'] } },
      orderBy: { periodoInicio: 'asc' },
    });

    // Pendientes: sueldo del mes en curso prorrateado + horas extra no incluidas
    // en nómina (DIARIAS al 25%, SEMANALES al 35% — simplificación corregible).
    const pendientes: Array<{ concepto: string; monto: number }> = [];
    const diaCese = input.fechaCese.getUTCDate();
    pendientes.push({
      concepto: `Sueldo ${input.fechaCese.toISOString().slice(0, 7)} (${diaCese} días)`,
      monto: redondear((remuneracion * Math.min(diaCese, DIAS_POR_MES)) / DIAS_POR_MES),
    });

    const horasDia = Number((contrato.jornada as any)?.horasDia ?? 8) || 8;
    const valorHora = remuneracion / DIAS_POR_MES / horasDia;
    const horasExtra = await tx.horasExtra.findMany({
      where: { employeeId: input.employeeId, incluidoEnNomina: false },
    });
    let montoHoras = 0;
    for (const he of horasExtra) {
      const recargo = he.tipo === 'SEMANALES' ? 1.35 : 1.25;
      montoHoras += Number(he.horasCalculadas) * valorHora * recargo;
    }
    if (montoHoras > 0) {
      pendientes.push({
        concepto: 'Horas extra pendientes de nómina',
        monto: redondear(montoHoras),
      });
    }

    // 5ta: renta pagada en el año desde las planillas procesadas del ejercicio.
    const anio = input.fechaCese.getUTCFullYear();
    const detalles = await tx.planillaDetalle.findMany({
      where: {
        employeeId: input.employeeId,
        planilla: { periodo: { startsWith: `${anio}-` }, estado: { in: ['procesado', 'cerrado'] } },
      },
      include: { planilla: true },
    });
    let rentaPagada = 0;
    let retenciones5ta = 0;
    for (const detalle of detalles) {
      for (const concepto of (detalle.conceptosCalculados as any[]) ?? []) {
        if (concepto.monto > 0) rentaPagada += concepto.monto;
        if (concepto.codigo === '0801') retenciones5ta += -concepto.monto;
      }
    }

    return {
      regimen: contrato.regimenLaboral,
      tipoContrato: contrato.fechaFin ? 'plazo_fijo' : 'indeterminado',
      fechaInicioContrato: new Date(contrato.fechaInicio).toISOString().slice(0, 10),
      fechaFinContrato: contrato.fechaFin
        ? new Date(contrato.fechaFin).toISOString().slice(0, 10)
        : null,
      remuneracionComputable: remuneracion,
      sistemaPensionario: regimenPensionario?.sistema === 'afp' ? 'afp' : 'onp',
      afiliadoEps: false,
      excluidoIndemnizacionVacacional: false,
      cts: {
        gratificacionSemestralPercibida: remuneracion, // aprox. 1 sueldo; corregible
        mesesCompletosDesdeUltimoDeposito: cts.meses,
        diasAdicionales: cts.dias,
      },
      gratificacionTrunca: { mesesCompletos: grati.meses },
      vacaciones: periodos.map((p: any) => ({
        periodoInicio: new Date(p.periodoInicio),
        periodoFin: new Date(p.periodoFin),
        diasGanados: p.diasGanados,
        diasGozados: Number(p.diasGozados),
        estado: p.estado,
      })),
      remuneracionesPendientes: pendientes,
      gratificacionExtraordinaria: 0,
      derechohabientes: null,
      quinta: {
        rentaPagadaEnElAnio: redondear(rentaPagada),
        retencionesYaEfectuadas: redondear(retenciones5ta),
      },
    };
  }

  protected async obtenerCese(tx: any, ceseId: string): Promise<any> {
    const cese = await tx.cese.findUnique({ where: { id: ceseId } });
    if (!cese) throw new NotFoundException(`Cese ${ceseId} no encontrado`);
    return cese;
  }
}
```

Nota: `calcularLiquidacion` se importa ya en esta tarea pero se usa recién en la Task 8 — si el linter se queja de import sin uso, agregar el import en la Task 8 en su lugar.

- [ ] **Step 4: Verificar que pasa**

Run: `pnpm --filter @rrhh/api test -- termination.service`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/termination/termination.service.ts apps/api/src/modules/termination/termination.service.spec.ts
git commit -m "feat(cese): TerminationService con pre-llenado del snapshot y corrección de datos"
```

---

### Task 8: `TerminationService.calcular` — snapshot + parámetros → motor

**Files:**
- Modify: `apps/api/src/modules/termination/termination.service.ts`
- Test: `apps/api/src/modules/termination/termination.service.spec.ts` (agregar describe)

**Interfaces:**
- Consumes: `calcularLiquidacion(input: LiquidacionCeseInput)` (Task 5), `NormativeParameterService.resolve`.
- Produces: `calcular(tx, ceseId: string): Promise<any>` — cese en estado CALCULADA con `componentes`, `totalBruto`, `totalDeducciones`, `netoPagar`.

- [ ] **Step 1: Agregar tests al spec existente**

```typescript
// agregar a termination.service.spec.ts
describe('TerminationService — calcular', () => {
  const paramsResolve = (client: any, codigo: string) => {
    const valores: Record<string, unknown> = {
      UIT: 5350,
      RMV: 1130,
      ONP_TASA: 0.13,
      AFP_APORTE_OBLIGATORIO: 0.1,
      GRATIFICACION_BONIF_EXTRAORD: { essalud: 0.09, eps: 0.0675 },
      QUINTA_DEDUCCION_UIT: 7,
      MYPE_FACTOR_CTS_GRATI: { mype_pequena: 0.5, mype_micro: 0 },
      INDEMNIZACION_TOPE_REMUNERACIONES: 12,
      INDEMNIZACION_MYPE: {
        mype_pequena: { diasPorAnio: 20, topeDias: 120 },
        mype_micro: { diasPorAnio: 10, topeDias: 90 },
      },
    };
    return Promise.resolve(valores[codigo]);
  };

  const SNAPSHOT = {
    regimen: 'general',
    tipoContrato: 'indeterminado',
    fechaInicioContrato: '2024-01-01',
    fechaFinContrato: null,
    remuneracionComputable: 3000,
    sistemaPensionario: 'onp',
    afiliadoEps: false,
    excluidoIndemnizacionVacacional: false,
    cts: { gratificacionSemestralPercibida: 3000, mesesCompletosDesdeUltimoDeposito: 2, diasAdicionales: 14 },
    gratificacionTrunca: { mesesCompletos: 0 },
    vacaciones: [],
    remuneracionesPendientes: [{ concepto: 'Sueldo julio (15 días)', monto: 1500 }],
    gratificacionExtraordinaria: 0,
    derechohabientes: null,
    quinta: { rentaPagadaEnElAnio: 0, retencionesYaEfectuadas: 0 },
  };

  it('calcula, persiste componentes/totales y transiciona a CALCULADA', async () => {
    const tx = mockTx();
    tx.cese.findUnique.mockResolvedValue({
      id: 'cese-1',
      estado: 'BORRADOR',
      motivo: 'RENUNCIA',
      fechaCese: new Date('2026-07-15'),
      inputSnapshot: SNAPSHOT,
    });
    const service = new TerminationService({ resolve: jest.fn(paramsResolve) } as any);
    await service.calcular(tx, 'cese-1');

    const update = tx.cese.update.mock.calls[0][0];
    expect(update.data.estado).toBe('CALCULADA');
    expect(update.data.totalBruto).toBeGreaterThan(0);
    // ONP sobre pendientes: 1500 × 0.13 = 195
    const onp = update.data.componentes.deducciones.find((l: any) => l.concepto === 'Retención ONP');
    expect(onp.monto).toBe(-195);
    expect(update.data.netoPagar).toBeCloseTo(update.data.totalBruto - 195, 2);
  });

  it('rechaza calcular un cese APROBADA', async () => {
    const tx = mockTx();
    tx.cese.findUnique.mockResolvedValue({ id: 'cese-1', estado: 'APROBADA', inputSnapshot: SNAPSHOT });
    const service = new TerminationService({ resolve: jest.fn(paramsResolve) } as any);
    await expect(service.calcular(tx, 'cese-1')).rejects.toThrow(ConflictException);
  });
});
```

- [ ] **Step 2: Verificar que falla**

Run: `pnpm --filter @rrhh/api test -- termination.service`
Expected: FAIL — `service.calcular is not a function`

- [ ] **Step 3: Implementar `calcular` en `TerminationService`**

```typescript
  async calcular(tx: any, ceseId: string): Promise<any> {
    const cese = await this.obtenerCese(tx, ceseId);
    if (cese.estado !== 'BORRADOR' && cese.estado !== 'CALCULADA') {
      throw new ConflictException(
        `Solo se calcula en BORRADOR o CALCULADA (estado actual: ${cese.estado})`,
      );
    }

    const snapshot: CeseSnapshot = cese.inputSnapshot;
    const fechaCese = new Date(cese.fechaCese);

    // Parámetros normativos vigentes a la fecha del cese.
    const resolve = (codigo: string) => this.normativeParams.resolve(tx, codigo, fechaCese);
    const uit = (await resolve('UIT')) as number;
    const rmv = (await resolve('RMV')) as number;
    const tasaOnp = ((await resolve('ONP_TASA')) as number) ?? 0.13;
    const tasaAfp = ((await resolve('AFP_APORTE_OBLIGATORIO')) as number) ?? 0.1;
    const bonif = ((await resolve('GRATIFICACION_BONIF_EXTRAORD')) as any) ?? {
      essalud: 0.09,
      eps: 0.0675,
    };
    const deduccionUit = ((await resolve('QUINTA_DEDUCCION_UIT')) as number) ?? 7;
    const factoresMype = ((await resolve('MYPE_FACTOR_CTS_GRATI')) as any) ?? {
      mype_pequena: 0.5,
      mype_micro: 0,
    };
    const topeIndemnizacion = ((await resolve('INDEMNIZACION_TOPE_REMUNERACIONES')) as number) ?? 12;
    const indemnizacionMype = ((await resolve('INDEMNIZACION_MYPE')) as any) ?? {
      mype_pequena: { diasPorAnio: 20, topeDias: 120 },
      mype_micro: { diasPorAnio: 10, topeDias: 90 },
    };

    const factorRegimen =
      snapshot.regimen === 'mype_micro'
        ? factoresMype.mype_micro
        : snapshot.regimen === 'mype_pequena'
          ? factoresMype.mype_pequena
          : 1;

    // Tiempo de servicios para la indemnización por despido.
    const inicioContrato = new Date(snapshot.fechaInicioContrato);
    const servicio = mesesYDias(inicioContrato, fechaCese);
    const mesesRestantesContrato = snapshot.fechaFinContrato
      ? Math.max(0, mesesYDias(fechaCese, new Date(snapshot.fechaFinContrato)).meses)
      : 0;

    const resultado = calcularLiquidacion({
      motivo: cese.motivo,
      regimen: snapshot.regimen,
      fechaCese,
      remuneracionComputable: snapshot.remuneracionComputable,
      factorRegimenCtsGrati: factorRegimen,
      cts: snapshot.cts,
      gratificacionTrunca: {
        mesesCompletos: snapshot.gratificacionTrunca.mesesCompletos,
        afiliadoEps: snapshot.afiliadoEps,
        tasaBonifEssalud: bonif.essalud,
        tasaBonifEps: bonif.eps,
      },
      vacaciones: {
        periodos: snapshot.vacaciones.map((p) => ({
          ...p,
          periodoInicio: new Date(p.periodoInicio),
          periodoFin: new Date(p.periodoFin),
        })),
        excluidoIndemnizacion: snapshot.excluidoIndemnizacionVacacional,
      },
      remuneracionesPendientes: snapshot.remuneracionesPendientes,
      gratificacionExtraordinaria: snapshot.gratificacionExtraordinaria,
      indemnizacionDespido:
        cese.motivo === 'DESPIDO_ARBITRARIO'
          ? {
              tipoContrato: snapshot.tipoContrato,
              aniosCompletos: Math.floor(servicio.meses / 12),
              mesesAdicionales: servicio.meses % 12,
              diasAdicionales: servicio.dias,
              mesesRestantesContrato,
              topeRemuneraciones: topeIndemnizacion,
              mypeParams: indemnizacionMype,
            }
          : null,
      deducciones: {
        pension: {
          sistema: snapshot.sistemaPensionario,
          tasaOnp,
          aportacionObligatoriaAfp: tasaAfp,
          comisionAfp: 0.016, // TODO parametrizar (deuda declarada en payroll-run)
          tipoComision: 'flujo',
          primaSeguroAfp: 0.0174, // TODO parametrizar
          topeRemuneracionMaximaAsegurable: 15 * rmv,
        },
        quinta: {
          uit,
          deduccionUit,
          tramos: [
            { hasta: 5 * uit, tasa: 0.08 },
            { hasta: 20 * uit, tasa: 0.14 },
            { hasta: 35 * uit, tasa: 0.17 },
            { hasta: 45 * uit, tasa: 0.2 },
            { hasta: Infinity, tasa: 0.3 },
          ],
          rentaPagadaEnElAnio: snapshot.quinta.rentaPagadaEnElAnio,
          retencionesYaEfectuadas: snapshot.quinta.retencionesYaEfectuadas,
        },
      },
    });

    return tx.cese.update({
      where: { id: ceseId },
      data: {
        estado: 'CALCULADA',
        componentes: { ingresos: resultado.ingresos, deducciones: resultado.deducciones },
        totalBruto: resultado.totalBruto,
        totalDeducciones: resultado.totalDeducciones,
        netoPagar: resultado.netoPagar,
      },
    });
  }
```

- [ ] **Step 4: Verificar que pasa**

Run: `pnpm --filter @rrhh/api test -- termination.service`
Expected: PASS (9 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/termination/
git commit -m "feat(cese): cálculo de la liquidación desde el snapshot con parámetros normativos vigentes"
```

---

### Task 9: `CeseDocumentsService` — 4 PDFs archivados en el legajo

**Files:**
- Create: `apps/api/src/modules/termination/cese-documents.service.ts`
- Test: `apps/api/src/modules/termination/cese-documents.service.spec.ts`
- Modify: `apps/api/package.json` (dependencia pdfkit)

**Interfaces:**
- Consumes: `DocumentService.uploadDocument(tx, input: UploadDocumentInput)` (módulo documents; `tipo` acepta los valores nuevos del enum — actualizar el type union `TipoDocumento` en `document.service.ts` y el array `TIPOS_DOCUMENTO` en `documents.controller.ts` con los 6 valores nuevos).
- Produces: `generarDocumentosCese(tx, cese: any, empleado: any, tenant: any, subidoPor: string): Promise<string[]>` (retorna los ids de documento creados) — consumido por `aprobar` (Task 10).

- [ ] **Step 1: Instalar pdfkit**

Run: `pnpm --filter @rrhh/api add pdfkit && pnpm --filter @rrhh/api add -D @types/pdfkit`
Expected: dependencias agregadas sin errores.

- [ ] **Step 2: Escribir los tests que fallan**

```typescript
// apps/api/src/modules/termination/cese-documents.service.spec.ts
import { CeseDocumentsService } from './cese-documents.service';

const documentService = {
  uploadDocument: jest.fn().mockResolvedValue({ documento: { id: 'doc-1' }, numeroVersion: 1 }),
} as any;

const CESE = {
  id: 'cese-1',
  fechaCese: new Date('2026-07-15'),
  motivo: 'RENUNCIA',
  componentes: {
    ingresos: [{ concepto: 'CTS trunca', baseLegal: 'D.S. 001-97-TR', monto: 1458.33 }],
    deducciones: [{ concepto: 'Retención ONP', baseLegal: 'D.L. 19990', monto: -195 }],
  },
  totalBruto: 1458.33,
  totalDeducciones: 195,
  netoPagar: 1263.33,
  inputSnapshot: {
    fechaInicioContrato: '2024-01-01',
    quinta: { rentaPagadaEnElAnio: 21000, retencionesYaEfectuadas: 0 },
  },
  derechohabientes: null,
};
const EMPLEADO = {
  id: 'emp-1',
  tenantId: 't-1',
  nombres: 'María',
  apellidos: 'Quispe',
  tipoDocumento: '01',
  numeroDocumento: '45678901',
};
const TENANT = { razonSocial: 'Demo SAC', ruc: '20123456789' };

describe('CeseDocumentsService', () => {
  let service: CeseDocumentsService;
  beforeEach(() => {
    service = new CeseDocumentsService(documentService);
    jest.clearAllMocks();
  });

  it('genera y archiva los 4 documentos con los tipos correctos', async () => {
    const ids = await service.generarDocumentosCese({}, CESE, EMPLEADO, TENANT, 'user-1');
    expect(ids).toHaveLength(4);
    const tipos = documentService.uploadDocument.mock.calls.map((c: any[]) => c[1].tipo);
    expect(tipos).toEqual(
      expect.arrayContaining([
        'LIQUIDACION',
        'CERTIFICADO_TRABAJO',
        'CONSTANCIA_CESE',
        'CERTIFICADO_RETENCION_5TA',
      ]),
    );
    // Todos los PDFs tienen contenido real
    for (const call of documentService.uploadDocument.mock.calls) {
      expect(call[1].contenido.length).toBeGreaterThan(500);
      expect(call[1].mimeType).toBe('application/pdf');
      expect(call[1].employeeId).toBe('emp-1');
    }
  });

  it('rechaza generar sin componentes calculados', async () => {
    await expect(
      service.generarDocumentosCese({}, { ...CESE, componentes: null }, EMPLEADO, TENANT, 'user-1'),
    ).rejects.toThrow('sin componentes calculados');
  });
});
```

- [ ] **Step 3: Verificar que falla**

Run: `pnpm --filter @rrhh/api test -- cese-documents`
Expected: FAIL — `Cannot find module './cese-documents.service'`

- [ ] **Step 4: Implementar**

```typescript
// apps/api/src/modules/termination/cese-documents.service.ts
import { BadRequestException, Injectable } from '@nestjs/common';
import PDFDocument from 'pdfkit';
import { DocumentService } from '../../modules/documents/document.service';

const MOTIVO_LABELS: Record<string, string> = {
  RENUNCIA: 'Renuncia voluntaria',
  TERMINO_CONTRATO: 'Término de contrato',
  MUTUO_DISENSO: 'Mutuo disenso',
  DESPIDO_ARBITRARIO: 'Despido arbitrario',
  FALLECIMIENTO: 'Fallecimiento',
};

/**
 * Genera los documentos obligatorios del cese como PDFs (pdfkit, sin
 * dependencias de red) y los archiva en el legajo vía DocumentService:
 * hoja de liquidación, certificado de trabajo, constancia de cese (retiro CTS)
 * y certificado de retención de 5ta. La carta de renuncia y el examen médico
 * de retiro (Ley 29783) se suben manualmente — fuera de este service.
 */
@Injectable()
export class CeseDocumentsService {
  constructor(private readonly documents: DocumentService) {}

  async generarDocumentosCese(
    tx: any,
    cese: any,
    empleado: any,
    tenant: any,
    subidoPor: string,
  ): Promise<string[]> {
    if (!cese.componentes) {
      throw new BadRequestException('El cese no tiene componentes calculados');
    }

    const docs: Array<{ tipo: string; nombre: string; contenido: Buffer }> = [
      {
        tipo: 'LIQUIDACION',
        nombre: `hoja-liquidacion-${cese.id}.pdf`,
        contenido: await this.pdfHojaLiquidacion(cese, empleado, tenant),
      },
      {
        tipo: 'CERTIFICADO_TRABAJO',
        nombre: `certificado-trabajo-${cese.id}.pdf`,
        contenido: await this.pdfCertificadoTrabajo(cese, empleado, tenant),
      },
      {
        tipo: 'CONSTANCIA_CESE',
        nombre: `constancia-cese-${cese.id}.pdf`,
        contenido: await this.pdfConstanciaCese(cese, empleado, tenant),
      },
      {
        tipo: 'CERTIFICADO_RETENCION_5TA',
        nombre: `certificado-retencion-5ta-${cese.id}.pdf`,
        contenido: await this.pdfCertificadoRetencion(cese, empleado, tenant),
      },
    ];

    const ids: string[] = [];
    for (const doc of docs) {
      const resultado = await this.documents.uploadDocument(tx, {
        tenantId: empleado.tenantId,
        employeeId: empleado.id,
        tipo: doc.tipo as any,
        nombreArchivo: doc.nombre,
        mimeType: 'application/pdf',
        contenido: doc.contenido,
        subidoPor,
      });
      ids.push(resultado.documento.id);
    }
    return ids;
  }

  /** Crea un PDF A4 con cabecera estándar y delega el cuerpo; retorna el buffer. */
  private crearPdf(titulo: string, tenant: any, cuerpo: (doc: any) => void): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ size: 'A4', margin: 50 });
      const chunks: Buffer[] = [];
      doc.on('data', (chunk: Buffer) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      doc.fontSize(10).text(`${tenant.razonSocial} — RUC ${tenant.ruc}`, { align: 'right' });
      doc.moveDown().fontSize(16).text(titulo, { align: 'center' }).moveDown();
      doc.fontSize(10);
      cuerpo(doc);
      doc.end();
    });
  }

  private datosEmpleado(doc: any, cese: any, empleado: any): void {
    doc.text(`Trabajador: ${empleado.apellidos}, ${empleado.nombres}`);
    doc.text(`Documento: ${empleado.numeroDocumento}`);
    doc.text(`Fecha de ingreso: ${cese.inputSnapshot.fechaInicioContrato}`);
    doc.text(`Fecha de cese: ${new Date(cese.fechaCese).toISOString().slice(0, 10)}`);
    doc.text(`Motivo: ${MOTIVO_LABELS[cese.motivo] ?? cese.motivo}`).moveDown();
  }

  private pdfHojaLiquidacion(cese: any, empleado: any, tenant: any): Promise<Buffer> {
    return this.crearPdf('LIQUIDACIÓN DE BENEFICIOS SOCIALES', tenant, (doc) => {
      this.datosEmpleado(doc, cese, empleado);
      doc.text('INGRESOS', { underline: true });
      for (const linea of cese.componentes.ingresos) {
        doc.text(`${linea.concepto} (${linea.baseLegal}): S/ ${linea.monto.toFixed(2)}`);
      }
      doc.moveDown().text('DEDUCCIONES', { underline: true });
      for (const linea of cese.componentes.deducciones) {
        doc.text(`${linea.concepto} (${linea.baseLegal}): S/ ${linea.monto.toFixed(2)}`);
      }
      doc.moveDown();
      doc.text(`Total bruto: S/ ${Number(cese.totalBruto).toFixed(2)}`);
      doc.text(`Total deducciones: S/ ${Number(cese.totalDeducciones).toFixed(2)}`);
      doc.fontSize(12).text(`NETO A PAGAR: S/ ${Number(cese.netoPagar).toFixed(2)}`);
      if (cese.derechohabientes?.length) {
        doc.moveDown().fontSize(10).text('Derechohabientes (Ley 29783 / art. 1 D.S. 001-97-TR):');
        for (const d of cese.derechohabientes) {
          doc.text(`- ${d.nombre} (${d.parentesco}, ${d.numeroDocumento}): ${d.porcentaje}%`);
        }
      }
      doc.moveDown(3).text('_______________________          _______________________');
      doc.text('        El empleador                         El trabajador');
    });
  }

  private pdfCertificadoTrabajo(cese: any, empleado: any, tenant: any): Promise<Buffer> {
    return this.crearPdf('CERTIFICADO DE TRABAJO', tenant, (doc) => {
      doc.text(
        `Por el presente, ${tenant.razonSocial} certifica que ${empleado.nombres} ${empleado.apellidos}, ` +
          `identificado(a) con documento N° ${empleado.numeroDocumento}, laboró en nuestra empresa ` +
          `desde el ${cese.inputSnapshot.fechaInicioContrato} hasta el ${new Date(cese.fechaCese)
            .toISOString()
            .slice(0, 10)}.`,
      );
      doc.moveDown().text('Se expide el presente a solicitud del interesado para los fines que estime conveniente.');
    });
  }

  private pdfConstanciaCese(cese: any, empleado: any, tenant: any): Promise<Buffer> {
    return this.crearPdf('CONSTANCIA DE CESE', tenant, (doc) => {
      this.datosEmpleado(doc, cese, empleado);
      doc.text(
        'Se deja constancia del cese del trabajador para efectos del retiro de la ' +
          'Compensación por Tiempo de Servicios (CTS) conforme al D.S. 001-97-TR.',
      );
    });
  }

  private pdfCertificadoRetencion(cese: any, empleado: any, tenant: any): Promise<Buffer> {
    return this.crearPdf('CERTIFICADO DE RETENCIONES — RENTA 5TA CATEGORÍA', tenant, (doc) => {
      this.datosEmpleado(doc, cese, empleado);
      const retencionLiquidacion = cese.componentes.deducciones.find((l: any) =>
        l.concepto.includes('5ta'),
      );
      doc.text(`Renta pagada en el ejercicio: S/ ${cese.inputSnapshot.quinta.rentaPagadaEnElAnio.toFixed(2)}`);
      doc.text(
        `Retenciones efectuadas en el ejercicio: S/ ${cese.inputSnapshot.quinta.retencionesYaEfectuadas.toFixed(2)}`,
      );
      doc.text(
        `Retención en la liquidación: S/ ${retencionLiquidacion ? Math.abs(retencionLiquidacion.monto).toFixed(2) : '0.00'}`,
      );
    });
  }
}
```

- [ ] **Step 5: Ampliar el type union en documents**

En `apps/api/src/modules/documents/document.service.ts` agregar al type `TipoDocumento`: `| 'LIQUIDACION' | 'CERTIFICADO_TRABAJO' | 'CONSTANCIA_CESE' | 'CERTIFICADO_RETENCION_5TA' | 'CARTA_RENUNCIA' | 'EXAMEN_MEDICO_RETIRO'`. En `documents.controller.ts`, agregar los mismos 6 strings al array `TIPOS_DOCUMENTO`.

- [ ] **Step 6: Verificar que pasa**

Run: `pnpm --filter @rrhh/api test -- cese-documents`
Expected: PASS (2 tests)
Run: `pnpm --filter @rrhh/api test`
Expected: todo verde.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/termination/cese-documents.service.ts apps/api/src/modules/termination/cese-documents.service.spec.ts apps/api/src/modules/documents/ apps/api/package.json pnpm-lock.yaml
git commit -m "feat(cese): generación de los 4 documentos PDF del cese archivados en el legajo"
```

---

### Task 10: Aprobar / pagar / anular + controller + module

**Files:**
- Modify: `apps/api/src/modules/termination/termination.service.ts`
- Create: `apps/api/src/modules/termination/termination.controller.ts`
- Create: `apps/api/src/modules/termination/termination.module.ts`
- Modify: `apps/api/src/app.module.ts`
- Test: `apps/api/src/modules/termination/termination.service.spec.ts` (agregar describe)

**Interfaces:**
- Consumes: `CeseDocumentsService.generarDocumentosCese` (Task 9).
- Produces: `aprobar(tx, ceseId, aprobadoPor)`, `pagar(tx, ceseId)`, `anular(tx, ceseId, motivo)`, `listar(tx)`, `detalle(tx, ceseId)`; endpoints `POST /ceses`, `GET /ceses`, `GET /ceses/:id`, `PUT /ceses/:id/datos`, `POST /ceses/:id/calcular`, `POST /ceses/:id/aprobar`, `POST /ceses/:id/pagar`, `POST /ceses/:id/anular` — consumidos por el frontend (Task 12).

- [ ] **Step 1: Agregar tests al spec**

```typescript
// agregar a termination.service.spec.ts (usa mockTx y CONTRATO ya definidos)
import { UnprocessableEntityException } from '@nestjs/common';

describe('TerminationService — aprobar/pagar/anular', () => {
  const ceseCalculada = (overrides: any = {}) => ({
    id: 'cese-1',
    tenantId: 't-1',
    employeeId: 'emp-1',
    estado: 'CALCULADA',
    motivo: 'RENUNCIA',
    fechaCese: new Date('2026-07-15'),
    fechaLimitePago: new Date('2026-07-17'),
    componentes: { ingresos: [], deducciones: [] },
    derechohabientes: null,
    inputSnapshot: {},
    ...overrides,
  });

  const documentos = { generarDocumentosCese: jest.fn().mockResolvedValue(['d1', 'd2', 'd3', 'd4']) } as any;

  function crearService() {
    return new TerminationService({ resolve: jest.fn() } as any, documentos);
  }

  it('aprobar: genera documentos, cesa al empleado y liquida los períodos vacacionales', async () => {
    const tx = mockTx();
    tx.cese.findUnique.mockResolvedValue(ceseCalculada());
    tx.tenant = { findUnique: jest.fn().mockResolvedValue({ razonSocial: 'Demo SAC', ruc: '20123456789' }) };
    const service = crearService();
    await service.aprobar(tx, 'cese-1', 'admin-1');

    expect(documentos.generarDocumentosCese).toHaveBeenCalled();
    expect(tx.employee.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { estado: 'cesado' } }),
    );
    expect(tx.vacacionPeriodo.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { estado: 'LIQUIDADO' } }),
    );
    expect(tx.cese.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ estado: 'APROBADA', aprobadoPor: 'admin-1' }) }),
    );
  });

  it('aprobar: FALLECIMIENTO sin derechohabientes → 422', async () => {
    const tx = mockTx();
    tx.cese.findUnique.mockResolvedValue(ceseCalculada({ motivo: 'FALLECIMIENTO' }));
    await expect(crearService().aprobar(tx, 'cese-1', 'admin-1')).rejects.toThrow(
      UnprocessableEntityException,
    );
  });

  it('aprobar: derechohabientes con porcentajes que no suman 100 → 422', async () => {
    const tx = mockTx();
    tx.cese.findUnique.mockResolvedValue(
      ceseCalculada({
        motivo: 'FALLECIMIENTO',
        derechohabientes: [{ nombre: 'X', tipoDocumento: '01', numeroDocumento: '1', parentesco: 'cónyuge', porcentaje: 60 }],
      }),
    );
    await expect(crearService().aprobar(tx, 'cese-1', 'admin-1')).rejects.toThrow(
      UnprocessableEntityException,
    );
  });

  it('aprobar: si la generación de PDFs falla, el estado NO avanza', async () => {
    const tx = mockTx();
    tx.cese.findUnique.mockResolvedValue(ceseCalculada());
    tx.tenant = { findUnique: jest.fn().mockResolvedValue({ razonSocial: 'Demo SAC', ruc: '20123456789' }) };
    documentos.generarDocumentosCese.mockRejectedValueOnce(new Error('MinIO caído'));
    await expect(crearService().aprobar(tx, 'cese-1', 'admin-1')).rejects.toThrow('MinIO caído');
    expect(tx.cese.update).not.toHaveBeenCalled();
  });

  it('pagar: fuera del plazo de 48h marca pagoFueraDePlazo', async () => {
    const tx = mockTx();
    tx.cese.findUnique.mockResolvedValue(ceseCalculada({ estado: 'APROBADA' }));
    const service = crearService();
    await service.pagar(tx, 'cese-1', new Date('2026-07-20T12:00:00Z'));
    expect(tx.cese.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ estado: 'PAGADA', pagoFueraDePlazo: true }),
      }),
    );
  });

  it('anular: desde APROBADA revierte empleado y vacaciones; desde PAGADA se rechaza', async () => {
    const tx = mockTx();
    tx.cese.findUnique.mockResolvedValue(ceseCalculada({ estado: 'APROBADA' }));
    await crearService().anular(tx, 'cese-1', 'error de datos');
    expect(tx.employee.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { estado: 'activo' } }),
    );

    tx.cese.findUnique.mockResolvedValue(ceseCalculada({ estado: 'PAGADA' }));
    await expect(crearService().anular(tx, 'cese-1', 'x')).rejects.toThrow(ConflictException);
  });
});
```

- [ ] **Step 2: Verificar que falla**

Run: `pnpm --filter @rrhh/api test -- termination.service`
Expected: FAIL — el constructor no acepta segundo argumento / `aprobar` no existe.

- [ ] **Step 3: Implementar en `TerminationService`**

Cambiar el constructor a:

```typescript
  constructor(
    private readonly normativeParams: NormativeParameterService,
    private readonly ceseDocuments?: CeseDocumentsService,
  ) {}
```

(import: `import { CeseDocumentsService } from './cese-documents.service';`) y agregar:

```typescript
  async listar(tx: any): Promise<any[]> {
    return tx.cese.findMany({
      orderBy: { creadoEn: 'desc' },
      include: { employee: { select: { nombres: true, apellidos: true, numeroDocumento: true } } },
    });
  }

  async detalle(tx: any, ceseId: string): Promise<any> {
    const cese = await tx.cese.findUnique({
      where: { id: ceseId },
      include: { employee: { select: { nombres: true, apellidos: true, numeroDocumento: true } } },
    });
    if (!cese) throw new NotFoundException(`Cese ${ceseId} no encontrado`);
    return cese;
  }

  async aprobar(tx: any, ceseId: string, aprobadoPor: string): Promise<any> {
    const cese = await this.obtenerCese(tx, ceseId);
    if (cese.estado !== 'CALCULADA') {
      throw new ConflictException(`Solo se aprueba una liquidación CALCULADA (actual: ${cese.estado})`);
    }

    // Validaciones de completitud por motivo (422 con lista de faltantes).
    const faltantes: string[] = [];
    if (cese.motivo === 'FALLECIMIENTO') {
      const derechohabientes = cese.derechohabientes ?? [];
      if (derechohabientes.length === 0) {
        faltantes.push('derechohabientes: obligatorios en cese por fallecimiento');
      } else {
        const suma = derechohabientes.reduce((s: number, d: any) => s + Number(d.porcentaje), 0);
        if (Math.abs(suma - 100) > 0.01) {
          faltantes.push(`derechohabientes: los porcentajes suman ${suma}, deben sumar 100`);
        }
      }
    }
    if (!cese.componentes) faltantes.push('componentes: la liquidación no está calculada');
    if (faltantes.length > 0) {
      throw new UnprocessableEntityException({ message: 'Cese incompleto', faltantes });
    }

    const empleado = await tx.employee.findUnique({ where: { id: cese.employeeId } });
    const tenant = await tx.tenant.findUnique({ where: { id: cese.tenantId } });

    // Documentos PRIMERO: si MinIO falla, el estado no avanza (reintento seguro;
    // re-subir crea versiones nuevas, no duplica documentos).
    await this.ceseDocuments!.generarDocumentosCese(tx, cese, empleado, tenant, aprobadoPor);

    await tx.employee.update({ where: { id: cese.employeeId }, data: { estado: 'cesado' } });
    await tx.vacacionPeriodo.updateMany({
      where: { employeeId: cese.employeeId, estado: { in: ['EN_CURSO', 'VENCIDO_PENDIENTE'] } },
      data: { estado: 'LIQUIDADO' },
    });

    return tx.cese.update({
      where: { id: ceseId },
      data: { estado: 'APROBADA', aprobadoPor, aprobadoEn: new Date() },
    });
  }

  async pagar(tx: any, ceseId: string, fechaPago: Date = new Date()): Promise<any> {
    const cese = await this.obtenerCese(tx, ceseId);
    if (cese.estado !== 'APROBADA') {
      throw new ConflictException(`Solo se paga una liquidación APROBADA (actual: ${cese.estado})`);
    }
    const fueraDePlazo = fechaPago.getTime() > new Date(cese.fechaLimitePago).getTime() + 86_399_999;
    return tx.cese.update({
      where: { id: ceseId },
      data: { estado: 'PAGADA', pagadoEn: fechaPago, pagoFueraDePlazo: fueraDePlazo },
    });
  }

  async anular(tx: any, ceseId: string, motivo: string): Promise<any> {
    if (!motivo || motivo.trim() === '') {
      throw new BadRequestException('El motivo de anulación es obligatorio');
    }
    const cese = await this.obtenerCese(tx, ceseId);
    if (cese.estado === 'PAGADA' || cese.estado === 'ANULADA') {
      throw new ConflictException(`Un cese ${cese.estado} no puede anularse`);
    }
    if (cese.estado === 'APROBADA') {
      await tx.employee.update({ where: { id: cese.employeeId }, data: { estado: 'activo' } });
      await tx.vacacionPeriodo.updateMany({
        where: { employeeId: cese.employeeId, estado: 'LIQUIDADO' },
        data: { estado: 'VENCIDO_PENDIENTE' },
      });
    }
    return tx.cese.update({
      where: { id: ceseId },
      data: { estado: 'ANULADA', motivoAnulacion: motivo.trim() },
    });
  }
```

(agregar `UnprocessableEntityException` al import de `@nestjs/common`).

Nota sobre `anular` desde APROBADA: los períodos vuelven a `VENCIDO_PENDIENTE` como aproximación conservadora; RRHH puede corregir el estado real por período con `PUT /vacaciones/periodos/:id`.

- [ ] **Step 4: Verificar que pasa**

Run: `pnpm --filter @rrhh/api test -- termination.service`
Expected: PASS (15 tests)

- [ ] **Step 5: Controller y module**

```typescript
// apps/api/src/modules/termination/termination.controller.ts
import { BadRequestException, Body, Controller, Get, Param, Post, Put, UseGuards } from '@nestjs/common';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { getTenantContext, TenantContext } from '../../common/database/tenant-request-context';
import { TerminationService, CeseSnapshot } from './termination.service';
import { MotivoCese } from '../payroll/calculators/liquidacion.calculator';

export class CrearCeseDto {
  employeeId!: string;
  /** ISO YYYY-MM-DD. */
  fechaCese!: string;
  motivo!: MotivoCese;
}

export class AnularCeseDto {
  motivo!: string;
}

const MOTIVOS: readonly MotivoCese[] = [
  'RENUNCIA',
  'TERMINO_CONTRATO',
  'MUTUO_DISENSO',
  'DESPIDO_ARBITRARIO',
  'FALLECIMIENTO',
];

function requireIdentity(ctx: TenantContext): { tenantId: string; userId: string } {
  if (!ctx.tenantId || !ctx.userId) {
    throw new BadRequestException('Request sin tenant o usuario resuelto');
  }
  return { tenantId: ctx.tenantId, userId: ctx.userId };
}

@Controller('ceses')
@UseGuards(PermissionsGuard)
export class TerminationController {
  constructor(private readonly termination: TerminationService) {}

  @Get()
  @RequirePermission('termination.read')
  async listar() {
    const ctx = getTenantContext();
    return this.termination.listar(ctx.tx);
  }

  @Get(':id')
  @RequirePermission('termination.read')
  async detalle(@Param('id') id: string) {
    const ctx = getTenantContext();
    return this.termination.detalle(ctx.tx, id);
  }

  @Post()
  @RequirePermission('termination.manage')
  async crear(@Body() dto: CrearCeseDto) {
    if (!dto?.employeeId || !dto?.fechaCese || !dto?.motivo) {
      throw new BadRequestException('employeeId, fechaCese y motivo son obligatorios');
    }
    if (!MOTIVOS.includes(dto.motivo)) {
      throw new BadRequestException(`Motivo inválido: "${dto.motivo}"`);
    }
    const fecha = new Date(dto.fechaCese);
    if (Number.isNaN(fecha.getTime())) {
      throw new BadRequestException(`fechaCese inválida: "${dto.fechaCese}"`);
    }
    const ctx = getTenantContext();
    const { tenantId, userId } = requireIdentity(ctx);
    return this.termination.crearCese(ctx.tx, {
      tenantId,
      employeeId: dto.employeeId,
      fechaCese: fecha,
      motivo: dto.motivo,
      creadoPor: userId,
    });
  }

  @Put(':id/datos')
  @RequirePermission('termination.manage')
  async actualizarDatos(@Param('id') id: string, @Body() cambios: Partial<CeseSnapshot>) {
    const ctx = getTenantContext();
    return this.termination.actualizarDatos(ctx.tx, id, cambios ?? {});
  }

  @Post(':id/calcular')
  @RequirePermission('termination.manage')
  async calcular(@Param('id') id: string) {
    const ctx = getTenantContext();
    return this.termination.calcular(ctx.tx, id);
  }

  @Post(':id/aprobar')
  @RequirePermission('termination.approve')
  async aprobar(@Param('id') id: string) {
    const ctx = getTenantContext();
    const { userId } = requireIdentity(ctx);
    return this.termination.aprobar(ctx.tx, id, userId);
  }

  @Post(':id/pagar')
  @RequirePermission('termination.approve')
  async pagar(@Param('id') id: string) {
    const ctx = getTenantContext();
    return this.termination.pagar(ctx.tx, id);
  }

  @Post(':id/anular')
  @RequirePermission('termination.approve')
  async anular(@Param('id') id: string, @Body() dto: AnularCeseDto) {
    const ctx = getTenantContext();
    return this.termination.anular(ctx.tx, id, dto?.motivo ?? '');
  }
}
```

```typescript
// apps/api/src/modules/termination/termination.module.ts
import { Module } from '@nestjs/common';
import { TerminationController } from './termination.controller';
import { TerminationService } from './termination.service';
import { CeseDocumentsService } from './cese-documents.service';
import { NormativeParamsModule } from '../normative-params/normative-params.module';
import { DocumentsModule } from '../documents/documents.module';

@Module({
  imports: [NormativeParamsModule, DocumentsModule],
  controllers: [TerminationController],
  providers: [TerminationService, CeseDocumentsService],
})
export class TerminationModule {}
```

**Verificar** que `documents.module.ts` exporta `DocumentService` (`exports: [DocumentService]`); si no, agregarlo. En `app.module.ts`, importar y registrar `TerminationModule` después de `VacationsModule`.

- [ ] **Step 6: Suite completa**

Run: `pnpm --filter @rrhh/api test`
Expected: todo verde (208 + ~26 nuevos).

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/termination/ apps/api/src/modules/documents/documents.module.ts apps/api/src/app.module.ts
git commit -m "feat(cese): flujo aprobar/pagar/anular con documentos, endpoints REST y módulo termination"
```

---

### Task 11: Frontend — página `/vacaciones`

**Files:**
- Create: `apps/web/src/app/(app)/vacaciones/vacations-api.ts`
- Create: `apps/web/src/app/(app)/vacaciones/page.tsx`

**Interfaces:**
- Consumes: `apiFetch` de `@/lib/api-client`; endpoints `GET /employees`, `GET/POST/PUT /vacaciones/periodos` (Task 6).
- Produces: página visible con permiso `vacation.read`.

- [ ] **Step 1: API client de vacaciones**

```typescript
// apps/web/src/app/(app)/vacaciones/vacations-api.ts
import { apiFetch } from '@/lib/api-client';

export interface VacacionPeriodo {
  id: string;
  employeeId: string;
  periodoInicio: string;
  periodoFin: string;
  diasGanados: number;
  diasGozados: string | number;
  estado: 'EN_CURSO' | 'VENCIDO_PENDIENTE' | 'GOZADO' | 'LIQUIDADO';
  notas: string | null;
}

async function ok<T>(res: Response, accion: string): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(typeof body.message === 'string' ? body.message : `No se pudo ${accion}`);
  }
  return res.json() as Promise<T>;
}

export async function listarPeriodos(employeeId: string): Promise<VacacionPeriodo[]> {
  return ok(await apiFetch(`/vacaciones/periodos?employeeId=${employeeId}`), 'listar los períodos');
}

export async function crearPeriodo(employeeId: string, periodoInicio: string): Promise<VacacionPeriodo> {
  return ok(
    await apiFetch('/vacaciones/periodos', {
      method: 'POST',
      body: JSON.stringify({ employeeId, periodoInicio }),
    }),
    'crear el período',
  );
}

export async function actualizarPeriodo(
  id: string,
  cambios: { diasGozados?: number; estado?: VacacionPeriodo['estado']; notas?: string },
): Promise<VacacionPeriodo> {
  return ok(
    await apiFetch(`/vacaciones/periodos/${id}`, { method: 'PUT', body: JSON.stringify(cambios) }),
    'actualizar el período',
  );
}

export interface EmpleadoResumen {
  id: string;
  nombres: string;
  apellidos: string;
  numeroDocumento: string;
}

export async function listarEmpleados(): Promise<EmpleadoResumen[]> {
  return ok(await apiFetch('/employees'), 'listar empleados');
}
```

- [ ] **Step 2: Página**

```tsx
// apps/web/src/app/(app)/vacaciones/page.tsx
'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/components/auth-context';
import {
  actualizarPeriodo,
  crearPeriodo,
  EmpleadoResumen,
  listarEmpleados,
  listarPeriodos,
  VacacionPeriodo,
} from './vacations-api';

const ESTADO_LABELS: Record<string, string> = {
  EN_CURSO: 'En curso',
  VENCIDO_PENDIENTE: 'Vencido pendiente',
  GOZADO: 'Gozado',
  LIQUIDADO: 'Liquidado',
};

/** Un período vencido hace más de 10 meses sin gozar está próximo a generar indemnización (art. 23 D.Leg. 713). */
function alertaIndemnizacion(p: VacacionPeriodo): boolean {
  if (p.estado !== 'VENCIDO_PENDIENTE') return false;
  const limite = new Date(p.periodoFin);
  limite.setMonth(limite.getMonth() + 10);
  return Date.now() > limite.getTime();
}

export default function VacacionesPage() {
  const { hasPermission } = useAuth();
  const puedeGestionar = hasPermission('vacation.manage');
  const [empleados, setEmpleados] = useState<EmpleadoResumen[]>([]);
  const [employeeId, setEmployeeId] = useState('');
  const [periodos, setPeriodos] = useState<VacacionPeriodo[]>([]);
  const [nuevoInicio, setNuevoInicio] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);

  useEffect(() => {
    listarEmpleados().then(setEmpleados).catch((e) => setError(e.message));
  }, []);

  async function cargar(id: string) {
    setEmployeeId(id);
    setError(null);
    if (!id) return setPeriodos([]);
    setCargando(true);
    try {
      setPeriodos(await listarPeriodos(id));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCargando(false);
    }
  }

  async function onCrear() {
    if (!employeeId || !nuevoInicio) return;
    setError(null);
    try {
      await crearPeriodo(employeeId, nuevoInicio);
      setNuevoInicio('');
      await cargar(employeeId);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function onGozados(p: VacacionPeriodo, valor: string) {
    const dias = Number(valor);
    if (Number.isNaN(dias)) return;
    setError(null);
    try {
      await actualizarPeriodo(p.id, { diasGozados: dias });
      await cargar(employeeId);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Récord vacacional</h1>
      {error && <p className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      <div className="flex items-end gap-3">
        <label className="block text-sm">
          Empleado
          <select
            value={employeeId}
            onChange={(e) => cargar(e.target.value)}
            className="mt-1 block w-72 rounded border border-slate-300 px-2 py-1.5"
          >
            <option value="">— Seleccionar —</option>
            {empleados.map((e) => (
              <option key={e.id} value={e.id}>
                {e.apellidos}, {e.nombres} ({e.numeroDocumento})
              </option>
            ))}
          </select>
        </label>
        {puedeGestionar && employeeId && (
          <>
            <label className="block text-sm">
              Inicio del período (aniversario)
              <input
                type="date"
                value={nuevoInicio}
                onChange={(e) => setNuevoInicio(e.target.value)}
                className="mt-1 block rounded border border-slate-300 px-2 py-1.5"
              />
            </label>
            <button
              onClick={onCrear}
              disabled={!nuevoInicio}
              className="rounded bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              Agregar período
            </button>
          </>
        )}
      </div>

      {cargando && <p className="text-sm text-slate-500">Cargando…</p>}
      {employeeId && !cargando && (
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-slate-500">
              <th className="py-2">Período</th>
              <th>Ganados</th>
              <th>Gozados</th>
              <th>Pendientes</th>
              <th>Estado</th>
              <th>Alerta</th>
            </tr>
          </thead>
          <tbody>
            {periodos.map((p) => (
              <tr key={p.id} className="border-b border-slate-100">
                <td className="py-2">
                  {p.periodoInicio.slice(0, 10)} → {p.periodoFin.slice(0, 10)}
                </td>
                <td>{p.diasGanados}</td>
                <td>
                  {puedeGestionar && p.estado !== 'LIQUIDADO' ? (
                    <input
                      type="number"
                      defaultValue={Number(p.diasGozados)}
                      min={0}
                      max={p.diasGanados}
                      onBlur={(e) => onGozados(p, e.target.value)}
                      className="w-20 rounded border border-slate-300 px-2 py-1"
                    />
                  ) : (
                    Number(p.diasGozados)
                  )}
                </td>
                <td>{p.diasGanados - Number(p.diasGozados)}</td>
                <td>{ESTADO_LABELS[p.estado]}</td>
                <td>
                  {alertaIndemnizacion(p) && (
                    <span className="rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-800">
                      Riesgo de indemnización (art. 23)
                    </span>
                  )}
                </td>
              </tr>
            ))}
            {periodos.length === 0 && (
              <tr>
                <td colSpan={6} className="py-4 text-slate-500">
                  Sin períodos registrados.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Verificar build de tipos**

Run: `pnpm --filter @rrhh/web exec tsc --noEmit`
Expected: sin errores. (NO ejecutar `next build` si el dev server está corriendo.)

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/app/\(app\)/vacaciones/
git commit -m "feat(web): página de récord vacacional con alerta de indemnización"
```

---

### Task 12: Frontend — página `/liquidaciones` (listado + wizard + detalle)

**Files:**
- Create: `apps/web/src/app/(app)/liquidaciones/termination-api.ts`
- Create: `apps/web/src/app/(app)/liquidaciones/wizard-cese.tsx`
- Create: `apps/web/src/app/(app)/liquidaciones/detalle-cese.tsx`
- Create: `apps/web/src/app/(app)/liquidaciones/page.tsx`

**Interfaces:**
- Consumes: endpoints de Task 10; `listarEmpleados` de `../vacaciones/vacations-api` (reutilizado); `GET /documents/legajo/:employeeId` y `GET /documents/:id/download` (existentes) para la descarga de documentos.
- Produces: página visible con `termination.read`; acciones según `termination.manage` / `termination.approve`.

- [ ] **Step 1: API client**

```typescript
// apps/web/src/app/(app)/liquidaciones/termination-api.ts
import { apiFetch } from '@/lib/api-client';

export type MotivoCese =
  | 'RENUNCIA'
  | 'TERMINO_CONTRATO'
  | 'MUTUO_DISENSO'
  | 'DESPIDO_ARBITRARIO'
  | 'FALLECIMIENTO';

export type EstadoCese = 'BORRADOR' | 'CALCULADA' | 'APROBADA' | 'PAGADA' | 'ANULADA';

export interface LineaLiquidacion {
  concepto: string;
  baseLegal: string;
  monto: number;
}

export interface Cese {
  id: string;
  employeeId: string;
  employee?: { nombres: string; apellidos: string; numeroDocumento: string };
  fechaCese: string;
  motivo: MotivoCese;
  estado: EstadoCese;
  inputSnapshot: any;
  componentes: { ingresos: LineaLiquidacion[]; deducciones: LineaLiquidacion[] } | null;
  totalBruto: string | number | null;
  totalDeducciones: string | number | null;
  netoPagar: string | number | null;
  fechaLimitePago: string;
  pagadoEn: string | null;
  pagoFueraDePlazo: boolean;
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

export const listarCeses = async (): Promise<Cese[]> => ok(await apiFetch('/ceses'), 'listar ceses');
export const detalleCese = async (id: string): Promise<Cese> => ok(await apiFetch(`/ceses/${id}`), 'cargar el cese');

export async function crearCese(input: { employeeId: string; fechaCese: string; motivo: MotivoCese }): Promise<Cese> {
  return ok(await apiFetch('/ceses', { method: 'POST', body: JSON.stringify(input) }), 'crear el cese');
}

export async function actualizarDatos(id: string, cambios: any): Promise<Cese> {
  return ok(await apiFetch(`/ceses/${id}/datos`, { method: 'PUT', body: JSON.stringify(cambios) }), 'guardar los datos');
}

export const calcularCese = async (id: string): Promise<Cese> =>
  ok(await apiFetch(`/ceses/${id}/calcular`, { method: 'POST' }), 'calcular');
export const aprobarCese = async (id: string): Promise<Cese> =>
  ok(await apiFetch(`/ceses/${id}/aprobar`, { method: 'POST' }), 'aprobar');
export const pagarCese = async (id: string): Promise<Cese> =>
  ok(await apiFetch(`/ceses/${id}/pagar`, { method: 'POST' }), 'registrar el pago');
export async function anularCese(id: string, motivo: string): Promise<Cese> {
  return ok(await apiFetch(`/ceses/${id}/anular`, { method: 'POST', body: JSON.stringify({ motivo }) }), 'anular');
}

/** Semáforo del plazo de 48h (D.S. 001-97-TR). */
export function semaforoPlazo(cese: Cese): { label: string; className: string } {
  if (cese.estado === 'PAGADA') {
    return cese.pagoFueraDePlazo
      ? { label: 'Pagado fuera de plazo', className: 'bg-red-100 text-red-800' }
      : { label: 'Pagado a tiempo', className: 'bg-emerald-100 text-emerald-800' };
  }
  if (cese.estado === 'ANULADA') return { label: '—', className: 'bg-slate-100 text-slate-500' };
  const restanteMs = new Date(cese.fechaLimitePago).getTime() + 86_399_999 - Date.now();
  if (restanteMs < 0) return { label: 'Plazo vencido', className: 'bg-red-100 text-red-800' };
  if (restanteMs < 24 * 3_600_000) return { label: 'Vence hoy', className: 'bg-amber-100 text-amber-800' };
  return { label: 'En plazo', className: 'bg-emerald-100 text-emerald-800' };
}
```

- [ ] **Step 2: Wizard de cese (3 pasos)**

```tsx
// apps/web/src/app/(app)/liquidaciones/wizard-cese.tsx
'use client';

import { useEffect, useState } from 'react';
import { EmpleadoResumen, listarEmpleados } from '../vacaciones/vacations-api';
import { actualizarDatos, calcularCese, Cese, crearCese, MotivoCese } from './termination-api';

const MOTIVOS: Array<{ value: MotivoCese; label: string }> = [
  { value: 'RENUNCIA', label: 'Renuncia voluntaria' },
  { value: 'TERMINO_CONTRATO', label: 'Término de contrato' },
  { value: 'MUTUO_DISENSO', label: 'Mutuo disenso' },
  { value: 'DESPIDO_ARBITRARIO', label: 'Despido arbitrario' },
  { value: 'FALLECIMIENTO', label: 'Fallecimiento' },
];

export function WizardCese({ onTerminado }: { onTerminado: (cese: Cese) => void }) {
  const [paso, setPaso] = useState(1);
  const [empleados, setEmpleados] = useState<EmpleadoResumen[]>([]);
  const [employeeId, setEmployeeId] = useState('');
  const [fechaCese, setFechaCese] = useState('');
  const [motivo, setMotivo] = useState<MotivoCese>('RENUNCIA');
  const [cese, setCese] = useState<Cese | null>(null);
  const [snapshotJson, setSnapshotJson] = useState('');
  const [gratiExtra, setGratiExtra] = useState('0');
  const [derechohabientesJson, setDerechohabientesJson] = useState('[]');
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  useEffect(() => {
    listarEmpleados().then(setEmpleados).catch((e) => setError(e.message));
  }, []);

  async function paso1Crear() {
    setError(null);
    setOcupado(true);
    try {
      const creado = await crearCese({ employeeId, fechaCese, motivo });
      setCese(creado);
      setSnapshotJson(JSON.stringify(creado.inputSnapshot, null, 2));
      setPaso(2);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setOcupado(false);
    }
  }

  async function paso2Calcular() {
    if (!cese) return;
    setError(null);
    setOcupado(true);
    try {
      let snapshot: any;
      try {
        snapshot = JSON.parse(snapshotJson);
      } catch {
        throw new Error('El snapshot no es JSON válido');
      }
      if (motivo === 'MUTUO_DISENSO') snapshot.gratificacionExtraordinaria = Number(gratiExtra) || 0;
      if (motivo === 'FALLECIMIENTO') {
        try {
          snapshot.derechohabientes = JSON.parse(derechohabientesJson);
        } catch {
          throw new Error('Derechohabientes no es JSON válido');
        }
      }
      await actualizarDatos(cese.id, snapshot);
      const calculado = await calcularCese(cese.id);
      setCese(calculado);
      setPaso(3);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setOcupado(false);
    }
  }

  return (
    <div className="space-y-4 rounded border border-slate-200 bg-white p-4">
      <h2 className="font-medium">Nuevo cese — paso {paso} de 3</h2>
      {error && <p className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      {paso === 1 && (
        <div className="flex flex-wrap items-end gap-3 text-sm">
          <label>
            Empleado
            <select value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} className="mt-1 block w-72 rounded border border-slate-300 px-2 py-1.5">
              <option value="">— Seleccionar —</option>
              {empleados.map((e) => (
                <option key={e.id} value={e.id}>{e.apellidos}, {e.nombres}</option>
              ))}
            </select>
          </label>
          <label>
            Fecha de cese
            <input type="date" value={fechaCese} onChange={(e) => setFechaCese(e.target.value)} className="mt-1 block rounded border border-slate-300 px-2 py-1.5" />
          </label>
          <label>
            Motivo
            <select value={motivo} onChange={(e) => setMotivo(e.target.value as MotivoCese)} className="mt-1 block rounded border border-slate-300 px-2 py-1.5">
              {MOTIVOS.map((m) => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
            </select>
          </label>
          <button onClick={paso1Crear} disabled={!employeeId || !fechaCese || ocupado} className="rounded bg-slate-900 px-3 py-2 font-medium text-white disabled:opacity-50">
            {ocupado ? 'Creando…' : 'Crear y pre-llenar'}
          </button>
        </div>
      )}

      {paso === 2 && cese && (
        <div className="space-y-3 text-sm">
          <p className="text-slate-600">
            Revisa y corrige los datos pre-llenados (fuente: contrato, planillas, asistencia y récord
            vacacional). El cálculo usará exactamente este snapshot.
          </p>
          {motivo === 'MUTUO_DISENSO' && (
            <label className="block">
              Gratificación extraordinaria por cese (S/)
              <input type="number" value={gratiExtra} onChange={(e) => setGratiExtra(e.target.value)} className="mt-1 block w-48 rounded border border-slate-300 px-2 py-1.5" />
            </label>
          )}
          {motivo === 'FALLECIMIENTO' && (
            <label className="block">
              Derechohabientes (JSON: nombre, tipoDocumento, numeroDocumento, parentesco, porcentaje)
              <textarea value={derechohabientesJson} onChange={(e) => setDerechohabientesJson(e.target.value)} rows={4} className="mt-1 block w-full rounded border border-slate-300 px-2 py-1.5 font-mono text-xs" />
            </label>
          )}
          <textarea value={snapshotJson} onChange={(e) => setSnapshotJson(e.target.value)} rows={18} className="block w-full rounded border border-slate-300 px-2 py-1.5 font-mono text-xs" />
          <button onClick={paso2Calcular} disabled={ocupado} className="rounded bg-slate-900 px-3 py-2 font-medium text-white disabled:opacity-50">
            {ocupado ? 'Calculando…' : 'Calcular liquidación'}
          </button>
        </div>
      )}

      {paso === 3 && cese && (
        <div className="space-y-3 text-sm">
          <p className="text-emerald-700">Liquidación calculada.</p>
          <button onClick={() => onTerminado(cese)} className="rounded bg-slate-900 px-3 py-2 font-medium text-white">
            Ver desglose
          </button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Detalle del cese**

```tsx
// apps/web/src/app/(app)/liquidaciones/detalle-cese.tsx
'use client';

import { useState } from 'react';
import { useAuth } from '@/components/auth-context';
import { anularCese, aprobarCese, Cese, pagarCese, semaforoPlazo } from './termination-api';

function soles(n: string | number | null): string {
  return n == null ? '—' : `S/ ${Number(n).toFixed(2)}`;
}

export function DetalleCese({ cese, onCambio }: { cese: Cese; onCambio: (c: Cese) => void }) {
  const { hasPermission } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const semaforo = semaforoPlazo(cese);

  async function ejecutar(accion: () => Promise<Cese>) {
    setError(null);
    setOcupado(true);
    try {
      onCambio(await accion());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setOcupado(false);
    }
  }

  async function onAnular() {
    const motivo = window.prompt('Motivo de anulación (obligatorio):');
    if (!motivo) return;
    await ejecutar(() => anularCese(cese.id, motivo));
  }

  return (
    <div className="space-y-4 rounded border border-slate-200 bg-white p-4 text-sm">
      <div className="flex items-center justify-between">
        <h2 className="font-medium">
          {cese.employee ? `${cese.employee.apellidos}, ${cese.employee.nombres}` : cese.employeeId} — {cese.motivo}
        </h2>
        <div className="flex items-center gap-2">
          <span className="rounded bg-slate-100 px-2 py-0.5 text-xs">{cese.estado}</span>
          <span className={`rounded px-2 py-0.5 text-xs ${semaforo.className}`}>{semaforo.label}</span>
        </div>
      </div>
      <p className="text-slate-600">
        Cese: {cese.fechaCese.slice(0, 10)} · Límite de pago (48h): {cese.fechaLimitePago.slice(0, 10)}
      </p>
      {/* Recordatorios de documentos de subida manual (spec §6) */}
      {cese.motivo === 'RENUNCIA' && (
        <p className="rounded bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Recuerda subir la carta de renuncia al legajo (tipo CARTA_RENUNCIA).
        </p>
      )}
      <p className="rounded bg-slate-50 px-3 py-2 text-xs text-slate-600">
        Si la actividad lo requiere (Ley 29783), sube el examen médico de retiro al legajo (tipo
        EXAMEN_MEDICO_RETIRO).
      </p>
      {error && <p className="rounded bg-red-50 px-3 py-2 text-red-700">{error}</p>}

      {cese.componentes && (
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b border-slate-200 text-left text-slate-500">
              <th className="py-1">Concepto</th>
              <th>Base legal</th>
              <th className="text-right">Monto</th>
            </tr>
          </thead>
          <tbody>
            {[...cese.componentes.ingresos, ...cese.componentes.deducciones].map((l, i) => (
              <tr key={i} className="border-b border-slate-100">
                <td className="py-1">{l.concepto}</td>
                <td className="text-slate-500">{l.baseLegal}</td>
                <td className={`text-right ${l.monto < 0 ? 'text-red-700' : ''}`}>{soles(l.monto)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr><td colSpan={2} className="py-1 font-medium">Total bruto</td><td className="text-right">{soles(cese.totalBruto)}</td></tr>
            <tr><td colSpan={2} className="py-1 font-medium">Deducciones</td><td className="text-right">{soles(cese.totalDeducciones)}</td></tr>
            <tr className="border-t border-slate-300"><td colSpan={2} className="py-1 font-semibold">NETO A PAGAR</td><td className="text-right font-semibold">{soles(cese.netoPagar)}</td></tr>
          </tfoot>
        </table>
      )}

      <div className="flex gap-2">
        {cese.estado === 'CALCULADA' && hasPermission('termination.approve') && (
          <button onClick={() => ejecutar(() => aprobarCese(cese.id))} disabled={ocupado} className="rounded bg-emerald-700 px-3 py-2 font-medium text-white disabled:opacity-50">
            Aprobar (genera documentos)
          </button>
        )}
        {cese.estado === 'APROBADA' && hasPermission('termination.approve') && (
          <button onClick={() => ejecutar(() => pagarCese(cese.id))} disabled={ocupado} className="rounded bg-slate-900 px-3 py-2 font-medium text-white disabled:opacity-50">
            Registrar pago
          </button>
        )}
        {cese.estado !== 'PAGADA' && cese.estado !== 'ANULADA' && hasPermission('termination.approve') && (
          <button onClick={onAnular} disabled={ocupado} className="rounded border border-red-300 px-3 py-2 font-medium text-red-700 disabled:opacity-50">
            Anular
          </button>
        )}
        {(cese.estado === 'APROBADA' || cese.estado === 'PAGADA') && (
          <a href={`/legajo?employeeId=${cese.employeeId}`} className="rounded border border-slate-300 px-3 py-2 font-medium text-slate-700">
            Ver documentos en el legajo
          </a>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Página principal**

```tsx
// apps/web/src/app/(app)/liquidaciones/page.tsx
'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/components/auth-context';
import { Cese, detalleCese, listarCeses, semaforoPlazo } from './termination-api';
import { WizardCese } from './wizard-cese';
import { DetalleCese } from './detalle-cese';

export default function LiquidacionesPage() {
  const { hasPermission } = useAuth();
  const [ceses, setCeses] = useState<Cese[]>([]);
  const [seleccionado, setSeleccionado] = useState<Cese | null>(null);
  const [mostrarWizard, setMostrarWizard] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refrescar() {
    try {
      setCeses(await listarCeses());
    } catch (e) {
      setError((e as Error).message);
    }
  }

  useEffect(() => {
    refrescar();
  }, []);

  async function seleccionar(id: string) {
    setError(null);
    try {
      setSeleccionado(await detalleCese(id));
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Ceses y liquidaciones</h1>
        {hasPermission('termination.manage') && (
          <button onClick={() => setMostrarWizard((v) => !v)} className="rounded bg-slate-900 px-3 py-2 text-sm font-medium text-white">
            {mostrarWizard ? 'Cerrar wizard' : 'Nuevo cese'}
          </button>
        )}
      </div>
      {error && <p className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      {mostrarWizard && (
        <WizardCese
          onTerminado={(cese) => {
            setMostrarWizard(false);
            setSeleccionado(cese);
            refrescar();
          }}
        />
      )}

      {seleccionado && (
        <DetalleCese
          cese={seleccionado}
          onCambio={(c) => {
            setSeleccionado(c);
            refrescar();
          }}
        />
      )}

      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-left text-slate-500">
            <th className="py-2">Empleado</th>
            <th>Motivo</th>
            <th>Fecha de cese</th>
            <th>Estado</th>
            <th>Plazo 48h</th>
            <th className="text-right">Neto</th>
          </tr>
        </thead>
        <tbody>
          {ceses.map((c) => {
            const s = semaforoPlazo(c);
            return (
              <tr key={c.id} onClick={() => seleccionar(c.id)} className="cursor-pointer border-b border-slate-100 hover:bg-slate-50">
                <td className="py-2">{c.employee ? `${c.employee.apellidos}, ${c.employee.nombres}` : c.employeeId}</td>
                <td>{c.motivo}</td>
                <td>{c.fechaCese.slice(0, 10)}</td>
                <td>{c.estado}</td>
                <td><span className={`rounded px-2 py-0.5 text-xs ${s.className}`}>{s.label}</span></td>
                <td className="text-right">{c.netoPagar != null ? `S/ ${Number(c.netoPagar).toFixed(2)}` : '—'}</td>
              </tr>
            );
          })}
          {ceses.length === 0 && (
            <tr><td colSpan={6} className="py-4 text-slate-500">Sin ceses registrados.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 5: Verificar tipos**

Run: `pnpm --filter @rrhh/web exec tsc --noEmit`
Expected: sin errores.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/app/\(app\)/liquidaciones/
git commit -m "feat(web): página de ceses y liquidaciones con wizard de 3 pasos y semáforo 48h"
```

---

### Task 13: Sidebar, documentación y verificación final

**Files:**
- Modify: `apps/web/src/app/(app)/layout.tsx`
- Modify: `docs/RESUMEN_SISTEMA.md`, `docs/PENDIENTES.md`

- [ ] **Step 1: Sidebar** — en `NAV_ITEMS` de `layout.tsx`, después de Nómina:

```typescript
  { href: '/vacaciones', label: 'Vacaciones', anyPermission: ['vacation.read'] },
  { href: '/liquidaciones', label: 'Liquidaciones', anyPermission: ['termination.read'] },
```

- [ ] **Step 2: Documentación**

- `docs/RESUMEN_SISTEMA.md`: agregar sección "Cese y Liquidación" a las tablas de páginas y endpoints (los 8 de `/ceses` + 3 de `/vacaciones`), actualizar el conteo de tests y la matriz de acceso (RRHH gestiona ceses, solo Admin aprueba/paga/anula; Manager ve vacaciones).
- `docs/PENDIENTES.md`: marcar la línea del backlog "Vacaciones: programación, control..." como parcialmente cubierta (récord + alerta hechas; programación/aprobación de goce pendiente) y agregar los nuevos pendientes: parametrizar comisión/prima AFP (heredado), integrar pago de liquidación al telecrédito, firma digital de documentos de cese.

- [ ] **Step 3: Verificación completa (barra del proyecto)**

Run: `pnpm --filter @rrhh/api test`
Expected: TODO verde (≈234+ tests).
Run: `pnpm --filter @rrhh/api exec tsc --noEmit && pnpm --filter @rrhh/web exec tsc --noEmit`
Expected: sin errores.
Run (con el dev server APAGADO): `pnpm --filter @rrhh/web build`
Expected: build OK, 12/12 páginas.

Prueba manual E2E (con `docker-compose up -d`, API y web corriendo, seed aplicado):
1. Login `rrhh@demo.pe` → `/vacaciones`: crear un período para un empleado demo, registrar días gozados.
2. `/liquidaciones` → Nuevo cese (RENUNCIA, fecha de hoy) → revisar snapshot pre-llenado → Calcular → verificar desglose con CTS/grati/vacaciones y deducciones.
3. Login `admin@demo.pe` → Aprobar (verifica que aparecen los 4 PDFs en `/legajo` del empleado) → Registrar pago → semáforo verde.
4. Verificar que el empleado quedó `cesado` en `/admin` y que anular un cese BORRADOR de otro empleado funciona.

- [ ] **Step 4: Commit final**

```bash
git add apps/web/src/app/\(app\)/layout.tsx docs/RESUMEN_SISTEMA.md docs/PENDIENTES.md
git commit -m "feat(cese): navegación, documentación y cierre del módulo de liquidación"
```

---

## Cobertura del spec (self-check del plan)

| Requisito del spec | Task |
|---|---|
| §3.1 MYPE micro/pequeña en Contrato | 1 |
| §3.2 VacacionPeriodo | 1, 6 |
| §3.3 Cese (reemplaza Liquidacion) + índice parcial + RLS + auditoría | 1 |
| §3.4 TipoDocumento nuevos | 1, 9 |
| §3.5 Parámetros normativos | 2, 8 |
| §4.1-4.4 Calculadores y matriz de afectación | 3, 4, 5 |
| §5 API, permisos y flujo de estados | 2, 6, 7, 8, 10 |
| §6 Documentos PDF | 9, 10 |
| §7 Frontend | 11, 12, 13 |
| §8 Errores y validaciones | 7, 8, 10 |
| §9 Testing | 3-10, 13 |

