# Anexo 2 — Tablas Paramétricas de la Planilla Electrónica

Fuente: `docs/390199-anexo2_tablas_parametricas_actualizada-26-06-26.xlsx` (documento oficial SUNAT/MTPE, actualizado 26-06-2026). 34 tablas de códigos usadas por las estructuras de importación de `anexo3-estructuras-archivos.md`.

**Convención de este documento:** las tablas pequeñas (hasta ~60 filas) se transcriben íntegras abajo. Las tablas-catálogo grandes (cientos o miles de filas: actividades económicas, nacionalidades, ocupaciones, UBIGEO, instituciones educativas, organizaciones sindicales) se exportaron **completas, sin pérdida de datos**, como CSV en `docs/seed-data/`, listas para cargar como datos semilla (`NORMATIVE_PARAMETER` o tablas de catálogo propias); aquí se documenta su estructura, cantidad de filas y una muestra. Nada del contenido original queda fuera del repositorio — solo cambia el formato de un catálogo de miles de filas (CSV, apto para `COPY`/seed) en vez de una tabla markdown de igual tamaño.

## Índice y clasificación

| Uso | Tablas |
|---|---|
| **T-Registro** | 1, 3, 4, 5, 6, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 24, 25, 26, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37 |
| **Derechohabientes** (uso exclusivo) | 19, 20, 27 |
| **PLAME** | 21, 22, 23 |

---

## Tabla 3 — Tipo de Documento de Identidad

| N° | Descripción | Trabajador | Pensionista | Prest. Serv. | Descripción abreviada | Nota |
|---|---|---|---|---|---|---|
| 1 | DOCUMENTO NACIONAL DE IDENTIDAD | X | X | X | DNI | |
| 4 | CARNÉ DE EXTRANJERÍA | X | X | X | CARNÉ EXT. | |
| 06 | REG. ÚNICO DE CONTRIBUYENTES | | | | RUC | (1) Solo PS numeral i) art.1 D.S.018-2007-TR, en PLAME |
| 7 | PASAPORTE | X | X | X | PASAPORTE | |
| 9 | CARNÉ DE SOLICIT. DE REFUGIO | | | | CARNÉ SOLIC REFUGIO | Incorporado 19.05.2013 |
| 11 | PARTIDA DE NACIMIENTO | X | X | X | PART. NAC. | (2) Deshabilitado 19.05.2013 |
| 22 | CARNÉ DE IDENTIDAD - RELACIONES EXTERIORES | | | | C.IDENT.-RREE | Incorporado 01.02.2019 |
| 23 | PERM. TEMP. PERMANENCIA | | | | PTP | Incorporado 01.02.2019 |
| 24 | DOC. DE IDENTIDAD EXTRANJERO | | | | DOC.ID.EXTR. | Incorporado 01.02.2019 |
| 26 | CARNÉ DE PERMISO TEMP DE PERMANENCIA | | | | CPP | Incorporado 06.09.2022 |

(1) Solo aplica al prestador de servicios del numeral i) literal d) art.1° del Decreto, en el PLAME. (2) Permitió identificar Personal en Formación menor de edad hasta 19.05.2013.

## Tabla 5 — Vía

| N° | Descripción |
|---|---|
| 1 | AVENIDA |
| 2 | JIRÓN |
| 3 | CALLE |
| 4 | PASAJE |
| 5 | ALAMEDA |
| 6 | MALECÓN |
| 7 | OVALO |
| 8 | PARQUE |
| 9 | PLAZA |
| 10 | CARRETERA |
| 13 | TROCHA |
| 14 | CAMINO RURAL |
| 15 | BAJADA |
| 16 | GALERIA |
| 17 | PROLONGACIÓN |
| 18 | PASEO |
| 19 | PLAZUELA |
| 20 | PORTAL |
| 21 | CAMINO AFIRMADO |
| 22 | TROCHA CARROZABLE |
| 99 | OTROS |

## Tabla 6 — Zona

| N° | Descripción |
|---|---|
| 1 | URB. URBANIZACIÓN |
| 2 | P.J. PUEBLO JOVEN |
| 3 | U.V. UNIDAD VECINAL |
| 4 | C.H. CONJUNTO HABITACIONAL |
| 5 | A.H. ASENTAMIENTO HUMANO |
| 6 | COO. COOPERATIVA |
| 7 | RES. RESIDENCIAL |
| 8 | Z.I. ZONA INDUSTRIAL |
| 9 | GRU. GRUPO |
| 10 | CAS. CASERÍO |
| 11 | FND. FUNDO |
| 99 | OTROS |

## Tabla 8 — Tipo de Trabajador, Pensionista o Prestador de Servicios

Columnas "Sector Privado/Público/Otras Entidades": A = Aplica, N.A = No aplica.

| N° | Descripción | Sector Privado | Sector Público | Otras Entidades | Nota |
|---|---|---|---|---|---|
| 19 | EJECUTIVO | A | N.A | A | |
| 20 | OBRERO | A | A | A | |
| 21 | EMPLEADO | A | N.A | A | |
| 22 | TRABAJADOR PORTUARIO - LEY 27866 | A | N.A | A | |
| 23 | PRACTICANTE SENATI - DEC. LEY 20151 | A | N.A | A | |
| 24 | PENSIONISTA O CESANTE | A | A | A | |
| 25 | BENEFICIARIO DE TRANSF. DIRECTA EX PESCADOR | N.A | A | N.A | Desde 01.02.2014 |
| 26 | PENSIONISTA - LEY 28320 | A | N.A | A | |
| 27 | CONSTRUCCIÓN CIVIL | A | A | A | |
| 28 | PILOTO Y COPILOTO DE AVIACIÓN COMERCIAL | A | N.A | A | |
| 29 | MARÍTIMO, FLUVIAL O LACUSTRE | A | N.A | A | |
| 30 | PERIODISTA | A | N.A | A | |
| 31 | TRABAJADOR DE LA INDUSTRIA DE CUERO | A | N.A | A | |
| 32 | MINERO DE MINA DE SOCAVÓN | A | N.A | A | |
| 36 | TRABAJADOR PESQUERO | A | N.A | A | |
| 37 | MINERO DE TAJO ABIERTO | A | N.A | A | |
| 38 | MINERO IND. MINERA METAL. Y/O SIDERÚRGICA | A | N.A | A | Modificada desde 01.07.2012 |
| 39 | TRABAJADOR PESQUERO – LEY 30003 | A | N.A | A | Desde 01.02.2014 |
| 48 | AGROINDUSTRIAL | A | N.A. | N.A. | Desde 01.01.2021 |
| 56 | ARTISTA - LEY 28131 | A | N.A | A | |
| 64 | AGRARIO DEPENDIENTE - LEY 27360 | A | A | A | |
| 65 | TRAB. ACTIVIDAD ACUÍCOLA - LEY 27460 | A | A | A | |
| 66 | PESCADOR/PROCESADOR ARTESANAL INDEPENDIENTE - LEY 27177 | A | N.A | N.A | |
| 67 | REGIMEN ESPECIAL D.LEG.1057 - CAS | N.A | A | A | |
| 71 | CONDUCTOR DE MICROEMPRESA REMYPE - D.LEG.1086 | A | N.A | N.A | |
| 73 | SOCIO DE COOPERATIVA AGRARIA – LEY 29972 | A | N.A | N.A | Desde 01.02.2013 |
| 76 | AGRARIO LEY 31110 | A | N.A. | N.A. | Desde 01.01.2021 |
| 77 | INTERNO EN CIENCIAS DE LA SALUD D.U. 090-2020 | N.A. | A | A | |
| 82 | FUNCIONARIO PÚBLICO | N.A | A | A | |
| 83 | EMPLEADO DE CONFIANZA | N.A | A | A | |
| 84 | SERVIDOR PÚBLICO - DIRECTIVO SUPERIOR | N.A | A | A | |
| 85 | SERVIDOR PÚBLICO - EJECUTIVO | N.A | A | A | |
| 86 | SERVIDOR PÚBLICO - ESPECIALISTA | N.A | A | A | |
| 87 | SERVIDOR PÚBLICO - DE APOYO | N.A | A | A | |
| 88 | PERS. ADMIN. PÚBLICA - ASIGN. ESPECIAL D.U. 126-2001 | N.A | A | N.A | |
| 89 | PERSONAL DE LAS FUERZAS ARMADAS Y POLICIALES | N.A | A | N.A | No incluye personal civil |
| 90 | GERENTES PÚBLICOS - D.LEG. 1024 | N.A | A | A | |
| 91 | MIEMBROS DE OTROS REG. ESPECIALES DEL SECTOR PÚBLICO | N.A | A | A | |
| 92 | FUNCIONARIO PÚBLICO - LEY 30057 | N.A | A | A | Desde 01.01.2016 |
| 93 | DIRECTIVO PÚBLICO - LEY 30057 | N.A | A | A | Desde 01.01.2016 |
| 94 | SERVIDOR CIVIL DE CARRERA - LEY 30057 | N.A | A | A | Desde 01.01.2016 |
| 95 | SERVIDOR DE ACTIVIDADES COMPLEMENTARIAS - LEY 30057 | N.A | A | A | Desde 01.01.2016 |
| 96 | MAGISTERIO - LEY 29944 | N.A | A | A | Desde 01.01.2016 |
| 98 | PERSONA QUE GENERA INGRESOS DE 4TA-5TA CATEGORÍA | A | A | A | |

**Mapeo a nuestro modelo:** `CONTRATO`/`EMPLOYEE` deben poder representar el código de Tabla 8 (tipo de trabajador SUNAT) además del `regimen_laboral` propio, porque múltiples reglas de negocio de Anexo 3 (E5, E14, E15, E18, E26...) condicionan campos según este código, no según nuestro enum interno.

## Tabla 9 — Situación Educativa

(Antes "Nivel Educativo"; vigente desde 01/07/2014)

| N° | Descripción |
|---|---|
| 01 | SIN EDUCACIÓN FORMAL |
| 02 | EDUCACIÓN ESPECIAL INCOMPLETA |
| 03 | EDUCACIÓN ESPECIAL COMPLETA |
| 04 | EDUCACIÓN PRIMARIA INCOMPLETA |
| 05 | EDUCACIÓN PRIMARIA COMPLETA |
| 06 | EDUCACIÓN SECUNDARIA INCOMPLETA |
| 07 | EDUCACIÓN SECUNDARIA COMPLETA |
| 08 | EDUCACIÓN TÉCNICA INCOMPLETA (CETPRO) |
| 09 | EDUCACIÓN TÉCNICA COMPLETA (CETPRO) |
| 10 | EDUCACIÓN SUPERIOR (INSTITUTO) INCOMPLETA |
| 11 | EDUCACIÓN SUPERIOR (INSTITUTO) COMPLETA |
| 12 | EDUCACIÓN UNIVERSITARIA INCOMPLETA |
| 13 | EDUCACIÓN UNIVERSITARIA COMPLETA |
| 14 | GRADO DE BACHILLER |
| 15 | TITULADO |
| 16 | ESTUDIOS DE MAESTRÍA INCOMPLETA |
| 17 | ESTUDIOS DE MAESTRÍA COMPLETA |
| 18 | GRADO DE MAESTRÍA |
| 19 | ESTUDIOS DE DOCTORADO INCOMPLETO |
| 20 | ESTUDIOS DE DOCTORADO COMPLETO |
| 21 | GRADO DE DOCTOR |

## Tabla 10 — Ocupación (Sector Público, Otras Entidades y Personal en Formación)

**Catálogo grande — 4,755 filas.** Estructura: `CODIGO` (6 dígitos) | `NOMBRE`. Exportado completo en `docs/seed-data/t10_ocupacion_sector_publico.csv`.

Muestra:
```
011001 | MARINA, OFICIALES
011002 | EJERCITO, OFICIALES
011003 | AVIACION, OFICIAL
```

## Tabla 11 — Régimen Pensionario

| N° | Descripción | Descripción abreviada | Sector Privado | Sector Público | Otras Entidades | Nota |
|---|---|---|---|---|---|---|
| 02 | DECRETO LEY 19990 - SNP - ONP | DL 19990 - SIST NAC PENS - ONP | A | A | A | |
| 03 | DECRETO LEY 20530 | DECRETO LEY 20530 | N.A | A | A | |
| 09 | CAJA DE BENEFICIOS DE SEG. SOCIAL DEL PESCADOR | CBSSP | A | N.A | A | |
| 10 | CAJA DE PENSIONES MILITAR | CAJA DE PENSIONES MILITAR | N.A | A | N.A | |
| 11 | CAJA DE PENSIONES POLICIAL | CAJA DE PENSIONES POLICIAL | N.A | A | N.A | |
| 12 | OTROS REGÍMENES PENSIONARIOS | OTROS REGIMENES PENSIONARIOS | A | A | A | Solo pensionista |
| 13 | RÉGIMEN DEL SERVICIO DIPLOMÁTICO DE LA REPÚBLICA | REGIMEN DEL SDR | N.A | A | A | |
| 14 | LEY 29903 - SNP - INDEPENDIENTES | LEY 29903 - SNP - INDEPENDIENTE | A | A | A | Desde 01.08.2013 |
| 15 | LEY 30003 - RÉGIMEN ESPECIAL PENSIONES - PESQUEROS | REP - TRAB. PESQUEROS | A | N.A | A | Desde 01.02.2014 |
| 16 | LEY 30003 TRANSFERENCIA DIRECTA EX PESC | LEY 30003 TDEP | N.A | A | N.A | Desde 01.02.2014 |
| 21 | SPP INTEGRA | SPP INTEGRA | A | A | A | |
| 22 | SPP HORIZONTE | SPP HORIZONTE | A | A | A | |
| 23 | SPP PROFUTURO | SPP PROFUTURO | A | A | A | |
| 24 | SPP PRIMA | SPP PRIMA | A | A | A | |
| 25 | SPP HABITAT | SPP HABITAT | A | A | A | Desde 01.06.2013 |
| 98 | PENDIENTE DE ELECCIÓN DE RÉGIMEN PENSIONARIO | PEND ELEC REG PENSIONARIO | | | | Desde 06.03.2014 |
| 99 | SIN RÉGIMEN PENSIONARIO/NO APLICA | SIN REG PENSIONARIO/NO APLICA | A | A | A | |

**Mapeo directo:** `REGIMEN_PENSIONARIO.sistema` (afp/onp) + `REGIMEN_PENSIONARIO.administradora` deben poder resolver a estos códigos (21–25 = AFP específica, 02 = ONP, 03/10/11/13/15 = regímenes especiales).

## Tabla 12 — Tipo de Contrato de Trabajo / Condición Laboral

| N° | Descripción | Nota |
|---|---|---|
| 1 | A PLAZO INDETERMINADO - D.LEG. 728 | |
| 2 | A TIEMPO PARCIAL | |
| 3 | POR INICIO O INCREMENTO DE ACTIVIDAD | |
| 4 | POR NECESIDADES DEL MERCADO | |
| 5 | POR RECONVERSIÓN EMPRESARIAL | |
| 6 | OCASIONAL | |
| 7 | DE SUPLENCIA | |
| 8 | DE EMERGENCIA | |
| 9 | PARA OBRA DETERMINADA O SERVICIO ESPECÍFICO | |
| 10 | INTERMITENTE | |
| 11 | DE TEMPORADA | |
| 12 | DE EXPORTACIÓN NO TRADICIONAL D.LEY 22342 | |
| 13 | DE EXTRANJERO - D.LEG.689 | |
| 14 | ADMINISTRATIVO DE SERVICIOS - D.LEG 1057 (CAS) | No aplica sector privado |
| 15 | NOMBRADO - D.LEG. 276 | No aplica sector privado |
| 16 | SERVICIOS PERSONALES - REGÍM. DE CARRERA | No aplica sector privado |
| 17 | GERENTE PÚBLICO - D.LEG. 1024 | No aplica sector privado |
| 18 | A DOMICILIO | |
| 19 | FUTBOLISTAS PROFESIONALES | |
| 20 | AGRARIO - LEY 27360 | **Desactivado 26.03.2014** (no es tipo de contrato sino régimen laboral) |
| 21 | MIGRANTE ANDINO DECISIÓN 545 | |
| 22 | A PLAZO INDETERMINADO - LEY 30057 | |
| 23 | A PLAZO FIJO - LEY 30057 | |
| 24 | NOMBRADO - CARRERAS ESPECIALES DEL SECTOR PÚBLICO | |
| 25 | CONTRATADO - CARRERAS ESPECIALES DEL SECTOR PÚBLICO | |
| 99 | OTROS NO PREVISTOS | |

**Mapeo directo:** `CONTRATO.tipo_contrato`.

## Tabla 13 — Periodicidad de la Remuneración o Retribución

| N° | Descripción |
|---|---|
| 1 | MENSUAL |
| 2 | QUINCENAL |
| 3 | SEMANAL |
| 4 | DIARIA |
| 5 | OTROS |

## Tabla 14 — Entidades Prestadoras de Salud (EPS) / Servicios Propios

| N° | RUC | Descripción |
|---|---|---|
| 1 | 20514372251 | PERSALUD S.A. EPS (autorización vigente hasta 02.08.2012) |
| 2 | 20431115825 | PACÍFICO S.A. EPS |
| 3 | 20414955020 | RÍMAC INTERNACIONAL S.A. EPS |
| 4 | 0 | SERVICIOS PROPIOS |
| 5 | 20517182673 | MAPFRE PERU S.A. EPS |
| 6 | 20523470761 | SANITAS PERU S.A. - EPS |
| 7 | 20601978572 | EPS LA POSITIVA S.A. ENTIDAD PRESTADORA DE SALUD |

## Tabla 15 — Situación del Trabajador o Pensionista

| N° | Descripción | Nota |
|---|---|---|
| 0 | BAJA | Para pensionista solo se habilitan 0 y 1 |
| 1 | ACTIVO O SUBSIDIADO | Para pensionista solo se habilitan 0 y 1 |
| 2 | SIN VÍNCULO LABORAL CON CONCEPTOS PENDIENTE DE LIQUIDAR | Se genera en PLAME al incorporar en T-Registro período con motivo de baja tipo 99 |
| 3 | SUSPENSIÓN PERFECTA DE LABORES | Se genera cuando el trabajador está en suspensión perfecta todo el período |

## Tabla 16 — Tipo de Pago

| N° | Descripción |
|---|---|
| 1 | EFECTIVO |
| 2 | DEPÓSITO EN CUENTA |
| 3 | OTROS |

## Tabla 17 — Motivo de la Baja del Registro

| N° | Descripción | Nota |
|---|---|---|
| 01 | RENUNCIA | |
| 02 | RENUNCIA CON INCENTIVOS | |
| 03 | DESPIDO O DESTITUCIÓN | |
| 04 | CESE COLECTIVO | |
| 05 | JUBILACIÓN | |
| 06 | INVALIDEZ ABSOLUTA PERMANENTE | |
| 07 | TERMINACIÓN DE OBRA/SERVICIO, CUMPLIM. COND. RESOLUTORIA O VENC. PLAZO | |
| 08 | MUTUO DISENSO | |
| 09 | FALLECIMIENTO | |
| 10 | SUSPENSIÓN DE LA PENSIÓN | Solo pensionista |
| 11 | REASIGNACIÓN SERVIDOR ADMIN. PÚBLICA | No aplica sector privado |
| 12 | PERMUTA SERVIDOR ADMIN. PÚBLICA | No aplica sector privado |
| 13 | TRANSFERENCIA SERVIDOR ADMIN. PÚBLICA | No aplica sector privado |
| 14 | BAJA POR SUCESIÓN EN POSICIÓN DEL EMPLEADOR | |
| 15 | EXTINCIÓN O LIQUIDACIÓN DEL EMPLEADOR | |
| 16 | OTROS MOTIVOS DE CADUCIDAD DE LA PENSIÓN | Solo pensionista |
| 17 | NO SE INICIÓ LA RELACIÓN LABORAL O PRESTACIÓN EFECTIVA DE SERVICIOS | Modificado R.S. 183-2011/SUNAT |
| 18 | LÍMITE DE EDAD 70 AÑOS | |
| 19 | OTRAS CAUSALES RÉGIMEN PÚBLICO GENERAL - LEY 30057 | |
| 20 | INHABILITACIÓN EJERCICIO PROF./FUNC. PÚBLICA >3 MESES - LEY 30057 | |
| 99 | SIN VÍNCULO LABORAL - HABILITADO PARA PDT PLAME | Incorporado 01.02.2014 |

**Relevancia directa:** alimenta `LIQUIDACION` (motivo de cese) y `CONTRATO.fecha_fin`.

## Tabla 18 — Tipo de Modalidad Formativa Laboral y Otros

| N° | Descripción | Nota |
|---|---|---|
| 1 | APRENDIZAJE CON PREDOMINIO EN LA EMPRESA | |
| 2 | APRENDIZAJE CON PREDOMINIO EN EL CFP - PRÁCTICAS PRE PROFESIONALES | |
| 3 | PRÁCTICAS PROFESIONALES | |
| 4 | CAPACITACIÓN LABORAL JUVENIL | |
| 5 | PASANTÍA EN LA EMPRESA | |
| 6 | PASANTÍA DE DOCENTES Y CATEDRÁTICOS | |
| 7 | ACTUALIZACIÓN PARA LA REINSERCIÓN LABORAL | |
| 10 | SECIGRISTA | No aplica sector privado |

## Tabla 19 — Vínculo Familiar (uso exclusivo derechohabientes)

| N° | Descripción |
|---|---|
| 02 | CÓNYUGE |
| 03 | CONCUBINA(O) |
| 04 | GESTANTE |
| 05 | HIJO MENOR DE EDAD |
| 06 | HIJO MAYOR DE EDAD INCAPACITADO PERMANENTE |

## Tabla 20 — Motivo de Baja como Derechohabiente (uso exclusivo derechohabientes)

| N° | Descripción |
|---|---|
| 02 | FALLECIMIENTO |
| 03 | OTROS MOTIVOS NO PREVISTOS |
| 04 | DIVORCIO O DISOLUCIÓN DE VÍNCULO MATRIMONIAL |
| 05 | FIN DE CONCUBINATO |
| 06 | FIN DE LA GESTACIÓN |
| 07 | HIJO ADQUIERE MAYORÍA DE EDAD |
| 08 | ERROR EN EL REGISTRO |
| 09 | DERECHOHABIENTE ADQUIERE CONDICIÓN DE ASEGURADO REGULAR |

Requiere sustento documentario según motivo (partida de defunción para 02, partida de matrimonio con anotación de divorcio para 04, declaración jurada para 05, otros documentos para 03/06/07/09).

## Tabla 21 — Tipo de Suspensión de la Relación Laboral

Códigos "S.P." = Suspensión Perfecta (sin goce de haber); "S.I." = Suspensión Imperfecta (con goce o subsidio). Columna "CITT" marca días subsidiados por EsSalud.

| N° | Descripción | Subsidiado (CITT) |
|---|---|---|
| 1 | S.P. SANCIÓN DISCIPLINARIA | |
| 2 | S.P. EJERCICIO DEL DERECHO DE HUELGA | |
| 3 | S.P. DETENCIÓN DEL TRABAJADOR (salvo condena) | |
| 4 | S.P. INHABILITACIÓN ADMIN./JUDICIAL O PENA PRIVATIVA ≤3 MESES POR DELITO CULPOSO | |
| 5 | S.P. PERMISO, LICENCIA U OTROS SIN GOCE DE HABER | |
| 6 | S.P. CASO FORTUITO O FUERZA MAYOR | |
| 7 | S.P. FALTA NO JUSTIFICADA | |
| 8 | S.P. POR TEMPORADA O INTERMITENTE | |
| 9 | S.P. MATERNIDAD DURANTE DESCANSO PRE Y POST NATAL | |
| 10 | S.P. SENTENCIA 1RA INSTANCIA (TERRORISMO/NARCOTRÁFICO/CORRUPCIÓN/VIOLACIÓN SEXUAL) | |
| 11 | S.P. IMPOSICIÓN DE MEDIDA CAUTELAR | |
| 12 | S.P. ENFERMEDAD GRAVE PADRE/CÓNYUGE/CONVIVIENTE/HIJOS | |
| 20 | S.I. ENFERMEDAD O ACCIDENTE (primeros 20 días) | |
| 21 | S.I. INCAPACIDAD TEMPORAL (invalidez, enfermedad, accidentes) | X |
| 22 | S.I. MATERNIDAD PRE Y POST NATAL | X |
| 23 | S.I. DESCANSO VACACIONAL | |
| 24 | S.I. LICENCIA CARGO CÍVICO / SERVICIO MILITAR OBLIGATORIO | |
| 25 | S.I. PERMISO/LICENCIA CARGOS SINDICALES | |
| 26 | S.I. LICENCIA U OTROS MOTIVOS CON GOCE DE HABER | |
| 27 | S.I. DÍAS COMPENSADOS POR HORAS EN SOBRETIEMPO | |
| 28 | S.I. DÍAS LICENCIA POR PATERNIDAD | |
| 29 | S.I. DÍAS LICENCIA POR ADOPCIÓN | |
| 30 | S.I. IMPOSICIÓN DE MEDIDA CAUTELAR | |
| 31 | S.I. CITACIÓN JUDICIAL/MILITAR/POLICIAL/ADMINISTRATIVA | |
| 32 | S.I. FALLECIMIENTO DE PADRES, HERMANOS, CÓNYUGE O HIJOS | |
| 33 | S.I. REPRESENTACIÓN OFICIAL DEL ESTADO EN EVENTOS | |
| 34 | S.I. DESC. VACACIONAL / LIC. ASISTENCIA MÉDICA O TERAPIA REHABILITACIÓN DEPENDIENTE CON DISCAPACIDAD | |
| 35 | S.I. ENFERMEDAD GRAVE/TERMINAL O ACCIDENTE GRAVE DE FAMILIAR DIRECTO | |

**Relevancia directa Fase 2:** mapea a `MARCACION`/ausencias — nuestro modelo de asistencia debe poder clasificar ausencias con estos códigos para alimentar E15 (días subsidiados/no laborados).

## Tabla 22 — Ingresos, Tributos y Descuentos

**La tabla más crítica para el motor de nómina.** Define el catálogo oficial de 339 conceptos (ingresos, aportaciones, descuentos) organizados en 9 grupos, cada uno con matriz de afectación (SI/NO) a 15 tributos/aportes distintos según sea Empleador, Trabajador o Pensionista. Exportada completa en `docs/seed-data/t22_ingresos_tributos_descuentos.csv` (339 filas × 19 columnas: código, descripción, y 15 columnas de afectación agrupadas en Empleador/Trabajador/Pensionista, más columna de notas).

### Grupos de conceptos

| Rango | Grupo |
|---|---|
| 100–129 | Ingresos (remuneraciones, horas extra, vacaciones, etc.) |
| 200–214 | Ingresos: Asignaciones |
| 300–314 | Ingresos: Bonificaciones |
| 400–411 | Ingresos: Gratificaciones / Aguinaldos |
| 500–507 | Ingresos: Indemnizaciones (no afectas a ningún tributo) |
| 600–621 | Aportaciones del Trabajador/Pensionista (descuentos por AFP/ONP/renta) |
| 700–707 | Descuentos al Trabajador (adelantos, tardanzas, judiciales) |
| 800–817 | Aportaciones de cargo del Empleador (EsSalud, SCTR, SENATI) |
| 900–932 | Conceptos Varios (CTS, utilidades, subsidios, condiciones de trabajo) |
| 1000–1040 | Otros Conceptos (1–40, libremente definidos por el empleador) |
| 2000–2118 | Régimen Laboral Público (solo sector público, fuera de alcance Fase 1 General/MYPE) |

### Columnas de afectación (empleador/trabajador/pensionista)

`ESSALUD SEGURO REGULAR TRABAJADOR`, `ESSALUD-CBSSP-SEG TRAB PESQUERO`, `ESSALUD SEGURO AGRARIO/ACUICULTOR`, `ESSALUD SCTR`, `IMPUESTO EXTRAORD. DE SOLIDARIDAD`, `FONDO DERECHOS SOCIALES DEL ARTISTA`, `SENATI`, `FONDO COMP JUB TRAB PESQUERO` (columnas de EMPLEADOR); `SISTEMA NACIONAL DE PENSIONES 19990`, `SISTEMA PRIVADO DE PENSIONES`, `FONDO COMPL DE JUBIL MIN.MET.SIDER`, `RÉG.ESP.PENSIONES TRAB.PESQUERO`, `RENTA 5TA CATEGORÍA RETENCIONES` (columnas de TRABAJADOR); `ESSALUD SEGURO REGULAR PENSIONISTA`, `CONTRIB. SOLIDARIA ASISTENCIA PREVISIONAL` (columnas de PENSIONISTA).

### Conceptos con reglas especiales (referenciadas por E18/E19 de Anexo 3)

| Código | Concepto | Regla |
|---|---|---|
| 601 | SPP - Comisión porcentual | Requiere régimen pensionario AFP (Tabla 11: 21–25) |
| 606 | SPP - Prima de seguro | Requiere AFP |
| 608 | SPP - Aportación obligatoria | Requiere AFP |
| 609 | SPP - Aportación voluntaria | Requiere AFP |
| 613 | Régimen Pensionario D.L. 20530 | Requiere Tabla 11 tipo 3 |
| 614 | Régimen del Servicio Diplomático | Requiere Tabla 11 tipo 13 |
| 615 | Régimen de Pensiones Militar-Policial | Requiere Tabla 11 tipo 10/11 |
| 617 | Cuota-Fraccionamiento FCJMMS | Monto devengado = base de cálculo; monto pagado = cuota retenida |
| 618 | Renta 4ta Categoría Retenciones – CAS | Solo trabajadores CAS |
| 126, 127 | Ingresos conductor microempresa | Solo empleadores REMYPE |

**Mapeo a nuestro modelo:** `CONCEPTO.codigo_sunat` (nuevo campo, 4 dígitos) debe apuntar 1:1 a esta tabla; `CONCEPTO.afecto_a` (jsonb) se deriva mecánicamente de las columnas de afectación de esta tabla para el código SUNAT correspondiente, evitando mantener las reglas de afectación duplicadas a mano.

## Tabla 23 — Tipo de Comprobante (Prestador de Servicios 4ta Categoría)

| Código | Descripción |
|---|---|
| R | RECIBO POR HONORARIOS |
| N | NOTA DE CRÉDITO |
| D | DIETA |
| O | OTRO COMPROBANTE |

## Tabla 24 — Categoría Ocupacional del Trabajador

No aplica a tipos de trabajador: 19, 20, 21, 23, 66, 71, 88, 89, 90, 91, 98 (Tabla 8).

| Código | Descripción | Sector Privado | Sector Público | Otras Entidades |
|---|---|---|---|---|
| 01 | EJECUTIVO | A | N.A | A |
| 02 | OBRERO | A | N.A | A |
| 03 | EMPLEADO | A | N.A | A |
| 11 | FUNCIONARIO | N.A | A | A |
| 12 | PROFESIONAL | N.A | A | A |
| 13 | TÉCNICO | N.A | A | A |
| 14 | AUXILIAR | N.A | A | A |
| 21 | FUNCIONARIO PÚBLICO - LEY 30057 | N.A | A | A |
| 22 | DIRECTIVO PÚBLICO - LEY 30057 | N.A | A | A |
| 23 | SERVIDOR CIVIL DE CARRERA - LEY 30057 | N.A | A | A |
| 24 | SERVIDOR DE ACTIVIDADES COMPLEMENTARIAS - LEY 30057 | N.A | A | A |

## Tabla 25 — Convenios para Evitar la Doble Tributación

| Código | Descripción |
|---|---|
| 0 | NINGUNO |
| 1 | CANADA |
| 2 | CHILE |
| 3 | CAN |
| 4 | BRASIL |
| 5 | MEXICO |
| 6 | COREA |
| 7 | SUIZA |
| 8 | PORTUGAL |

## Tabla 27 — Documento que Sustenta Vínculo Familiar (uso exclusivo derechohabientes)

| Código | Descripción | Aplica a vínculo |
|---|---|---|
| 01 | ESCRITURA PÚBLICA | Gestante |
| 02 | SENTENCIA DE DECLARATORIA DE PATERNIDAD | Gestante |
| 03 | TESTAMENTO | Gestante |
| 04 | RESOLUCIÓN DE INCAPACIDAD | Hijo mayor incapacitado |
| 05 | ACTA O PARTIDA DE MATRIMONIO CIVIL | Cónyuge |
| 06 | ACTA/PARTIDA MATRIMONIO INSCRITO EN REG. CONSULAR PERUANO | Cónyuge |
| 07 | ACTA/PARTIDA MATRIMONIO EN EL EXTERIOR INSCRITO EN RENIEC/MUNICIPALIDAD | Cónyuge |
| 08 | ESCRITURA PÚBLICA - RECONOC. UNIÓN DE HECHO - LEY 29560 | Concubino(a) |
| 09 | RESOLUCIÓN JUDICIAL - RECONOC. UNIÓN DE HECHO | Concubino(a) |
| 10 | ACTA DE NACIMIENTO O DOC. ANÁLOGO QUE SUSTENTA FILIACIÓN | Hijo menor (doc. ≠ DNI) |
| 11 | DECLARACIÓN JURADA EXISTENCIA DE UNIÓN DE HECHO | Concubino(a). Suscrita por titular y concubino(a). Incorporado 15.02.2012 |

## Tabla 28 — UBIGEO RENIEC

**Catálogo grande — 1,895 filas.** Estructura: `DEPARTAMENTO/REGIÓN` | `DESCRIPCIÓN DEPARTAMENTO` | `PROVINCIA` | `DESCRIPCIÓN PROVINCIA` | `DISTRITO` | `DESCRIPCIÓN DISTRITO`. Exportado completo en `docs/seed-data/t28_ubigeo.csv`.

Muestra:
```
01 | AMAZONAS | 0101 | CHACHAPOYAS | 010101 | CHACHAPOYAS
```

## Tabla 29 — Códigos de Larga Distancia Nacional

(No vigente desde 01/03/2018, reemplazado por teléfono móvil obligatorio — ver E4 campo 10/11)

| Código | Descripción |
|---|---|
| 1 | LIMA Y CALLAO |
| 41 | AMAZONAS |
| 42 | SAN MARTIN |
| 43 | ANCASH |
| 44 / 94 | LA LIBERTAD |
| 51 | PUNO |
| 52 | TACNA |
| 53 | MOQUEGUA |
| 54 / 95 | AREQUIPA |
| 56 | ICA |
| 61 | UCAYALI |
| 62 | HUANUCO |
| 63 | PASCO |
| 64 | JUNIN |
| 65 | LORETO |
| 66 | AYACUCHO |
| 67 | HUANCAVELICA |
| 72 | TUMBES |
| 73 / 96 | PIURA |
| 74 / 97 | LAMBAYEQUE |
| 76 | CAJAMARCA |
| 82 | MADRE DE DIOS |
| 83 | APURIMAC |
| 84 | CUSCO |

## Tabla 30 — Ocupación aplicable al Sector Privado

**Catálogo grande — 4,652 filas.** Estructura: `Código` | `NOMBRE` | `Ejecutivo` | `Empleado` | `Obrero` (indicadores 1/0 de si el código de ocupación puede asumirse para esa categoría ocupacional). Exportado completo en `docs/seed-data/t30_ocupacion_sector_privado.csv`.

## Tabla 31 — Pliego Presupuestal (solo Sector Público)

**194 filas** — fuera del alcance de Fase 1 (General + MYPE, sector privado). Exportado completo en `docs/seed-data/t31_pliego_presupuestal.csv` por completitud documental; no requiere carga en el MVP.

## Tabla 32 — Régimen de Aseguramiento de Salud

| N° | Descripción | Nota |
|---|---|---|
| 00 | ESSALUD REGULAR (exclusivamente) | |
| 01 | ESSALUD REGULAR Y EPS/SERV. PROPIOS | |
| 02 | ESSALUD TRABAJADORES PESQUEROS | |
| 03 | ESSALUD TRAB. PESQUEROS Y EPS/SERV. PROPIOS | |
| 04 | ESSALUD AGRARIO/ACUÍCOLA | |
| 05 | ESSALUD PENSIONISTAS | |
| 20 | SANIDAD DE FFAA Y POLICIALES | No aplica sector privado |
| 21 | SIS – MICROEMPRESA | Habilitado para microempresa |

## Tabla 33 — Régimen Laboral

Tabla clave: mapea directamente a `CONTRATO.regimen_laboral`.

| Código | Descripción | Sector Privado | Sector Público | Otras Entidades | Nota |
|---|---|---|---|---|---|
| 01 | PRIVADO GENERAL - D.LEG. 728 | A | A | A | **= "General" en nuestro sistema** |
| 02 | PÚBLICO GENERAL - D.LEG. 276 | N.A | A | A | |
| 03 | PROFESORADO - LEY 24029 | N.A | A | A | |
| 04 | MAGISTERIO - LEY 29062 | N.A | A | A | |
| 05 | DOCENTES UNIVERSITARIOS - LEY 23733 | N.A | A | A | |
| 06 | PROFESIONALES DE LA SALUD - LEY 23536 | N.A | A | A | |
| 07 | TÉCNICOS Y AUXILIARES ASIST. DE LA SALUD - LEY 28561 | N.A | A | A | |
| 08 | SERUM - LEY 23330 | N.A | A | A | |
| 09 | JUECES - CARRERA JUDICIAL - LEY 29277 | N.A | A | N.A | |
| 10 | FISCALES - D.LEG. 052 | N.A | A | N.A | |
| 11 | SERVICIO DIPLOMÁTICO DE LA REPÚBLICA - LEY 28091 | N.A | A | A | |
| 12 | MILITARES | N.A | A | N.A | |
| 13 | POLICÍA NACIONAL DEL PERÚ - LEY 27238 | N.A | A | N.A | |
| 14 | ESPECIAL GERENTES PÚBLICOS D.LEG. 1024 | N.A | A | A | Solo tipo trabajador 14 (Tabla 8) al asumir cargo |
| 15 | CONTRATO ADMINISTRATIVO DE SERVICIOS - D.LEG. 1057 | N.A | A | A | |
| 16 | MICROEMPRESA D.LEG. 1086 | A | N.A | N.A | **= "MYPE" (micro) en nuestro sistema.** Requiere inscripción REMYPE |
| 17 | PEQUEÑA EMPRESA D.LEG. 1086 | A | N.A | N.A | **= "MYPE" (pequeña) en nuestro sistema.** Requiere inscripción REMYPE |
| 18 | AGRARIO LEY 27360 | A | A | A | **= "Agrario" en nuestro sistema** |
| 19 | EXPORTACIÓN NO TRADICIONAL D.LEY 22342 | A | A | A | **Desactivado 26.03.2014** (es tipo de contrato, no régimen) |
| 20 | MINEROS | A | A | A | |
| 21 | CONSTRUCCIÓN CIVIL | A | A | A | |
| 22 | PÚBLICO GENERAL SERVICIO CIVIL - LEY 30057 | N.A | A | A | |
| 23 | MAGISTERIO - LEY 29944 | N.A | A | A | |
| 24 | POLICÍA NACIONAL DEL PERÚ - D.LEG. 1149 | N.A | A | A | |
| 25 | SERVIDORES PENITENCIARIOS - LEY 29709 | N.A | A | A | |
| 26 | RÉGIMEN LABORAL AGRARIO LEY 31110 | A | N.A. | N.A. | **= "Agrario" (variante 2021) en nuestro sistema** |
| 99 | OTROS NO PREVISTOS | A | A | A | |

**Decisión de mapeo para Fase 1:** `CONTRATO.regimen_laboral` (enum interno `general/mype/agrario`) debe guardar también el código SUNAT exacto (01/16/17/18/26) en un campo `regimen_laboral_sunat`, porque "MYPE" en nuestro dominio corresponde a dos códigos SUNAT distintos (16 microempresa, 17 pequeña empresa) y "Agrario" a dos leyes distintas (18 y 26) según la fecha de contratación.

## Tabla 34 — Instituciones Educativas y sus Carreras

**Catálogo muy grande — 5,935 filas.** Vigente desde 01/07/2014. Basada en el Clasificador de Instituciones de Educación Superior y Técnico Productivas (INEI) y el Clasificador de Carreras correspondiente. Estructura: código de institución (9 dígitos), nombre, código de carrera (6 dígitos), nombre de carrera, y campos de ubicación. Exportado completo en `docs/seed-data/t34_instituciones_educativas.csv`.

Uso: E29 (Estudios Concluidos) del Anexo 3, campos 6–7.

## Tabla 35 — Situación Especial

No aplica a tipo de trabajador 23, 66, 71, 73.

| N° | Descripción |
|---|---|
| 0 | NINGUNA |
| 1 | TRABAJADOR DE DIRECCIÓN – PRESENCIAL |
| 2 | TRABAJADOR DE CONFIANZA - PRESENCIAL |
| 3 | TRABAJADOR DE DIRECCIÓN - TELETRABAJO MIXTO |
| 4 | TRABAJADOR DE CONFIANZA - TELETRABAJO MIXTO |
| 5 | TRABAJADOR DE DIRECCIÓN - TELETRABAJO COMPLETO |
| 6 | TRABAJADOR DE CONFIANZA - TELETRABAJO COMPLETO |
| 7 | TELETRABAJO MIXTO |
| 8 | TELETRABAJO COMPLETO |

## Tabla 36 — Entidades del Sistema Financiero

Mapea directamente a `CUENTA_BANCARIA.banco` / al `BankFileExporter` de Fase 1.

| Código | Entidad |
|---|---|
| 002 | BANCO DE CRÉDITO DEL PERÚ (BCP) |
| 003 | INTERBANK |
| 007 | CITIBANK DEL PERÚ |
| 009 | SCOTIABANK PERÚ |
| 011 | BBVA BANCO CONTINENTAL |
| 018 | BANCO DE LA NACIÓN |
| 020 | BANCO FALABELLA |
| 023 | BANCO DE COMERCIO |
| 035 | BANCO PICHINCHA |
| 038 | BANCO INTERAMERICANO DE FINANZAS |
| 043 | CREDISCOTIA FINANCIERA |
| 053 | BANCO GNB |
| 056 | SANTANDER |
| 057 | BANCO AZTECA |
| 058 | BANCO CENCOSUD |
| 059 | BANCO RIPLEY |
| 060 | ICBC PERÚ BANK |
| 070 | MIBANCO |
| 200 | FINANCIERA CREDINKA |
| 202 | FINANCIERA PROEMPRESA |
| 204 | FINANCIERA CONFIANZA |
| 206 | CREDIRAIZ |
| 208 | COMPARTAMOS FINANCIERA |
| 210 | FINANCIERA QAPAQ |
| 212 | FINANCIERA TFC S.A. |
| 214 | FINANCIERA EFECTIVA |
| 216 | AMERIKA FINANCIERA |
| 218 | FINANCIERA OH! |
| 800 | CAJA METROPOLITANA DE LIMA |
| 802 | CMAC TRUJILLO |
| 803 | CMAC AREQUIPA |
| 805 | CMAC SULLANA |
| 806 | CMAC CUSCO |
| 808 | CMAC HUANCAYO |
| 813 | CMAC TACNA |
| 820 | CMAC DEL SANTA |
| 822 | CMAC ICA |
| 824 | CMAC PIURA |
| 826 | CMAC MAYNAS |
| 828 | CMAC PAITA |
| 900 | CRAC SIPAN |
| 902 | CRAC DEL CENTRO |
| 904 | CRAC INCASUR |
| 906 | CRAC PRYMERA |
| 908 | CRAC LOS ANDES |

**Nota:** BCP (código 002) es el primer banco a implementar en `BankFileExporter` según `especificaciones-fases.md`; esta tabla ya cubre la arquitectura extensible a BBVA (011), Interbank (003) y Scotiabank (009) mencionada en el goal.

## Tabla 37 — Organizaciones Sindicales de Servidores Públicos

**Catálogo grande y vivo — 5,245 filas** (incorporada por R.M. 170-2023-TR, actualizada R.M. 286-2023-TR). Estructura: N° de orden, código de organización, nombre, código de organización de orden superior, nivel, RUC del empleador, fecha de incorporación/modificación/cancelación. Exportado completo en `docs/seed-data/t37_organizaciones_sindicales.csv`. Fuera de alcance de Fase 1 (solo aplica a entidades públicas vía E31).

## Anexo: Tabla 16-B — Reglas de Aplicabilidad de Campos por Tipo de Trabajador

Matriz de validación complementaria (no listada en el índice "RESUMEN" pero presente en el archivo como hoja `TM B Trabajadores`, 71 filas × 24 columnas relevantes) que indica, para cada tipo de trabajador (código Tabla 8), qué grupos de campos aplican: Datos Personales (nacionalidad, dirección/municipalidad, estado civil, discapacidad, condición de domicilio, nivel educativo, teléfono, email) y Datos Laborales (ocupación, tipo de trabajador, tipo de contrato, afiliación EPS, régimen pensionario, SCTR, tipo de remuneración, periodicidad, sujeto a control inmediato, sindicalizado, EsSalud Vida). Exportada completa en `docs/seed-data/tm_b_reglas_aplicabilidad_tipo_trabajador.csv`.

**Uso recomendado:** motor de validación de `Ficha de Alta de Trabajador` (Módulo 1) — antes de aceptar un campo, verificar contra esta matriz si aplica al tipo de trabajador seleccionado, en vez de codificar las exclusiones "No aplica a TT: ..." dispersas en cada estructura de Anexo 3 una por una.

---

## Resumen de archivos CSV generados (seed data)

| Archivo | Filas | Tabla origen |
|---|---|---|
| `t1_actividad.csv` | 294 | Tabla 1 — Tipo de Actividad (CIIU) |
| `t4_nacionalidad.csv` | 275 | Tabla 4 — Nacionalidad |
| `t10_ocupacion_sector_publico.csv` | 4,755 | Tabla 10 — Ocupación Sector Público |
| `t22_ingresos_tributos_descuentos.csv` | 339 | Tabla 22 — Ingresos, Tributos y Descuentos |
| `t26_pais_emisor_documento.csv` | 248 | Tabla 26 — País Emisor del Documento |
| `t28_ubigeo.csv` | 1,895 | Tabla 28 — UBIGEO RENIEC |
| `t30_ocupacion_sector_privado.csv` | 4,652 | Tabla 30 — Ocupación Sector Privado |
| `t31_pliego_presupuestal.csv` | 194 | Tabla 31 — Pliego Presupuestal |
| `t34_instituciones_educativas.csv` | 5,935 | Tabla 34 — Instituciones Educativas y Carreras |
| `t37_organizaciones_sindicales.csv` | 5,245 | Tabla 37 — Organizaciones Sindicales S.Público |
| `tm_b_reglas_aplicabilidad_tipo_trabajador.csv` | 71 | Tabla 16-B — Reglas de aplicabilidad por tipo de trabajador |

Todos incluyen fila de encabezado y están codificados en UTF-8 con BOM (compatible con Excel y `COPY ... CSV HEADER` de PostgreSQL).
