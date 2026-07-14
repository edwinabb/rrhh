import { PermissionsService, PermissionsQueryClient } from './permissions.service';

function fakeClient(
  userRoles: Array<{ role: { permissions: Array<{ permission: { code: string } }> } }>,
): PermissionsQueryClient {
  return {
    userRole: {
      findMany: jest.fn().mockResolvedValue(userRoles),
    },
  };
}

describe('PermissionsService', () => {
  let service: PermissionsService;

  beforeEach(() => {
    service = new PermissionsService();
  });

  it('devuelve lista vacía cuando el usuario no tiene roles asignados', async () => {
    const client = fakeClient([]);

    const result = await service.getPermissionCodesForUser(client, 'user-1');

    expect(result).toEqual([]);
  });

  it('agrega los permisos de un único rol', async () => {
    const client = fakeClient([
      {
        role: {
          permissions: [
            { permission: { code: 'employee.read' } },
            { permission: { code: 'employee.write' } },
          ],
        },
      },
    ]);

    const result = await service.getPermissionCodesForUser(client, 'user-1');

    expect(result.sort()).toEqual(['employee.read', 'employee.write']);
  });

  it('une permisos de varios roles sin duplicados', async () => {
    const client = fakeClient([
      { role: { permissions: [{ permission: { code: 'employee.read' } }] } },
      {
        role: {
          permissions: [
            { permission: { code: 'employee.read' } }, // duplicado intencional
            { permission: { code: 'audit_log.read' } },
          ],
        },
      },
    ]);

    const result = await service.getPermissionCodesForUser(client, 'user-1');

    expect(result.sort()).toEqual(['audit_log.read', 'employee.read']);
  });

  it('nunca inventa permisos que no vinieron del cliente de datos', async () => {
    const client = fakeClient([
      { role: { permissions: [{ permission: { code: 'role.manage' } }] } },
    ]);

    const result = await service.getPermissionCodesForUser(client, 'user-1');

    expect(result).not.toContain('normative_param.write');
    expect(client.userRole.findMany).toHaveBeenCalledWith({
      where: { userId: 'user-1' },
      include: { role: { include: { permissions: { include: { permission: true } } } } },
    });
  });
});
