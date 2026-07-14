-- Fase 4 — ATS: tablas + RLS + auditoría, mismo patrón que
-- 20260714000000_fase2_asistencia.
--
-- LPDP (Ley 29733): los CVs y datos de candidatos son datos personales de
-- terceros ajenos a la planilla. Solo app_rrhh y app_admin reciben privilegios
-- sobre "candidato" y "candidato_nota" — los managers NO acceden a CVs.

CREATE TYPE "estado_vacante" AS ENUM ('ABIERTA', 'PAUSADA', 'CERRADA');
CREATE TYPE "estado_candidato" AS ENUM ('APLICADO', 'REVISADO', 'ENTREVISTA', 'OFERTA', 'RECHAZADO', 'CONTRATADO');

CREATE TABLE "vacante" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "titulo" TEXT NOT NULL,
    "descripcion" TEXT NOT NULL,
    "requisitos" JSONB NOT NULL,
    "salario_min" DECIMAL(10,2),
    "salario_max" DECIMAL(10,2),
    "estado" "estado_vacante" NOT NULL DEFAULT 'ABIERTA',
    "sede_id" UUID,
    "creado_por" UUID NOT NULL,
    "cerrada_en" TIMESTAMP(3),
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "vacante_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "vacante_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE,
    CONSTRAINT "vacante_sede_id_fkey" FOREIGN KEY ("sede_id") REFERENCES "sede"("id") ON DELETE SET NULL
);
CREATE INDEX "vacante_tenant_id_estado_idx" ON "vacante"("tenant_id", "estado");

CREATE TABLE "candidato" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "vacante_id" UUID NOT NULL,
    "nombre_completo" TEXT NOT NULL,
    "email" VARCHAR(255) NOT NULL,
    "telefono" VARCHAR(20),
    "cv_ruta_minio" TEXT NOT NULL,
    "cv_parseado" JSONB,
    "estado" "estado_candidato" NOT NULL DEFAULT 'APLICADO',
    "consentimiento_lpdp" BOOLEAN NOT NULL DEFAULT false,
    "employee_id" UUID,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "candidato_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "candidato_vacante_id_email_key" UNIQUE ("vacante_id", "email"),
    CONSTRAINT "candidato_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE,
    CONSTRAINT "candidato_vacante_id_fkey" FOREIGN KEY ("vacante_id") REFERENCES "vacante"("id") ON DELETE CASCADE,
    CONSTRAINT "candidato_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employee"("id") ON DELETE SET NULL
);
CREATE INDEX "candidato_tenant_id_estado_idx" ON "candidato"("tenant_id", "estado");
CREATE INDEX "candidato_tenant_id_vacante_id_idx" ON "candidato"("tenant_id", "vacante_id");

CREATE TABLE "candidato_nota" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "candidato_id" UUID NOT NULL,
    "autor_id" UUID NOT NULL,
    "nota" TEXT NOT NULL,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "candidato_nota_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "candidato_nota_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE,
    CONSTRAINT "candidato_nota_candidato_id_fkey" FOREIGN KEY ("candidato_id") REFERENCES "candidato"("id") ON DELETE CASCADE
);
CREATE INDEX "candidato_nota_tenant_id_candidato_id_idx" ON "candidato_nota"("tenant_id", "candidato_id");

-- RLS: todas las tablas de Fase 4 tienen tenant_id directo.

ALTER TABLE "vacante" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "vacante" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "vacante"
    USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid);

ALTER TABLE "candidato" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "candidato" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "candidato"
    USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid);

ALTER TABLE "candidato_nota" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "candidato_nota" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "candidato_nota"
    USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid);

-- Privilegios: mismo esquema de roles de Fase 0.
--
-- vacante: RRHH/Admin gestionan; manager y employee pueden consultar las
-- vacantes publicadas (postulación interna). Sin DELETE (cierre = UPDATE de
-- estado a CERRADA).
GRANT SELECT, INSERT, UPDATE ON "vacante" TO app_rrhh, app_admin;
GRANT SELECT ON "vacante" TO app_manager, app_employee;

-- candidato / candidato_nota (LPDP Ley 29733): datos personales de terceros.
-- SOLO app_rrhh y app_admin — managers y employees no acceden a CVs ni notas.
-- Sin DELETE (rechazo = UPDATE de estado a RECHAZADO).
GRANT SELECT, INSERT, UPDATE ON "candidato" TO app_rrhh, app_admin;
GRANT SELECT, INSERT, UPDATE ON "candidato_nota" TO app_rrhh, app_admin;

-- Auditoría: mismo trigger genérico de Fase 0.
CREATE TRIGGER "vacante_audit" AFTER INSERT OR UPDATE OR DELETE ON "vacante"
    FOR EACH ROW EXECUTE FUNCTION audit_trigger();
CREATE TRIGGER "candidato_audit" AFTER INSERT OR UPDATE OR DELETE ON "candidato"
    FOR EACH ROW EXECUTE FUNCTION audit_trigger();
CREATE TRIGGER "candidato_nota_audit" AFTER INSERT OR UPDATE OR DELETE ON "candidato_nota"
    FOR EACH ROW EXECUTE FUNCTION audit_trigger();
