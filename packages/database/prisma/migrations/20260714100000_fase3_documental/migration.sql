-- Fase 3 — Documental: tablas + RLS + auditoría, mismo patrón que
-- 20260714000000_fase2_asistencia.
--
-- Eliminación de documentos = soft-delete (UPDATE de estado a 'ELIMINADO'):
-- NINGÚN rol de aplicación recibe DELETE sobre "documento" ni sobre
-- "documento_version". El historial de versiones es append-only (sin UPDATE).
-- La auditoría usa el trigger genérico audit_trigger() de Fase 0 — no existe
-- tabla de auditoría documental propia.

CREATE TYPE "tipo_documento" AS ENUM ('CONTRATO', 'CV', 'DNI', 'CERTIFICADO', 'MEMO', 'BOLETA', 'OTRO');
CREATE TYPE "estado_documento" AS ENUM ('ACTIVO', 'ELIMINADO');

CREATE TABLE "documento" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "tipo" "tipo_documento" NOT NULL,
    "nombre_archivo" TEXT NOT NULL,
    "mime_type" VARCHAR(100) NOT NULL,
    "tamano_bytes" BIGINT NOT NULL,
    "checksum_md5" VARCHAR(32) NOT NULL,
    "ruta_minio" TEXT NOT NULL,
    "estado" "estado_documento" NOT NULL DEFAULT 'ACTIVO',
    "requiere_consentimiento" BOOLEAN NOT NULL DEFAULT false,
    "consentimiento_fecha" TIMESTAMP(3),
    "eliminado_en" TIMESTAMP(3),
    "motivo_eliminacion" TEXT,
    "subido_por" UUID NOT NULL,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "documento_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "documento_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE,
    CONSTRAINT "documento_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employee"("id") ON DELETE CASCADE
);
CREATE INDEX "documento_tenant_id_employee_id_tipo_idx" ON "documento"("tenant_id", "employee_id", "tipo");
CREATE INDEX "documento_tenant_id_estado_idx" ON "documento"("tenant_id", "estado");

CREATE TABLE "documento_version" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "document_id" UUID NOT NULL,
    "numero_version" INTEGER NOT NULL,
    "ruta_minio" TEXT NOT NULL,
    "checksum_md5" VARCHAR(32) NOT NULL,
    "tamano_bytes" BIGINT NOT NULL,
    "subido_por" UUID NOT NULL,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "documento_version_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "documento_version_document_id_numero_version_key" UNIQUE ("document_id", "numero_version"),
    CONSTRAINT "documento_version_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE,
    CONSTRAINT "documento_version_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documento"("id") ON DELETE CASCADE
);
CREATE INDEX "documento_version_tenant_id_idx" ON "documento_version"("tenant_id");

-- RLS: ambas tablas tienen tenant_id directo.

ALTER TABLE "documento" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "documento" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "documento"
    USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid);
-- Soft-delete only: política RESTRICTIVE que bloquea DELETE para cualquier
-- rol, incluido el dueño de la tabla (FORCE RLS).
CREATE POLICY "documento_no_delete" ON "documento"
    AS RESTRICTIVE FOR DELETE USING (false);

ALTER TABLE "documento_version" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "documento_version" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "documento_version"
    USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid);
-- Historial append-only: sin UPDATE ni DELETE para nadie.
CREATE POLICY "documento_version_no_update" ON "documento_version"
    AS RESTRICTIVE FOR UPDATE USING (false);
CREATE POLICY "documento_version_no_delete" ON "documento_version"
    AS RESTRICTIVE FOR DELETE USING (false);

-- Privilegios: mismo esquema de roles de Fase 0.
--
-- documento: RRHH/Admin gestionan (subir, actualizar metadatos, soft-delete
-- vía UPDATE de estado). Manager y employee solo leen (el empleado consulta
-- sus boletas/contratos; el filtrado fino por dueño se aplica en la capa de
-- aplicación con @RequirePermission). SIN DELETE para ningún rol.
GRANT SELECT, INSERT, UPDATE ON "documento" TO app_rrhh, app_admin;
GRANT SELECT ON "documento" TO app_manager, app_employee;

-- documento_version: append-only. RRHH/Admin insertan versiones nuevas;
-- manager y employee solo leen. Sin UPDATE ni DELETE para nadie.
GRANT SELECT, INSERT ON "documento_version" TO app_rrhh, app_admin;
GRANT SELECT ON "documento_version" TO app_manager, app_employee;

-- Auditoría: mismo trigger genérico de Fase 0.
CREATE TRIGGER "documento_audit" AFTER INSERT OR UPDATE OR DELETE ON "documento"
    FOR EACH ROW EXECUTE FUNCTION audit_trigger();
CREATE TRIGGER "documento_version_audit" AFTER INSERT OR UPDATE OR DELETE ON "documento_version"
    FOR EACH ROW EXECUTE FUNCTION audit_trigger();
