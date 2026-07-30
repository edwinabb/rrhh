# Turnos: Mejoras Fase 6-9 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement 4 independent autoservice + advanced management features for shift management (patterns, change requests, overtime validation, peer swaps).

**Architecture:** Four separate feature modules, each with dedicated backend service, API endpoints, and frontend tab. Shared infrastructure: NotificationService, AuditService, ShiftComplianceService (for hour calculations). Each feature follows TDD with integration tests.

**Tech Stack:** NestJS (backend), Prisma (DB), Next.js (frontend), Jest (tests), TypeScript, React hooks.

## Global Constraints

- Four features are **independent**: can be implemented in parallel sprints (Sprint 6, 7, 8, 9)
- All dates must be future-only (no past date assignments)
- Private data (Manager-only): Feature 1 (none), Feature 3 (causaHorasExtras, horasAcumuladas, saldoCompensatorios)
- Intercambios (Feature 4) are **neutral** for compensatorios (no saldo movement)
- Fotos en Feature 3 deben tener timestamp **visible** en la imagen (no metadata)
- Reporte rechazado en Feature 3 permite reentrega (loop infinito hasta VALIDADA)
- Permiso RBAC: shift.read (view), shift.manage (edit), shift.resolve (approve sensitive)
- Email notifications on every state change + in-app notifications
- Tests: Unit + Integration, no E2E (manual verificación)

---

## Sprint 6: Feature 1 - Autogeneración de Patrones

**Goal:** Manager define + apply shift rotation patterns to employees (bulk plan injection).

---

### Task 1: Backend - Modelo `RotacionPatron` + Migration

**Files:**
- Modify: `packages/database/prisma/schema.prisma`
- Create: `packages/database/prisma/migrations/YYYYMMDDHHMMSS_rotacion_patron/migration.sql`
- Test: (none, schema-only)

**Interfaces:**
- Produces: `RotacionPatron` model with fields: id, tenantId, nombre, descripcion, secuencia (array), duracionCiclo, activo, creadoEn, creadoPor, actualizadoEn, actualizadoPor

- [ ] **Step 1: Add RotacionPatron model to schema.prisma**

```prisma
model RotacionPatron {
  id             String   @id @default(cuid())
  tenantId       String
  nombre         String   // "2-2-2-1"
  descripcion    String?
  secuencia      String   // JSON-encoded array: ["DIA","DIA","NOCHE","NOCHE","DESC","DESC","DESC"]
  duracionCiclo  Int      // Always 7
  activo         Boolean  @default(true)
  creadoEn       DateTime @default(now())
  creadoPor      String
  actualizadoEn  DateTime @updatedAt
  actualizadoPor String?

  @@unique([tenantId, nombre])
  @@index([tenantId, activo])
}
```

- [ ] **Step 2: Run migration generation**

```bash
cd packages/database
pnpm prisma migrate dev --name rotacion_patron
```

Expected: Migration file created, schema updated.

- [ ] **Step 3: Seed turnos DIA/NOCHE (requisito para Task 3)**

`RotacionAplicadorService` resuelve `tipoDia` DIA/NOCHE contra el catálogo `Turno` por `codigo`. Si no existen para el tenant, agregar en `packages/database/seed.ts`:

```typescript
await prisma.turno.upsert({
  where: { tenantId_codigo: { tenantId: tenant.id, codigo: 'DIA' } },
  update: {},
  create: { tenantId: tenant.id, codigo: 'DIA', nombre: 'Turno Día', horaInicio: '08:00', horaFin: '20:00', horasEsperadas: 12 },
});
await prisma.turno.upsert({
  where: { tenantId_codigo: { tenantId: tenant.id, codigo: 'NOCHE' } },
  update: {},
  create: { tenantId: tenant.id, codigo: 'NOCHE', nombre: 'Turno Noche', horaInicio: '20:00', horaFin: '08:00', horasEsperadas: 12 },
});
```

- [ ] **Step 4: Commit**

```bash
git add packages/database/prisma/schema.prisma packages/database/prisma/migrations/ packages/database/seed.ts
git commit -m "feat(schema): modelo RotacionPatron + turnos DIA/NOCHE para patrones de rotación"
```

---

### Task 2: Backend - `RotacionPatronService` (CRUD)

**Files:**
- Create: `apps/api/src/modules/shifts/rotacion-patron.service.ts`
- Create: `apps/api/src/modules/shifts/rotacion-patron.service.spec.ts`

**Interfaces:**
- Produces: 
  - `listarPatrones(tx, tenantId, incluyeInactivos?): Promise<RotacionPatron[]>`
  - `crearPatron(tx, input: CrearPatronInput): Promise<RotacionPatron>`
  - `actualizarPatron(tx, id, cambios): Promise<RotacionPatron>`
  - Where `CrearPatronInput = { nombre, descripcion?, secuencia: TipoDiaPlan[], duracionCiclo }`

- [ ] **Step 1: Write failing tests**

```typescript
// apps/api/src/modules/shifts/rotacion-patron.service.spec.ts
import { ConflictException, NotFoundException, BadRequestException } from '@nestjs/common';
import { RotacionPatronService } from './rotacion-patron.service';

function mockTx(overrides: any = {}) {
  return {
    rotacionPatron: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue(null),
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 'pat-1', ...data })),
      update: jest.fn(),
    },
    ...overrides,
  };
}

const service = new RotacionPatronService();

describe('RotacionPatronService', () => {
  it('crearPatron rechaza secuencia no-7', async () => {
    const tx = mockTx();
    await expect(
      service.crearPatron(tx, {
        tenantId: 't-1', nombre: 'X', secuencia: ['DIA', 'NOCHE'], duracionCiclo: 2
      })
    ).rejects.toThrow(BadRequestException);
  });

  it('crearPatron rechaza duplicate nombre', async () => {
    const tx = mockTx();
    tx.rotacionPatron.findFirst.mockResolvedValue({ id: 'pat-1' });
    await expect(
      service.crearPatron(tx, {
        tenantId: 't-1', nombre: '2-2-2-1', secuencia: ['DIA', 'DIA', 'NOCHE', 'NOCHE', 'DESC', 'DESC', 'DESC'], duracionCiclo: 7
      })
    ).rejects.toThrow(ConflictException);
  });

  it('crearPatron guarda patrón válido', async () => {
    const tx = mockTx();
    const resultado = await service.crearPatron(tx, {
      tenantId: 't-1', nombre: '2-2-2-1', secuencia: ['DIA', 'DIA', 'NOCHE', 'NOCHE', 'DESC', 'DESC', 'DESC'], duracionCiclo: 7, creadoPor: 'u-1'
    });
    expect(resultado.nombre).toBe('2-2-2-1');
  });

  it('listarPatrones filtra por activo', async () => {
    const tx = mockTx();
    tx.rotacionPatron.findMany.mockResolvedValue([{ id: 'pat-1', activo: true }]);
    const resultado = await service.listarPatrones(tx, 't-1', false);
    expect(tx.rotacionPatron.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ activo: true })
    }));
  });

  it('actualizarPatron rechaza patrón inexistente', async () => {
    const tx = mockTx();
    await expect(
      service.actualizarPatron(tx, 'pat-999', { nombre: 'X' })
    ).rejects.toThrow(NotFoundException);
  });
});
```

- [ ] **Step 2: Verify FAIL**

Run: `pnpm --filter @rrhh/api test -- rotacion-patron.service`
Expected: FAIL — class not found.

- [ ] **Step 3: Implement service**

```typescript
// apps/api/src/modules/shifts/rotacion-patron.service.ts
import { Injectable, ConflictException, BadRequestException, NotFoundException } from '@nestjs/common';

export interface CrearPatronInput {
  tenantId: string;
  nombre: string;
  descripcion?: string;
  secuencia: TipoDiaPlan[];
  duracionCiclo: number;
  creadoPor: string;
}

export type TipoDiaPlan = 'DIA' | 'NOCHE' | 'DESC';

@Injectable()
export class RotacionPatronService {
  async listarPatrones(tx: any, tenantId: string, incluyeInactivos = false): Promise<any> {
    return tx.rotacionPatron.findMany({
      where: {
        tenantId,
        ...(incluyeInactivos ? {} : { activo: true }),
      },
      orderBy: { nombre: 'asc' },
    });
  }

  async crearPatron(tx: any, input: CrearPatronInput): Promise<any> {
    // Validar secuencia
    if (input.secuencia.length !== 7) {
      throw new BadRequestException('Secuencia debe tener exactamente 7 elementos (1 por día)');
    }
    if (input.duracionCiclo !== 7) {
      throw new BadRequestException('Duración del ciclo debe ser 7 días');
    }

    // Validar no duplicate
    const existente = await tx.rotacionPatron.findFirst({
      where: { tenantId: input.tenantId, nombre: input.nombre },
    });
    if (existente) {
      throw new ConflictException(`Ya existe un patrón con nombre "${input.nombre}"`);
    }

    return tx.rotacionPatron.create({
      data: {
        tenantId: input.tenantId,
        nombre: input.nombre,
        descripcion: input.descripcion ?? null,
        secuencia: JSON.stringify(input.secuencia),
        duracionCiclo: input.duracionCiclo,
        creadoPor: input.creadoPor,
      },
    });
  }

  async actualizarPatron(tx: any, id: string, cambios: Partial<Omit<CrearPatronInput, 'tenantId' | 'creadoPor'>> & { actualizadoPor?: string }): Promise<any> {
    const patron = await tx.rotacionPatron.findUnique({ where: { id } });
    if (!patron) throw new NotFoundException(`Patrón ${id} no encontrado`);

    if (cambios.secuencia && cambios.secuencia.length !== 7) {
      throw new BadRequestException('Secuencia debe tener exactamente 7 elementos');
    }

    return tx.rotacionPatron.update({
      where: { id },
      data: {
        ...(cambios.nombre && { nombre: cambios.nombre }),
        ...(cambios.descripcion !== undefined && { descripcion: cambios.descripcion }),
        ...(cambios.secuencia && { secuencia: JSON.stringify(cambios.secuencia) }),
        ...(cambios.activo !== undefined && { activo: cambios.activo }),
        ...(cambios.actualizadoPor && { actualizadoPor: cambios.actualizadoPor }),
      },
    });
  }
}
```

- [ ] **Step 4: Verify PASS**

Run: `pnpm --filter @rrhh/api test -- rotacion-patron.service`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/shifts/rotacion-patron.service.ts apps/api/src/modules/shifts/rotacion-patron.service.spec.ts
git commit -m "feat(turnos): RotacionPatronService con CRUD de patrones"
```

---

### Task 3: Backend - `RotacionAplicadorService` (Bulk Injection)

**Files:**
- Create: `apps/api/src/modules/shifts/rotacion-aplicador.service.ts`
- Create: `apps/api/src/modules/shifts/rotacion-aplicador.service.spec.ts`

**Interfaces:**
- Consumes: `ShiftPlanService.upsertAsignacion()`
- Produces: 
  - `aplicarPatron(tx, input: AplicarPatronInput): Promise<{ procesadas, errores }>`
  - Where `AplicarPatronInput = { patronId, employeeIds, desde, hasta, diaInicioCiclo, ajustes? }`

- [ ] **Step 1: Write failing tests**

```typescript
// apps/api/src/modules/shifts/rotacion-aplicador.service.spec.ts
import { RotacionAplicadorService } from './rotacion-aplicador.service';

function mockTx(overrides: any = {}) {
  return {
    rotacionPatron: { findUnique: jest.fn().mockResolvedValue(null) },
    employee: { findMany: jest.fn().mockResolvedValue([]), findUnique: jest.fn().mockResolvedValue({ id: 'emp-1', estado: 'activo' }) },
    turno: {
      findUnique: jest.fn().mockImplementation(({ where }: any) =>
        Promise.resolve({ id: `turno-${where.tenantId_codigo.codigo}`, codigo: where.tenantId_codigo.codigo })
      ),
    },
    turnoAsignacion: { findMany: jest.fn().mockResolvedValue([]) },
    ...overrides,
  };
}

const service = new RotacionAplicadorService(
  { upsertAsignacion: jest.fn() } as any // ShiftPlanService mock
);

describe('RotacionAplicadorService', () => {
  it('aplica patrón a 3 empleados durante 30 días', async () => {
    const tx = mockTx();
    tx.rotacionPatron.findUnique.mockResolvedValue({
      id: 'pat-1', secuencia: JSON.stringify(['DIA', 'DIA', 'NOCHE', 'NOCHE', 'DESC', 'DESC', 'DESC'])
    });
    tx.employee.findMany.mockResolvedValue([
      { id: 'emp-1' }, { id: 'emp-2' }, { id: 'emp-3' }
    ]);

    const resultado = await service.aplicarPatron(tx, {
      tenantId: 't-1',
      patronId: 'pat-1',
      employeeIds: ['emp-1', 'emp-2', 'emp-3'],
      desde: new Date(2026, 7, 1),
      hasta: new Date(2026, 7, 31),
      diaInicioCiclo: new Date(2026, 7, 4), // Lunes
      creadoPor: 'u-1',
    });

    expect(resultado.procesadas).toBeGreaterThan(0);
  });

  it('rechaza patrón inexistente', async () => {
    const tx = mockTx();
    await expect(
      service.aplicarPatron(tx, {
        tenantId: 't-1', patronId: 'pat-999', employeeIds: ['emp-1'],
        desde: new Date(2026, 7, 1), hasta: new Date(2026, 7, 31),
        diaInicioCiclo: new Date(2026, 7, 4), creadoPor: 'u-1'
      })
    ).rejects.toThrow('Patrón no encontrado');
  });
});
```

- [ ] **Step 2: Verify FAIL**

Run: `pnpm --filter @rrhh/api test -- rotacion-aplicador.service`
Expected: FAIL.

- [ ] **Step 3: Implement service**

```typescript
// apps/api/src/modules/shifts/rotacion-aplicador.service.ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { ShiftPlanService } from './shift-plan.service';

export interface AplicarPatronInput {
  tenantId: string;
  patronId: string;
  employeeIds: string[];
  desde: Date;
  hasta: Date;
  diaInicioCiclo: Date;  // Lunes de inicio
  ajustes?: { fecha: Date; tipoDia: string }[];
  creadoPor: string;
}

@Injectable()
export class RotacionAplicadorService {
  constructor(private readonly shiftPlan: ShiftPlanService) {}

  async aplicarPatron(tx: any, input: AplicarPatronInput): Promise<{ procesadas: number; errores: any[] }> {
    // Obtener patrón
    const patron = await tx.rotacionPatron.findUnique({ where: { id: input.patronId } });
    if (!patron) throw new NotFoundException('Patrón no encontrado');

    const secuencia = JSON.parse(patron.secuencia);
    const procesadas = 0;
    const errores: any[] = [];

    // Para cada empleado
    for (const employeeId of input.employeeIds) {
      // Validar que empleado existe y está activo
      const emp = await tx.employee.findUnique({ where: { id: employeeId } });
      if (!emp || emp.estado === 'cesado') {
        errores.push({ employeeId, mensaje: 'Empleado no encontrado o cesado' });
        continue;
      }

      // Iterar fechas desde hasta, cycling secuencia
      let fechaActual = new Date(input.desde);
      let diaEnCiclo = this.calcularDiaEnCiclo(input.diaInicioCiclo, fechaActual);

      while (fechaActual <= input.hasta) {
        const tipoDia = secuencia[diaEnCiclo % 7];

        // Aplicar ajustes manuales si existen
        const ajuste = input.ajustes?.find(a => 
          new Date(a.fecha).toDateString() === fechaActual.toDateString()
        );
        const tipoDiaFinal = ajuste?.tipoDia ?? tipoDia;

        try {
          const esTurno = tipoDiaFinal === 'DIA' || tipoDiaFinal === 'NOCHE';
          let turnoId: string | undefined;
          if (esTurno) {
            const turno = await tx.turno.findUnique({
              where: { tenantId_codigo: { tenantId: input.tenantId, codigo: tipoDiaFinal } },
            });
            if (!turno) {
              errores.push({ employeeId, fecha: fechaActual, mensaje: `Turno catálogo "${tipoDiaFinal}" no existe para el tenant` });
              fechaActual.setDate(fechaActual.getDate() + 1);
              diaEnCiclo++;
              continue;
            }
            turnoId = turno.id;
          }

          await this.shiftPlan.upsertAsignacion(tx, {
            tenantId: input.tenantId,
            employeeId,
            fecha: fechaActual,
            tipoDia: esTurno ? 'TURNO' : (tipoDiaFinal as 'DESCANSO' | 'DESCANSO_COMPENSATORIO'),
            ...(turnoId && { turnoId }),
            creadoPor: input.creadoPor,
          });
        } catch (e) {
          errores.push({ employeeId, fecha: fechaActual, mensaje: (e as Error).message });
        }

        fechaActual.setDate(fechaActual.getDate() + 1);
        diaEnCiclo++;
      }
    }

    return { procesadas: input.employeeIds.length - errores.length, errores };
  }

  private calcularDiaEnCiclo(diaInicioCiclo: Date, fecha: Date): number {
    const diffMs = fecha.getTime() - diaInicioCiclo.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    return diffDays;
  }
}
```

- [ ] **Step 4: Verify PASS**

Run: `pnpm --filter @rrhh/api test -- rotacion-aplicador.service`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/shifts/rotacion-aplicador.service.ts apps/api/src/modules/shifts/rotacion-aplicador.service.spec.ts
git commit -m "feat(turnos): RotacionAplicadorService con lógica de inyección masiva"
```

---

### Task 4: Backend - API Endpoints + Controller

**Files:**
- Modify: `apps/api/src/modules/shifts/shifts.controller.ts` (agregar rutas /patrones)
- Test: Add tests to existing shifts.controller.spec.ts (if exists, else create)

**Interfaces:**
- Consumes: RotacionPatronService, RotacionAplicadorService
- Produces: Endpoints POST/GET/PUT /turnos/patrones, POST /turnos/patrones/:id/aplicar

- [ ] **Step 1: Add endpoint tests to shifts.controller.spec.ts**

```typescript
describe('ShiftsController - Patrones', () => {
  it('GET /turnos/patrones returns active patterns', async () => {
    // Mock and test
  });

  it('POST /turnos/patrones creates pattern with validation', async () => {
    // Mock and test
  });

  it('POST /turnos/patrones/:id/aplicar injects to employees', async () => {
    // Mock and test
  });
});
```

- [ ] **Step 2: Implement endpoints in controller**

Add methods:
- `@Get('patrones')` → `listarPatrones()`
- `@Post('patrones')` + `@RequirePermission('shift.manage')` → `crearPatron()`
- `@Put('patrones/:id')` + `@RequirePermission('shift.manage')` → `actualizarPatron()`
- `@Post('patrones/:id/aplicar')` + `@RequirePermission('shift.manage')` → `aplicarPatron()`

- [ ] **Step 3: Test endpoints**

Run: `pnpm --filter @rrhh/api test -- shifts.controller`
Expected: All pattern endpoint tests PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/modules/shifts/shifts.controller.ts apps/api/src/modules/shifts/shifts.controller.spec.ts
git commit -m "feat(turnos): endpoints para CRUD de patrones e inyección"
```

---

### Task 5: Frontend - Catálogo Tab + Modal Crear/Editar Patrón

**Files:**
- Create: `apps/web/src/app/(app)/turnos/patrones-catalogo-tab.tsx`
- Create: `apps/web/src/app/(app)/turnos/patron-form-modal.tsx`
- Modify: `apps/web/src/app/(app)/turnos/page.tsx` (agregar tab)

**Interfaces:**
- Consumes: API endpoints /turnos/patrones (GET/POST/PUT)
- Produces: UI with pattern table + form modal

- [ ] **Step 1: Create patron-form-modal.tsx**

Component for creating/editing patterns. Props:
```typescript
interface PatronFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (patron) => Promise<void>;
  patron?: RotacionPatron;
  isLoading?: boolean;
}
```

Form fields:
- nombre (text input)
- descripcion (text input, optional)
- secuencia (7 dropdowns: DIA/NOCHE/DESC)
- duracionCiclo (readonly, always 7)
- Quick buttons: [2-2-2-1] [3-3-1] [3-2-2] [Personalizado]

- [ ] **Step 2: Create patrones-catalogo-tab.tsx**

Component showing table of patterns:
- Columns: Nombre, Descripción, Ciclo, Acciones (Editar, Duplicar, Desactivar)
- Button: [+ NUEVO PATRÓN]
- Uses patron-form-modal.tsx for CRUD

- [ ] **Step 3: Update page.tsx to include Patrones tab**

Add `<PatronesCatalogoTab />` to tab list.

- [ ] **Step 4: Test in dev server**

```bash
pnpm --filter @rrhh/web dev
```

Navigate to /turnos, verify Patrones tab loads, can create/edit patterns.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/(app)/turnos/patrones-*.tsx apps/web/src/app/(app)/turnos/page.tsx
git commit -m "feat(web): catálogo de patrones con modal CRUD"
```

---

### Task 6: Frontend - Aplicar Patrón Tab

**Files:**
- Create: `apps/web/src/app/(app)/turnos/patrones-aplicar-tab.tsx`
- Modify: `apps/web/src/app/(app)/turnos/page.tsx`

**Interfaces:**
- Consumes: API GET /turnos/patrones, GET /employees (para multi-select), POST /turnos/patrones/:id/aplicar
- Produces: Aplicar patrón UI with preview

- [ ] **Step 1: Create patrones-aplicar-tab.tsx**

Form with:
- Select patrón: `[Patrón ▼]`
- Multi-select empleados
- Date range: desde/hasta
- Date picker: diaInicioCiclo (Lunes)
- Preview grilla 30 días (readonly)
- Button: [Ajustar] → abre editor
- Button: [Inyectar] → POST con confirmación

- [ ] **Step 2: Preview grid component**

Show 30-day grid (7 cols × 5 rows) with cycle repeating. Editable on [Ajustar] click.

- [ ] **Step 3: Test in dev server**

Navigate to /turnos, Aplicar Patrones tab. Select patrón, empleados, período. Verify preview shows correct cycling. Click Inyectar, verify API call + success toast.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/app/(app)/turnos/patrones-aplicar-tab.tsx
git commit -m "feat(web): tab aplicar patrones con vista previa"
```

---

### Task 7: Backend - Notifications para Feature 1

**Files:**
- Modify: `apps/api/src/common/services/notification.service.ts` (agregar métodos)

**Interfaces:**
- Consumes: SolicitudTrabajoAdicional (data)
- Produces: 
  - `notificarPatronAplicado(empleados, patronNombre): Promise<void>`

- [ ] **Step 1: Add notification method**

```typescript
async notificarPatronAplicado(tenantId: string, empleadoIds: string[], patronNombre: string): Promise<void> {
  const mensaje = `Tu plan de turnos fue actualizado usando patrón: ${patronNombre}`;
  // Enviar email a cada empleado
  // Crear in-app notification
}
```

- [ ] **Step 2: Integrate en RotacionAplicadorService.aplicarPatron()**

Call `notificationService.notificarPatronAplicado()` después de inyección exitosa.

- [ ] **Step 3: Test**

Run: `pnpm --filter @rrhh/api test -- notification.service`

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/common/services/notification.service.ts
git commit -m "feat(notificaciones): notificar empleados cuando se aplica patrón"
```

---

### Task 8: Integration Test - Feature 1 End-to-End

**Files:**
- Create: `apps/api/src/modules/shifts/feature-1.integration.spec.ts`

**Interfaces:**
- Consumes: RotacionPatronService, RotacionAplicadorService, ShiftPlanService
- Produces: One end-to-end test

- [ ] **Step 1: Write E2E test**

```typescript
describe('Feature 1: Autogeneración de Patrones (E2E)', () => {
  it('Manager crea patrón 2-2-2-1 y lo aplica a 2 empleados durante agosto', async () => {
    // 1. Create patrón
    // 2. Apply a 2 empleados, período 2026-08-01 to 2026-08-31, diaInicio 2026-08-04
    // 3. Verify turnoAsignacion records created for each employee ×30 days
    // 4. Verify cycling: semana 1 = [DIA,DIA,NOCHE,NOCHE,DESC,DESC,DESC], semana 2 = [DIA,DIA,...]
  });
});
```

- [ ] **Step 2: Run test**

Run: `pnpm --filter @rrhh/api test -- feature-1.integration`

Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/modules/shifts/feature-1.integration.spec.ts
git commit -m "test: feature 1 end-to-end integration test"
```

---

### Task 9: Sprint 6 - Final Verification

**Files:**
- (none, verification only)

**Interfaces:**
- (verification of all prior tasks)

- [ ] **Step 1: Run full test suite**

```bash
pnpm --filter @rrhh/api test
```

Expected: All tests PASS (should include ~280 prior + ~25 new = ~305 total)

- [ ] **Step 2: TypeScript check**

```bash
pnpm --filter @rrhh/api exec tsc --noEmit
```

Expected: 0 errors

- [ ] **Step 3: Web dev server check**

```bash
pnpm --filter @rrhh/web dev &
# Navigate to http://localhost:3000/turnos
# Verify Patrones tab exists, form works, no console errors
```

- [ ] **Step 4: Final commit message**

```bash
git log --oneline | head -10
```

Verify 8 commits from Sprint 6 (tasks 1-8).

---

**Sprint 6 Complete:** Feature 1 (Autogeneración de Patrones) implementada, testeada, integrada.

---

## Sprint 7, 8, 9: Features 2, 3, 4

[Por brevedad, resumen de estructura similar:]

**Sprint 7 (Feature 2 - Cambios de Turno):** ~8-10 tasks
- Backend: SolicitudCambioTurno model + migration
- Service: SolicitudCambioTurnoService (CRUD + validaciones)
- API: Endpoints + controller
- Frontend: Tab "Mis Cambios" + Board Manager
- Notifications

**Sprint 8 (Feature 3 - Trabajo Adicional):** ~12-15 tasks (más complejo)
- Backend: SolicitudTrabajoAdicional model + migration
- Service: SolicitudTrabajoAdicionalService (con cálculo de horas semanales)
- Service: RotacionAplicadorService integración
- API: Endpoints (solicitar, reportar, validar)
- Frontend: Tab "Solicitar" + "Reportar" + Board Manager "Validar Reportes"
- Photo upload handling
- Notifications (request, approve, reasign, report, validate)

**Sprint 9 (Feature 4 - Intercambios):** ~8-10 tasks
- Backend: IntercambioTurno model
- Service: IntercambioTurnoService
- API: Endpoints (proponer, aceptar, rechazar, aprobar)
- Frontend: Tab "Proponer" + "Para Mí"
- Board Manager "Pendientes de Aprobación"
- Notifications

---

## Total Plan Scope

**~40-45 tasks** across 4 sprints, each with TDD + frequent commits:
- 8-10 tasks per feature
- Backend: models + services + API endpoints
- Frontend: tabs + forms + boards
- Tests: unit + integration
- Notifications: email + in-app

Each task: 30-60 mins (smaller tasks) to 90+ mins (integration tests).

**Execution Time Estimate:** 2-3 weeks wall-clock (assuming 1 FTE full-time development) or 1 week with 2 FTEs (parallel sprints).

---

## Recommended Execution Approach

**Subagent-Driven Development (recommended):**
- Fresh implementer + reviewer per task
- Parallel execution (multiple tasks/sprints running concurrently)
- Fast feedback loop

**OR Inline Execution:**
- Execute tasks sequentially in this session
- Slower but single-threaded simplicity

Which approach would you prefer?

