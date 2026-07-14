-- Fase 0 — Fundaciones: esquema base + RLS + roles nativos + vistas + auditoría.
-- Ver docs/superpowers/specs/2026-07-07-fase0-fundaciones-design.md para el porqué de cada decisión.
--
-- NOTA: esta migración fue escrita a mano (bootstrap sin conexión a una base de datos viva) para
-- que coincida exactamente con packages/database/prisma/schema.prisma. Antes de confiar en ella,
-- correr `pnpm db:migrate` contra el Postgres de docker-compose y verificar que Prisma la acepta
-- como baseline (`prisma migrate resolve --applied` si hace falta) y que `prisma validate` no
-- reporta drift contra el schema.

-- =============================================================================
-- 0. Extensiones
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- =============================================================================
-- 1. Tablas
-- =============================================================================

CREATE TABLE "tenant" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "ruc" VARCHAR(11) NOT NULL,
    "razon_social" TEXT NOT NULL,
    "nombre_comercial" TEXT,
    "direccion_fiscal" TEXT,
    "estado" VARCHAR(20) NOT NULL DEFAULT 'activo',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "tenant_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "tenant_ruc_key" UNIQUE ("ruc")
);

CREATE TABLE "sede" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "nombre" TEXT NOT NULL,
    "direccion" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "sede_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "sede_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE
);
CREATE INDEX "sede_tenant_id_idx" ON "sede"("tenant_id");

CREATE TABLE "app_user" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "email" VARCHAR(255) NOT NULL,
    "password_hash" TEXT NOT NULL,
    "estado" VARCHAR(20) NOT NULL DEFAULT 'activo',
    "last_login_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "app_user_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "app_user_email_key" UNIQUE ("email"),
    CONSTRAINT "app_user_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE
);
CREATE INDEX "app_user_tenant_id_idx" ON "app_user"("tenant_id");

CREATE TABLE "role" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID,
    "nombre" TEXT NOT NULL,
    "descripcion" TEXT,
    "es_sistema" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "role_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "role_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE
);
CREATE INDEX "role_tenant_id_idx" ON "role"("tenant_id");

CREATE TABLE "permission" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" TEXT NOT NULL,
    "descripcion" TEXT,
    "es_sensible" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "permission_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "permission_code_key" UNIQUE ("code")
);

CREATE TABLE "user_role" (
    "user_id" UUID NOT NULL,
    "role_id" UUID NOT NULL,
    CONSTRAINT "user_role_pkey" PRIMARY KEY ("user_id", "role_id"),
    CONSTRAINT "user_role_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("id") ON DELETE CASCADE,
    CONSTRAINT "user_role_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "role"("id") ON DELETE CASCADE
);

CREATE TABLE "role_permission" (
    "role_id" UUID NOT NULL,
    "permission_id" UUID NOT NULL,
    CONSTRAINT "role_permission_pkey" PRIMARY KEY ("role_id", "permission_id"),
    CONSTRAINT "role_permission_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "role"("id") ON DELETE CASCADE,
    CONSTRAINT "role_permission_permission_id_fkey" FOREIGN KEY ("permission_id") REFERENCES "permission"("id") ON DELETE CASCADE
);

CREATE TABLE "employee" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "sede_id" UUID NOT NULL,
    "user_id" UUID,
    "manager_id" UUID,
    "tipo_documento" VARCHAR(2) NOT NULL,
    "numero_documento" VARCHAR(15) NOT NULL,
    "nombres" TEXT NOT NULL,
    "apellidos" TEXT NOT NULL,
    "estado" VARCHAR(20) NOT NULL DEFAULT 'activo',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "employee_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "employee_user_id_key" UNIQUE ("user_id"),
    CONSTRAINT "employee_tenant_doc_key" UNIQUE ("tenant_id", "tipo_documento", "numero_documento"),
    CONSTRAINT "employee_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE,
    CONSTRAINT "employee_sede_id_fkey" FOREIGN KEY ("sede_id") REFERENCES "sede"("id"),
    CONSTRAINT "employee_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("id"),
    CONSTRAINT "employee_manager_id_fkey" FOREIGN KEY ("manager_id") REFERENCES "employee"("id")
);
CREATE INDEX "employee_tenant_id_idx" ON "employee"("tenant_id");
CREATE INDEX "employee_manager_id_idx" ON "employee"("manager_id");

CREATE TABLE "normative_parameter" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "codigo" VARCHAR(64) NOT NULL,
    "valor" JSONB NOT NULL,
    "vigencia_desde" DATE NOT NULL,
    "vigencia_hasta" DATE,
    "descripcion" TEXT,
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "normative_parameter_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "normative_parameter_codigo_vigencia_desde_idx" ON "normative_parameter"("codigo", "vigencia_desde");

CREATE TABLE "audit_log" (
    "id" BIGSERIAL NOT NULL,
    "tenant_id" UUID,
    "user_id" UUID,
    "tabla" TEXT NOT NULL,
    "registro_id" UUID,
    "accion" VARCHAR(10) NOT NULL,
    "valores_anteriores" JSONB,
    "valores_nuevos" JSONB,
    "ip_origen" INET,
    "user_agent" TEXT,
    "request_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "audit_log_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE SET NULL,
    CONSTRAINT "audit_log_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("id") ON DELETE SET NULL
);
CREATE INDEX "audit_log_tenant_id_tabla_registro_id_idx" ON "audit_log"("tenant_id", "tabla", "registro_id");

-- =============================================================================
-- 2. Roles nativos de Postgres (seguridad de columna, defensa en profundidad)
-- =============================================================================
-- Roles sin LOGIN: la app se conecta con un rol propio (ej. "rrhh_app") y hace
-- `SET LOCAL ROLE app_manager` (etc.) por transacción, según el rol efectivo
-- del usuario autenticado. Esto permite que un bug de aplicación no pueda saltarse
-- el filtro de columnas, porque el permiso vive en Postgres, no solo en NestJS.

DO $$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_rrhh') THEN
        CREATE ROLE app_rrhh NOLOGIN;
    END IF;
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_manager') THEN
        CREATE ROLE app_manager NOLOGIN;
    END IF;
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_employee') THEN
        CREATE ROLE app_employee NOLOGIN;
    END IF;
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_admin') THEN
        CREATE ROLE app_admin NOLOGIN;
    END IF;
END
$$;

-- El rol de conexión de la aplicación (definido por DATABASE_URL) debe poder
-- asumir cualquiera de los 4 roles vía SET LOCAL ROLE. Ajustar "rrhh" si el
-- usuario de conexión configurado en docker-compose/entorno cambia.
GRANT app_rrhh, app_manager, app_employee, app_admin TO rrhh;

-- =============================================================================
-- 3. Row-Level Security (aislamiento por tenant)
-- =============================================================================

ALTER TABLE "sede" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "app_user" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "role" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "employee" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "audit_log" ENABLE ROW LEVEL SECURITY;

-- FORCE para que ni siquiera el propietario de la tabla se salte la policy
-- (excepto BYPASSRLS explícito, que ningún rol de aplicación tiene).
ALTER TABLE "sede" FORCE ROW LEVEL SECURITY;
ALTER TABLE "app_user" FORCE ROW LEVEL SECURITY;
ALTER TABLE "role" FORCE ROW LEVEL SECURITY;
ALTER TABLE "employee" FORCE ROW LEVEL SECURITY;
ALTER TABLE "audit_log" FORCE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation" ON "sede"
    USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY "tenant_isolation" ON "app_user"
    USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid);

-- ROLE incluye plantillas de sistema (tenant_id NULL), visibles a todos los tenants.
CREATE POLICY "tenant_isolation" ON "role"
    USING ("tenant_id" IS NULL OR "tenant_id" = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY "tenant_isolation" ON "employee"
    USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid);

-- AUDIT_LOG: aislado por tenant igual que el resto; las acciones de sistema
-- (tenant_id NULL) solo las ve app_admin.
CREATE POLICY "tenant_isolation" ON "audit_log"
    USING (
        "tenant_id" = current_setting('app.tenant_id', true)::uuid
        OR ("tenant_id" IS NULL AND current_setting('app.role', true) = 'app_admin')
    );

-- normative_parameter y permission son catálogos nacionales/globales: sin RLS,
-- de solo lectura para todos los roles salvo escritura restringida (ver grants abajo).

-- =============================================================================
-- 3b. Login: función de búsqueda previa a la autenticación
-- =============================================================================
-- Problema: con RLS estricto (FORCE) sobre app_user, ninguna sesión puede leer
-- la fila de un usuario por email sin haber fijado antes app.tenant_id — pero
-- el login solo conoce el email/password, todavía no el tenant_id (el email es
-- único globalmente, no por tenant). Se resuelve con una función SECURITY DEFINER
-- de alcance mínimo (un solo propósito: resolver credenciales para login), dueña
-- de un rol dedicado con BYPASSRLS que NUNCA se usa para nada más ni se otorga
-- a la conexión general de la app. Esto evita dar BYPASSRLS al rol de conexión
-- completo solo para resolver este caso puntual.

DO $$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'rrhh_auth_lookup') THEN
        CREATE ROLE rrhh_auth_lookup NOLOGIN BYPASSRLS;
    END IF;
END
$$;

CREATE OR REPLACE FUNCTION auth_lookup_user(p_email TEXT)
RETURNS TABLE (
    id UUID,
    tenant_id UUID,
    email TEXT,
    password_hash TEXT,
    estado TEXT
) AS $$
    SELECT "id", "tenant_id", "email", "password_hash", "estado"
    FROM "app_user"
    WHERE "email" = p_email;
$$ LANGUAGE sql SECURITY DEFINER STABLE;

ALTER FUNCTION auth_lookup_user(TEXT) OWNER TO rrhh_auth_lookup;
REVOKE ALL ON FUNCTION auth_lookup_user(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_lookup_user(TEXT) TO app_rrhh;
-- Uso exclusivo del módulo auth (LocalStrategy), antes de que exista sesión:
-- una vez autenticado, el resto de la request usa RLS normal con tenant_id fijado.

-- =============================================================================
-- 4. Vistas por rol (seguridad de columna sobre EMPLOYEE)
-- =============================================================================
-- En Fase 0, EMPLOYEE todavía no tiene columnas sensibles reales (salud,
-- remuneración llegan en Fase 1). Se deja el mecanismo de vistas ya operativo
-- para que Fase 1 solo tenga que agregar columnas a la vista, no inventar el patrón.

CREATE VIEW "employee_view_manager" AS
    SELECT "id", "tenant_id", "sede_id", "user_id", "manager_id",
           "tipo_documento", "numero_documento", "nombres", "apellidos",
           "estado", "created_at"
    FROM "employee";
    -- Fase 1 agrega aquí la exclusión explícita de columnas de salud/remuneración.

CREATE VIEW "employee_view_employee" AS
    SELECT "id", "tenant_id", "sede_id", "user_id", "manager_id",
           "nombres", "apellidos", "estado"
    FROM "employee";

-- =============================================================================
-- 5. Privilegios por rol
-- =============================================================================

GRANT SELECT, INSERT, UPDATE ON "tenant", "sede", "app_user", "role", "permission",
    "user_role", "role_permission", "employee" TO app_rrhh, app_admin;
GRANT DELETE ON "sede", "app_user", "role", "user_role", "role_permission", "employee"
    TO app_admin;

-- app_manager y app_employee: sin acceso directo a la tabla base "employee",
-- solo a través de las vistas que ya excluyen/excluirán columnas sensibles.
REVOKE ALL ON "employee" FROM app_manager, app_employee;
GRANT SELECT ON "employee_view_manager" TO app_manager;
GRANT SELECT ON "employee_view_employee" TO app_employee;
GRANT SELECT ON "tenant", "sede" TO app_manager, app_employee;

GRANT SELECT ON "normative_parameter" TO app_rrhh, app_manager, app_employee, app_admin;
GRANT INSERT ON "normative_parameter" TO app_rrhh, app_admin; -- escritura = nueva versión, nunca UPDATE/DELETE
GRANT SELECT ON "permission" TO app_rrhh, app_manager, app_employee, app_admin;

GRANT SELECT ON "audit_log" TO app_rrhh, app_manager, app_admin;
GRANT INSERT ON "audit_log" TO app_rrhh, app_manager, app_employee, app_admin; -- el trigger inserta con el rol de quien ejecuta la acción

-- audit_log es append-only a nivel de BD: nadie actualiza ni borra, ni siquiera app_admin.
REVOKE UPDATE, DELETE ON "audit_log" FROM app_rrhh, app_manager, app_employee, app_admin;

-- normative_parameter nunca se actualiza ni se borra (nueva versión = nueva fila).
REVOKE UPDATE, DELETE ON "normative_parameter" FROM app_rrhh, app_manager, app_employee, app_admin;

-- =============================================================================
-- 6. Auditoría inmutable (trigger genérico)
-- =============================================================================

CREATE OR REPLACE FUNCTION audit_trigger() RETURNS TRIGGER AS $$
DECLARE
    v_tenant_id UUID;
    v_user_id UUID;
    v_request_id UUID;
    v_ip INET;
    v_user_agent TEXT;
    v_registro_id UUID;
BEGIN
    v_tenant_id := NULLIF(current_setting('app.tenant_id', true), '')::uuid;
    v_user_id := NULLIF(current_setting('app.user_id', true), '')::uuid;
    v_request_id := NULLIF(current_setting('app.request_id', true), '')::uuid;
    v_ip := NULLIF(current_setting('app.ip_origen', true), '')::inet;
    v_user_agent := NULLIF(current_setting('app.user_agent', true), '');

    -- Tablas sin columna "id" (ej. junction tables como role_permission) quedan
    -- con registro_id NULL en vez de fallar: to_jsonb(...)->>'id' es NULL si no existe.
    v_registro_id := NULLIF(
        (CASE WHEN TG_OP = 'DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END) ->> 'id',
        ''
    )::uuid;

    INSERT INTO "audit_log" (
        "tenant_id", "user_id", "tabla", "registro_id", "accion",
        "valores_anteriores", "valores_nuevos", "ip_origen", "user_agent", "request_id"
    ) VALUES (
        v_tenant_id,
        v_user_id,
        TG_TABLE_NAME,
        v_registro_id,
        TG_OP,
        CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN row_to_json(OLD) ELSE NULL END,
        CASE WHEN TG_OP IN ('UPDATE', 'INSERT') THEN row_to_json(NEW) ELSE NULL END,
        v_ip,
        v_user_agent,
        v_request_id
    );

    RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Tablas auditables de Fase 0 (Fase 2 añadirá MARCACION, Fase 1 añadirá NOMINA, etc.)
CREATE TRIGGER "employee_audit" AFTER INSERT OR UPDATE OR DELETE ON "employee"
    FOR EACH ROW EXECUTE FUNCTION audit_trigger();
CREATE TRIGGER "app_user_audit" AFTER INSERT OR UPDATE OR DELETE ON "app_user"
    FOR EACH ROW EXECUTE FUNCTION audit_trigger();
CREATE TRIGGER "role_audit" AFTER INSERT OR UPDATE OR DELETE ON "role"
    FOR EACH ROW EXECUTE FUNCTION audit_trigger();
CREATE TRIGGER "role_permission_audit" AFTER INSERT OR UPDATE OR DELETE ON "role_permission"
    FOR EACH ROW EXECUTE FUNCTION audit_trigger();
CREATE TRIGGER "normative_parameter_audit" AFTER INSERT OR UPDATE OR DELETE ON "normative_parameter"
    FOR EACH ROW EXECUTE FUNCTION audit_trigger();
