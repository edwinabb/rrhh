-- CreateTable
CREATE TABLE "tenant_payroll_export_config" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "monto_mode" VARCHAR(255) NOT NULL DEFAULT 'devengado_igual_pagado',
    "formato_exportar" VARCHAR(255) NOT NULL DEFAULT 'pipe',
    "conceptos_excluidos" JSONB NOT NULL DEFAULT '[]',
    "campos_sensibles" JSONB NOT NULL DEFAULT '[]',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenant_payroll_export_config_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tenant_payroll_export_config_tenant_id_key" ON "tenant_payroll_export_config"("tenant_id");

-- AddForeignKey
ALTER TABLE "tenant_payroll_export_config" ADD CONSTRAINT "tenant_payroll_export_config_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RLS (Row Level Security) for multi-tenant isolation
ALTER TABLE "tenant_payroll_export_config" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tenant_payroll_export_config" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "tenant_payroll_export_config"
    USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid);

-- Access Control: RRHH/Admin can read and update export config
GRANT SELECT, INSERT, UPDATE ON "tenant_payroll_export_config" TO app_rrhh, app_admin;

-- Audit Trail Integration (Fase 0)
CREATE TRIGGER "tenant_payroll_export_config_audit" AFTER INSERT OR UPDATE OR DELETE ON "tenant_payroll_export_config"
    FOR EACH ROW EXECUTE FUNCTION audit_trigger();
