# Sprint 9 — Feature 4: Portal de Intercambios Autoservicio (Turnos)

> **Especificación de diseño:** refina y extiende la sección 5 (Feature 4) de `2026-07-18-turnos-mejoras-phase-6-9.md` — resuelve los puntos que ese spec maestro dejaba abiertos (rol del manager, mecanismo de resolución por tiempo, reuso de lógica de swap).
>
> **Versión:** 1.0.0 · **Fecha:** 2026-08-04 · **Estado:** Diseño aprobado, pendiente plan de implementación

---

## 1. Resumen Ejecutivo

Empleado A propone intercambiar su turno con Empleado B en una fecha. Empleado B acepta o rechaza. Si acepta, el Manager aprueba o rechaza. A diferencia del spec maestro original, el Manager **no siempre tiene la última palabra**: si no decide a tiempo, o si la fecha del turno llega antes de que decida, el sistema resuelve automáticamente — porque más allá de cierto punto, esperar al manager deja de tener sentido (el turno ya se trabajó o está a punto de trabajarse).

Este es el cuarto y último feature de autoservicio de Fases 6-9 (después de Patrones, Cambios de Turno y Trabajo Fuera de Turno).

## 2. Actores y Permisos

- **Empleado A:** `shift.read` — propone intercambio
- **Empleado B:** `shift.read` — acepta/rechaza propuesta
- **Manager:** `shift.resolve` — aprueba/rechaza intercambio (con las excepciones de la sección 4)

Sin permisos nuevos: reusa `shift.read`/`shift.resolve` ya existentes en el módulo (ver tabla RBAC en `2026-07-18-turnos-mejoras-phase-6-9.md` §6.1).

## 3. Modelo de Datos

```typescript
IntercambioTurno {
  id: string (UUID)
  tenantId: string
  employeeIdA: string             // propone
  employeeIdB: string             // recibe la propuesta
  fecha: Date                     // fecha del turno a intercambiar
  turnoActualA: TipoDiaPlan        // snapshot al proponer: qué tenía A
  turnoActualB: TipoDiaPlan        // snapshot al proponer: qué tenía B
  mensajeA?: string                // motivo/mensaje de A a B

  estado: 'PENDIENTE_ACEPTACION_B'
        | 'RECHAZADA_POR_B'
        | 'ACEPTADA_POR_B'         // esperando manager, 48h, o que llegue la fecha
        | 'APROBADA_MANAGER'
        | 'RECHAZADA_MANAGER'
        | 'AUTO_APROBADA'          // resuelta por el sistema, no por el manager
        | 'RECHAZADA_AUTOMATICA'   // el sistema cerró el caso sin ejecutar el swap

  motivoRechazo?: string           // motivo dado por B o por el manager al rechazar
  motivoResolucion?: 'PLAZO_48H' | 'FECHA_ALCANZADA' | 'FECHA_ALCANZADA_SIN_RESPUESTA_B' | 'TURNO_MODIFICADO'
                                    // solo presente cuando el sistema resolvió el caso (AUTO_APROBADA / RECHAZADA_AUTOMATICA)

  aceptadoEn?: DateTime            // cuándo B aceptó — ancla del plazo de 48h
  decididoEn?: DateTime            // cuándo se resolvió el caso (cualquier estado terminal)
  decididoPor?: string             // userId del manager, o 'SISTEMA' si fue automático

  turnoAsignacionAId?: string      // ref auditoría, seteado solo si se ejecutó el swap
  turnoAsignacionBId?: string
  creadoEn: DateTime
}
```

Diferencia contra el modelo del spec maestro: se agregan los estados terminales `AUTO_APROBADA` y `RECHAZADA_AUTOMATICA` (en vez de plegar las resoluciones automáticas dentro de `APROBADA_MANAGER`/`RECHAZADA_MANAGER`) y el campo `motivoResolucion`, para que la auditoría distinga con precisión cuándo decidió una persona y cuándo decidió el sistema, y por qué.

## 4. Flujo Principal

### 4.1 Propuesta y respuesta de B

1. **Emp A propone** (`POST /turnos/intercambios/proponer`, `shift.read`):
   - Valida: `employeeIdA ≠ employeeIdB`, ambos empleados activos (no cesados), ambos tienen `turnoAsignacion` esa fecha (no se puede intercambiar un DESCANSO contra nada), `fecha` es futura, no existe ya una propuesta `PENDIENTE_ACEPTACION_B` o `ACEPTADA_POR_B` para el mismo par A→B en la misma fecha.
   - Guarda snapshot `turnoActualA`/`turnoActualB`. Estado → `PENDIENTE_ACEPTACION_B`. Notifica a B.

2. **Emp B decide** (`PUT .../:id/aceptar` o `PUT .../:id/rechazar`, `shift.read`):
   - **Rechaza:** estado → `RECHAZADA_POR_B`, `decididoEn`/`decididoPor` = B. Notifica a A. Caso cerrado.
   - **Acepta:** estado → `ACEPTADA_POR_B`, `aceptadoEn = ahora`. Notifica al manager.

### 4.2 Resolución: manager, o el sistema si el manager no llega a tiempo

Un intercambio en `ACEPTADA_POR_B` se resuelve por **el primero de estos tres caminos que ocurra**:

| # | Disparador | Quién resuelve | Estado resultante | `motivoResolucion` |
|---|------------|-----------------|--------------------|---------------------|
| 1 | Manager llama `aprobar`/`rechazar-manager` antes de los otros dos | Manager | `APROBADA_MANAGER` / `RECHAZADA_MANAGER` | — |
| 2 | Pasaron 48h desde `aceptadoEn` sin decisión del manager | Sistema | `AUTO_APROBADA` | `PLAZO_48H` |
| 3 | `fecha` del turno llegó (`fecha <= hoy`) sin decisión del manager | Sistema | `AUTO_APROBADA` | `FECHA_ALCANZADA` |

El camino 3 tiene prioridad práctica sobre el 2 cuando la fecha del turno es más cercana que el plazo de 48h — no tendría sentido seguir esperando al manager para una fecha que ya llegó. Una vez que `fecha <= hoy`, el manager **ya no puede rechazar** ese intercambio (ver §4.4): en la práctica el intercambio ya debió ejecutarse o no tiene caso revertirlo.

**Caso borde — B nunca respondió:** si `fecha <= hoy` y el estado sigue en `PENDIENTE_ACEPTACION_B` (B no aceptó ni rechazó a tiempo), el sistema cierra el caso como `RECHAZADA_AUTOMATICA` con `motivoResolucion: 'FECHA_ALCANZADA_SIN_RESPUESTA_B'`. Sin esto, la propuesta quedaría vencida indefinidamente en un estado "pendiente" que ya no significa nada.

### 4.3 Barrido perezoso (sin cron)

No existe scheduler en el backend (`apps/api`) hoy — ningún cron job, ningún `@nestjs/schedule`. En vez de agregar esa infraestructura para este feature, la resolución por tiempo (caminos 2, 3, y el caso borde de 4.2) se evalúa **de forma perezosa**: cada endpoint bajo `/turnos/intercambios/*` corre, antes de su propia lógica, un barrido de las `IntercambioTurno` de ese tenant en `PENDIENTE_ACEPTACION_B`/`ACEPTADA_POR_B` que ya cumplen alguno de los criterios de tiempo, y las resuelve en el momento.

Consecuencia aceptada: si nadie llama a ningún endpoint del módulo, un intercambio vencido queda sin resolver hasta que alguien lo haga (ver deuda técnica, §7).

### 4.4 Ejecución del swap (compartida por aprobación manager y auto-aprobación)

1. Relee las asignaciones actuales (`turnoAsignacion`) de A y B para `fecha` y las compara contra `turnoActualA`/`turnoActualB` guardados al proponer.
2. **Coinciden:** ejecuta `CompensatorioService.intercambiar(tx, { tenantId, fecha, employeeIdA, employeeIdB, creadoPor })` — reuso directo de la lógica de swap ya existente desde Fase 5 (neutral para compensatorios, no crea movimientos GANADO/GOZADO). Guarda `turnoAsignacionAId`/`turnoAsignacionBId` con los IDs actualizados. Estado → `APROBADA_MANAGER` o `AUTO_APROBADA` según quién resolvió. Notifica a ambos.
3. **No coinciden** (el turno de A o B cambió desde la propuesta — ej. el manager reasignó el plan): no ejecuta el swap. Estado → `RECHAZADA_AUTOMATICA`, `motivoResolucion: 'TURNO_MODIFICADO'`. Notifica a ambos explicando el motivo.

**Guard en los endpoints del manager:** `aprobar` y `rechazar-manager` corren el barrido (§4.3) antes de aplicar la decisión del manager. Si el barrido ya resolvió ese intercambio en el mismo request (porque `fecha <= hoy` o pasaron las 48h), el endpoint responde con un error explícito ("este intercambio ya se auto-aprobó el {fecha} por {motivo}") en vez de permitir que el manager decida sobre un caso que el sistema ya cerró.

## 5. Endpoints API

```
POST   /turnos/intercambios/proponer              [shift.read]
       Input: { employeeIdB: string, fecha: Date, mensajeA?: string }
       Output: IntercambioTurno

GET    /turnos/intercambios/mis-propuestas        [shift.read]
       Output: IntercambioTurno[]  (donde employeeIdA = yo)

GET    /turnos/intercambios/propuestas-para-mi    [shift.read]
       Output: IntercambioTurno[]  (donde employeeIdB = yo)

PUT    /turnos/intercambios/:id/aceptar           [shift.read]
       Output: { success, estado: 'ACEPTADA_POR_B' }

PUT    /turnos/intercambios/:id/rechazar          [shift.read]
       Input: { motivoRechazo?: string }
       Output: { success }

GET    /turnos/intercambios/pendientes            [shift.resolve]
       Board Manager — ACEPTADA_POR_B (aún resolubles por el manager)
       Output: IntercambioTurno[]

PUT    /turnos/intercambios/:id/aprobar           [shift.resolve]
       Output: { success, intercambioRealizado: boolean }

PUT    /turnos/intercambios/:id/rechazar-manager  [shift.resolve]
       Input: { motivoRechazo?: string }
       Output: { success }
```

Todos los endpoints corren el barrido perezoso (§4.3) del tenant antes de su lógica propia.

## 6. Notificaciones

- **Propuesta creada:** email a B — "{A} propone intercambiar su [turnoActualA] por tu [turnoActualB] el [fecha]. Mensaje: [mensajeA opt]"
- **Rechazada por B:** email a A — "{B} rechazó tu propuesta de intercambio. Motivo: [motivo opt]"
- **Aceptada por B:** email al manager — "Intercambio aceptado entre {A} y {B} para [fecha]. Pendiente de aprobación"
- **Aprobada (manager o automática):** email a ambos — "Intercambio aprobado. Tus turnos han sido intercambiados" (si fue automática, se aclara el motivo: "se aprobó automáticamente porque [pasaron 48h sin respuesta del manager | llegó la fecha del turno]")
- **Rechazada (manager o automática):** email a ambos — "Intercambio rechazado" + motivo (manager: el que ingresó; automática: `TURNO_MODIFICADO` o `FECHA_ALCANZADA_SIN_RESPUESTA_B`, en lenguaje llano)

## 7. Deuda técnica identificada (para `docs/PENDIENTES.md`)

- **Barrido perezoso en vez de cron real:** la resolución por tiempo (§4.2, §4.3) depende de que alguien llame a un endpoint del módulo. Reemplazar por `@nestjs/schedule` (cron real en el backend) o por un workflow n8n cuando el volumen de intercambios lo justifique. Prioridad: baja mientras el volumen sea bajo (igual razonamiento que la deuda de fotos base64 de Sprint 8).
- **`CompensatorioService.intercambiar()` sin cambios:** se reusa tal cual desde Fase 5; ya es neutro para compensatorios y ya está testeado. No es deuda, se documenta para que quede explícito que Sprint 9 no lo modifica.

## 8. Integración con Módulos Existentes

- **CompensatorioService (Fase 5):** `intercambiar()` ejecuta el swap real de `turnoAsignacion` — reusado sin modificar.
- **NotificationService:** 5 métodos nuevos (propuesta creada, rechazada por B, aceptada por B, aprobada [manual/automática], rechazada [manual/automática]) — mismo patrón que Sprints 6-8.
- **AuditService:** registra `decididoPor`/`decididoEn`/`motivoResolucion` en cada transición de estado.
- **RBAC:** reusa `shift.read` y `shift.resolve`, sin permisos nuevos.
