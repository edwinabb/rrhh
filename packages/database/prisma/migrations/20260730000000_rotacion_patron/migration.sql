-- Patrón de rotación de turnos: modelo para autogeneración de planes de rotación
-- (Feature 1 de Sprint 6, Fase 6-9).

-- 1. Crear tabla rotacion_patron
CREATE TABLE "rotacion_patron" (
    "id" TEXT NOT NULL,
    "tenant_id" UUID NOT NULL,
    "nombre" VARCHAR(255) NOT NULL,
    "descripcion" TEXT,
    "secuencia" TEXT NOT NULL,
    "duracion_ciclo" INTEGER NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creado_por" TEXT NOT NULL,
    "actualizado_en" TIMESTAMP(3) NOT NULL,
    "actualizado_por" TEXT,

    CONSTRAINT "rotacion_patron_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "rotacion_patron_tenant_id_nombre_key" UNIQUE ("tenant_id", "nombre"),
    CONSTRAINT "rotacion_patron_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE
);

-- 2. Crear índice
CREATE INDEX "rotacion_patron_tenant_id_activo_idx" ON "rotacion_patron"("tenant_id", "activo");

-- 3. RLS (Row Level Security)
ALTER TABLE "rotacion_patron" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "rotacion_patron" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "rotacion_patron"
    USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid);

-- 4. Privilegios: RRHH/Admin escriben y leen, otros solo leen
GRANT SELECT ON "rotacion_patron" TO app_rrhh, app_admin, app_manager, app_employee;
GRANT INSERT, UPDATE ON "rotacion_patron" TO app_rrhh, app_admin;

-- 5. Auditoría inmutable
CREATE TRIGGER "rotacion_patron_audit" AFTER INSERT OR UPDATE OR DELETE ON "rotacion_patron"
    FOR EACH ROW EXECUTE FUNCTION audit_trigger();
