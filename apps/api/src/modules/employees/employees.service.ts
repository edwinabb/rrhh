import { Injectable } from '@nestjs/common';
import type { TenantContext } from '../../common/database/tenant-request-context';

// El rol app_manager/app_employee no tiene GRANT sobre la tabla "employee" base
// (ver migración 20260710000000_init_foundations, sección 5) — solo sobre estas
// vistas, que son las que de verdad excluyen columnas sensibles en Fase 1.
// Prisma no tiene un modelo mapeado a las vistas (no son parte del schema.prisma),
// así que para esos dos roles se consulta la vista por SQL crudo; para
// RRHH/Admin se usa el modelo Prisma normal contra la tabla base.
const VIEW_BY_ROLE: Record<TenantContext['pgRole'], string | null> = {
  app_admin: null,
  app_rrhh: null,
  app_manager: 'employee_view_manager',
  app_employee: 'employee_view_employee',
};

export interface EmployeeListRow {
  id: string;
  nombres: string;
  apellidos: string;
  estado: string;
  [key: string]: unknown;
}

@Injectable()
export class EmployeesService {
  async list(ctx: TenantContext): Promise<EmployeeListRow[]> {
    const view = VIEW_BY_ROLE[ctx.pgRole];
    if (view === null) {
      return ctx.tx.employee.findMany({ where: { tenantId: ctx.tenantId! } });
    }
    // Identificador de vista viene únicamente del mapa cerrado de arriba, nunca
    // de input externo — seguro pese a ser SQL "unsafe" en el nombre de tabla.
    return ctx.tx.$queryRawUnsafe<EmployeeListRow[]>(`SELECT * FROM "${view}"`);
  }
}
