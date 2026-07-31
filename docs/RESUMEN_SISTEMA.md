# Resumen del Sistema HRMS Perú

Sistema de Gestión de Recursos Humanos (HRMS) para empresas peruanas, multi-empresa (multi-tenant) y con cumplimiento estricto de la normativa local (SUNAT, SUNAFIL, MTPE, Ley 29733).

**Estado:** Backend Fases 0–5 + módulo de cese y liquidación · 284 tests unitarios (35 suites) · Frontend completo (11 páginas) · Import/export CSV para sistemas externos

**Repositorio:** https://github.com/edwinabb/rrhh

---

## 🖥️ Frontend (Next.js — `localhost:3000`)

Frontend completo con shell autenticado: sidebar de navegación **filtrado por los permisos RBAC reales de la sesión** (vía `GET /auth/me`), header con rol y logout, redirección automática a `/login` sin sesión.

| Página | Ruta | Funcionalidad |
|--------|------|---------------|
| **Login** | `/login` | Email/contraseña → cookie de sesión httpOnly (nunca hay token en JavaScript). |
| **Dashboard** | `/` | Tarjetas por módulo, filtradas por permisos del usuario. |
| **Asistencia** | `/asistencia` | Marcar ENTRADA/SALIDA con GPS del navegador (validación de geofence visible), resumen mensual, justificaciones con aprobación gerencial, dashboard de equipo, **import CSV desde sistema biométrico externo**. |
| **Nómina** | `/nomina` | Procesar planilla del período (con confirmación), exportes PLAME/telecrédito, **import CSV de novedades del período** (días, horas extra, bonos, descuentos). |
| **Vacaciones** | `/vacaciones` | Récord vacacional por empleado: períodos con días ganados/gozados/pendientes, registro de goce, alerta de riesgo de indemnización (art. 23 D.Leg. 713). |
| **Turnos** | `/turnos` | Catálogo de turnos (horarios), plan de asignaciones semanales (importable/editable), libro de movimientos compensatorios (intercambios, ganancias, cruces con justificación) y flujo de resolución de inconsistencias (marcación vs. plan). |
| **Liquidaciones** | `/liquidaciones` | Ceses y liquidaciones: wizard de 3 pasos (crear → revisar snapshot → calcular), desglose por concepto con base legal, semáforo del plazo de 48h, aprobar/pagar/anular según permisos. |
| **Legajo** | `/legajo` | Documentos por empleado agrupados por tipo (faltantes destacados), subida, descarga, eliminación con motivo (soft-delete), búsqueda. |
| **Reclutamiento** | `/ats` y `/ats/[id]` | Vacantes con estados, registro de candidatos con consentimiento LPDP obligatorio, CV parseado con Claude API, pipeline de estados validado, notas internas, contratación. |
| **Administración** | `/admin` | Parámetros normativos (nueva versión con vigencia), log de auditoría, empleados. |

---

## 🔌 API (NestJS — `localhost:3001/api`)

Toda la API requiere sesión (cookie) excepto el login, y cada endpoint valida un permiso RBAC específico. Cada request corre dentro de una transacción con el tenant fijado (RLS a nivel PostgreSQL: un tenant jamás ve datos de otro).

### Autenticación y Fundaciones (Fase 0)

| Endpoint | Permiso | Qué hace |
|----------|---------|----------|
| `POST /auth/login` | público | Recibe `{email, password}`, verifica con argon2, resuelve rol y permisos, crea sesión en Redis. Retorna `{ok: true}` + cookie de sesión. |
| `POST /auth/logout` | sesión | Destruye la sesión. |
| `GET /employees` | `employee.read` | Lista empleados del tenant: documento, nombres, sede, estado, manager. |
| `GET /normative-params` | `normative_param.read` | Parámetros normativos vigentes (UIT, RMV, tasas EsSalud/ONP, tramos de quinta categoría) con fechas de vigencia. |
| `POST /normative-params` | `normative_param.write` | Registra nueva versión de un parámetro (nunca se edita el anterior — versionado por vigencia). |
| `GET /audit-log` | `audit_log.read` | Log inmutable de auditoría: quién cambió qué tabla, valores anteriores/nuevos, IP, timestamp. |

### Nómina (Fase 1)

| Endpoint | Permiso | Qué hace |
|----------|---------|----------|
| `POST /payroll/:periodo/procesar` | `payroll.process` | Procesa la planilla del período (ej. `2026-07`): para cada empleado activo calcula remuneración, asignación familiar (Ley 25129), retención AFP/ONP, quinta categoría proyectada, aporte EsSalud, y guarda el detalle por concepto con el neto a pagar. Transiciona la planilla a "procesado". |
| `GET /payroll/:periodo/export/plame` | `payroll.export` | Exporta la Estructura 18 del PLAME (SUNAT): una línea por concepto `tipo_doc\|num_doc\|código\|devengado\|pagado`. *(Endpoint declarado; la lectura desde BD está pendiente de conectar.)* |
| `GET /payroll/:periodo/export/telecredito` | `payroll.export` | Genera el archivo de telecrédito BCP para pago masivo de haberes: `documento\|cuenta\|monto`. *(Mismo estado que el anterior.)* |
| `GET /payroll/import/plantilla` | `payroll.import` | Descarga la plantilla CSV de novedades: `numero_documento,dias_laborados,horas_extra_25,horas_extra_35,bonificaciones,descuentos`. |
| `POST /payroll/:periodo/import` | `payroll.import` | Importa novedades del período (upsert por empleado+período; re-importar actualiza). El motor las incorpora al procesar: horas extra con recargo sobre el valor-hora del contrato, bonos, descuentos y prorrateo por días laborados. Retorna `{procesadas, omitidas, errores[{fila, mensaje}]}`. |

**Calculadores implementados (funciones puras, testeadas):** CTS, Gratificación (Ley 30334), AFP/ONP, EsSalud, Asignación Familiar, Quinta Categoría (proyección anual progresiva), Utilidades, Liquidación de beneficios sociales.

### Asistencia (Fase 2 — feature-complete)

| Endpoint | Permiso | Qué hace |
|----------|---------|----------|
| `POST /attendance/marcaciones` | `attendance.mark` | Registra entrada/salida/justificación con GPS y biometría opcional. Valida geofence de la sede (Haversine contra radio configurado), score biométrico contra el umbral del tenant, secuencia (no doble entrada), y calcula tardanza. La marcación es **append-only** (SUNAFIL): si es inválida se persiste como bloqueada con motivo, nunca se edita ni borra. Al marcar salida recalcula el resumen del día e inserta horas extra si superó la jornada. |
| `POST /attendance/justificaciones` | `attendance.justify` | Crea solicitud de justificación (tardanza, falta, permiso, licencia...) con descripción y documento adjunto opcional. Queda PENDIENTE. |
| `PUT /attendance/justificaciones/:id/resolver` | `attendance.approve` | El gerente aprueba o rechaza. Al aprobar, el día deja de contar como falta en el resumen. |
| `GET /attendance/resumen/:periodo` | `attendance.read` | Resumen del período por día: hora entrada/salida, horas trabajadas, tardanza en minutos, faltas y si están justificadas. |
| `GET /attendance/dashboard/:periodo` | `attendance.read.team` | Vista gerencial agregada del equipo. |
| `GET /attendance/import/plantilla` | `attendance.import` | Descarga la plantilla CSV para relojes biométricos externos: `numero_documento,fecha,hora,tipo` (una fila por evento). |
| `POST /attendance/import` | `attendance.import` | Importa marcaciones desde el CSV: crea marcaciones append-only, **deduplica** (re-importar el mismo archivo no duplica), acumula errores por fila sin abortar, y recalcula automáticamente el resumen diario y las horas extra. Retorna `{procesadas, omitidas, errores[{fila, mensaje}]}`. |

**Integración interna:** el módulo exporta horas computables y horas extra (con recargo 25%/35% según D.Leg. 854) hacia el cálculo de nómina.

### Documental (Fase 3 — MVP)

| Endpoint | Permiso | Qué hace |
|----------|---------|----------|
| `POST /documents` | `documents.upload` | Sube documento al legajo (contrato, CV, DNI, certificado...). Guarda el binario en MinIO, y en BD los metadatos: checksum MD5, tamaño, versión. Si ya existe uno del mismo tipo, crea versión incremental. |
| `GET /documents/search` | `documents.read` | Busca por empleado, tipo y rango de fechas. |
| `GET /documents/:id/download` | `documents.read` | Descarga el archivo desde MinIO con sus metadatos. |
| `GET /documents/legajo/:employeeId` | `documents.read` | Vista del legajo completo: documentos activos agrupados por tipo + qué tipos requeridos faltan. |
| `DELETE /documents/:id` | `documents.delete` | **Soft-delete** con motivo obligatorio (derecho al olvido, Ley 29733). La fila nunca se borra; a nivel de BD ningún rol tiene DELETE. |

### ATS / Reclutamiento (Fase 4 — MVP)

| Endpoint | Permiso | Qué hace |
|----------|---------|----------|
| `POST /ats/vacantes` | `ats.manage` | Crea vacante: título, descripción, requisitos (JSON), rango salarial. Nace ABIERTA. |
| `GET /ats/vacantes` | `ats.read` | Lista vacantes, filtrable por estado. |
| `PUT /ats/vacantes/:id/cerrar` | `ats.manage` | Cierra la vacante (deja de aceptar candidatos). |
| `POST /ats/vacantes/:id/candidatos` | `ats.apply` | Registra candidato con su CV en texto. **Exige consentimiento LPDP** (sin él se rechaza). Invoca Claude API para parsear el CV y guarda el JSON estructurado: experiencia, habilidades, formación, idiomas. Email único por vacante, rate limit por tenant. |
| `PUT /ats/candidatos/:id/estado` | `ats.manage` | Transiciones validadas: APLICADO → REVISADO → ENTREVISTA → OFERTA → CONTRATADO/RECHAZADO (rechazo permitido desde cualquier estado). |
| `POST /ats/candidatos/:id/notas` | `ats.manage` | Notas internas de RRHH sobre el candidato. |
| `PUT /ats/candidatos/:id/contratar` | `ats.manage` | OFERTA → CONTRATADO y vincula al candidato con su registro `Employee` (migración formal según D.Leg. 728). |

### Turnos (Fase 5 — feature-complete)

| Endpoint | Permiso | Qué hace |
|----------|---------|----------|
| `GET /turnos` | `shift.read` | Lista todos los turnos del tenant: nombre, horario inicio/fin, duración, tolerancia. |
| `POST /turnos` | `shift.manage` | Crea un nuevo turno (catálogo): nombre único, hora inicio/fin, duración total, tolerancia de entrada (minutos). |
| `PUT /turnos/:id` | `shift.manage` | Actualiza catálogo de turno (nombre, horario, tolerancia). No afecta asignaciones existentes. |
| `GET /turno-asignaciones?periodo=YYYY-MM` | `shift.read` | Plan semanal: quién está asignado a qué turno cada día. Manager ve su equipo; RRHH ve toda la empresa; Employee solo su plan. |
| `POST /turno-asignaciones/import` | `shift.manage` | Importa plan desde CSV (empleado, fecha, turno) usando upsert — re-importar actualiza. Retorna `{procesadas, omitidas, errores[{fila, mensaje}]}`. |
| `PUT /turno-asignaciones/:id` | `shift.manage` | Edita la asignación de un día (cambiar turno, cancelar). Dispara recálculo de horas extra si es turno de noche. |
| `GET /compensatorio-movimientos?periodo=YYYY-MM` | `shift.read` | Libro de cambios: intercambios (empleado X cubre Y en fecha Z), ganancias (se le debe un día al empleado) y cruces (marcación diferente al plan). Resueltos (APROBADO, RECHAZADO) e irresueltos (PENDIENTE). |
| `POST /compensatorio-movimientos/:id/resolver` | `shift.manage` | RRHH registra resultado: si es diferencia marcación vs. plan (cruce), categoriza como intercambio/ganancia/error. Calcula deuda o crédito y lo reserva en tabla `CompensatorioSaldo`. |
| `GET /compensatorio-movimientos/saldo/:employeeId` | `shift.read` | Saldo actual del empleado: días que se le deben vs. días que debe. |
| `PUT /compensatorio-movimientos/:id/marcar-goce` | `shift.manage` | En la vista del plan, marcar una celda como "DC" (día compensatorio) para que el empleado goce un día adeudado. Valida saldo > 0. |

**Cálculo de horas y tolerancia:**
- Turno ENTRADA hasta SALIDA, diferencia es base de horas
- Si la entrada está dentro de la tolerancia configurada, cero tardanza
- Horas extra: si las horas totales > jornada estándar (8h/48h), recargo 25%/35% (D.Leg. 854)
- Turno nocturno (salida al día siguiente): fecha del resumen es del INICIO (lunes noche → resumen lunes, marcación hasta martes 08:00)

**Flujo de resolución:**
1. Sistema detecta diferencia: marcación muestra entrada 20:31 pero plan es 20:00 → CRUCE
2. RRHH revisa, elige categoría: intercambio (X cubrió), ganancia (se le debe), error (justificante)
3. Si ganancia: crea asiento en libro con saldo; empleado puede goce posterior (marcar DC)

### Turnos (Fases 6-9 — Autoservicio + Gestión Avanzada)

**4 features independientes con tabs dedicados en la UI `/turnos`. Especificación: `docs/superpowers/specs/2026-07-18-turnos-mejoras-phase-6-9.md`. Plan: `docs/superpowers/plans/2026-07-18-turnos-mejoras-phase-6-9.md`**

| # | Feature | Usuario | Endpoint | Permiso | Descripción |
|---|---------|---------|----------|---------|-------------|
| 1 | **Patrones de Rotación** | Manager | `POST /turnos/patrones` | `shift.manage` | Define patrón recurrente (ej: 2 DIA + 2 NOCHE + 2 DESC + 1 DESC); inyecta masivamente al plan de múltiples empleados. |
| | | | `GET /turnos/patrones` | `shift.read` | Lista patrones activos. |
| | | | `PUT /turnos/patrones/:id` | `shift.manage` | Edita patrón (nombre, secuencia). |
| | | | `POST /turnos/patrones/:id/aplicar` | `shift.manage` | Aplica patrón: multi-select empleados, rango fechas, preview, inyecta masivo con upsert. |
| 2 | **Cambios de Turno** | Empleado | `POST /turnos/cambios/solicitar` | `shift.read` | Empleado solicita cambiar turno en fecha específica (reemplazo + motivo); queda PENDIENTE. |
| | | Manager | `GET /turnos/cambios` | `shift.manage` | Manager revisa solicitudes (PENDIENTE/APROBADA/RECHAZADA). |
| | | | `PUT /turnos/cambios/:id/aprobar` | `shift.manage` | Aprueba cambio; actualiza asignación. |
| | | | `PUT /turnos/cambios/:id/rechazar` | `shift.manage` | Rechaza con motivo; empleado puede reintentar. |
| 3 | **Validación de Horas Extra / Trabajo Fuera de Turno** | Empleado/Manager | `POST /turnos/reportes-trabajo-extra` | `shift.read` | Empleado reporta trabajo fuera de turno: tarea, fecha, horas, fotos (con timestamp). Queda PENDIENTE_VALIDACION. |
| | | Director/RRHH | `GET /turnos/reportes-trabajo-extra` | `shift.manage` | Listar reportes (filtrable por estado: PENDIENTE_VALIDACION, APROBADO, RECHAZADO). |
| | | | `POST /turnos/reportes-trabajo-extra/:id/validar` | `shift.resolve` | Director/RRHH valida: inspecciona fotos/descripción, genera compensatorio (DESCANSO_COMPENSATORIO o PAGO_EXTRA según contrato). |
| | | | `PUT /turnos/reportes-trabajo-extra/:id/rechazar` | `shift.resolve` | Rechaza; empleado puede reintentar (loop infinito hasta validación). |
| 4 | **Portal de Intercambios** | Empleado | `POST /turnos/intercambios/proponer` | `shift.read` | Empleado A propone intercambiar turno en fecha X con empleado B. Queda PENDIENTE_B. |
| | | | `GET /turnos/intercambios` | `shift.read` | Mi bandeja de intercambios (propuestos por mí, asignados a mí, resueltos). |
| | | | `PUT /turnos/intercambios/:id/aceptar` | `shift.read` | Empleado B acepta; Manager recibe notificación para aprobación. |
| | | | `PUT /turnos/intercambios/:id/rechazar` | `shift.read` | Empleado B rechaza; se cierra sin cambios. |
| | | Manager | `GET /turnos/intercambios/pendientes-manager` | `shift.manage` | Manager aprueba/rechaza intercambios aceptados. |
| | | | `PUT /turnos/intercambios/:id/aprobar` | `shift.manage` | Ejecuta swap de asignaciones en plan (neutral para compensatorios). |
| | | | `PUT /turnos/intercambios/:id/rechazar` | `shift.manage` | Rechaza swap; se revierte propuesta. |

**Principios de diseño (Fases 6-9):**
- Cada feature es **independiente**: ciclo de vida separado, permisos RBAC distintos, implementación en sprints paralelos (Sprint 6, 7, 8, 9).
- **Datos privados:** Feature 3 solo muestra `horasAcumuladas`, `causaHorasExtras`, `saldoCompensatorios` a Manager/Director (no visible a Empleado).
- **Intercambios neutrales:** Feature 4 no genera movimientos compensatorios (swap puro: X cubre Y en fecha Z, Y cubre X en fecha W).
- **Fotos con timestamp:** Feature 3 requiere que el timestamp esté **visible en la imagen** (no solo metadata), capturado por navegador/cámara.
- **Reporte rechazado = reentrega:** Feature 3 permite loop infinito de correcciones hasta VALIDADA.
- **Notificaciones por cambio de estado:** Email + in-app en cada transición (pendiente/aprobada/rechazada/validada).
- **Auditoría completa:** quién, cuándo, decisión, motivo (si aplica).

### Cese y Liquidación

| Endpoint | Permiso | Qué hace |
|----------|---------|----------|
| `GET /vacaciones/periodos?employeeId=` | `vacation.read` | Récord vacacional del empleado: períodos con días ganados/gozados y estado (EN_CURSO, VENCIDO_PENDIENTE, GOZADO, LIQUIDADO). |
| `POST /vacaciones/periodos` | `vacation.manage` | Crea un período vacacional (aniversario de ingreso); los días ganados salen del régimen del contrato (30 general/agrario, 15 MYPE). |
| `PUT /vacaciones/periodos/:id` | `vacation.manage` | Actualiza días gozados, estado o notas (validación manual de rango y estado). |
| `POST /ceses` | `termination.manage` | Registra el cese (empleado, fecha, motivo) y **pre-llena el snapshot** desde contrato, régimen pensionario, récord vacacional, horas extra y planillas del ejercicio. Nace BORRADOR; calcula la fecha límite de pago (48h, D.S. 001-97-TR). |
| `GET /ceses` · `GET /ceses/:id` | `termination.read` | Listado y detalle con datos del empleado. |
| `PUT /ceses/:id/datos` | `termination.manage` | RRHH corrige cualquier dato del snapshot; toda corrección regresa el cese a BORRADOR e invalida el cálculo anterior. |
| `POST /ceses/:id/calcular` | `termination.manage` | Ejecuta el motor de liquidación con parámetros normativos vigentes a la fecha de cese: CTS/grati truncas (con factor MYPE), vacaciones devengadas/truncas/indemnización, indemnización por despido, matriz de afectación (ONP/AFP y 5ta solo sobre conceptos afectos). Transiciona a CALCULADA. |
| `POST /ceses/:id/aprobar` | `termination.approve` | Valida completitud (derechohabientes en FALLECIMIENTO), **genera los 4 PDFs al legajo** (hoja de liquidación, certificado de trabajo, constancia de cese, certificado de retenciones 5ta), cesa al empleado y liquida sus períodos vacacionales. Si MinIO falla, el estado no avanza. |
| `POST /ceses/:id/pagar` | `termination.approve` | Registra el pago; si excede el plazo de 48h marca `pagoFueraDePlazo` (evidencia para SUNAFIL). |
| `POST /ceses/:id/anular` | `termination.approve` | Anula con motivo obligatorio; desde APROBADA revierte el estado del empleado y sus vacaciones. Un cese PAGADA no se anula. |

**Flujo de estados:** BORRADOR → CALCULADA → APROBADA → PAGADA (ANULADA desde cualquiera salvo PAGADA). Regla a nivel BD: un solo cese vigente por empleado (índice único parcial).

---

## 🔐 Matriz de acceso por rol

| Capacidad | Admin | RRHH | Manager | Employee |
|-----------|-------|------|---------|----------|
| Procesar/exportar nómina | ✓ | ✓ | ✗ | ✗ |
| Ver récord vacacional | ✓ | ✓ | ✓ | ✗ |
| Gestionar récord vacacional | ✓ | ✓ | ✗ | ✗ |
| Ver catálogo y plan de turnos | ✓ | ✓ | ✓ | ✓ |
| Gestionar catálogo y plan de turnos | ✓ | ✓ | ✗ | ✗ |
| Resolver diferencias (turnos) | ✓ | ✓ | ✗ | ✗ |
| Registrar ceses y calcular liquidaciones | ✓ | ✓ | ✗ | ✗ |
| Aprobar/pagar/anular liquidaciones | ✓ | ✗ | ✗ | ✗ |
| Marcar asistencia / justificar | ✓ | ✓ | ✓ | ✓ |
| Aprobar justificaciones / dashboard equipo | ✓ | ✓ | ✓ | ✗ |
| Subir documentos | ✓ | ✓ | ✗ | ✗ |
| Eliminar documentos | ✓ | ✗ | ✗ | ✗ |
| Gestionar vacantes/candidatos | ✓ | ✓ | ✗ | ✗ |
| Importar CSV (asistencia/novedades/turnos) | ✓ | ✓ | ✗ | ✗ |
| Parámetros normativos (escribir) | ✓ | ✗ | ✗ | ✗ |

---

## 🏗️ Arquitectura y stack

| Capa | Tecnología |
|------|-----------|
| Backend | NestJS + TypeScript |
| Base de datos | PostgreSQL 16 + Prisma ORM + RLS (Row-Level Security) |
| Sesiones/colas | Redis + BullMQ |
| Almacenamiento de archivos | MinIO (S3-compatible) |
| IA | Claude API (parsing de CVs) |
| Frontend | Next.js 14 + Tailwind CSS |
| Testing | Jest — TDD, 246 tests unitarios |

**Principios de diseño:**
- **Multi-tenant con RLS:** el aislamiento entre empresas se garantiza a nivel de base de datos, no solo de aplicación.
- **Cálculos como funciones puras:** todos los calculadores de nómina y asistencia son funciones sin efectos secundarios, con parámetros normativos como argumentos (nunca hardcodeados).
- **Parámetros normativos versionados:** UIT, RMV, tasas y tramos viven en la tabla `normative_parameter` con fechas de vigencia — un cambio regulatorio no requiere redespliegue.
- **Auditoría inmutable:** triggers de PostgreSQL registran todo cambio en un log append-only que nadie (ni Admin) puede alterar.
- **Append-only donde la ley lo exige:** marcaciones de asistencia (SUNAFIL) y documentos (soft-delete) protegidos a nivel de privilegios de BD.

---

## 📋 Cumplimiento normativo peruano

| Norma | Aplicación en el sistema |
|-------|--------------------------|
| D.Leg. 728 | Régimen laboral general, contratos, migración candidato→empleado |
| Ley 30334 | Gratificaciones + bonificación extraordinaria (9% EsSalud / 6.75% EPS) |
| Ley 25129 | Asignación familiar (10% RMV con dependientes) |
| D.Leg. 854 / D.S. 007-2002-TR | Jornada 8h/48h y recargos de horas extra 25%/35% |
| D.Leg. 910 (SUNAFIL) | Marcaciones de asistencia inalterables (append-only a nivel BD) |
| Ley 29733 (LPDP) | Consentimiento en candidatos y documentos, derecho al olvido (soft-delete) |
| SUNAT PLAME | Exportador Estructura 18 con validación de códigos no declarables |
| Ley Impuesto a la Renta | Quinta categoría: proyección anual, 7 UIT de deducción, tramos progresivos 8–30% |

---

## 🚀 Cómo probar en local

```bash
# 1. Infraestructura
docker-compose up -d          # PostgreSQL, Redis, MinIO

# 2. Base de datos
cd packages/database
pnpm migrate:deploy && pnpm seed

# 3. Servicios
pnpm --filter @rrhh/api dev   # API en http://localhost:3001/api
pnpm --filter @rrhh/web dev   # Web en http://localhost:3000
```

**Credenciales demo:**

| Email | Contraseña | Rol |
|-------|-----------|-----|
| `admin@demo.pe` | `Admin123!` | Admin (todos los permisos) |
| `rrhh@demo.pe` | `Rrhh123!` | RRHH (nómina, asistencia, documentos, ATS) |
| `empleado@demo.pe` | `Empleado123!` | Employee (autoservicio) |

---

## 🗺️ Pendientes (próximo ciclo)

Ver el detalle priorizado en `docs/PENDIENTES.md`. Titulares:

- **Nómina:** conectar los endpoints de exportación PLAME/telecrédito a la lectura real de BD; exportadores para BBVA, Interbank y Scotiabank; estructuras SUNAT adicionales (E04, E05, E11, E14, E15, E26, E30).
- **Asistencia:** mapeo automático del formato del sistema biométrico chino de la empresa (a la espera del archivo de ejemplo).
- **IA:** configurar `ANTHROPIC_API_KEY` real para el parsing de CVs.
- **Documental:** firmas digitales y workflows de aprobación.
- **ATS:** scoring automático de candidatos y pipeline visual (Kanban).

---

*Documento actualizado el 2026-07-17 con el módulo de cese y liquidación (rama `feat/liquidacion-cese`).*
