import { createTenant, cleanupTenant, withTenantContext, rootClient } from './test-db';

describe('Aislamiento multi-tenant (RLS)', () => {
  let tenantA: { id: string };
  let tenantB: { id: string };

  beforeAll(async () => {
    tenantA = await createTenant('10000000001', 'Empresa A S.A.C.');
    tenantB = await createTenant('10000000002', 'Empresa B S.A.C.');

    await rootClient.sede.create({ data: { tenantId: tenantA.id, nombre: 'Sede A' } });
    await rootClient.sede.create({ data: { tenantId: tenantB.id, nombre: 'Sede B' } });
  });

  afterAll(async () => {
    await cleanupTenant(tenantA.id);
    await cleanupTenant(tenantB.id);
    await rootClient.$disconnect();
  });

  it('una sesión con tenant A nunca ve filas de tenant B, incluso sin filtrar por tenant_id', async () => {
    const sedes = await withTenantContext({ tenantId: tenantA.id, pgRole: 'app_rrhh' }, (tx) =>
      tx.sede.findMany(), // sin WHERE tenant_id — la garantía la da RLS, no el código
    );

    expect(sedes.every((s) => s.tenantId === tenantA.id)).toBe(true);
    expect(sedes.some((s) => s.tenantId === tenantB.id)).toBe(false);
  });

  it('ningún filtro explícito por el tenant_id equivocado puede leer datos ajenos', async () => {
    // Sesión fijada a tenant A, pero el código (con o sin bug) intenta pedir tenant B.
    const sedes = await withTenantContext({ tenantId: tenantA.id, pgRole: 'app_rrhh' }, (tx) =>
      tx.sede.findMany({ where: { tenantId: tenantB.id } }),
    );

    expect(sedes).toHaveLength(0); // RLS + WHERE se combinan con AND; nunca hay fuga
  });

  it('sin app.tenant_id fijado, la policy deniega todo (fail-closed, no fail-open)', async () => {
    const sedes = await withTenantContext({ pgRole: 'app_rrhh' }, (tx) => tx.sede.findMany());

    expect(sedes).toHaveLength(0);
  });
});
