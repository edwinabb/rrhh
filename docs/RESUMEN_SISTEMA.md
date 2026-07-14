# Resumen del Sistema HRMS Perú

Sistema de Gestión de Recursos Humanos (HRMS) para empresas peruanas, multi-empresa (multi-tenant) y con cumplimiento estricto de la normativa local (SUNAT, SUNAFIL, MTPE, Ley 29733).

**Estado:** Backend Fases 0–4 operativo · 182 tests unitarios (24 suites) · Frontend en estado inicial (login)

**Repositorio:** https://github.com/edwinabb/rrhh

---

## 🖥️ Frontend (Next.js — `localhost:3000`)

El frontend está en su estado mínimo. Tiene **2 páginas**:

| Página | Ruta | Funcionalidad |
|--------|------|---------------|
| **Home** | `/` | Página de bienvenida con acceso al login. |
| **Login** | `/login` | Formulario email/contraseña. Autentica contra `POST /api/auth/login` y guarda la sesión en cookie httpOnly (nunca hay token en JavaScript). |

**Todo lo demás se opera hoy por API.** Los dashboards de nómina, asistencia, documentos y ATS son el principal pendiente de frontend.

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

**Calculadores implementados (funciones puras, testeadas):** CTS, Gratificación (Ley 30334), AFP/ONP, EsSalud, Asignación Familiar, Quinta Categoría (proyección anual progresiva), Utilidades, Liquidación de beneficios sociales.

### Asistencia (Fase 2 — feature-complete)

| Endpoint | Permiso | Qué hace |
|----------|---------|----------|
| `POST /attendance/marcaciones` | `attendance.mark` | Registra entrada/salida/justificación con GPS y biometría opcional. Valida geofence de la sede (Haversine contra radio configurado), score biométrico contra el umbral del tenant, secuencia (no doble entrada), y calcula tardanza. La marcación es **append-only** (SUNAFIL): si es inválida se persiste como bloqueada con motivo, nunca se edita ni borra. Al marcar salida recalcula el resumen del día e inserta horas extra si superó la jornada. |
| `POST /attendance/justificaciones` | `attendance.justify` | Crea solicitud de justificación (tardanza, falta, permiso, licencia...) con descripción y documento adjunto opcional. Queda PENDIENTE. |
| `PUT /attendance/justificaciones/:id/resolver` | `attendance.approve` | El gerente aprueba o rechaza. Al aprobar, el día deja de contar como falta en el resumen. |
| `GET /attendance/resumen/:periodo` | `attendance.read` | Resumen del período por día: hora entrada/salida, horas trabajadas, tardanza en minutos, faltas y si están justificadas. |
| `GET /attendance/dashboard/:periodo` | `attendance.read.team` | Vista gerencial agregada del equipo. |

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

---

## 🔐 Matriz de acceso por rol

| Capacidad | Admin | RRHH | Manager | Employee |
|-----------|-------|------|---------|----------|
| Procesar/exportar nómina | ✓ | ✓ | ✗ | ✗ |
| Marcar asistencia / justificar | ✓ | ✓ | ✓ | ✓ |
| Aprobar justificaciones / dashboard equipo | ✓ | ✓ | ✓ | ✗ |
| Subir documentos | ✓ | ✓ | ✗ | ✗ |
| Eliminar documentos | ✓ | ✗ | ✗ | ✗ |
| Gestionar vacantes/candidatos | ✓ | ✓ | ✗ | ✗ |
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
| Testing | Jest — TDD, 182 tests unitarios |

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

- **Frontend:** dashboards de asistencia, nómina, legajo y ATS (hoy solo existe el login).
- **Nómina:** conectar los endpoints de exportación PLAME/telecrédito a la lectura real de BD; exportadores para BBVA, Interbank y Scotiabank; estructuras SUNAT adicionales (E04, E05, E11, E14, E15, E26, E30).
- **Documental:** firmas digitales y workflows de aprobación.
- **ATS:** scoring automático de candidatos y pipeline visual (Kanban).

---

*Documento generado el 2026-07-14. Estado del código: commit `d77f2e2` en `master`.*
