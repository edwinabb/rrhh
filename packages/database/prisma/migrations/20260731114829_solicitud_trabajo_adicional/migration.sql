-- CreateEnum
CREATE TYPE "urgencia_trabajo_adicional" AS ENUM ('NORMAL', 'URGENTE');

-- CreateEnum
CREATE TYPE "estado_solicitud_trabajo_adicional" AS ENUM ('PENDIENTE_APROBACION', 'APROBADA', 'REASIGNADA', 'RECHAZADA', 'REPORTE_PENDIENTE_VALIDACION', 'REPORTE_RECHAZADO', 'VALIDADA');

-- CreateTable
CREATE TABLE "solicitud_trabajo_adicional" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "employee_id_solicitante" UUID NOT NULL,
    "employee_id_asignado" UUID NOT NULL,
    "descripcion_tarea" TEXT NOT NULL,
    "fecha_estimada" DATE NOT NULL,
    "horas_estimadas" DECIMAL(4,2) NOT NULL,
    "urgencia" "urgencia_trabajo_adicional" NOT NULL,
    "causa_horas_extras" BOOLEAN,
    "horas_acumuladas" DECIMAL(5,2),
    "saldo_compensatorios" DECIMAL(5,2),
    "estado" "estado_solicitud_trabajo_adicional" NOT NULL DEFAULT 'PENDIENTE_APROBACION',
    "manager_id" UUID,
    "motivo_rechazo" TEXT,
    "reporte_descripcion" TEXT,
    "reporte_fotos" TEXT[],
    "reporte_notas" TEXT,
    "reporte_enviado_en" TIMESTAMP(3),
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creado_por" UUID NOT NULL,
    "actualizado_en" TIMESTAMP(3) NOT NULL,
    "actualizado_por" UUID,

    CONSTRAINT "solicitud_trabajo_adicional_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "solicitud_trabajo_adicional_tenant_id_employee_id_solicitante_idx" ON "solicitud_trabajo_adicional"("tenant_id", "employee_id_solicitante");

-- CreateIndex
CREATE INDEX "solicitud_trabajo_adicional_tenant_id_employee_id_asignado_idx" ON "solicitud_trabajo_adicional"("tenant_id", "employee_id_asignado");

-- CreateIndex
CREATE INDEX "solicitud_trabajo_adicional_tenant_id_estado_idx" ON "solicitud_trabajo_adicional"("tenant_id", "estado");

-- AddForeignKey
ALTER TABLE "solicitud_trabajo_adicional" ADD CONSTRAINT "solicitud_trabajo_adicional_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "solicitud_trabajo_adicional" ADD CONSTRAINT "solicitud_trabajo_adicional_employee_id_solicitante_fkey" FOREIGN KEY ("employee_id_solicitante") REFERENCES "employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "solicitud_trabajo_adicional" ADD CONSTRAINT "solicitud_trabajo_adicional_employee_id_asignado_fkey" FOREIGN KEY ("employee_id_asignado") REFERENCES "employee"("id") ON UPDATE CASCADE;

-- RLS (Row Level Security) for multi-tenant isolation
ALTER TABLE "solicitud_trabajo_adicional" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "solicitud_trabajo_adicional" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "solicitud_trabajo_adicional"
    USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid);

-- Access Control: empleado crea y consulta las suyas; manager/RRHH/Admin
-- aprueban, rechazan, reasignan, y validan reportes (UPDATE). Los campos
-- horasAcumuladas y saldoCompensatorios son privados (manager only, enforcement en app).
GRANT SELECT, INSERT ON "solicitud_trabajo_adicional" TO app_employee;
GRANT SELECT, INSERT, UPDATE ON "solicitud_trabajo_adicional" TO app_rrhh, app_admin, app_manager;

-- Audit Trail Integration (Fase 0)
CREATE TRIGGER "solicitud_trabajo_adicional_audit" AFTER INSERT OR UPDATE OR DELETE ON "solicitud_trabajo_adicional"
    FOR EACH ROW EXECUTE FUNCTION audit_trigger();
