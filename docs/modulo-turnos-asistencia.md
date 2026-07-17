# Módulo de Asistencia por Turnos / Shift-Based Attendance Module

**Documento funcional / Functional document** · 2026-07-17
**Sistema / System:** HRMS Perú · **Estado / Status:** Diseño aprobado, implementación planificada / Design approved, implementation planned

---

# 🇵🇪 SECCIÓN EN ESPAÑOL — Personal local

## 1. ¿Por qué este módulo?

Hasta hoy el sistema controla la asistencia con **un solo horario para toda la empresa** (lunes a viernes, 8:30–18:00) y calcula todo por día calendario. Eso no funciona para el personal que trabaja por turnos:

- Hay dos turnos de 12 horas: **DÍA (8:00 am – 8:00 pm)** y **NOCHE (8:00 pm – 8:00 am)**.
- Este personal trabaja **3 o 4 días por semana** (entre 36 y 48 horas semanales).
- Cuando trabajan un día adicional en la semana, ganan un **día de descanso compensatorio**.
- El turno NOCHE cruza la medianoche: con el sistema actual, la salida de las 8:00 am se registraba en "otro día", generando datos falsos (tardanzas gigantes, días incompletos).

Este módulo permite **cargar el plan de turnos, compararlo contra las marcaciones del reloj y validar** que cada persona trabajó cuando le tocaba y las horas que le correspondían.

## 2. Reglas de puntualidad (aplican a TODO el personal)

| Regla | Cómo funciona |
|---|---|
| **Gracia de 29:59 minutos** | Llegar hasta 29 minutos con 59 segundos después de la hora de inicio NO cuenta como tardanza formal. Llegar a los 30:00 minutos o más SÍ es tardanza, y los minutos se cuentan desde la hora oficial de inicio (no desde el fin de la gracia). |
| **Compensación el mismo día** | TODO retraso se compensa saliendo más tarde, minuto a minuto — aunque esté dentro de la gracia. Ejemplo: entrada 8:30, llega 8:50 → debe salir 18:20. |
| **Déficit** | Si no compensa (sale a su hora normal habiendo llegado tarde, o no completa las horas del turno), el faltante queda registrado como "déficit" en minutos. |
| **Horas extra** | Solo cuenta como hora extra lo trabajado DESPUÉS de la salida esperada (hora de fin + minutos de compensación). Quedarse para compensar un retraso no es hora extra. |

**Consecuencias:** el sistema NO descuenta automáticamente. Genera un **reporte mensual** con tardanzas, déficits y faltas por persona, y RRHH decide qué descontar. Lo decidido se exporta en un archivo compatible con la carga de novedades de nómina.

### Personal de confianza (configurable por contrato)

Algunos contratos indican que la empresa puede solicitar al trabajador **en cualquier horario** según el trabajo (personal de dirección/confianza). Para ellos:

- **No se generan horas extra hacia nómina**, sin importar cuánto excedan su turno. Sus horas reales trabajadas sí quedan registradas.
- Como en el Perú la jornada máxima es de **48 horas semanales** (valor configurable), el reporte mensual muestra una **nota informativa para RRHH** por cada semana en que superen ese límite — es solo una alerta, **no** afecta el cálculo de planillas ni el saldo de compensatorios.
- Las reglas de puntualidad y compensación se les reportan igual que al resto.

## 3. El plan de turnos

- **Catálogo de turnos:** RRHH define los turnos una sola vez (código, horario, horas esperadas, tolerancia). Inicialmente: DIA (08:00–20:00, 12 h) y NOCHE (20:00–08:00, 12 h), ambos con tolerancia de 30 minutos.
- **Plan mensual:** a cada persona se le asigna, por fecha, una de tres cosas: un **turno**, un **descanso (D)**, o un **descanso compensatorio (DC)**.
- **Dos formas de cargar el plan:** archivo CSV masivo (`numero_documento,fecha,turno`) o edición celda por celda en la pantalla de la web (para reemplazos de última hora).
- **Quién no tiene plan asignado sigue igual que siempre** con el horario estándar de la empresa — el personal administrativo no se ve afectado.

## 4. El turno de noche y la medianoche

Cada turno asignado define una **ventana de captura**: desde 2 horas antes del inicio hasta 4 horas después del fin. Toda marcación del reloj dentro de esa ventana pertenece al **día del turno**, no al día del calendario.

**Ejemplo:** turno NOCHE del lunes (20:00 lunes – 08:00 martes). La entrada de las 19:55 del lunes y la salida de las 08:03 del martes se registran ambas en el **lunes**, que queda con sus 12.13 horas completas. El martes no genera ningún registro falso.

## 5. Validación diaria: los casos

| Caso | Qué registra el sistema |
|---|---|
| Llega puntual, sale a su hora | Día normal, horas completas. |
| Llega 8:50 (retraso 20 min, dentro de la gracia), sale 18:20 | Sin tardanza formal, compensó, día limpio. |
| Llega 8:50, sale 18:00 | Sin tardanza formal, pero **déficit de 20 minutos** en el reporte. |
| Llega 9:00 en punto (30:00 min) | **Tardanza formal de 30 minutos** (la gracia es hasta 29:59). Debe salir 18:30 para no acumular déficit además de la tardanza. |
| Tenía turno y no marcó nada | **Falta** (salvo justificación aprobada por su jefe, flujo ya existente). |
| Trabajó un día que no tenía turno | Queda como **pendiente de resolución** para RRHH (ver sección 6). |
| Trabaja más allá de su salida esperada | **Horas extra** (con los recargos de ley que ya calcula el sistema). |

## 6. Días trabajados sin turno: la bandeja de pendientes

Cuando alguien viene a trabajar un día que no tenía turno asignado, casi siempre hay una contraparte: el titular de ese turno no vino. El reporte muestra ambos juntos ("A trabajó sin turno / B tenía turno y faltó") y RRHH resuelve cada caso con una de estas acciones:

1. **Intercambio de turnos (el caso más común):** A y B cambiaron turnos entre ellos. Se registra el intercambio y ambos días quedan corregidos: A no gana compensatorio (no fue día adicional) y B no queda con falta. Puede registrarse antes (programado) o después de ocurrido.
2. **Día adicional genuino:** nadie faltó, la persona vino de más (4.º día de la semana). RRHH confirma y se registra **+1 día compensatorio ganado**.
3. **Cruce de falta contra saldo:** si el titular simplemente no vino (sin intercambio) y tiene días compensatorios acumulados, RRHH puede marcar ese día como descanso compensatorio → se descuenta 1 del saldo y la falta desaparece. Sin saldo, queda como falta o justificación normal.
4. **Error:** la marcación fue equivocada → se corrige por el flujo de justificaciones normal.

## 7. Saldo de días compensatorios

Cada empleado tiene un **libro de movimientos** de días compensatorios, siempre trazable:

- **Saldo inicial:** al arrancar el módulo, RRHH carga el saldo que cada persona ya trae acumulado (ej. 2 o 3 días), con motivo obligatorio.
- **+1 Ganado:** por cada día adicional confirmado, con referencia a la fecha trabajada.
- **−1 Gozado:** al programar en el plan **qué día concreto va a disfrutar** el descanso (celda "DC"). Si no tiene saldo, el sistema advierte; RRHH puede forzarlo con una nota y queda auditado.
- **Saldo actual = suma de todos los movimientos.** El reporte mensual muestra: saldo inicial, ganados, gozados y saldo actual por persona.

Nada del libro se borra ni se edita: una corrección es siempre un movimiento inverso. Todo queda en el registro de auditoría del sistema.

## 8. Decisiones tomadas (y por qué)

| Decisión | Alternativa descartada | Razón |
|---|---|---|
| Integrar los turnos al cálculo diario existente | Un reporte de conciliación aparte sin tocar el cálculo | Un reporte aparte dejaría el resumen diario calculando MAL al personal nocturno (tardanzas y faltas falsas todos los días): habría dos verdades contradictorias en pantalla. |
| Plan cargado por RRHH (CSV + edición web) | Generación automática de rotaciones ("4×3") | El plan real lo arma RRHH mes a mes; la generación automática es complejidad que hoy no se necesita. Puede agregarse después. |
| Reporte para decisión de RRHH | Descuento automático en nómina | RRHH mantiene el control de qué se descuenta; el sistema entrega la evidencia y el archivo listo para cargar. |
| Gracia de 29:59 (a los 30:00 ya es tarde) | "Más de 30 minutos" | Definición del negocio: 30 minutos exactos ya es tardanza. Se unificó también para el personal regular. |
| Libro de movimientos para compensatorios | Un simple contador por empleado | El contador no responde "¿cuándo ganó este día y cuándo lo usó?" — el libro sí, y es inmutable (auditoría). |
| El "ganado" NO es automático | +1 automático al detectar un 4.º día | Un día sin plan puede ser un intercambio, no un día adicional; confirmarlo evita saldos inflados. |
| Ventana de captura de −2h/+4h configurable | Fecha calendario fija | Es la única forma de que el turno noche quede completo en un solo día; los márgenes son parámetros, no constantes. |
| Personal de confianza: exceso semanal >48h como nota informativa | Calcularlo como horas extra pagables | El contrato de confianza permite convocarlo en cualquier horario; la ley no le aplica jornada máxima. La nota da visibilidad a RRHH sin afectar planillas ni compensatorios. |

## 9. Qué verá cada rol

| Rol | Acceso |
|---|---|
| **RRHH** | Todo: catálogo, plan, import CSV, reporte, resoluciones, saldos. |
| **Admin** | Igual que RRHH. |
| **Gerente/Supervisor** | Consulta el plan y el reporte de su equipo (solo lectura). |
| **Empleado** | Consulta su propio plan de turnos del mes. |

## 10. Documentos técnicos relacionados

- Diseño (spec): `docs/superpowers/specs/2026-07-17-turnos-asistencia-design.md`
- Plan de implementación (14 tareas): `docs/superpowers/plans/2026-07-17-turnos-asistencia-plan.md`

---

# 🇬🇧 ENGLISH SECTION — Management & Headquarters (China)

## 1. Why this module?

Until now, the system controls attendance with **a single company-wide schedule** (Monday–Friday, 8:30 AM–6:00 PM) and computes everything by calendar day. That does not work for shift-based staff:

- There are two 12-hour shifts: **DAY (8:00 AM – 8:00 PM)** and **NIGHT (8:00 PM – 8:00 AM)**.
- These employees work **3 or 4 days per week** (36 to 48 hours weekly).
- When they work an additional day in a week, they earn a **compensatory rest day**.
- The NIGHT shift crosses midnight: with the current system, the 8:00 AM clock-out was recorded on "another day," producing false data (huge false tardiness records, incomplete days).

This module allows HR to **upload the shift roster, compare it against the time-clock records, and validate** that each person worked when scheduled and for the required number of hours.

## 2. Punctuality rules (apply to ALL staff)

| Rule | How it works |
|---|---|
| **29:59-minute grace period** | Arriving up to 29 minutes and 59 seconds after the start time does NOT count as formal tardiness. Arriving at 30:00 minutes or later IS tardiness, and the minutes are counted from the official start time (not from the end of the grace period). |
| **Same-day make-up** | EVERY late arrival must be made up by leaving later, minute for minute — even within the grace period. Example: start time 8:30, arrives 8:50 → must leave at 18:20. |
| **Deficit** | If the employee does not make up the time (leaves at the normal time after arriving late, or does not complete the shift hours), the shortfall is recorded as a "deficit" in minutes. |
| **Overtime** | Only time worked AFTER the expected departure time (shift end + make-up minutes) counts as overtime. Staying late to make up a late arrival is not overtime. |

**Consequences:** the system does NOT deduct automatically. It generates a **monthly report** with tardiness, deficits, and absences per person, and HR decides what to deduct. Decisions are exported in a file compatible with the payroll variable-input upload.

### Trust/management personnel (configurable per contract)

Some contracts state that the company may call the employee **at any time** depending on the work (management/trust personnel). For them:

- **No overtime records are generated for payroll**, no matter how far they exceed their shift. Their actual hours worked are still recorded.
- Since Peru's legal maximum working week is **48 hours** (configurable value), the monthly report shows an **informational note for HR** for each week in which they exceed that limit — it is an alert only and does **not** affect payroll calculation or the compensatory-day balance.
- Punctuality and make-up rules are reported for them the same as for everyone else.

## 3. The shift roster

- **Shift catalog:** HR defines shifts once (code, schedule, expected hours, tolerance). Initially: DAY (08:00–20:00, 12 h) and NIGHT (20:00–08:00, 12 h), both with a 30-minute tolerance.
- **Monthly roster:** each person is assigned, per date, one of three things: a **shift**, a **rest day (D)**, or a **compensatory rest day (DC)**.
- **Two ways to load the roster:** bulk CSV file (`document_number,date,shift`) or cell-by-cell editing on the web screen (for last-minute replacements).
- **Anyone without an assigned roster continues as before** on the standard company schedule — administrative staff are not affected.

## 4. The night shift and midnight

Each assigned shift defines a **capture window**: from 2 hours before the shift starts until 4 hours after it ends. Every clock record within that window belongs to the **shift date**, not the calendar date.

**Example:** Monday NIGHT shift (Monday 20:00 – Tuesday 08:00). The 19:55 Monday clock-in and the 08:03 Tuesday clock-out are both recorded on **Monday**, which ends up with its full 12.13 hours. Tuesday generates no false records.

## 5. Daily validation: the cases

| Case | What the system records |
|---|---|
| Arrives on time, leaves on time | Normal day, full hours. |
| Arrives 8:50 (20 min late, within grace), leaves 18:20 | No formal tardiness, time made up, clean day. |
| Arrives 8:50, leaves 18:00 | No formal tardiness, but a **20-minute deficit** in the report. |
| Arrives at exactly 9:00 (30:00 min) | **Formal tardiness of 30 minutes** (grace ends at 29:59). Must leave at 18:30 to avoid accruing a deficit on top of the tardiness. |
| Had a shift and never clocked in | **Absence** (unless a justification is approved by the supervisor — existing workflow). |
| Worked on a day with no assigned shift | Recorded as a **pending item for HR resolution** (see section 6). |
| Works beyond the expected departure | **Overtime** (with the legal surcharges the system already calculates). |

## 6. Days worked without a shift: the pending-items tray

When someone works on a day they had no assigned shift, there is almost always a counterpart: the person scheduled for that shift did not show up. The report shows both together ("A worked unscheduled / B was scheduled and absent") and HR resolves each case with one of these actions:

1. **Shift swap (the most common case):** A and B traded shifts. The swap is recorded and both days are corrected: A earns no compensatory day (it was not an additional day) and B is not marked absent. It can be recorded in advance (planned) or after the fact.
2. **Genuine additional day:** nobody was absent; the person worked an extra day (4th day of the week). HR confirms and **+1 earned compensatory day** is recorded.
3. **Offsetting an absence against the balance:** if the scheduled person simply did not show up (no swap) and has accumulated compensatory days, HR can mark that day as a compensatory rest day → 1 is deducted from the balance and the absence is cleared. With no balance, it remains an absence or goes through the normal justification flow.
4. **Error:** the clock record was a mistake → corrected through the normal justification workflow.

## 7. Compensatory day balance

Each employee has a fully traceable **movement ledger** for compensatory days:

- **Opening balance:** when the module starts, HR loads the balance each person has already accumulated (e.g., 2 or 3 days), with a mandatory reason.
- **+1 Earned:** for each confirmed additional day, referencing the date worked.
- **−1 Taken:** when the specific enjoyment date is scheduled in the roster ("DC" cell). If there is no balance, the system warns; HR can override with a note, and it is audited.
- **Current balance = sum of all movements.** The monthly report shows: opening balance, earned, taken, and current balance per person.

Nothing in the ledger is deleted or edited: a correction is always a reversing entry. Everything is captured in the system's immutable audit log.

## 8. Decisions made (and why)

| Decision | Discarded alternative | Reason |
|---|---|---|
| Integrate shifts into the existing daily calculation | A separate reconciliation report without touching the calculation | A separate report would leave the daily summary computing night staff INCORRECTLY (false tardiness and absences every day): two contradictory sources of truth on screen. |
| Roster loaded by HR (CSV + web editing) | Automatic rotation generation ("4×3" patterns) | The real roster is built by HR month by month; automatic generation is complexity not needed today. It can be added later. |
| Report for HR decision | Automatic payroll deduction | HR keeps control over what is deducted; the system delivers the evidence and a ready-to-upload file. |
| 29:59 grace (at 30:00 it is already late) | "More than 30 minutes" | Business definition: exactly 30 minutes is already tardiness. Also unified for regular staff. |
| Movement ledger for compensatory days | A simple counter per employee | A counter cannot answer "when was this day earned and when was it used?" — the ledger can, and it is immutable (audit). |
| "Earned" is NOT automatic | Automatic +1 upon detecting a 4th day | An unscheduled day may be a swap, not an additional day; requiring confirmation prevents inflated balances. |
| Configurable −2h/+4h capture window | Fixed calendar date | It is the only way for the night shift to land complete on a single day; the margins are parameters, not constants. |
| Trust personnel: weekly excess over 48h as an informational note | Computing it as payable overtime | The trust contract allows calling them at any schedule; the legal maximum working hours do not apply to them. The note gives HR visibility without affecting payroll or compensatory days. |

## 9. What each role sees

| Role | Access |
|---|---|
| **HR** | Everything: catalog, roster, CSV import, report, resolutions, balances. |
| **Admin** | Same as HR. |
| **Manager/Supervisor** | Views the roster and the report for their team (read-only). |
| **Employee** | Views their own shift roster for the month. |

## 10. Related technical documents

- Design (spec): `docs/superpowers/specs/2026-07-17-turnos-asistencia-design.md`
- Implementation plan (14 tasks): `docs/superpowers/plans/2026-07-17-turnos-asistencia-plan.md`
