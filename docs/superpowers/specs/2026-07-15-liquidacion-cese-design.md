# Diseño — Módulo de Cese y Liquidación de Beneficios Sociales (Perú)

**Fecha:** 2026-07-15 · **Estado:** aprobado por el usuario (brainstorming interactivo)
**Alcance elegido:** cese completo con todos los documentos (opción máxima) + módulo de récord vacacional + deducciones (bruto y neto).

## 1. Objetivo

Cuando se extingue el vínculo laboral, el sistema debe calcular y pagar la liquidación
de beneficios sociales dentro de las **48 horas** posteriores al cese (D.S. 001-97-TR;
su incumplimiento es infracción grave SUNAFIL), generar la documentación obligatoria
y archivarla en el legajo digital.

El calculador actual (`liquidacion.calculator.ts`, Fase 1) es un stub: suma CTS
trunca + grati trunca + vacaciones truncas + pendientes, sin bonificación
extraordinaria, sin regímenes MYPE, sin indemnizaciones, sin deducciones y sin motivo
de cese. El modelo `Liquidacion` en BD es igual de mínimo. Este diseño los reemplaza.

## 2. Decisiones tomadas (con el usuario)

| Decisión | Elección |
|---|---|
| Alcance | Flujo de cese completo + hoja de liquidación + certificado de trabajo + constancia de cese + certificado de retención de 5ta |
| Régimen MYPE | Separar `mype` en `mype_micro` (CTS/grati 0%) y `mype_pequena` (50%); migrar contratos `mype` existentes a `mype_pequena` (default legalmente conservador) |
| Vacaciones | Crear módulo `vacations` con tabla `VacacionPeriodo` (fuente de verdad) **y** pre-llenado editable en el formulario de cese para que RRHH revise/corrija |
| Deducciones | Calcular bruto **y** neto: retención AFP/ONP y quinta categoría sobre conceptos afectos |
| Arquitectura | Enfoque A: módulo `termination` independiente que orquesta calculadores puros en `payroll/calculators`, documentos vía módulo documental, más mini-módulo `vacations` |

## 3. Modelo de datos

### 3.1 `Contrato` — migración de régimen

`regimenLaboral`: `general | mype_micro | mype_pequena | agrario`.
Migración de datos: filas con `mype` → `mype_pequena`.

### 3.2 Nuevo `VacacionPeriodo` (módulo vacations)

```prisma
model VacacionPeriodo {
  id            String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  tenantId      String   @map("tenant_id") @db.Uuid
  employeeId    String   @map("employee_id") @db.Uuid
  periodoInicio DateTime @map("periodo_inicio") @db.Date // aniversario de ingreso
  periodoFin    DateTime @map("periodo_fin") @db.Date
  diasGanados   Int      @map("dias_ganados") // 30 general/agrario, 15 MYPE (según régimen del contrato al generarse)
  diasGozados   Decimal  @default(0) @map("dias_gozados") @db.Decimal(5, 2)
  estado        EstadoVacacionPeriodo @default(EN_CURSO) // EN_CURSO | VENCIDO_PENDIENTE | GOZADO | LIQUIDADO
  notas         String?  @db.Text
  creadoEn      DateTime @default(now()) @map("creado_en")
  actualizadoEn DateTime @updatedAt @map("actualizado_en")

  @@unique([tenantId, employeeId, periodoInicio])
  @@index([tenantId, estado])
  @@map("vacacion_periodo")
}
```

- `VENCIDO_PENDIENTE` = período cumplido con días sin gozar (candidato a devengadas
  y, pasado un año del vencimiento, a indemnización vacacional).
- RLS por tenant + trigger de auditoría (patrón Fase 0). CRUD manual por RRHH.

### 3.3 `Cese` reemplaza a `Liquidacion`

El modelo `Liquidacion` actual se elimina (solo contiene datos demo) y se crea:

```prisma
enum MotivoCese { RENUNCIA TERMINO_CONTRATO MUTUO_DISENSO DESPIDO_ARBITRARIO FALLECIMIENTO }
enum EstadoCese { BORRADOR CALCULADA APROBADA PAGADA ANULADA }

model Cese {
  id           String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  tenantId     String   @map("tenant_id") @db.Uuid
  employeeId   String   @map("employee_id") @db.Uuid
  fechaCese    DateTime @map("fecha_cese") @db.Date
  motivo       MotivoCese
  estado       EstadoCese @default(BORRADOR)

  inputSnapshot Json    @map("input_snapshot") // datos pre-llenados + correcciones de RRHH (trazabilidad del cálculo)
  componentes   Json?   // desglose calculado: líneas {concepto, baseLegal, monto, afectoA}
  totalBruto        Decimal? @map("total_bruto") @db.Decimal(12, 2)
  totalDeducciones  Decimal? @map("total_deducciones") @db.Decimal(12, 2)
  netoPagar         Decimal? @map("neto_pagar") @db.Decimal(12, 2)

  gratificacionExtraordinaria Decimal @default(0) @map("gratificacion_extraordinaria") @db.Decimal(12, 2) // mutuo disenso, no remunerativa
  derechohabientes            Json?   // fallecimiento: [{nombre, tipoDoc, numeroDoc, parentesco, porcentaje}]

  fechaLimitePago DateTime  @map("fecha_limite_pago") @db.Date // fechaCese + 48h (semáforo SUNAFIL)
  aprobadoPor     String?   @map("aprobado_por") @db.Uuid
  aprobadoEn      DateTime? @map("aprobado_en")
  pagadoEn        DateTime? @map("pagado_en")
  pagoFueraDePlazo Boolean  @default(false) @map("pago_fuera_de_plazo")
  motivoAnulacion String?   @map("motivo_anulacion") @db.Text

  creadoPor String   @map("creado_por") @db.Uuid
  creadoEn  DateTime @default(now()) @map("creado_en")
  actualizadoEn DateTime @updatedAt @map("actualizado_en")

  @@index([tenantId, estado])
  @@index([tenantId, employeeId])
  @@map("cese")
}
```

- **Índice parcial único** (SQL en la migración): un solo cese con `estado <> 'ANULADA'`
  por empleado.
- RLS por tenant + trigger de auditoría.
- Al APROBAR: `Employee.estado = 'cesado'`, períodos vacacionales pendientes → `LIQUIDADO`.
- Al ANULAR desde APROBADA: se revierten ambos efectos.

### 3.4 `TipoDocumento` — valores nuevos

`LIQUIDACION`, `CERTIFICADO_TRABAJO`, `CONSTANCIA_CESE`, `CERTIFICADO_RETENCION_5TA`,
`CARTA_RENUNCIA`, `EXAMEN_MEDICO_RETIRO`.

### 3.5 Parámetros normativos nuevos (versionados en `normative_parameter`)

| Código | Valor inicial | Uso |
|---|---|---|
| `INDEMNIZACION_TOPE_REMUNERACIONES` | 12 | Tope de indemnización por despido (régimen general) |
| `VACACIONES_DIAS_GENERAL` | 30 | Días por período — general/agrario |
| `VACACIONES_DIAS_MYPE` | 15 | Días por período — micro y pequeña |
| `MYPE_FACTOR_PEQUENA` | 0.5 | Factor CTS/gratificación pequeña empresa |
| `MYPE_FACTOR_MICRO` | 0 | Factor CTS/gratificación microempresa |
| `INDEMNIZACION_MYPE_PEQUENA_DIAS_POR_ANIO` / `_TOPE_DIAS` | 20 / 120 | Indemnización pequeña empresa |
| `INDEMNIZACION_MYPE_MICRO_DIAS_POR_ANIO` / `_TOPE_DIAS` | 10 / 90 | Indemnización microempresa |

Las tasas de bonificación extraordinaria (9% EsSalud / 6.75% EPS) ya existen para
gratificaciones y se reutilizan.

## 4. Calculadores (funciones puras, `apps/api/src/modules/payroll/calculators/`)

### 4.1 Reutilizados

- **`cts.calculator`** — `calcularCtsTrunca` sin cambios; el motor aplica el factor
  de régimen (1 / 0.5 / 0).
- **`gratificacion.calculator`** — sin cambios de código; el motor ahora pasa las
  tasas reales de bonificación extraordinaria (el stub actual las pasaba en 0) y
  aplica el factor de régimen.
- **`afp-onp.calculator`** y **`quinta-categoria.calculator`** — para las deducciones.

### 4.2 Nuevo `vacaciones.calculator`

Entrada: períodos vacacionales (ganados/gozados/fechas), remuneración computable
vigente, fecha de cese, régimen, flag `excluidoIndemnizacion` (gerentes que deciden
sus propias vacaciones).
Salida:

- **Devengadas:** días ganados no gozados de períodos vencidos × valor-día vigente.
- **Truncas:** proporcional del período en curso — (meses completos + días/30) / 12
  × remuneración computable (con días por régimen).
- **Indemnización vacacional (art. 23 D.Leg. 713):** una remuneración adicional por
  cada período vencido hace más de un año sin gozar; inafecta; excluible por flag.

### 4.3 Nuevo `indemnizacion-despido.calculator`

Solo para `DESPIDO_ARBITRARIO`. Entrada: tipo de contrato (indeterminado/plazo fijo),
régimen, remuneración mensual, tiempo de servicios, meses restantes del contrato,
parámetros de topes.

- Indeterminado (general/agrario): 1.5 remuneraciones por año completo + fracción
  proporcional por meses y días; tope 12 remuneraciones.
- Plazo fijo (general/agrario): 1.5 remuneraciones por mes que falte al vencimiento;
  tope 12 remuneraciones.
- MYPE pequeña: 20 remuneraciones diarias por año, tope 120 días.
- MYPE micro: 10 remuneraciones diarias por año, tope 90 días.

### 4.4 `liquidacion.calculator` — reescrito como motor de composición

Entrada (todo explícito, sin acceso a BD): motivo, régimen, remuneración computable,
asignación familiar, promedio de variables, datos CTS (meses/días desde último
depósito, grati del semestre), datos grati trunca (meses completos, EPS, tasas),
datos vacacionales (períodos), remuneraciones pendientes (sueldo prorrateado, horas
extra validadas, bonos/comisiones), gratificación extraordinaria negociada, datos
para indemnización, parámetros normativos (tramos 5ta, UIT, tasas pensionarias,
factores/topes).

Salida: `{ ingresos: Linea[], deducciones: Linea[], totalBruto, totalDeducciones,
netoPagar }` donde `Linea = { concepto, baseLegal, monto }`.

**Matriz de afectación (regla central):**

| Concepto | AFP/ONP | 5ta categoría |
|---|---|---|
| CTS trunca | inafecta | inafecta |
| Gratificación trunca + bonif. extraordinaria | inafecta (Ley 30334) | **afecta** |
| Vacaciones (truncas y devengadas) | **afecta** | **afecta** |
| Indemnización vacacional | inafecta | inafecta |
| Indemnización por despido arbitrario | inafecta | inafecta |
| Remuneraciones pendientes (sueldo, HE, bonos) | **afecta** | **afecta** |
| Gratificación extraordinaria por cese (mutuo disenso) | inafecta | inafecta* |

\* Tratada como concepto no remunerativo acordado entre las partes.

**Composición por motivo:**

| Motivo | Conceptos |
|---|---|
| RENUNCIA / TERMINO_CONTRATO | Truncos (CTS, grati, vacaciones) + devengadas + pendientes |
| MUTUO_DISENSO | Lo anterior + gratificación extraordinaria negociada |
| DESPIDO_ARBITRARIO | Lo anterior (sin grati extraordinaria) + indemnización por despido |
| FALLECIMIENTO | Truncos + devengadas + pendientes (sin indemnización); pago a derechohabientes |

## 5. Módulo `termination` — API y flujo

Permisos nuevos: `termination.read`, `termination.manage` (Admin, RRHH),
`termination.approve` (solo Admin — separación de funciones). Vacations:
`vacation.read` (Admin, RRHH, Manager), `vacation.manage` (Admin, RRHH).

| Endpoint | Permiso | Comportamiento |
|---|---|---|
| `POST /ceses` | manage | Crea BORRADOR y pre-llena `inputSnapshot` desde: contrato vigente (remuneración, régimen, tipo, fechas), asignación familiar y promedio de variables (planillas/novedades), meses desde último depósito CTS (calendario may/nov), meses de grati del semestre, `VacacionPeriodo`, pendientes (sueldo del mes prorrateado + `HorasExtra` con `incluidoEnNomina=false`). `TERMINO_CONTRATO` valida `fechaFin` del contrato. |
| `PUT /ceses/:id/datos` | manage | Corrige el snapshot (estados BORRADOR/CALCULADA; editar regresa a BORRADOR). |
| `POST /ceses/:id/calcular` | manage | Ejecuta el motor con parámetros normativos vigentes a `fechaCese` → CALCULADA. Recalculable. |
| `POST /ceses/:id/aprobar` | approve | Valida completitud por motivo (fallecimiento ⇒ derechohabientes con % que sumen 100; despido ⇒ datos de indemnización). Genera los PDFs, los archiva en el legajo, y en una transacción: estado APROBADA, `Employee.cesado`, vacaciones `LIQUIDADO`. Si la generación/subida de PDFs falla, el estado no avanza (reintento seguro). |
| `POST /ceses/:id/pagar` | approve | Registra `pagadoEn`; si excede `fechaLimitePago` marca `pagoFueraDePlazo=true` (queda en auditoría). |
| `POST /ceses/:id/anular` | approve | Motivo obligatorio; prohibido desde PAGADA; desde APROBADA revierte empleado y vacaciones. |
| `GET /ceses` / `GET /ceses/:id` | read | Listado con semáforo 48h / detalle con desglose y documentos. |
| `GET /vacaciones/periodos?employeeId=` · `POST /vacaciones/periodos` · `PUT /vacaciones/periodos/:id` | vacation.* | Récord vacacional. |

## 6. Documentos generados (al aprobar)

Generación server-side con **pdfkit** (sin dependencias de red), archivado vía
`DocumentsService` existente (MinIO, checksum, versionado, soft-delete):

1. **Hoja de Liquidación de Beneficios Sociales** — desglose completo con base
   legal por línea, datos del empleador/trabajador, período de servicios, firmas.
2. **Certificado de Trabajo** — fechas y cargo.
3. **Constancia de Cese** — para el retiro de CTS del banco.
4. **Certificado de Retención de 5ta Categoría** — acumulado del año desde
   `PlanillaDetalle` + la retención de la propia liquidación.

No generados por el sistema (slots de subida manual al legajo): carta de renuncia
(`CARTA_RENUNCIA`) y examen médico de retiro (`EXAMEN_MEDICO_RETIRO`, Ley 29783 —
la UI muestra recordatorio; su retención de 20 años queda para las políticas de
retención del backlog). Firma digital certificada (Ley 27269): fuera de alcance,
backlog declarado.

## 7. Frontend (Next.js, patrón actual)

- **`/liquidaciones`** (sidebar con `termination.read`):
  - Listado de ceses: empleado, motivo, estado, neto, semáforo del plazo de 48h
    (verde/ámbar/rojo/vencido).
  - Wizard de cese en 3 pasos: (1) empleado + motivo + fecha, con campos
    condicionales (grati extraordinaria en mutuo disenso; derechohabientes en
    fallecimiento); (2) revisión del snapshot pre-llenado, todo editable;
    (3) desglose ingresos/deducciones/neto con base legal por línea.
  - Acciones por estado: Calcular → Aprobar → Registrar pago; Anular; descarga
    de los 4 documentos.
- **`/vacaciones`** (con `vacation.read`): tabla del récord por empleado con
  períodos, días ganados/gozados/pendientes y alerta de vencimiento próximo a
  indemnización.

## 8. Errores y validaciones

| Caso | Respuesta |
|---|---|
| Empleado ya cesado o con cese activo | 409 |
| `fechaCese` anterior al inicio del contrato vigente | 400 |
| `TERMINO_CONTRATO` con contrato indeterminado (sin `fechaFin`) | 400 |
| Transición de estado inválida | 409 |
| Aprobar con datos incompletos (según motivo) | 422 con lista de faltantes |
| Fallo al generar/subir PDF | 502; el estado no avanza; reintento seguro |
| Derechohabientes con porcentajes ≠ 100% | 422 |

## 9. Testing (TDD — patrón del proyecto)

- **Calculadores** (specs puros): renuncia régimen general; MYPE micro (CTS/grati = 0)
  y pequeña (50%); despido indeterminado con y sin tope de 12; despido a plazo fijo;
  topes MYPE (120/90 días); mutuo disenso con grati extraordinaria; fallecimiento;
  indemnización vacacional (período vencido > 1 año) y su exclusión por flag;
  cese antes del depósito CTS; ingreso a mitad de mes; matriz de afectación
  (deducciones correctas por concepto); redondeos a 2 decimales.
- **`TerminationService`** (mocks de Prisma): pre-llenado del snapshot, transiciones
  válidas/inválidas, validaciones por motivo, efectos de aprobar/anular, plazo 48h.
- **`VacationsService`**: generación de períodos por aniversario, estados.
- Barra de salida: 208 tests existentes intactos + nuevos en verde; `tsc` y
  `next build` en verde.

## 10. Fuera de alcance (explícito)

- Firma digital certificada de los documentos (backlog documental).
- Notificaciones/cron de alerta del plazo de 48h (el semáforo es solo UI en v1).
- Integración del pago de la liquidación al telecrédito (v1 registra el pago manual).
- Programación de vacaciones y flujo de aprobación de goce (solo récord manual en v1).
- Regímenes especiales no contemplados (construcción civil, hogar, pesquero...).
