import { createTenant, cleanupTenant, withTenantContext, rootClient } from './test-db';

describe('Seguridad de columna (roles nativos de Postgres + vistas)', () => {
  let tenant: { id: string };
  let sedeId: string;

  beforeAll(async () => {
    tenant = await createTenant('10000000003', 'Empresa Columnas S.A.C.');
    const sede = await rootClient.sede.create({ data: { tenantId: tenant.id, nombre: 'Sede 1' } });
    sedeId = sede.id;
    await rootClient.employee.create({
      data: {
        tenantId: tenant.id,
        sedeId,
        tipoDocumento: '01',
        numeroDocumento: '12345678',
        nombres: 'Ana',
        apellidos: 'Pérez',
      },
    });
  });

  afterAll(async () => {
    await cleanupTenant(tenant.id);
    await rootClient.$disconnect();
  });

  it('app_manager NO puede leer la tabla base "employee" directamente', async () => {
    await expect(
      withTenantContext({ tenantId: tenant.id, pgRole: 'app_manager' }, (tx) =>
        tx.employee.findMany(),
      ),
    ).rejects.toThrow(/permission denied/i);
  });

  it('app_employee NO puede leer la tabla base "employee" directamente', async () => {
    await expect(
      withTenantContext({ tenantId: tenant.id, pgRole: 'app_employee' }, (tx) =>
        tx.employee.findMany(),
      ),
    ).rejects.toThrow(/permission denied/i);
  });

  it('app_manager SÍ puede leer employee_view_manager', async () => {
    const rows = await withTenantContext(
      { tenantId: tenant.id, pgRole: 'app_manager' },
      (tx) => tx.$queryRawUnsafe<Array<Record<string, unknown>>>('SELECT * FROM "employee_view_manager"'),
    );

    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0]).toHaveProperty('nombres');
  });

  it('app_rrhh y app_admin sí pueden leer la tabla base directamente', async () => {
    const asRrhh = await withTenantContext({ tenantId: tenant.id, pgRole: 'app_rrhh' }, (tx) =>
      tx.employee.findMany(),
    );
    const asAdmin = await withTenantContext({ tenantId: tenant.id, pgRole: 'app_admin' }, (tx) =>
      tx.employee.findMany(),
    );

    expect(asRrhh.length).toBeGreaterThan(0);
    expect(asAdmin.length).toBeGreaterThan(0);
  });
});
