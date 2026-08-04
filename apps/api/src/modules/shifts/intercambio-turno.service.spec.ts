import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { IntercambioTurnoService } from './intercambio-turno.service';

function mockTx(overrides: any = {}) {
  const intercambios = new Map<string, any>();
  let seq = 0;
  return {
    intercambioTurno: {
      findUnique: jest.fn(async ({ where }: any) => intercambios.get(where.id) ?? null),
      findFirst: jest.fn(async ({ where }: any) => {
        for (const it of intercambios.values()) {
          if (
            it.tenantId === where.tenantId &&
            it.employeeIdA === where.employeeIdA &&
            it.employeeIdB === where.employeeIdB &&
            it.fecha.getTime() === where.fecha.getTime() &&
            where.estado.in.includes(it.estado)
          ) {
            return it;
          }
        }
        return null;
      }),
      findMany: jest.fn(async ({ where }: any) =>
        [...intercambios.values()].filter(
          (it) => it.tenantId === where.tenantId && it[where.employeeField ?? 'employeeIdA'] === where.employeeValue,
        ),
      ),
      create: jest.fn(async ({ data }: any) => {
        const id = `int-${++seq}`;
        const record = { id, creadoEn: new Date(), ...data };
        intercambios.set(id, record);
        return record;
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const existing = intercambios.get(where.id);
        const updated = { ...existing, ...data };
        intercambios.set(where.id, updated);
        return updated;
      }),
    },
    employee: {
      findUnique: jest.fn(async ({ where }: any) => {
        const employees: any = { 'emp-a': { id: 'emp-a', estado: 'activo' }, 'emp-b': { id: 'emp-b', estado: 'activo' } };
        return employees[where.id] ?? null;
      }),
    },
    turnoAsignacion: {
      findUnique: jest.fn(async ({ where }: any) => {
        const k = where.tenantId_employeeId_fecha;
        if (k.employeeId === 'emp-a') return { tipoDia: 'TURNO', turnoId: 'turno-dia' };
        if (k.employeeId === 'emp-b') return { tipoDia: 'TURNO', turnoId: 'turno-noche' };
        return null;
      }),
    },
    ...overrides,
    _store: intercambios,
  };
}

const FECHA_FUTURA = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000);
FECHA_FUTURA.setHours(0, 0, 0, 0);

describe('IntercambioTurnoService', () => {
  const service = new IntercambioTurnoService();

  describe('proponer', () => {
    it('crea la propuesta con snapshot de los turnos actuales', async () => {
      const tx = mockTx();
      const resultado = await service.proponer(tx, {
        tenantId: 't-1', employeeIdA: 'emp-a', employeeIdB: 'emp-b',
        fecha: FECHA_FUTURA, mensajeA: 'Tengo cita', creadoPor: 'emp-a',
      });

      expect(resultado.estado).toBe('PENDIENTE_ACEPTACION_B');
      expect(resultado.turnoActualA).toBe('TURNO');
      expect(resultado.turnoActualB).toBe('TURNO');
    });

    it('rechaza si A y B son el mismo empleado', async () => {
      const tx = mockTx();
      await expect(
        service.proponer(tx, {
          tenantId: 't-1', employeeIdA: 'emp-a', employeeIdB: 'emp-a',
          fecha: FECHA_FUTURA, creadoPor: 'emp-a',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rechaza fecha en el pasado', async () => {
      const tx = mockTx();
      await expect(
        service.proponer(tx, {
          tenantId: 't-1', employeeIdA: 'emp-a', employeeIdB: 'emp-b',
          fecha: new Date(2020, 0, 1), creadoPor: 'emp-a',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rechaza si alguno no tiene turnoAsignacion esa fecha', async () => {
      const tx = mockTx({
        turnoAsignacion: { findUnique: jest.fn().mockResolvedValue(null) },
      });
      await expect(
        service.proponer(tx, {
          tenantId: 't-1', employeeIdA: 'emp-a', employeeIdB: 'emp-b',
          fecha: FECHA_FUTURA, creadoPor: 'emp-a',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rechaza empleado inactivo', async () => {
      const tx = mockTx({
        employee: { findUnique: jest.fn().mockResolvedValue({ id: 'emp-a', estado: 'cesado' }) },
      });
      await expect(
        service.proponer(tx, {
          tenantId: 't-1', employeeIdA: 'emp-a', employeeIdB: 'emp-b',
          fecha: FECHA_FUTURA, creadoPor: 'emp-a',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rechaza duplicado del mismo par+fecha ya pendiente', async () => {
      const tx = mockTx();
      await service.proponer(tx, {
        tenantId: 't-1', employeeIdA: 'emp-a', employeeIdB: 'emp-b',
        fecha: FECHA_FUTURA, creadoPor: 'emp-a',
      });
      await expect(
        service.proponer(tx, {
          tenantId: 't-1', employeeIdA: 'emp-a', employeeIdB: 'emp-b',
          fecha: FECHA_FUTURA, creadoPor: 'emp-a',
        }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('aceptar / rechazarPorB', () => {
    it('aceptar mueve a ACEPTADA_POR_B y setea aceptadoEn', async () => {
      const tx = mockTx();
      const propuesta = await service.proponer(tx, {
        tenantId: 't-1', employeeIdA: 'emp-a', employeeIdB: 'emp-b',
        fecha: FECHA_FUTURA, creadoPor: 'emp-a',
      });
      const aceptada = await service.aceptar(tx, 't-1', propuesta.id, 'emp-b');
      expect(aceptada.estado).toBe('ACEPTADA_POR_B');
      expect(aceptada.aceptadoEn).toBeInstanceOf(Date);
    });

    it('aceptar lanza si el llamante no es employeeIdB', async () => {
      const tx = mockTx();
      const propuesta = await service.proponer(tx, {
        tenantId: 't-1', employeeIdA: 'emp-a', employeeIdB: 'emp-b',
        fecha: FECHA_FUTURA, creadoPor: 'emp-a',
      });
      await expect(service.aceptar(tx, 't-1', propuesta.id, 'emp-a')).rejects.toThrow(BadRequestException);
    });

    it('rechazarPorB mueve a RECHAZADA_POR_B con motivo', async () => {
      const tx = mockTx();
      const propuesta = await service.proponer(tx, {
        tenantId: 't-1', employeeIdA: 'emp-a', employeeIdB: 'emp-b',
        fecha: FECHA_FUTURA, creadoPor: 'emp-a',
      });
      const rechazada = await service.rechazarPorB(tx, 't-1', propuesta.id, 'emp-b', 'No puedo ese día');
      expect(rechazada.estado).toBe('RECHAZADA_POR_B');
      expect(rechazada.motivoRechazo).toBe('No puedo ese día');
    });

    it('aceptar sobre id inexistente lanza NotFoundException', async () => {
      const tx = mockTx();
      await expect(service.aceptar(tx, 't-1', 'no-existe', 'emp-b')).rejects.toThrow(NotFoundException);
    });

    it('aceptar sobre propuesta ya resuelta lanza BadRequestException', async () => {
      const tx = mockTx();
      const propuesta = await service.proponer(tx, {
        tenantId: 't-1', employeeIdA: 'emp-a', employeeIdB: 'emp-b',
        fecha: FECHA_FUTURA, creadoPor: 'emp-a',
      });
      await service.rechazarPorB(tx, 't-1', propuesta.id, 'emp-b');
      await expect(service.aceptar(tx, 't-1', propuesta.id, 'emp-b')).rejects.toThrow(BadRequestException);
    });

    it('aceptar lanza NotFoundException si el intercambio pertenece a otro tenant', async () => {
      const tx = mockTx();
      const propuesta = await service.proponer(tx, {
        tenantId: 't-1', employeeIdA: 'emp-a', employeeIdB: 'emp-b',
        fecha: FECHA_FUTURA, creadoPor: 'emp-a',
      });
      await expect(service.aceptar(tx, 't-OTRO', propuesta.id, 'emp-b')).rejects.toThrow(NotFoundException);
    });
  });
});
