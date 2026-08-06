# Pendientes y Plan de Trabajo

**Actualizado:** 2026-08-06 (Sprint 9 cerrado 100%, v1.5.0 — release + cleanup de rama/worktree) · **Estado del sistema:** todo verde en `master` (548 tests, 0 errores TypeScript en api + web) — Sprint 6 ✅ (Feature 1 Patrones) + Sprint 7 ✅ (Feature 2 Cambios) + Sprint 8 ✅ (Feature 3 Trabajo Fuera de Turno) + Sprint 9 ✅ (Feature 4 Intercambios) — 4/4 features de Fases 6-9 completadas. **Próximo paso planeado:** coordinador autónomo de backlog, ver `docs/superpowers/plans/2026-08-05-autonomous-backlog-coordinator-plan.md`.

---

## 🎯 Turnos (Fases 6-9) — Autoservicio + Gestión Avanzada

**Especificación:** `docs/superpowers/specs/2026-07-18-turnos-mejoras-phase-6-9.md`
**Plan de implementación:** `docs/superpowers/plans/2026-07-18-turnos-mejoras-phase-6-9.md`

4 features independientes con tabs separados en `/turnos`:

1. **✅ Sprint 6 - Patrones de Rotación (COMPLETO):** Manager define patrón recurrente (ej: 2 DIA + 2 NOCHE + 3 DESC) e inyecta masivamente al plan. 9/9 tareas completadas (2026-07-30). Feature: catálogo de patrones + aplicador con preview editable + notificaciones + E2E testing. Tests: 328/328 pass. PR merged.
2. **✅ Sprint 7 - Cambios de Turno (COMPLETO):** Empleado solicita cambio → Manager aprueba/rechaza → reintentos permitidos. 9/9 tareas completadas (2026-07-30). Modelo + CRUD + lógica transaccional + 5 endpoints API + tab "Mis Cambios" (empleado) + tablero Kanban (manager) + notificaciones + E2E testing. Tests: 391/391 pass. v1.3.0.
3. **✅ Sprint 8 - Trabajo Fuera de Turno (COMPLETO):** Empleado reporta trabajo extra (tarea + fotos + timestamp) → Manager valida → genera compensatorio automáticamente. Datos privados (Manager-only: causaHorasExtras, horasAcumuladas, saldoCompensatorios). 9/9 tareas completadas (2026-07-30 a 2026-08-01). Modelo `SolicitudTrabajoAdicional` + RLS + migration, CRUD + report service, orquestación (aprobar/reasignar/rechazar solicitud + validar/rechazar reporte, incl. creación automática de movimiento GANADO en el libro de compensatorios), 11 endpoints con RBAC, tab empleado (Solicitar + Mis Trabajos), tab manager (Pendientes + Validar), 7 métodos de notificación, E2E integration test (70 assertions). Tests: 498/498 pass (0 fallas, 0 errores TypeScript). Commits: `02c647c..a9f47a3` (11, uno de ellos fix-round de nombres de índice). Branch: `feat/turnos-trabajo-extra-fase-8`.
4. **✅ Sprint 9 - Portal de Intercambios (COMPLETO, mergeado a `master` 2026-08-06):** Empleado A propone intercambiar turno con Empleado B → B acepta/rechaza → Manager aprueba/rechaza, salvo que pasen 48h sin decisión o llegue la fecha del turno (el sistema resuelve automáticamente en esos casos vía barrido perezoso). 9/9 tareas completadas (2026-08-05). Diseño: `docs/superpowers/specs/2026-08-04-turnos-intercambios-fase-9-design.md`. Plan: `docs/superpowers/plans/2026-08-04-turnos-intercambios-fase-9.md`. Modelo `IntercambioTurno` + RLS + migration, `IntercambioTurnoService` (proponer/aceptar/rechazarPorB) + `IntercambioTurnoAplicadorService` (orquestación: aprobar/rechazar manual + resolución automática por barrido perezoso en 48h/fecha alcanzada, reusa `CompensatorioService.intercambiar()` de Fase 5 sin modificarlo), 8 endpoints con RBAC (`shift.read`/`shift.resolve`, sin permisos nuevos), 5 métodos de notificación, tab empleado "Intercambios" + tab manager "Intercambios (Manager)", E2E integration test (`feature-4.integration.spec.ts`). Ejecutado vía subagent-driven-development en worktree `.worktrees/feat-turnos-intercambios-fase-9` (rama `feat/turnos-intercambios-fase-9`). Tras el merge original (9/9 tareas) una prueba manual E2E contra Postgres real destapó dos bugs RLS en vivo (no cubiertos por el suite de fakes en memoria) que motivaron un fix wave adicional de 2 commits + una revisión final de rama con un round de fixes propio — ver sección "Sprint 9 fix wave adicional" en Deuda Técnica. PR #2 mergeado a `master` (merge commit `adaa82b`) vía `superpowers:finishing-a-development-branch`. Tests: 548/548 pass, 0 errores TypeScript (api + web), build web exitoso.

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
- **Sprint 9 (Feature 4: Portal de Intercambios) 100% cerrado (2026-08-06):** PR #2 (`feat/turnos-intercambios-fase-9` → `master`, merge commit `adaa82b`) mergeado, tras un fix wave adicional de 2 commits (`601f4b0`, `e2413d5`) surgido de una prueba manual E2E contra Postgres real y una revisión final de rama independiente — ver "Sprint 9 fix wave adicional" en Deuda Técnica más abajo. Bump de versión a `v1.5.0`, tag pusheado (4/4 features de Fases 6-9 completadas). Rama remota `feat/turnos-intercambios-fase-9` borrada; worktree local desregistrado de git (puede quedar la carpeta huérfana en disco en `.worktrees/feat-turnos-intercambios-fase-9`, no es un worktree válido, se borra a mano cuando se pueda: `rm -rf`).
- `master` está al día con `origin/master` (push + tag `v1.5.0` ya hechos).
- **Próximo paso planeado — coordinador autónomo de backlog:** ver `docs/superpowers/plans/2026-08-05-autonomous-backlog-coordinator-plan.md` (plan confirmado con el usuario, incluye 7 supuestos ya validados y la restricción dura de nunca borrar campos/tablas ni alterar procesos de negocio aprobados sin dejarlo registrado para aprobación humana) y `docs/superpowers/plans/autonomous-coordinator-status.md` (estado — Fase 0 completa, Fase 1+ aún no lanzada). Recorre este mismo backlog priorizado de abajo hacia arriba, ítem por ítem, vía `subagent-driven-development`, empezando por el punto 1 de "Plan de integración post-turnos" (exportes de nómina a la BD real) — es el ítem de mayor valor pendiente fuera del módulo de turnos.

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
- [ ] **Staleness check del swap solo compara `tipoDia`, no `turnoId` (hallazgo #5 revisión final):** `IntercambioTurno.turnoActualA/B` solo guarda el snapshot de `TipoDiaPlan` (ej. `'TURNO'`) al momento de proponer, no el `turnoId` específico. Si B es reasignado a OTRO turno que igual sea `tipoDia === 'TURNO'`, el chequeo de `ejecutarSwap` en `intercambio-turno-aplicador.service.ts` no lo detecta y A termina swapeado a un turno que nunca aceptó. Arreglo correcto: agregar columnas `turnoIdActualA`/`turnoIdActualB` al modelo `IntercambioTurno` (nueva migración) y comparar por id en vez de por tipo. Fuera de alcance del fix wave del 2026-08-05 (requiere su propia migración/revisión). Priority: media — afecta la integridad del swap, pero requiere que B sea reasignado *entre* la propuesta y la resolución, ventana relativamente angosta.
- [ ] **Guard de propuesta duplicada solo direccional y sin respaldo en BD (hallazgo #7 revisión final):** `IntercambioTurnoService.proponer()` (`intercambio-turno.service.ts`) solo bloquea una segunda propuesta A→B para el mismo par+fecha; una propuesta B→A para el mismo par+fecha puede coexistir con una A→B ya pendiente, y no hay índice único (ni parcial) que respalde el chequeo — también es racy bajo requests concurrentes. Arreglo correcto: columna `pair_key` normalizada (`least(employee_id_a, employee_id_b) || '|' || greatest(...)`)  + índice único parcial sobre estados no terminales. Requiere su propia migración y revisión de índices/triggers — fuera de alcance del fix wave del 2026-08-05. Priority: baja-media — el peor caso es una fila "sobrante" fácil de limpiar manualmente, no corrupción de datos de turno.

#### Sprint 9 fix wave adicional (2026-08-06, tras prueba manual E2E)
Prueba manual end-to-end (proponer→aceptar→aprobar contra Postgres real, no los fakes en memoria del suite) descubrió y corrigió en vivo: cast `::uuid` faltante en `EmployeesService.findByUserId`, y 7 métodos del módulo `shifts` que accedían a `tx.employee` directo en vez de pasar por las vistas por rol (revienta con "permission denied" bajo `app_manager`/`app_employee`). Commit `601f4b0`. Revisión final de rama (agente en modelo Opus) encontró y ya se corrigieron dos hallazgos adicionales: (1) las 4 queries SQL crudas de `EmployeesService` contra las vistas por rol devolvían columnas snake_case sin alias salvo `userId` (`numeroDocumento` etc. llegaban `undefined` a consumidores bajo `app_manager`/`app_employee`) — arreglado con un mapa `SELECT_COLUMNS` por vista; (2) en `IntercambioTurnoAplicadorService.ejecutarSwap`, el claim-check optimista corría *después* de ejecutar el swap real de `turnoAsignacion`, por lo que el perdedor de una carrera concurrente podía revertir el swap del ganador antes de descubrir que perdió — reordenado para que el claim vaya primero. Ambos re-verificados: 548/548 tests, tsc limpio, re-review independiente confirmó ambos fixes correctos sin regresiones nuevas.

Hallazgos de esa misma revisión final que quedan **deliberadamente fuera de este fix wave** (ninguno es una regresión introducida por Sprint 9; ninguno tiene ruta de explotación desde un endpoint expuesto hoy):
- [ ] **Aislamiento de errores por registro en `barrido()` no es real:** todo el request corre en una única transacción interactiva (`TenantContextInterceptor`); si una query dentro del `try/catch` por-registro de `barrido`/`ejecutarSwap` falla con un error de Postgres (p.ej. permission denied), la transacción completa queda abortada (`25P02`) y todo statement posterior falla con un error confuso, no con el error real. Arreglo correcto requiere SAVEPOINTs por registro o transacciones separadas — cambio de arquitectura, no cabe en un fix puntual. Priority: media.
- [ ] **`GRANT UPDATE ON "turno_asignacion" TO app_manager, app_employee` es a nivel de tabla completa del tenant, sin policy de row-ownership** (migración `66dd917`). Ningún endpoint hoy expone un UPDATE directo a esas tablas para esos roles (`PUT /turnos/plan` es `shift.manage`-only), pero el GRANT en sí es más ancho de lo necesario — la defensa real es solo la capa de aplicación. Considerar una función `SECURITY DEFINER` en vez del GRANT amplio. Priority: baja mientras no haya endpoint que lo explote.
- [ ] **`EmployeesService` no tiene tests propios**, y todos los specs de `shifts` mockean `EmployeesService` completo (delegando a `tx.employee.findUnique` fake) — la rama de SQL crudo contra las vistas por rol, que es exactamente donde vivían los dos bugs originales, tiene cobertura cero en el suite automatizado. Agregar specs dedicados con un tx fake que exponga `$queryRawUnsafe`. Priority: media-alta (es la causa raíz de por qué estos bugs solo aparecieron en prueba manual).
- [ ] **Gap de permisos `Employee` sin `shift.read` en el seed (`packages/database/seed.ts`):** ya documentado como hallazgo separado (no de Sprint 9) — el rol `Employee` en `SYSTEM_ROLES` no incluye `shift.read`, así que un empleado recién sembrado no puede llegar a ningún endpoint del portal de autoservicio sin que alguien le otorgue el permiso manualmente. La BD de desarrollo actual ya lo tiene otorgado a mano (de sesiones de debugging previas), lo cual enmascaró el gap durante la prueba manual E2E. Priority: alta si se va a onboardear un tenant real con el seed tal cual está.

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
