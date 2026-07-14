# HRMS Perú — Fase 0 (Fundaciones)

Ver `goal.md` para el objetivo completo del proyecto y `docs/superpowers/specs/` para el diseño detallado de cada fase. Este README cubre solo cómo levantar lo que ya existe (Fase 0).

## Arranque local

```bash
cp .env.example .env               # ajustar si hace falta
cp apps/web/.env.local.example apps/web/.env.local

docker compose up -d                # Postgres, Redis, MinIO
pnpm install

pnpm --filter @rrhh/database generate
pnpm db:migrate                     # aplica packages/database/prisma/migrations
pnpm db:seed                        # permisos, roles de sistema, parámetros normativos de referencia

pnpm dev                            # apps/api en :3001, apps/web en :3000
```

## Verificación pendiente antes de confiar en este bootstrap

La migración inicial (`packages/database/prisma/migrations/20260710000000_init_foundations/migration.sql`) se escribió a mano porque este entorno no tenía un Postgres vivo para correr `prisma migrate dev` y generar la migración real. Antes de construir Fase 1 sobre esto:

1. Levantar `docker compose up -d postgres` y correr `pnpm db:migrate` — si Prisma detecta drift entre `schema.prisma` y el SQL a mano, hay que corregir el SQL (no el schema, que sí refleja el diseño aprobado).
2. Correr `pnpm --filter @rrhh/api test:integration` contra ese Postgres — valida RLS, roles nativos y el trigger de auditoría de verdad (`apps/api/test/integration/`). Estos tests **no se ejecutaron todavía** en este entorno (sin Docker disponible al momento de escribirlos).
3. Correr `pnpm --filter @rrhh/api test` (unitarios, sin BD) — `PermissionsService` y `NormativeParameterService` sí están cubiertos con TDD y deberían pasar sin infraestructura adicional.

## Decisiones y deuda técnica reconocida de esta implementación

- **Permisos y rol de Postgres se calculan una sola vez en login** y se guardan en la sesión (Redis), no se re-consultan por request. Si un admin cambia los roles de un usuario, ese usuario debe volver a iniciar sesión para que el cambio tome efecto. Alternativa (invalidar sesiones activas al cambiar roles) queda para cuando exista la página de RBAC real (Módulo 3).
- **Vistas por rol (`employee_view_manager`/`employee_view_employee`) no tienen modelo Prisma** — Prisma no soporta bien la mezcla de tablas base + vistas en el mismo client sin overhead extra, así que `EmployeesService.list()` usa `$queryRawUnsafe` con el nombre de vista tomado de un mapa cerrado (nunca de input externo) cuando el rol activo es manager/employee, y el modelo Prisma normal para RRHH/Admin. Fase 1 debe extender esas vistas (no la tabla base) al agregar columnas de remuneración/salud.
- **Login resuelve credenciales vía una función `SECURITY DEFINER`** (`auth_lookup_user`) porque RLS estricto sobre `app_user` no permite buscar por email antes de conocer el tenant. La función vive en un rol dedicado con `BYPASSRLS` que no se usa para nada más — ver comentario en la migración, sección 3b.
- **Valores de `NORMATIVE_PARAMETER` del seed son de referencia, no confirmados** — ver `docs/superpowers/specs/validaciones-normativas-pendientes.md` antes de usarlos en cualquier cálculo real de Fase 1.

## Estructura

Ver `docs/superpowers/specs/2026-07-07-fase0-fundaciones-design.md` para la arquitectura de carpetas completa y el porqué de cada decisión (NestJS + Next.js separados, Prisma + RLS, sesiones en vez de JWT, etc.).
