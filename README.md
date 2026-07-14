# HRMS Perú — Sistema de Gestión de Recursos Humanos

Sistema full-stack de gestión de recursos humanos (HRMS) para empresas peruanas con **cumplimiento estricto de normativa local** (SUNAT, SUNAFIL, MTPE). Multi-empresa (multi-tenant), soporta múltiples regímenes laborales y escala de 10 a 5,000 trabajadores.

## 📋 Fases del Proyecto

| Fase | Módulo | Estado | Tareas |
|------|--------|--------|--------|
| **0** | Fundaciones (Auth, RBAC, Multi-tenancy, Auditoría) | ✅ Completada | - |
| **1** | Nómina (CTS, gratificaciones, quinta categoría, SUNAT) | 🚀 En Progreso (4/11) | 11 tareas |
| **2** | Asistencia (Marcaciones, geofencing, horas extra) | ⏳ Pendiente | 8 tareas |
| **3** | Documental y Firma (Legajo, firma masiva, ESS) | ⏳ Pendiente | 7 tareas |
| **4** | ATS/Reclutamiento (Pipeline, parsing CVs con IA) | ⏳ Pendiente | 8 tareas |

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

## 📊 Fase 1 — Nómina (En Progreso)

### Calculadores de Nómina Implementados ✅

1. **CtsCalculator** — Depósito semestral (mayo, noviembre) con prorrateo
2. **GratificacionCalculator** — Gratificación + bonificación extraordinaria Ley 30334
3. **AfpOnpCalculator** — Retenciones pensionarias (AFP, ONP)

### Próximas Tareas

- [ ] EssaludCalculator + AsignacionFamiliarCalculator
- [ ] QuintaCategoriaCalculator (proyección anual)
- [ ] UtilidadesCalculator (reparto por días/remuneración)
- [ ] LiquidacionCalculator (beneficios truncos al cese)
- [ ] PayrollRunService (orquestador del ciclo)
- [ ] PlanillaExporter (archivos PLAME/T-Registro SUNAT)
- [ ] BankFileExporter (telecrédito BCP)

## 🧪 Testing

```bash
# Todos los tests
pnpm test

# Tests de módulo específico
pnpm --filter @rrhh/api test cts.calculator

# Tests de integración
pnpm test:integration
```

**Cobertura actual:** 20 tests passed (Fase 0 + Fase 1)

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
