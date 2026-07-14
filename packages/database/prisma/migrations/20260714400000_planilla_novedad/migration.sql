-- Novedades de planilla (importadas por CSV): días laborados, horas extra
-- 25/35%, bonificaciones y descuentos por trabajador y período. El motor de
-- nómina (PayrollRunService) las incorpora al procesar el período.
-- Mismo patrón de RLS + GRANTs + auditoría que las migraciones previas.

CREATE TABLE "planilla_novedad" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "periodo" VARCHAR(7) NOT NULL,
    "dias_laborados" INTEGER,
    "horas_extra_25" DECIMAL(6,2) NOT NULL DEFAULT 0,
    "horas_extra_35" DECIMAL(6,2) NOT NULL DEFAULT 0,
    "bonificaciones" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "descuentos" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "fuente" VARCHAR(20) NOT NULL DEFAULT 'csv',
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "planilla_novedad_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "planilla_novedad_tenant_id_employee_id_periodo_key" UNIQUE ("tenant_id", "employee_id", "periodo"),
    CONSTRAINT "planilla_novedad_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE,
    CONSTRAINT "planilla_novedad_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employee"("id") ON DELETE CASCADE
);
CREATE INDEX "planilla_novedad_tenant_id_periodo_idx" ON "planilla_novedad"("tenant_id", "periodo");

-- RLS: aislamiento por tenant, mismo patrón de Fase 0/1/2.
ALTER TABLE "planilla_novedad" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "planilla_novedad" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "planilla_novedad"
    USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid);

-- Privilegios: solo RRHH y Admin importan/corrigen novedades (dato de
-- remuneraciones, sensible). Sin DELETE: una novedad se corrige re-importando
-- (upsert), y el audit trigger conserva el rastro. Manager y employee no
-- tienen acceso.
GRANT SELECT, INSERT, UPDATE ON "planilla_novedad" TO app_rrhh, app_admin;

-- Auditoría: mismo trigger genérico de Fase 0.
CREATE TRIGGER "planilla_novedad_audit" AFTER INSERT OR UPDATE OR DELETE ON "planilla_novedad"
    FOR EACH ROW EXECUTE FUNCTION audit_trigger();
