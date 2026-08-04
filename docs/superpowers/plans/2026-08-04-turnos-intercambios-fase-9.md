# Sprint 9: Portal de Intercambios Autoservicio (Feature 4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement Feature 4 (Portal de Intercambios) — Empleado A propone intercambiar su turno con Empleado B en una fecha; B acepta/rechaza; si acepta, el Manager aprueba/rechaza, salvo que pasen 48h sin decisión o llegue la fecha del turno, en cuyo caso el sistema resuelve automáticamente.

**Architecture:** Mismo patrón que Sprints 6-8 en `apps/api/src/modules/shifts/`: un modelo Prisma con RLS, un servicio CRUD (`IntercambioTurnoService`) para las transiciones que decide un humano (proponer/aceptar/rechazar de B), un servicio de orquestación (`IntercambioTurnoAplicadorService`) para las decisiones del manager y el barrido perezoso de resoluciones automáticas, endpoints REST con `@RequirePermission`, notificaciones no bloqueantes, y 2 tabs de frontend (empleado y manager) en `/turnos`. El swap real de `turnoAsignacion` reusa `CompensatorioService.intercambiar()` (Fase 5), sin modificarlo.

**Tech Stack:** NestJS (API), Prisma + PostgreSQL con RLS (multi-tenant), Next.js App Router + Tailwind (web), Jest (tests).

## Global Constraints

Aplica a todas las tareas de este plan:

1. **Database & RLS:** modelo `IntercambioTurno` con tenant isolation. RLS policy `tenant_isolation` (`tenant_id = current_setting('app.tenant_id', true)::uuid`). Permisos: `app_employee` (SELECT/INSERT), `app_rrhh/app_admin/app_manager` (SELECT/INSERT/UPDATE). Audit trigger `audit_trigger()` (mismo patrón que `solicitud_trabajo_adicional`).
2. **Servicios y validación:** validaciones en el servicio, nunca en el Controller. Errores: `BadRequestException` (validación/transición inválida), `ConflictException` (duplicado), `NotFoundException` (no existe). Llamadas a `NotificationService` son no bloqueantes: envueltas en `try { } catch { /* no bloqueante */ }`.
3. **API & RBAC:** `shift.read` — Emp A propone/lista; Emp B acepta/rechaza. `shift.resolve` — Manager aprueba/rechaza/lista pendientes. Sin permisos nuevos.
4. **Barrido perezoso:** todo endpoint bajo `/turnos/intercambios/*` corre `IntercambioTurnoAplicadorService.barrido(tx, tenantId)` **antes** de su propia lógica (ver diseño §4.3).
5. **Frontend:** 2 sub-tabs nuevos en `/turnos` (`intercambios-empleado`, `intercambios-manager`), mismo estilo Tailwind que `mis-cambios-tab.tsx`/`trabajo-adicional-manager-tab.tsx` (botones, badges de color por estado, modales accesibles con `role="dialog"`/`aria-modal`).
6. **Testing:** unit tests con transacción Prisma fake (in-memory Map, mismo patrón que `feature-3.integration.spec.ts`). `tsc --noEmit` sin errores. Todos los tests pasan antes de cada commit.
7. **Git:** un commit por tarea. Formato `feat(turnos-fase-9): <tarea>` / `test(turnos-fase-9): <tarea>` / `feat(web): <tarea>`.

**Referencias:**
- Diseño aprobado: `docs/superpowers/specs/2026-08-04-turnos-intercambios-fase-9-design.md`
- Spec maestro: `docs/superpowers/specs/2026-07-18-turnos-mejoras-phase-6-9.md` (§5, §6)
- Precedente de plan: `docs/superpowers/plans/2026-07-30-turnos-trabajo-extra-fase-8.md`
- Swap reusado: `apps/api/src/modules/shifts/compensatorio.service.ts` (`intercambiar()`, sin cambios)

---

### Task 1: Modelo Prisma + Migración + RLS

**Objetivo:** Crear el modelo `IntercambioTurno` con sus 2 enums nuevos, relación con `Employee`/`Tenant`, migración SQL con RLS/GRANT/audit trigger.

**Files:**
- Modify: `packages/database/prisma/schema.prisma`
- Create: `packages/database/prisma/migrations/<timestamp>_intercambio_turno/migration.sql`

**Interfaces:**
- Produces: modelo `IntercambioTurno` (tabla `intercambio_turno`), enums `EstadoIntercambioTurno` y `MotivoResolucionIntercambio`, campo `Tenant.intercambiosTurno`, campos `Employee.intercambiosComoA`/`Employee.intercambiosComoB`.

- [ ] **Step 1: Agregar los enums y el modelo a `schema.prisma`**

Insertar después del modelo `SolicitudTrabajoAdicional` (línea ~905, justo antes de `enum TipoMovimientoCompensatorio`):

```prisma
enum EstadoIntercambioTurno {
  PENDIENTE_ACEPTACION_B
  RECHAZADA_POR_B
  ACEPTADA_POR_B
  APROBADA_MANAGER
  RECHAZADA_MANAGER
  AUTO_APROBADA
  RECHAZADA_AUTOMATICA

  @@map("estado_intercambio_turno")
}

enum MotivoResolucionIntercambio {
  PLAZO_48H
  FECHA_ALCANZADA
  FECHA_ALCANZADA_SIN_RESPUESTA_B
  TURNO_MODIFICADO

  @@map("motivo_resolucion_intercambio")
}

// Fase 9 — Portal de intercambios autoservicio: Empleado A propone
// intercambiar su turno con Empleado B en una fecha; B acepta/rechaza;
// si acepta, el Manager aprueba/rechaza. Si el manager no decide en 48h
// desde la aceptación de B, o si la fecha del turno llega antes, el
// sistema resuelve automáticamente (ver IntercambioTurnoAplicadorService).
model IntercambioTurno {
  id          String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  tenantId    String   @map("tenant_id") @db.Uuid
  employeeIdA String   @map("employee_id_a") @db.Uuid // propone
  employeeIdB String   @map("employee_id_b") @db.Uuid // recibe la propuesta
  fecha       DateTime @db.Date

  turnoActualA TipoDiaPlan @map("turno_actual_a") // snapshot al proponer
  turnoActualB TipoDiaPlan @map("turno_actual_b")
  mensajeA     String?     @map("mensaje_a") @db.Text

  estado           EstadoIntercambioTurno       @default(PENDIENTE_ACEPTACION_B)
  motivoRechazo    String?                       @map("motivo_rechazo") @db.Text
  motivoResolucion MotivoResolucionIntercambio? @map("motivo_resolucion")

  aceptadoEn DateTime? @map("aceptado_en")
  decididoEn DateTime? @map("decidido_en")
  // Uuid del manager si decidió una persona; null si resolvió el sistema
  // (motivoResolucion indica el porqué en ese caso). No es @db.Uuid porque
  // en la práctica solo se usa como referencia de auditoría, sin FK.
  decididoPor String? @map("decidido_por") @db.Text

  turnoAsignacionAId String? @map("turno_asignacion_a_id") @db.Uuid
  turnoAsignacionBId String? @map("turno_asignacion_b_id") @db.Uuid

  creadoEn  DateTime @default(now()) @map("creado_en")
  creadoPor String   @map("creado_por") @db.Uuid

  tenant    Tenant   @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  empleadoA Employee @relation("IntercambioTurnoEmpleadoA", fields: [employeeIdA], references: [id], onDelete: Cascade)
  empleadoB Employee @relation("IntercambioTurnoEmpleadoB", fields: [employeeIdB], references: [id], onDelete: Cascade)

  @@index([tenantId, employeeIdA], map: "intercambio_turno_tenant_a_idx")
  @@index([tenantId, employeeIdB], map: "intercambio_turno_tenant_b_idx")
  @@index([tenantId, estado])
  @@map("intercambio_turno")
}
```

Agregar la relación inversa en `Tenant` (junto a `solicitudesTrabajoAdicional`, línea ~47):

```prisma
  // Fase 9 — Portal de intercambios
  intercambiosTurno IntercambioTurno[]
```

Agregar las 2 relaciones inversas en `Employee` (junto a las de `SolicitudTrabajoAdicional`, línea ~196):

```prisma
  // Fase 9 — Portal de intercambios
  intercambiosComoA IntercambioTurno[] @relation("IntercambioTurnoEmpleadoA")
  intercambiosComoB IntercambioTurno[] @relation("IntercambioTurnoEmpleadoB")
```

- [ ] **Step 2: Generar el esqueleto de migración**

Con la BD local levantada (`docker-compose up -d` desde la raíz del repo si no está corriendo):

```bash
pnpm --filter @rrhh/database exec prisma migrate dev --name intercambio_turno --create-only
```

Esto crea `packages/database/prisma/migrations/<timestamp>_intercambio_turno/migration.sql` con los `CREATE TYPE`/`CREATE TABLE`/`CREATE INDEX`/`AddForeignKey` generados a partir del schema.

- [ ] **Step 3: Agregar RLS, grants y audit trigger al final del `migration.sql` generado**

```sql
-- RLS (Row Level Security) for multi-tenant isolation
ALTER TABLE "intercambio_turno" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "intercambio_turno" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "intercambio_turno"
    USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid);

-- Access Control: empleado A propone e insertar; empleado B acepta/rechaza
-- (UPDATE); manager/RRHH/Admin aprueban/rechazan (UPDATE).
GRANT SELECT, INSERT, UPDATE ON "intercambio_turno" TO app_employee;
GRANT SELECT, INSERT, UPDATE ON "intercambio_turno" TO app_rrhh, app_admin, app_manager;

-- Audit Trail Integration (Fase 0)
CREATE TRIGGER "intercambio_turno_audit" AFTER INSERT OR UPDATE OR DELETE ON "intercambio_turno"
    FOR EACH ROW EXECUTE FUNCTION audit_trigger();
```

Nota: a diferencia de `solicitud_trabajo_adicional` (donde `app_employee` solo tiene SELECT/INSERT), aquí `app_employee` necesita también UPDATE porque el propio Empleado B (que actúa con el rol/permiso de empleado) es quien ejecuta `aceptar`/`rechazar` sobre una fila que no creó él.

- [ ] **Step 4: Aplicar la migración y regenerar el cliente Prisma**

```bash
pnpm --filter @rrhh/database exec prisma migrate dev
pnpm --filter @rrhh/database exec prisma generate
```

Verificar: `pnpm --filter @rrhh/api exec tsc --noEmit` debe seguir en 0 errores (el cliente Prisma regenerado ya expone `tx.intercambioTurno`).

- [ ] **Step 5: Commit**

```bash
git add packages/database/prisma/schema.prisma packages/database/prisma/migrations
git commit -m "feat(turnos-fase-9): modelo IntercambioTurno + RLS + migration"
```

---

### Task 2: Servicio CRUD (`IntercambioTurnoService`)

**Objetivo:** Crear el servicio con las transiciones que decide un humano sin necesidad de orquestación adicional: proponer (A), listar, aceptar/rechazar (B).

**Files:**
- Create: `apps/api/src/modules/shifts/intercambio-turno.service.ts`
- Test: `apps/api/src/modules/shifts/intercambio-turno.service.spec.ts`

**Interfaces:**
- Consumes: `tx.intercambioTurno.*`, `tx.employee.findUnique({ where: { id } })`, `tx.turnoAsignacion.findUnique({ where: { tenantId_employeeId_fecha: {...} } })` (todos ya existentes en el cliente Prisma).
- Produces (usado por Task 4 y Task 5):
  - `ProponerIntercambioInput { tenantId, employeeIdA, employeeIdB, fecha: Date, mensajeA?: string, creadoPor: string }`
  - `class IntercambioTurnoService { proponer(tx, input): Promise<any>; listarMisPropuestas(tx, tenantId, employeeIdA): Promise<any[]>; listarPropuestasParaMi(tx, tenantId, employeeIdB): Promise<any[]>; obtener(tx, id): Promise<any|null>; aceptar(tx, tenantId, id, employeeIdB): Promise<any>; rechazarPorB(tx, tenantId, id, employeeIdB, motivoRechazo?): Promise<any> }`

- [ ] **Step 1: Escribir los tests que fallan**

```typescript
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { IntercambioTurnoService } from './intercambio-turno.service';

function mockTx(overrides: any = {}) {
  const intercambios = new Map<string, any>();
  let seq = 0;
  return {
    intercambioTurno: {
      findUnique: jest.fn(async ({ where }: any) => intercambios.get(where.id) ?? null),
      findFirst: jest.fn(async ({ where }: any) => {
        for (const it of intercambios.values()) {
          if (
            it.tenantId === where.tenantId &&
            it.employeeIdA === where.employeeIdA &&
            it.employeeIdB === where.employeeIdB &&
            it.fecha.getTime() === where.fecha.getTime() &&
            where.estado.in.includes(it.estado)
          ) {
            return it;
          }
        }
        return null;
      }),
      findMany: jest.fn(async ({ where }: any) =>
        [...intercambios.values()].filter(
          (it) => it.tenantId === where.tenantId && it[where.employeeField ?? 'employeeIdA'] === where.employeeValue,
        ),
      ),
      create: jest.fn(async ({ data }: any) => {
        const id = `int-${++seq}`;
        const record = { id, creadoEn: new Date(), ...data };
        intercambios.set(id, record);
        return record;
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const existing = intercambios.get(where.id);
        const updated = { ...existing, ...data };
        intercambios.set(where.id, updated);
        return updated;
      }),
    },
    employee: {
      findUnique: jest.fn(async ({ where }: any) =>
        ({ 'emp-a': { id: 'emp-a', estado: 'activo' }, 'emp-b': { id: 'emp-b', estado: 'activo' } })[where.id] ?? null,
      ),
    },
    turnoAsignacion: {
      findUnique: jest.fn(async ({ where }: any) => {
        const k = where.tenantId_employeeId_fecha;
        if (k.employeeId === 'emp-a') return { tipoDia: 'TURNO', turnoId: 'turno-dia' };
        if (k.employeeId === 'emp-b') return { tipoDia: 'TURNO', turnoId: 'turno-noche' };
        return null;
      }),
    },
    ...overrides,
    _store: intercambios,
  };
}

const FECHA_FUTURA = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000);
FECHA_FUTURA.setHours(0, 0, 0, 0);

describe('IntercambioTurnoService', () => {
  const service = new IntercambioTurnoService();

  describe('proponer', () => {
    it('crea la propuesta con snapshot de los turnos actuales', async () => {
      const tx = mockTx();
      const resultado = await service.proponer(tx, {
        tenantId: 't-1', employeeIdA: 'emp-a', employeeIdB: 'emp-b',
        fecha: FECHA_FUTURA, mensajeA: 'Tengo cita', creadoPor: 'emp-a',
      });

      expect(resultado.estado).toBe('PENDIENTE_ACEPTACION_B');
      expect(resultado.turnoActualA).toBe('TURNO');
      expect(resultado.turnoActualB).toBe('TURNO');
    });

    it('rechaza si A y B son el mismo empleado', async () => {
      const tx = mockTx();
      await expect(
        service.proponer(tx, {
          tenantId: 't-1', employeeIdA: 'emp-a', employeeIdB: 'emp-a',
          fecha: FECHA_FUTURA, creadoPor: 'emp-a',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rechaza fecha en el pasado', async () => {
      const tx = mockTx();
      await expect(
        service.proponer(tx, {
          tenantId: 't-1', employeeIdA: 'emp-a', employeeIdB: 'emp-b',
          fecha: new Date(2020, 0, 1), creadoPor: 'emp-a',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rechaza si alguno no tiene turnoAsignacion esa fecha', async () => {
      const tx = mockTx({
        turnoAsignacion: { findUnique: jest.fn().mockResolvedValue(null) },
      });
      await expect(
        service.proponer(tx, {
          tenantId: 't-1', employeeIdA: 'emp-a', employeeIdB: 'emp-b',
          fecha: FECHA_FUTURA, creadoPor: 'emp-a',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rechaza empleado inactivo', async () => {
      const tx = mockTx({
        employee: { findUnique: jest.fn().mockResolvedValue({ id: 'emp-a', estado: 'cesado' }) },
      });
      await expect(
        service.proponer(tx, {
          tenantId: 't-1', employeeIdA: 'emp-a', employeeIdB: 'emp-b',
          fecha: FECHA_FUTURA, creadoPor: 'emp-a',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rechaza duplicado del mismo par+fecha ya pendiente', async () => {
      const tx = mockTx();
      await service.proponer(tx, {
        tenantId: 't-1', employeeIdA: 'emp-a', employeeIdB: 'emp-b',
        fecha: FECHA_FUTURA, creadoPor: 'emp-a',
      });
      await expect(
        service.proponer(tx, {
          tenantId: 't-1', employeeIdA: 'emp-a', employeeIdB: 'emp-b',
          fecha: FECHA_FUTURA, creadoPor: 'emp-a',
        }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('aceptar / rechazarPorB', () => {
    it('aceptar mueve a ACEPTADA_POR_B y setea aceptadoEn', async () => {
      const tx = mockTx();
      const propuesta = await service.proponer(tx, {
        tenantId: 't-1', employeeIdA: 'emp-a', employeeIdB: 'emp-b',
        fecha: FECHA_FUTURA, creadoPor: 'emp-a',
      });
      const aceptada = await service.aceptar(tx, 't-1', propuesta.id, 'emp-b');
      expect(aceptada.estado).toBe('ACEPTADA_POR_B');
      expect(aceptada.aceptadoEn).toBeInstanceOf(Date);
    });

    it('aceptar lanza si el llamante no es employeeIdB', async () => {
      const tx = mockTx();
      const propuesta = await service.proponer(tx, {
        tenantId: 't-1', employeeIdA: 'emp-a', employeeIdB: 'emp-b',
        fecha: FECHA_FUTURA, creadoPor: 'emp-a',
      });
      await expect(service.aceptar(tx, 't-1', propuesta.id, 'emp-a')).rejects.toThrow(BadRequestException);
    });

    it('rechazarPorB mueve a RECHAZADA_POR_B con motivo', async () => {
      const tx = mockTx();
      const propuesta = await service.proponer(tx, {
        tenantId: 't-1', employeeIdA: 'emp-a', employeeIdB: 'emp-b',
        fecha: FECHA_FUTURA, creadoPor: 'emp-a',
      });
      const rechazada = await service.rechazarPorB(tx, 't-1', propuesta.id, 'emp-b', 'No puedo ese día');
      expect(rechazada.estado).toBe('RECHAZADA_POR_B');
      expect(rechazada.motivoRechazo).toBe('No puedo ese día');
    });

    it('aceptar sobre id inexistente lanza NotFoundException', async () => {
      const tx = mockTx();
      await expect(service.aceptar(tx, 't-1', 'no-existe', 'emp-b')).rejects.toThrow(NotFoundException);
    });

    it('aceptar sobre propuesta ya resuelta lanza BadRequestException', async () => {
      const tx = mockTx();
      const propuesta = await service.proponer(tx, {
        tenantId: 't-1', employeeIdA: 'emp-a', employeeIdB: 'emp-b',
        fecha: FECHA_FUTURA, creadoPor: 'emp-a',
      });
      await service.rechazarPorB(tx, 't-1', propuesta.id, 'emp-b');
      await expect(service.aceptar(tx, 't-1', propuesta.id, 'emp-b')).rejects.toThrow(BadRequestException);
    });
  });
});
```

- [ ] **Step 2: Ejecutar y verificar que fallan**

```bash
pnpm --filter @rrhh/api test -- intercambio-turno.service.spec
```

Esperado: FAIL — `Cannot find module './intercambio-turno.service'`.

- [ ] **Step 3: Implementar `IntercambioTurnoService`**

```typescript
import { Injectable, BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';

export type TipoDiaPlan = 'TURNO' | 'DESCANSO' | 'DESCANSO_COMPENSATORIO';
export type EstadoIntercambioTurno =
  | 'PENDIENTE_ACEPTACION_B'
  | 'RECHAZADA_POR_B'
  | 'ACEPTADA_POR_B'
  | 'APROBADA_MANAGER'
  | 'RECHAZADA_MANAGER'
  | 'AUTO_APROBADA'
  | 'RECHAZADA_AUTOMATICA';
export type MotivoResolucionIntercambio =
  | 'PLAZO_48H'
  | 'FECHA_ALCANZADA'
  | 'FECHA_ALCANZADA_SIN_RESPUESTA_B'
  | 'TURNO_MODIFICADO';

export interface ProponerIntercambioInput {
  tenantId: string;
  employeeIdA: string;
  employeeIdB: string;
  fecha: Date;
  mensajeA?: string;
  creadoPor: string;
}

const ESTADOS_NO_TERMINALES: readonly EstadoIntercambioTurno[] = [
  'PENDIENTE_ACEPTACION_B',
  'ACEPTADA_POR_B',
];

/**
 * Portal de intercambios (fase 9): transiciones que decide directamente un
 * humano sin orquestación adicional (proponer, aceptar/rechazar de B). Las
 * decisiones del manager y las resoluciones automáticas (48h / fecha
 * alcanzada) viven en IntercambioTurnoAplicadorService (Task 4), que reusa
 * `obtener` de este servicio.
 */
@Injectable()
export class IntercambioTurnoService {
  async proponer(tx: any, input: ProponerIntercambioInput): Promise<any> {
    if (input.employeeIdA === input.employeeIdB) {
      throw new BadRequestException('Un empleado no puede proponerse un intercambio a sí mismo');
    }

    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);
    if (new Date(input.fecha) < hoy) {
      throw new BadRequestException('La fecha del intercambio no puede estar en el pasado');
    }

    const [empA, empB] = await Promise.all([
      tx.employee.findUnique({ where: { id: input.employeeIdA } }),
      tx.employee.findUnique({ where: { id: input.employeeIdB } }),
    ]);
    if (!empA || empA.estado !== 'activo') {
      throw new BadRequestException('El empleado A no está activo');
    }
    if (!empB || empB.estado !== 'activo') {
      throw new BadRequestException('El empleado B no está activo');
    }

    const [asigA, asigB] = await Promise.all([
      tx.turnoAsignacion.findUnique({
        where: { tenantId_employeeId_fecha: { tenantId: input.tenantId, employeeId: input.employeeIdA, fecha: input.fecha } },
      }),
      tx.turnoAsignacion.findUnique({
        where: { tenantId_employeeId_fecha: { tenantId: input.tenantId, employeeId: input.employeeIdB, fecha: input.fecha } },
      }),
    ]);
    if (!asigA || !asigB) {
      throw new BadRequestException('Ambos empleados deben tener un turno asignado esa fecha');
    }

    const duplicado = await tx.intercambioTurno.findFirst({
      where: {
        tenantId: input.tenantId,
        employeeIdA: input.employeeIdA,
        employeeIdB: input.employeeIdB,
        fecha: input.fecha,
        estado: { in: ESTADOS_NO_TERMINALES },
      },
    });
    if (duplicado) {
      throw new ConflictException('Ya existe una propuesta de intercambio pendiente para ese par y esa fecha');
    }

    return tx.intercambioTurno.create({
      data: {
        tenantId: input.tenantId,
        employeeIdA: input.employeeIdA,
        employeeIdB: input.employeeIdB,
        fecha: input.fecha,
        turnoActualA: asigA.tipoDia,
        turnoActualB: asigB.tipoDia,
        mensajeA: input.mensajeA ?? null,
        estado: 'PENDIENTE_ACEPTACION_B',
        creadoPor: input.creadoPor,
      },
    });
  }

  async listarMisPropuestas(tx: any, tenantId: string, employeeIdA: string): Promise<any[]> {
    return tx.intercambioTurno.findMany({
      where: { tenantId, employeeIdA },
      orderBy: { creadoEn: 'desc' },
    });
  }

  async listarPropuestasParaMi(tx: any, tenantId: string, employeeIdB: string): Promise<any[]> {
    return tx.intercambioTurno.findMany({
      where: { tenantId, employeeIdB },
      orderBy: { creadoEn: 'desc' },
    });
  }

  async obtener(tx: any, id: string): Promise<any | null> {
    return tx.intercambioTurno.findUnique({ where: { id } });
  }

  async aceptar(tx: any, tenantId: string, id: string, employeeIdB: string): Promise<any> {
    const it = await this.obtenerPendienteDeB(tx, id, employeeIdB);
    return tx.intercambioTurno.update({
      where: { id },
      data: { estado: 'ACEPTADA_POR_B', aceptadoEn: new Date() },
    });
  }

  async rechazarPorB(tx: any, tenantId: string, id: string, employeeIdB: string, motivoRechazo?: string): Promise<any> {
    const it = await this.obtenerPendienteDeB(tx, id, employeeIdB);
    return tx.intercambioTurno.update({
      where: { id },
      data: {
        estado: 'RECHAZADA_POR_B',
        motivoRechazo: motivoRechazo ?? null,
        decididoPor: employeeIdB,
        decididoEn: new Date(),
      },
    });
  }

  private async obtenerPendienteDeB(tx: any, id: string, employeeIdB: string): Promise<any> {
    const it = await tx.intercambioTurno.findUnique({ where: { id } });
    if (!it) {
      throw new NotFoundException(`Intercambio ${id} no encontrado`);
    }
    if (it.employeeIdB !== employeeIdB) {
      throw new BadRequestException('Solo el empleado B puede aceptar o rechazar esta propuesta');
    }
    if (it.estado !== 'PENDIENTE_ACEPTACION_B') {
      throw new BadRequestException(
        `Esta propuesta ya no está pendiente de tu respuesta (estado actual: ${it.estado})`,
      );
    }
    return it;
  }
}
```

- [ ] **Step 4: Ejecutar y verificar que pasan**

```bash
pnpm --filter @rrhh/api test -- intercambio-turno.service.spec
```

Esperado: PASS, 12/12.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/shifts/intercambio-turno.service.ts apps/api/src/modules/shifts/intercambio-turno.service.spec.ts
git commit -m "feat(turnos-fase-9): CRUD service IntercambioTurno (proponer/aceptar/rechazar)"
```

---

### Task 3: Notificaciones (5 métodos)

**Objetivo:** Agregar los 5 métodos de notificación del diseño (§6) a `NotificationService`, **antes** de la orquestación (Task 4) para que pueda consumirlos sin referencias hacia adelante.

**Files:**
- Modify: `apps/api/src/common/services/notification.service.ts`
- Modify: `apps/api/src/common/services/notification.service.spec.ts`

**Interfaces:**
- Consumes: `this.prisma.employee.findUnique(...)` (mismo patrón que los métodos existentes de Fase 8).
- Produces (usado por Task 4 y Task 5):
  - `notificarIntercambioPropuesto(tenantId: string, employeeIdA: string, employeeIdB: string, fecha: Date, mensajeA?: string | null): Promise<void>`
  - `notificarIntercambioRechazadoPorB(tenantId: string, employeeIdA: string, motivoRechazo?: string | null): Promise<void>`
  - `notificarIntercambioAceptadoPorB(tenantId: string, employeeIdA: string, employeeIdB: string, fecha: Date): Promise<void>`
  - `notificarIntercambioAprobado(tenantId: string, employeeIdA: string, employeeIdB: string, fecha: Date, fueAutomatico: boolean): Promise<void>`
  - `notificarIntercambioRechazado(tenantId: string, employeeIdA: string, employeeIdB: string, motivoRechazo?: string | null): Promise<void>`

- [ ] **Step 1: Escribir los tests que fallan**

Agregar al final de `notification.service.spec.ts` (antes del cierre del `describe('NotificationService', ...)`):

```typescript
  // ========== Tests para el Portal de Intercambios (fase 9) ==========
  it('notificarIntercambioPropuesto: envía email a B con el mensaje de A', async () => {
    const prisma = mockPrisma({
      employee: {
        findUnique: jest.fn().mockResolvedValue({ id: 'emp-b', user: { email: 'b@test.com' } }),
      },
    });
    const service = new NotificationService(prisma as any);
    const enviarEmailSpy = jest.spyOn(service as any, 'enviarEmail');

    await service.notificarIntercambioPropuesto('t-1', 'emp-a', 'emp-b', new Date(2026, 8, 10), 'Tengo cita');

    expect(enviarEmailSpy).toHaveBeenCalledWith(
      'b@test.com',
      expect.any(String),
      expect.stringContaining('Tengo cita'),
    );
  });

  it('notificarIntercambioPropuesto: no lanza si B no tiene usuario/email', async () => {
    const prisma = mockPrisma({ employee: { findUnique: jest.fn().mockResolvedValue(null) } });
    const service = new NotificationService(prisma as any);
    await expect(
      service.notificarIntercambioPropuesto('t-1', 'emp-a', 'emp-b', new Date(2026, 8, 10)),
    ).resolves.toBeUndefined();
  });

  it('notificarIntercambioRechazadoPorB: envía email a A', async () => {
    const prisma = mockPrisma({
      employee: { findUnique: jest.fn().mockResolvedValue({ id: 'emp-a', user: { email: 'a@test.com' } }) },
    });
    const service = new NotificationService(prisma as any);
    const enviarEmailSpy = jest.spyOn(service as any, 'enviarEmail');

    await service.notificarIntercambioRechazadoPorB('t-1', 'emp-a', 'No puedo ese día');

    expect(enviarEmailSpy).toHaveBeenCalledWith('a@test.com', expect.any(String), expect.any(String));
  });

  it('notificarIntercambioAceptadoPorB: envía email al manager de A vía managerId', async () => {
    const prisma = mockPrisma({
      employee: {
        findUnique: jest.fn().mockImplementation(({ where }: any) =>
          where.id === 'emp-a'
            ? Promise.resolve({ managerId: 'mgr-1', nombres: 'Ana', apellidos: 'Ruiz' })
            : Promise.resolve({ user: { email: 'mgr@test.com' } }),
        ),
      },
    });
    const service = new NotificationService(prisma as any);
    const enviarEmailSpy = jest.spyOn(service as any, 'enviarEmail');

    await service.notificarIntercambioAceptadoPorB('t-1', 'emp-a', 'emp-b', new Date(2026, 8, 10));

    expect(enviarEmailSpy).toHaveBeenCalledWith('mgr@test.com', expect.any(String), expect.any(String));
  });

  it('notificarIntercambioAceptadoPorB: no lanza si A no tiene manager asignado', async () => {
    const prisma = mockPrisma({
      employee: { findUnique: jest.fn().mockResolvedValue({ managerId: null }) },
    });
    const service = new NotificationService(prisma as any);
    await expect(
      service.notificarIntercambioAceptadoPorB('t-1', 'emp-a', 'emp-b', new Date(2026, 8, 10)),
    ).resolves.toBeUndefined();
  });

  it('notificarIntercambioAprobado: aclara que fue automático cuando fueAutomatico=true', async () => {
    const prisma = mockPrisma({
      employee: { findUnique: jest.fn().mockResolvedValue({ user: { email: 'x@test.com' } }) },
    });
    const service = new NotificationService(prisma as any);
    const enviarEmailSpy = jest.spyOn(service as any, 'enviarEmail');

    await service.notificarIntercambioAprobado('t-1', 'emp-a', 'emp-b', new Date(2026, 8, 10), true);

    expect(enviarEmailSpy).toHaveBeenCalledTimes(2); // A y B
    expect(enviarEmailSpy.mock.calls[0][2]).toContain('automáticamente');
  });

  it('notificarIntercambioRechazado: notifica a ambos empleados', async () => {
    const prisma = mockPrisma({
      employee: { findUnique: jest.fn().mockResolvedValue({ user: { email: 'x@test.com' } }) },
    });
    const service = new NotificationService(prisma as any);
    const enviarEmailSpy = jest.spyOn(service as any, 'enviarEmail');

    await service.notificarIntercambioRechazado('t-1', 'emp-a', 'emp-b', 'El turno cambió');

    expect(enviarEmailSpy).toHaveBeenCalledTimes(2);
  });
```

- [ ] **Step 2: Ejecutar y verificar que fallan**

```bash
pnpm --filter @rrhh/api test -- notification.service.spec
```

Esperado: FAIL — `service.notificarIntercambioPropuesto is not a function`.

- [ ] **Step 3: Implementar los 5 métodos**

Agregar al final de la clase `NotificationService`, antes de `enviarEmail`:

```typescript
  /**
   * Notifica al empleado B que recibió una propuesta de intercambio de
   * turno. No bloqueante: cualquier error se captura y se loguea.
   */
  async notificarIntercambioPropuesto(
    tenantId: string,
    employeeIdA: string,
    employeeIdB: string,
    fecha: Date,
    mensajeA?: string | null,
  ): Promise<void> {
    const mensaje = `Un compañero te propone intercambiar el turno del ${fecha.toDateString()}.` +
      (mensajeA ? ` Mensaje: ${mensajeA}` : '');

    try {
      const empleadoB = await this.prisma.employee.findUnique({
        where: { id: employeeIdB },
        select: { id: true, user: { select: { email: true } } },
      });

      if (!empleadoB?.user?.email) {
        this.logger.warn(
          `Empleado ${employeeIdB} no tiene usuario/email asociado; se omite notificación de intercambio propuesto`,
        );
      } else {
        await this.enviarEmail(empleadoB.user.email, 'Nueva propuesta de intercambio de turno', mensaje);
      }

      await this.crearNotificacionInApp(tenantId, employeeIdB, mensaje);
    } catch (e) {
      this.logger.error(
        `Error notificando a empleado ${employeeIdB} sobre intercambio propuesto: ${(e as Error).message}`,
      );
    }
  }

  /**
   * Notifica al empleado A que B rechazó su propuesta de intercambio. El
   * motivoRechazo es de uso interno; no se incluye en el mensaje, solo en
   * logs. No bloqueante.
   */
  async notificarIntercambioRechazadoPorB(
    tenantId: string,
    employeeIdA: string,
    motivoRechazo?: string | null,
  ): Promise<void> {
    const mensaje = 'Tu propuesta de intercambio de turno fue rechazada';

    try {
      const empleadoA = await this.prisma.employee.findUnique({
        where: { id: employeeIdA },
        select: { id: true, user: { select: { email: true } } },
      });

      if (!empleadoA?.user?.email) {
        this.logger.warn(
          `Empleado ${employeeIdA} no tiene usuario/email asociado; se omite notificación de intercambio rechazado por B`,
        );
      } else {
        await this.enviarEmail(empleadoA.user.email, 'Propuesta de intercambio rechazada', mensaje);
      }

      await this.crearNotificacionInApp(tenantId, employeeIdA, mensaje);
      this.logger.log(`Intercambio rechazado por B para empleado ${employeeIdA} (tenant=${tenantId}). Motivo: ${motivoRechazo ?? 'sin motivo'}`);
    } catch (e) {
      this.logger.error(
        `Error notificando a empleado ${employeeIdA} sobre intercambio rechazado por B: ${(e as Error).message}`,
      );
    }
  }

  /**
   * Notifica al manager del empleado A (resuelto vía Employee.managerId,
   * mismo patrón que notificarSolicitudTrabajoCreada) que el intercambio
   * fue aceptado por B y queda pendiente de su aprobación. No bloqueante.
   */
  async notificarIntercambioAceptadoPorB(
    tenantId: string,
    employeeIdA: string,
    employeeIdB: string,
    fecha: Date,
  ): Promise<void> {
    try {
      const empleadoA = await this.prisma.employee.findUnique({
        where: { id: employeeIdA },
        select: { managerId: true, nombres: true, apellidos: true },
      });

      if (!empleadoA?.managerId) {
        this.logger.warn(
          `Empleado ${employeeIdA} no tiene manager asignado; se omite notificación de intercambio aceptado por B`,
        );
        return;
      }

      const nombreEmpleado = [empleadoA.nombres, empleadoA.apellidos].filter(Boolean).join(' ');
      const mensaje = `Intercambio de turno aceptado entre ${nombreEmpleado || employeeIdA} y su compañero para el ${fecha.toDateString()}. Pendiente de tu aprobación.`;

      const manager = await this.prisma.employee.findUnique({
        where: { id: empleadoA.managerId },
        select: { user: { select: { email: true } } },
      });

      if (!manager?.user?.email) {
        this.logger.warn(
          `Manager ${empleadoA.managerId} no tiene usuario/email asociado; se omite email de intercambio aceptado por B`,
        );
      } else {
        await this.enviarEmail(manager.user.email, 'Intercambio de turno pendiente de aprobación', mensaje);
      }

      await this.crearNotificacionInApp(tenantId, empleadoA.managerId, mensaje);
    } catch (e) {
      this.logger.error(
        `Error notificando a manager sobre intercambio aceptado por B (A=${employeeIdA}): ${(e as Error).message}`,
      );
    }
  }

  /**
   * Notifica a A y B que el intercambio fue aprobado y sus turnos se
   * intercambiaron. fueAutomatico distingue si lo resolvió el manager o el
   * sistema (48h sin decisión, o llegó la fecha del turno). No bloqueante.
   */
  async notificarIntercambioAprobado(
    tenantId: string,
    employeeIdA: string,
    employeeIdB: string,
    fecha: Date,
    fueAutomatico: boolean,
  ): Promise<void> {
    const mensaje = `Intercambio de turno aprobado para el ${fecha.toDateString()}. Tus turnos han sido intercambiados.` +
      (fueAutomatico ? ' (aprobado automáticamente, sin decisión manual del manager)' : '');

    for (const employeeId of [employeeIdA, employeeIdB]) {
      try {
        const empleado = await this.prisma.employee.findUnique({
          where: { id: employeeId },
          select: { id: true, user: { select: { email: true } } },
        });

        if (!empleado?.user?.email) {
          this.logger.warn(
            `Empleado ${employeeId} no tiene usuario/email asociado; se omite notificación de intercambio aprobado`,
          );
        } else {
          await this.enviarEmail(empleado.user.email, 'Intercambio de turno aprobado', mensaje);
        }

        await this.crearNotificacionInApp(tenantId, employeeId, mensaje);
      } catch (e) {
        this.logger.error(
          `Error notificando a empleado ${employeeId} sobre intercambio aprobado: ${(e as Error).message}`,
        );
      }
    }
  }

  /**
   * Notifica a A y B que el intercambio fue rechazado (por el manager, o
   * automáticamente por el sistema — turno modificado desde la propuesta,
   * o fecha alcanzada sin respuesta de B). motivoRechazo se incluye en el
   * mensaje porque en los casos automáticos es información que ambos
   * necesitan para entender qué pasó. No bloqueante.
   */
  async notificarIntercambioRechazado(
    tenantId: string,
    employeeIdA: string,
    employeeIdB: string,
    motivoRechazo?: string | null,
  ): Promise<void> {
    const mensaje = 'Intercambio de turno rechazado' + (motivoRechazo ? `. Motivo: ${motivoRechazo}` : '');

    for (const employeeId of [employeeIdA, employeeIdB]) {
      try {
        const empleado = await this.prisma.employee.findUnique({
          where: { id: employeeId },
          select: { id: true, user: { select: { email: true } } },
        });

        if (!empleado?.user?.email) {
          this.logger.warn(
            `Empleado ${employeeId} no tiene usuario/email asociado; se omite notificación de intercambio rechazado`,
          );
        } else {
          await this.enviarEmail(empleado.user.email, 'Intercambio de turno rechazado', mensaje);
        }

        await this.crearNotificacionInApp(tenantId, employeeId, mensaje);
      } catch (e) {
        this.logger.error(
          `Error notificando a empleado ${employeeId} sobre intercambio rechazado: ${(e as Error).message}`,
        );
      }
    }
  }
```

- [ ] **Step 4: Ejecutar y verificar que pasan**

```bash
pnpm --filter @rrhh/api test -- notification.service.spec
```

Esperado: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/common/services/notification.service.ts apps/api/src/common/services/notification.service.spec.ts
git commit -m "feat(notificaciones): notificar portal de intercambios (5 métodos)"
```

---

### Task 4: Orquestación y barrido perezoso (`IntercambioTurnoAplicadorService`)

**Objetivo:** Decisiones del manager (aprobar/rechazar) + barrido perezoso que resuelve automáticamente por plazo de 48h o por fecha alcanzada + ejecución compartida del swap con validación de staleness.

**Files:**
- Create: `apps/api/src/modules/shifts/intercambio-turno-aplicador.service.ts`
- Test: `apps/api/src/modules/shifts/intercambio-turno-aplicador.service.spec.ts`

**Interfaces:**
- Consumes: `IntercambioTurnoService` (Task 2, sin usar sus métodos directamente — accede a `tx.intercambioTurno` igual que Task 2 para las consultas propias del barrido), `CompensatorioService.intercambiar(tx, { tenantId, fecha, employeeIdA, employeeIdB, creadoPor }): Promise<{ a: any; b: any }>` (ya existente, sin cambios), `NotificationService.notificarIntercambioAprobado`/`notificarIntercambioRechazado` (Task 3).
- Produces (usado por Task 5):
  - `class IntercambioTurnoAplicadorService { barrido(tx, tenantId: string): Promise<void>; aprobar(tx, tenantId: string, id: string, managerId: string): Promise<any>; rechazarManager(tx, tenantId: string, id: string, managerId: string, motivoRechazo?: string): Promise<any> }`

- [ ] **Step 1: Escribir los tests que fallan**

```typescript
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { IntercambioTurnoAplicadorService } from './intercambio-turno-aplicador.service';
import { CompensatorioService } from './compensatorio.service';

function mockTx(seed: Record<string, any> = {}) {
  const intercambios = new Map<string, any>(Object.entries(seed.intercambios ?? {}));
  const asignaciones = new Map<string, any>(Object.entries(seed.asignaciones ?? {}));

  return {
    intercambioTurno: {
      findUnique: jest.fn(async ({ where }: any) => intercambios.get(where.id) ?? null),
      findMany: jest.fn(async ({ where }: any) =>
        [...intercambios.values()].filter(
          (it) => it.tenantId === where.tenantId && it.estado === where.estado
                  && (!where.fecha?.lte || it.fecha <= where.fecha.lte),
        ),
      ),
      update: jest.fn(async ({ where, data }: any) => {
        const updated = { ...intercambios.get(where.id), ...data };
        intercambios.set(where.id, updated);
        return updated;
      }),
    },
    turnoAsignacion: {
      findUnique: jest.fn(async ({ where }: any) => {
        const k = where.tenantId_employeeId_fecha;
        return asignaciones.get(`${k.employeeId}|${k.fecha.toISOString().slice(0, 10)}`) ?? null;
      }),
      update: jest.fn(async ({ where, data }: any) => ({ id: where.id, ...data })),
    },
    employee: {
      findUnique: jest.fn(async ({ where }: any) => ({ id: where.id, numeroDocumento: where.id })),
    },
    _intercambios: intercambios,
    _asignaciones: asignaciones,
  };
}

function intercambio(overrides: any = {}) {
  return {
    id: 'int-1', tenantId: 't-1', employeeIdA: 'emp-a', employeeIdB: 'emp-b',
    fecha: new Date(2026, 8, 10), turnoActualA: 'TURNO', turnoActualB: 'TURNO',
    estado: 'ACEPTADA_POR_B', aceptadoEn: new Date(), ...overrides,
  };
}

function asignacion(tipoDia = 'TURNO') {
  return { id: `asig-${Math.random()}`, tipoDia, turnoId: 'turno-x' };
}

describe('IntercambioTurnoAplicadorService', () => {
  let notificationService: any;
  let service: IntercambioTurnoAplicadorService;

  beforeEach(() => {
    notificationService = {
      notificarIntercambioAprobado: jest.fn().mockResolvedValue(undefined),
      notificarIntercambioRechazado: jest.fn().mockResolvedValue(undefined),
    };
    service = new IntercambioTurnoAplicadorService(new CompensatorioService(), notificationService);
  });

  describe('aprobar (decisión del manager)', () => {
    it('ejecuta el swap cuando el turno sigue coincidiendo con lo propuesto', async () => {
      const tx = mockTx({
        intercambios: { 'int-1': intercambio() },
        asignaciones: { 'emp-a|2026-09-10': asignacion(), 'emp-b|2026-09-10': asignacion() },
      });

      const resultado = await service.aprobar(tx, 't-1', 'int-1', 'mgr-1');

      expect(resultado.estado).toBe('APROBADA_MANAGER');
      expect(resultado.decididoPor).toBe('mgr-1');
      expect(notificationService.notificarIntercambioAprobado).toHaveBeenCalledWith(
        't-1', 'emp-a', 'emp-b', expect.any(Date), false,
      );
    });

    it('cierra como RECHAZADA_AUTOMATICA si el turno de A cambió desde la propuesta', async () => {
      const tx = mockTx({
        intercambios: { 'int-1': intercambio() },
        asignaciones: { 'emp-a|2026-09-10': asignacion('DESCANSO'), 'emp-b|2026-09-10': asignacion() },
      });

      const resultado = await service.aprobar(tx, 't-1', 'int-1', 'mgr-1');

      expect(resultado.estado).toBe('RECHAZADA_AUTOMATICA');
      expect(resultado.motivoResolucion).toBe('TURNO_MODIFICADO');
      expect(notificationService.notificarIntercambioRechazado).toHaveBeenCalled();
    });

    it('lanza BadRequestException si ya no está en ACEPTADA_POR_B', async () => {
      const tx = mockTx({ intercambios: { 'int-1': intercambio({ estado: 'RECHAZADA_POR_B' }) } });
      await expect(service.aprobar(tx, 't-1', 'int-1', 'mgr-1')).rejects.toThrow(BadRequestException);
    });

    it('lanza NotFoundException si el id no existe', async () => {
      const tx = mockTx();
      await expect(service.aprobar(tx, 't-1', 'no-existe', 'mgr-1')).rejects.toThrow(NotFoundException);
    });
  });

  describe('rechazarManager', () => {
    it('cierra como RECHAZADA_MANAGER sin ejecutar el swap', async () => {
      const tx = mockTx({ intercambios: { 'int-1': intercambio() } });
      const resultado = await service.rechazarManager(tx, 't-1', 'int-1', 'mgr-1', 'No hay cobertura');
      expect(resultado.estado).toBe('RECHAZADA_MANAGER');
      expect(resultado.motivoRechazo).toBe('No hay cobertura');
      expect(tx.turnoAsignacion.update).not.toHaveBeenCalled();
    });
  });

  describe('barrido', () => {
    it('auto-aprueba una ACEPTADA_POR_B con más de 48h desde aceptadoEn', async () => {
      const hace49h = new Date(Date.now() - 49 * 60 * 60 * 1000);
      const fechaFutura = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
      fechaFutura.setHours(0, 0, 0, 0);
      const tx = mockTx({
        intercambios: { 'int-1': intercambio({ fecha: fechaFutura, aceptadoEn: hace49h }) },
        asignaciones: {
          [`emp-a|${fechaFutura.toISOString().slice(0, 10)}`]: asignacion(),
          [`emp-b|${fechaFutura.toISOString().slice(0, 10)}`]: asignacion(),
        },
      });

      await service.barrido(tx, 't-1');

      const actualizado = await tx.intercambioTurno.findUnique({ where: { id: 'int-1' } });
      expect(actualizado.estado).toBe('AUTO_APROBADA');
      expect(actualizado.motivoResolucion).toBe('PLAZO_48H');
    });

    it('auto-aprueba una ACEPTADA_POR_B cuya fecha ya llegó, aunque no pasaron 48h', async () => {
      const haceUnaHora = new Date(Date.now() - 60 * 60 * 1000);
      const hoy = new Date();
      hoy.setHours(0, 0, 0, 0);
      const tx = mockTx({
        intercambios: { 'int-1': intercambio({ fecha: hoy, aceptadoEn: haceUnaHora }) },
        asignaciones: {
          [`emp-a|${hoy.toISOString().slice(0, 10)}`]: asignacion(),
          [`emp-b|${hoy.toISOString().slice(0, 10)}`]: asignacion(),
        },
      });

      await service.barrido(tx, 't-1');

      const actualizado = await tx.intercambioTurno.findUnique({ where: { id: 'int-1' } });
      expect(actualizado.estado).toBe('AUTO_APROBADA');
      expect(actualizado.motivoResolucion).toBe('FECHA_ALCANZADA');
    });

    it('cierra como RECHAZADA_AUTOMATICA una PENDIENTE_ACEPTACION_B cuya fecha ya llegó', async () => {
      const hoy = new Date();
      hoy.setHours(0, 0, 0, 0);
      const tx = mockTx({
        intercambios: { 'int-1': intercambio({ estado: 'PENDIENTE_ACEPTACION_B', fecha: hoy, aceptadoEn: null }) },
      });

      await service.barrido(tx, 't-1');

      const actualizado = await tx.intercambioTurno.findUnique({ where: { id: 'int-1' } });
      expect(actualizado.estado).toBe('RECHAZADA_AUTOMATICA');
      expect(actualizado.motivoResolucion).toBe('FECHA_ALCANZADA_SIN_RESPUESTA_B');
    });

    it('no toca una ACEPTADA_POR_B reciente cuya fecha es futura', async () => {
      const haceUnaHora = new Date(Date.now() - 60 * 60 * 1000);
      const fechaFutura = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
      const tx = mockTx({
        intercambios: { 'int-1': intercambio({ fecha: fechaFutura, aceptadoEn: haceUnaHora }) },
      });

      await service.barrido(tx, 't-1');

      const actualizado = await tx.intercambioTurno.findUnique({ where: { id: 'int-1' } });
      expect(actualizado.estado).toBe('ACEPTADA_POR_B');
    });

    it('el guard de aprobar/rechazarManager rechaza una propuesta que el barrido ya auto-resolvió', async () => {
      const hoy = new Date();
      hoy.setHours(0, 0, 0, 0);
      const tx = mockTx({
        intercambios: { 'int-1': intercambio({ fecha: hoy, aceptadoEn: new Date() }) },
        asignaciones: {
          [`emp-a|${hoy.toISOString().slice(0, 10)}`]: asignacion(),
          [`emp-b|${hoy.toISOString().slice(0, 10)}`]: asignacion(),
        },
      });

      // El manager llama aprobar() DESPUÉS de que el barrido (corrido dentro
      // del mismo aprobar()) ya resolvió automáticamente por FECHA_ALCANZADA.
      await expect(service.rechazarManager(tx, 't-1', 'int-1', 'mgr-1')).rejects.toThrow(
        /ya no está pendiente/,
      );
    });
  });
});
```

- [ ] **Step 2: Ejecutar y verificar que fallan**

```bash
pnpm --filter @rrhh/api test -- intercambio-turno-aplicador.service.spec
```

Esperado: FAIL — módulo no encontrado.

- [ ] **Step 3: Implementar `IntercambioTurnoAplicadorService`**

```typescript
import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { CompensatorioService } from './compensatorio.service';
import { NotificationService } from '../../common/services/notification.service';
import type { MotivoResolucionIntercambio } from './intercambio-turno.service';

const HORAS_PLAZO_MANAGER = 48;

/**
 * Orquesta las decisiones del manager (aprobar/rechazar) y el barrido
 * perezoso que resuelve automáticamente los intercambios ACEPTADA_POR_B
 * cuando pasan 48h sin decisión, o cuando la fecha del turno llega antes
 * (ver diseño §4.2/§4.3). No hay cron en el repo: `barrido` se llama al
 * inicio de cada endpoint del módulo (Task 5), no en background.
 */
@Injectable()
export class IntercambioTurnoAplicadorService {
  constructor(
    private readonly compensatorios: CompensatorioService,
    private readonly notificationService: NotificationService,
  ) {}

  async barrido(tx: any, tenantId: string): Promise<void> {
    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);

    const sinRespuestaB = await tx.intercambioTurno.findMany({
      where: { tenantId, estado: 'PENDIENTE_ACEPTACION_B', fecha: { lte: hoy } },
    });
    for (const it of sinRespuestaB) {
      await this.cerrarSinEjecutar(tx, it, 'FECHA_ALCANZADA_SIN_RESPUESTA_B');
    }

    const limitePlazo = new Date();
    limitePlazo.setHours(limitePlazo.getHours() - HORAS_PLAZO_MANAGER);

    const aceptadas = await tx.intercambioTurno.findMany({
      where: { tenantId, estado: 'ACEPTADA_POR_B' },
    });
    for (const it of aceptadas) {
      const porFecha = it.fecha <= hoy;
      const porPlazo = !porFecha && it.aceptadoEn && it.aceptadoEn <= limitePlazo;
      if (porFecha || porPlazo) {
        await this.ejecutarSwap(tx, it, {
          decididoPor: null,
          estadoAprobado: 'AUTO_APROBADA',
          motivoResolucion: porFecha ? 'FECHA_ALCANZADA' : 'PLAZO_48H',
        });
      }
    }
  }

  async aprobar(tx: any, tenantId: string, id: string, managerId: string): Promise<any> {
    await this.barrido(tx, tenantId);
    const it = await this.obtenerAceptadaPorB(tx, id);
    return this.ejecutarSwap(tx, it, { decididoPor: managerId, estadoAprobado: 'APROBADA_MANAGER' });
  }

  async rechazarManager(
    tx: any,
    tenantId: string,
    id: string,
    managerId: string,
    motivoRechazo?: string,
  ): Promise<any> {
    await this.barrido(tx, tenantId);
    const it = await this.obtenerAceptadaPorB(tx, id);
    return this.cerrarSinEjecutar(tx, it, undefined, {
      decididoPor: managerId,
      motivoRechazo,
      estado: 'RECHAZADA_MANAGER',
    });
  }

  private async obtenerAceptadaPorB(tx: any, id: string): Promise<any> {
    const it = await tx.intercambioTurno.findUnique({ where: { id } });
    if (!it) {
      throw new NotFoundException(`Intercambio ${id} no encontrado`);
    }
    if (it.estado !== 'ACEPTADA_POR_B') {
      throw new BadRequestException(
        `Este intercambio ya no está pendiente de tu decisión (estado actual: ${it.estado})`,
      );
    }
    return it;
  }

  private async ejecutarSwap(
    tx: any,
    it: any,
    opts: { decididoPor: string | null; estadoAprobado: 'APROBADA_MANAGER' | 'AUTO_APROBADA'; motivoResolucion?: MotivoResolucionIntercambio },
  ): Promise<any> {
    const [asigA, asigB] = await Promise.all([
      tx.turnoAsignacion.findUnique({
        where: { tenantId_employeeId_fecha: { tenantId: it.tenantId, employeeId: it.employeeIdA, fecha: it.fecha } },
      }),
      tx.turnoAsignacion.findUnique({
        where: { tenantId_employeeId_fecha: { tenantId: it.tenantId, employeeId: it.employeeIdB, fecha: it.fecha } },
      }),
    ]);

    const turnoModificado = !asigA || !asigB || asigA.tipoDia !== it.turnoActualA || asigB.tipoDia !== it.turnoActualB;
    if (turnoModificado) {
      return this.cerrarSinEjecutar(tx, it, 'TURNO_MODIFICADO');
    }

    const { a, b } = await this.compensatorios.intercambiar(tx, {
      tenantId: it.tenantId,
      fecha: it.fecha,
      employeeIdA: it.employeeIdA,
      employeeIdB: it.employeeIdB,
      creadoPor: opts.decididoPor ?? it.employeeIdA,
    });

    const actualizado = await tx.intercambioTurno.update({
      where: { id: it.id },
      data: {
        estado: opts.estadoAprobado,
        motivoResolucion: opts.motivoResolucion ?? null,
        decididoPor: opts.decididoPor,
        decididoEn: new Date(),
        turnoAsignacionAId: a.id,
        turnoAsignacionBId: b.id,
      },
    });

    try {
      await this.notificationService.notificarIntercambioAprobado(
        it.tenantId, it.employeeIdA, it.employeeIdB, it.fecha, opts.estadoAprobado === 'AUTO_APROBADA',
      );
    } catch {
      // No bloqueante: NotificationService ya loguea internamente sus errores.
    }

    return actualizado;
  }

  private async cerrarSinEjecutar(
    tx: any,
    it: any,
    motivoResolucion?: MotivoResolucionIntercambio,
    manual?: { decididoPor: string; motivoRechazo?: string; estado: 'RECHAZADA_MANAGER' },
  ): Promise<any> {
    const estado = manual?.estado ?? 'RECHAZADA_AUTOMATICA';
    const motivoRechazo = manual?.motivoRechazo ?? (motivoResolucion ? this.describirMotivo(motivoResolucion) : null);

    const actualizado = await tx.intercambioTurno.update({
      where: { id: it.id },
      data: {
        estado,
        motivoResolucion: motivoResolucion ?? null,
        motivoRechazo,
        decididoPor: manual?.decididoPor ?? null,
        decididoEn: new Date(),
      },
    });

    try {
      await this.notificationService.notificarIntercambioRechazado(
        it.tenantId, it.employeeIdA, it.employeeIdB, motivoRechazo ?? undefined,
      );
    } catch {
      // No bloqueante: NotificationService ya loguea internamente sus errores.
    }

    return actualizado;
  }

  private describirMotivo(motivo: MotivoResolucionIntercambio): string {
    if (motivo === 'TURNO_MODIFICADO') return 'El turno de uno de los empleados cambió desde la propuesta';
    if (motivo === 'FECHA_ALCANZADA_SIN_RESPUESTA_B') return 'La fecha del turno llegó sin respuesta del empleado B';
    return '';
  }
}
```

- [ ] **Step 4: Ejecutar y verificar que pasan**

```bash
pnpm --filter @rrhh/api test -- intercambio-turno-aplicador.service.spec
```

Esperado: PASS, 10/10.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/shifts/intercambio-turno-aplicador.service.ts apps/api/src/modules/shifts/intercambio-turno-aplicador.service.spec.ts
git commit -m "feat(turnos-fase-9): orquestación aprobación/rechazo + barrido perezoso 48h/fecha"
```

---

### Task 5: API Endpoints + Controller RBAC

**Objetivo:** Registrar los dos servicios en `ShiftsModule` y agregar los 8 endpoints REST a `ShiftsController`.

**Files:**
- Modify: `apps/api/src/modules/shifts/shifts.module.ts`
- Modify: `apps/api/src/modules/shifts/shifts.controller.ts`
- Test: `apps/api/src/modules/shifts/shifts.controller.spec.ts`

**Interfaces:**
- Consumes: `IntercambioTurnoService` (Task 2), `IntercambioTurnoAplicadorService` (Task 4), `NotificationService` (Task 3, ya inyectado en el controller), `getTenantContext`/`requireIdentity`/`parseFecha` (helpers ya existentes en `shifts.controller.ts`).
- Produces: 8 endpoints bajo `/turnos/intercambios/*`.

- [ ] **Step 1: Registrar los servicios en `ShiftsModule`**

```typescript
// shifts.module.ts — agregar imports y providers
import { IntercambioTurnoService } from './intercambio-turno.service';
import { IntercambioTurnoAplicadorService } from './intercambio-turno-aplicador.service';

// dentro de providers: [...]
    IntercambioTurnoService,
    IntercambioTurnoAplicadorService,
```

- [ ] **Step 2: Escribir los tests de controller que fallan**

Agregar al final de `shifts.controller.spec.ts` un nuevo `describe`:

```typescript
describe('ShiftsController - Portal de Intercambios', () => {
  let controller: ShiftsController;
  let mockIntercambios: any;
  let mockIntercambiosAplicador: any;
  let mockRequestEmpleado: any;
  let mockRequestManager: any;

  beforeEach(() => {
    mockTenantContext = { tenantId: 't-1', userId: 'u-a', tx: mockTx({
      employee: { findFirst: jest.fn().mockResolvedValue({ id: 'emp-a' }) },
    }) };

    mockIntercambios = {
      proponer: jest.fn(),
      listarMisPropuestas: jest.fn(),
      listarPropuestasParaMi: jest.fn(),
      aceptar: jest.fn(),
      rechazarPorB: jest.fn(),
    };
    mockIntercambiosAplicador = {
      barrido: jest.fn().mockResolvedValue(undefined),
      aprobar: jest.fn(),
      rechazarManager: jest.fn(),
    };

    mockRequestEmpleado = { session: { permissions: ['shift.read'] } };
    mockRequestManager = { session: { permissions: ['shift.resolve'] } };

    controller = new ShiftsController(
      {} as any, {} as any, {} as any, {} as any, {} as any, {} as any,
      {} as any, {} as any, {} as any, {} as any,
      { notificarIntercambioPropuesto: jest.fn(), notificarIntercambioAceptadoPorB: jest.fn(), notificarIntercambioRechazadoPorB: jest.fn() } as any,
      mockIntercambios,
      mockIntercambiosAplicador,
    );
  });

  it('POST proponer: crea la propuesta y notifica a B', async () => {
    mockIntercambios.proponer.mockResolvedValue({ id: 'int-1', employeeIdB: 'emp-b' });
    const dto = { employeeIdB: 'emp-b', fecha: '2026-09-10', mensajeA: 'Tengo cita' };

    const resultado = await controller.proponerIntercambio(mockRequestEmpleado, dto);

    expect(mockIntercambios.proponer).toHaveBeenCalled();
    expect(resultado.id).toBe('int-1');
  });

  it('POST proponer: 400 si falta employeeIdB o fecha', async () => {
    await expect(controller.proponerIntercambio(mockRequestEmpleado, { fecha: '2026-09-10' })).rejects.toThrow(
      BadRequestException,
    );
  });

  it('GET mis-propuestas: delega en el service con el employeeId resuelto', async () => {
    mockIntercambios.listarMisPropuestas.mockResolvedValue([]);
    await controller.listarMisPropuestasIntercambio(mockRequestEmpleado);
    expect(mockIntercambios.listarMisPropuestas).toHaveBeenCalledWith(expect.anything(), 't-1', 'emp-a');
  });

  it('PUT :id/aceptar: corre el barrido antes de aceptar', async () => {
    mockIntercambios.aceptar.mockResolvedValue({ id: 'int-1', estado: 'ACEPTADA_POR_B', employeeIdA: 'emp-a', employeeIdB: 'emp-a' });
    await controller.aceptarIntercambio(mockRequestEmpleado, 'int-1');
    expect(mockIntercambiosAplicador.barrido).toHaveBeenCalledWith(expect.anything(), 't-1');
    expect(mockIntercambios.aceptar).toHaveBeenCalled();
  });

  it('PUT :id/aprobar: requiere shift.resolve', async () => {
    mockIntercambiosAplicador.aprobar.mockResolvedValue({ id: 'int-1', estado: 'APROBADA_MANAGER' });
    const resultado = await controller.aprobarIntercambio(mockRequestManager, 'int-1');
    expect(resultado.estado).toBe('APROBADA_MANAGER');
  });

  it('PUT :id/rechazar-manager: pasa motivoRechazo', async () => {
    mockIntercambiosAplicador.rechazarManager.mockResolvedValue({ id: 'int-1', estado: 'RECHAZADA_MANAGER' });
    await controller.rechazarIntercambioManager(mockRequestManager, 'int-1', { motivoRechazo: 'Sin cobertura' });
    expect(mockIntercambiosAplicador.rechazarManager).toHaveBeenCalledWith(
      expect.anything(), 't-1', 'int-1', 'emp-a', 'Sin cobertura',
    );
  });
});
```

- [ ] **Step 3: Ejecutar y verificar que fallan**

```bash
pnpm --filter @rrhh/api test -- shifts.controller.spec
```

Esperado: FAIL — el constructor de `ShiftsController` no acepta 13 argumentos, `controller.proponerIntercambio` no existe.

- [ ] **Step 4: Implementar los endpoints**

Actualizar el constructor del controller (agregar 2 parámetros):

```typescript
    private readonly notificacion: NotificationService,
    private readonly intercambios: IntercambioTurnoService,
    private readonly intercambiosAplicador: IntercambioTurnoAplicadorService,
  ) {}
```

Agregar los imports correspondientes al inicio del archivo:

```typescript
import { IntercambioTurnoService } from './intercambio-turno.service';
import { IntercambioTurnoAplicadorService } from './intercambio-turno-aplicador.service';
```

Agregar los 8 endpoints (después de la sección `// --- Intercambio y compensatorios ---` existente, que es el swap manager-directo de Fase 5 y no cambia):

```typescript
  // --- Portal de intercambios autoservicio (fase 9) ---
  @Post('intercambios/proponer')
  @RequirePermission('shift.read')
  async proponerIntercambio(@Req() request: Request, @Body() dto: any) {
    if (!dto?.employeeIdB || !dto?.fecha) {
      throw new BadRequestException('employeeIdB y fecha son obligatorios');
    }
    const ctx = getTenantContext();
    const { tenantId, userId } = requireIdentity(ctx);
    const empleadoA = await ctx.tx.employee.findFirst({ where: { userId } });
    if (!empleadoA) {
      throw new BadRequestException('La sesión no tiene un empleado asociado');
    }

    await this.intercambiosAplicador.barrido(ctx.tx, tenantId);
    const fecha = parseFecha(dto.fecha, 'fecha');
    const intercambio = await this.intercambios.proponer(ctx.tx, {
      tenantId,
      employeeIdA: empleadoA.id,
      employeeIdB: dto.employeeIdB,
      fecha,
      mensajeA: dto.mensajeA,
      creadoPor: userId,
    });

    try {
      await this.notificacion.notificarIntercambioPropuesto(
        tenantId, empleadoA.id, dto.employeeIdB, fecha, dto.mensajeA,
      );
    } catch {
      // No bloqueante: NotificationService ya loguea internamente sus errores.
    }

    return intercambio;
  }

  @Get('intercambios/mis-propuestas')
  @RequirePermission('shift.read')
  async listarMisPropuestasIntercambio(@Req() request: Request) {
    const ctx = getTenantContext();
    const { tenantId, userId } = requireIdentity(ctx);
    const empleado = await ctx.tx.employee.findFirst({ where: { userId } });
    if (!empleado) {
      throw new BadRequestException('La sesión no tiene un empleado asociado');
    }
    await this.intercambiosAplicador.barrido(ctx.tx, tenantId);
    return this.intercambios.listarMisPropuestas(ctx.tx, tenantId, empleado.id);
  }

  @Get('intercambios/propuestas-para-mi')
  @RequirePermission('shift.read')
  async listarPropuestasParaMiIntercambio(@Req() request: Request) {
    const ctx = getTenantContext();
    const { tenantId, userId } = requireIdentity(ctx);
    const empleado = await ctx.tx.employee.findFirst({ where: { userId } });
    if (!empleado) {
      throw new BadRequestException('La sesión no tiene un empleado asociado');
    }
    await this.intercambiosAplicador.barrido(ctx.tx, tenantId);
    return this.intercambios.listarPropuestasParaMi(ctx.tx, tenantId, empleado.id);
  }

  @Put('intercambios/:id/aceptar')
  @RequirePermission('shift.read')
  async aceptarIntercambio(@Req() request: Request, @Param('id') id: string) {
    const ctx = getTenantContext();
    const { tenantId, userId } = requireIdentity(ctx);
    const empleado = await ctx.tx.employee.findFirst({ where: { userId } });
    if (!empleado) {
      throw new BadRequestException('La sesión no tiene un empleado asociado');
    }
    await this.intercambiosAplicador.barrido(ctx.tx, tenantId);
    const intercambio = await this.intercambios.aceptar(ctx.tx, tenantId, id, empleado.id);

    try {
      await this.notificacion.notificarIntercambioAceptadoPorB(
        tenantId, intercambio.employeeIdA, intercambio.employeeIdB, intercambio.fecha,
      );
    } catch {
      // No bloqueante: NotificationService ya loguea internamente sus errores.
    }

    return intercambio;
  }

  @Put('intercambios/:id/rechazar')
  @RequirePermission('shift.read')
  async rechazarIntercambioPorB(@Req() request: Request, @Param('id') id: string, @Body() dto: any) {
    const ctx = getTenantContext();
    const { tenantId, userId } = requireIdentity(ctx);
    const empleado = await ctx.tx.employee.findFirst({ where: { userId } });
    if (!empleado) {
      throw new BadRequestException('La sesión no tiene un empleado asociado');
    }
    await this.intercambiosAplicador.barrido(ctx.tx, tenantId);
    const intercambio = await this.intercambios.rechazarPorB(ctx.tx, tenantId, id, empleado.id, dto?.motivoRechazo);

    try {
      await this.notificacion.notificarIntercambioRechazadoPorB(tenantId, intercambio.employeeIdA, dto?.motivoRechazo);
    } catch {
      // No bloqueante: NotificationService ya loguea internamente sus errores.
    }

    return intercambio;
  }

  @Get('intercambios/pendientes')
  @RequirePermission('shift.resolve')
  async listarIntercambiosPendientes(@Req() request: Request) {
    const ctx = getTenantContext();
    const { tenantId } = requireIdentity(ctx);
    await this.intercambiosAplicador.barrido(ctx.tx, tenantId);
    return ctx.tx.intercambioTurno.findMany({
      where: { tenantId, estado: 'ACEPTADA_POR_B' },
      orderBy: { aceptadoEn: 'asc' },
    });
  }

  @Put('intercambios/:id/aprobar')
  @RequirePermission('shift.resolve')
  async aprobarIntercambio(@Req() request: Request, @Param('id') id: string) {
    const ctx = getTenantContext();
    const { tenantId, userId } = requireIdentity(ctx);
    const manager = await ctx.tx.employee.findFirst({ where: { userId } });
    if (!manager) {
      throw new BadRequestException('La sesión no tiene un empleado asociado');
    }
    return this.intercambiosAplicador.aprobar(ctx.tx, tenantId, id, manager.id);
  }

  @Put('intercambios/:id/rechazar-manager')
  @RequirePermission('shift.resolve')
  async rechazarIntercambioManager(@Req() request: Request, @Param('id') id: string, @Body() dto: any) {
    const ctx = getTenantContext();
    const { tenantId, userId } = requireIdentity(ctx);
    const manager = await ctx.tx.employee.findFirst({ where: { userId } });
    if (!manager) {
      throw new BadRequestException('La sesión no tiene un empleado asociado');
    }
    return this.intercambiosAplicador.rechazarManager(ctx.tx, tenantId, id, manager.id, dto?.motivoRechazo);
  }
```

- [ ] **Step 5: Ejecutar y verificar que pasan**

```bash
pnpm --filter @rrhh/api test -- shifts.controller.spec
pnpm --filter @rrhh/api exec tsc --noEmit
```

Esperado: PASS, 0 errores TypeScript. Nota: los `describe` existentes de `shifts.controller.spec.ts` instancian `ShiftsController` con menos argumentos — como los 2 nuevos parámetros del constructor van al final, esos tests siguen pasando con `undefined` en esas posiciones (no los usan).

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/shifts/shifts.module.ts apps/api/src/modules/shifts/shifts.controller.ts apps/api/src/modules/shifts/shifts.controller.spec.ts
git commit -m "feat(turnos-fase-9): API endpoints + controller RBAC (portal de intercambios)"
```

---

### Task 6: Frontend — Tab Empleado (Proponer / Mis Propuestas / Propuestas para Mí)

**Objetivo:** Agregar funciones a `shifts-api.ts` y un tab de empleado con 3 secciones.

**Files:**
- Modify: `apps/web/src/app/(app)/turnos/shifts-api.ts`
- Create: `apps/web/src/app/(app)/turnos/intercambios-empleado-tab.tsx`
- Modify: `apps/web/src/app/(app)/turnos/page.tsx`

**Interfaces:**
- Produces: `IntercambioTurno` (tipo), `proponerIntercambio`, `listarMisPropuestasIntercambio`, `listarPropuestasParaMiIntercambio`, `aceptarIntercambio`, `rechazarIntercambioPorB` en `shifts-api.ts`; componente `IntercambiosEmpleadoTab`.

- [ ] **Step 1: Agregar tipos y funciones a `shifts-api.ts`**

Agregar al final del archivo:

```typescript
// ---------------------------------------------------------------------------
// Portal de Intercambios (Empleado)
// ---------------------------------------------------------------------------

export type EstadoIntercambio =
  | 'PENDIENTE_ACEPTACION_B'
  | 'RECHAZADA_POR_B'
  | 'ACEPTADA_POR_B'
  | 'APROBADA_MANAGER'
  | 'RECHAZADA_MANAGER'
  | 'AUTO_APROBADA'
  | 'RECHAZADA_AUTOMATICA';

export interface IntercambioTurno {
  id: string;
  employeeIdA: string;
  employeeIdB: string;
  fecha: string;
  turnoActualA: TipoDiaPlan;
  turnoActualB: TipoDiaPlan;
  mensajeA?: string | null;
  estado: EstadoIntercambio;
  motivoRechazo?: string | null;
  motivoResolucion?: string | null;
  aceptadoEn?: string | null;
  decididoEn?: string | null;
  creadoEn: string;
}

export async function proponerIntercambio(input: {
  employeeIdB: string;
  fecha: string;
  mensajeA?: string;
}): Promise<IntercambioTurno> {
  return ok(
    await apiFetch('/turnos/intercambios/proponer', { method: 'POST', body: JSON.stringify(input) }),
    'proponer el intercambio',
  );
}

export const listarMisPropuestasIntercambio = async (): Promise<IntercambioTurno[]> =>
  ok(await apiFetch('/turnos/intercambios/mis-propuestas'), 'listar mis propuestas');

export const listarPropuestasParaMiIntercambio = async (): Promise<IntercambioTurno[]> =>
  ok(await apiFetch('/turnos/intercambios/propuestas-para-mi'), 'listar propuestas para mí');

export const aceptarIntercambio = async (id: string): Promise<IntercambioTurno> =>
  ok(await apiFetch(`/turnos/intercambios/${id}/aceptar`, { method: 'PUT' }), 'aceptar el intercambio');

export const rechazarIntercambioPorB = async (id: string, motivoRechazo?: string): Promise<IntercambioTurno> =>
  ok(
    await apiFetch(`/turnos/intercambios/${id}/rechazar`, { method: 'PUT', body: JSON.stringify({ motivoRechazo }) }),
    'rechazar el intercambio',
  );
```

- [ ] **Step 2: Crear `intercambios-empleado-tab.tsx`**

```tsx
'use client';

import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/components/auth-context';
import { EmpleadoResumen, listarEmpleados } from '../vacaciones/vacations-api';
import {
  IntercambioTurno, proponerIntercambio, listarMisPropuestasIntercambio,
  listarPropuestasParaMiIntercambio, aceptarIntercambio, rechazarIntercambioPorB,
} from './shifts-api';

const COLOR_ESTADO: Record<string, string> = {
  PENDIENTE_ACEPTACION_B: 'bg-yellow-100 text-yellow-800',
  ACEPTADA_POR_B: 'bg-blue-100 text-blue-800',
  RECHAZADA_POR_B: 'bg-red-100 text-red-800',
  APROBADA_MANAGER: 'bg-emerald-100 text-emerald-800',
  AUTO_APROBADA: 'bg-emerald-100 text-emerald-800',
  RECHAZADA_MANAGER: 'bg-red-100 text-red-800',
  RECHAZADA_AUTOMATICA: 'bg-red-100 text-red-800',
};

export function IntercambiosEmpleadoTab() {
  const { me } = useAuth();
  const [misPropuestas, setMisPropuestas] = useState<IntercambioTurno[]>([]);
  const [propuestasParaMi, setPropuestasParaMi] = useState<IntercambioTurno[]>([]);
  const [empleados, setEmpleados] = useState<EmpleadoResumen[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({ employeeIdB: '', fecha: '', mensajeA: '' });
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!me?.userId) return;
    refrescar();
    listarEmpleados().then(setEmpleados).catch((e) => setError((e as Error).message));
  }, [me?.userId]);

  async function refrescar() {
    setError(null);
    setIsLoading(true);
    try {
      const [mias, paraMi] = await Promise.all([
        listarMisPropuestasIntercambio(),
        listarPropuestasParaMiIntercambio(),
      ]);
      setMisPropuestas(mias);
      setPropuestasParaMi(paraMi);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setIsLoading(false);
    }
  }

  const nombreEmpleado = useMemo(
    () => (id: string) => {
      const emp = empleados.find((e) => e.id === id);
      return emp ? `${emp.nombres} ${emp.apellidos}` : id.slice(0, 8);
    },
    [empleados],
  );

  const handleProponer = async () => {
    if (!form.employeeIdB || !form.fecha) {
      setError('Debe seleccionar un empleado y una fecha');
      return;
    }
    setError(null);
    setSuccess(null);
    setIsSaving(true);
    try {
      await proponerIntercambio(form);
      setSuccess('Propuesta de intercambio enviada');
      setShowModal(false);
      setForm({ employeeIdB: '', fecha: '', mensajeA: '' });
      await refrescar();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setIsSaving(false);
    }
  };

  const handleAceptar = async (id: string) => {
    setError(null);
    try {
      await aceptarIntercambio(id);
      setSuccess('Intercambio aceptado, pendiente de aprobación del manager');
      await refrescar();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const handleRechazar = async (id: string) => {
    setError(null);
    try {
      await rechazarIntercambioPorB(id);
      setSuccess('Propuesta rechazada');
      await refrescar();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div className="space-y-6 text-sm">
      {error && <p className="rounded bg-red-50 px-3 py-2 text-red-700">{error}</p>}
      {success && <p className="rounded bg-emerald-50 px-3 py-2 text-emerald-700">{success}</p>}

      <div className="flex items-center justify-between">
        <h2 className="font-semibold text-slate-800">Propuestas para mí</h2>
        <button
          onClick={() => setShowModal(true)}
          className="rounded bg-slate-900 px-4 py-2 font-medium text-white hover:bg-slate-800"
        >
          + PROPONER INTERCAMBIO
        </button>
      </div>

      {isLoading ? (
        <p className="text-slate-500">Cargando...</p>
      ) : propuestasParaMi.length === 0 ? (
        <p className="rounded bg-slate-50 px-3 py-3 text-slate-500">No tienes propuestas pendientes.</p>
      ) : (
        <div className="space-y-3">
          {propuestasParaMi.map((it) => (
            <div key={it.id} className="rounded border border-slate-200 bg-white p-4">
              <div className="mb-2 flex items-start justify-between">
                <div>
                  <p className="text-slate-700">
                    <span className="font-medium">{nombreEmpleado(it.employeeIdA)}</span> propone intercambiar el{' '}
                    <span className="font-medium">{it.fecha.slice(0, 10)}</span>
                  </p>
                  {it.mensajeA && <p className="mt-1 text-xs text-slate-500">Mensaje: {it.mensajeA}</p>}
                </div>
                <span className={`rounded px-2 py-1 text-xs font-medium ${COLOR_ESTADO[it.estado] ?? ''}`}>
                  {it.estado}
                </span>
              </div>
              {it.estado === 'PENDIENTE_ACEPTACION_B' && (
                <div className="mt-2 flex gap-2">
                  <button
                    onClick={() => handleAceptar(it.id)}
                    className="rounded bg-emerald-600 px-3 py-1 text-xs font-medium text-white hover:bg-emerald-700"
                  >
                    Aceptar
                  </button>
                  <button
                    onClick={() => handleRechazar(it.id)}
                    className="rounded border border-slate-300 px-3 py-1 text-xs font-medium hover:bg-slate-50"
                  >
                    Rechazar
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <h2 className="font-semibold text-slate-800">Mis propuestas</h2>
      {misPropuestas.length === 0 ? (
        <p className="rounded bg-slate-50 px-3 py-3 text-slate-500">No has propuesto ningún intercambio.</p>
      ) : (
        <div className="space-y-3">
          {misPropuestas.map((it) => (
            <div key={it.id} className="rounded border border-slate-200 bg-white p-4">
              <div className="flex items-start justify-between">
                <p className="text-slate-700">
                  Propuesta a <span className="font-medium">{nombreEmpleado(it.employeeIdB)}</span> para el{' '}
                  <span className="font-medium">{it.fecha.slice(0, 10)}</span>
                </p>
                <span className={`rounded px-2 py-1 text-xs font-medium ${COLOR_ESTADO[it.estado] ?? ''}`}>
                  {it.estado}
                </span>
              </div>
              {it.motivoRechazo && (
                <p className="mt-2 rounded bg-red-50 p-2 text-xs text-red-700">Motivo: {it.motivoRechazo}</p>
              )}
            </div>
          ))}
        </div>
      )}

      {showModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50"
          onClick={(e) => e.target === e.currentTarget && !isSaving && setShowModal(false)}
          role="presentation"
        >
          <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-lg" role="dialog" aria-modal="true">
            <h2 className="mb-4 text-lg font-semibold">Proponer intercambio de turno</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700">Empleado</label>
                <select
                  value={form.employeeIdB}
                  onChange={(e) => setForm({ ...form, employeeIdB: e.target.value })}
                  disabled={isSaving}
                  className="mt-1 block w-full rounded border border-slate-300 px-3 py-2"
                >
                  <option value="">— Seleccionar —</option>
                  {empleados.filter((e) => e.id !== me?.userId).map((emp) => (
                    <option key={emp.id} value={emp.id}>{emp.nombres} {emp.apellidos}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700">Fecha (futura)</label>
                <input
                  type="date"
                  value={form.fecha}
                  onChange={(e) => setForm({ ...form, fecha: e.target.value })}
                  min={new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10)}
                  disabled={isSaving}
                  className="mt-1 block w-full rounded border border-slate-300 px-3 py-2"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700">Mensaje (opcional)</label>
                <textarea
                  value={form.mensajeA}
                  onChange={(e) => setForm({ ...form, mensajeA: e.target.value })}
                  disabled={isSaving}
                  className="mt-1 block w-full rounded border border-slate-300 px-3 py-2"
                  rows={2}
                />
              </div>
            </div>
            <div className="mt-6 flex justify-end gap-3">
              <button
                onClick={() => setShowModal(false)}
                disabled={isSaving}
                className="rounded border border-slate-300 px-4 py-2 font-medium text-slate-700 hover:bg-slate-50"
              >
                Cancelar
              </button>
              <button
                onClick={handleProponer}
                disabled={isSaving}
                className="rounded bg-slate-900 px-4 py-2 font-medium text-white hover:bg-slate-800 disabled:opacity-50"
              >
                {isSaving ? 'Enviando...' : 'Proponer'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Registrar el tab en `page.tsx`**

```tsx
// agregar import
import { IntercambiosEmpleadoTab } from './intercambios-empleado-tab';

// agregar a TABS
  { id: 'intercambios-empleado', label: 'Intercambios' },

// agregar a la sección de render
      {tab === 'intercambios-empleado' && <IntercambiosEmpleadoTab />}
```

- [ ] **Step 4: Verificar tipos y build**

```bash
pnpm --filter @rrhh/web exec tsc --noEmit
```

Esperado: 0 errores.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/"(app)"/turnos/shifts-api.ts apps/web/src/app/"(app)"/turnos/intercambios-empleado-tab.tsx apps/web/src/app/"(app)"/turnos/page.tsx
git commit -m "feat(web): tab Intercambios para empleado (proponer + mis propuestas + para mí)"
```

---

### Task 7: Frontend — Tab Manager (Board Pendientes)

**Objetivo:** Board de intercambios `ACEPTADA_POR_B` con acciones aprobar/rechazar.

**Files:**
- Modify: `apps/web/src/app/(app)/turnos/shifts-api.ts`
- Create: `apps/web/src/app/(app)/turnos/intercambios-manager-tab.tsx`
- Modify: `apps/web/src/app/(app)/turnos/page.tsx`

**Interfaces:**
- Produces: `listarIntercambiosPendientes`, `aprobarIntercambio`, `rechazarIntercambioManager` en `shifts-api.ts`; componente `IntercambiosManagerTab`.

- [ ] **Step 1: Agregar funciones a `shifts-api.ts`**

```typescript
export const listarIntercambiosPendientes = async (): Promise<IntercambioTurno[]> =>
  ok(await apiFetch('/turnos/intercambios/pendientes'), 'listar los intercambios pendientes');

export const aprobarIntercambio = async (id: string): Promise<IntercambioTurno> =>
  ok(await apiFetch(`/turnos/intercambios/${id}/aprobar`, { method: 'PUT' }), 'aprobar el intercambio');

export const rechazarIntercambioManager = async (id: string, motivoRechazo?: string): Promise<IntercambioTurno> =>
  ok(
    await apiFetch(`/turnos/intercambios/${id}/rechazar-manager`, {
      method: 'PUT',
      body: JSON.stringify({ motivoRechazo }),
    }),
    'rechazar el intercambio',
  );
```

- [ ] **Step 2: Crear `intercambios-manager-tab.tsx`**

```tsx
'use client';

import { useEffect, useMemo, useState } from 'react';
import { EmpleadoResumen, listarEmpleados } from '../vacaciones/vacations-api';
import {
  IntercambioTurno, listarIntercambiosPendientes, aprobarIntercambio, rechazarIntercambioManager,
} from './shifts-api';

export function IntercambiosManagerTab() {
  const [pendientes, setPendientes] = useState<IntercambioTurno[]>([]);
  const [empleados, setEmpleados] = useState<EmpleadoResumen[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [motivoPorId, setMotivoPorId] = useState<Record<string, string>>({});

  useEffect(() => {
    refrescar();
    listarEmpleados().then(setEmpleados).catch((e) => setError((e as Error).message));
  }, []);

  async function refrescar() {
    setError(null);
    setIsLoading(true);
    try {
      setPendientes(await listarIntercambiosPendientes());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setIsLoading(false);
    }
  }

  const nombreEmpleado = useMemo(
    () => (id: string) => {
      const emp = empleados.find((e) => e.id === id);
      return emp ? `${emp.nombres} ${emp.apellidos}` : id.slice(0, 8);
    },
    [empleados],
  );

  const handleAprobar = async (id: string) => {
    setError(null);
    try {
      await aprobarIntercambio(id);
      setSuccess('Intercambio aprobado');
      await refrescar();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const handleRechazar = async (id: string) => {
    setError(null);
    try {
      await rechazarIntercambioManager(id, motivoPorId[id]);
      setSuccess('Intercambio rechazado');
      await refrescar();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div className="space-y-6 text-sm">
      {error && <p className="rounded bg-red-50 px-3 py-2 text-red-700">{error}</p>}
      {success && <p className="rounded bg-emerald-50 px-3 py-2 text-emerald-700">{success}</p>}

      <h2 className="font-semibold text-slate-800">Intercambios pendientes de aprobación</h2>

      {isLoading ? (
        <p className="text-slate-500">Cargando...</p>
      ) : pendientes.length === 0 ? (
        <p className="rounded bg-slate-50 px-3 py-3 text-slate-500">No hay intercambios pendientes.</p>
      ) : (
        <div className="space-y-3">
          {pendientes.map((it) => (
            <div key={it.id} className="rounded border border-slate-200 bg-white p-4">
              <div className="mb-3">
                <p className="text-slate-700">
                  <span className="font-medium">{nombreEmpleado(it.employeeIdA)}</span> ({it.turnoActualA}) ↔{' '}
                  <span className="font-medium">{nombreEmpleado(it.employeeIdB)}</span> ({it.turnoActualB})
                </p>
                <p className="text-xs text-slate-500">Fecha: {it.fecha.slice(0, 10)}</p>
              </div>
              <input
                type="text"
                placeholder="Motivo de rechazo (opcional)"
                value={motivoPorId[it.id] ?? ''}
                onChange={(e) => setMotivoPorId({ ...motivoPorId, [it.id]: e.target.value })}
                className="mb-3 block w-full rounded border border-slate-300 px-3 py-1.5 text-xs"
              />
              <div className="flex gap-2">
                <button
                  onClick={() => handleAprobar(it.id)}
                  className="rounded bg-emerald-600 px-3 py-1 text-xs font-medium text-white hover:bg-emerald-700"
                >
                  Aprobar
                </button>
                <button
                  onClick={() => handleRechazar(it.id)}
                  className="rounded border border-slate-300 px-3 py-1 text-xs font-medium hover:bg-slate-50"
                >
                  Rechazar
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Registrar el tab en `page.tsx`**

```tsx
import { IntercambiosManagerTab } from './intercambios-manager-tab';

  { id: 'intercambios-manager', label: 'Intercambios (Manager)' },

      {tab === 'intercambios-manager' && <IntercambiosManagerTab />}
```

- [ ] **Step 4: Verificar tipos y build**

```bash
pnpm --filter @rrhh/web exec tsc --noEmit
pnpm --filter @rrhh/web run build
```

Esperado: 0 errores, build exitoso.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/"(app)"/turnos/shifts-api.ts apps/web/src/app/"(app)"/turnos/intercambios-manager-tab.tsx apps/web/src/app/"(app)"/turnos/page.tsx
git commit -m "feat(web): tab Intercambios para manager (board pendientes)"
```

---

### Task 8: E2E Integration Test

**Objetivo:** Test de integración con transacción fake que ejercita los 3 servicios juntos (`IntercambioTurnoService`, `IntercambioTurnoAplicadorService`, `CompensatorioService`) end-to-end, cubriendo aprobación manual, auto-aprobación por 48h, auto-aprobación por fecha alcanzada, y rechazo automático por turno modificado.

**Files:**
- Create: `apps/api/src/modules/shifts/feature-4.integration.spec.ts`

**Interfaces:**
- Consumes: `IntercambioTurnoService` (Task 2), `IntercambioTurnoAplicadorService` (Task 4), `CompensatorioService` (existente), `NotificationService` mockeado.

- [ ] **Step 1: Escribir el test de integración**

```typescript
import { IntercambioTurnoService } from './intercambio-turno.service';
import { IntercambioTurnoAplicadorService } from './intercambio-turno-aplicador.service';
import { CompensatorioService } from './compensatorio.service';

/**
 * Fake Prisma transaction: cubre la superficie de intercambioTurno,
 * turnoAsignacion y employee usada por IntercambioTurnoService,
 * IntercambioTurnoAplicadorService y CompensatorioService juntos, sin BD real.
 */
function createFakeTx() {
  const intercambios = new Map<string, any>();
  const employees = new Map<string, any>();
  const asignaciones = new Map<string, any>();
  let seq = 0;

  const keyAsig = (employeeId: string, fecha: Date) => `${employeeId}|${fecha.toISOString().slice(0, 10)}`;

  return {
    intercambioTurno: {
      findUnique: async ({ where }: any) => intercambios.get(where.id) ?? null,
      findFirst: async ({ where }: any) => {
        for (const it of intercambios.values()) {
          if (
            it.tenantId === where.tenantId && it.employeeIdA === where.employeeIdA &&
            it.employeeIdB === where.employeeIdB && it.fecha.getTime() === where.fecha.getTime() &&
            where.estado.in.includes(it.estado)
          ) return it;
        }
        return null;
      },
      findMany: async ({ where }: any) =>
        [...intercambios.values()].filter(
          (it) => it.tenantId === where.tenantId && it.estado === where.estado &&
                  (!where.fecha?.lte || it.fecha <= where.fecha.lte),
        ),
      create: async ({ data }: any) => {
        const id = `int-${++seq}`;
        const record = { id, creadoEn: new Date(), ...data };
        intercambios.set(id, record);
        return record;
      },
      update: async ({ where, data }: any) => {
        const updated = { ...intercambios.get(where.id), ...data };
        intercambios.set(where.id, updated);
        return updated;
      },
    },
    employee: {
      findUnique: async ({ where }: any) => employees.get(where.id) ?? null,
    },
    turnoAsignacion: {
      findUnique: async ({ where }: any) => {
        const k = where.tenantId_employeeId_fecha;
        return asignaciones.get(keyAsig(k.employeeId, k.fecha)) ?? null;
      },
      update: async ({ where, data }: any) => {
        for (const [key, val] of asignaciones.entries()) {
          if (val.id === where.id) {
            const updated = { ...val, ...data };
            asignaciones.set(key, updated);
            return updated;
          }
        }
        return null;
      },
    },
    _intercambios: intercambios,
    _employees: employees,
    _asignaciones: asignaciones,
    _keyAsig: keyAsig,
  };
}

function fechaFutura(dias: number): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + dias);
  return d;
}

describe('Feature 4: Portal de Intercambios (E2E)', () => {
  let notificationService: any;
  let intercambios: IntercambioTurnoService;
  let aplicador: IntercambioTurnoAplicadorService;

  beforeEach(() => {
    notificationService = {
      notificarIntercambioAprobado: jest.fn().mockResolvedValue(undefined),
      notificarIntercambioRechazado: jest.fn().mockResolvedValue(undefined),
    };
    intercambios = new IntercambioTurnoService();
    aplicador = new IntercambioTurnoAplicadorService(new CompensatorioService(), notificationService);
  });

  it('flujo principal: A propone, B acepta, Manager aprueba → turnos intercambiados', async () => {
    const tx = createFakeTx();
    const tenantId = 't-1';
    tx._employees.set('emp-a', { id: 'emp-a', estado: 'activo' });
    tx._employees.set('emp-b', { id: 'emp-b', estado: 'activo' });
    const fecha = fechaFutura(10);
    tx._asignaciones.set(tx._keyAsig('emp-a', fecha), { id: 'asig-a', tipoDia: 'TURNO', turnoId: 'turno-dia' });
    tx._asignaciones.set(tx._keyAsig('emp-b', fecha), { id: 'asig-b', tipoDia: 'TURNO', turnoId: 'turno-noche' });

    const propuesta = await intercambios.proponer(tx, {
      tenantId, employeeIdA: 'emp-a', employeeIdB: 'emp-b', fecha, mensajeA: 'Tengo cita', creadoPor: 'emp-a',
    });
    expect(propuesta.estado).toBe('PENDIENTE_ACEPTACION_B');

    const aceptada = await intercambios.aceptar(tx, tenantId, propuesta.id, 'emp-b');
    expect(aceptada.estado).toBe('ACEPTADA_POR_B');

    const aprobada = await aplicador.aprobar(tx, tenantId, propuesta.id, 'mgr-1');
    expect(aprobada.estado).toBe('APROBADA_MANAGER');
    expect(aprobada.decididoPor).toBe('mgr-1');

    expect(tx._asignaciones.get(tx._keyAsig('emp-a', fecha)).tipoDia).toBe('TURNO');
    expect(tx._asignaciones.get(tx._keyAsig('emp-a', fecha)).turnoId).toBe('turno-noche');
    expect(tx._asignaciones.get(tx._keyAsig('emp-b', fecha)).turnoId).toBe('turno-dia');
    expect(notificationService.notificarIntercambioAprobado).toHaveBeenCalledWith(
      tenantId, 'emp-a', 'emp-b', fecha, false,
    );
  });

  it('B rechaza la propuesta: no llega al manager, no se ejecuta swap', async () => {
    const tx = createFakeTx();
    const tenantId = 't-1';
    tx._employees.set('emp-a', { id: 'emp-a', estado: 'activo' });
    tx._employees.set('emp-b', { id: 'emp-b', estado: 'activo' });
    const fecha = fechaFutura(10);
    tx._asignaciones.set(tx._keyAsig('emp-a', fecha), { id: 'asig-a', tipoDia: 'TURNO' });
    tx._asignaciones.set(tx._keyAsig('emp-b', fecha), { id: 'asig-b', tipoDia: 'DESCANSO' });

    const propuesta = await intercambios.proponer(tx, {
      tenantId, employeeIdA: 'emp-a', employeeIdB: 'emp-b', fecha, creadoPor: 'emp-a',
    });
    const rechazada = await intercambios.rechazarPorB(tx, tenantId, propuesta.id, 'emp-b', 'No puedo');

    expect(rechazada.estado).toBe('RECHAZADA_POR_B');
    expect(tx._asignaciones.get(tx._keyAsig('emp-a', fecha)).tipoDia).toBe('TURNO'); // sin cambios
  });

  it('auto-aprobación por plazo de 48h sin decisión del manager', async () => {
    const tx = createFakeTx();
    const tenantId = 't-1';
    tx._employees.set('emp-a', { id: 'emp-a', estado: 'activo' });
    tx._employees.set('emp-b', { id: 'emp-b', estado: 'activo' });
    const fecha = fechaFutura(30);
    tx._asignaciones.set(tx._keyAsig('emp-a', fecha), { id: 'asig-a', tipoDia: 'TURNO', turnoId: 'turno-dia' });
    tx._asignaciones.set(tx._keyAsig('emp-b', fecha), { id: 'asig-b', tipoDia: 'TURNO', turnoId: 'turno-noche' });

    const propuesta = await intercambios.proponer(tx, {
      tenantId, employeeIdA: 'emp-a', employeeIdB: 'emp-b', fecha, creadoPor: 'emp-a',
    });
    await intercambios.aceptar(tx, tenantId, propuesta.id, 'emp-b');
    // Simula que aceptó hace 49h (más allá del plazo de 48h)
    tx._intercambios.get(propuesta.id).aceptadoEn = new Date(Date.now() - 49 * 60 * 60 * 1000);

    await aplicador.barrido(tx, tenantId);

    const resuelta = tx._intercambios.get(propuesta.id);
    expect(resuelta.estado).toBe('AUTO_APROBADA');
    expect(resuelta.motivoResolucion).toBe('PLAZO_48H');
    expect(resuelta.decididoPor).toBeNull();
    expect(tx._asignaciones.get(tx._keyAsig('emp-a', fecha)).turnoId).toBe('turno-noche');
  });

  it('auto-aprobación por fecha alcanzada, incluso sin pasar 48h', async () => {
    const tx = createFakeTx();
    const tenantId = 't-1';
    tx._employees.set('emp-a', { id: 'emp-a', estado: 'activo' });
    tx._employees.set('emp-b', { id: 'emp-b', estado: 'activo' });
    const fecha = fechaFutura(1);
    tx._asignaciones.set(tx._keyAsig('emp-a', fecha), { id: 'asig-a', tipoDia: 'TURNO', turnoId: 'turno-dia' });
    tx._asignaciones.set(tx._keyAsig('emp-b', fecha), { id: 'asig-b', tipoDia: 'TURNO', turnoId: 'turno-noche' });

    const propuesta = await intercambios.proponer(tx, {
      tenantId, employeeIdA: 'emp-a', employeeIdB: 'emp-b', fecha, creadoPor: 'emp-a',
    });
    await intercambios.aceptar(tx, tenantId, propuesta.id, 'emp-b');
    // "Avanza el calendario": la fecha del turno ya llegó, aceptó hace 1h.
    tx._intercambios.get(propuesta.id).fecha = fechaFutura(0);
    tx._intercambios.get(propuesta.id).aceptadoEn = new Date(Date.now() - 60 * 60 * 1000);
    tx._asignaciones.set(tx._keyAsig('emp-a', fechaFutura(0)), tx._asignaciones.get(tx._keyAsig('emp-a', fecha)));
    tx._asignaciones.set(tx._keyAsig('emp-b', fechaFutura(0)), tx._asignaciones.get(tx._keyAsig('emp-b', fecha)));

    await aplicador.barrido(tx, tenantId);

    const resuelta = tx._intercambios.get(propuesta.id);
    expect(resuelta.estado).toBe('AUTO_APROBADA');
    expect(resuelta.motivoResolucion).toBe('FECHA_ALCANZADA');
  });

  it('rechazo automático: el turno de A cambió entre la propuesta y la aprobación del manager', async () => {
    const tx = createFakeTx();
    const tenantId = 't-1';
    tx._employees.set('emp-a', { id: 'emp-a', estado: 'activo' });
    tx._employees.set('emp-b', { id: 'emp-b', estado: 'activo' });
    const fecha = fechaFutura(10);
    tx._asignaciones.set(tx._keyAsig('emp-a', fecha), { id: 'asig-a', tipoDia: 'TURNO', turnoId: 'turno-dia' });
    tx._asignaciones.set(tx._keyAsig('emp-b', fecha), { id: 'asig-b', tipoDia: 'TURNO', turnoId: 'turno-noche' });

    const propuesta = await intercambios.proponer(tx, {
      tenantId, employeeIdA: 'emp-a', employeeIdB: 'emp-b', fecha, creadoPor: 'emp-a',
    });
    await intercambios.aceptar(tx, tenantId, propuesta.id, 'emp-b');

    // El manager reasigna a A a DESCANSO esa fecha antes de que se apruebe el intercambio.
    tx._asignaciones.set(tx._keyAsig('emp-a', fecha), { id: 'asig-a', tipoDia: 'DESCANSO' });

    const resultado = await aplicador.aprobar(tx, tenantId, propuesta.id, 'mgr-1');

    expect(resultado.estado).toBe('RECHAZADA_AUTOMATICA');
    expect(resultado.motivoResolucion).toBe('TURNO_MODIFICADO');
    expect(notificationService.notificarIntercambioRechazado).toHaveBeenCalled();
  });

  it('rechazo automático: fecha alcanzada sin que B respondiera', async () => {
    const tx = createFakeTx();
    const tenantId = 't-1';
    tx._employees.set('emp-a', { id: 'emp-a', estado: 'activo' });
    tx._employees.set('emp-b', { id: 'emp-b', estado: 'activo' });
    const fecha = fechaFutura(1);
    tx._asignaciones.set(tx._keyAsig('emp-a', fecha), { id: 'asig-a', tipoDia: 'TURNO' });
    tx._asignaciones.set(tx._keyAsig('emp-b', fecha), { id: 'asig-b', tipoDia: 'TURNO' });

    const propuesta = await intercambios.proponer(tx, {
      tenantId, employeeIdA: 'emp-a', employeeIdB: 'emp-b', fecha, creadoPor: 'emp-a',
    });
    // B nunca responde. La fecha del turno llega.
    tx._intercambios.get(propuesta.id).fecha = fechaFutura(0);

    await aplicador.barrido(tx, tenantId);

    const resuelta = tx._intercambios.get(propuesta.id);
    expect(resuelta.estado).toBe('RECHAZADA_AUTOMATICA');
    expect(resuelta.motivoResolucion).toBe('FECHA_ALCANZADA_SIN_RESPUESTA_B');
  });

  it('duplicado: no permite 2 propuestas pendientes del mismo par para la misma fecha', async () => {
    const tx = createFakeTx();
    const tenantId = 't-1';
    tx._employees.set('emp-a', { id: 'emp-a', estado: 'activo' });
    tx._employees.set('emp-b', { id: 'emp-b', estado: 'activo' });
    const fecha = fechaFutura(10);
    tx._asignaciones.set(tx._keyAsig('emp-a', fecha), { id: 'asig-a', tipoDia: 'TURNO' });
    tx._asignaciones.set(tx._keyAsig('emp-b', fecha), { id: 'asig-b', tipoDia: 'TURNO' });

    await intercambios.proponer(tx, { tenantId, employeeIdA: 'emp-a', employeeIdB: 'emp-b', fecha, creadoPor: 'emp-a' });

    await expect(
      intercambios.proponer(tx, { tenantId, employeeIdA: 'emp-a', employeeIdB: 'emp-b', fecha, creadoPor: 'emp-a' }),
    ).rejects.toThrow(/pendiente/);
  });
});
```

- [ ] **Step 2: Ejecutar y verificar que pasan**

```bash
pnpm --filter @rrhh/api test -- feature-4.integration.spec
```

Esperado: PASS, 7/7.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/modules/shifts/feature-4.integration.spec.ts
git commit -m "test(turnos-fase-9): feature 4 end-to-end integration test"
```

---

### Task 9: Verificación Final + Documentación

**Objetivo:** Verificación completa de Sprint 9 y actualización de `docs/PENDIENTES.md`.

**Files:**
- Modify: `docs/PENDIENTES.md`

**Checklist:**

- [ ] **Step 1: Suite completa de tests**

```bash
pnpm --filter @rrhh/api test
```

Esperado: todos los tests PASS (los ~506 existentes + los nuevos de este plan), 0 fallas.

- [ ] **Step 2: TypeScript**

```bash
pnpm --filter @rrhh/api exec tsc --noEmit
pnpm --filter @rrhh/web exec tsc --noEmit
```

Esperado: 0 errores en ambos workspaces.

- [ ] **Step 3: Build web**

```bash
pnpm --filter @rrhh/web run build
```

Esperado: build exitoso, rutas `/turnos` incluyen los 2 tabs nuevos.

- [ ] **Step 4: Prueba manual (recomendada, no bloqueante)**

Con `docker-compose up -d`, API (`pnpm --filter @rrhh/api dev`) y Web (`pnpm --filter @rrhh/web dev`) corriendo:
1. Login como `empleado@demo.pe` → tab Intercambios → proponer intercambio a otro empleado demo en una fecha futura con turno asignado.
2. Login como el segundo empleado (o usar otra sesión) → aceptar la propuesta.
3. Login como `rrhh@demo.pe` (tiene `shift.resolve`) → tab Intercambios (Manager) → aprobar → verificar que el plan de ambos empleados intercambió el turno de esa fecha.

- [ ] **Step 5: Actualizar `docs/PENDIENTES.md`**

Marcar Sprint 9 (Feature 4) como completo, actualizar el estado del sistema (conteo de tests), y mover a "Próximos pasos" lo que quede después de Fases 6-9 (deuda técnica del barrido perezoso documentada en el diseño §7, y el plan de integración post-turnos ya existente en el archivo).

- [ ] **Step 6: Commit**

```bash
git add docs/PENDIENTES.md
git commit -m "docs(turnos-fase-9): actualizar PENDIENTES.md - Sprint 9 completo"
```

---

## Success Criteria

✅ 9 tareas implementadas
✅ Todos los tests pasando (existentes + nuevos), 0 fallas
✅ 0 errores TypeScript (api + web)
✅ Build web exitoso
✅ `docs/PENDIENTES.md` actualizado
✅ 4/4 features de Fases 6-9 completadas
