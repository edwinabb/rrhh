import { Controller, Get, UseGuards } from '@nestjs/common';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { getTenantContext } from '../../common/database/tenant-request-context';
import { EmployeesService } from './employees.service';

@Controller('employees')
@UseGuards(PermissionsGuard)
export class EmployeesController {
  constructor(private readonly employeesService: EmployeesService) {}

  @Get()
  @RequirePermission('employee.read')
  async list() {
    const ctx = getTenantContext();
    return this.employeesService.list(ctx);
  }
}
