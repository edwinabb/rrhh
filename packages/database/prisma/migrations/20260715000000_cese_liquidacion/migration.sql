-- Cese y liquidación de beneficios sociales + récord vacacional.
-- Patrón RLS/GRANT/auditoría de 20260714200000_fase4_ats.

-- 1. MYPE: separar micro y pequeña empresa (D.S. 013-2013-PRODUCE).
--    Los contratos 'mype' existentes migran a 'mype_pequena' (default
--    legalmente conservador: paga 50% en vez de 0%).
UPDATE "contrato" SET "regimen_laboral" = 'mype_pequena' WHERE "regimen_laboral" = 'mype';

-- 2. Tipos de documento nuevos para el cese.
ALTER TYPE "tipo_documento" ADD VALUE IF NOT EXISTS 'LIQUIDACION';
ALTER TYPE "tipo_documento" ADD VALUE IF NOT EXISTS 'CERTIFICADO_TRABAJO';
ALTER TYPE "tipo_documento" ADD VALUE IF NOT EXISTS 'CONSTANCIA_CESE';
ALTER TYPE "tipo_documento" ADD VALUE IF NOT EXISTS 'CERTIFICADO_RETENCION_5TA';
ALTER TYPE "tipo_documento" ADD VALUE IF NOT EXISTS 'CARTA_RENUNCIA';
ALTER TYPE "tipo_documento" ADD VALUE IF NOT EXISTS 'EXAMEN_MEDICO_RETIRO';

-- 3. Reemplazo del stub "liquidacion" de Fase 1 (solo contiene datos demo).
DROP TRIGGER IF EXISTS "liquidacion_audit" ON "liquidacion";
DROP TABLE IF EXISTS "liquidacion";

CREATE TYPE "motivo_cese" AS ENUM ('RENUNCIA', 'TERMINO_CONTRATO', 'MUTUO_DISENSO', 'DESPIDO_ARBITRARIO', 'FALLECIMIENTO');
CREATE TYPE "estado_cese" AS ENUM ('BORRADOR', 'CALCULADA', 'APROBADA', 'PAGADA', 'ANULADA');
CREATE TYPE "estado_vacacion_periodo" AS ENUM ('EN_CURSO', 'VENCIDO_PENDIENTE', 'GOZADO', 'LIQUIDADO');

CREATE TABLE "cese" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "fecha_cese" DATE NOT NULL,
    "motivo" "motivo_cese" NOT NULL,
    "estado" "estado_cese" NOT NULL DEFAULT 'BORRADOR',
    "input_snapshot" JSONB NOT NULL,
    "componentes" JSONB,
    "total_bruto" DECIMAL(12,2),
    "total_deducciones" DECIMAL(12,2),
    "neto_pagar" DECIMAL(12,2),
    "gratificacion_extraordinaria" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "derechohabientes" JSONB,
    "fecha_limite_pago" DATE NOT NULL,
    "aprobado_por" UUID,
    "aprobado_en" TIMESTAMP(3),
    "pagado_en" TIMESTAMP(3),
    "pago_fuera_de_plazo" BOOLEAN NOT NULL DEFAULT false,
    "motivo_anulacion" TEXT,
    "creado_por" UUID NOT NULL,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "cese_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "cese_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE,
    CONSTRAINT "cese_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employee"("id")
);
CREATE INDEX "cese_tenant_id_estado_idx" ON "cese"("tenant_id", "estado");
CREATE INDEX "cese_tenant_id_employee_id_idx" ON "cese"("tenant_id", "employee_id");
-- Regla de negocio a nivel BD: un solo cese vigente (no anulado) por empleado.
CREATE UNIQUE INDEX "cese_employee_vigente_key" ON "cese"("employee_id") WHERE "estado" <> 'ANULADA';

CREATE TABLE "vacacion_periodo" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "periodo_inicio" DATE NOT NULL,
    "periodo_fin" DATE NOT NULL,
    "dias_ganados" INTEGER NOT NULL,
    "dias_gozados" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "estado" "estado_vacacion_periodo" NOT NULL DEFAULT 'EN_CURSO',
    "notas" TEXT,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "vacacion_periodo_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "vacacion_periodo_tenant_id_employee_id_periodo_inicio_key" UNIQUE ("tenant_id", "employee_id", "periodo_inicio"),
    CONSTRAINT "vacacion_periodo_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE,
    CONSTRAINT "vacacion_periodo_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employee"("id") ON DELETE CASCADE
);
CREATE INDEX "vacacion_periodo_tenant_id_estado_idx" ON "vacacion_periodo"("tenant_id", "estado");

-- RLS
ALTER TABLE "cese" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "cese" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "cese"
    USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid);

ALTER TABLE "vacacion_periodo" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "vacacion_periodo" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "vacacion_periodo"
    USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid);

-- Privilegios: cese es dato salarial sensible — solo RRHH/Admin. Sin DELETE
-- (anular = UPDATE de estado a ANULADA). Vacaciones: manager consulta su equipo.
GRANT SELECT, INSERT, UPDATE ON "cese" TO app_rrhh, app_admin;
GRANT SELECT, INSERT, UPDATE ON "vacacion_periodo" TO app_rrhh, app_admin;
GRANT SELECT ON "vacacion_periodo" TO app_manager;

-- Auditoría inmutable
CREATE TRIGGER "cese_audit" AFTER INSERT OR UPDATE OR DELETE ON "cese"
    FOR EACH ROW EXECUTE FUNCTION audit_trigger();
CREATE TRIGGER "vacacion_periodo_audit" AFTER INSERT OR UPDATE OR DELETE ON "vacacion_periodo"
    FOR EACH ROW EXECUTE FUNCTION audit_trigger();
