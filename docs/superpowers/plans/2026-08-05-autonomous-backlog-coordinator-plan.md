# Plan: Coordinador autónomo de backlog (post-Sprint 9)

**Estado:** propuesta, pendiente de confirmación final antes de lanzar.
**Fecha:** 2026-08-05

## 1. Objetivo

Un único agente coordinador, de larga duración y en background, que:

1. Termina el trabajo pendiente de Sprint 9 (fix RLS/employee-lookup + bug activo `asigA/asigB` + merge).
2. Continúa, sin intervención humana bloqueante, con **todo** el backlog priorizado de `docs/PENDIENTES.md` (Nómina, Asistencia, Documental, ATS, y el plan de integración post-turnos), fase por fase.
3. Aplica el proceso `subagent-driven-development` en cada fase, escalando a otras skills (`brainstorming`, `systematic-debugging`, `finishing-a-development-branch`) cuando corresponda.
4. Reporta avance por notificación push cada ~1h, además de un archivo de estado persistente.
5. Define y ejecuta un protocolo de pruebas por fase; no avanza a la siguiente fase hasta que ese protocolo pasa en verde.
6. Define puntos de aprobación por fase (documentados, no bloqueantes — el agente sigue solo).
7. Cuando una página/tab no tiene mockup definido, genera un mockup ASCII ("tipo DOS") en un `.md` antes de implementar, o pregunta lo mínimo necesario para poder generarlo.

## 2. Decisiones ya confirmadas (con el usuario, 2026-08-05)

| Punto | Decisión |
|---|---|
| Alcance | Sprint 9 (fix + merge) **+** backlog completo de `PENDIENTES.md`, en el orden en que aparece el documento |
| Mecanismo de ejecución | Un `Agent` en background, con acceso a herramientas completo (puede spawnear sus propios subagentes) |
| Puntos de aprobación por fase | No bloqueantes — se documentan en el reporte, el agente continúa solo |
| Mockups de UI faltantes | Mockup ASCII ("tipo DOS") en un archivo `.md`, no HTML/Artifact visual |
| Flujo de git por ítem | Directo a `master`, sin worktree ni PR (como Sprints 6-8) |
| Reporte de avance | Notificación push cada ~1h **+** archivo de estado escrito |
| Cambios destructivos o a procesos aprobados | **Excepción bloqueante:** nunca borra campos/tablas ni altera procesos de negocio ya aprobados/en producción sin aprobación humana explícita (ver §7) |

## 3. Puntos que quedan como supuestos — confirmar antes de lanzar

Estos no se preguntaron explícitamente o quedaron ambiguos tras las rondas de clarificación. Los dejo aquí con la decisión que tomaría por defecto si no hay objeción, para que sea fácil vetar cualquiera puntualmente:

1. **Sprint 9 es la única excepción al "directo a master".** Ya tiene worktree + rama + PR #2 abierto (`github.com/edwinabb/rrhh/pull/2`). Por defecto: el coordinador termina el trabajo *ahí* (mismo worktree, mismo PR) y lo mergea vía ese PR — no lo reinicia directo a master. Desde el segundo ítem del backlog en adelante, todo es directo a master.
2. **Orden del backlog:** sigo el orden literal de `PENDIENTES.md` → primero los 4 ítems de "Plan de integración post-turnos" (exportes de nómina real es el ⭐ de mayor valor), después el "Backlog priorizado" en el orden de sus secciones (Nómina → Asistencia → Documental → ATS → lo que siga en el archivo). Si preferís otro orden de prioridad, decímelo ahora.
3. **Ítems bloqueados por insumos externos** (ej. "mapeo biométrico chino" bloqueado sin el archivo real; "ANTHROPIC_API_KEY real" requiere que se la proveas) — el coordinador los **salta** (los deja documentados como "esperando insumo") y sigue con el siguiente ítem no bloqueado. Los retoma automáticamente si en algún momento detecta que el insumo ya está disponible (ej. el archivo apareció, la env var ya no es el placeholder).
4. **Protocolo de pruebas por fase** — por defecto: suite completa (`pnpm --filter @rrhh/api test`), `tsc --noEmit` en ambos workspaces, build de `@rrhh/web`, y **cuando la fase toca permisos/RLS/roles de Postgres**, una verificación adicional contra Postgres real (no solo mocks) — esto porque hoy mismo un bug de permisos real pasó 548/548 tests con mocks y solo lo agarró la prueba manual contra la base real. Cada fase define su propio protocolo específico (qué probar manualmente si aplica) dentro de ese piso mínimo.
5. **Cadencia de la notificación push:** no hay un timer real disponible para un `Agent` en background (`CronCreate`/`ScheduleWakeup` viven en *esta* sesión, no en el agente delegado). El agente aproxima la hora comparando timestamps entre tareas — es "cada ~1h" de mejor esfuerzo, no un cronómetro exacto. Si preferís una cadencia garantizada, la alternativa es que YO (esta sesión) mantenga un `CronCreate` cada hora que lea el archivo de estado del coordinador y te mande el resumen — pero eso requiere que esta sesión seguirse viva/idle; si cerrás esta conversación, esos cron jobs desaparecen. Por defecto uso el enfoque "mejor esfuerzo desde el agente", que sobrevive aunque yo no esté.
6. **Duración/limite de sesión:** un subagente ya golpeó el límite de sesión hoy mismo a mitad de tarea. El coordinador debe ser resiliente a esto (ver §6). Por defecto, si el coordinador mismo se corta por límite de sesión, quedará resumible: vos podés reengancharlo con un mensaje simple ("segui") y retomará desde el ledger, sin perder contexto de qué fase estaba haciendo.
7. **Alcance del "backlog completo"**: `PENDIENTES.md` tiene ítems marcados `[~]` (parcial) y `[ ]` (no iniciado) mezclados con contexto narrativo, no es una lista 100% mecánica. Para ítems sin un plan/spec ya escrito (la mayoría del backlog, a diferencia de Turnos que sí tenía specs+plans dedicados), el coordinador **primero corre `brainstorming`** para producir spec+plan antes de ejecutar `subagent-driven-development` — igual que se hizo para Sprint 9.

## 4. Arquitectura de ejecución

```
Usuario
  │
  │ (confirma este plan)
  ▼
Sesión actual (yo) ──dispatch──► Coordinador (Agent, background,
  │                                subagent_type: general-purpose o claude,
  │                                isolation: ninguna — corre en el
  │                                checkout principal C:\Proyectos\RRHH,
  │                                NO en este worktree)
  │
  │  (esta sesión queda libre; me notifican cuando el
  │   coordinador termine TODO el backlog o se bloquee
  │   en algo que de verdad requiere intervención humana
  │   — ej. credenciales, decisión de producto ambigua)
  ▼
Coordinador, por cada fase del backlog:
  1. ¿Existe spec+plan ya escrito? No → superpowers:brainstorming
  2. ¿La página/tab necesita UI y no hay mockup? →
     genera mockup-<fase>.md (ASCII/DOS) y lo deja para revisión
     asincrónica (no bloquea, pero lo señala en el reporte)
  3. Define protocolo de pruebas de la fase (mínimo del §3.4
     + específico de la fase)
  4. superpowers:subagent-driven-development:
     - worktree/ledger dedicado por fase
     - implementer subagent por tarea
     - task review (spec + calidad) por tarea
     - fix loop (máx 5 rondas, escalando modelo en 4-5)
     - review final de rama/feature completa
  5. Si se traba de forma no resoluble por el fix loop →
     superpowers:systematic-debugging
  6. Protocolo de pruebas en verde → commit directo a master
     (o merge del PR si es Sprint 9) → actualiza PENDIENTES.md
     → actualiza archivo de estado → push notification
  7. Registra el "punto de aprobación" de la fase en el reporte
     (qué se decidió, qué se dio por sentado) y sigue con la
     siguiente fase sin esperar respuesta
  8. Ítem bloqueado por insumo externo → lo salta, lo deja
     anotado, sigue
```

### Archivo de estado

`docs/superpowers/plans/autonomous-coordinator-status.md` (o similar), actualizado continuamente:
- Fase actual, hora de inicio
- Fases completadas (con commit range y resultado de pruebas)
- Fases saltadas por bloqueo externo (y qué insumo falta)
- Hallazgos relevantes (ej. bugs preexistentes descubiertos, como el de RLS de hoy)
- Próxima fase planeada

### Reportes

Cada ~1h de trabajo activo: `PushNotification` con un resumen de una línea (fase actual + estado), y el detalle completo queda en el archivo de estado.

## 5. Fase 0 — cerrar Sprint 9 (primer trabajo del coordinador)

Antes de tocar el backlog, el coordinador retoma exactamente donde quedó esta sesión:

1. Diagnosticar y resolver el bug activo: `asigA`/`asigB` (`turnoAsignacion.findUnique`) devuelven `null` en runtime real (vía HTTP + sesión real) para una fecha/empleados confirmados en la base — pese a que una réplica manual de la misma query, con el mismo rol Postgres (`app_employee`) y el mismo `tenant_id`, sí encuentra el registro. Éste es exactamente el tipo de caso para `superpowers:systematic-debugging` (hipótesis descartadas hasta ahora: mismatch de tenantId, de fechas, de RLS policy — ninguna reproduce el fallo en aislamiento).
2. Terminar la auditoría RLS de "todo lo demás" que quedó fuera de alcance hoy por prioridad (los métodos `shift.manage`-only que se dejaron sin tocar a propósito — confirmar si conviene igual homogeneizarlos ahora que ya existe el patrón `EmployeesService.findById/findByIds`).
3. Suite completa + tsc + build, ambos workspaces.
4. Re-generar el review package del fix wave completo y correr un re-review con el mismo criterio que ya se usó hoy (verificación independiente, no solo re-afirmar el reporte del implementador).
5. Cerrar el PR #2 (merge) y actualizar `docs/PENDIENTES.md` a v1.5.0.
6. Recién ahí arranca el backlog general (§3.2 para el orden).

## 6. Resiliencia a límites de sesión

Todo el estado vive en archivos (ledger de `subagent-driven-development`, archivo de estado del coordinador, `PENDIENTES.md`), nunca solo en el contexto de una conversación. Si el coordinador (o alguno de sus subagentes) se corta por límite de sesión:
- El ledger de la fase en curso indica exactamente qué tarea quedó a medio hacer.
- Reenganchar es tan simple como mandarle al agente coordinador un mensaje de continuación — retoma leyendo el ledger, no repite trabajo ya commiteado.

## 7. Qué NO hace este coordinador (límites explícitos)

- No mergea ni pushea nada sin que las pruebas de esa fase pasen en verde.
- No inventa credenciales ni archivos que le falten (los ítems bloqueados por insumo externo se saltan, no se simulan).
- No toma decisiones de producto genuinamente ambiguas en silencio — las deja registradas como supuesto explícito en el reporte de esa fase, para que las corrijas cuando quieras, pero sin detenerse a esperar.
- No fuerza push ni reescribe historia de `master`.
- **No borra campos ni tablas de la base de datos, y no modifica procesos de negocio ya aprobados/en producción**, aunque una tarea pareciera requerirlo. Esta es la única excepción real al modelo "no bloqueante" del §2: si una fase del backlog necesitara alguna de estas dos cosas para completarse (ej. una migración que hace `DROP COLUMN`/`DROP TABLE`, o un cambio de comportamiento en un flujo que ya está mergeado y en uso — nómina procesada, liquidaciones ya pagadas, asistencia ya cerrada, etc.), el coordinador:
  1. **No la ejecuta.**
  2. Deja esa fase marcada como `BLOQUEADA — requiere aprobación humana` en el archivo de estado, con el motivo exacto y el diff/migración propuesta.
  3. Manda una `PushNotification` fuera del ciclo horario normal (inmediata, no espera al próximo reporte) señalando específicamente este caso.
  4. Sigue con la siguiente fase del backlog que no dependa de la bloqueada — no se detiene por completo, solo esa fase puntual queda en pausa hasta que la apruebes explícitamente.
  - Nota: esto es distinto de un `ALTER` aditivo (agregar columna/tabla/índice nuevo, agregar un `GRANT`) — esos sí los aplica solo, como ya hizo hoy con la migración de grants de Sprint 9. La restricción es específicamente sobre **borrar** estructura o **romper/alterar** comportamiento de negocio ya aprobado.

---

## Confirmación pendiente

Antes de lanzar el coordinador necesito que confirmes (o corrijas) los 7 supuestos del §3. Si no decís nada puntual, arranco con los valores por defecto ahí descritos.
