/**
 * Seed inicial de Fase 0: catálogo de permisos, roles de sistema, y parámetros
 * normativos de referencia. Los valores de NORMATIVE_PARAMETER son de referencia
 * (no confirmados contra fuente oficial) — ver
 * docs/superpowers/specs/validaciones-normativas-pendientes.md antes de usarlos
 * en cualquier cálculo real de Fase 1.
 */
import { PrismaClient } from './generated/client';
import * as argon2 from 'argon2';

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
  // Fase 1 — Nómina
  { code: 'payroll.process', descripcion: 'Procesar el ciclo de planilla', esSensible: true },
  { code: 'payroll.export', descripcion: 'Exportar planilla (PLAME, telecrédito)', esSensible: true },
  { code: 'payroll.import', descripcion: 'Importar novedades de planilla por CSV', esSensible: true },
  // Fase 2 — Asistencia
  { code: 'attendance.mark', descripcion: 'Registrar marcación propia', esSensible: false },
  { code: 'attendance.justify', descripcion: 'Solicitar justificación de falta/tardanza', esSensible: false },
  { code: 'attendance.approve', descripcion: 'Aprobar o rechazar justificaciones', esSensible: false },
  { code: 'attendance.read', descripcion: 'Ver asistencia propia', esSensible: false },
  { code: 'attendance.read.team', descripcion: 'Ver asistencia del equipo (dashboard)', esSensible: false },
  { code: 'attendance.import', descripcion: 'Importar marcaciones desde sistema externo', esSensible: false },
  // Fase 3 — Documental
  { code: 'documents.upload', descripcion: 'Subir documentos al legajo', esSensible: false },
  { code: 'documents.read', descripcion: 'Ver y descargar documentos del legajo', esSensible: false },
  { code: 'documents.delete', descripcion: 'Eliminar documentos (soft-delete, Ley 29733)', esSensible: true },
  // Fase 4 — ATS
  { code: 'ats.read', descripcion: 'Ver vacantes', esSensible: false },
  { code: 'ats.apply', descripcion: 'Registrar candidatos a una vacante', esSensible: false },
  { code: 'ats.manage', descripcion: 'Gestionar vacantes, candidatos y contrataciones', esSensible: true },
  // Fase 5 — Cese y Vacaciones
  { code: 'termination.read', descripcion: 'Ver ceses y liquidaciones', esSensible: true },
  { code: 'termination.manage', descripcion: 'Registrar ceses, corregir datos y calcular liquidaciones', esSensible: true },
  { code: 'termination.approve', descripcion: 'Aprobar, pagar y anular liquidaciones', esSensible: true },
  { code: 'vacation.read', descripcion: 'Ver récord vacacional', esSensible: false },
  { code: 'vacation.manage', descripcion: 'Gestionar el récord vacacional', esSensible: false },
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
      'payroll.process',
      'payroll.export',
      'payroll.import',
      'attendance.mark',
      'attendance.justify',
      'attendance.approve',
      'attendance.read',
      'attendance.read.team',
      'attendance.import',
      'documents.upload',
      'documents.read',
      'ats.read',
      'ats.apply',
      'ats.manage',
      'termination.read',
      'termination.manage',
      'vacation.read',
      'vacation.manage',
    ],
  },
  Manager: {
    descripcion:
      'Jefe de área: ve datos generales de sus reportes directos, NUNCA salud ni ingresos',
    permissions: [
      'employee.read',
      'attendance.mark',
      'attendance.justify',
      'attendance.approve',
      'attendance.read',
      'attendance.read.team',
      'documents.read',
      'ats.read',
      'vacation.read',
    ],
  },
  Employee: {
    descripcion: 'Colaborador: autoservicio sobre sus propios datos',
    permissions: [
      'employee.read',
      'attendance.mark',
      'attendance.justify',
      'attendance.read',
      'documents.read',
    ],
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
  {
    codigo: 'INDEMNIZACION_TOPE_REMUNERACIONES',
    valor: 12,
    descripcion: 'Tope de indemnización por despido arbitrario, en remuneraciones (régimen general) — valor de referencia sin confirmar',
  },
  {
    codigo: 'VACACIONES_DIAS_GENERAL',
    valor: 30,
    descripcion: 'Días de vacaciones por período — régimen general/agrario (D.Leg. 713) — valor de referencia sin confirmar',
  },
  {
    codigo: 'VACACIONES_DIAS_MYPE',
    valor: 15,
    descripcion: 'Días de vacaciones por período — micro y pequeña empresa — valor de referencia sin confirmar',
  },
  {
    codigo: 'MYPE_FACTOR_CTS_GRATI',
    valor: { mype_pequena: 0.5, mype_micro: 0 },
    descripcion: 'Factor de CTS/gratificación por régimen MYPE (D.S. 013-2013-PRODUCE) — valor de referencia sin confirmar',
  },
  {
    codigo: 'INDEMNIZACION_MYPE',
    valor: { mype_pequena: { diasPorAnio: 20, topeDias: 120 }, mype_micro: { diasPorAnio: 10, topeDias: 90 } },
    descripcion: 'Indemnización por despido en MYPE: remuneraciones diarias por año y tope — valor de referencia sin confirmar',
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

  await seedDemoTenant();

  console.log('Seed completo.');
}

/**
 * Tenant demo para desarrollo local. Idempotente (upserts por claves naturales).
 * Credenciales: admin@demo.pe / Admin123! · rrhh@demo.pe / Rrhh123! ·
 * empleado@demo.pe / Empleado123!
 * Los usuarios se asignan a los roles de SISTEMA (tenantId null) — AuthService
 * resuelve el rol de Postgres por role.nombre, no por tenant del rol.
 */
async function seedDemoTenant() {
  console.log('Sembrando tenant demo...');
  const tenant = await prisma.tenant.upsert({
    where: { ruc: '20123456789' },
    update: {},
    create: {
      ruc: '20123456789',
      razonSocial: 'Demo Peru S.A.C.',
      nombreComercial: 'Demo Perú',
      direccionFiscal: 'Av. Javier Prado Este 123, San Isidro, Lima',
    },
  });

  let sede = await prisma.sede.findFirst({
    where: { tenantId: tenant.id, nombre: 'Sede Central Lima' },
  });
  if (!sede) {
    sede = await prisma.sede.create({
      data: {
        tenantId: tenant.id,
        nombre: 'Sede Central Lima',
        direccion: 'Av. Javier Prado Este 123, San Isidro',
      },
    });
  }

  await prisma.geofence.upsert({
    where: { tenantId_sedeId: { tenantId: tenant.id, sedeId: sede.id } },
    update: {},
    create: {
      tenantId: tenant.id,
      sedeId: sede.id,
      latitud: -12.0904,
      longitud: -77.0355,
      radioMetros: 150,
      nombre: 'Oficina San Isidro',
    },
  });

  await prisma.configuracionAsistencia.upsert({
    where: { tenantId: tenant.id },
    update: {},
    create: { tenantId: tenant.id }, // defaults: 08:00-17:00, tolerancia 15 min
  });

  const demoUsers = [
    { email: 'admin@demo.pe', password: 'Admin123!', rol: 'Admin', doc: '45678901', nombres: 'Ana', apellidos: 'Torres Quispe', sueldo: 8000, sistema: 'afp' as const },
    { email: 'rrhh@demo.pe', password: 'Rrhh123!', rol: 'RRHH', doc: '41234567', nombres: 'Carlos', apellidos: 'Mendoza Ríos', sueldo: 5500, sistema: 'afp' as const },
    { email: 'empleado@demo.pe', password: 'Empleado123!', rol: 'Employee', doc: '47890123', nombres: 'María', apellidos: 'García Flores', sueldo: 2500, sistema: 'onp' as const },
  ];

  for (const u of demoUsers) {
    const user =
      (await prisma.user.findUnique({ where: { email: u.email } })) ??
      (await prisma.user.create({
        data: { tenantId: tenant.id, email: u.email, passwordHash: await argon2.hash(u.password) },
      }));

    const role = await prisma.role.findFirstOrThrow({
      where: { nombre: u.rol, tenantId: null, esSistema: true },
    });
    await prisma.userRole.upsert({
      where: { userId_roleId: { userId: user.id, roleId: role.id } },
      update: {},
      create: { userId: user.id, roleId: role.id },
    });

    const employee = await prisma.employee.upsert({
      where: {
        tenantId_tipoDocumento_numeroDocumento: {
          tenantId: tenant.id,
          tipoDocumento: '01',
          numeroDocumento: u.doc,
        },
      },
      update: {},
      create: {
        tenantId: tenant.id,
        sedeId: sede.id,
        userId: user.id,
        tipoDocumento: '01', // DNI (Tabla 3 SUNAT)
        numeroDocumento: u.doc,
        nombres: u.nombres,
        apellidos: u.apellidos,
      },
    });

    const contrato = await prisma.contrato.findFirst({ where: { employeeId: employee.id } });
    if (!contrato) {
      await prisma.contrato.create({
        data: {
          employeeId: employee.id,
          regimenLaboral: 'general',
          regimenLaboralSunat: '01', // D.Leg. 728 (Tabla 33)
          tipoTrabajadorSunat: '21', // empleado (Tabla 8)
          tipoContrato: 'indeterminado',
          tipoContratoSunat: '01', // plazo indeterminado (Tabla 12)
          fechaInicio: new Date('2025-01-02'),
          jornada: { horasDia: 8, diasSemana: 5 },
          remuneracionBasica: u.sueldo,
        },
      });
    }

    const regimen = await prisma.regimenPensionario.findFirst({ where: { employeeId: employee.id } });
    if (!regimen) {
      await prisma.regimenPensionario.create({
        data: {
          employeeId: employee.id,
          sistema: u.sistema,
          administradora: u.sistema === 'afp' ? 'integra' : null,
          tipoComision: u.sistema === 'afp' ? 'flujo' : null,
          codigoSunat: u.sistema === 'afp' ? '21' : '02', // Tabla 11
          fechaAfiliacion: new Date('2025-01-02'),
        },
      });
    }
  }

  console.log(`  Tenant demo: ${tenant.razonSocial} (RUC ${tenant.ruc})`);
  console.log('  Usuarios: admin@demo.pe / Admin123! · rrhh@demo.pe / Rrhh123! · empleado@demo.pe / Empleado123!');
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
