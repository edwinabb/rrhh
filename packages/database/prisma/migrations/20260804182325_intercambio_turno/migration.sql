-- CreateEnum
CREATE TYPE "estado_intercambio_turno" AS ENUM ('PENDIENTE_ACEPTACION_B', 'RECHAZADA_POR_B', 'ACEPTADA_POR_B', 'APROBADA_MANAGER', 'RECHAZADA_MANAGER', 'AUTO_APROBADA', 'RECHAZADA_AUTOMATICA');

-- CreateEnum
CREATE TYPE "motivo_resolucion_intercambio" AS ENUM ('PLAZO_48H', 'FECHA_ALCANZADA', 'FECHA_ALCANZADA_SIN_RESPUESTA_B', 'TURNO_MODIFICADO');

-- CreateTable
CREATE TABLE "intercambio_turno" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "employee_id_a" UUID NOT NULL,
    "employee_id_b" UUID NOT NULL,
    "fecha" DATE NOT NULL,
    "turno_actual_a" "tipo_dia_plan" NOT NULL,
    "turno_actual_b" "tipo_dia_plan" NOT NULL,
    "mensaje_a" TEXT,
    "estado" "estado_intercambio_turno" NOT NULL DEFAULT 'PENDIENTE_ACEPTACION_B',
    "motivo_rechazo" TEXT,
    "motivo_resolucion" "motivo_resolucion_intercambio",
    "aceptado_en" TIMESTAMP(3),
    "decidido_en" TIMESTAMP(3),
    "decidido_por" TEXT,
    "turno_asignacion_a_id" UUID,
    "turno_asignacion_b_id" UUID,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creado_por" UUID NOT NULL,

    CONSTRAINT "intercambio_turno_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "intercambio_turno_tenant_a_idx" ON "intercambio_turno"("tenant_id", "employee_id_a");

-- CreateIndex
CREATE INDEX "intercambio_turno_tenant_b_idx" ON "intercambio_turno"("tenant_id", "employee_id_b");

-- CreateIndex
CREATE INDEX "intercambio_turno_tenant_id_estado_idx" ON "intercambio_turno"("tenant_id", "estado");

-- AddForeignKey
ALTER TABLE "intercambio_turno" ADD CONSTRAINT "intercambio_turno_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "intercambio_turno" ADD CONSTRAINT "intercambio_turno_employee_id_a_fkey" FOREIGN KEY ("employee_id_a") REFERENCES "employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "intercambio_turno" ADD CONSTRAINT "intercambio_turno_employee_id_b_fkey" FOREIGN KEY ("employee_id_b") REFERENCES "employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RLS (Row Level Security) for multi-tenant isolation
ALTER TABLE "intercambio_turno" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "intercambio_turno" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "intercambio_turno"
    USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid);

-- Access Control: empleado A propone e insertar; empleado B acepta/rechaza
-- (UPDATE); manager/RRHH/Admin aprueban/rechazan (UPDATE).
GRANT SELECT, INSERT, UPDATE ON "intercambio_turno" TO app_employee;
GRANT SELECT, INSERT, UPDATE ON "intercambio_turno" TO app_rrhh, app_admin, app_manager;

-- Audit Trail Integration (Fase 0)
CREATE TRIGGER "intercambio_turno_audit" AFTER INSERT OR UPDATE OR DELETE ON "intercambio_turno"
    FOR EACH ROW EXECUTE FUNCTION audit_trigger();
