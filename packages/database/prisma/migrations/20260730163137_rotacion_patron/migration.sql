-- DropForeignKey
ALTER TABLE "app_user" DROP CONSTRAINT "app_user_tenant_id_fkey";

-- DropForeignKey
ALTER TABLE "asistencia_resumen" DROP CONSTRAINT "asistencia_resumen_employee_id_fkey";

-- DropForeignKey
ALTER TABLE "asistencia_resumen" DROP CONSTRAINT "asistencia_resumen_tenant_id_fkey";

-- DropForeignKey
ALTER TABLE "audit_log" DROP CONSTRAINT "audit_log_tenant_id_fkey";

-- DropForeignKey
ALTER TABLE "audit_log" DROP CONSTRAINT "audit_log_user_id_fkey";

-- DropForeignKey
ALTER TABLE "candidato" DROP CONSTRAINT "candidato_employee_id_fkey";

-- DropForeignKey
ALTER TABLE "candidato" DROP CONSTRAINT "candidato_tenant_id_fkey";

-- DropForeignKey
ALTER TABLE "candidato" DROP CONSTRAINT "candidato_vacante_id_fkey";

-- DropForeignKey
ALTER TABLE "candidato_nota" DROP CONSTRAINT "candidato_nota_candidato_id_fkey";

-- DropForeignKey
ALTER TABLE "candidato_nota" DROP CONSTRAINT "candidato_nota_tenant_id_fkey";

-- DropForeignKey
ALTER TABLE "cese" DROP CONSTRAINT "cese_employee_id_fkey";

-- DropForeignKey
ALTER TABLE "cese" DROP CONSTRAINT "cese_tenant_id_fkey";

-- DropForeignKey
ALTER TABLE "compensatorio_movimiento" DROP CONSTRAINT "compensatorio_movimiento_employee_id_fkey";

-- DropForeignKey
ALTER TABLE "compensatorio_movimiento" DROP CONSTRAINT "compensatorio_movimiento_tenant_id_fkey";

-- DropForeignKey
ALTER TABLE "configuracion_asistencia" DROP CONSTRAINT "configuracion_asistencia_tenant_id_fkey";

-- DropForeignKey
ALTER TABLE "contrato" DROP CONSTRAINT "contrato_employee_id_fkey";

-- DropForeignKey
ALTER TABLE "cuenta_bancaria" DROP CONSTRAINT "cuenta_bancaria_employee_id_fkey";

-- DropForeignKey
ALTER TABLE "documento" DROP CONSTRAINT "documento_employee_id_fkey";

-- DropForeignKey
ALTER TABLE "documento" DROP CONSTRAINT "documento_tenant_id_fkey";

-- DropForeignKey
ALTER TABLE "documento_version" DROP CONSTRAINT "documento_version_document_id_fkey";

-- DropForeignKey
ALTER TABLE "documento_version" DROP CONSTRAINT "documento_version_tenant_id_fkey";

-- DropForeignKey
ALTER TABLE "employee" DROP CONSTRAINT "employee_manager_id_fkey";

-- DropForeignKey
ALTER TABLE "employee" DROP CONSTRAINT "employee_sede_id_fkey";

-- DropForeignKey
ALTER TABLE "employee" DROP CONSTRAINT "employee_tenant_id_fkey";

-- DropForeignKey
ALTER TABLE "employee" DROP CONSTRAINT "employee_user_id_fkey";

-- DropForeignKey
ALTER TABLE "geofence" DROP CONSTRAINT "geofence_sede_id_fkey";

-- DropForeignKey
ALTER TABLE "geofence" DROP CONSTRAINT "geofence_tenant_id_fkey";

-- DropForeignKey
ALTER TABLE "horas_extra" DROP CONSTRAINT "horas_extra_employee_id_fkey";

-- DropForeignKey
ALTER TABLE "horas_extra" DROP CONSTRAINT "horas_extra_planilla_id_fkey";

-- DropForeignKey
ALTER TABLE "horas_extra" DROP CONSTRAINT "horas_extra_tenant_id_fkey";

-- DropForeignKey
ALTER TABLE "justificacion" DROP CONSTRAINT "justificacion_employee_id_fkey";

-- DropForeignKey
ALTER TABLE "justificacion" DROP CONSTRAINT "justificacion_marcacion_id_fkey";

-- DropForeignKey
ALTER TABLE "justificacion" DROP CONSTRAINT "justificacion_tenant_id_fkey";

-- DropForeignKey
ALTER TABLE "marcacion" DROP CONSTRAINT "marcacion_employee_id_fkey";

-- DropForeignKey
ALTER TABLE "marcacion" DROP CONSTRAINT "marcacion_sede_id_fkey";

-- DropForeignKey
ALTER TABLE "marcacion" DROP CONSTRAINT "marcacion_tenant_id_fkey";

-- DropForeignKey
ALTER TABLE "planilla_detalle" DROP CONSTRAINT "planilla_detalle_employee_id_fkey";

-- DropForeignKey
ALTER TABLE "planilla_detalle" DROP CONSTRAINT "planilla_detalle_planilla_id_fkey";

-- DropForeignKey
ALTER TABLE "planilla_novedad" DROP CONSTRAINT "planilla_novedad_employee_id_fkey";

-- DropForeignKey
ALTER TABLE "planilla_novedad" DROP CONSTRAINT "planilla_novedad_tenant_id_fkey";

-- DropForeignKey
ALTER TABLE "regimen_pensionario" DROP CONSTRAINT "regimen_pensionario_employee_id_fkey";

-- DropForeignKey
ALTER TABLE "role" DROP CONSTRAINT "role_tenant_id_fkey";

-- DropForeignKey
ALTER TABLE "role_permission" DROP CONSTRAINT "role_permission_permission_id_fkey";

-- DropForeignKey
ALTER TABLE "role_permission" DROP CONSTRAINT "role_permission_role_id_fkey";

-- DropForeignKey
ALTER TABLE "sede" DROP CONSTRAINT "sede_tenant_id_fkey";

-- DropForeignKey
ALTER TABLE "turno" DROP CONSTRAINT "turno_tenant_id_fkey";

-- DropForeignKey
ALTER TABLE "turno_asignacion" DROP CONSTRAINT "turno_asignacion_employee_id_fkey";

-- DropForeignKey
ALTER TABLE "turno_asignacion" DROP CONSTRAINT "turno_asignacion_tenant_id_fkey";

-- DropForeignKey
ALTER TABLE "turno_asignacion" DROP CONSTRAINT "turno_asignacion_turno_id_fkey";

-- DropForeignKey
ALTER TABLE "user_role" DROP CONSTRAINT "user_role_role_id_fkey";

-- DropForeignKey
ALTER TABLE "user_role" DROP CONSTRAINT "user_role_user_id_fkey";

-- DropForeignKey
ALTER TABLE "vacacion_periodo" DROP CONSTRAINT "vacacion_periodo_employee_id_fkey";

-- DropForeignKey
ALTER TABLE "vacacion_periodo" DROP CONSTRAINT "vacacion_periodo_tenant_id_fkey";

-- DropForeignKey
ALTER TABLE "vacante" DROP CONSTRAINT "vacante_sede_id_fkey";

-- DropForeignKey
ALTER TABLE "vacante" DROP CONSTRAINT "vacante_tenant_id_fkey";

-- CreateTable
CREATE TABLE "rotacion_patron" (
    "id" TEXT NOT NULL,
    "tenant_id" UUID NOT NULL,
    "nombre" VARCHAR(255) NOT NULL,
    "descripcion" TEXT,
    "secuencia" TEXT NOT NULL,
    "duracion_ciclo" INTEGER NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creado_por" UUID NOT NULL,
    "actualizado_en" TIMESTAMP(3) NOT NULL,
    "actualizado_por" UUID,

    CONSTRAINT "rotacion_patron_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "rotacion_patron_tenant_id_activo_idx" ON "rotacion_patron"("tenant_id", "activo");

-- CreateIndex
CREATE UNIQUE INDEX "rotacion_patron_tenant_id_nombre_key" ON "rotacion_patron"("tenant_id", "nombre");

-- AddForeignKey
ALTER TABLE "sede" ADD CONSTRAINT "sede_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app_user" ADD CONSTRAINT "app_user_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role" ADD CONSTRAINT "role_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_role" ADD CONSTRAINT "user_role_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_role" ADD CONSTRAINT "user_role_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "role"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permission" ADD CONSTRAINT "role_permission_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "role"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permission" ADD CONSTRAINT "role_permission_permission_id_fkey" FOREIGN KEY ("permission_id") REFERENCES "permission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee" ADD CONSTRAINT "employee_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee" ADD CONSTRAINT "employee_sede_id_fkey" FOREIGN KEY ("sede_id") REFERENCES "sede"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee" ADD CONSTRAINT "employee_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee" ADD CONSTRAINT "employee_manager_id_fkey" FOREIGN KEY ("manager_id") REFERENCES "employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contrato" ADD CONSTRAINT "contrato_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cuenta_bancaria" ADD CONSTRAINT "cuenta_bancaria_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "regimen_pensionario" ADD CONSTRAINT "regimen_pensionario_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "planilla_detalle" ADD CONSTRAINT "planilla_detalle_planilla_id_fkey" FOREIGN KEY ("planilla_id") REFERENCES "planilla"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "planilla_detalle" ADD CONSTRAINT "planilla_detalle_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "planilla_novedad" ADD CONSTRAINT "planilla_novedad_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "planilla_novedad" ADD CONSTRAINT "planilla_novedad_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cese" ADD CONSTRAINT "cese_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cese" ADD CONSTRAINT "cese_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vacacion_periodo" ADD CONSTRAINT "vacacion_periodo_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vacacion_periodo" ADD CONSTRAINT "vacacion_periodo_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marcacion" ADD CONSTRAINT "marcacion_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marcacion" ADD CONSTRAINT "marcacion_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marcacion" ADD CONSTRAINT "marcacion_sede_id_fkey" FOREIGN KEY ("sede_id") REFERENCES "sede"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "geofence" ADD CONSTRAINT "geofence_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "geofence" ADD CONSTRAINT "geofence_sede_id_fkey" FOREIGN KEY ("sede_id") REFERENCES "sede"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "justificacion" ADD CONSTRAINT "justificacion_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "justificacion" ADD CONSTRAINT "justificacion_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "justificacion" ADD CONSTRAINT "justificacion_marcacion_id_fkey" FOREIGN KEY ("marcacion_id") REFERENCES "marcacion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "horas_extra" ADD CONSTRAINT "horas_extra_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "horas_extra" ADD CONSTRAINT "horas_extra_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "horas_extra" ADD CONSTRAINT "horas_extra_planilla_id_fkey" FOREIGN KEY ("planilla_id") REFERENCES "planilla"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asistencia_resumen" ADD CONSTRAINT "asistencia_resumen_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asistencia_resumen" ADD CONSTRAINT "asistencia_resumen_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "configuracion_asistencia" ADD CONSTRAINT "configuracion_asistencia_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "turno" ADD CONSTRAINT "turno_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "turno_asignacion" ADD CONSTRAINT "turno_asignacion_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "turno_asignacion" ADD CONSTRAINT "turno_asignacion_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "turno_asignacion" ADD CONSTRAINT "turno_asignacion_turno_id_fkey" FOREIGN KEY ("turno_id") REFERENCES "turno"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compensatorio_movimiento" ADD CONSTRAINT "compensatorio_movimiento_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compensatorio_movimiento" ADD CONSTRAINT "compensatorio_movimiento_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rotacion_patron" ADD CONSTRAINT "rotacion_patron_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documento" ADD CONSTRAINT "documento_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documento" ADD CONSTRAINT "documento_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documento_version" ADD CONSTRAINT "documento_version_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documento_version" ADD CONSTRAINT "documento_version_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documento"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vacante" ADD CONSTRAINT "vacante_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vacante" ADD CONSTRAINT "vacante_sede_id_fkey" FOREIGN KEY ("sede_id") REFERENCES "sede"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "candidato" ADD CONSTRAINT "candidato_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "candidato" ADD CONSTRAINT "candidato_vacante_id_fkey" FOREIGN KEY ("vacante_id") REFERENCES "vacante"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "candidato" ADD CONSTRAINT "candidato_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "candidato_nota" ADD CONSTRAINT "candidato_nota_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "candidato_nota" ADD CONSTRAINT "candidato_nota_candidato_id_fkey" FOREIGN KEY ("candidato_id") REFERENCES "candidato"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "employee_tenant_doc_key" RENAME TO "employee_tenant_id_tipo_documento_numero_documento_key";
