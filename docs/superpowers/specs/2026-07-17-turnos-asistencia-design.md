# Control de Asistencia por Turnos — Diseño

**Fecha:** 2026-07-17 · **Estado:** aprobado en brainstorming · **Enfoque:** A (plan de turnos integrado al resumen diario)

## 1. Contexto y problema

Hoy el sistema calcula la asistencia contra **un único horario por empresa** (`ConfiguracionAsistencia`: entrada/salida estándar + tolerancia) y por **día calendario**. Eso funciona para el personal administrativo (L-V 08:30–18:00) pero no para el grupo que trabaja por turnos:

- Turnos de 12 horas: **DIA 08:00–20:00** y **NOCHE 20:00–08:00** (cruza medianoche).
- Trabajan 3–4 días por semana (36–48 h); el 4.º día en una semana genera un **descanso compensatorio**.
- Con el modelo actual, el turno NOCHE produce datos falsos: la entrada de las 20:00 marca "tardanza" gigante, y la salida de las 08:00 del día siguiente parte las horas en dos días inconsistentes.

Reglas comunes a todo el personal (regular y turnos):

- **Gracia de 29:59 min**: llegar hasta 29:59 después de la hora de inicio no es tardanza formal. Llegar a los 30:00 o más **sí** es tardanza, y los minutos se cuentan desde la hora oficial de inicio.
- **Compensación el mismo día, minuto a minuto**: todo retraso (aunque esté dentro de la gracia) se compensa saliendo más tarde. Ej.: inicio 08:30, llega 08:50 → debe salir 18:20.
- Consecuencias: **reporte para decisión de RRHH** (no descuento automático). RRHH exporta lo que decida descontar como novedades al CSV de nómina existente.

## 2. Objetivos

1. Cargar el plan de turnos (CSV masivo + edición puntual web) y compararlo contra las marcaciones del reloj.
2. Validar por empleado y día: puntualidad (con gracia), compensación del retraso, horas trabajadas vs. horas del turno, faltas y días trabajados sin plan.
3. Manejar correctamente turnos que cruzan medianoche (fecha de turno ≠ fecha calendario).
4. Llevar el **saldo de días compensatorios** por empleado (ganados / gozados / saldo inicial) y resolver los días trabajados sin plan (intercambios, días adicionales, cruce de falta contra saldo).
5. Retrocompatibilidad total: empleados sin asignaciones siguen con el horario estándar del tenant.

**Fuera de alcance:** generación automática de rotas (patrones "4×3"), descuento automático en nómina, app móvil, aprobación de solicitudes de cambio de turno por el propio empleado.

## 3. Modelo de datos

Toda tabla nueva sigue el patrón del proyecto: RLS (`ENABLE`+`FORCE`+política `tenant_isolation`), GRANTs por rol de Postgres y trigger `audit_trigger()`.

### 3.1 `Turno` (catálogo)

| Campo | Tipo | Notas |
|---|---|---|
| codigo | varchar(20) | único por tenant, ej. `DIA`, `NOCHE` |
| nombre | varchar(80) | "Turno día 08:00–20:00" |
| horaInicio / horaFin | varchar(5) HH:mm | si `horaFin <= horaInicio` ⇒ **cruza medianoche** |
| horasEsperadas | decimal(4,2) | 12.00 para los turnos actuales |
| toleranciaMinutos | int, default 30 | gracia = tolerancia − 1 seg (29:59); a los 30:00 ya es tarde |
| activo | boolean | los inactivos no se pueden asignar, pero conservan historia |

GRANTs: SELECT/INSERT/UPDATE para `app_rrhh`/`app_admin`; SELECT para `app_manager`/`app_employee`. Sin DELETE (se desactiva).

### 3.2 `TurnoAsignacion` (el plan)

| Campo | Tipo | Notas |
|---|---|---|
| employeeId + fecha | — | **única** por tenant+empleado+fecha |
| tipoDia | enum `TipoDiaPlan` | `TURNO` \| `DESCANSO` \| `DESCANSO_COMPENSATORIO` |
| turnoId | uuid nullable | obligatorio si `tipoDia = TURNO`, null en los demás |
| notas | text | ej. "intercambio con J. Pérez" |

GRANTs: SELECT/INSERT/UPDATE `app_rrhh`/`app_admin`; SELECT `app_manager` (equipo) y `app_employee` (el suyo, vía service). Sin DELETE (un día se corrige cambiando su tipo, auditado).

### 3.3 `CompensatorioMovimiento` (libro mayor de compensatorios)

| Campo | Tipo | Notas |
|---|---|---|
| employeeId | uuid | |
| tipo | enum | `GANADO` (+1) \| `GOZADO` (−1) \| `AJUSTE_INICIAL` (±n) |
| dias | decimal(4,2) | positivo o negativo según tipo; normalmente ±1 |
| fechaReferencia | date | GANADO: fecha trabajada sin plan · GOZADO: fecha del plan en que lo disfruta |
| turnoAsignacionId | uuid nullable | vínculo al día del plan (GOZADO) |
| motivo | text | obligatorio en `AJUSTE_INICIAL` |
| creadoPor | uuid | |

**Saldo actual = suma de `dias`.** Append-only por diseño (una corrección es un movimiento inverso, nunca un UPDATE del histórico). GRANTs: SELECT/INSERT `app_rrhh`/`app_admin`; SELECT `app_manager`/`app_employee`.

### 3.4 `Contrato.personalDeConfianza` (campo nuevo, configurable)

`Contrato.personalDeConfianza Boolean @default(false)`: marca al personal cuyo contrato indica que la empresa puede solicitarlo en cualquier horario según el trabajo (personal de dirección/confianza, D.S. 007-2002-TR — no sujeto a jornada máxima). Ver efectos en §4.6.

### 3.5 `AsistenciaResumen` (campos nuevos)

| Campo | Tipo | Notas |
|---|---|---|
| turnoId | uuid nullable | turno contra el que se calculó el día; null = horario estándar |
| minutosRetraso | int default 0 | retraso real desde la hora de inicio (aunque esté en gracia) |
| salidaEsperada | timestamp nullable | fin de turno + minutosRetraso |
| deficitMinutos | int default 0 | max(salidaEsperada − salidaReal, horasEsperadas − horasTrabajadas en minutos, 0) |
| sinPlan | boolean default false | trabajó sin turno asignado (pendiente de resolución RRHH) |

`tardanzaMinutos` (existente) conserva su semántica: solo la tardanza **formal** (≥ tolerancia).

## 4. Reglas de cálculo

### 4.1 Ventana de captura (turnos que cruzan medianoche)

Para un empleado con `TurnoAsignacion(tipoDia=TURNO)` en la fecha D, la ventana de captura es **[inicio del turno − 2 h, fin del turno + 4 h]** (el fin puede caer en D+1). Toda marcación dentro de la ventana se atribuye a la **fecha de turno D**. Si dos ventanas se solaparan, la marcación se asigna a la de inicio de turno más cercano. El resumen del día D del turno NOCHE incluye la salida de las ~08:00 de D+1; no se generan días inconsistentes fantasma.

Los márgenes (−2 h / +4 h) son parámetros de `ConfiguracionAsistencia`, no constantes.

### 4.2 Calculador puro `turno-cumplimiento.calculator`

Entradas: turno (inicio, fin, horasEsperadas, toleranciaMinutos), marcaciones de la ventana, justificación aprobada opcional. Salidas y reglas:

| Concepto | Regla |
|---|---|
| `minutosRetraso` | max(0, entrada real − inicio de turno), en minutos enteros (ceil) |
| `tardanzaMinutos` | si `minutosRetraso >= toleranciaMinutos` ⇒ `minutosRetraso`; si no, 0. **Nota:** el calculador actual usa `>` estricto; se cambia a `>=` (llegar a los 30:00 exactos ya es tarde) |
| `salidaEsperada` | fin de turno + `minutosRetraso` (compensación minuto a minuto, aplica también dentro de la gracia) |
| `deficitMinutos` | max(0, salidaEsperada − salida real) y también max(0, horasEsperadas − horasTrabajadas) — se reporta el mayor; 0 si compensó |
| `falta` | turno asignado, sin marcaciones en la ventana y sin justificación aprobada |
| `sinPlan` | marcaciones en un día `DESCANSO`, `DESCANSO_COMPENSATORIO` o sin asignación (solo para empleados que tienen algún plan en el período; el personal 100 % regular nunca lo activa) |
| horas extra | max(0, salida real − `salidaEsperada`) en horas: lo trabajado después de la salida esperada (la compensación del retraso no cuenta como extra). Personal sin turno mantiene el cálculo actual |

El personal sin asignación se calcula como hoy (horario estándar del tenant), con el único ajuste `>` → `>=` en la tolerancia.

### 4.3 Semana y descanso compensatorio

- Semana laboral: lunes–domingo.
- El reporte semanal cuenta los días efectivamente trabajados; a partir del 4.º día trabajado en la semana el día adicional **puede** generar `GANADO +1` — no es automático: RRHH lo confirma al resolver el pendiente (ver 4.4), porque un `sinPlan` puede ser un intercambio y no un día adicional.

### 4.4 Resolución de días `sinPlan` (bandeja de pendientes)

El reporte empareja "A trabajó sin plan" con "B tenía turno ese día y faltó" cuando existen ambos. RRHH resuelve cada pendiente con una de estas acciones:

1. **Intercambio A↔B** (programado o retroactivo): A recibe el turno de B ese día y B recibe el día que tenía A. Operación única y auditada que actualiza ambas `TurnoAsignacion` y recalcula ambos resúmenes. **Neutra para los saldos**: A no gana compensatorio, B no queda con falta.
2. **Día adicional genuino**: se confirma `GANADO +1` para A (movimiento con `fechaReferencia` = fecha trabajada). El goce se programa después asignando un `DESCANSO_COMPENSATORIO` en el plan.
3. **Cruce de falta contra saldo**: si B faltó sin intercambio y tiene saldo > 0, RRHH convierte su día en `DESCANSO_COMPENSATORIO` ⇒ `GOZADO −1` y la falta desaparece. Sin saldo ⇒ queda falta (o justificación regular).
4. **Error**: la marcación fue equivocada ⇒ flujo de justificaciones/observaciones normal.

Los movimientos de A y de B son independientes; solo el "intercambio" explícito los liga como operación neutra (el saldo nunca se descuadra por resoluciones a medias).

### 4.5 Personal de confianza (configurable por contrato)

Para empleados con `Contrato.personalDeConfianza = true`:

- **NO se generan registros de `HorasExtra` hacia nómina** (`horasExtrasDiarias = 0` en su resumen), sin importar cuánto excedan el turno. Las horas trabajadas reales sí quedan registradas.
- En Perú la jornada máxima es de **48 horas semanales** (parámetro normativo `JORNADA_SEMANAL_MAXIMA`, configurable): el reporte de cumplimiento suma sus horas por semana (lunes–domingo) y, si exceden el parámetro, agrega una **nota informativa para RRHH** — no alimenta el cálculo de planillas ni el libro de compensatorios.
- Puntualidad, compensación del retraso y déficit se siguen reportando igual que para el resto (informativos).

### 4.6 Goce programado

Asignar `DESCANSO_COMPENSATORIO` en el plan (fecha concreta de disfrute) registra `GOZADO −1` vinculado a esa asignación. Si el saldo del empleado es ≤ 0, el sistema advierte y RRHH puede forzar con nota (queda en auditoría y el saldo puede quedar negativo, visible en el reporte). Quitar/cambiar ese día del plan revierte el movimiento (movimiento inverso, no borrado).

## 5. API y permisos

Permisos nuevos (seed): `shift.read`, `shift.manage` (catálogo y plan), `shift.resolve` (resoluciones de pendientes y movimientos de compensatorios). Admin: todos; RRHH: todos; Manager: `shift.read`; Employee: ninguno (ve su plan vía un endpoint propio).

| Endpoint | Permiso | Qué hace |
|---|---|---|
| `GET/POST /turnos` · `PUT /turnos/:id` | `shift.manage` (GET: `shift.read`) | Catálogo de turnos (crear, editar, desactivar) |
| `GET /turnos/plan?desde&hasta&employeeId?` | `shift.read` | Plan del período (grilla) |
| `PUT /turnos/plan` | `shift.manage` | Upsert de asignaciones puntuales (empleado, fecha, tipoDia, turnoId) |
| `GET /turnos/plan/plantilla` | `shift.manage` | Plantilla CSV |
| `POST /turnos/plan/import` | `shift.manage` | Import CSV: `numero_documento,fecha,turno` (código de turno, `DESCANSO` o `COMPENSATORIO`). Upsert por fila, errores por fila sin abortar → `{procesadas, omitidas, errores[]}` |
| `POST /turnos/intercambio` | `shift.resolve` | Intercambio A↔B en una fecha (programado o retroactivo; recalcula resúmenes) |
| `GET /turnos/cumplimiento/:periodo` | `shift.read` | Reporte de cumplimiento del período |
| `GET /turnos/cumplimiento/:periodo/export` | `shift.manage` | CSV compatible con el import de novedades de nómina |
| `POST /turnos/compensatorios` | `shift.resolve` | Movimiento manual: `GANADO` (resolución de pendiente) o `AJUSTE_INICIAL` (carga de saldo de arranque, motivo obligatorio) |
| `GET /turnos/compensatorios/:employeeId` | `shift.read` | Libro y saldo del empleado |
| `GET /turnos/mi-plan?desde&hasta` | sesión | El empleado consulta su propio plan |

Los services reciben `tx` como primer parámetro (patrón del proyecto); sin class-validator (validación manual).

## 6. Integración con el flujo existente

- **`AttendanceService` (marcación en vivo) y `AttendanceImportService` (CSV del reloj):** antes de recalcular el resumen, resuelven si la marcación cae en la ventana de algún turno asignado del empleado (fecha D−1, D, D+1). Si sí ⇒ el recálculo es del **día del turno** con el calculador de cumplimiento; si no ⇒ flujo actual intacto.
- **Marcaciones append-only:** nada cambia; la atribución a fecha de turno es un cálculo derivado, recalculable.
- **Horas extra:** para días con turno, las genera el calculador de cumplimiento (4.2); se persisten en `HorasExtra` como hoy (tipo DIARIAS).
- **Editar el plan de fechas pasadas con marcaciones** (intercambio retroactivo, correcciones): recalcula los resúmenes afectados; el trigger de auditoría registra el cambio.
- **Justificaciones:** mismas reglas y flujo de aprobación; una falta de turno justificada no computa como falta.

## 7. Reporte de cumplimiento (por período)

Por empleado: días planificados vs. trabajados · faltas (justificadas / no) · tardanzas formales (días y minutos acumulados) · déficit no compensado (minutos) · días `sinPlan` pendientes de resolución (con su contraparte sugerida) · compensatorios: saldo inicial del período, ganados, gozados, **saldo actual** · para personal de confianza: **nota informativa** por cada semana que exceda las 48 h (`JORNADA_SEMANAL_MAXIMA`). Totales del período y semáforo por empleado.

Export CSV con columnas compatibles con `POST /payroll/:periodo/import` (novedades) para que RRHH cargue los descuentos que decida.

## 8. Frontend

- **Página `/turnos`** (permiso `shift.read`; acciones según `shift.manage`/`shift.resolve`): pestañas Catálogo · Plan (grilla mensual empleado × día, edición puntual, import CSV, acción de intercambio) · Cumplimiento (reporte + bandeja de pendientes con las 4 resoluciones + export) · Compensatorios (saldos y libro por empleado, carga de saldo inicial).
- **`/asistencia`:** el resumen mensual muestra el turno del día y el déficit cuando aplique (cambio menor).
- Sidebar: item "Turnos" visible con `shift.read`.

## 9. Errores y validaciones

- CSV: turno inexistente/inactivo, empleado no encontrado, fecha inválida ⇒ error por fila, no aborta.
- Asignar turno a empleado cesado ⇒ 400. Asignación duplicada ⇒ upsert (actualiza).
- `DESCANSO_COMPENSATORIO` sin saldo ⇒ advertencia; forzar requiere nota.
- Intercambio con empleados sin asignación ese día ⇒ 422 con detalle.
- `AJUSTE_INICIAL` sin motivo ⇒ 400.

## 10. Testing

- **TDD de calculadores puros:** límite exacto de gracia (29:59 ok / 30:00 tarde), compensación exacta y con déficit, turno NOCHE cruzando medianoche (entrada 19:55, salida 08:03 de D+1 ⇒ 12.13 h en el día D), ventana de captura y solapes, falta con/sin justificación, horas extra tras compensar, semana de 4 días.
- **Services con mock tx:** import CSV del plan (upsert, errores por fila), intercambio programado y retroactivo (recálculo de ambos), movimientos y saldo (GANADO/GOZADO/AJUSTE_INICIAL, reversión), advertencia sin saldo.
- **E2E manual:** cargar catálogo DIA/NOCHE, plan mensual por CSV, importar marcaciones del reloj (incluyendo una noche completa), verificar resumen del turno NOCHE en un solo día, generar el reporte, resolver un `sinPlan` por intercambio y otro como día adicional, programar el goce y verificar el saldo.

## 11. Fases de implementación

1. Schema + migración (`Turno`, `TurnoAsignacion`, `CompensatorioMovimiento`, campos de `AsistenciaResumen`) + permisos y parámetros de ventana en seed.
2. Calculadores puros: ventana de captura + cumplimiento de turno (incluye el ajuste `>` → `>=` de tolerancia).
3. Integración del recálculo del resumen (marcación en vivo + import del reloj) con fecha de turno.
4. API del plan: catálogo, asignaciones, plantilla e import CSV.
5. Compensatorios e intercambios: libro mayor, resoluciones, endpoint de intercambio.
6. Reporte de cumplimiento + export CSV de novedades.
7. Frontend `/turnos` + ajustes en `/asistencia` + sidebar.
8. Documentación (`RESUMEN_SISTEMA.md`, `PENDIENTES.md`) y E2E.
