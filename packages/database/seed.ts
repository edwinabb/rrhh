/**
 * Seed inicial de Fase 0: catálogo de permisos, roles de sistema, y parámetros
 * normativos de referencia. Los valores de NORMATIVE_PARAMETER son de referencia
 * (no confirmados contra fuente oficial) — ver
 * docs/superpowers/specs/validaciones-normativas-pendientes.md antes de usarlos
 * en cualquier cálculo real de Fase 1.
 */
import { PrismaClient } from './generated/client';

const prisma = new PrismaClient();

const PERMISSIONS = [
  { code: 'employee.read', descripcion: 'Ver datos generales de un trabajador', esSensible: false },
  { code: 'employee.write', descripcion: 'Crear/editar datos generales de un trabajador', esSensible: false },
  {
    code: 'employee.salary.read',
    descripcion: 'Ver remuneración e ingresos de un trabajador',
    esSensible: true,
  },
  {
    code: 'employee.health.read',
    descripcion: 'Ver datos de salud de un trabajador',
    esSensible: true,
  },
  { code: 'role.manage', descripcion: 'Administrar roles y permisos del tenant', esSensible: false },
  { code: 'audit_log.read', descripcion: 'Ver el registro de auditoría', esSensible: false },
  {
    code: 'normative_param.read',
    descripcion: 'Ver parámetros normativos vigentes',
    esSensible: false,
  },
  {
    code: 'normative_param.write',
    descripcion: 'Crear una nueva versión de un parámetro normativo',
    esSensible: false,
  },
] as const;

// Roles de sistema (tenant_id null): plantilla que cada tenant puede clonar/editar
// desde la página de RBAC del Módulo 3. No se auto-asignan a ningún tenant aquí.
const SYSTEM_ROLES: Record<string, { descripcion: string; permissions: string[] }> = {
  Admin: {
    descripcion: 'Control total del tenant, incluyendo RBAC y parámetros normativos',
    permissions: PERMISSIONS.map((p) => p.code),
  },
  RRHH: {
    descripcion: 'Equipo de Recursos Humanos: acceso completo a datos de trabajadores',
    permissions: [
      'employee.read',
      'employee.write',
      'employee.salary.read',
      'employee.health.read',
      'audit_log.read',
      'normative_param.read',
    ],
  },
  Manager: {
    descripcion:
      'Jefe de área: ve datos generales de sus reportes directos, NUNCA salud ni ingresos',
    permissions: ['employee.read'],
  },
  Employee: {
    descripcion: 'Colaborador: autoservicio sobre sus propios datos',
    permissions: ['employee.read'],
  },
};

// Valores de referencia — NO confirmados. Ver validaciones-normativas-pendientes.md
// sección A antes de usar en producción. vigenciaDesde es un marcador de placeholder;
// debe reemplazarse por el periodo real de arranque del primer tenant.
const NORMATIVE_PARAMETERS_SEED = [
  { codigo: 'UIT', valor: 5350, descripcion: 'Unidad Impositiva Tributaria — valor de referencia sin confirmar' },
  { codigo: 'RMV', valor: 1130, descripcion: 'Remuneración Mínima Vital — valor de referencia sin confirmar' },
  { codigo: 'ESSALUD_TASA', valor: 0.09, descripcion: 'Aporte EsSalud empleador — valor de referencia sin confirmar' },
  { codigo: 'ONP_TASA', valor: 0.13, descripcion: 'Aporte ONP — valor de referencia sin confirmar' },
  {
    codigo: 'AFP_APORTE_OBLIGATORIO',
    valor: 0.1,
    descripcion: 'Aporte obligatorio AFP — valor de referencia sin confirmar, falta comisión/prima por administradora',
  },
  {
    codigo: 'GRATIFICACION_BONIF_EXTRAORD',
    valor: { essalud: 0.09, eps: 0.0675 },
    descripcion: 'Bonificación extraordinaria Ley 30334 sobre gratificación — valor de referencia sin confirmar',
  },
  {
    codigo: 'HORAS_EXTRA_TASAS',
    valor: { primeras_2h: 0.25, siguientes: 0.35, feriado_descanso: 1.0 },
    descripcion: 'Sobretasas de horas extra — valor de referencia sin confirmar',
  },
  {
    codigo: 'ASIGNACION_FAMILIAR_PCT',
    valor: 0.1,
    descripcion: 'Asignación familiar como % de la RMV — valor de referencia sin confirmar',
  },
  {
    codigo: 'QUINTA_DEDUCCION_UIT',
    valor: 7,
    descripcion: 'Deducción fija Renta 5ta Categoría en UIT — valor de referencia sin confirmar',
  },
] as const;

async function main() {
  console.log('Sembrando catálogo de permisos...');
  for (const permission of PERMISSIONS) {
    await prisma.permission.upsert({
      where: { code: permission.code },
      update: { descripcion: permission.descripcion, esSensible: permission.esSensible },
      create: permission,
    });
  }

  console.log('Sembrando roles de sistema...');
  for (const [nombre, { descripcion, permissions }] of Object.entries(SYSTEM_ROLES)) {
    const existing = await prisma.role.findFirst({
      where: { nombre, tenantId: null, esSistema: true },
    });
    const role =
      existing ??
      (await prisma.role.create({
        data: { nombre, descripcion, esSistema: true, tenantId: null },
      }));

    for (const code of permissions) {
      const permission = await prisma.permission.findUniqueOrThrow({ where: { code } });
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: role.id, permissionId: permission.id } },
        update: {},
        create: { roleId: role.id, permissionId: permission.id },
      });
    }
  }

  console.log('Sembrando parámetros normativos de referencia (SIN CONFIRMAR)...');
  const vigenciaDesde = new Date('2026-01-01');
  for (const param of NORMATIVE_PARAMETERS_SEED) {
    const existing = await prisma.normativeParameter.findFirst({
      where: { codigo: param.codigo, vigenciaHasta: null },
    });
    if (existing) continue; // NORMATIVE_PARAMETER nunca se sobreescribe (ver diseño Fase 0)
    await prisma.normativeParameter.create({
      data: {
        codigo: param.codigo,
        valor: param.valor as never,
        vigenciaDesde,
        vigenciaHasta: null,
        descripcion: param.descripcion,
      },
    });
  }

  console.log('Seed completo.');
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
