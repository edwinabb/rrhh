# Pendientes y Plan de Trabajo

**Actualizado:** 2026-08-05 (Sprint 9 completo) · **Estado del sistema:** todo verde en `feat/turnos-intercambios-fase-9` (548 tests, 0 errores TypeScript en api + web, build web exitoso) — Sprint 6 ✅ (Feature 1 Patrones) + Sprint 7 ✅ (Feature 2 Cambios) + Sprint 8 ✅ (Feature 3 Trabajo Fuera de Turno) + Sprint 9 ✅ (Feature 4 Intercambios) — 4/4 features de Fases 6-9 completadas.

---

## 🎯 Turnos (Fases 6-9) — Autoservicio + Gestión Avanzada

**Especificación:** `docs/superpowers/specs/2026-07-18-turnos-mejoras-phase-6-9.md`
**Plan de implementación:** `docs/superpowers/plans/2026-07-18-turnos-mejoras-phase-6-9.md`

4 features independientes con tabs separados en `/turnos`:

1. **✅ Sprint 6 - Patrones de Rotación (COMPLETO):** Manager define patrón recurrente (ej: 2 DIA + 2 NOCHE + 3 DESC) e inyecta masivamente al plan. 9/9 tareas completadas (2026-07-30). Feature: catálogo de patrones + aplicador con preview editable + notificaciones + E2E testing. Tests: 328/328 pass. PR merged.
2. **✅ Sprint 7 - Cambios de Turno (COMPLETO):** Empleado solicita cambio → Manager aprueba/rechaza → reintentos permitidos. 9/9 tareas completadas (2026-07-30). Modelo + CRUD + lógica transaccional + 5 endpoints API + tab "Mis Cambios" (empleado) + tablero Kanban (manager) + notificaciones + E2E testing. Tests: 391/391 pass. v1.3.0.
3. **✅ Sprint 8 - Trabajo Fuera de Turno (COMPLETO):** Empleado reporta trabajo extra (tarea + fotos + timestamp) → Manager valida → genera compensatorio automáticamente. Datos privados (Manager-only: causaHorasExtras, horasAcumuladas, saldoCompensatorios). 9/9 tareas completadas (2026-07-30 a 2026-08-01). Modelo `SolicitudTrabajoAdicional` + RLS + migration, CRUD + report service, orquestación (aprobar/reasignar/rechazar solicitud + validar/rechazar reporte, incl. creación automática de movimiento GANADO en el libro de compensatorios), 11 endpoints con RBAC, tab empleado (Solicitar + Mis Trabajos), tab manager (Pendientes + Validar), 7 métodos de notificación, E2E integration test (70 assertions). Tests: 498/498 pass (0 fallas, 0 errores TypeScript). Commits: `02c647c..a9f47a3` (11, uno de ellos fix-round de nombres de índice). Branch: `feat/turnos-trabajo-extra-fase-8`.
4. **✅ Sprint 9 - Portal de Intercambios (COMPLETO):** Empleado A propone intercambiar turno con Empleado B → B acepta/rechaza → Manager aprueba/rechaza, salvo que pasen 48h sin decisión o llegue la fecha del turno (el sistema resuelve automáticamente en esos casos vía barrido perezoso). 9/9 tareas completadas (2026-08-05). Diseño: `docs/superpowers/specs/2026-08-04-turnos-intercambios-fase-9-design.md`. Plan: `docs/superpowers/plans/2026-08-04-turnos-intercambios-fase-9.md`. Modelo `IntercambioTurno` + RLS + migration, `IntercambioTurnoService` (proponer/aceptar/rechazarPorB) + `IntercambioTurnoAplicadorService` (orquestación: aprobar/rechazar manual + resolución automática por barrido perezoso en 48h/fecha alcanzada, reusa `CompensatorioService.intercambiar()` de Fase 5 sin modificarlo), 8 endpoints con RBAC (`shift.read`/`shift.resolve`, sin permisos nuevos), 5 métodos de notificación, tab empleado "Intercambios" + tab manager "Intercambios (Manager)", E2E integration test (`feature-4.integration.spec.ts`). Ejecutado vía subagent-driven-development en worktree `.worktrees/feat-turnos-intercambios-fase-9` (rama `feat/turnos-intercambios-fase-9`, a diferencia de Sprints 6-8 que trabajaron directo en `master`). Tests: 548/548 pass, 0 errores TypeScript (api + web), build web exitoso. Ledger de progreso: `.superpowers/sdd/2026-08-04-turnos-intercambios-fase-9/progress.md` (dentro del worktree). Pendiente: merge a `master` vía `superpowers:finishing-a-development-branch`.

**Principios:**
- Independencia: ciclos separados, permisos RBAC distintos, parallelizable
- Notificaciones: email + in-app en cada cambio de estado
- Auditoría: quién, cuándo, decisión, motivo
- Datos privados (Feature 3): horasAcumuladas, causaHorasExtras, saldoCompensatorios solo para Manager/Director
- Fotos con timestamp visible en imagen (Feature 3)
- Reporte rechazado permite reintentos infinitos hasta validación (Feature 3)

---

## 📌 Próximos pasos inmediatos

- **Sprint 8 cerrado (2026-08-04):** los 11 commits (`02c647c..bbd144f`) ya vivían directamente en `master` (no hubo rama/PR separada — se trabajó ahí desde el inicio), así que no hizo falta merge. Se hizo el bump de versión a `v1.4.0` + commit `release:` + tag, y se limpió el directorio huérfano `.worktrees/feat-turnos-trabajo-extra-fase-8` (no era un worktree registrado, solo quedaba el directorio vacío en disco).
- `master` está al día con `origin/master` (push + tag `v1.4.0` ya hechos).
- **Sprint 9 (Feature 4: Portal de Intercambios) completo (2026-08-05)** — 9/9 tareas vía subagent-driven-development en el worktree `.worktrees/feat-turnos-intercambios-fase-9` (rama `feat/turnos-intercambios-fase-9`). Verificación final (Task 9): 548/548 tests pass, 0 errores TypeScript (api + web), build web exitoso. Pendiente: revisión final de rama y `superpowers:finishing-a-development-branch` para decidir merge/PR a `master` + bump de versión (`v1.5.0`, 4/4 features de Fases 6-9 completadas).
- **Si sobra tiempo tras el merge de Sprint 9:** retomar el punto 1 de "Plan de integración post-turnos" (exportes de nómina a la BD real) — es el ítem de mayor valor pendiente fuera del módulo de turnos.

---

## 🎯 Plan de integración post-turnos (después de Fases 6-9)

El módulo de turnos base está **feature-complete** (Fase 5): catálogo, plan, compensatorios, resolución de cruces, integración con asistencia y nómina. Fases 6-9 agregan autoservicio (patterning, cambios, intercambios) y auditoría (trabajo extra). Prioridad sugerida para las próximas fases (después de 2026-07-22):

### 1. Conectar los exportes de nómina a la BD real ⭐ (mayor valor, ~medio día)
Los endpoints `GET /payroll/:periodo/export/plame` y `/export/telecredito` hoy retornan un stub `{mensaje}`. Los servicios `PlanillaExporter` (Estructura 18) y `BankFileExporter` (BCP) ya existen y están testeados — falta el cableado:
- Leer `PLANILLA_DETALLE` del período procesado + `CuentaBancaria` de cada empleado
- Mapear conceptos internos a códigos SUNAT (catálogo `Concepto`)
- Retornar el archivo como descarga (`text/plain`, `Content-Disposition`)
- Actualizar la UI de `/nomina` para descargar el archivo real
- **Criterio de aceptación:** procesar julio 2026 con las novedades ya importadas y descargar un E18 y un telecrédito con los 3 empleados demo

### 2. Mapeo del sistema biométrico chino (bloqueado: falta el archivo)
El usuario va a conseguir el formato real del export del reloj. Cuando llegue:
- Agregar modo de mapeo en `AttendanceImportService` (detectar columnas, formato fecha/hora, separador)
- Idealmente autodetección de formato en el mismo `POST /attendance/import`

### 3. Configurar `ANTHROPIC_API_KEY` real (~15 min, requiere la key del usuario)
El `.env` tiene un placeholder. Sin key real, el parsing de CVs en ATS falla (el resto del flujo funciona). Probar el registro de un candidato con CV real tras configurarla.

### 4. Validaciones previas al procesar planilla (si queda tiempo)
Dashboard del ciclo con advertencias antes de procesar: trabajadores sin cuenta bancaria, sin régimen pensionario, montos atípicos (ya descrito en `goal.md` Módulo 1).

---

## 📋 Backlog priorizado (después de mañana)

### Nómina
- [ ] Estructuras SUNAT adicionales: E04, E05, E11, E14, E15, E26, E30 (T-Registro/PLAME completos)
- [ ] Exportadores bancarios BBVA, Interbank, Scotiabank (arquitectura ya extensible)
- [ ] Provisiones mensuales (CTS, gratificaciones, vacaciones) con asiento contable exportable
- [ ] Ficha de alta de trabajador en el frontend (hoy el alta es por seed/API)
- [ ] Boletas de pago (PDF) por empleado
- [ ] Parametrizar comisión y prima de seguro AFP (hoy hardcodeadas en payroll-run y en el cálculo de cese — deuda heredada)
- [ ] Integrar el pago de la liquidación de cese al archivo de telecrédito
- [ ] Firma digital de los documentos de cese (hoy se generan sin firmar)

### Asistencia
- [ ] Confirmar valores normativos marcados "sin confirmar" en el seed (UIT, RMV, tasas) contra fuente oficial — ver `docs/superpowers/specs/validaciones-normativas-pendientes.md`
- [ ] Mapa interactivo para configurar geofence por sede
- [ ] Expediente de inspección SUNAFIL (export masivo 5 años, PDF/Excel, <30s)
- [~] Vacaciones: récord por período con control de días y alerta de riesgo de indemnización HECHOS (módulo cese, 2026-07-17); falta programación del goce y flujo de aprobación de solicitudes
- [ ] Flujo de aprobación de sobretiempo (jefe valida horas extra antes de nómina)

### Documental
- [ ] Firma digital certificada (Ley 27269) con proveedor acreditado — interfaz abstracta
- [ ] Workflow de firma masiva con monitor de pendientes
- [ ] Portal de autoservicio (ESS): el colaborador descarga sus boletas y certificados
- [ ] Políticas de retención diferenciadas (20 años salud ocupacional)

### ATS
- [ ] Scoring automático de candidatos con Claude (ajuste al perfil, killer questions)
- [ ] Tablero Kanban drag-and-drop del pipeline
- [ ] Portal público de empleo con marca de la empresa
- [ ] Pre-poblar Ficha de Alta al contratar

### Técnico / Deuda

#### Sprint 7 Identificada
- [ ] **P2002 edge case:** Schema constraint `@@unique([tenantId, employeeId, fechaActual])` sin filtro de estado. Re-requests después de RECHAZADA/APROBADA pasarán validación de servicio pero fallarán en DB. Solución: catch Prisma P2002 + translate a ConflictException, o ajustar constraint a `@@unique([..., estado])`. Priority: LOW (edge case raro). Task 3 flagged, puede addressed en Task 6-9 o follow-up.
- [ ] **Notificaciones Task 7:** Métodos `notificarSolicitudAprobada` y `notificarSolicitudRechazada` agregados a NotificationService en Task 3 (nominalmente Task 7 scope). Revisar scope creep; probablemente OK ya que fueron necesarios para Task 3 integration.

#### Sprint 8 Identificada
- [ ] **`obtenerSolicitud` sin filtro tenantId:** El `findUnique` de `SolicitudTrabajoAdicionalService.obtenerSolicitud` (Task 2) no filtra explícitamente por `tenantId` en la query — pre-existente desde Task 2, señalado como Minor en la revisión de Task 4. Se asume cubierto por RLS a nivel de transacción (como el resto del módulo), pero queda pendiente confirmarlo con un test dedicado de aislamiento cross-tenant. Priority: LOW.
- [ ] **Conversión horas→días para compensatorio:** El libro de compensatorios (`CompensatorioService`) es day-based (`dias: number`), pero Sprint 8 habla en horas ("3h extra → 3h compensatoria"). Decisión deliberada: `validarReporte` convierte `horasEstimadas / 8` (jornada estándar, redondeado a 2 decimales) al registrar el movimiento GANADO, reutilizando el ledger existente en vez de construir uno paralelo en horas. No es deuda per se, pero es un puente de unidades a tener presente si se audita el saldo de compensatorios.
- [ ] **`reporteFotos` como base64 data-URLs sin blob storage dedicado:** No existe infraestructura de almacenamiento de blobs en el repo para este feature (el único precedente, `uploadDocument` de legajo, tiene su propio endpoint de storage que no se replicó aquí). El frontend (Task 5) lee cada foto seleccionada con `FileReader.readAsDataURL` y envía el string base64 directo dentro del array `reporteFotos` en el body de `POST .../reporte`. Funciona para volúmenes bajos, pero es un gap arquitectónico real si el volumen/tamaño de fotos crece — candidato a resolver en Sprint 9+ si el reporte fotográfico se vuelve una feature más pesada (mover a upload a MinIO/blob storage + solo persistir URLs).
- [ ] **Notificación al manager vía `Employee.managerId`:** `notificarSolicitudTrabajoCreada` (Task 3/4) es la primera notificación del código que resuelve un manager a través de la auto-relación `Employee.managerId` para notificar al aprobador — no hay precedente de "notificar al manager" en Sprints 6-7 (ahí el manager ya interactúa desde un tablero, no se le notifica proactivamente). No es un bug, pero es un patrón nuevo a tener en cuenta para mantenimiento futuro (ej. si `managerId` es null, la notificación se omite silenciosamente — comportamiento cubierto por tests en `notification.service.spec.ts`).

#### Sprint 9 Identificada
- [ ] **Barrido perezoso en vez de cron real:** la resolución automática por tiempo (48h sin decisión o fecha del turno alcanzada) depende de que alguien llame a un endpoint del módulo (lazy sweep en cada request relevante), no de un job programado. Reemplazar por `@nestjs/schedule` (cron real en el backend) o por un workflow n8n cuando el volumen de intercambios lo justifique. Priority: baja mientras el volumen sea bajo (mismo razonamiento que la deuda de fotos base64 de Sprint 8). Ver diseño §7.
- [ ] **`CompensatorioService.intercambiar()` sin cambios:** se reusa tal cual desde Fase 5 para el swap real de `turnoAsignacion`; ya es neutro para compensatorios y ya está testeado. No es deuda, se deja documentado para que quede explícito que Sprint 9 no lo modificó.

#### Sprint 6+ Existente
- [ ] Tests de frontend (no existe infraestructura; hoy la barra es tsc + next build)
- [ ] UI para cambiar de rol activo cuando un usuario tiene varios (deuda declarada en Fase 0)
- [ ] Job de retención de documentos (hard-delete a 90 días, Ley 29733)
- [ ] Nunca ejecutar `next build` con el dev server corriendo (comparten `.next` y se corrompe — pasó el 2026-07-14)
- [ ] CI/CD (GitHub Actions: tests + build en cada push)

---

## 🔑 Contexto operativo (para retomar la sesión)

- **Levantar todo:** `docker-compose up -d` → API: `pnpm --filter @rrhh/api dev` (:3001) → Web: `pnpm --filter @rrhh/web dev` (:3000)
- **BD:** migraciones al día (7), seed idempotente (`cd packages/database && pnpm run seed`)
- **Usuarios demo:** `admin@demo.pe`/`Admin123!` · `rrhh@demo.pe`/`Rrhh123!` · `empleado@demo.pe`/`Empleado123!`
- **Datos de prueba cargados:** 3 empleados con contrato y régimen pensionario, 1 vacante ATS, marcaciones del 13/07 importadas por CSV (con horas extra calculadas), novedades de julio importadas
- **Documentos clave:** `goal.md` y `goal-frontend.md` (prompts de objetivo), `docs/RESUMEN_SISTEMA.md` (contratos de API), `docs/superpowers/specs/` y `plans/` (diseños y planes por fase)
