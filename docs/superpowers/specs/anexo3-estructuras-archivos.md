# Anexo 3 — Estructura de los archivos de importación de T-Registro y PLAME

Fuente: `docs/390199-anexo3_estructuras_archivos_importacion_jul23_0.xlsx` (documento oficial SUNAT/MTPE, versión jul-2023). Transcripción íntegra campo por campo de las 31 estructuras de archivo `.txt` (delimitado por `|`) que el PVS de SUNAT acepta para carga masiva en **T-Registro** y **PLAME**. Este documento resuelve el **punto abierto #1** de `especificaciones-fases.md` (Fase 1): ya no es necesario asumir un layout — este es el layout oficial vigente a la fecha del anexo.

Convención general para todas las estructuras (aplica salvo excepción indicada):
- Campos separados por el carácter `|`.
- Fechas en formato `dd/mm/aaaa`.
- Montos numéricos sin comas; si llevan decimales, con punto decimal y máximo 2 dígitos.
- `###########` en el nombre de archivo = RUC del empleador declarante.

## Clasificación de las 31 estructuras

| Uso | Estructuras |
|---|---|
| **T-Registro** (altas/bajas/modificaciones de empleador, trabajadores, establecimientos) | E1, E2, E3, E4, E5, E6, E9, E10, E11, E17, E23, E29, E30, E31 |
| **Derechohabientes** (uso exclusivo, altas/bajas) | E13 (alta), E24 (baja) |
| **PLAME** (planilla mensual — ingresos, tributos, descuentos, condiciones) | E7, E12, E14, E15, E18, E19, E20, E21, E22, E25, E26, E27, E28 |

---

## E1 — Establecimientos Propios del Empleador

Identifica establecimientos con actividad de riesgo SCTR. Solo se elabora si el empleador respondió que desarrolla actividades de riesgo SCTR.

**Archivo:** `RP_###########.esp`

| Nro | Descripción | Tipo | Long. máx | Observaciones |
|---|---|---|---|---|
| 1 | Código de establecimiento | Texto | 4 | Debe existir en el RUC (consultar en "Consulta RUC" de SUNAT Virtual) |
| 2 | Centro de riesgo | Texto | 1 | 0 = No es Centro de Riesgo / 1 = Es Centro de Riesgo |

Importable desde Registro del Empleador del T-Registro.

---

## E2 — Empleadores a quienes destaco o desplazo personal

Dos sub-estructuras dentro del mismo archivo lógico.

**Archivo 1:** `RP_###########.edd` — empleador destino y servicio prestado

| Nro | Descripción | Tipo | Long. máx | Observaciones |
|---|---|---|---|---|
| 1 | RUC del empleador a quien destaco o desplazo personal | Texto | 11 | Solo si es domiciliado |
| 2 | Servicio prestado al empleador al que destaco o desplazo | Texto | 6 | Ver Tabla 1 |
| 3 | Fecha de inicio de la prestación del servicio | Fecha | - | dd/mm/aaaa |
| 4 | Fecha de fin de la prestación del servicio | Fecha | - | dd/mm/aaaa |

**Archivo 2:** `RP_###########.ldd` — establecimiento de destaque y riesgo SCTR

| Nro | Descripción | Tipo | Long. máx | Observaciones |
|---|---|---|---|---|
| 1 | RUC del empleador a quien destaco o desplazo personal | Texto | 11 | Solo empleador domiciliado |
| 2 | Código del establecimiento del empleador a donde destaco/desplazo | Texto | 4 | Debe existir en el RUC del empleador destino; si no existe, no se carga |
| 3 | Indicador si personal desarrollará actividad de riesgo SCTR | Texto | 1 | 0 = No / 1 = Sí |

Importante: primero debe importarse el archivo `.edd` (empleadores/servicio) antes que `.ldd`.

---

## E3 — Empleadores que me destacan o desplazan personal

**Archivo:** `RP_###########.med`

| Nro | Descripción | Tipo | Long. máx | Observaciones |
|---|---|---|---|---|
| 1 | RUC del empleador que me destaca o desplaza | Texto | 11 | Debe existir en Padrón RUC |
| 2 | Servicio recibido del empleador que me destaca o desplaza | Texto | 6 | Ver Tabla 1 |
| 3 | Fecha de inicio de la prestación del servicio | Fecha | - | dd/mm/aaaa |
| 4 | Fecha de fin de la prestación del servicio | Fecha | - | dd/mm/aaaa |

---

## E4 — Datos personales (trabajador / pensionista / personal en formación / personal de terceros)

**Archivo:** `RP_###########.ide`

| Nro | Descripción | Tipo | Long. máx | Observaciones |
|---|---|---|---|---|
| 1 | Tipo de documento (TD) | Texto | 2 | Ver Tabla 3. Obligatorio |
| 2 | N° de documento | Texto | 15 | Obligatorio |
| 3 | País emisor del documento | Texto | 3 | Ver Tabla 26. Obligatorio si TD = 07 (Pasaporte) o 24 (doc. extranjero) |
| 4 | Fecha de nacimiento | Fecha | - | dd/mm/aaaa. Obligatorio |
| 5 | Apellido paterno | Texto | 40 | Si TD=01 (DNI), validado contra RENIEC |
| 6 | Apellido materno | Texto | 40 | |
| 7 | Nombres | Texto | 40 | |
| 8 | Sexo | Texto | 1 | 1=masculino / 2=femenino. Obligatorio |
| 9 | Nacionalidad | Texto | 4 | Ver Tabla 4. Obligatorio para TD 04 y 07 |
| 10 | Teléfono — código larga distancia nacional | Texto | 3 | Ver Tabla 29. No vigente desde 01/03/2018 |
| 11 | Teléfono — número (móvil) | Texto | 9 | Obligatorio para altas desde 01/03/2018 |
| 12 | Correo electrónico | Texto | 50 | Obligatorio para altas desde 01/03/2018 |
| 13 | Dirección 1 — tipo de vía | Texto | 2 | Ver Tabla 5 |
| 14 | Dirección 1 — nombre de vía | Texto | 20 | |
| 15 | Dirección 1 — número de vía | Texto | 4 | |
| 16 | Dirección 1 — departamento | Texto | 4 | |
| 17 | Dirección 1 — interior | Texto | 4 | |
| 18 | Dirección 1 — manzana | Texto | 4 | |
| 19 | Dirección 1 — lote | Texto | 4 | |
| 20 | Dirección 1 — kilómetro | Texto | 4 | |
| 21 | Dirección 1 — block | Texto | 4 | |
| 22 | Dirección 1 — etapa | Texto | 4 | |
| 23 | Dirección 1 — tipo de zona | Texto | 2 | Ver Tabla 6 |
| 24 | Dirección 1 — nombre de zona | Texto | 20 | |
| 25 | Dirección 1 — referencia | Texto | 40 | |
| 26 | Dirección 1 — UBIGEO | Texto | 6 | Ver Tabla 28 |
| 27–40 | Dirección 2 — (mismos 14 sub-campos que Dirección 1: tipo de vía … UBIGEO) | — | — | Dirección 2 es opcional |
| 41 | Indicador Centro Asistencial EsSalud | Texto | 1 | Solo si se registran 2 direcciones. "1" = usar Dirección 1, "2" = usar Dirección 2 para asignación de centro EsSalud |

Notas: si TD=01 y hay datos en RENIEC, SUNAT valida/prevalece apellidos, nombres, sexo, estado civil y Dirección 1 contra RENIEC.

---

## E5 — Datos del Trabajador

**Archivo:** `RP_###########.tra`

| Nro | Descripción | Tipo | Long. máx | Observaciones |
|---|---|---|---|---|
| 1 | Tipo de documento del trabajador (TD) | Texto | 2 | Ver Tabla 3. Solo 01, 04, 07, 09, 22, 23, 24 |
| 2 | N° de documento del trabajador | Texto | 15 | |
| 3 | País emisor del documento | Texto | 3 | Ver Tabla 26. Obligatorio TD 07/24 |
| 4 | Régimen Laboral (1) | Texto | 2 | Ver Tabla 33 |
| 5 | Situación Educativa (2) | Texto | 2 | Ver Tabla 9. No aplica TT 23, 66, 71 |
| 6 | Ocupación | Texto | 6 | Ver Tabla 10 (S.Público) / Tabla 30 (S.Privado). No aplica TT 23, 66, 71 |
| 7 | Discapacidad | Texto | 1 | 1=Sí/0=No. No aplica TT 66 |
| 8 | CUSPP | Texto | 12 | Solo afiliados a AFP |
| 9 | SCTR Pensión | Texto | 1 | 0=Ninguno/1=ONP/2=Cía privada. No aplica TT 88, 98 |
| 10 | Tipo de contrato de trabajo/condición laboral (1) | Texto | 2 | Ver Tabla 12 |
| 11 | Sujeto a régimen alternativo/acumulativo/atípico de jornada | Texto | 1 | 1=Sí/0=No. No aplica TT 23, 66, 71 |
| 12 | Sujeto a jornada de trabajo máxima | Texto | 1 | 1=Sí/0=No. No aplica TT 23, 66, 71 |
| 13 | Sujeto a horario nocturno | Texto | 1 | 1=Sí/0=No. No aplica TT 23, 66, 71 |
| 14 | Es sindicalizado (1) | Texto | 1 | 1=Sí/0=No |
| 15 | Periodicidad de la remuneración o ingreso (1) | Texto | 1 | Ver Tabla 13 |
| 16 | Monto de remuneración básica inicial (D.Leg. 728) | Numérico | 7,2 | Solo altas posteriores a entrada del T-Registro |
| 17 | Situación | Texto | 2 | Ver Tabla 15 |
| 18 | Rentas de 5ta exoneradas (Art.19 inc. e) LIR) | Texto | 1 | 1=Sí/0=No. No aplica TT 23, 66, 67, 71 |
| 19 | Situación especial del trabajador | Texto | 1 | Ver Tabla 35. No aplica TT 23, 66, 71 |
| 20 | Tipo de pago (1) | Texto | 1 | Ver Tabla 16 |
| 21 | Categoría ocupacional del trabajador | Texto | 2 | Ver Tabla 24. No aplica TT 19, 20, 21, 23, 66, 71, 88, 89, 90, 91, 98 |
| 22 | Convenio para evitar doble tributación | Texto | 1 | Ver Tabla 25. No aplica TT 23, 66, 67, 71 |
| 23 | N° de RUC | Texto | 11 | Solo CAS (TT=67) |

(1) No aplica a TT 23, 66, 71, 73. (2) Antes "Nivel Educativo"; vigente desde 01/07/2014.

**Mapeo a nuestro modelo:** campos 4, 10 → `CONTRATO.regimen_laboral` / `CONTRATO.tipo_contrato`; campo 9 → `REGIMEN_PENSIONARIO`; campo 16 → remuneración inicial del `CONTRATO`.

---

## E6 — Datos del Pensionista

**Archivo:** `RP_###########.pen`

| Nro | Descripción | Tipo | Long. máx | Observaciones |
|---|---|---|---|---|
| 1 | Tipo de documento del pensionista (TD) | Texto | 2 | Ver Tabla 3. Solo 01, 04, 07 |
| 2 | N° de documento del pensionista | Texto | 15 | |
| 3 | País emisor del documento | Texto | 3 | Ver Tabla 26. Solo TD 07 |
| 4 | Tipo de pensionista | Texto | 2 | Ver Tabla 8. Solo tipos 24 y 26 |
| 5 | Régimen pensionario | Texto | 2 | Ver Tabla 11 |
| 6 | CUSPP | Texto | 12 | Solo pensionistas AFP. Opcional |
| 7 | Tipo de pago | Texto | 1 | Ver Tabla 16 |

Se declara pensionista a quien recibe pensión y es asegurado regular EsSalud.

---

## E7 — Prestadores de Servicios con Rentas de 4ta Categoría

**Archivo:** `ffffaaaamm###########.ps4` (ffff=0601, aaaa=año, mm=mes)

| Nro | Descripción | Tipo | Long. máx | Observaciones |
|---|---|---|---|---|
| 1 | Tipo de documento del PS-4ta | Texto | 2 | Ver Tabla 3. Domiciliado → tipo 06 (RUC) |
| 2 | Número de documento del PS-4ta | Texto | 15 | RUC: máx 11 dígitos |
| 3 | Apellido paterno | Texto | 40 | |
| 4 | Apellido materno | Texto | 40 | |
| 5 | Nombres | Texto | 40 | |
| 6 | Domiciliado | Texto | 1 | 1=Domiciliado / 2=No domiciliado |
| 7 | Convenio para evitar doble tributación | Texto | 1 | Ver Tabla 25 |

No aplica TD "11" (Partida de Nacimiento).

---

## E9 — Datos del Personal en Formación (modalidad formativa laboral y otros)

**Archivo:** `RP_###########.pfl`

| Nro | Descripción | Tipo | Long. máx | Observaciones |
|---|---|---|---|---|
| 1 | Tipo de documento | Texto | 2 | Ver Tabla 3 |
| 2 | N° de documento | Texto | 15 | |
| 3 | País emisor del documento | Texto | 3 | Ver Tabla 26. Obligatorio TD 07/24 |
| 4 | Tipo de modalidad formativa laboral | Texto | 2 | Ver Tabla 18 |
| 5 | Seguro Médico (1) | Texto | 1 | 1=ESSALUD / 2=Seguro Privado |
| 6 | Situación Educativa (2) | Texto | 2 | Ver Tabla 9 |
| 7 | Ocupación (1) | Texto | 6 | Ver Tabla 10 |
| 8 | Madre con responsabilidad familiar (1) | Texto | 1 | 1=Sí/0=No. Solo sexo femenino |
| 9 | Discapacidad (1) | Texto | 1 | 1=Sí/0=No |
| 10 | Tipo de Centro de Formación Profesional (1) | Texto | 1 | 1=Centro Educ./2=Universidad/3=Instituto/4=Otros |
| 11 | Sujeto a horario nocturno (1) | Texto | 1 | 1=Sí/0=No |

(1) No aplica modalidad SECIGRA. (2) Antes "Nivel Educativo"; vigente desde 01/07/2014.

---

## E10 — Datos del Personal de Terceros

**Archivo:** `RP_###########.ter`

| Nro | Descripción | Tipo | Long. máx | Observaciones |
|---|---|---|---|---|
| 1 | Tipo de documento | Texto | 2 | Ver Tabla 3. Solo 01, 04, 07, 09, 22, 23, 24 |
| 2 | N° documento | Texto | 15 | |
| 3 | País emisor del documento | Texto | 3 | Ver Tabla 26. Obligatorio TD 07/24 |
| 4 | RUC del empleador que me destaca/desplaza personal | Texto | 11 | Debe estar habilitado en "Empleadores que me destacan" |
| 5 | SCTR Pensión | Texto | 1 | 1=ONP / 2=Seguro Privado |

---

## E11 — Datos de Períodos

**Archivo:** `RP_###########.per`

| Nro | Descripción | Tipo | Long. máx | Observaciones |
|---|---|---|---|---|
| 1 | Tipo de documento | Texto | 2 | Ver Tabla 3 |
| 2 | N° de documento | Texto | 15 | |
| 3 | País emisor del documento | Texto | 3 | Ver Tabla 26 |
| 4 | Categoría | Texto | 1 | 1=Trabajador / 2=Pensionista / 4=Personal de Terceros / 5=Personal en Formación |
| 5 | Tipo de registro | Texto | 1 | 1=Período de vínculo/pensionista/formación/destaque · 2=Tipo de trabajador · 3=Régimen Aseguramiento Salud · 4=Régimen pensionario · 5=SCTR Salud |
| 6 | Fecha de inicio o reinicio | Fecha | - | dd/mm/aaaa |
| 7 | Fecha de fin | Fecha | - | dd/mm/aaaa |
| 8 | Indicador del tipo de registro a dar de alta/baja | Texto | 2 | Según tipo de registro (campo 5): motivo fin (Tabla 17) / tipo trabajador (Tabla 8) / régimen salud (Tabla 32) / régimen pensionario (Tabla 11) / SCTR salud (1=EsSalud, 2=EPS) |
| 9 | EPS/Servicios Propios | Texto | 1 | Solo si régimen salud es tipo 01 o 03. Ver Tabla 14 |

**Relevancia:** esta estructura es la fuente de las fechas de alta/baja de `CONTRATO`, cambios de `REGIMEN_PENSIONARIO`, y motivo de cese — insumo clave para `LIQUIDACION`.

---

## E12 — Trabajador: Otras Rentas de 5ta Categoría (período y regularización)

Dos sub-estructuras.

**Archivo 1:** `ffffaaaamm###########.or5` — rentas de 5ta de otros empleadores en el ejercicio

| Nro | Descripción | Tipo | Long. máx | Observaciones |
|---|---|---|---|---|
| 1 | Tipo de documento del trabajador | Texto | 2 | Ver Tabla 3. Solo 01, 04, 07, 09, 22, 23, 24, 26 |
| 2 | Número de documento del trabajador | Texto | 15 | |
| 3 | RUC del otro empleador | Texto | 11 | |
| 4 | Monto de la renta de 5ta percibida en el otro empleador | Numérico | 7,2 | |

No aplica TT 23, 66, 67, 71, 73 (Tabla 8).

**Archivo 2:** `ffffaaaamm###########.REG` — regularización de renta de 5ta del ejercicio anterior (solo enero/febrero)

| Nro | Descripción | Tipo | Long. máx | Observaciones |
|---|---|---|---|---|
| 1 | Tipo de documento del trabajador | Texto | 2 | Ver Tabla 3. Solo 01, 04, 07, 09 |
| 2 | Número de documento del trabajador | Texto | 15 | |
| 3 | RUC del otro empleador | Texto | 11 | |
| 4 | Monto de renta de 5ta del otro empleador (ejercicio anterior, regularización) | Numérico | 7,2 | |

Si se usa `.REG`, debe declararse también la casilla 621 (Renta 5ta Regul. Ejerc. Anterior), pudiendo ser 0.

---

## E13 — Derechohabientes: ALTA (uso exclusivo Registro de Derechohabientes)

**Archivo:** `RD_RRRRRRRRRRR_DDMMAAAA_ALTA.TXT`

| Nro | Descripción | Tipo | Long. máx | Observaciones |
|---|---|---|---|---|
| 1 | Tipo de documento del trabajador/pensionista | Texto | 2 | Ver Tabla 3. Solo 01, 04, 07 |
| 2 | Número de documento del trabajador/pensionista | Texto | 15 | |
| 3 | Tipo de documento del derechohabiente | Texto | 2 | Ver Tabla 3. Solo 01, 04, 07 |
| 4 | Número de documento del derechohabiente | Texto | 15 | |
| 5 | País emisor del documento | Texto | 3 | Ver Tabla 26 |
| 6 | Fecha de nacimiento | Fecha | - | dd/mm/aaaa |
| 7 | Apellido paterno del derechohabiente | Texto | 40 | |
| 8 | Apellido materno del derechohabiente | Texto | 40 | |
| 9 | Nombres del derechohabiente | Texto | 40 | |
| 10 | Sexo | Texto | 1 | 1=Masculino/2=Femenino |
| 11 | Vínculo familiar | Texto | 2 | Ver Tabla 19 |
| 12 | Tipo de documento que acredita el vínculo | Texto | 2 | Ver Tabla 27 |
| 13 | N° de documento que acredita el vínculo | Texto | 20 | Obligatorio para Concubino(a) e Hijo mayor incapacitado permanente |
| 14 | Mes de concepción | Texto | 6 | Solo Gestante. Formato mmaaaa |
| 15–28 | Dirección 1 del derechohabiente (tipo vía, nombre vía, número, depto, interior, manzana, lote, km, block, etapa, tipo zona, nombre zona, referencia, UBIGEO) | — | — | Solo si el derechohabiente se identifica con Pasaporte, Carné de Extranjería o DNI de menor de edad |
| 29–42 | Dirección 2 del derechohabiente (mismos 14 sub-campos) | — | — | Opcional para todos los derechohabientes |
| 43 | Indicador Centro Asistencial EsSalud | Texto | 1 | "1"=Dirección 1 / "2"=Dirección 2, si registra 2 direcciones |
| 44 | Teléfono — código de ciudad (larga distancia nacional) | Texto | 2 | Ver Tabla 29 |
| 45 | Teléfono — número | Texto | 10 | |
| 46 | Correo electrónico | Texto | 50 | Debe contener "@" |

---

## E14 — Trabajador: Datos de la Jornada Laboral

**Archivo:** `ffffaaaamm###########.jor`

| Nro | Descripción | Tipo | Long. máx | Observaciones |
|---|---|---|---|---|
| 1 | Tipo de documento del trabajador | Texto | 2 | Ver Tabla 3. Solo 01, 04, 07, 09, 22, 23, 24, 26 |
| 2 | Número de documento del trabajador | Texto | 15 | |
| 3 | N° de horas ordinarias trabajadas | Numérico | 3 | Máximo 360 |
| 4 | N° de minutos ordinarios trabajados | Numérico | 2 | Máximo 59 |
| 5 | N° de horas en sobretiempo trabajadas | Numérico | 3 | Máximo 360 |
| 6 | N° de minutos en sobretiempo trabajados | Numérico | 2 | Máximo 59 |

No aplica TT 66, 71, 88, 98 (Tabla 8).

**Relevancia directa:** esta es la estructura oficial que consume la agregación mensual de `MARCACION`/`HORA_EXTRA` de la Fase 2 para poblar el PLAME.

---

## E15 — Trabajador: Días Subsidiados y Otros No Laborados

**Archivo:** `ffffaaaamm###########.snl`

| Nro | Descripción | Tipo | Long. máx | Observaciones |
|---|---|---|---|---|
| 1 | Tipo de documento del trabajador | Texto | 2 | Ver Tabla 3. Solo 01, 04, 07, 09, 22, 23, 24, 26 |
| 2 | Número de documento del trabajador | Texto | 15 | |
| 3 | Tipo de suspensión de la relación laboral | Texto | 2 | Ver Tabla 21. Tipos 21 y 22 = días subsidiados por EsSalud; el resto = no laborados no subsidiados |
| 4 | Número de días de suspensión | Numérico | 2 | Mínimo 0, máximo 31 según período |

Tipos 21/22 solo si Régimen de Aseguramiento de Salud (Tabla 32) es 00, 01, 02, 03 o 04. No aplica TT 66, 88, 98.

---

## E17 — Establecimientos donde labora el Trabajador

**Archivo:** `RP_###########.est`

| Nro | Descripción | Tipo | Long. máx | Observaciones |
|---|---|---|---|---|
| 1 | Tipo de documento del trabajador | Texto | 2 | Ver Tabla 3 |
| 2 | Número de documento del trabajador | Texto | 15 | |
| 3 | País emisor del documento | Texto | 3 | Ver Tabla 26. Obligatorio TD 07/24 |
| 4 | RUC propio o del empleador a quien destaco/desplazo | Texto | 11 | RUC propio si establecimiento propio; RUC del tercero si es de terceros |
| 5 | Código de establecimiento | Texto | 4 | Debe existir previamente en el RUC/en "Establecimientos donde destaco" |

---

## E18 — Trabajador: Detalle de Ingresos, Tributos y Descuentos

Estructura **más crítica para el motor de nómina** — es el archivo de la Planilla Mensual (PLAME) que declara cada concepto pagado/descontado por trabajador.

**Archivo:** `ffffaaaamm###########.rem`

| Nro | Descripción | Tipo | Long. máx | Observaciones |
|---|---|---|---|---|
| 1 | Tipo de documento del trabajador | Texto | 2 | Ver Tabla 3. Solo 01, 04, 07, 09, 22, 23, 24, 26 |
| 2 | Número de documento del trabajador | Texto | 15 | |
| 3 | Código de concepto remunerativo y/o no remunerativo | Numérico | 4 | Ver Tabla 22. Excluye códigos 0100, 0200, 0300, 0400, 0500, 0600, 0603, 0604, 0607, 0610, 0612, 0616, 0800, 0802, 0804, 0806, 0808 (son totales calculados, no se declaran) |
| 4 | Monto devengado | Numérico | 7,2 | Obligatorio si hay monto pagado/descontado |
| 5 | Monto pagado/descontado | Numérico | 7,2 | Obligatorio si hay monto devengado |

Reglas de negocio embebidas (validar en `PlanillaExporter`):
- Códigos "700s" (descuentos) y 601, 602, 605, 606, 608, 609, 611, 613, 614, 615, 617, 618, 801, 803, 805, 807, 809, 810, 811: solo se declara el monto pagado/descontado.
- 0601, 0606, 0608, 0609: requieren régimen pensionario = Sistema Privado de Pensiones (AFP, Tabla 11 tipos 21–25).
- 0613: requiere Régimen Pensionario D.Ley 20530 (Tabla 11 tipo 3).
- 0614: requiere Régimen del Servicio Diplomático (SDR, Tabla 11 tipo 13).
- 0615: requiere Régimen Militar-Policial (Tabla 11 tipo 10/11).
- 126, 127: solo si el empleador es microempresa inscrita en REMYPE.
- 617: monto devengado = base de cálculo, monto pagado = cuota retenida (remuneraciones devengadas hasta abril 2012).
- 618: solo trabajadores CAS.

**Mapeo a nuestro modelo:** cada fila de este archivo = un `CONCEPTO.codigo` (Tabla 22, ver `anexo2-tablas-parametricas.md`) resuelto contra `PLANILLA_DETALLE.conceptos_calculados` del trabajador y período. `CONCEPTO.afecto_a` (jsonb) debe incluir el código SUNAT de Tabla 22 como campo (`codigo_sunat`) para poder generar esta línea directamente sin tabla de mapeo adicional.

---

## E19 — Pensionista: Detalle de Ingresos, Tributos y Descuentos

**Archivo:** `ffffaaaamm###########.pen`

| Nro | Descripción | Tipo | Long. máx | Observaciones |
|---|---|---|---|---|
| 1 | Tipo de documento del pensionista | Texto | 2 | Ver Tabla 3. Solo 01, 04, 07 |
| 2 | Número de documento del pensionista | Texto | 15 | |
| 3 | Código de concepto o ingreso | Numérico | 4 | Ver Tabla 22. Excluye 0100,0200,0300,0400,0500,0600,0601,0602,0604,0605,0606,0607,0608,0609,0610,0612,0613,0614,0700,0702,0704,0705,0800,0801,0802,0803,0804,0805,0806,0807,0808,0810,0811 |
| 4 | Monto devengado | Numérico | 7,2 | Obligatorio si hay monto pagado/descontado |
| 5 | Monto pagado/descontado | Numérico | 7,2 | Obligatorio si hay monto devengado |

Códigos 703, 706, 707, 603, 611, 809: solo se declara el monto pagado/descontado.

---

## E20 — Prestador de Servicios 4ta Categoría: Detalle de Comprobantes

**Archivo:** `ffffaaaamm###########.4ta`

| Nro | Descripción | Tipo | Long. máx | Observaciones |
|---|---|---|---|---|
| 1 | Tipo de documento del PS-4ta | Texto | 2 | Ver Tabla 3. Domiciliado → tipo 06 (RUC) |
| 2 | Número de documento del PS-4ta | Texto | 15 | RUC: máx 11 dígitos |
| 3 | Tipo de comprobante emitido | Texto | 1 | Ver Tabla 23 |
| 4 | Serie del comprobante | Alfanumérico | 4 | Si es Recibo por Honorarios o Nota de Crédito |
| 5 | Número del comprobante | Texto | 8 | Si es Recibo por Honorarios o Nota de Crédito |
| 6 | Monto total del servicio | Numérico | 12,2 | |
| 7 | Fecha de emisión | Fecha | - | dd/mm/aaaa |
| 8 | Fecha de pago | Fecha | - | dd/mm/aaaa. Debe ser ≥ fecha de emisión y corresponder al período declarado |
| 9 | Indicador de Retención de 4ta Categoría | Texto | 1 | 1=Sí/0=No |
| 10 | Indicador de Retención a Régimen Pensionario | Texto | 1 | 1=ONP / 2=AFP / 3=Sin retención (obligatorio desde 08/2013) |
| 11 | Importe del aporte al Régimen Pensionario | Numérico | 7,2 | Obligatorio solo si campo 10 = 1 o 2; vacío si campo 10 = 3 |

No aplica TD "11" (Partida de Nacimiento).

---

## E21 — Personal en Formación: Monto Pagado

**Archivo:** `ffffaaaamm###########.for`

| Nro | Descripción | Tipo | Long. máx | Observaciones |
|---|---|---|---|---|
| 1 | Tipo de documento | Texto | 2 | Ver Tabla 3 |
| 2 | Número de documento | Texto | 15 | |
| 3 | Monto pagado | Numérico | 7,2 | |

---

## E22 — Personal de Terceros: SCTR EsSalud

**Archivo:** `ffffaaaamm###########.pte`

| Nro | Descripción | Tipo | Long. máx | Observaciones |
|---|---|---|---|---|
| 1 | Tipo de documento del personal de terceros | Texto | 2 | Ver Tabla 3. Solo 01, 04, 07, 09, 22, 23, 24, 26 |
| 2 | Número de documento | Texto | 15 | |
| 3 | Tasa SCTR-EsSalud | Numérico | 3,2 | 0.00–100.00, solo si SCTR Salud = 1 (EsSalud) |
| 4 | Base de cálculo SCTR-EsSalud | Numérico | 7,2 | |

---

## E23 — Lugar de Formación / Destaque (Personal en Formación y Personal de Terceros)

**Archivo:** `RP_###########.lug`

| Nro | Descripción | Tipo | Long. máx | Observaciones |
|---|---|---|---|---|
| 1 | Tipo de documento | Texto | 2 | Ver Tabla 3 |
| 2 | Número de documento | Texto | 15 | |
| 3 | País emisor del documento | Texto | 3 | Ver Tabla 26. Obligatorio TD 07/24 |
| 4 | Categoría | Texto | 1 | 4=Personal de Terceros / 5=Personal en Formación |
| 5 | Código de establecimiento (solo propios) | Texto | 4 | |

---

## E24 — Derechohabientes: BAJA

**Archivo:** `RD_RRRRRRRRRRR_DDMMAAAA_BAJA.TXT`

| Nro | Descripción | Tipo | Long. máx | Observaciones |
|---|---|---|---|---|
| 1 | Tipo de documento del trabajador/pensionista | Texto | 2 | Ver Tabla 3. Solo 01, 04, 07 |
| 2 | Número de documento del trabajador/pensionista | Texto | 15 | |
| 3 | Tipo de documento del derechohabiente | Texto | 2 | Ver Tabla 3. Solo 01, 04, 07 |
| 4 | Número de documento del derechohabiente | Texto | 15 | |
| 5 | País emisor del documento | Texto | 3 | Ver Tabla 26 |
| 6 | Fecha de nacimiento | Fecha | - | dd/mm/aaaa |
| 7 | Apellido paterno del derechohabiente | Texto | 40 | |
| 8 | Apellido materno del derechohabiente | Texto | 40 | |
| 9 | Nombres del derechohabiente | Texto | 40 | |
| 10 | Vínculo familiar | Texto | 2 | Ver Tabla 19 |
| 11 | Fecha de baja | Fecha | - | |
| 12 | Motivo de baja | Texto | 2 | Ver Tabla 20 |

---

## E25 — Trabajador: Tasas SCTR-EsSalud y/o Convenio IES

**Archivo:** `ffffaaaamm###########.tas`

| Nro | Descripción | Tipo | Long. máx | Observaciones |
|---|---|---|---|---|
| 1 | Tipo de documento del trabajador | Texto | 2 | Ver Tabla 3. Solo 01, 04, 07, 09, 22, 23, 24, 26 |
| 2 | Número de documento del trabajador | Texto | 15 | |
| 3 | Indicador SCTR-EsSalud o Convenio IES | Texto | 1 | 1=SCTR-EsSalud / 2=Convenio IES |
| 4 | Tasa | Numérico | 3,2 | 0.00–100.00 |

Tasa SCTR-EsSalud ("1"): requiere que el trabajador tenga registrado aporte a SCTR-EsSalud en T-Registro y Régimen de Salud tipo 00–04 (Tabla 32). Tasa IES: requiere que el empleador la tenga registrada en el módulo Empleadores del PLAME.

---

## E26 — Trabajador: Otras Condiciones

**Archivo:** `ffffaaaamm###########.toc`

| Nro | Descripción | Tipo | Long. máx | Observaciones |
|---|---|---|---|---|
| 1 | Tipo de documento del trabajador | Texto | 2 | Ver Tabla 3. Solo 01, 04, 07, 09, 22, 23, 24, 26 |
| 2 | Número de documento del trabajador | Texto | 15 | |
| 3 | Indicador de aporte a Asegura tu Pensión | Texto | 1 | 0=No aporta. **Derogado** (R.S. 223-2017/SUNAT, recaudado solo hasta may-2017) |
| 4 | Indicador de aporte a +Vida Seguro de Accidentes | Texto | 1 | 0=No aporta / 1=A cargo del trabajador / 2=A cargo del empleador (indicador 2 desde 29/09/2022) |
| 5 | Indicador de aporte al Fondo de Derechos Sociales del Artista (FDSA) / retención Régimen Pensionario Ley 29903 | Texto | 1 | Si TT=56 (Artista): 1=CTS+vacaciones+gratificaciones / 2=Solo gratificaciones. Si TT=98: 0=No retiene/1=Sí retiene |
| 6 | Domiciliado | Texto | 1 | 1=Domiciliado / 2=No domiciliado |

Por defecto, si no se registra: indicadores 3 y 4 = "0", indicadores 6 y 5 (si TT=56) = "1".

---

## E27 — Pensionista: Otras Condiciones

**Archivo:** `ffffaaaamm###########.poc`

| Nro | Descripción | Tipo | Long. máx | Observaciones |
|---|---|---|---|---|
| 1 | Tipo de documento del pensionista | Texto | 2 | Ver Tabla 3. Solo 01, 04, 07 |
| 2 | Número de documento del pensionista | Texto | 15 | |
| 3 | Indicador de aporte a +Vida Seguro de Accidentes | Texto | 1 | 1=Aporta/0=No aporta. Solo si Régimen de Salud = 05 (Tabla 32) |

Por defecto "0" si no se registra.

---

## E28 — Trabajador: Semanas Contributivas (pesqueros, Ley 30003)

**Archivo:** `ffffaaaamm###########.sec` (aprobada por R.S. 027-2014/SUNAT)

| Nro | Descripción | Tipo | Long. máx | Observaciones |
|---|---|---|---|---|
| 1 | Tipo de documento del trabajador | Texto | 2 | Ver Tabla 3. Solo 01, 04, 07, 09, 22, 23, 24, 26 |
| 2 | Número de documento del trabajador | Texto | 15 | |
| 3 | Número de semana | Texto | 2 | Según cronograma ONP |
| 4 | Con actividad pesquera o relacionada | Texto | 1 | 1=Sí/0=No |
| 5 | Cargo desempeñado en la semana | Texto | 1 | Si campo 4="1": 1=Patrón, 2=Segundo patrón, 3=Motorista, 4=Segundo motorista, 5=Cocinero, 6=Tripulante, 7=Otra actividad relacionada; si no, nulo |

Solo aplica a afiliados al Régimen Especial de Pensiones para Trabajadores Pesqueros (Tabla 11, código 15).

---

## E29 — Datos de Estudios Concluidos

**Archivo:** `RP_###########.edu` (aprobada por R.M. 107-2014-TR)

| Nro | Descripción | Tipo | Long. máx | Observaciones |
|---|---|---|---|---|
| 1 | Tipo de documento del trabajador (TD) | Texto | 2 | Ver Tabla 3. Solo 01, 04, 07, 09, 22, 23, 24 |
| 2 | N° de documento del trabajador | Texto | 15 | |
| 3 | País emisor del documento | Texto | 3 | Ver Tabla 26. Obligatorio TD 07/24 |
| 4 | Formación Superior Completa (1) | Texto | 2 | Solo si Situación Educativa 11 o 13 |
| 5 | Indicador de educación completa en Institución Educativa del Perú | Texto | 1 | 1=Sí/0=No. No aplica Situación Educativa 01–10, 12. Si "0", campos 6–8 van vacíos (`||`) |
| 6 | Código de la Institución Educativa | Texto | 9 | Ver Tabla 34 |
| 7 | Código de la Carrera | Texto | 6 | Ver Tabla 34 |
| 8 | Año de Egreso | Texto | 4 | A partir de 1950 |

(1) Situación Educativa 14–21 → indicar tipo 13 ("Educación universitaria completa"). No aplica TT 23, 66, 71, 73, 88, 98.

---

## E30 — Datos de Cuenta de Abono de Remuneraciones

Estructura clave para el `BankFileExporter` / telecrédito.

**Archivo:** `RP_###########.cta`

| Nro | Descripción | Tipo | Long. máx | Observaciones |
|---|---|---|---|---|
| 1 | Tipo de documento del trabajador (TD) | Texto | 2 | Ver Tabla 3 |
| 2 | N° de documento del trabajador | Texto | 15 | |
| 3 | País emisor del documento | Texto | 3 | Ver Tabla 26. Obligatorio TD 07/24 |
| 4 | Código de la entidad del sistema financiero | Texto | 3 | Ver Tabla 36 |
| 5 | Número de cuenta donde se abona la remuneración | Texto | 20 | Solo numérico |

Obligatorio cuando el tipo de pago (E5 campo 20) es "Depósito en cuenta". No aplica TT 23, 66, 71, 73.

**Mapeo directo:** `CUENTA_BANCARIA.banco` (código Tabla 36) + `CUENTA_BANCARIA.numero`.

---

## E31 — Afiliación a Organización Sindical de Servidores Públicos

**Archivo:** `RP_###########.aos` (incorporada por R.M. 170-2023-TR)

| Nro | Descripción | Tipo | Long. máx | Observaciones |
|---|---|---|---|---|
| 1 | Tipo de documento de identidad | Texto | 2 | Ver Tabla 3. Solo 01, 04, 07, 09, 22, 23, 24 |
| 2 | N° de documento de identidad | Texto | 15 | |
| 3 | País emisor del documento | Texto | 3 | Ver Tabla 26. Obligatorio TD 07/24 |
| 4 | Categoría | Texto | 1 | Solo 1=Trabajador |
| 5 | Código de la Organización Sindical de Servidores Públicos | Texto | 8 | Ver Tabla 37 |
| 6 | Fecha de Afiliación | Fecha | - | dd/mm/aaaa |
| 7 | Fecha de Desafiliación | Fecha | - | dd/mm/aaaa |

Solo aplica a entidades públicas empleadoras (fuera de alcance de Fase 1 General/MYPE, relevante si se implementa régimen público).

---

## Notas de implementación para `PlanillaExporter` / `BankFileExporter` (Fase 1)

1. El **layout real de T-Registro** para altas de trabajador requiere combinar como mínimo E4 (datos personales) + E5 (datos del trabajador) + E11 (períodos) + E30 (cuenta bancaria, si aplica) — nuestro `PlanillaExporter` de altas debe generar los 4 archivos correlacionados, no uno solo.
2. El **layout real de PLAME mensual** para nuestro alcance de Fase 1 (General + MYPE) requiere como mínimo E14 (jornada laboral, alimentado por Fase 2), E15 (días no laborados/subsidiados), E18 (ingresos/tributos/descuentos — el corazón del cálculo) y E26 (otras condiciones del trabajador).
3. Todos los archivos de **PLAME** exigen que `CONCEPTO.codigo` (nuestro catálogo) tenga una columna `codigo_sunat` de 4 dígitos que mapee 1:1 a la Tabla 22 (ver `anexo2-tablas-parametricas.md`), y que se excluyan explícitamente los códigos de "totales calculados" listados en E18 y E19 al generar la línea de detalle.
4. **Punto abierto #1 cerrado**: el layout ya no requiere validación adicional para la estructura de campos — queda pendiente únicamente confirmar la vigencia normativa de los códigos citados (tasas, exclusiones) al momento de implementar, dado que el anexo indica varias fechas de entrada en vigencia distintas (2012, 2013, 2014, 2017, 2018, 2022, 2023).
