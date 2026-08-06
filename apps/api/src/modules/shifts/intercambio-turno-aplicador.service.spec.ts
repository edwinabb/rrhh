import { BadRequestException, NotFoundException } from '@nestjs/common';
import { IntercambioTurnoAplicadorService } from './intercambio-turno-aplicador.service';
import { CompensatorioService } from './compensatorio.service';

function mockTx(seed: Record<string, any> = {}) {
  const intercambios = new Map<string, any>(Object.entries(seed.intercambios ?? {}));
  const asignaciones = new Map<string, any>(Object.entries(seed.asignaciones ?? {}));

  return {
    intercambioTurno: {
      findUnique: jest.fn(async ({ where }: any) => intercambios.get(where.id) ?? null),
      findMany: jest.fn(async ({ where }: any) =>
        [...intercambios.values()].filter(
          (it) => it.tenantId === where.tenantId && it.estado === where.estado
                  && (!where.fecha?.lte || it.fecha <= where.fecha.lte),
        ),
      ),
      update: jest.fn(async ({ where, data }: any) => {
        const updated = { ...intercambios.get(where.id), ...data };
        intercambios.set(where.id, updated);
        return updated;
      }),
      updateMany: jest.fn(async ({ where, data }: any) => {
        const actual = intercambios.get(where.id);
        if (!actual || actual.estado !== where.estado) {
          return { count: 0 };
        }
        intercambios.set(where.id, { ...actual, ...data });
        return { count: 1 };
      }),
    },
    turnoAsignacion: {
      findUnique: jest.fn(async ({ where }: any) => {
        const k = where.tenantId_employeeId_fecha;
        return asignaciones.get(`${k.employeeId}|${k.fecha.toISOString().slice(0, 10)}`) ?? null;
      }),
      update: jest.fn(async ({ where, data }: any) => ({ id: where.id, ...data })),
    },
    employee: {
      findUnique: jest.fn(async ({ where }: any) => ({ id: where.id, numeroDocumento: where.id })),
    },
    _intercambios: intercambios,
    _asignaciones: asignaciones,
  };
}

function intercambio(overrides: any = {}) {
  return {
    id: 'int-1', tenantId: 't-1', employeeIdA: 'emp-a', employeeIdB: 'emp-b',
    fecha: new Date(2026, 8, 10), turnoActualA: 'TURNO', turnoActualB: 'TURNO',
    estado: 'ACEPTADA_POR_B', aceptadoEn: new Date(), ...overrides,
  };
}

function asignacion(tipoDia = 'TURNO') {
  return { id: `asig-${Math.random()}`, tipoDia, turnoId: 'turno-x' };
}

// EmployeesService mock: delega en tx.employee.findUnique (ver Group B/D del
// review de fase 9).
const mockEmployees: any = {
  findById: jest.fn((ctx: any, id: string) => ctx.tx.employee.findUnique({ where: { id } })),
};

describe('IntercambioTurnoAplicadorService', () => {
  let notificationService: any;
  let service: IntercambioTurnoAplicadorService;

  beforeEach(() => {
    notificationService = {
      notificarIntercambioAprobado: jest.fn().mockResolvedValue(undefined),
      notificarIntercambioRechazado: jest.fn().mockResolvedValue(undefined),
    };
    service = new IntercambioTurnoAplicadorService(new CompensatorioService(mockEmployees), notificationService);
  });

  describe('aprobar (decisión del manager)', () => {
    it('ejecuta el swap cuando el turno sigue coincidiendo con lo propuesto', async () => {
      const tx = mockTx({
        intercambios: { 'int-1': intercambio() },
        asignaciones: { 'emp-a|2026-09-10': asignacion(), 'emp-b|2026-09-10': asignacion() },
      });

      const resultado = await service.aprobar(tx, 't-1', 'app_rrhh', 'int-1', 'mgr-1');

      expect(resultado.estado).toBe('APROBADA_MANAGER');
      expect(resultado.decididoPor).toBe('mgr-1');
      expect(notificationService.notificarIntercambioAprobado).toHaveBeenCalledWith(
        't-1', 'emp-a', 'emp-b', expect.any(Date), false,
      );
    });

    it('cierra como RECHAZADA_AUTOMATICA si el turno de A cambió desde la propuesta', async () => {
      const tx = mockTx({
        intercambios: { 'int-1': intercambio() },
        asignaciones: { 'emp-a|2026-09-10': asignacion('DESCANSO'), 'emp-b|2026-09-10': asignacion() },
      });

      const resultado = await service.aprobar(tx, 't-1', 'app_rrhh', 'int-1', 'mgr-1');

      expect(resultado.estado).toBe('RECHAZADA_AUTOMATICA');
      expect(resultado.motivoResolucion).toBe('TURNO_MODIFICADO');
      expect(notificationService.notificarIntercambioRechazado).toHaveBeenCalled();
    });

    it('lanza BadRequestException si ya no está en ACEPTADA_POR_B', async () => {
      const tx = mockTx({ intercambios: { 'int-1': intercambio({ estado: 'RECHAZADA_POR_B' }) } });
      await expect(service.aprobar(tx, 't-1', 'app_rrhh', 'int-1', 'mgr-1')).rejects.toThrow(BadRequestException);
    });

    it('lanza NotFoundException si el id no existe', async () => {
      const tx = mockTx();
      await expect(service.aprobar(tx, 't-1', 'app_rrhh', 'no-existe', 'mgr-1')).rejects.toThrow(NotFoundException);
    });
  });

  describe('rechazarManager', () => {
    it('cierra como RECHAZADA_MANAGER sin ejecutar el swap', async () => {
      const tx = mockTx({ intercambios: { 'int-1': intercambio() } });
      const resultado = await service.rechazarManager(tx, 't-1', 'app_rrhh', 'int-1', 'mgr-1', 'No hay cobertura');
      expect(resultado.estado).toBe('RECHAZADA_MANAGER');
      expect(resultado.motivoRechazo).toBe('No hay cobertura');
      expect(tx.turnoAsignacion.update).not.toHaveBeenCalled();
    });
  });

  describe('barrido', () => {
    it('auto-aprueba una ACEPTADA_POR_B con más de 48h desde aceptadoEn', async () => {
      const hace49h = new Date(Date.now() - 49 * 60 * 60 * 1000);
      const fechaFutura = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
      fechaFutura.setHours(0, 0, 0, 0);
      const tx = mockTx({
        intercambios: { 'int-1': intercambio({ fecha: fechaFutura, aceptadoEn: hace49h }) },
        asignaciones: {
          [`emp-a|${fechaFutura.toISOString().slice(0, 10)}`]: asignacion(),
          [`emp-b|${fechaFutura.toISOString().slice(0, 10)}`]: asignacion(),
        },
      });

      await service.barrido(tx, 't-1', 'app_rrhh');

      const actualizado = await tx.intercambioTurno.findUnique({ where: { id: 'int-1' } });
      expect(actualizado.estado).toBe('AUTO_APROBADA');
      expect(actualizado.motivoResolucion).toBe('PLAZO_48H');
    });

    it('auto-aprueba una ACEPTADA_POR_B cuya fecha ya llegó, aunque no pasaron 48h', async () => {
      const haceUnaHora = new Date(Date.now() - 60 * 60 * 1000);
      const hoy = new Date();
      hoy.setHours(0, 0, 0, 0);
      const tx = mockTx({
        intercambios: { 'int-1': intercambio({ fecha: hoy, aceptadoEn: haceUnaHora }) },
        asignaciones: {
          [`emp-a|${hoy.toISOString().slice(0, 10)}`]: asignacion(),
          [`emp-b|${hoy.toISOString().slice(0, 10)}`]: asignacion(),
        },
      });

      await service.barrido(tx, 't-1', 'app_rrhh');

      const actualizado = await tx.intercambioTurno.findUnique({ where: { id: 'int-1' } });
      expect(actualizado.estado).toBe('AUTO_APROBADA');
      expect(actualizado.motivoResolucion).toBe('FECHA_ALCANZADA');
    });

    it('cierra como RECHAZADA_AUTOMATICA una PENDIENTE_ACEPTACION_B cuya fecha ya llegó', async () => {
      const hoy = new Date();
      hoy.setHours(0, 0, 0, 0);
      const tx = mockTx({
        intercambios: { 'int-1': intercambio({ estado: 'PENDIENTE_ACEPTACION_B', fecha: hoy, aceptadoEn: null }) },
      });

      await service.barrido(tx, 't-1', 'app_rrhh');

      const actualizado = await tx.intercambioTurno.findUnique({ where: { id: 'int-1' } });
      expect(actualizado.estado).toBe('RECHAZADA_AUTOMATICA');
      expect(actualizado.motivoResolucion).toBe('FECHA_ALCANZADA_SIN_RESPUESTA_B');
    });

    it('no toca una ACEPTADA_POR_B reciente cuya fecha es futura', async () => {
      const haceUnaHora = new Date(Date.now() - 60 * 60 * 1000);
      const fechaFutura = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
      const tx = mockTx({
        intercambios: { 'int-1': intercambio({ fecha: fechaFutura, aceptadoEn: haceUnaHora }) },
      });

      await service.barrido(tx, 't-1', 'app_rrhh');

      const actualizado = await tx.intercambioTurno.findUnique({ where: { id: 'int-1' } });
      expect(actualizado.estado).toBe('ACEPTADA_POR_B');
    });

    it('el guard de aprobar/rechazarManager rechaza una propuesta que el barrido ya auto-resolvió', async () => {
      const hoy = new Date();
      hoy.setHours(0, 0, 0, 0);
      const tx = mockTx({
        intercambios: { 'int-1': intercambio({ fecha: hoy, aceptadoEn: new Date() }) },
        asignaciones: {
          [`emp-a|${hoy.toISOString().slice(0, 10)}`]: asignacion(),
          [`emp-b|${hoy.toISOString().slice(0, 10)}`]: asignacion(),
        },
      });

      // El manager llama aprobar() DESPUÉS de que el barrido (corrido dentro
      // del mismo aprobar()) ya resolvió automáticamente por FECHA_ALCANZADA.
      await expect(service.rechazarManager(tx, 't-1', 'app_rrhh', 'int-1', 'mgr-1')).rejects.toThrow(
        /ya no está pendiente/,
      );
    });
  });
});
