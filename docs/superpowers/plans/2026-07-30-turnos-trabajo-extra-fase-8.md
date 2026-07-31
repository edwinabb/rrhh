# Sprint 8: Trabajo Fuera de Turno (Feature 3)

**Versión:** 1.0.0
**Fecha:** 2026-07-30
**Estado:** Listo para implementación
**Rama:** `feat/turnos-trabajo-extra-fase-8` (nueva, derivar de `master` post-Sprint-7-merge)

---

## 📋 Resumen

**Objetivo:** Implementar Feature 3 (Trabajo Fuera de Turno) con 9 tareas de backend + frontend + testing.

**Workflow:**
1. Empleado solicita trabajo urgente/adicional (tarea + fecha + horas)
2. Manager aprueba/reasigna → notificación
3. Empleado entrega reporte (actividades + fotos con timestamp)
4. Manager valida reporte → registra compensatorio (ej: 3h extra → 3h compensatoria)
5. Empleado puede reintentar reporte si es rechazado

**Arquitectura:**
- 3 estados principales: solicitud (PENDIENTE_APROBACIÓN) → reporte (REPORTE_PENDIENTE_VALIDACIÓN) → validación (VALIDADA)
- Datos privados al Manager: `causaHorasExtras`, `horasAcumuladas`, `saldoCompensatorios` (RLS filter)
- Non-blocking notifications (email + in-app, errors logged not thrown)
- Transaccional: approval + reasignación atómica, validation + compensatorio atómica

**Estimado:** ~20 tareas, ~5-6 días (basado en Sprint 7)

---

## 🎯 Global Constraints

Aplica a todas las tareas de Sprint 8:

1. **Database & RLS:**
   - Modelo: `SolicitudTrabajoAdicional` con tenant isolation
   - RLS policy: `tenant_isolation` (row-level security por `tenantId`)
   - Permisos: `app_employee` (SELECT/INSERT), `app_rrhh/app_admin/app_manager` (SELECT/INSERT/UPDATE)
   - Audit trigger: createdAt, createdBy, updatedAt, updatedBy

2. **Services & Validation:**
   - Validaciones en servicio, no en Controller
   - Errores: BadRequestException (validación), ConflictException (conflictos), NotFoundException (missing)
   - Llamadas externas no-blocking: wrap en try-catch, log errors, never throw

3. **API Endpoints & RBAC:**
   - Permiso `shift.read`: empleado solicita/reporta
   - Permiso `shift.manage`: manager aprueba/reasigna/valida
   - Permiso `shift.resolve`: RRHH acceso a reportes (informativo)
   - Campos privados (`causaHorasExtras`, `horasAcumuladas`, `saldoCompensatorios`): filtrar si no tiene `shift.manage` via helper
   - Status codes: 200 (ok), 201 (created), 204 (no content), 400 (bad request), 409 (conflict), 404 (not found), 403 (forbidden), 500 (server error)

4. **Frontend & UI:**
   - Tab "Trabajo Fuera de Turno" agregada a `/turnos/page.tsx`
   - 2-4 sub-tabs para empleado (solicitar, mis-trabajos) + manager (pendientes, validar)
   - Responsive cards/lists, accessibility WCAG 2.1 Level AA
   - Client-side validations: required fields, future-only dates, <=12 hours
   - Toasts: success (verde), error (rojo), info (azul)

5. **Testing & Quality:**
   - Unit tests: >80% coverage per service/controller
   - Mocked Prisma transaction client (fake store, in-memory isolation)
   - E2E test: full workflow (request → approve → report → validate)
   - TypeScript strict mode, no `any`
   - All tests pass before commit

6. **Git & Commits:**
   - One commit per task (clean history)
   - Message format: `feat(turnos-fase-8): <task-name>` or `test(turnos-fase-8): <test-name>`
   - Worktree isolation: all work in `.worktrees/feat-turnos-trabajo-extra-fase-8`

---

## 📅 Tareas (9 total)

### Task 1: Database Model & Migration
**Objetivo:** Crear modelo `SolicitudTrabajoAdicional` con RLS y migración.

**Archivos:**
- Create: `packages/database/prisma/schema.prisma` (add model)
- Create: `packages/database/prisma/migrations/<timestamp>_solicitud_trabajo_adicional.sql`

**Modelo:**
```typescript
SolicitudTrabajoAdicional {
  id: String @id @default(cuid())
  tenantId: String
  employeeIdSolicitante: String    // FK empleado
  employeeIdAsignado: String       // FK empleado (puede cambiar)
  descripcionTarea: String
  fechaEstimada: DateTime
  horasEstimadas: Float            // > 0 && <= 12
  urgencia: 'NORMAL' | 'URGENTE'
  
  causaHorasExtras: Boolean?       // ¿suma >48h esa semana?
  horasAcumuladas: Float?          // PRIVADO: solo Manager
  saldoCompensatorios: Float?      // PRIVADO: solo Manager
  
  estado: 'PENDIENTE_APROBACIÓN' | 'APROBADA' | 'REASIGNADA' | 'RECHAZADA' | 'REPORTE_PENDIENTE_VALIDACIÓN' | 'REPORTE_RECHAZADO' | 'VALIDADA'
  
  managerId: String?               // FK quien aprobó/rechazó
  motivoRechazo: String?
  
  reporteDescripcion: String?
  reporteFotos: String[]?          // URLs
  reporteNotas: String?
  reporteEnviadoEn: DateTime?
  
  createdAt: DateTime @default(now())
  createdBy: String?
  updatedAt: DateTime @updatedAt
  updatedBy: String?
  
  @@unique([tenantId, id])
  @@index([tenantId, employeeIdSolicitante])
  @@index([tenantId, employeeIdAsignado])
  @@index([tenantId, estado])
}
```

**RLS Policy:**
```sql
CREATE POLICY tenant_isolation ON SolicitudTrabajoAdicional
  USING (tenantId = current_setting('app.tenant_id')::uuid);

GRANT SELECT, INSERT ON SolicitudTrabajoAdicional TO app_employee;
GRANT SELECT, INSERT, UPDATE ON SolicitudTrabajoAdicional TO app_rrhh, app_admin, app_manager;
```

**Audit Trigger:**
```sql
CREATE TRIGGER set_audit_fields
  BEFORE INSERT OR UPDATE ON SolicitudTrabajoAdicional
  FOR EACH ROW EXECUTE FUNCTION set_audit_fields();
```

**Tests:** None (DB-only task, tested via integration)
**Commit:** `feat(turnos-fase-8): modelo SolicitudTrabajoAdicional + RLS + migration`

---

### Task 2: CRUD Service
**Objetivo:** Crear `SolicitudTrabajoAdicionalService` con métodos core (crear, listar, obtener, actualizar estado).

**Archivo:** `apps/api/src/modules/shifts/solicitud-trabajo-adicional.service.ts`

**Métodos:**
1. `crearSolicitud(tenantId, employeeIdSolicitante, descripcionTarea, fechaEstimada, horasEstimadas, urgencia): Promise<SolicitudTrabajoAdicional>`
   - Validaciones: fecha futura, horas <= 12, empleado activo
   - Calcula `causaHorasExtras`, `horasAcumuladas` (private, solo si manager)
   - Returns: SolicitudTrabajoAdicional (PENDIENTE_APROBACIÓN)

2. `listarSolicitudes(tenantId, filters?: { estado?, employeeId?, fechaDesde?, fechaHasta? }): Promise<SolicitudTrabajoAdicional[]>`
   - Sin filters devuelve todas (sin privados si no manager)
   - Con filters: estado=PENDIENTE_APROBACIÓN, rango de fechas, empleado específico

3. `obtenerSolicitud(tenantId, id): Promise<SolicitudTrabajoAdicional>`
   - Devuelve solicitud con auditoría
   - Filtra privados si caller no es manager

4. `listarMisSolicitudes(tenantId, employeeId): Promise<SolicitudTrabajoAdicional[]>`
   - Solo del empleado actual (PENDIENTE_APROBACIÓN, APROBADA, REASIGNADA, RECHAZADA, REPORTE_PENDIENTE_VALIDACIÓN, etc.)
   - Sin privados

5. `actualizarEstado(tenantId, id, nuevoEstado, managerId, motivoRechazo?): Promise<SolicitudTrabajoAdicional>`
   - PENDIENTE_APROBACIÓN → APROBADA/RECHAZADA
   - REPORTE_PENDIENTE_VALIDACIÓN → VALIDADA/REPORTE_RECHAZADO
   - Registra managerId, motivoRechazo, decidoEn

**Error Handling:**
- BadRequestException: horas > 12, fecha pasada, empleado no activo
- ConflictException: duplicado PENDIENTE mismo empleado misma fecha
- NotFoundException: solicitud no existe

**Tests:** Unit tests (14-16 tests)
- Happy path create + list + get + update
- Validation branches (all 3 error paths)
- Permission filtering (private fields stripped)

**Commit:** `feat(turnos-fase-8): CRUD service SolicitudTrabajoAdicional`

---

### Task 3: Approval/Reasignation Orchestration
**Objetivo:** Crear `SolicitudTrabajoAdicionalAplicadorService` con métodos de aprobación/reasignación/rechazo.

**Archivo:** `apps/api/src/modules/shifts/solicitud-trabajo-adicional-aplicador.service.ts`

**Métodos:**
1. `aprobarSolicitud(tenantId, id, managerId): Promise<SolicitudTrabajoAdicional>`
   - actualizarEstado(…, APROBADA, managerId)
   - notificarSolicitudAprobada(employeeIdAsignado, tarea)
   - Returns: updated solicitud

2. `reasignarSolicitud(tenantId, id, employeeIdNuevo, managerId): Promise<SolicitudTrabajoAdicional>`
   - Valida: empleado nuevo activo, no duplicado (same date+task)
   - Actualiza: employeeIdAsignado = new, estado = REASIGNADA, managerId
   - notificarSolicitudReasignada(employeeIdNuevo, tarea, detalles)
   - Returns: updated solicitud

3. `rechazarSolicitud(tenantId, id, managerId, motivoRechazo?): Promise<SolicitudTrabajoAdicional>`
   - actualizarEstado(…, RECHAZADA, managerId, motivoRechazo)
   - notificarSolicitudRechazada(employeeIdSolicitante, motivoRechazo)
   - Returns: updated solicitud

**Dependencies:**
- Inyectar SolicitudTrabajoAdicionalService
- Inyectar NotificationService (new methods added here or in Task 7)

**Call Order:** Similar a Feature 2: actualizar estado ANTES de notificar (no-blocking)

**Tests:** Unit tests (12-14 tests)
- Happy path approve/reasign/reject
- Error paths: empleado no activo, duplicado
- Notification resilience (errors logged not thrown)

**Commit:** `feat(turnos-fase-8): orquestación aprobación/reasignación`

---

### Task 4: API Endpoints & Controller
**Objetivo:** Agregar 8 nuevos endpoints a `shifts.controller.ts` con RBAC + permission filtering.

**Endpoints:**
1. `POST /turnos/trabajo-adicional/solicitar` (@RequirePermission shift.read)
   - Input: { descripcionTarea, fechaEstimada, horasEstimadas, urgencia }
   - Calls: crearSolicitud(tenantId, req.user.id, …)
   - Output: { id, estado, etc. } (sin privados)
   - Status: 201 Created

2. `GET /turnos/trabajo-adicional/mis-solicitudes` (@RequirePermission shift.read)
   - Filters: none (auto-filtra por req.user.id)
   - Output: SolicitudTrabajoAdicional[] (sin privados)
   - Status: 200 OK

3. `GET /turnos/trabajo-adicional/pendientes` (@RequirePermission shift.manage)
   - Filters: estado=PENDIENTE_APROBACIÓN, optional (employeeId, fechaDesde, fechaHasta)
   - Output: SolicitudTrabajoAdicional[] (WITH privados si manager)
   - Status: 200 OK

4. `GET /turnos/trabajo-adicional/validar` (@RequirePermission shift.manage)
   - Filters: estado=REPORTE_PENDIENTE_VALIDACIÓN
   - Output: SolicitudTrabajoAdicional[] (WITH privados + reporte)
   - Status: 200 OK

5. `PUT /turnos/trabajo-adicional/:id/aprobar` (@RequirePermission shift.manage)
   - Calls: aprobarSolicitud(tenantId, id, req.user.id)
   - Output: { success, id, estado }
   - Status: 200 OK

6. `PUT /turnos/trabajo-adicional/:id/reasignar` (@RequirePermission shift.manage)
   - Input: { employeeIdNuevo: string }
   - Calls: reasignarSolicitud(tenantId, id, employeeIdNuevo, req.user.id)
   - Output: { success, id, estado, emailEnviado: boolean }
   - Status: 200 OK

7. `PUT /turnos/trabajo-adicional/:id/rechazar` (@RequirePermission shift.manage)
   - Input: { motivoRechazo?: string }
   - Calls: rechazarSolicitud(tenantId, id, req.user.id, motivoRechazo)
   - Output: { success, id, estado }
   - Status: 200 OK

8. `GET /turnos/trabajo-adicional/:id` (@RequirePermission shift.read)
   - Output: SolicitudTrabajoAdicional (con/sin privados según permisos)
   - Status: 200 OK

**Permission Filtering Helper:**
```typescript
private filtrarCamposPrivados(solicitud: SolicitudTrabajoAdicional, permissions: string[]): SolicitudTrabajoAdicional {
  if (!permissions.includes('shift.manage')) {
    delete solicitud.causaHorasExtras;
    delete solicitud.horasAcumuladas;
    delete solicitud.saldoCompensatorios;
  }
  return solicitud;
}
```

**Error Handling:** 400, 404, 409, 403 (permission), 500

**Tests:** Controller tests (18-20 tests)
- Happy path all 8 endpoints
- Permission validation (403 Forbidden si no tiene permiso)
- Status code verification
- Permission filtering

**Commit:** `feat(turnos-fase-8): API endpoints + controller RBAC`

---

### Task 5: Frontend Employee Tab - Solicitar & Mis Trabajos
**Objetivo:** Crear 2 sub-tabs en "Trabajo Fuera de Turno" (empleado):
- "Solicitar" (crear nueva solicitud)
- "Mis Trabajos" (listar mis solicitudes)

**Archivo:** `apps/web/src/app/(app)/turnos/trabajo-adicional-empleado-tab.tsx` (~300-350 líneas)

**Sub-tab 1: Solicitar**
- Form: descripción (textarea), fecha (datepicker, future-only), horas (number input, <=12), urgencia (dropdown: NORMAL/URGENTE)
- Submit: POST /turnos/trabajo-adicional/solicitar
- Success toast: "Solicitud creada. Manager revisará en breve."
- Error toast + field validation

**Sub-tab 2: Mis Trabajos**
- List: cards de mis solicitudes con estado badge (PENDIENTE_APROBACIÓN=yellow, APROBADA=green, RECHAZADA=red, REPORTE_PENDIENTE_VALIDACIÓN=orange, VALIDADA=green)
- Filter: estado dropdown
- Card mostra: tarea, fecha, horas, urgencia, estado, motivoRechazo (si rechazada)
- Actions: 
  - Si APROBADA: [+ Enviar Reporte] → abre modal para fotos + descripción
  - Si REPORTE_RECHAZADO: [+ Reintentar Reporte] → modal nuevamente
  - Si VALIDADA: "Reporte Validado ✓"

**Modal Enviar Reporte:**
- Descripción de actividades (textarea)
- Upload fotos (2+ required, max 5MB each, JPG/PNG)
- Notas opcionales
- Submit: POST /turnos/trabajo-adicional/:id/reporte
- Success: "Reporte enviado. Manager validará en breve."

**Styling:** Responsive cards, color-coded badges

**Modified Files:**
- `apps/web/src/app/(app)/turnos/page.tsx`: add tab
- `apps/web/lib/api/shifts-api.ts`: add functions (solicitarTrabajoAdicional, listarMisTrabajos, enviarReporte)

**Tests:** None (no frontend testing infrastructure, but tsc + next build should pass)

**Commit:** `feat(web): tab Trabajo Adicional para empleado (solicitar + mis trabajos)`

---

### Task 6: Frontend Manager Tab - Pendientes & Validar
**Objetivo:** Crear 2 sub-tabs en "Trabajo Fuera de Turno" (manager):
- "Pendientes de Aprobación" (board con solicitudes PENDIENTE_APROBACIÓN)
- "Validar Reportes" (board con REPORTE_PENDIENTE_VALIDACIÓN)

**Archivo:** `apps/web/src/app/(app)/turnos/trabajo-adicional-manager-tab.tsx` (~400-450 líneas)

**Sub-tab 1: Pendientes de Aprobación**
- List/board: cards de solicitudes PENDIENTE_APROBACIÓN
- Filters: empleado (dropdown), urgencia (NORMAL/URGENTE), fecha range
- Card muestra:
  - Empleado + ID
  - Descripción tarea
  - Fecha + horas
  - Urgencia (badge)
  - **Privados:** "¿Causa extras? [SÍ/NO]", "Horas acumuladas: [X]h", "Saldo compensatorios: [Y]h"
  - Actions: [Aprobar] [Reasignar] [Rechazar]

**Actions:**
- **[Aprobar]:** PUT /turnos/trabajo-adicional/:id/aprobar → success toast + remove card
- **[Reasignar]:** Modal selectpicker (lista empleados activos)
  - Muestra compensatorios del empleado nuevo (informativo)
  - Confirm → PUT /turnos/trabajo-adicional/:id/reasignar → success toast
- **[Rechazar]:** Modal motivo + PUT /turnos/trabajo-adicional/:id/rechazar

**Sub-tab 2: Validar Reportes**
- List: cards de solicitudes REPORTE_PENDIENTE_VALIDACIÓN
- Filters: empleado, fecha range
- Card muestra:
  - Empleado + ID
  - Tarea + fecha + horas
  - Descripción del reporte (truncada)
  - Galería de fotos (clickable → lightbox)
  - Actions: [Validar] [Pedir Reentrega]

**Actions:**
- **[Validar]:** PUT /turnos/trabajo-adicional/:id/validar → success toast "Compensatorio registrado" + remove card
- **[Pedir Reentrega]:** Modal motivo + PUT /turnos/trabajo-adicional/:id/reporte-rechazar (new endpoint)

**Permission Guard:** Requiere `shift.manage` (redirect si no tiene)

**Modified Files:**
- `apps/web/src/app/(app)/turnos/page.tsx`: add tab
- `apps/web/lib/api/shifts-api.ts`: add functions (listarPendientes, listarReportesValidar, aprobarTrabajoAdicional, reasignarTrabajoAdicional, rechazarTrabajoAdicional, validarReporte, pedirReentregaReporte)

**Styling:** Responsive cards, private fields highlighted, photo gallery

**Tests:** None (no frontend testing)

**Commit:** `feat(web): tab Trabajo Adicional para manager (pendientes + validar)`

---

### Task 7: Notifications for Feature 3
**Objetivo:** Agregar 7 métodos de notificación a `NotificationService` para Feature 3.

**File:** `apps/api/src/common/services/notification.service.ts`

**Methods:**
1. `async notificarSolicitudTrabajoCreada(tenantId, employeeId, tarea, fecha, horas, urgencia, privados): Promise<void>`
   - Email a Manager: "[Emp] solicita trabajo adicional [fecha]: [tarea]. Horas: [h]. Urgencia: [urgencia]. ¿Extras? [SÍ/NO]."
   - In-app: Same (privados no incluidos en in-app)

2. `async notificarTrabajoAprobado(tenantId, employeeId, tarea): Promise<void>`
   - Email a Emp: "Tu solicitud de trabajo adicional fue APROBADA. Tarea: [tarea]. Envía tu reporte cuando completes."
   - In-app: Same

3. `async notificarTrabajoReasignado(tenantId, employeeIdNuevo, tarea, descripcion, fecha, horas): Promise<void>`
   - Email a Emp nuevo: "Se te asignó trabajo urgente: [tarea]. Descripción: [descripcion]. Fecha: [fecha]. Horas: [horas]."
   - In-app: Same

4. `async notificarTrabajoRechazado(tenantId, employeeId, tarea, motivoRechazo?): Promise<void>`
   - Email a Emp: "Tu solicitud de trabajo adicional fue RECHAZADA. Motivo: [motivo opt]."
   - In-app: Same (sin motivo si en in-app)

5. `async notificarReporteEnviado(tenantId, managerId, tarea, fecha): Promise<void>`
   - Email a Manager: "[Emp] entregó reporte de trabajo adicional [tarea] ([fecha])."
   - In-app: Same

6. `async notificarReporteValidado(tenantId, employeeId, tarea, horasCompensatorios): Promise<void>`
   - Email a Emp: "Tu reporte fue VALIDADO. Compensatorio registrado: [horas]h."
   - In-app: Same

7. `async notificarReportePedidoReentrega(tenantId, employeeId, tarea, motivo?): Promise<void>`
   - Email a Emp: "Tu reporte fue rechazado y necesita reentrega. Motivo: [motivo opt]. Por favor reenvía fotos + descripción."
   - In-app: Same (sin motivo si en in-app)

**Error Handling:** All methods non-blocking (try-catch, log errors, never throw)

**Tests:** Notification service tests (~14-16 tests for Feature 3)
- Each method tested: email + in-app called
- Error handling: failures logged, not thrown
- Email template validation (has key fields)

**Commit:** `feat(notificaciones): notificar trabajo adicional (7 métodos)`

---

### Task 8: E2E Integration Test
**Objetivo:** Full workflow test Feature 3 con simulación transaccional.

**File:** `apps/api/src/modules/shifts/feature-3.integration.spec.ts` (~600-700 líneas)

**Test Scenario:**
```
1. Employee A creates solicitud: "Análisis urgente", 2026-08-05, 3 horas, URGENTE
2. Verify solicitud created with estado=PENDIENTE_APROBACIÓN
3. Manager approves solicitud
4. Verify notifications fired (mocked)
5. Employee A uploads report: actividades + 2 fotos
6. Verify estado=REPORTE_PENDIENTE_VALIDACIÓN
7. Manager validates report
8. Verify CompensatorioMovimiento created (GANADO, 3h)
9. Verify estado=VALIDADA, notifications fired
10. Manager rejects report on another solicitud
11. Employee B resubmits report
12. Manager validates reentrega
13. Test reasignación: Manager reasigns to Employee B, Employee B approves
14. Test all state transitions + side effects correct
```

**Test Cases (5-6 cases):**
1. Main workflow (request → approve → report → validate)
2. Rejection + resubmit flow
3. Reasignation + new employee execution
4. Validation side effects (compensatorio created)
5. Duplicate prevention (no 2 PENDIENTE same employee same date)
6. Permission validation (non-manager cannot access privados)

**Assertions:** >40 assertions verifying state transitions, side effects, FK consistency

**Fake Prisma Transaction:** In-memory stores (employados, solicitudes, compensatorios, notificaciones)

**Tests:** 6/6 integration test cases pass

**Commit:** `test(turnos-fase-8): feature 3 end-to-end integration test`

---

### Task 9: Final Verification
**Objetivo:** Verificación completa de Sprint 8.

**Checklist:**
1. **Full test suite:** `pnpm --filter @rrhh/api test`
   - Expected: All tests PASS (>600 total, +250 from Sprint 8)
   - 0 failures, 0 TypeScript errors

2. **TypeScript check:** `pnpm --filter @rrhh/api exec tsc --noEmit`
   - Expected: 0 errors

3. **Web build:** `pnpm --filter @rrhh/web build`
   - Expected: Success, bundle size ~14-15 kB for /turnos

4. **Git log:** Verify 9 commits (Task 1-9) + 1 merge commit = 10 commits
   - Format: `feat(turnos-fase-8): <task-name>` or `test(turnos-fase-8): <test-name>`

5. **Manual testing (optional but recommended):**
   - Create solicitud as employee → verify PENDIENTE
   - Approve as manager → verify APROBADA + notif
   - Upload report → verify REPORTE_PENDIENTE_VALIDACIÓN
   - Validate → verify VALIDADA + compensatorio created

6. **Documentation:**
   - Verify docs/PENDIENTES.md updated with Sprint 8 100% complete
   - Verify technical debt section updated if applicable

---

## 🔑 Success Criteria

✅ All 9 tasks implemented
✅ 600+ tests passing (0 failures)
✅ 0 TypeScript errors
✅ Web build success
✅ PR ready for review
✅ Documentation updated

---

## 📌 Notes

- **Worktree:** Use `.worktrees/feat-turnos-trabajo-extra-fase-8` (isolated)
- **Branching:** Derive from `master` after Sprint 7 is merged (v1.3.0)
- **Workflow:** Subagent-driven-development (1 implementer per task, scoped reviewer, fix loop max 5 rounds)
- **Model:** Replicate Sprints 6-7 architecture (validations in service, RLS in DB, non-blocking notifications, RBAC in controller)
- **Version bump:** v1.4.0 upon completion (3/4 features)
- **PR:** After Task 9, create PR to `master` with full commit history

---

## 📚 References

- Specification: `docs/superpowers/specs/2026-07-18-turnos-mejoras-phase-6-9.md` (Section 4)
- Previous Sprint 6 & 7 architecture: `.superpowers/sdd/2026-07-30-turnos-patrones-fase-6/` (briefs + reports for reference)
- Database schema: `packages/database/prisma/schema.prisma` (models RotacionPatron, SolicitudCambioTurno as templates)
- API patterns: `apps/api/src/modules/shifts/shifts.controller.ts` (Sprint 6-7 endpoints as reference)
