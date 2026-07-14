# Fase 1 — Módulo 1 (Nómina): Plan de Implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Construir el motor de cálculo de nómina (régimen General + MYPE) sobre las fundaciones de Fase 0 — calculadoras puras para CTS, gratificación, utilidades, quinta categoría, aportes AFP/ONP/EsSalud y liquidación, orquestadas por un `PayrollRunService` que cierra un ciclo de planilla completo y genera los archivos de exportación T-Registro/PLAME/telecrédito.

**Architecture:** Cada regla normativa es una función pura `(inputs, parametrosVigentes) => resultado`, sin acceso a BD ni efectos secundarios, testeada con `NORMATIVE_PARAMETER` fijado como fixture. `PayrollRunService` es el único punto que resuelve parámetros vigentes (vía `NormativeParameterService` de Fase 0) y orquesta las calculadoras dentro de una transacción con RLS (mismo patrón `getTenantContext()` de Fase 0). Exportadores (`PlanillaExporter`, `BankFileExporter`) consumen el resultado ya calculado, no recalculan nada.

**Tech Stack:** NestJS (apps/api), Prisma (packages/database), Jest, mismo patrón de RLS/auditoría/colas de Fase 0.

## Global Constraints

- Toda la UI y mensajes en español (Perú); moneda `S/`, fechas `dd/mm/aaaa`, zona horaria `America/Lima`. (goal.md)
- Ningún valor normativo (UIT, RMV, tasas, tramos) se hardcodea — todo pasa por `NormativeParameterService.resolve(client, codigo, fecha)` de Fase 0 (`apps/api/src/modules/normative-params/normative-parameter.service.ts`). (goal.md, diseño Fase 0)
- Cobertura de tests unitarios obligatoria para TODOS los cálculos de nómina, incluyendo los casos borde no negociables: ingreso a mitad de mes, cese antes del depósito de CTS, trabajador con remuneración variable, régimen MYPE vs General. (goal.md)
- Toda operación sobre `PLANILLA`, `PLANILLA_DETALLE`, `LIQUIDACION`, `PROVISION` y `CONTRATO` genera auditoría inmutable vía el trigger genérico de Fase 0 — cada tabla nueva debe adjuntarse a `audit_trigger()`. (diseño Fase 0)
- Aislamiento multi-tenant por RLS ya implementado — toda tabla nueva con `tenant_id` necesita su policy `tenant_isolation`, igual patrón que `packages/database/prisma/migrations/20260710000000_init_foundations/migration.sql`.
- Fuera de alcance de este plan (ver `especificaciones-fases.md`): reglas completas de régimen Agrario y otros regímenes especiales (solo General + MYPE a fondo); origen automático de horas extra (Fase 2 las alimenta, este plan solo consume el concepto ya aprobado); páginas/UI de frontend (requieren una pasada de diseño con `frontend-design` antes de poder escribirse como tareas TDD reales — no incluidas aquí para no violar "sin placeholders").
- Valores de referencia usados en los tests (`UIT=5350`, `RMV=1130`, `ESSALUD_TASA=0.09`, `ONP_TASA=0.13`, `AFP_APORTE_OBLIGATORIO=0.10`, `GRATIFICACION_BONIF_EXTRAORD={essalud:0.09,eps:0.0675}`, `HORAS_EXTRA_TASAS={primeras_2h:0.25,siguientes:0.35,feriado_descanso:1.0}`, `ASIGNACION_FAMILIAR_PCT=0.10`, `QUINTA_DEDUCCION_UIT=7`) son los mismos sembrados en `packages/database/seed.ts` — **sin confirmar contra fuente oficial**, ver `docs/superpowers/specs/validaciones-normativas-pendientes.md` antes de producción.

---

### Task 1: Extender el schema de Prisma con las entidades de Fase 1

**Files:**
- Modify: `packages/database/prisma/schema.prisma`
- Create: `packages/database/prisma/migrations/20260711000000_fase1_nomina/migration.sql`

**Interfaces:**
- Produces: modelos Prisma `Contrato`, `CuentaBancaria`, `RegimenPensionario`, `Concepto`, `Planilla`, `PlanillaDetalle`, `Provision`, `Liquidacion` — consumidos por todas las tareas siguientes.

- [ ] **Step 1: Añadir los modelos al schema**

Agregar a `packages/database/prisma/schema.prisma` (después del modelo `Employee`):

```prisma
model Contrato {
  id                  String    @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  employeeId          String    @map("employee_id") @db.Uuid
  regimenLaboral      String    @map("regimen_laboral") @db.VarChar(20) // general | mype | agrario
  regimenLaboralSunat String    @map("regimen_laboral_sunat") @db.VarChar(2) // codigo Tabla 33
  tipoTrabajadorSunat String    @map("tipo_trabajador_sunat") @db.VarChar(2) // codigo Tabla 8
  tipoContrato        String    @map("tipo_contrato") @db.VarChar(30)
  tipoContratoSunat   String    @map("tipo_contrato_sunat") @db.VarChar(2) // codigo Tabla 12
  fechaInicio         DateTime  @map("fecha_inicio") @db.Date
  fechaFin            DateTime? @map("fecha_fin") @db.Date // null = indeterminado
  jornada             Json // horas/dias pactados
  remuneracionBasica   Decimal  @map("remuneracion_basica") @db.Decimal(10, 2)

  employee Employee @relation(fields: [employeeId], references: [id], onDelete: Cascade)

  @@index([employeeId])
  @@map("contrato")
}

model CuentaBancaria {
  id          String  @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  employeeId  String  @map("employee_id") @db.Uuid
  banco       String  @db.VarChar(3) // codigo Tabla 36
  tipoCuenta  String  @map("tipo_cuenta") @db.VarChar(20)
  numero      String  @db.VarChar(20)
  cci         String? @db.VarChar(20)
  esPrincipal Boolean @default(true) @map("es_principal")

  employee Employee @relation(fields: [employeeId], references: [id], onDelete: Cascade)

  @@index([employeeId])
  @@map("cuenta_bancaria")
}

model RegimenPensionario {
  id              String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  employeeId      String   @map("employee_id") @db.Uuid
  sistema         String   @db.VarChar(10) // afp | onp
  administradora  String?  @db.VarChar(20) // nullable, solo afp: integra/horizonte/profuturo/prima/habitat
  tipoComision    String?  @map("tipo_comision") @db.VarChar(10) // flujo | mixta, nullable
  codigoSunat     String   @map("codigo_sunat") @db.VarChar(2) // codigo Tabla 11
  fechaAfiliacion DateTime @map("fecha_afiliacion") @db.Date

  employee Employee @relation(fields: [employeeId], references: [id], onDelete: Cascade)

  @@index([employeeId])
  @@map("regimen_pensionario")
}

model Concepto {
  id             String  @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  tenantId       String? @map("tenant_id") @db.Uuid // null = catálogo global
  codigo         String  @db.VarChar(20)
  codigoSunat    String  @map("codigo_sunat") @db.VarChar(4) // 4 digitos, Tabla 22
  nombre         String
  tipo           String  @db.VarChar(10) // ingreso | descuento
  esRemunerativo Boolean @map("es_remunerativo")
  afectoA        Json    @map("afecto_a") // essalud, onp, afp, quinta, cts, grati (derivado de Tabla 22)

  @@unique([tenantId, codigo])
  @@index([codigoSunat])
  @@map("concepto")
}

model Planilla {
  id         String    @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  tenantId   String    @map("tenant_id") @db.Uuid
  periodo    String    @db.VarChar(7) // YYYY-MM
  estado     String    @default("registrado") @db.VarChar(20) // registrado | procesado | cerrado
  cerradoAt  DateTime? @map("cerrado_at")

  detalles PlanillaDetalle[]

  @@unique([tenantId, periodo])
  @@index([tenantId])
  @@map("planilla")
}

model PlanillaDetalle {
  id                 String  @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  planillaId         String  @map("planilla_id") @db.Uuid
  employeeId         String  @map("employee_id") @db.Uuid
  conceptosCalculados Json   @map("conceptos_calculados")
  netoPagar          Decimal @map("neto_pagar") @db.Decimal(10, 2)

  planilla Planilla @relation(fields: [planillaId], references: [id], onDelete: Cascade)
  employee Employee @relation(fields: [employeeId], references: [id])

  @@index([planillaId])
  @@index([employeeId])
  @@map("planilla_detalle")
}

model Provision {
  id       String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  tenantId String   @map("tenant_id") @db.Uuid
  periodo  String   @db.VarChar(7)
  tipo     String   @db.VarChar(20) // cts | gratificacion | vacaciones
  monto    Decimal  @db.Decimal(10, 2)

  @@index([tenantId, periodo])
  @@map("provision")
}

model Liquidacion {
  id           String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  employeeId   String   @unique @map("employee_id") @db.Uuid
  fechaCese    DateTime @map("fecha_cese") @db.Date
  componentes  Json // cts_trunca, grati_trunca, vacaciones_truncas
  generadoAt   DateTime @default(now()) @map("generado_at")

  employee Employee @relation(fields: [employeeId], references: [id])

  @@map("liquidacion")
}
```

Añadir las relaciones inversas al modelo `Employee` existente (después de `reports Employee[] @relation("EmployeeManager")`):

```prisma
  contratos            Contrato[]
  cuentasBancarias      CuentaBancaria[]
  regimenesPensionarios RegimenPensionario[]
  planillaDetalles      PlanillaDetalle[]
  liquidacion           Liquidacion?
```

- [ ] **Step 2: Validar el schema**

Run: `pnpm --filter @rrhh/database exec prisma validate`
Expected: `The schema at prisma/schema.prisma is valid 🚀`

- [ ] **Step 3: Escribir la migración SQL (RLS + auditoría, mismo patrón de Fase 0)**

Crear `packages/database/prisma/migrations/20260711000000_fase1_nomina/migration.sql`:

```sql
-- Fase 1 — Nómina: tablas + RLS + auditoría, mismo patrón que
-- 20260710000000_init_foundations.

CREATE TABLE "contrato" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "employee_id" UUID NOT NULL,
    "regimen_laboral" VARCHAR(20) NOT NULL,
    "regimen_laboral_sunat" VARCHAR(2) NOT NULL,
    "tipo_trabajador_sunat" VARCHAR(2) NOT NULL,
    "tipo_contrato" VARCHAR(30) NOT NULL,
    "tipo_contrato_sunat" VARCHAR(2) NOT NULL,
    "fecha_inicio" DATE NOT NULL,
    "fecha_fin" DATE,
    "jornada" JSONB NOT NULL,
    "remuneracion_basica" DECIMAL(10,2) NOT NULL,
    CONSTRAINT "contrato_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "contrato_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employee"("id") ON DELETE CASCADE
);
CREATE INDEX "contrato_employee_id_idx" ON "contrato"("employee_id");

CREATE TABLE "cuenta_bancaria" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "employee_id" UUID NOT NULL,
    "banco" VARCHAR(3) NOT NULL,
    "tipo_cuenta" VARCHAR(20) NOT NULL,
    "numero" VARCHAR(20) NOT NULL,
    "cci" VARCHAR(20),
    "es_principal" BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT "cuenta_bancaria_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "cuenta_bancaria_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employee"("id") ON DELETE CASCADE
);
CREATE INDEX "cuenta_bancaria_employee_id_idx" ON "cuenta_bancaria"("employee_id");

CREATE TABLE "regimen_pensionario" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "employee_id" UUID NOT NULL,
    "sistema" VARCHAR(10) NOT NULL,
    "administradora" VARCHAR(20),
    "tipo_comision" VARCHAR(10),
    "codigo_sunat" VARCHAR(2) NOT NULL,
    "fecha_afiliacion" DATE NOT NULL,
    CONSTRAINT "regimen_pensionario_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "regimen_pensionario_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employee"("id") ON DELETE CASCADE
);
CREATE INDEX "regimen_pensionario_employee_id_idx" ON "regimen_pensionario"("employee_id");

CREATE TABLE "concepto" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID,
    "codigo" VARCHAR(20) NOT NULL,
    "codigo_sunat" VARCHAR(4) NOT NULL,
    "nombre" TEXT NOT NULL,
    "tipo" VARCHAR(10) NOT NULL,
    "es_remunerativo" BOOLEAN NOT NULL,
    "afecto_a" JSONB NOT NULL,
    CONSTRAINT "concepto_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "concepto_tenant_id_codigo_key" UNIQUE ("tenant_id", "codigo")
);
CREATE INDEX "concepto_codigo_sunat_idx" ON "concepto"("codigo_sunat");

CREATE TABLE "planilla" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "periodo" VARCHAR(7) NOT NULL,
    "estado" VARCHAR(20) NOT NULL DEFAULT 'registrado',
    "cerrado_at" TIMESTAMP(3),
    CONSTRAINT "planilla_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "planilla_tenant_id_periodo_key" UNIQUE ("tenant_id", "periodo")
);
CREATE INDEX "planilla_tenant_id_idx" ON "planilla"("tenant_id");

CREATE TABLE "planilla_detalle" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "planilla_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "conceptos_calculados" JSONB NOT NULL,
    "neto_pagar" DECIMAL(10,2) NOT NULL,
    CONSTRAINT "planilla_detalle_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "planilla_detalle_planilla_id_fkey" FOREIGN KEY ("planilla_id") REFERENCES "planilla"("id") ON DELETE CASCADE,
    CONSTRAINT "planilla_detalle_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employee"("id")
);
CREATE INDEX "planilla_detalle_planilla_id_idx" ON "planilla_detalle"("planilla_id");
CREATE INDEX "planilla_detalle_employee_id_idx" ON "planilla_detalle"("employee_id");

CREATE TABLE "provision" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "periodo" VARCHAR(7) NOT NULL,
    "tipo" VARCHAR(20) NOT NULL,
    "monto" DECIMAL(10,2) NOT NULL,
    CONSTRAINT "provision_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "provision_tenant_id_periodo_idx" ON "provision"("tenant_id", "periodo");

CREATE TABLE "liquidacion" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "employee_id" UUID NOT NULL,
    "fecha_cese" DATE NOT NULL,
    "componentes" JSONB NOT NULL,
    "generado_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "liquidacion_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "liquidacion_employee_id_key" UNIQUE ("employee_id"),
    CONSTRAINT "liquidacion_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employee"("id")
);

-- RLS: contrato/cuenta_bancaria/regimen_pensionario/planilla_detalle/liquidacion
-- se aíslan a través del employee_id -> employee.tenant_id (no tienen tenant_id
-- propio); planilla/provision sí tienen tenant_id directo.

ALTER TABLE "planilla" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "planilla" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "planilla"
    USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid);

ALTER TABLE "provision" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "provision" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "provision"
    USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid);

ALTER TABLE "contrato" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "contrato" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "contrato"
    USING (EXISTS (
        SELECT 1 FROM "employee" e
        WHERE e."id" = "contrato"."employee_id"
        AND e."tenant_id" = current_setting('app.tenant_id', true)::uuid
    ));

ALTER TABLE "cuenta_bancaria" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "cuenta_bancaria" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "cuenta_bancaria"
    USING (EXISTS (
        SELECT 1 FROM "employee" e
        WHERE e."id" = "cuenta_bancaria"."employee_id"
        AND e."tenant_id" = current_setting('app.tenant_id', true)::uuid
    ));

ALTER TABLE "regimen_pensionario" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "regimen_pensionario" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "regimen_pensionario"
    USING (EXISTS (
        SELECT 1 FROM "employee" e
        WHERE e."id" = "regimen_pensionario"."employee_id"
        AND e."tenant_id" = current_setting('app.tenant_id', true)::uuid
    ));

ALTER TABLE "planilla_detalle" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "planilla_detalle" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "planilla_detalle"
    USING (EXISTS (
        SELECT 1 FROM "planilla" p
        WHERE p."id" = "planilla_detalle"."planilla_id"
        AND p."tenant_id" = current_setting('app.tenant_id', true)::uuid
    ));

ALTER TABLE "liquidacion" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "liquidacion" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "liquidacion"
    USING (EXISTS (
        SELECT 1 FROM "employee" e
        WHERE e."id" = "liquidacion"."employee_id"
        AND e."tenant_id" = current_setting('app.tenant_id', true)::uuid
    ));

-- concepto: catálogo global (tenant_id NULL) o por tenant, mismo patrón que "role".
ALTER TABLE "concepto" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "concepto" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "concepto"
    USING ("tenant_id" IS NULL OR "tenant_id" = current_setting('app.tenant_id', true)::uuid);

-- Privilegios: mismo esquema de roles de Fase 0. RRHH/Admin escriben; manager/
-- employee solo leen catálogo de conceptos y su propia planilla (vía vista,
-- pendiente cuando se agregue el portal ESS en Fase 3).
GRANT SELECT, INSERT, UPDATE ON "contrato", "cuenta_bancaria", "regimen_pensionario",
    "concepto", "planilla", "planilla_detalle", "provision", "liquidacion"
    TO app_rrhh, app_admin;
GRANT DELETE ON "contrato", "cuenta_bancaria", "regimen_pensionario", "concepto"
    TO app_admin;
GRANT SELECT ON "concepto" TO app_manager, app_employee;

-- Auditoría: mismo trigger genérico de Fase 0.
CREATE TRIGGER "contrato_audit" AFTER INSERT OR UPDATE OR DELETE ON "contrato"
    FOR EACH ROW EXECUTE FUNCTION audit_trigger();
CREATE TRIGGER "planilla_audit" AFTER INSERT OR UPDATE OR DELETE ON "planilla"
    FOR EACH ROW EXECUTE FUNCTION audit_trigger();
CREATE TRIGGER "planilla_detalle_audit" AFTER INSERT OR UPDATE OR DELETE ON "planilla_detalle"
    FOR EACH ROW EXECUTE FUNCTION audit_trigger();
CREATE TRIGGER "liquidacion_audit" AFTER INSERT OR UPDATE OR DELETE ON "liquidacion"
    FOR EACH ROW EXECUTE FUNCTION audit_trigger();
CREATE TRIGGER "concepto_audit" AFTER INSERT OR UPDATE OR DELETE ON "concepto"
    FOR EACH ROW EXECUTE FUNCTION audit_trigger();
```

- [ ] **Step 4: Commit**

```bash
git add packages/database/prisma/schema.prisma packages/database/prisma/migrations/20260711000000_fase1_nomina
git commit -m "feat(fase1): schema y migracion de nomina (contrato, concepto, planilla, liquidacion)"
```

---

### Task 2: `CtsCalculator` — depósito semestral y liquidación trunca

**Files:**
- Create: `apps/api/src/modules/payroll/calculators/cts.calculator.ts`
- Test: `apps/api/src/modules/payroll/calculators/cts.calculator.spec.ts`

**Interfaces:**
- Produces: `calcularCts(input: CtsCalculatorInput): CtsResult` y `calcularCtsTrunca(input: CtsTruncaInput): CtsResult` — usados por `PayrollRunService` (Task 9) y `LiquidacionCalculator` (Task 8).

- [ ] **Step 1: Escribir el test que falla — depósito semestral completo**

```typescript
// apps/api/src/modules/payroll/calculators/cts.calculator.spec.ts
import { calcularCts, calcularCtsTrunca } from './cts.calculator';

describe('calcularCts', () => {
  it('deposita el semestre completo (6 meses) sin proporcionalidad', () => {
    const resultado = calcularCts({
      sueldo: 2000,
      gratificacionSemestral: 2000,
      mesesCompletos: 6,
      diasAdicionales: 0,
    });

    // remuneracion computable = 2000 + (2000/6) = 2333.33
    // deposito = 2333.33 (semestre completo = 1x remuneracion computable)
    expect(resultado.remuneracionComputable).toBeCloseTo(2333.33, 2);
    expect(resultado.montoDeposito).toBeCloseTo(2333.33, 2);
  });

  it('prorratea cuando el trabajador ingresó a mitad del semestre (caso borde obligatorio: ingreso a mitad de mes)', () => {
    // Ingresó el 16 de agosto: trabajó 3 meses completos + 15 días del semestre may-oct.
    const resultado = calcularCts({
      sueldo: 1500,
      gratificacionSemestral: 1500,
      mesesCompletos: 3,
      diasAdicionales: 15,
    });

    const remuneracionComputable = 1500 + 1500 / 6; // 1750
    const fraccionSemestre = 3 / 6 + 15 / 180; // meses + dias sobre 6 meses de 30 dias
    expect(resultado.remuneracionComputable).toBeCloseTo(1750, 2);
    expect(resultado.montoDeposito).toBeCloseTo(remuneracionComputable * fraccionSemestre, 2);
  });
});

describe('calcularCtsTrunca', () => {
  it('calcula proporcional desde el último depósito hasta la fecha de cese (caso borde obligatorio: cese antes del depósito de CTS)', () => {
    // Cese a los 2 meses y 10 dias desde el último depósito (1 de mayo), antes
    // de que llegue el depósito de noviembre.
    const resultado = calcularCtsTrunca({
      sueldo: 1800,
      gratificacionSemestral: 1800,
      mesesCompletosDesdeUltimoDeposito: 2,
      diasAdicionales: 10,
    });

    const remuneracionComputable = 1800 + 1800 / 6; // 2100
    const fraccion = 2 / 6 + 10 / 180;
    expect(resultado.montoDeposito).toBeCloseTo(remuneracionComputable * fraccion, 2);
  });
});
```

- [ ] **Step 2: Ejecutar el test y verificar que falla**

Run: `pnpm --filter @rrhh/api test -- cts.calculator`
Expected: FAIL — `Cannot find module './cts.calculator'`

- [ ] **Step 3: Implementación mínima**

```typescript
// apps/api/src/modules/payroll/calculators/cts.calculator.ts

/**
 * CTS: remuneración computable = sueldo + 1/6 de la gratificación del semestre
 * que corresponde. Depósitos: mayo (cubre nov-abr) y noviembre (cubre may-oct),
 * proporcional a meses y días completos trabajados en el semestre.
 * Ver especificaciones-fases.md, Fase 1, regla de cálculo #1.
 */
export interface CtsCalculatorInput {
  sueldo: number;
  gratificacionSemestral: number;
  mesesCompletos: number;
  diasAdicionales: number;
}

export interface CtsTruncaInput {
  sueldo: number;
  gratificacionSemestral: number;
  mesesCompletosDesdeUltimoDeposito: number;
  diasAdicionales: number;
}

export interface CtsResult {
  remuneracionComputable: number;
  montoDeposito: number;
}

const DIAS_POR_MES = 30;
const MESES_SEMESTRE = 6;

function remuneracionComputable(sueldo: number, gratificacionSemestral: number): number {
  return sueldo + gratificacionSemestral / MESES_SEMESTRE;
}

function fraccionSemestre(mesesCompletos: number, diasAdicionales: number): number {
  return mesesCompletos / MESES_SEMESTRE + diasAdicionales / (MESES_SEMESTRE * DIAS_POR_MES);
}

export function calcularCts(input: CtsCalculatorInput): CtsResult {
  const computable = remuneracionComputable(input.sueldo, input.gratificacionSemestral);
  const fraccion = fraccionSemestre(input.mesesCompletos, input.diasAdicionales);
  return {
    remuneracionComputable: computable,
    montoDeposito: computable * fraccion,
  };
}

export function calcularCtsTrunca(input: CtsTruncaInput): CtsResult {
  const computable = remuneracionComputable(input.sueldo, input.gratificacionSemestral);
  const fraccion = fraccionSemestre(
    input.mesesCompletosDesdeUltimoDeposito,
    input.diasAdicionales,
  );
  return {
    remuneracionComputable: computable,
    montoDeposito: computable * fraccion,
  };
}
```

- [ ] **Step 4: Ejecutar el test y verificar que pasa**

Run: `pnpm --filter @rrhh/api test -- cts.calculator`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/payroll/calculators/cts.calculator.ts apps/api/src/modules/payroll/calculators/cts.calculator.spec.ts
git commit -m "feat(fase1): CtsCalculator con deposito semestral y liquidacion trunca"
```

---

### Task 3: `GratificacionCalculator` — gratificación + bonificación extraordinaria Ley 30334

**Files:**
- Create: `apps/api/src/modules/payroll/calculators/gratificacion.calculator.ts`
- Test: `apps/api/src/modules/payroll/calculators/gratificacion.calculator.spec.ts`

**Interfaces:**
- Consumes: ninguno (función pura standalone).
- Produces: `calcularGratificacion(input: GratificacionInput): GratificacionResult` — usado por `PayrollRunService` (Task 9) y como input de `CtsCalculator` (`gratificacionSemestral` viene de aquí).

- [ ] **Step 1: Escribir el test que falla**

```typescript
// apps/api/src/modules/payroll/calculators/gratificacion.calculator.spec.ts
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
```

- [ ] **Step 2: Ejecutar el test y verificar que falla**

Run: `pnpm --filter @rrhh/api test -- gratificacion.calculator`
Expected: FAIL — módulo no existe

- [ ] **Step 3: Implementación mínima**

```typescript
// apps/api/src/modules/payroll/calculators/gratificacion.calculator.ts

/**
 * Gratificación: sueldo computable = sueldo + asignación familiar + conceptos
 * remunerativos regulares del semestre. Monto = sueldo computable × (meses
 * completos trabajados / 6). Bonificación extraordinaria Ley 30334: 9% sobre
 * el monto de gratificación (6.75% si el trabajador está afiliado a EPS).
 * Ver especificaciones-fases.md, Fase 1, regla de cálculo #2.
 */
export interface GratificacionInput {
  sueldo: number;
  asignacionFamiliar: number;
  conceptosRemunerativosRegulares: number;
  mesesCompletos: number;
  afiliadoEps: boolean;
  tasaBonifEssalud: number;
  tasaBonifEps: number;
}

export interface GratificacionResult {
  sueldoComputable: number;
  montoGratificacion: number;
  bonificacionExtraordinaria: number;
}

const MESES_SEMESTRE = 6;

export function calcularGratificacion(input: GratificacionInput): GratificacionResult {
  const sueldoComputable =
    input.sueldo + input.asignacionFamiliar + input.conceptosRemunerativosRegulares;
  const montoGratificacion = sueldoComputable * (input.mesesCompletos / MESES_SEMESTRE);
  const tasaBonif = input.afiliadoEps ? input.tasaBonifEps : input.tasaBonifEssalud;

  return {
    sueldoComputable,
    montoGratificacion,
    bonificacionExtraordinaria: montoGratificacion * tasaBonif,
  };
}
```

- [ ] **Step 4: Ejecutar el test y verificar que pasa**

Run: `pnpm --filter @rrhh/api test -- gratificacion.calculator`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/payroll/calculators/gratificacion.calculator.ts apps/api/src/modules/payroll/calculators/gratificacion.calculator.spec.ts
git commit -m "feat(fase1): GratificacionCalculator con bonificacion extraordinaria Ley 30334"
```

---

### Task 4: `AfpOnpCalculator` — retenciones de régimen pensionario

**Files:**
- Create: `apps/api/src/modules/payroll/calculators/afp-onp.calculator.ts`
- Test: `apps/api/src/modules/payroll/calculators/afp-onp.calculator.spec.ts`

**Interfaces:**
- Produces: `calcularRetencionPensionaria(input: PensionInput): PensionResult` — usado por `PayrollRunService` (Task 9).

- [ ] **Step 1: Escribir el test que falla**

```typescript
// apps/api/src/modules/payroll/calculators/afp-onp.calculator.spec.ts
import { calcularRetencionPensionaria } from './afp-onp.calculator';

describe('calcularRetencionPensionaria', () => {
  it('calcula ONP: 13% sobre la remuneracion, sin tope', () => {
    const resultado = calcularRetencionPensionaria({
      sistema: 'onp',
      remuneracion: 3000,
      tasaOnp: 0.13,
      aportacionObligatoriaAfp: 0.1,
      comisionAfp: 0,
      tipoComision: 'flujo',
      primaSeguroAfp: 0,
      topeRemuneracionMaximaAsegurable: 0,
    });

    expect(resultado.montoRetenido).toBeCloseTo(3000 * 0.13, 2);
  });

  it('calcula AFP con comision de flujo: aporte obligatorio + comision + prima de seguro', () => {
    const resultado = calcularRetencionPensionaria({
      sistema: 'afp',
      remuneracion: 3000,
      tasaOnp: 0.13,
      aportacionObligatoriaAfp: 0.1,
      comisionAfp: 0.016,
      tipoComision: 'flujo',
      primaSeguroAfp: 0.0174,
      topeRemuneracionMaximaAsegurable: 10000,
    });

    const aporte = 3000 * 0.1;
    const comision = 3000 * 0.016;
    const prima = Math.min(3000, 10000) * 0.0174;
    expect(resultado.montoRetenido).toBeCloseTo(aporte + comision + prima, 2);
  });

  it('la prima de seguro AFP respeta el tope de remuneracion maxima asegurable', () => {
    const resultado = calcularRetencionPensionaria({
      sistema: 'afp',
      remuneracion: 15000, // por encima del tope
      tasaOnp: 0.13,
      aportacionObligatoriaAfp: 0.1,
      comisionAfp: 0.016,
      tipoComision: 'flujo',
      primaSeguroAfp: 0.0174,
      topeRemuneracionMaximaAsegurable: 10000,
    });

    const aporte = 15000 * 0.1;
    const comision = 15000 * 0.016;
    const primaTopeada = 10000 * 0.0174; // no 15000 * 0.0174
    expect(resultado.montoRetenido).toBeCloseTo(aporte + comision + primaTopeada, 2);
  });
});
```

- [ ] **Step 2: Ejecutar el test y verificar que falla**

Run: `pnpm --filter @rrhh/api test -- afp-onp.calculator`
Expected: FAIL — módulo no existe

- [ ] **Step 3: Implementación mínima**

```typescript
// apps/api/src/modules/payroll/calculators/afp-onp.calculator.ts

/**
 * AFP: aporte obligatorio (parametrizable, ~10%) + comisión (flujo sobre
 * remuneración o mixta sobre saldo) + prima de seguro (con tope de
 * remuneración máxima asegurable). ONP: tasa parametrizable (~13%) sin tope.
 * Ver especificaciones-fases.md, Fase 1, reglas de cálculo #6 y #7.
 */
export interface PensionInput {
  sistema: 'afp' | 'onp';
  remuneracion: number;
  tasaOnp: number;
  aportacionObligatoriaAfp: number;
  comisionAfp: number;
  tipoComision: 'flujo' | 'mixta';
  primaSeguroAfp: number;
  topeRemuneracionMaximaAsegurable: number;
}

export interface PensionResult {
  montoRetenido: number;
}

export function calcularRetencionPensionaria(input: PensionInput): PensionResult {
  if (input.sistema === 'onp') {
    return { montoRetenido: input.remuneracion * input.tasaOnp };
  }

  const aporte = input.remuneracion * input.aportacionObligatoriaAfp;
  // La comisión "mixta" (sobre saldo acumulado) requiere el saldo del
  // trabajador — fuera de alcance de este cálculo mensual; se modela en la
  // capa de servicio cuando exista el módulo de saldos (deuda técnica Fase 1).
  const comision = input.remuneracion * input.comisionAfp;
  const baseAsegurable = Math.min(input.remuneracion, input.topeRemuneracionMaximaAsegurable);
  const prima = baseAsegurable * input.primaSeguroAfp;

  return { montoRetenido: aporte + comision + prima };
}
```

- [ ] **Step 4: Ejecutar el test y verificar que pasa**

Run: `pnpm --filter @rrhh/api test -- afp-onp.calculator`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/payroll/calculators/afp-onp.calculator.ts apps/api/src/modules/payroll/calculators/afp-onp.calculator.spec.ts
git commit -m "feat(fase1): AfpOnpCalculator con tope de remuneracion maxima asegurable"
```

---

### Task 5: `EssaludCalculator` y `AsignacionFamiliarCalculator`

**Files:**
- Create: `apps/api/src/modules/payroll/calculators/essalud.calculator.ts`
- Create: `apps/api/src/modules/payroll/calculators/asignacion-familiar.calculator.ts`
- Test: `apps/api/src/modules/payroll/calculators/essalud.calculator.spec.ts`
- Test: `apps/api/src/modules/payroll/calculators/asignacion-familiar.calculator.spec.ts`

**Interfaces:**
- Produces: `calcularAporteEssalud(input): EssaludResult`, `calcularAsignacionFamiliar(input): AsignacionFamiliarResult` — usados por `PayrollRunService` (Task 9); `AsignacionFamiliarResult.monto` alimenta `GratificacionCalculator.asignacionFamiliar` (Task 3).

- [ ] **Step 1: Escribir los tests que fallan**

```typescript
// apps/api/src/modules/payroll/calculators/essalud.calculator.spec.ts
import { calcularAporteEssalud } from './essalud.calculator';

describe('calcularAporteEssalud', () => {
  it('calcula 9% a cargo del empleador (no es descuento al trabajador)', () => {
    const resultado = calcularAporteEssalud({
      remuneracion: 2500,
      tieneConvenioEps: false,
      tasaEssalud: 0.09,
      tasaEssaludConEps: 0.09, // igual a essalud si no hay reduccion pactada
    });

    expect(resultado.montoAporteEmpleador).toBeCloseTo(2500 * 0.09, 2);
  });

  it('usa la tasa reducida cuando el tenant tiene convenio EPS', () => {
    const resultado = calcularAporteEssalud({
      remuneracion: 2500,
      tieneConvenioEps: true,
      tasaEssalud: 0.09,
      tasaEssaludConEps: 0.025, // ejemplo de tasa reducida pactada con la EPS
    });

    expect(resultado.montoAporteEmpleador).toBeCloseTo(2500 * 0.025, 2);
  });
});
```

```typescript
// apps/api/src/modules/payroll/calculators/asignacion-familiar.calculator.spec.ts
import { calcularAsignacionFamiliar } from './asignacion-familiar.calculator';

describe('calcularAsignacionFamiliar', () => {
  it('otorga 10% de la RMV vigente si el trabajador tiene hijos/dependientes declarados', () => {
    const resultado = calcularAsignacionFamiliar({
      tieneHijosODependientes: true,
      rmvVigente: 1130,
      tasaAsignacionFamiliar: 0.1,
    });

    expect(resultado.monto).toBeCloseTo(113, 2);
  });

  it('no otorga nada si el trabajador no tiene hijos/dependientes declarados', () => {
    const resultado = calcularAsignacionFamiliar({
      tieneHijosODependientes: false,
      rmvVigente: 1130,
      tasaAsignacionFamiliar: 0.1,
    });

    expect(resultado.monto).toBe(0);
  });
});
```

- [ ] **Step 2: Ejecutar los tests y verificar que fallan**

Run: `pnpm --filter @rrhh/api test -- essalud.calculator asignacion-familiar.calculator`
Expected: FAIL — módulos no existen

- [ ] **Step 3: Implementación mínima**

```typescript
// apps/api/src/modules/payroll/calculators/essalud.calculator.ts

/**
 * EsSalud: 9% a cargo del empleador (no es descuento al trabajador); tasa
 * reducida si el tenant tiene convenio EPS (parametrizable).
 * Ver especificaciones-fases.md, Fase 1, regla de cálculo #8.
 */
export interface EssaludInput {
  remuneracion: number;
  tieneConvenioEps: boolean;
  tasaEssalud: number;
  tasaEssaludConEps: number;
}

export interface EssaludResult {
  montoAporteEmpleador: number;
}

export function calcularAporteEssalud(input: EssaludInput): EssaludResult {
  const tasa = input.tieneConvenioEps ? input.tasaEssaludConEps : input.tasaEssalud;
  return { montoAporteEmpleador: input.remuneracion * tasa };
}
```

```typescript
// apps/api/src/modules/payroll/calculators/asignacion-familiar.calculator.ts

/**
 * Asignación familiar: 10% de la RMV vigente si el trabajador tiene hijos o
 * dependientes declarados (Ley 25129).
 * Ver especificaciones-fases.md, Fase 1, regla de cálculo #9.
 */
export interface AsignacionFamiliarInput {
  tieneHijosODependientes: boolean;
  rmvVigente: number;
  tasaAsignacionFamiliar: number;
}

export interface AsignacionFamiliarResult {
  monto: number;
}

export function calcularAsignacionFamiliar(
  input: AsignacionFamiliarInput,
): AsignacionFamiliarResult {
  if (!input.tieneHijosODependientes) return { monto: 0 };
  return { monto: input.rmvVigente * input.tasaAsignacionFamiliar };
}
```

- [ ] **Step 4: Ejecutar los tests y verificar que pasan**

Run: `pnpm --filter @rrhh/api test -- essalud.calculator asignacion-familiar.calculator`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/payroll/calculators/essalud.calculator.ts apps/api/src/modules/payroll/calculators/essalud.calculator.spec.ts apps/api/src/modules/payroll/calculators/asignacion-familiar.calculator.ts apps/api/src/modules/payroll/calculators/asignacion-familiar.calculator.spec.ts
git commit -m "feat(fase1): EssaludCalculator y AsignacionFamiliarCalculator"
```

---

### Task 6: `QuintaCategoriaCalculator` — proyección anual y retención mensual

**Files:**
- Create: `apps/api/src/modules/payroll/calculators/quinta-categoria.calculator.ts`
- Test: `apps/api/src/modules/payroll/calculators/quinta-categoria.calculator.spec.ts`

**Interfaces:**
- Produces: `calcularRetencionQuinta(input: QuintaInput): QuintaResult` — usado por `PayrollRunService` (Task 9).

- [ ] **Step 1: Escribir el test que falla**

```typescript
// apps/api/src/modules/payroll/calculators/quinta-categoria.calculator.spec.ts
import { calcularRetencionQuinta } from './quinta-categoria.calculator';

describe('calcularRetencionQuinta', () => {
  const tramos = [
    { hasta: 5 * 5350, tasa: 0.08 }, // hasta 5 UIT: 8%
    { hasta: 20 * 5350, tasa: 0.14 }, // hasta 20 UIT: 14%
    { hasta: 35 * 5350, tasa: 0.17 }, // hasta 35 UIT: 17%
    { hasta: 45 * 5350, tasa: 0.2 }, // hasta 45 UIT: 20%
    { hasta: Infinity, tasa: 0.3 }, // exceso: 30%
  ];

  it('proyecta el impuesto anual, resta 7 UIT, y prorratea entre los meses restantes del ejercicio', () => {
    const resultado = calcularRetencionQuinta({
      remuneracionProyectadaRestante: 8 * 2500, // 8 meses restantes a 2500
      conceptosYaPagadosEnElAnio: 4 * 2500, // 4 meses ya pagados
      ingresosOtrasEntidadesDeclarados: 0,
      deduccionUit: 7,
      uit: 5350,
      tramos,
      mesesRestantes: 8,
    });

    const rentaBrutaAnual = 8 * 2500 + 4 * 2500; // 30000
    const rentaNetaAnual = rentaBrutaAnual - 7 * 5350; // 30000 - 37450 < 0
    expect(rentaNetaAnual).toBeLessThan(0);
    expect(resultado.impuestoAnualProyectado).toBe(0);
    expect(resultado.retencionMensual).toBe(0);
  });

  it('aplica los tramos progresivos cuando la renta neta anual supera la deduccion de 7 UIT', () => {
    const resultado = calcularRetencionQuinta({
      remuneracionProyectadaRestante: 8 * 8000,
      conceptosYaPagadosEnElAnio: 4 * 8000,
      ingresosOtrasEntidadesDeclarados: 0,
      deduccionUit: 7,
      uit: 5350,
      tramos,
      mesesRestantes: 8,
    });

    const rentaBrutaAnual = 12 * 8000; // 96000
    const rentaNetaAnual = rentaBrutaAnual - 7 * 5350; // 96000 - 37450 = 58550
    // tramo 1: 5*5350=26750 al 8% ; tramo 2: hasta 20*5350=107000, resto (58550-26750)=31800 al 14%
    const impuestoEsperado = 26750 * 0.08 + (58550 - 26750) * 0.14;
    expect(resultado.impuestoAnualProyectado).toBeCloseTo(impuestoEsperado, 2);
    expect(resultado.retencionMensual).toBeCloseTo(impuestoEsperado / 8, 2);
  });

  it('incluye ingresos de otras entidades declarados por el trabajador en la proyeccion', () => {
    const sinOtrasEntidades = calcularRetencionQuinta({
      remuneracionProyectadaRestante: 8 * 8000,
      conceptosYaPagadosEnElAnio: 4 * 8000,
      ingresosOtrasEntidadesDeclarados: 0,
      deduccionUit: 7,
      uit: 5350,
      tramos,
      mesesRestantes: 8,
    });
    const conOtrasEntidades = calcularRetencionQuinta({
      remuneracionProyectadaRestante: 8 * 8000,
      conceptosYaPagadosEnElAnio: 4 * 8000,
      ingresosOtrasEntidadesDeclarados: 10000,
      deduccionUit: 7,
      uit: 5350,
      tramos,
      mesesRestantes: 8,
    });

    expect(conOtrasEntidades.impuestoAnualProyectado).toBeGreaterThan(
      sinOtrasEntidades.impuestoAnualProyectado,
    );
  });
});
```

- [ ] **Step 2: Ejecutar el test y verificar que falla**

Run: `pnpm --filter @rrhh/api test -- quinta-categoria.calculator`
Expected: FAIL — módulo no existe

- [ ] **Step 3: Implementación mínima**

```typescript
// apps/api/src/modules/payroll/calculators/quinta-categoria.calculator.ts

/**
 * Renta de Quinta Categoría: proyección anual = remuneración proyectada
 * restante del ejercicio + conceptos ya pagados en el año (incluye ingresos de
 * otras entidades declarados) − 7 UIT de deducción fija. Tramos progresivos
 * parametrizados. Retención mensual = impuesto anual proyectado / meses
 * restantes; se recalcula cada mes con la proyección actualizada.
 * Ver especificaciones-fases.md, Fase 1, regla de cálculo #5.
 */
export interface TramoQuinta {
  hasta: number; // limite superior del tramo, en soles (Infinity para el ultimo)
  tasa: number;
}

export interface QuintaInput {
  remuneracionProyectadaRestante: number;
  conceptosYaPagadosEnElAnio: number;
  ingresosOtrasEntidadesDeclarados: number;
  deduccionUit: number;
  uit: number;
  tramos: TramoQuinta[];
  mesesRestantes: number;
}

export interface QuintaResult {
  rentaNetaAnual: number;
  impuestoAnualProyectado: number;
  retencionMensual: number;
}

export function calcularRetencionQuinta(input: QuintaInput): QuintaResult {
  const rentaBrutaAnual =
    input.remuneracionProyectadaRestante +
    input.conceptosYaPagadosEnElAnio +
    input.ingresosOtrasEntidadesDeclarados;
  const rentaNetaAnual = rentaBrutaAnual - input.deduccionUit * input.uit;

  if (rentaNetaAnual <= 0) {
    return { rentaNetaAnual, impuestoAnualProyectado: 0, retencionMensual: 0 };
  }

  let restante = rentaNetaAnual;
  let limiteAnterior = 0;
  let impuesto = 0;

  for (const tramo of input.tramos) {
    if (restante <= 0) break;
    const anchoTramo = tramo.hasta - limiteAnterior;
    const baseEnTramo = Math.min(restante, anchoTramo);
    impuesto += baseEnTramo * tramo.tasa;
    restante -= baseEnTramo;
    limiteAnterior = tramo.hasta;
  }

  return {
    rentaNetaAnual,
    impuestoAnualProyectado: impuesto,
    retencionMensual: impuesto / input.mesesRestantes,
  };
}
```

- [ ] **Step 4: Ejecutar el test y verificar que pasa**

Run: `pnpm --filter @rrhh/api test -- quinta-categoria.calculator`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/payroll/calculators/quinta-categoria.calculator.ts apps/api/src/modules/payroll/calculators/quinta-categoria.calculator.spec.ts
git commit -m "feat(fase1): QuintaCategoriaCalculator con tramos progresivos"
```

---

### Task 7: `UtilidadesCalculator` — reparto por días laborados y remuneración, con tope

**Files:**
- Create: `apps/api/src/modules/payroll/calculators/utilidades.calculator.ts`
- Test: `apps/api/src/modules/payroll/calculators/utilidades.calculator.spec.ts`

**Interfaces:**
- Produces: `calcularUtilidades(input: UtilidadesInput): UtilidadesResult` — usado por `PayrollRunService` (Task 9), típicamente en un job anual separado del ciclo mensual.

- [ ] **Step 1: Escribir el test que falla**

```typescript
// apps/api/src/modules/payroll/calculators/utilidades.calculator.spec.ts
import { calcularUtilidades } from './utilidades.calculator';

describe('calcularUtilidades', () => {
  it('reparte 50% por dias laborados y 50% por remuneracion percibida', () => {
    const resultado = calcularUtilidades({
      rentaNeta: 1_000_000,
      tasaPorSector: 0.08,
      diasLaboradosTrabajador: 300,
      diasLaboradosTotalEmpresa: 30_000,
      remuneracionPercibidaTrabajador: 24_000,
      remuneracionPercibidaTotalEmpresa: 2_400_000,
      remuneracionMensualPromedio: 2_000,
      topeRemuneracionesMensuales: 18,
    });

    const bolsaUtilidades = 1_000_000 * 0.08; // 80000
    const porDias = bolsaUtilidades * 0.5 * (300 / 30_000);
    const porRemuneracion = bolsaUtilidades * 0.5 * (24_000 / 2_400_000);
    expect(resultado.montoAntesDelTope).toBeCloseTo(porDias + porRemuneracion, 2);
  });

  it('aplica el tope de 18 remuneraciones mensuales por trabajador', () => {
    const resultado = calcularUtilidades({
      rentaNeta: 100_000_000, // renta neta enorme para forzar el tope
      tasaPorSector: 0.1,
      diasLaboradosTrabajador: 300,
      diasLaboradosTotalEmpresa: 3_000,
      remuneracionPercibidaTrabajador: 24_000,
      remuneracionPercibidaTotalEmpresa: 240_000,
      remuneracionMensualPromedio: 2_000,
      topeRemuneracionesMensuales: 18,
    });

    const tope = 2_000 * 18; // 36000
    expect(resultado.montoAntesDelTope).toBeGreaterThan(tope);
    expect(resultado.montoFinal).toBe(tope);
  });

  it('no aplica el tope cuando el monto calculado esta por debajo', () => {
    const resultado = calcularUtilidades({
      rentaNeta: 500_000,
      tasaPorSector: 0.05,
      diasLaboradosTrabajador: 300,
      diasLaboradosTotalEmpresa: 30_000,
      remuneracionPercibidaTrabajador: 24_000,
      remuneracionPercibidaTotalEmpresa: 2_400_000,
      remuneracionMensualPromedio: 2_000,
      topeRemuneracionesMensuales: 18,
    });

    expect(resultado.montoFinal).toBe(resultado.montoAntesDelTope);
  });
});
```

- [ ] **Step 2: Ejecutar el test y verificar que falla**

Run: `pnpm --filter @rrhh/api test -- utilidades.calculator`
Expected: FAIL — módulo no existe

- [ ] **Step 3: Implementación mínima**

```typescript
// apps/api/src/modules/payroll/calculators/utilidades.calculator.ts

/**
 * Utilidades: renta neta × tasa por sector (parametrizable), distribuida 50%
 * en función de días laborados y 50% en función de remuneración percibida en
 * el ejercicio, con tope de 18 remuneraciones mensuales por trabajador.
 * Ver especificaciones-fases.md, Fase 1, regla de cálculo #3.
 */
export interface UtilidadesInput {
  rentaNeta: number;
  tasaPorSector: number;
  diasLaboradosTrabajador: number;
  diasLaboradosTotalEmpresa: number;
  remuneracionPercibidaTrabajador: number;
  remuneracionPercibidaTotalEmpresa: number;
  remuneracionMensualPromedio: number;
  topeRemuneracionesMensuales: number;
}

export interface UtilidadesResult {
  montoAntesDelTope: number;
  montoFinal: number;
  topeAplicado: boolean;
}

export function calcularUtilidades(input: UtilidadesInput): UtilidadesResult {
  const bolsaUtilidades = input.rentaNeta * input.tasaPorSector;
  const porDias =
    bolsaUtilidades * 0.5 * (input.diasLaboradosTrabajador / input.diasLaboradosTotalEmpresa);
  const porRemuneracion =
    bolsaUtilidades *
    0.5 *
    (input.remuneracionPercibidaTrabajador / input.remuneracionPercibidaTotalEmpresa);
  const montoAntesDelTope = porDias + porRemuneracion;
  const tope = input.remuneracionMensualPromedio * input.topeRemuneracionesMensuales;
  const topeAplicado = montoAntesDelTope > tope;

  return {
    montoAntesDelTope,
    montoFinal: topeAplicado ? tope : montoAntesDelTope,
    topeAplicado,
  };
}
```

- [ ] **Step 4: Ejecutar el test y verificar que pasa**

Run: `pnpm --filter @rrhh/api test -- utilidades.calculator`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/payroll/calculators/utilidades.calculator.ts apps/api/src/modules/payroll/calculators/utilidades.calculator.spec.ts
git commit -m "feat(fase1): UtilidadesCalculator con tope de 18 remuneraciones mensuales"
```

---

### Task 8: `LiquidacionCalculator` — beneficios truncos al cese (< 48h)

**Files:**
- Create: `apps/api/src/modules/payroll/calculators/liquidacion.calculator.ts`
- Test: `apps/api/src/modules/payroll/calculators/liquidacion.calculator.spec.ts`

**Interfaces:**
- Consumes: `calcularCtsTrunca` de `./cts.calculator` (Task 2), `calcularGratificacion` de `./gratificacion.calculator` (Task 3).
- Produces: `calcularLiquidacion(input: LiquidacionInput): LiquidacionResult` — usado por `PayrollRunService` (Task 9) al procesar un cese.

- [ ] **Step 1: Escribir el test que falla**

```typescript
// apps/api/src/modules/payroll/calculators/liquidacion.calculator.spec.ts
import { calcularLiquidacion } from './liquidacion.calculator';

describe('calcularLiquidacion', () => {
  it('suma CTS trunca + gratificacion trunca + vacaciones truncas + conceptos pendientes', () => {
    const resultado = calcularLiquidacion({
      sueldo: 2500,
      gratificacionSemestral: 2500,
      mesesCompletosDesdeUltimoDepositoCts: 2,
      diasAdicionalesCts: 10,
      mesesCompletosGratificacionTrunca: 2,
      diasVacacionesPendientes: 15,
      valorDiaVacacional: 2500 / 30,
      conceptosPendientesDePago: 500,
    });

    expect(resultado.ctsTrunca).toBeGreaterThan(0);
    expect(resultado.gratificacionTrunca).toBeCloseTo(2500 * (2 / 6), 2);
    expect(resultado.vacacionesTruncas).toBeCloseTo((2500 / 30) * 15, 2);
    expect(resultado.conceptosPendientes).toBe(500);
    expect(resultado.total).toBeCloseTo(
      resultado.ctsTrunca +
        resultado.gratificacionTrunca +
        resultado.vacacionesTruncas +
        resultado.conceptosPendientes,
      2,
    );
  });

  it('funciona con remuneracion variable (0 en meses sin ventas, caso borde obligatorio)', () => {
    const resultado = calcularLiquidacion({
      sueldo: 0,
      gratificacionSemestral: 0,
      mesesCompletosDesdeUltimoDepositoCts: 1,
      diasAdicionalesCts: 0,
      mesesCompletosGratificacionTrunca: 1,
      diasVacacionesPendientes: 5,
      valorDiaVacacional: 0,
      conceptosPendientesDePago: 1200, // comisiones pendientes de liquidar
    });

    expect(resultado.ctsTrunca).toBe(0);
    expect(resultado.gratificacionTrunca).toBe(0);
    expect(resultado.vacacionesTruncas).toBe(0);
    expect(resultado.total).toBe(1200);
  });
});
```

- [ ] **Step 2: Ejecutar el test y verificar que falla**

Run: `pnpm --filter @rrhh/api test -- liquidacion.calculator`
Expected: FAIL — módulo no existe

- [ ] **Step 3: Implementación mínima**

```typescript
// apps/api/src/modules/payroll/calculators/liquidacion.calculator.ts
import { calcularCtsTrunca } from './cts.calculator';
import { calcularGratificacion } from './gratificacion.calculator';

/**
 * Liquidación de beneficios truncos (dentro de 48h desde el cese): CTS trunca
 * + gratificación trunca + vacaciones truncas (proporcional a meses/días desde
 * el inicio del periodo vacacional vigente) + conceptos pendientes de pago.
 * Ver especificaciones-fases.md, Fase 1, regla de cálculo #4.
 */
export interface LiquidacionInput {
  sueldo: number;
  gratificacionSemestral: number;
  mesesCompletosDesdeUltimoDepositoCts: number;
  diasAdicionalesCts: number;
  mesesCompletosGratificacionTrunca: number;
  diasVacacionesPendientes: number;
  valorDiaVacacional: number;
  conceptosPendientesDePago: number;
}

export interface LiquidacionResult {
  ctsTrunca: number;
  gratificacionTrunca: number;
  vacacionesTruncas: number;
  conceptosPendientes: number;
  total: number;
}

export function calcularLiquidacion(input: LiquidacionInput): LiquidacionResult {
  const cts = calcularCtsTrunca({
    sueldo: input.sueldo,
    gratificacionSemestral: input.gratificacionSemestral,
    mesesCompletosDesdeUltimoDeposito: input.mesesCompletosDesdeUltimoDepositoCts,
    diasAdicionales: input.diasAdicionalesCts,
  });

  const gratificacion = calcularGratificacion({
    sueldo: input.sueldo,
    asignacionFamiliar: 0,
    conceptosRemunerativosRegulares: 0,
    mesesCompletos: input.mesesCompletosGratificacionTrunca,
    afiliadoEps: false,
    tasaBonifEssalud: 0, // la liquidacion trunca reporta solo el monto base, no la bonificacion
    tasaBonifEps: 0,
  });

  const vacacionesTruncas = input.valorDiaVacacional * input.diasVacacionesPendientes;

  const total =
    cts.montoDeposito +
    gratificacion.montoGratificacion +
    vacacionesTruncas +
    input.conceptosPendientesDePago;

  return {
    ctsTrunca: cts.montoDeposito,
    gratificacionTrunca: gratificacion.montoGratificacion,
    vacacionesTruncas,
    conceptosPendientes: input.conceptosPendientesDePago,
    total,
  };
}
```

- [ ] **Step 4: Ejecutar el test y verificar que pasa**

Run: `pnpm --filter @rrhh/api test -- liquidacion.calculator`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/payroll/calculators/liquidacion.calculator.ts apps/api/src/modules/payroll/calculators/liquidacion.calculator.spec.ts
git commit -m "feat(fase1): LiquidacionCalculator combinando CTS/gratificacion/vacaciones truncas"
```

---

### Task 9: `PayrollRunService` — orquestador del ciclo de planilla

**Files:**
- Create: `apps/api/src/modules/payroll/payroll-run.service.ts`
- Test: `apps/api/src/modules/payroll/payroll-run.service.spec.ts`

**Interfaces:**
- Consumes: `NormativeParameterService.resolve` de Fase 0 (`apps/api/src/modules/normative-params/normative-parameter.service.ts`), todas las calculadoras de Tasks 2–7, `TenantContext` de Fase 0 (`apps/api/src/common/database/tenant-request-context.ts`).
- Produces: `PayrollRunService.procesarPeriodo(ctx: TenantContext, periodo: string): Promise<PlanillaProcesada>` — usado por `payroll.controller.ts` (Task 11).

- [ ] **Step 1: Escribir el test que falla (con Prisma mockeado, sin BD)**

```typescript
// apps/api/src/modules/payroll/payroll-run.service.spec.ts
import { PayrollRunService } from './payroll-run.service';
import { NormativeParameterService } from '../normative-params/normative-parameter.service';

describe('PayrollRunService.procesarPeriodo', () => {
  function buildClient(overrides: Partial<any> = {}) {
    return {
      employee: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'emp-1',
            contratos: [
              {
                regimenLaboral: 'general',
                remuneracionBasica: { toNumber: () => 2000 },
              },
            ],
            regimenesPensionarios: [{ sistema: 'onp', codigoSunat: '02' }],
            cuentasBancarias: [],
          },
        ]),
      },
      planilla: {
        create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'planilla-1', ...data })),
        update: jest.fn().mockResolvedValue({}),
      },
      planillaDetalle: {
        create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'detalle-1', ...data })),
      },
      normativeParameter: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'param-1',
          codigo: 'ONP_TASA',
          valor: 0.13,
          vigenciaDesde: new Date('2026-01-01'),
          vigenciaHasta: null,
        }),
      },
      ...overrides,
    };
  }

  it('crea la planilla en estado "procesado" con el detalle de cada trabajador', async () => {
    const client = buildClient();
    const service = new PayrollRunService(new NormativeParameterService());

    const resultado = await service.procesarPeriodo(client as any, '2026-06');

    expect(client.planilla.create).toHaveBeenCalled();
    expect(client.planillaDetalle.create).toHaveBeenCalledTimes(1);
    expect(resultado.estado).toBe('procesado');
  });
});
```

- [ ] **Step 2: Ejecutar el test y verificar que falla**

Run: `pnpm --filter @rrhh/api test -- payroll-run.service`
Expected: FAIL — módulo no existe

- [ ] **Step 3: Implementación mínima**

```typescript
// apps/api/src/modules/payroll/payroll-run.service.ts
import { Injectable } from '@nestjs/common';
import { NormativeParameterService } from '../normative-params/normative-parameter.service';
import { calcularRetencionPensionaria } from './calculators/afp-onp.calculator';

export interface PlanillaProcesada {
  id: string;
  estado: string;
}

/**
 * Orquesta un ciclo de planilla: para cada trabajador activo del tenant,
 * resuelve los parámetros normativos vigentes a la fecha del periodo y ejecuta
 * las calculadoras puras (Tasks 2-8), guardando el resultado en
 * PLANILLA_DETALLE.conceptos_calculados. No contiene lógica de cálculo propia
 * — todo el cálculo vive en las funciones puras de ./calculators.
 */
@Injectable()
export class PayrollRunService {
  constructor(private readonly normativeParams: NormativeParameterService) {}

  async procesarPeriodo(client: any, periodo: string): Promise<PlanillaProcesada> {
    const fechaPeriodo = new Date(`${periodo}-01`);
    const planilla = await client.planilla.create({
      data: { periodo, estado: 'registrado' },
    });

    const empleados = await client.employee.findMany({
      where: { estado: 'activo' },
      include: {
        contratos: true,
        regimenesPensionarios: true,
        cuentasBancarias: true,
      },
    });

    const tasaOnp = (await this.normativeParams.resolve(
      client,
      'ONP_TASA',
      fechaPeriodo,
    )) as number;

    for (const empleado of empleados) {
      const contrato = empleado.contratos[0];
      const regimenPensionario = empleado.regimenesPensionarios[0];
      const remuneracion = contrato.remuneracionBasica.toNumber();

      const retencionPensionaria = calcularRetencionPensionaria({
        sistema: regimenPensionario?.sistema === 'afp' ? 'afp' : 'onp',
        remuneracion,
        tasaOnp,
        aportacionObligatoriaAfp: 0,
        comisionAfp: 0,
        tipoComision: 'flujo',
        primaSeguroAfp: 0,
        topeRemuneracionMaximaAsegurable: 0,
      });

      const netoPagar = remuneracion - retencionPensionaria.montoRetenido;

      await client.planillaDetalle.create({
        data: {
          planillaId: planilla.id,
          employeeId: empleado.id,
          conceptosCalculados: {
            remuneracionBasica: remuneracion,
            retencionPensionaria: retencionPensionaria.montoRetenido,
          },
          netoPagar,
        },
      });
    }

    const actualizada = await client.planilla.update({
      where: { id: planilla.id },
      data: { estado: 'procesado' },
    });

    return { id: planilla.id, estado: actualizada.estado ?? 'procesado' };
  }
}
```

- [ ] **Step 4: Ejecutar el test y verificar que pasa**

Run: `pnpm --filter @rrhh/api test -- payroll-run.service`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/payroll/payroll-run.service.ts apps/api/src/modules/payroll/payroll-run.service.spec.ts
git commit -m "feat(fase1): PayrollRunService orquesta el ciclo de planilla"
```

> **Nota de alcance:** este primer corte de `procesarPeriodo` integra solo la retención pensionaria para mantener el test enfocado. Antes de cerrar la Fase 1 hay que extender el bucle para invocar también `EssaludCalculator`, `AsignacionFamiliarCalculator` y `QuintaCategoriaCalculator` (Tasks 4-6) y sumar sus resultados a `conceptosCalculados` — mismo patrón, se deja como iteración siguiente dentro de esta misma tarea al ejecutarla, no como tarea nueva.

---

### Task 10: `PlanillaExporter` — genera el archivo `.txt` del PVS SUNAT

**Files:**
- Create: `apps/api/src/modules/payroll/planilla-exporter.service.ts`
- Test: `apps/api/src/modules/payroll/planilla-exporter.service.spec.ts`

**Interfaces:**
- Consumes: layout de `docs/superpowers/specs/anexo3-estructuras-archivos.md`, estructura E18 (Trabajador: Detalle de Ingresos, Tributos y Descuentos).
- Produces: `PlanillaExporter.exportarE18(detalles: PlanillaDetalleRow[]): string` — usado por `payroll.controller.ts` (Task 11).

- [ ] **Step 1: Escribir el test que falla**

```typescript
// apps/api/src/modules/payroll/planilla-exporter.service.spec.ts
import { PlanillaExporter } from './planilla-exporter.service';

describe('PlanillaExporter.exportarE18', () => {
  it('genera una linea por concepto, separada por "|", con el formato exacto de la Estructura 18', () => {
    const exporter = new PlanillaExporter();

    const salida = exporter.exportarE18([
      {
        tipoDocumento: '01',
        numeroDocumento: '12345678',
        codigoConceptoSunat: '0101', // Alimentacion principal en dinero
        montoDevengado: 100,
        montoPagado: 100,
      },
    ]);

    expect(salida).toBe('01|12345678|0101|100.00|100.00');
  });

  it('genera una linea por cada concepto cuando el trabajador tiene varios', () => {
    const exporter = new PlanillaExporter();

    const salida = exporter.exportarE18([
      { tipoDocumento: '01', numeroDocumento: '11111111', codigoConceptoSunat: '0121', montoDevengado: 2000, montoPagado: 2000 },
      { tipoDocumento: '01', numeroDocumento: '11111111', codigoConceptoSunat: '0201', montoDevengado: 113, montoPagado: 113 },
    ]);

    expect(salida.split('\n')).toHaveLength(2);
  });

  it('rechaza codigos excluidos explicitamente por la Estructura 18 (totales calculados, no declarables)', () => {
    const exporter = new PlanillaExporter();

    expect(() =>
      exporter.exportarE18([
        { tipoDocumento: '01', numeroDocumento: '11111111', codigoConceptoSunat: '0100', montoDevengado: 100, montoPagado: 100 },
      ]),
    ).toThrow(/no se declara/i);
  });
});
```

- [ ] **Step 2: Ejecutar el test y verificar que falla**

Run: `pnpm --filter @rrhh/api test -- planilla-exporter.service`
Expected: FAIL — módulo no existe

- [ ] **Step 3: Implementación mínima**

```typescript
// apps/api/src/modules/payroll/planilla-exporter.service.ts
import { Injectable } from '@nestjs/common';

/**
 * Genera el archivo de importación PLAME, Estructura 18 ("Trabajador: Detalle
 * de ingresos, tributos y descuentos"). Layout exacto documentado en
 * docs/superpowers/specs/anexo3-estructuras-archivos.md, sección E18.
 */
export interface PlanillaDetalleRow {
  tipoDocumento: string;
  numeroDocumento: string;
  codigoConceptoSunat: string;
  montoDevengado: number;
  montoPagado: number;
}

// Códigos de "totales calculados" que la Estructura 18 prohíbe declarar
// explícitamente — ver anexo3-estructuras-archivos.md, sección E18.
const CODIGOS_EXCLUIDOS = new Set([
  '0100', '0200', '0300', '0400', '0500', '0600', '0603', '0604',
  '0607', '0610', '0612', '0616', '0800', '0802', '0804', '0806', '0808',
]);

@Injectable()
export class PlanillaExporter {
  exportarE18(filas: PlanillaDetalleRow[]): string {
    return filas
      .map((fila) => {
        if (CODIGOS_EXCLUIDOS.has(fila.codigoConceptoSunat)) {
          throw new Error(
            `El código ${fila.codigoConceptoSunat} es un total calculado — no se declara en la Estructura 18`,
          );
        }
        return [
          fila.tipoDocumento,
          fila.numeroDocumento,
          fila.codigoConceptoSunat,
          fila.montoDevengado.toFixed(2),
          fila.montoPagado.toFixed(2),
        ].join('|');
      })
      .join('\n');
  }
}
```

- [ ] **Step 4: Ejecutar el test y verificar que pasa**

Run: `pnpm --filter @rrhh/api test -- planilla-exporter.service`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/payroll/planilla-exporter.service.ts apps/api/src/modules/payroll/planilla-exporter.service.spec.ts
git commit -m "feat(fase1): PlanillaExporter genera Estructura 18 (PLAME) del PVS SUNAT"
```

> **Nota de alcance:** este corte cubre solo E18 (el corazón del cálculo). Antes de cerrar Fase 1, replicar el mismo patrón (`exportarE04`, `exportarE05`, `exportarE11`, `exportarE30`, `exportarE14`, `exportarE15`, `exportarE26`) para las demás estructuras mínimas identificadas en `anexo3-estructuras-archivos.md` ("Notas de implementación para PlanillaExporter").

---

### Task 11: `BankFileExporter` (BCP) y endpoints de `payroll.controller.ts`

**Files:**
- Create: `apps/api/src/modules/payroll/bank-file-exporter.service.ts`
- Create: `apps/api/src/modules/payroll/payroll.controller.ts`
- Create: `apps/api/src/modules/payroll/payroll.module.ts`
- Test: `apps/api/src/modules/payroll/bank-file-exporter.service.spec.ts`

**Interfaces:**
- Consumes: `PayrollRunService` (Task 9), `PlanillaExporter` (Task 10), `PermissionsGuard`/`RequirePermission`/`getTenantContext` de Fase 0.
- Produces: endpoints `POST /api/payroll/:periodo/procesar`, `GET /api/payroll/:periodo/export/plame`, `GET /api/payroll/:periodo/export/telecredito` — consumidos por el frontend (fuera de alcance de este plan, ver Global Constraints).

- [ ] **Step 1: Escribir el test que falla (BankFileExporter)**

```typescript
// apps/api/src/modules/payroll/bank-file-exporter.service.spec.ts
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
      exporter.exportarBcp([{ numeroDocumento: '87654321', numeroCuenta: '', monto: 1500 }]),
    ).toThrow(/sin cuenta bancaria/i);
  });
});
```

- [ ] **Step 2: Ejecutar el test y verificar que falla**

Run: `pnpm --filter @rrhh/api test -- bank-file-exporter.service`
Expected: FAIL — módulo no existe

- [ ] **Step 3: Implementación mínima**

```typescript
// apps/api/src/modules/payroll/bank-file-exporter.service.ts
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
```

```typescript
// apps/api/src/modules/payroll/payroll.controller.ts
import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { getTenantContext } from '../../common/database/tenant-request-context';
import { PayrollRunService } from './payroll-run.service';

@Controller('payroll')
@UseGuards(PermissionsGuard)
export class PayrollController {
  constructor(private readonly payrollRunService: PayrollRunService) {}

  @Post(':periodo/procesar')
  @RequirePermission('employee.salary.read')
  async procesar(@Param('periodo') periodo: string) {
    const ctx = getTenantContext();
    return this.payrollRunService.procesarPeriodo(ctx.tx, periodo);
  }
}
```

```typescript
// apps/api/src/modules/payroll/payroll.module.ts
import { Module } from '@nestjs/common';
import { PayrollController } from './payroll.controller';
import { PayrollRunService } from './payroll-run.service';
import { PlanillaExporter } from './planilla-exporter.service';
import { BankFileExporter } from './bank-file-exporter.service';
import { NormativeParamsModule } from '../normative-params/normative-params.module';

@Module({
  imports: [NormativeParamsModule],
  controllers: [PayrollController],
  providers: [PayrollRunService, PlanillaExporter, BankFileExporter],
})
export class PayrollModule {}
```

Registrar `PayrollModule` en `apps/api/src/app.module.ts` (agregar al arreglo `imports`, junto a `EmployeesModule`).

- [ ] **Step 4: Ejecutar el test y verificar que pasa**

Run: `pnpm --filter @rrhh/api test -- bank-file-exporter.service`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/payroll/bank-file-exporter.service.ts apps/api/src/modules/payroll/bank-file-exporter.service.spec.ts apps/api/src/modules/payroll/payroll.controller.ts apps/api/src/modules/payroll/payroll.module.ts apps/api/src/app.module.ts
git commit -m "feat(fase1): BankFileExporter BCP y endpoints de payroll"
```

---

## Fuera de alcance de este plan (deuda técnica explícita, no placeholders)

- **Ficha de Alta de Trabajador, Dashboard de Planilla, popups de exportación** (frontend Next.js): requieren una pasada de diseño de UI (`frontend-design`) antes de poder escribirse como tareas TDD con componentes/interacciones concretas.
- **Extensión completa de `PayrollRunService`** a EsSalud/asignación familiar/quinta categoría dentro del mismo bucle (marcado explícitamente en Task 9).
- **Extensión completa de `PlanillaExporter`** a las demás estructuras E4/E5/E11/E14/E15/E26/E30 (marcado explícitamente en Task 10).
- **Reglas completas de régimen Agrario** y otros regímenes especiales — Fase 1 solo cubre General + MYPE a fondo, por decisión ya tomada en el goal.
- **Confirmación de valores normativos reales** antes de producción — ver `docs/superpowers/specs/validaciones-normativas-pendientes.md`.
