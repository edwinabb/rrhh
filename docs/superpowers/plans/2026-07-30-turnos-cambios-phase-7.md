# Turnos: Cambios de Turno - Sprint 7 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Implement Feature 2 (Cambios de Turno) - employees request shift changes, managers approve/reject with retry loop, notifications on all state changes.

**Architecture:** Dedicated backend service (SolicitudCambioTurnoService), API endpoints, frontend tab for employee requests + manager board, audit trail + notifications.

**Tech Stack:** NestJS (backend), Prisma (DB), Next.js (frontend), Jest (tests), TypeScript, React hooks.

---

## Global Constraints

- All dates must be future-only (no past date assignments)
- Private data: Manager-only visibility on rejection reasons
- RBAC permissions: shift.read (view), shift.manage (approve/reject)
- Email notifications on every state change: PENDIENTE → APROBADA/RECHAZADA
- In-app notifications + audit trail (quién, cuándo, decisión, motivo)
- Rejected requests allow infinite retries (loop until APROBADA or employee gives up)
- Intercambios (Feature 4) are different flow — cambios are 1:1 employee → manager

---

## Sprint 7: Feature 2 - Cambios de Turno

**Goal:** Employees request shift changes (mismo día, otro día, otro turno tipo), managers approve/reject, system notifies.

---

### Task 1: Backend - Modelo `SolicitudCambioTurno` + Migration

**Files:**
- Modify: `packages/database/prisma/schema.prisma`
- Create: `packages/database/prisma/migrations/YYYYMMDDHHMMSS_solicitud_cambio_turno/migration.sql`

**Model fields:**
```prisma
model SolicitudCambioTurno {
  id              String    @id @default(cuid())
  tenantId        String
  employeeId      String
  fechaSolicitud  DateTime  @default(now())
  
  // Shift being changed FROM
  fechaActual     DateTime  // Date of current shift assignment
  turnoIdActual   String?   // Current turno.id (null if DESCANSO)
  
  // Shift being changed TO
  fechaNueva      DateTime  // Requested date (can be different)
  turnoIdNuevo    String?   // Requested turno.id (null if requesting DESCANSO)
  
  // Status: PENDIENTE → APROBADA/RECHAZADA
  estado          String    @default("PENDIENTE")  // PENDIENTE | APROBADA | RECHAZADA
  
  // Decision
  fechaDecision   DateTime?
  decididoPor     String?   // Manager user ID
  motivoRechazo   String?   // Why rejected (Manager-only visible)
  
  // Audit
  creadoEn        DateTime  @default(now())
  creadoPor       String
  actualizadoEn   DateTime  @updatedAt
  actualizadoPor  String?
  
  // Relations
  employee        Employee  @relation(fields: [employeeId], references: [id])
  turnoActual     Turno?    @relation("turnoActual", fields: [turnoIdActual], references: [id])
  turnoNuevo      Turno?    @relation("turnoNuevo", fields: [turnoIdNuevo], references: [id])
  
  @@unique([tenantId, employeeId, fechaActual])  // One pending request per employee per date
  @@index([tenantId, estado])
  @@index([tenantId, employeeId])
  @@index([decididoPor])
}
```

**Steps:**
1. Add model to schema
2. Run migration
3. Commit

---

### Task 2: Backend - `SolicitudCambioTurnoService` (CRUD)

**Files:**
- Create: `apps/api/src/modules/shifts/solicitud-cambio-turno.service.ts`
- Create: `apps/api/src/modules/shifts/solicitud-cambio-turno.service.spec.ts`

**Interfaces:**
- `crearSolicitud(tx, input: CrearSolicitudInput): Promise<SolicitudCambioTurno>`
- `listarSolicitudes(tx, filtros): Promise<SolicitudCambioTurno[]>`
- `aprobarSolicitud(tx, id, decididoPor): Promise<SolicitudCambioTurno>`
- `rechazarSolicitud(tx, id, motivoRechazo, decididoPor): Promise<SolicitudCambioTurno>`

**Validations:**
- fechaActual + fechaNueva must be future dates
- No duplicate pending requests (employee + fechaActual)
- fechaNueva cannot conflict with existing holidays/days off
- turnoIdActual must match current assignment
- turnoIdNuevo must exist in Turno catálogo

**Implementation notes:**
- PENDIENTE → APROBADA: Update turnoAsignacion for fechaNueva
- PENDIENTE → RECHAZADA: No side effects, just record rejection
- Rejected request allows new request (loop enabled)

---

### Task 3: Backend - `SolicitudCambioTurnoService` - Approve/Reject with Transaction

Update SolicitudCambioTurnoService to handle state transitions:

**aprobarSolicitud:**
- Validate request exists + PENDIENTE state
- Call ShiftPlanService.upsertAsignacion() for fechaNueva with turnoIdNuevo
- Update solicitud: estado=APROBADA, fechaDecision=now, decididoPor
- Trigger NotificationService.notificarSolicitudAprobada()

**rechazarSolicitud:**
- Validate request exists + PENDIENTE state
- Store motivoRechazo (Manager-only field, encrypted/restricted on API)
- Update solicitud: estado=RECHAZADA, fechaDecision=now, decididoPor, motivoRechazo
- Trigger NotificationService.notificarSolicitudRechazada()

**Tests:** 
- Happy path: create → approve → verify turnoAsignacion updated
- Rejection with reason
- Duplicate pending request rejection
- Future-only date validation

---

### Task 4: Backend - API Endpoints + Controller

**Files:**
- Modify: `apps/api/src/modules/shifts/shifts.controller.ts`

**Endpoints:**
- `@Post('cambios')` + `@RequirePermission('shift.manage')` → crear solicitud (empleado o manager)
- `@Get('cambios')` + `@RequirePermission('shift.read')` → listar (filter by employee, state, date range)
- `@Put('cambios/:id/aprobar')` + `@RequirePermission('shift.manage')` → approve
- `@Put('cambios/:id/rechazar')` + `@RequirePermission('shift.manage')` → reject with motivo
- `@Get('cambios/mios')` + `@RequirePermission('shift.read')` → my requests (current employee only)

**Response filters:**
- motivoRechazo visible only to Manager (shift.manage)
- Regular employees see only: estado, fechaSolicitud, fechaDecision

---

### Task 5: Frontend - Tab "Mis Cambios" (Employee)

**Files:**
- Create: `apps/web/src/app/(app)/turnos/mis-cambios-tab.tsx`

**Features:**
- List user's change requests (PENDIENTE, APROBADA, RECHAZADA)
- Button: [+ NUEVO CAMBIO]
- Form modal:
  - Current shift (read-only, auto-filled from today's assignment)
  - Requested date (date picker, future-only)
  - Requested shift type (dropdown: DIA/NOCHE/DESC)
  - Submit [Solicitar]
- Status badge: PENDIENTE (yellow) | APROBADA (green) | RECHAZADA (red)
- Rejected requests show option to [Reintentar]

---

### Task 6: Frontend - Board "Cambios Pendientes" (Manager)

**Files:**
- Create: `apps/web/src/app/(app)/turnos/cambios-board-tab.tsx`

**Features:**
- Kanban board: PENDIENTE | APROBADA | RECHAZADA
- Filter: employee, date range, state
- Card per request: employee name, date, turno actual → turno nuevo, fecha solicitud
- Actions:
  - [Aprobar] → confirms, updates turnoAsignacion
  - [Rechazar] → modal for motivo rechazo + submit
- Show employee's retry count (if same date requested again)

---

### Task 7: Backend - Notifications for Feature 2

**Files:**
- Modify: `apps/api/src/common/services/notification.service.ts`

**Methods to add:**
- `notificarSolicitudCreada(tenantId, empleadoId, fecha, turnoNuevo): Promise<void>`
- `notificarSolicitudAprobada(tenantId, empleadoId, fecha, turnoNuevo): Promise<void>`
- `notificarSolicitudRechazada(tenantId, empleadoId, fecha, motivoRechazo): Promise<void>`

**Integration:**
- Call in SolicitudCambioTurnoService on state transitions
- Email + in-app notifications
- Non-blocking (catch errors, log, don't throw)

---

### Task 8: Integration Test - Feature 2 E2E

**Files:**
- Create: `apps/api/src/modules/shifts/feature-2.integration.spec.ts`

**Test scenario:**
```
1. Employee creates solicitud for date 2026-08-10, change from NOCHE to DIA
2. Verify solicitud created with estado=PENDIENTE
3. Manager approves
4. Verify turnoAsignacion updated for 2026-08-10 to DIA
5. Verify notifications fired
6. Employee tries same date again → creates new PENDIENTE request
7. Manager rejects with motivo "Ya hay cobertura"
8. Verify employee can retry
```

**Assertions:**
- Estado transitions: PENDIENTE → APROBADA/RECHAZADA
- turnoAsignacion updated on approval
- Duplicate pending requests rejected
- Infinite retry loop enabled

---

### Task 9: Sprint 7 - Final Verification

**Checklist:**
- [ ] Full test suite passes
- [ ] TypeScript clean
- [ ] Web builds successfully
- [ ] All required files present
- [ ] Cambios tab visible in /turnos (employee)
- [ ] Board tab visible in /turnos (manager)
- [ ] Workflow tested end-to-end

---

## Implementation Notes

**Deferred (MVP-acceptable):**
- Conflict detection (if another employee requests same date/turno) — accept first request only
- Email to affected parties (e.g., team lead if workload impacted) — phase 8+
- Calendar view (conflicts, visual scheduling) — phase 8+

**Integration with prior features:**
- Uses ShiftPlanService (Task 4 integration) for turnoAsignacion updates
- Uses NotificationService (from Sprint 6 Task 7)
- Respects shift compliance rules (ShiftComplianceService)

---

**Total: 9 tasks, ~40-50 commits (including tests + fixes)**

Estimated: 1-2 weeks (depending on parallel sprints and review cycles)

---
