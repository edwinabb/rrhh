-- Fase 2 — Asistencia: tablas + RLS + auditoría, mismo patrón que
-- 20260711000000_fase1_nomina.
--
-- CRÍTICO SUNAFIL (D.Leg. 910): "marcacion" es append-only. Ningún rol de
-- aplicación recibe UPDATE ni DELETE sobre ella, y políticas RESTRICTIVE
-- bloquean UPDATE/DELETE incluso para el dueño de la tabla (FORCE RLS).
-- Las correcciones se registran como nuevas marcaciones o justificaciones.

CREATE TYPE "tipo_marcacion" AS ENUM ('ENTRADA', 'SALIDA', 'JUSTIFICACION');
CREATE TYPE "tipo_identificacion" AS ENUM ('HUELLA', 'FACIAL', 'PIN', 'QR', 'MANUAL');
CREATE TYPE "motivo_justificacion" AS ENUM ('TARDANZA', 'FALTA', 'PERMISO', 'LICENCIA', 'CALAMIDAD', 'EVENTO_EMPRESA', 'TELETRABAJO');
CREATE TYPE "estado_justificacion" AS ENUM ('PENDIENTE', 'APROBADA', 'RECHAZADA');
CREATE TYPE "tipo_hora_extra" AS ENUM ('DIARIAS', 'SEMANALES');

CREATE TABLE "marcacion" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "sede_id" UUID NOT NULL,
    "tipo" "tipo_marcacion" NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "latitud" DOUBLE PRECISION,
    "longitud" DOUBLE PRECISION,
    "distancia_sede_metros" DOUBLE PRECISION,
    "ubicacion_validada" BOOLEAN NOT NULL DEFAULT false,
    "tipo_identificacion" "tipo_identificacion",
    "score_biometria" DOUBLE PRECISION,
    "dispositivo_id" TEXT,
    "motivo_justificacion" "motivo_justificacion",
    "documento_adjunto_url" TEXT,
    "descripcion" TEXT,
    "bloqueado" BOOLEAN NOT NULL DEFAULT false,
    "motivo_bloqueo" TEXT,
    "requiere_autorizacion" BOOLEAN NOT NULL DEFAULT false,
    "autorizado_por" UUID,
    "autorizado_en" TIMESTAMP(3),
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creado_por" UUID NOT NULL,
    CONSTRAINT "marcacion_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "marcacion_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE,
    CONSTRAINT "marcacion_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employee"("id") ON DELETE CASCADE,
    CONSTRAINT "marcacion_sede_id_fkey" FOREIGN KEY ("sede_id") REFERENCES "sede"("id") ON DELETE CASCADE
);
CREATE INDEX "marcacion_tenant_id_employee_id_timestamp_idx" ON "marcacion"("tenant_id", "employee_id", "timestamp");
CREATE INDEX "marcacion_tenant_id_sede_id_timestamp_idx" ON "marcacion"("tenant_id", "sede_id", "timestamp");

CREATE TABLE "geofence" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "sede_id" UUID NOT NULL,
    "latitud" DOUBLE PRECISION NOT NULL,
    "longitud" DOUBLE PRECISION NOT NULL,
    "radio_metros" DOUBLE PRECISION NOT NULL DEFAULT 100,
    "nombre" TEXT NOT NULL,
    "descripcion" TEXT,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "geofence_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "geofence_tenant_id_sede_id_key" UNIQUE ("tenant_id", "sede_id"),
    CONSTRAINT "geofence_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE,
    CONSTRAINT "geofence_sede_id_fkey" FOREIGN KEY ("sede_id") REFERENCES "sede"("id") ON DELETE CASCADE
);

CREATE TABLE "justificacion" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "marcacion_id" UUID,
    "motivo" "motivo_justificacion" NOT NULL,
    "fecha" DATE NOT NULL,
    "descripcion" TEXT NOT NULL,
    "documento_url" TEXT,
    "estado" "estado_justificacion" NOT NULL DEFAULT 'PENDIENTE',
    "aprobado_por" UUID,
    "aprobado_en" TIMESTAMP(3),
    "motivo_rechazo" TEXT,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "justificacion_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "justificacion_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE,
    CONSTRAINT "justificacion_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employee"("id") ON DELETE CASCADE,
    CONSTRAINT "justificacion_marcacion_id_fkey" FOREIGN KEY ("marcacion_id") REFERENCES "marcacion"("id") ON DELETE SET NULL
);
CREATE INDEX "justificacion_tenant_id_employee_id_estado_idx" ON "justificacion"("tenant_id", "employee_id", "estado");
CREATE INDEX "justificacion_tenant_id_fecha_idx" ON "justificacion"("tenant_id", "fecha");

CREATE TABLE "horas_extra" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "fecha" DATE NOT NULL,
    "tipo" "tipo_hora_extra" NOT NULL,
    "horas_calculadas" DOUBLE PRECISION NOT NULL,
    "incluido_en_nomina" BOOLEAN NOT NULL DEFAULT false,
    "planilla_id" UUID,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "horas_extra_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "horas_extra_tenant_id_employee_id_fecha_tipo_key" UNIQUE ("tenant_id", "employee_id", "fecha", "tipo"),
    CONSTRAINT "horas_extra_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE,
    CONSTRAINT "horas_extra_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employee"("id") ON DELETE CASCADE,
    CONSTRAINT "horas_extra_planilla_id_fkey" FOREIGN KEY ("planilla_id") REFERENCES "planilla"("id") ON DELETE SET NULL
);
CREATE INDEX "horas_extra_tenant_id_incluido_en_nomina_idx" ON "horas_extra"("tenant_id", "incluido_en_nomina");

CREATE TABLE "asistencia_resumen" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "fecha" DATE NOT NULL,
    "hora_entrada" TIMESTAMP(3),
    "hora_salida" TIMESTAMP(3),
    "horas_trabajadas" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "horas_extras_diarias" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "falta" BOOLEAN NOT NULL DEFAULT false,
    "tardanza_minutos" INTEGER NOT NULL DEFAULT 0,
    "justificado" BOOLEAN NOT NULL DEFAULT false,
    "actualizado_en" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "asistencia_resumen_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "asistencia_resumen_tenant_id_employee_id_fecha_key" UNIQUE ("tenant_id", "employee_id", "fecha"),
    CONSTRAINT "asistencia_resumen_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE,
    CONSTRAINT "asistencia_resumen_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employee"("id") ON DELETE CASCADE
);
CREATE INDEX "asistencia_resumen_tenant_id_fecha_idx" ON "asistencia_resumen"("tenant_id", "fecha");

CREATE TABLE "configuracion_asistencia" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "hora_entrada_estandar" VARCHAR(5) NOT NULL DEFAULT '08:00',
    "hora_salida_estandar" VARCHAR(5) NOT NULL DEFAULT '17:00',
    "tolerancia_tardanza_minutos" INTEGER NOT NULL DEFAULT 15,
    "requiere_geofence" BOOLEAN NOT NULL DEFAULT true,
    "requiere_biometria" BOOLEAN NOT NULL DEFAULT false,
    "umbral_confianza_biometria" DOUBLE PRECISION NOT NULL DEFAULT 0.95,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "configuracion_asistencia_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "configuracion_asistencia_tenant_id_key" UNIQUE ("tenant_id"),
    CONSTRAINT "configuracion_asistencia_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE
);

-- RLS: todas las tablas de Fase 2 tienen tenant_id directo.

ALTER TABLE "marcacion" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "marcacion" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "marcacion"
    USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid);
-- Append-only (SUNAFIL): políticas RESTRICTIVE que bloquean UPDATE y DELETE
-- para cualquier rol, incluido el dueño de la tabla (FORCE RLS). Las políticas
-- restrictivas se combinan con AND, por lo que ninguna política permisiva
-- puede habilitar estos comandos.
CREATE POLICY "marcacion_no_update" ON "marcacion"
    AS RESTRICTIVE FOR UPDATE USING (false);
CREATE POLICY "marcacion_no_delete" ON "marcacion"
    AS RESTRICTIVE FOR DELETE USING (false);

ALTER TABLE "geofence" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "geofence" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "geofence"
    USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid);

ALTER TABLE "justificacion" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "justificacion" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "justificacion"
    USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid);

ALTER TABLE "horas_extra" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "horas_extra" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "horas_extra"
    USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid);

ALTER TABLE "asistencia_resumen" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "asistencia_resumen" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "asistencia_resumen"
    USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid);

ALTER TABLE "configuracion_asistencia" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "configuracion_asistencia" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "configuracion_asistencia"
    USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid);

-- Privilegios: mismo esquema de roles de Fase 0.
--
-- marcacion (append-only SUNAFIL): todos los roles pueden marcar (INSERT) y
-- consultar (SELECT). NINGÚN rol de aplicación recibe UPDATE ni DELETE.
GRANT SELECT, INSERT ON "marcacion" TO app_rrhh, app_admin, app_manager, app_employee;

-- geofence y configuracion_asistencia: RRHH/Admin administran; manager y
-- employee solo leen (necesario para validar marcaciones en su sesión).
GRANT SELECT, INSERT, UPDATE ON "geofence", "configuracion_asistencia" TO app_rrhh, app_admin;
GRANT SELECT ON "geofence", "configuracion_asistencia" TO app_manager, app_employee;
GRANT DELETE ON "geofence" TO app_admin;

-- justificacion: el empleado crea y consulta las suyas; manager/RRHH/Admin
-- además aprueban o rechazan (UPDATE de estado).
GRANT SELECT, INSERT, UPDATE ON "justificacion" TO app_rrhh, app_admin, app_manager;
GRANT SELECT, INSERT ON "justificacion" TO app_employee;

-- Tablas derivadas (recalculables desde marcacion, que es la fuente legal de
-- verdad): se escriben como efecto del flujo de marcación bajo la sesión del
-- propio empleado, por eso todos los roles reciben INSERT/UPDATE. El audit
-- trigger registra cada cambio. Sin DELETE para nadie.
GRANT SELECT, INSERT, UPDATE ON "asistencia_resumen", "horas_extra"
    TO app_rrhh, app_admin, app_manager, app_employee;

-- Auditoría: mismo trigger genérico de Fase 0.
CREATE TRIGGER "marcacion_audit" AFTER INSERT OR UPDATE OR DELETE ON "marcacion"
    FOR EACH ROW EXECUTE FUNCTION audit_trigger();
CREATE TRIGGER "geofence_audit" AFTER INSERT OR UPDATE OR DELETE ON "geofence"
    FOR EACH ROW EXECUTE FUNCTION audit_trigger();
CREATE TRIGGER "justificacion_audit" AFTER INSERT OR UPDATE OR DELETE ON "justificacion"
    FOR EACH ROW EXECUTE FUNCTION audit_trigger();
CREATE TRIGGER "horas_extra_audit" AFTER INSERT OR UPDATE OR DELETE ON "horas_extra"
    FOR EACH ROW EXECUTE FUNCTION audit_trigger();
CREATE TRIGGER "asistencia_resumen_audit" AFTER INSERT OR UPDATE OR DELETE ON "asistencia_resumen"
    FOR EACH ROW EXECUTE FUNCTION audit_trigger();
CREATE TRIGGER "configuracion_asistencia_audit" AFTER INSERT OR UPDATE OR DELETE ON "configuracion_asistencia"
    FOR EACH ROW EXECUTE FUNCTION audit_trigger();
