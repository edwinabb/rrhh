-- CreateEnum
CREATE TYPE "estado_solicitud_cambio_turno" AS ENUM ('PENDIENTE', 'APROBADA', 'RECHAZADA');

-- CreateTable
CREATE TABLE "solicitud_cambio_turno" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "fecha_solicitud" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fecha_actual" DATE NOT NULL,
    "turno_id_actual" UUID,
    "fecha_nueva" DATE NOT NULL,
    "turno_id_nuevo" UUID,
    "estado" "estado_solicitud_cambio_turno" NOT NULL DEFAULT 'PENDIENTE',
    "fecha_decision" TIMESTAMP(3),
    "decidido_por" UUID,
    "motivo_rechazo" TEXT,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creado_por" UUID NOT NULL,
    "actualizado_en" TIMESTAMP(3) NOT NULL,
    "actualizado_por" UUID,

    CONSTRAINT "solicitud_cambio_turno_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "solicitud_cambio_turno_tenant_id_estado_idx" ON "solicitud_cambio_turno"("tenant_id", "estado");

-- CreateIndex
CREATE INDEX "solicitud_cambio_turno_tenant_id_employee_id_idx" ON "solicitud_cambio_turno"("tenant_id", "employee_id");

-- CreateIndex
CREATE INDEX "solicitud_cambio_turno_decidido_por_idx" ON "solicitud_cambio_turno"("decidido_por");

-- CreateIndex
CREATE UNIQUE INDEX "solicitud_cambio_turno_tenant_id_employee_id_fecha_actual_key" ON "solicitud_cambio_turno"("tenant_id", "employee_id", "fecha_actual");

-- AddForeignKey
ALTER TABLE "solicitud_cambio_turno" ADD CONSTRAINT "solicitud_cambio_turno_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "solicitud_cambio_turno" ADD CONSTRAINT "solicitud_cambio_turno_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "solicitud_cambio_turno" ADD CONSTRAINT "solicitud_cambio_turno_turno_id_actual_fkey" FOREIGN KEY ("turno_id_actual") REFERENCES "turno"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "solicitud_cambio_turno" ADD CONSTRAINT "solicitud_cambio_turno_turno_id_nuevo_fkey" FOREIGN KEY ("turno_id_nuevo") REFERENCES "turno"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- RLS (Row Level Security) for multi-tenant isolation
ALTER TABLE "solicitud_cambio_turno" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "solicitud_cambio_turno" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "solicitud_cambio_turno"
    USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid);

-- Access Control: el empleado crea y consulta las suyas; manager/RRHH/Admin
-- además aprueban o rechazan (UPDATE de estado y demás campos de decisión).
GRANT SELECT, INSERT, UPDATE ON "solicitud_cambio_turno" TO app_rrhh, app_admin, app_manager;
GRANT SELECT, INSERT ON "solicitud_cambio_turno" TO app_employee;

-- Audit Trail Integration (Fase 0)
CREATE TRIGGER "solicitud_cambio_turno_audit" AFTER INSERT OR UPDATE OR DELETE ON "solicitud_cambio_turno"
    FOR EACH ROW EXECUTE FUNCTION audit_trigger();
