# Validaciones normativas pendientes antes de producción

Documento vivo. Consolida **todo** valor numérico, tasa, ley o código citado en las especificaciones (`especificaciones-fases.md`, `anexo2-tablas-parametricas.md`, `anexo3-estructuras-archivos.md`) que se tomó como "valor de referencia conocido" y que debe confirmarse contra la fuente oficial vigente (SUNAT, MTPE, ONP, SBS) antes de usarse en cálculos de producción. Ninguno de estos valores bloquea el desarrollo — el motor de parámetros (`NORMATIVE_PARAMETER`, Fase 0) está diseñado justamente para no hardcodear nada de esto — pero si se cargan mal en el seed inicial, la nómina calculará incorrecto sin que el sistema lo detecte.

Checklist: marcar cada fila cuando se confirme fuente y vigencia real. No implementar el cálculo correspondiente en Fase 1 sin haber confirmado la fila relacionada.

## A. Tasas y montos que cambian por norma/periodo (van en `NORMATIVE_PARAMETER`)

| Código sugerido | Concepto | Valor de referencia citado en specs | Fuente a validar | Confirmado |
|---|---|---|---|---|
| `UIT` | Unidad Impositiva Tributaria del ejercicio | No se fijó un monto — el seed de Fase 0 debe cargar el valor del año vigente | D.S. anual del MEF | ☐ |
| `RMV` | Remuneración Mínima Vital | No se fijó un monto | D.S. vigente (MTPE) | ☐ |
| `ESSALUD_TASA` | Aporte EsSalud a cargo del empleador | 9% | Ley 26790 / vigente | ☐ |
| `ESSALUD_TASA_EPS` | Tasa reducida EsSalud con convenio EPS | "tasa reducida" (sin % fijo en specs) | Normativa EPS (Ley 26790, reglamento) | ☐ |
| `AFP_APORTE_OBLIGATORIO` | Aporte obligatorio AFP | ~10% (parametrizable, sin cerrar) | SBS / Ley del SPP | ☐ |
| `AFP_COMISION` | Comisión AFP (flujo o mixta) | Variable por administradora (Integra/Horizonte/Profuturo/Prima/Habitat — Tabla 11) | SBS, tarifario vigente por AFP | ☐ |
| `AFP_PRIMA_SEGURO` | Prima de seguro AFP | Variable, con tope de remuneración máxima asegurable | SBS | ☐ |
| `AFP_TOPE_RMA` | Tope de remuneración máxima asegurable (AFP) | No se fijó monto | SBS, boletín trimestral | ☐ |
| `ONP_TASA` | Aporte ONP (D.L. 19990) | 13% | ONP / vigente | ☐ |
| `QUINTA_DEDUCCION_UIT` | Deducción fija Renta 5ta Categoría | 7 UIT | Ley del Impuesto a la Renta, Art. 46 | ☐ |
| `QUINTA_TRAMOS` | Tramos progresivos Renta 5ta Categoría | No se fijaron porcentajes ni tramos en specs | Ley del Impuesto a la Renta (típicamente 8/14/17/20/30%, confirmar tramos y UIT de cada uno) | ☐ |
| `GRATIFICACION_BONIF_EXTRAORD` | Bonificación extraordinaria sobre gratificación | 9% (EsSalud) / 6.75% (EPS) | Ley 30334 | ☐ |
| `HORAS_EXTRA_TASA_25` | Sobretasa horas extra, primeras 2h | 25% | D.S. 007-2002-TR (TUO Ley de Jornada) | ☐ |
| `HORAS_EXTRA_TASA_35` | Sobretasa horas extra, siguientes horas | 35% | D.S. 007-2002-TR | ☐ |
| `HORAS_EXTRA_TASA_FERIADO` | Sobretasa trabajo en feriado/descanso | 100% | D.S. 007-2002-TR | ☐ |
| `ASIGNACION_FAMILIAR_PCT` | Asignación familiar | 10% de la RMV vigente | Ley 25129 | ☐ |
| `UTILIDADES_TASA_INDUSTRIA` | Tasa de utilidades — sector industria | No se fijó % en specs (parametrizable por sector) | D.Leg. 892 y reglamento | ☐ |
| `UTILIDADES_TASA_COMERCIO_SERVICIOS` | Tasa de utilidades — comercio/servicios | No se fijó % en specs | D.Leg. 892 y reglamento | ☐ |
| `UTILIDADES_TASA_OTROS` | Tasa de utilidades — otros sectores | No se fijó % en specs | D.Leg. 892 y reglamento | ☐ |
| `UTILIDADES_TOPE_REM_MENSUALES` | Tope de utilidades por trabajador | 18 remuneraciones mensuales | D.Leg. 892 y reglamento | ☐ |
| `CTS_REMUNERACION_COMPUTABLE` | Fracción de gratificación que integra la remuneración computable de CTS | 1/6 de la gratificación del semestre | D.S. 001-97-TR (TUO Ley de CTS) | ☐ |
| `SCTR_ESSALUD_TASA` | Tasa aportación SCTR-EsSalud | Variable por trabajador, 0.00–100.00 según Tabla 22/estructura E25 (no es un % fijo nacional, es tarifa contratada) | Contrato con asegurador (EsSalud o compañía privada) | ☐ (no es normativo nacional — validar que el modelo lo trate como dato del empleador, no como `NORMATIVE_PARAMETER` nacional) |
| `IES_TASA` | Impuesto Extraordinario de Solidaridad | Derogado por Ley 28378; **se mantiene vigente solo para empresas con Convenio de Estabilidad Jurídica que lo incluya** | Ley 28378 + verificar si el tenant tiene convenio vigente | ☐ — **alto riesgo de mal cálculo si se ignora la excepción** |
| `SIS_MICROEMPRESA` | Régimen SIS para microempresa (Tabla 32, código 21) | Habilitado, sin tasa fija citada en specs | MINSA/SIS convenio microempresa | ☐ |

## B. Leyes y normas citadas cuya vigencia debe confirmarse

Extraídas literalmente de los anexos oficiales SUNAT (Anexo 2/3). Varias ya están marcadas como derogadas/desactivadas **en el propio anexo**, con fecha — igual deben re-confirmarse porque el anexo tiene fecha de corte (jul-2023 / act. jun-2026) y puede haber cambiado desde entonces.

| Norma | Afecta a | Estado según el anexo (a la fecha del anexo) | Acción pendiente |
|---|---|---|---|
| Ley 30334 | Bonificación extraordinaria 9%/6.75% sobre gratificación | Vigente | Confirmar % vigente y si aplica alguna actualización posterior |
| Ley 29351 | Inafectación temporal de gratificaciones (antecedente de Ley 30334) | Superada por Ley 30334, pero Tabla 22 aún distingue conceptos "– LEY 29351 Y 30334" | Confirmar si estos conceptos (312, 313, 406, 407, 2041) siguen vigentes o son solo históricos |
| Ley 28378 | Derogación del IES | Vigente (deroga IES salvo excepción contractual) | Confirmar si algún tenant objetivo tiene Convenio de Estabilidad Jurídica con IES incluido |
| Tabla 12, código 20 "Agrario - Ley 27360" | Tipo de contrato | **Desactivado 26.03.2014** por el propio MTPE (no es tipo de contrato sino régimen laboral) | No usar este código; usar Tabla 33 (Régimen Laboral) código 18 o 26 en su lugar |
| Tabla 33, código 19 "Exportación no tradicional D.Ley 22342" | Régimen laboral | **Desactivado 26.03.2014** (es tipo de contrato, no régimen) | No usar; ver Tabla 12 código 12 |
| Ley 31110 (Régimen Laboral Agrario) | Reemplaza/coexiste con Ley 27360 | Vigente desde 01.01.2021 (Tabla 33 código 26; Tabla 12 código 20 relacionado pero desactivado) | Confirmar si Ley 27360 (código 18) sigue aplicando a contratos preexistentes o si todo migra a Ley 31110 (código 26) |
| D.Leg. 1086 (REMYPE) | Régimen MYPE — microempresa (16) y pequeña empresa (17) | Vigente, requiere inscripción REMYPE | Confirmar tramos de facturación/trabajadores vigentes para calificar como micro vs. pequeña empresa (cambian por UIT anual) |
| Ley 30057 (Servicio Civil) | Régimen laboral público, categorías, conceptos 2000+ | Vigente desde 01.01.2016 para varios conceptos | Fuera de alcance Fase 1 (solo General + MYPE) — revisar si/cuándo se planea régimen público |
| D.Leg. 1057 (CAS) | Contrato Administrativo de Servicios | Vigente | Confirmar vigencia de indicadores relacionados (FDSA, concepto 618, 2039-2045) |
| R.S. 223-2017/SUNAT | Deroga indicador "Aporte a Asegura tu Pensión" | Derogado, recaudado solo hasta mayo 2017 | No implementar este indicador como activo |
| R.S. 235-2013/SUNAT, R.S. 027-2014/SUNAT | Indicador de retención a régimen pensionario (E20 campo 10-11) | Vigente | Confirmar redacción actual del campo |
| Ley 29903 | SNP independientes / Ley FDSA artista | Vigente desde 01.08.2013 | Confirmar aplicabilidad actual |
| Ley 30003 | Régimen especial pensiones pesqueros (REP) | Vigente desde 01.02.2014 | Fuera de alcance Fase 1 (régimen especial no cubierto) |
| D.U. 038-2019 | Conceptos BET sector público (2095-2109) | Vigente | Fuera de alcance Fase 1 (sector público) |
| D.Leg. 1153 | Conceptos de servicios de salud pública (2074-2093) | Vigente | Fuera de alcance Fase 1 (sector público/salud) |
| R.M. 357-2023-TR | Fondo de Capacitación de la Construcción (concepto 0817) | Vigente desde su publicación | Confirmar si aplica a algún tenant piloto (sector construcción) |
| R.M. 170-2023-TR / R.M. 286-2023-TR | Afiliación sindical servidores públicos (Tabla 37, estructura E31) | Vigente | Fuera de alcance Fase 1 (solo entidades públicas) |
| R.M. 107-2014-TR | Estructura de estudios concluidos (E29, Tabla 34) | Vigente desde 01.07.2014 | Sin acción — ya vigente hace años |

## C. Códigos SUNAT con vigencia condicionada (no son "leyes" pero sí requieren revalidación periódica)

| Tabla / Código | Detalle | Riesgo si no se revalida |
|---|---|---|
| Tabla 3 (Tipo de Documento), código 11 "Partida de Nacimiento" | Deshabilitado 19.05.2013 | No ofrecer como opción activa en formularios |
| Tabla 8 (Tipo de Trabajador), múltiples altas incrementales (2013–2021) | Cada código tiene fecha de incorporación distinta | Al construir el enum interno, verificar que ningún código usado en un tenant sea posterior a la fecha de vigencia real del anexo |
| Tabla 14 (EPS), código 1 "PERSALUD S.A." | Autorización vigente solo hasta 02.08.2012 según el propio anexo | **Muy probablemente ya no operativa** — no ofrecerla como EPS activa sin confirmar con SBS/SUSALUD |
| Tabla 29 (Códigos LDN) | No vigente desde 01.03.2018 (reemplazado por teléfono móvil obligatorio) | No usar en formularios nuevos; campo 10 de E4 es histórico |
| Tabla 36 (Entidades Financieras) | Lista de bancos/cajas/financieras | Verificar que ninguna entidad listada haya sido absorbida/liquidada desde la fecha del anexo (ej. fusiones de cajas municipales) |

## Cómo usar este documento

1. Antes de implementar cada regla de cálculo en Fase 1, buscar aquí las filas de la sección A relacionadas y confirmarlas contra fuente oficial (no contra este documento ni contra el anexo SUNAT, que solo referencia códigos/estructura, no valores tributarios).
2. Cargar el seed de `NORMATIVE_PARAMETER` (Fase 0) con los valores confirmados del **periodo de arranque real** del primer tenant, no con los números de ejemplo citados arriba.
3. Marcar el checkbox de cada fila al confirmar. Si un valor no puede confirmarse a tiempo, el parámetro debe quedar explícitamente marcado como "no confirmado" en una nota del seed — nunca lanzar a producción con un valor sin marcar.
