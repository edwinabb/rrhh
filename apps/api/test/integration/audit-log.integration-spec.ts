import { createTenant, cleanupTenant, withTenantContext, rootClient } from './test-db';

describe('Auditoría inmutable (trigger genérico + append-only)', () => {
  let tenant: { id: string };

  beforeAll(async () => {
    tenant = await createTenant('10000000004', 'Empresa Auditoria S.A.C.');
  });

  afterAll(async () => {
    await cleanupTenant(tenant.id);
    await rootClient.$disconnect();
  });

  it('crear un employee genera una fila en audit_log con tenant_id/accion correctos', async () => {
    const sede = await rootClient.sede.create({ data: { tenantId: tenant.id, nombre: 'Sede' } });

    await withTenantContext({ tenantId: tenant.id, pgRole: 'app_rrhh' }, (tx) =>
      tx.employee.create({
        data: {
          tenantId: tenant.id,
          sedeId: sede.id,
          tipoDocumento: '01',
          numeroDocumento: '87654321',
          nombres: 'Luis',
          apellidos: 'Gómez',
        },
      }),
    );

    const logs = await rootClient.auditLog.findMany({
      where: { tenantId: tenant.id, tabla: 'employee', accion: 'INSERT' },
    });

    expect(logs.length).toBeGreaterThanOrEqual(1);
    expect(logs[0]?.valoresNuevos).toBeTruthy();
  });

  it('ningún rol de aplicación, ni siquiera app_admin, puede hacer UPDATE sobre audit_log', async () => {
    const anyLog = await rootClient.auditLog.findFirst({ where: { tenantId: tenant.id } });
    expect(anyLog).not.toBeNull();

    await expect(
      withTenantContext({ tenantId: tenant.id, pgRole: 'app_admin' }, (tx) =>
        tx.auditLog.update({ where: { id: anyLog!.id }, data: { tabla: 'manipulado' } }),
      ),
    ).rejects.toThrow(/permission denied/i);
  });

  it('ningún rol de aplicación puede hacer DELETE sobre audit_log', async () => {
    const anyLog = await rootClient.auditLog.findFirst({ where: { tenantId: tenant.id } });
    expect(anyLog).not.toBeNull();

    await expect(
      withTenantContext({ tenantId: tenant.id, pgRole: 'app_admin' }, (tx) =>
        tx.auditLog.delete({ where: { id: anyLog!.id } }),
      ),
    ).rejects.toThrow(/permission denied/i);
  });
});
