# HRMS Perú — Sistema de Gestión de Recursos Humanos

Sistema full-stack de gestión de recursos humanos (HRMS) para empresas peruanas con **cumplimiento estricto de normativa local** (SUNAT, SUNAFIL, MTPE). Multi-empresa (multi-tenant), soporta múltiples regímenes laborales y escala de 10 a 5,000 trabajadores.

## 📋 Fases del Proyecto

| Fase | Módulo | Estado | Tests |
|------|--------|--------|-------|
| **0** | Fundaciones (Auth, RBAC, Multi-tenancy, Auditoría) | ✅ Completada | 6 |
| **1** | Nómina (CTS, gratificaciones, quinta categoría, SUNAT) | ✅ Completada | 37 |
| **2** | Asistencia (Marcaciones append-only, geofencing, horas extra) | ✅ Completada (feature-complete) | 78 |
| **3** | Documental (Legajo digital, MinIO, versionado, Ley 29733) | ✅ Completada (MVP) | 24 |
| **4** | ATS/Reclutamiento (Vacantes, parsing CVs con Claude API) | ✅ Completada (MVP) | 37 |

**Total: 208 tests unitarios pasando (26 suites), TDD estricto. Frontend completo (8 páginas con RBAC) + import/export CSV para sistemas de asistencia externos.**

## 🚀 Inicio Rápido

### Requisitos
- Node.js ≥ 20
- pnpm ≥ 9
- Docker & Docker Compose

### Instalación

```bash
# Clonar el repositorio
git clone https://github.com/edwinabb/rrhh.git
cd rrhh

# Levantar infraestructura (PostgreSQL, Redis, MinIO)
docker-compose up -d

# Instalar dependencias
pnpm install

# Configurar variables de entorno
cp .env.example .env
cp apps/web/.env.local.example apps/web/.env.local

# Ejecutar migraciones y seed
cd packages/database
pnpm migrate:deploy
pnpm seed
cd ../..

# Ejecutar tests
pnpm test

# Iniciar desarrollo
pnpm dev
# API: http://localhost:3001
# Web: http://localhost:3000
```

## 📂 Estructura del Proyecto

```
rrhh/
├── apps/
│   ├── api/              # NestJS backend (Port 3001)
│   │   └── src/modules/
│   │       ├── auth/     # Autenticación & RBAC
│   │       ├── payroll/  # Nómina (Fase 1)
│   │       ├── attendance/ # Asistencia (Fase 2)
│   │       ├── documents/ # Documental (Fase 3)
│   │       └── ats/      # Reclutamiento (Fase 4)
│   └── web/             # Next.js frontend (Port 3000)
├── packages/
│   ├── database/        # Prisma ORM + migraciones
│   └── config/          # Configuración compartida
└── docs/
    └── superpowers/
        ├── plans/       # Planes de cada fase
        └── specs/       # Especificaciones detalladas
```

## 🏗️ Stack Técnico

- **Backend:** NestJS + TypeScript
- **BD:** PostgreSQL 16 + Prisma ORM + RLS
- **Almacenamiento:** MinIO (S3-compatible)
- **Colas:** BullMQ + Redis
- **Testing:** Jest (TDD)
- **Frontend:** Next.js 14 + TypeScript + Tailwind CSS
- **IA:** Anthropic Claude Opus 4.8 (parsing CVs)

## 📊 Módulos Implementados

### Fase 1 — Nómina ✅
Calculadores puros: CTS, Gratificación (Ley 30334), AFP/ONP, EsSalud, Asignación Familiar (Ley 25129), Quinta Categoría (proyección anual progresiva), Utilidades, Liquidación. Orquestador `PayrollRunService`, exportadores PLAME Estructura 18 (SUNAT) y telecrédito BCP.

### Fase 2 — Asistencia ✅ (feature-complete)
Marcaciones **append-only** (SUNAFIL D.Leg. 910: sin UPDATE/DELETE a nivel BD), geofencing con Haversine, biometría con provider inyectable (mock MVP), justificaciones con flujo de aprobación, horas extra D.Leg. 854 (recargo 25%/35%), resumen diario de asistencia y export de horas computables a nómina.

### Fase 3 — Documental ✅ (MVP)
Legajo digital por empleado, almacenamiento MinIO con interfaz inyectable, versionado de documentos, checksum MD5, soft-delete con motivo (derecho al olvido, Ley 29733), búsqueda y vista de legajo con tipos faltantes.

### Fase 4 — ATS ✅ (MVP)
Vacantes y candidatos con consentimiento LPDP obligatorio, parsing de CV con Claude API (conector fetch inyectable, rate limit por tenant), transiciones de estado validadas (aplicado → revisado → entrevista → oferta → contratado/rechazado), notas internas, contratación con vínculo a `Employee` (D.Leg. 728).

### Frontend ✅ (8 páginas)
Shell autenticado con sidebar filtrado por permisos RBAC (`GET /auth/me`), páginas de Asistencia (marcación GPS + import CSV de relojes biométricos), Nómina (procesar período + import CSV de novedades), Legajo, ATS (pipeline con consentimiento LPDP) y Administración. Credenciales demo: `admin@demo.pe`/`Admin123!`, `rrhh@demo.pe`/`Rrhh123!`, `empleado@demo.pe`/`Empleado123!`.

### Pendiente (fases futuras)
Ver `docs/PENDIENTES.md` para el backlog priorizado: conexión de exportes PLAME/telecrédito a BD, mapeo del sistema biométrico externo, firmas digitales, Kanban ATS, exportadores bancarios adicionales.

## 🧪 Testing

```bash
# Todos los tests
pnpm test

# Tests de módulo específico
pnpm --filter @rrhh/api test cts.calculator

# Tests de integración
pnpm test:integration
```

**Cobertura actual:** 208 tests passed, 26 suites (Fases 0–4 + import CSV)

## 📚 Documentación

- `goal.md` — Objetivo y requisitos completos del proyecto
- `docs/superpowers/specs/` — Especificaciones detalladas por fase
- `docs/superpowers/plans/` — Planes de implementación con tareas

## 🔐 Seguridad

- **RLS (Row-Level Security):** Aislamiento multi-tenant a nivel BD
- **RBAC:** Roles granulares (Admin, RRHH, Manager, Employee)
- **Auditoría:** Log inmutable de todas las operaciones
- **Cifrado:** En tránsito (TLS) y en reposo (datos sensibles)
- **Permisos:** Nivel de fila y columna (ej: managers no ven salarios de reportes)

## 🌍 Cumplimiento Normativo Peruano

- **SUNAT:** Generación de archivos T-Registro y PDT PLAME
- **SUNAFIL:** Registros de asistencia inalterables (append-only)
- **Regímenes Laborales:** General (D.Leg. 728), MYPE, Agrario, extensible
- **Beneficios Sociales:** CTS, Gratificaciones, Utilidades, Vacaciones
- **Impuestos:** Quinta categoría, AFP, ONP, EsSalud
- **Protección de Datos:** Cumplimiento Ley 29733

## 📝 Convenciones de Código

- **Commits:** Español, formato `feat(fase1): descripción`
- **Nombres:** Spanish en modelos/BD, English en código
- **Tests:** TDD (Red → Green → Refactor)
- **Sin Funciones Puras Hardcodeadas:** Todos los parámetros normativos viven en `NORMATIVE_PARAMETER`

## 🤝 Contribuir

1. Crear rama feature: `git checkout -b feature/fase1-xxx`
2. Desarrollo con TDD (test → implementación)
3. Commit atómicos: `git commit -m "feat(fase1): descripción"`
4. Crear Pull Request contra `main`

## 📄 Licencia

Proyecto privado. Contactar a info@reporta.la para detalles.

## 📞 Contacto

- **Email:** info@reporta.la
- **Repositorio:** https://github.com/edwinabb/rrhh

---

**Estado:** Fase 1 en progreso. Próxima milestone: Calculadores de EsSalud, Asignación Familiar y Quinta Categoría.
