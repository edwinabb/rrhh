-- Fase 1 — Nómina: tablas + RLS + auditoría, mismo patrón que
-- 20260710000000_init_foundations.

CREATE TABLE "contrato" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "employee_id" UUID NOT NULL,
    "regimen_laboral" VARCHAR(20) NOT NULL,
    "regimen_laboral_sunat" VARCHAR(2) NOT NULL,
    "tipo_trabajador_sunat" VARCHAR(2) NOT NULL,
    "tipo_contrato" VARCHAR(30) NOT NULL,
    "tipo_contrato_sunat" VARCHAR(2) NOT NULL,
    "fecha_inicio" DATE NOT NULL,
    "fecha_fin" DATE,
    "jornada" JSONB NOT NULL,
    "remuneracion_basica" DECIMAL(10,2) NOT NULL,
    CONSTRAINT "contrato_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "contrato_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employee"("id") ON DELETE CASCADE
);
CREATE INDEX "contrato_employee_id_idx" ON "contrato"("employee_id");

CREATE TABLE "cuenta_bancaria" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "employee_id" UUID NOT NULL,
    "banco" VARCHAR(3) NOT NULL,
    "tipo_cuenta" VARCHAR(20) NOT NULL,
    "numero" VARCHAR(20) NOT NULL,
    "cci" VARCHAR(20),
    "es_principal" BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT "cuenta_bancaria_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "cuenta_bancaria_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employee"("id") ON DELETE CASCADE
);
CREATE INDEX "cuenta_bancaria_employee_id_idx" ON "cuenta_bancaria"("employee_id");

CREATE TABLE "regimen_pensionario" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "employee_id" UUID NOT NULL,
    "sistema" VARCHAR(10) NOT NULL,
    "administradora" VARCHAR(20),
    "tipo_comision" VARCHAR(10),
    "codigo_sunat" VARCHAR(2) NOT NULL,
    "fecha_afiliacion" DATE NOT NULL,
    CONSTRAINT "regimen_pensionario_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "regimen_pensionario_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employee"("id") ON DELETE CASCADE
);
CREATE INDEX "regimen_pensionario_employee_id_idx" ON "regimen_pensionario"("employee_id");

CREATE TABLE "concepto" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID,
    "codigo" VARCHAR(20) NOT NULL,
    "codigo_sunat" VARCHAR(4) NOT NULL,
    "nombre" TEXT NOT NULL,
    "tipo" VARCHAR(10) NOT NULL,
    "es_remunerativo" BOOLEAN NOT NULL,
    "afecto_a" JSONB NOT NULL,
    CONSTRAINT "concepto_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "concepto_tenant_id_codigo_key" UNIQUE ("tenant_id", "codigo")
);
CREATE INDEX "concepto_codigo_sunat_idx" ON "concepto"("codigo_sunat");

CREATE TABLE "planilla" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "periodo" VARCHAR(7) NOT NULL,
    "estado" VARCHAR(20) NOT NULL DEFAULT 'registrado',
    "cerrado_at" TIMESTAMP(3),
    CONSTRAINT "planilla_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "planilla_tenant_id_periodo_key" UNIQUE ("tenant_id", "periodo")
);
CREATE INDEX "planilla_tenant_id_idx" ON "planilla"("tenant_id");

CREATE TABLE "planilla_detalle" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "planilla_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "conceptos_calculados" JSONB NOT NULL,
    "neto_pagar" DECIMAL(10,2) NOT NULL,
    CONSTRAINT "planilla_detalle_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "planilla_detalle_planilla_id_fkey" FOREIGN KEY ("planilla_id") REFERENCES "planilla"("id") ON DELETE CASCADE,
    CONSTRAINT "planilla_detalle_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employee"("id")
);
CREATE INDEX "planilla_detalle_planilla_id_idx" ON "planilla_detalle"("planilla_id");
CREATE INDEX "planilla_detalle_employee_id_idx" ON "planilla_detalle"("employee_id");

CREATE TABLE "provision" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "periodo" VARCHAR(7) NOT NULL,
    "tipo" VARCHAR(20) NOT NULL,
    "monto" DECIMAL(10,2) NOT NULL,
    CONSTRAINT "provision_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "provision_tenant_id_periodo_idx" ON "provision"("tenant_id", "periodo");

CREATE TABLE "liquidacion" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "employee_id" UUID NOT NULL,
    "fecha_cese" DATE NOT NULL,
    "componentes" JSONB NOT NULL,
    "generado_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "liquidacion_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "liquidacion_employee_id_key" UNIQUE ("employee_id"),
    CONSTRAINT "liquidacion_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employee"("id")
);

-- RLS: contrato/cuenta_bancaria/regimen_pensionario/planilla_detalle/liquidacion
-- se aíslan a través del employee_id -> employee.tenant_id (no tienen tenant_id
-- propio); planilla/provision sí tienen tenant_id directo.

ALTER TABLE "planilla" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "planilla" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "planilla"
    USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid);

ALTER TABLE "provision" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "provision" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "provision"
    USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid);

ALTER TABLE "contrato" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "contrato" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "contrato"
    USING (EXISTS (
        SELECT 1 FROM "employee" e
        WHERE e."id" = "contrato"."employee_id"
        AND e."tenant_id" = current_setting('app.tenant_id', true)::uuid
    ));

ALTER TABLE "cuenta_bancaria" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "cuenta_bancaria" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "cuenta_bancaria"
    USING (EXISTS (
        SELECT 1 FROM "employee" e
        WHERE e."id" = "cuenta_bancaria"."employee_id"
        AND e."tenant_id" = current_setting('app.tenant_id', true)::uuid
    ));

ALTER TABLE "regimen_pensionario" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "regimen_pensionario" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "regimen_pensionario"
    USING (EXISTS (
        SELECT 1 FROM "employee" e
        WHERE e."id" = "regimen_pensionario"."employee_id"
        AND e."tenant_id" = current_setting('app.tenant_id', true)::uuid
    ));

ALTER TABLE "planilla_detalle" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "planilla_detalle" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "planilla_detalle"
    USING (EXISTS (
        SELECT 1 FROM "planilla" p
        WHERE p."id" = "planilla_detalle"."planilla_id"
        AND p."tenant_id" = current_setting('app.tenant_id', true)::uuid
    ));

ALTER TABLE "liquidacion" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "liquidacion" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "liquidacion"
    USING (EXISTS (
        SELECT 1 FROM "employee" e
        WHERE e."id" = "liquidacion"."employee_id"
        AND e."tenant_id" = current_setting('app.tenant_id', true)::uuid
    ));

-- concepto: catálogo global (tenant_id NULL) o por tenant, mismo patrón que "role".
ALTER TABLE "concepto" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "concepto" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "concepto"
    USING ("tenant_id" IS NULL OR "tenant_id" = current_setting('app.tenant_id', true)::uuid);

-- Privilegios: mismo esquema de roles de Fase 0. RRHH/Admin escriben; manager/
-- employee solo leen catálogo de conceptos y su propia planilla (vía vista,
-- pendiente cuando se agregue el portal ESS en Fase 3).
GRANT SELECT, INSERT, UPDATE ON "contrato", "cuenta_bancaria", "regimen_pensionario",
    "concepto", "planilla", "planilla_detalle", "provision", "liquidacion"
    TO app_rrhh, app_admin;
GRANT DELETE ON "contrato", "cuenta_bancaria", "regimen_pensionario", "concepto"
    TO app_admin;
GRANT SELECT ON "concepto" TO app_manager, app_employee;

-- Auditoría: mismo trigger genérico de Fase 0.
CREATE TRIGGER "contrato_audit" AFTER INSERT OR UPDATE OR DELETE ON "contrato"
    FOR EACH ROW EXECUTE FUNCTION audit_trigger();
CREATE TRIGGER "planilla_audit" AFTER INSERT OR UPDATE OR DELETE ON "planilla"
    FOR EACH ROW EXECUTE FUNCTION audit_trigger();
CREATE TRIGGER "planilla_detalle_audit" AFTER INSERT OR UPDATE OR DELETE ON "planilla_detalle"
    FOR EACH ROW EXECUTE FUNCTION audit_trigger();
CREATE TRIGGER "liquidacion_audit" AFTER INSERT OR UPDATE OR DELETE ON "liquidacion"
    FOR EACH ROW EXECUTE FUNCTION audit_trigger();
CREATE TRIGGER "concepto_audit" AFTER INSERT OR UPDATE OR DELETE ON "concepto"
    FOR EACH ROW EXECUTE FUNCTION audit_trigger();
