-- Control de asistencia por turnos: catálogo, plan empleado×fecha, libro de
-- compensatorios y campos de cumplimiento en el resumen diario.
-- Patrón RLS/GRANT/auditoría de 20260715000000_cese_liquidacion.

-- 1. Campos nuevos en tablas existentes
ALTER TABLE "contrato"
  ADD COLUMN "personal_de_confianza" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "asistencia_resumen"
  ADD COLUMN "turno_id" UUID,
  ADD COLUMN "minutos_retraso" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "salida_esperada" TIMESTAMP(3),
  ADD COLUMN "deficit_minutos" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "sin_plan" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "configuracion_asistencia"
  ADD COLUMN "ventana_antes_turno_minutos" INTEGER NOT NULL DEFAULT 120,
  ADD COLUMN "ventana_despues_turno_minutos" INTEGER NOT NULL DEFAULT 240;

-- 2. Enums y tablas nuevas
CREATE TYPE "tipo_dia_plan" AS ENUM ('TURNO', 'DESCANSO', 'DESCANSO_COMPENSATORIO');
CREATE TYPE "tipo_movimiento_compensatorio" AS ENUM ('GANADO', 'GOZADO', 'AJUSTE_INICIAL');

CREATE TABLE "turno" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "codigo" VARCHAR(20) NOT NULL,
    "nombre" VARCHAR(80) NOT NULL,
    "hora_inicio" VARCHAR(5) NOT NULL,
    "hora_fin" VARCHAR(5) NOT NULL,
    "horas_esperadas" DECIMAL(4,2) NOT NULL,
    "tolerancia_minutos" INTEGER NOT NULL DEFAULT 30,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "turno_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "turno_tenant_id_codigo_key" UNIQUE ("tenant_id", "codigo"),
    CONSTRAINT "turno_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE
);

CREATE TABLE "turno_asignacion" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "fecha" DATE NOT NULL,
    "tipo_dia" "tipo_dia_plan" NOT NULL,
    "turno_id" UUID,
    "notas" TEXT,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "turno_asignacion_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "turno_asignacion_tenant_id_employee_id_fecha_key" UNIQUE ("tenant_id", "employee_id", "fecha"),
    CONSTRAINT "turno_asignacion_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE,
    CONSTRAINT "turno_asignacion_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employee"("id") ON DELETE CASCADE,
    CONSTRAINT "turno_asignacion_turno_id_fkey" FOREIGN KEY ("turno_id") REFERENCES "turno"("id")
);
CREATE INDEX "turno_asignacion_tenant_id_fecha_idx" ON "turno_asignacion"("tenant_id", "fecha");

CREATE TABLE "compensatorio_movimiento" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "tipo" "tipo_movimiento_compensatorio" NOT NULL,
    "dias" DECIMAL(4,2) NOT NULL,
    "fecha_referencia" DATE NOT NULL,
    "turno_asignacion_id" UUID,
    "motivo" TEXT,
    "creado_por" UUID NOT NULL,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "compensatorio_movimiento_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "compensatorio_movimiento_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE,
    CONSTRAINT "compensatorio_movimiento_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employee"("id") ON DELETE CASCADE
);
CREATE INDEX "compensatorio_movimiento_tenant_id_employee_id_idx" ON "compensatorio_movimiento"("tenant_id", "employee_id");

-- 3. RLS
ALTER TABLE "turno" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "turno" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "turno"
    USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid);

ALTER TABLE "turno_asignacion" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "turno_asignacion" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "turno_asignacion"
    USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid);

ALTER TABLE "compensatorio_movimiento" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "compensatorio_movimiento" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "compensatorio_movimiento"
    USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid);

-- 4. Privilegios. Catálogo y plan: escribe RRHH/Admin; todos leen (el empleado
--    consulta su propio plan vía service). Libro de compensatorios: append-only
--    (sin UPDATE/DELETE para nadie; una corrección es un movimiento inverso).
GRANT SELECT ON "turno" TO app_rrhh, app_admin, app_manager, app_employee;
GRANT INSERT, UPDATE ON "turno" TO app_rrhh, app_admin;
GRANT SELECT ON "turno_asignacion" TO app_rrhh, app_admin, app_manager, app_employee;
GRANT INSERT, UPDATE ON "turno_asignacion" TO app_rrhh, app_admin;
GRANT SELECT ON "compensatorio_movimiento" TO app_rrhh, app_admin, app_manager, app_employee;
GRANT INSERT ON "compensatorio_movimiento" TO app_rrhh, app_admin;

-- 5. Auditoría inmutable
CREATE TRIGGER "turno_audit" AFTER INSERT OR UPDATE OR DELETE ON "turno"
    FOR EACH ROW EXECUTE FUNCTION audit_trigger();
CREATE TRIGGER "turno_asignacion_audit" AFTER INSERT OR UPDATE OR DELETE ON "turno_asignacion"
    FOR EACH ROW EXECUTE FUNCTION audit_trigger();
CREATE TRIGGER "compensatorio_movimiento_audit" AFTER INSERT OR UPDATE OR DELETE ON "compensatorio_movimiento"
    FOR EACH ROW EXECUTE FUNCTION audit_trigger();
