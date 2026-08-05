import { IntercambioTurnoService } from './intercambio-turno.service';
import { IntercambioTurnoAplicadorService } from './intercambio-turno-aplicador.service';
import { CompensatorioService } from './compensatorio.service';

/**
 * Fake Prisma transaction: cubre la superficie de intercambioTurno,
 * turnoAsignacion y employee usada por IntercambioTurnoService,
 * IntercambioTurnoAplicadorService y CompensatorioService juntos, sin BD real.
 */
function createFakeTx() {
  const intercambios = new Map<string, any>();
  const employees = new Map<string, any>();
  const asignaciones = new Map<string, any>();
  let seq = 0;

  const keyAsig = (employeeId: string, fecha: Date) => `${employeeId}|${fecha.toISOString().slice(0, 10)}`;

  return {
    intercambioTurno: {
      findUnique: async ({ where }: any) => intercambios.get(where.id) ?? null,
      findFirst: async ({ where }: any) => {
        for (const it of intercambios.values()) {
          if (
            it.tenantId === where.tenantId && it.employeeIdA === where.employeeIdA &&
            it.employeeIdB === where.employeeIdB && it.fecha.getTime() === where.fecha.getTime() &&
            where.estado.in.includes(it.estado)
          ) return it;
        }
        return null;
      },
      findMany: async ({ where }: any) =>
        [...intercambios.values()].filter(
          (it) => it.tenantId === where.tenantId && it.estado === where.estado &&
                  (!where.fecha?.lte || it.fecha <= where.fecha.lte),
        ),
      create: async ({ data }: any) => {
        const id = `int-${++seq}`;
        const record = { id, creadoEn: new Date(), ...data };
        intercambios.set(id, record);
        return record;
      },
      update: async ({ where, data }: any) => {
        const updated = { ...intercambios.get(where.id), ...data };
        intercambios.set(where.id, updated);
        return updated;
      },
    },
    employee: {
      findUnique: async ({ where }: any) => employees.get(where.id) ?? null,
    },
    turnoAsignacion: {
      findUnique: async ({ where }: any) => {
        const k = where.tenantId_employeeId_fecha;
        return asignaciones.get(keyAsig(k.employeeId, k.fecha)) ?? null;
      },
      update: async ({ where, data }: any) => {
        for (const [key, val] of asignaciones.entries()) {
          if (val.id === where.id) {
            const updated = { ...val, ...data };
            asignaciones.set(key, updated);
            return updated;
          }
        }
        return null;
      },
    },
    _intercambios: intercambios,
    _employees: employees,
    _asignaciones: asignaciones,
    _keyAsig: keyAsig,
  };
}

function fechaFutura(dias: number): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + dias);
  return d;
}

describe('Feature 4: Portal de Intercambios (E2E)', () => {
  let notificationService: any;
  let intercambios: IntercambioTurnoService;
  let aplicador: IntercambioTurnoAplicadorService;

  beforeEach(() => {
    notificationService = {
      notificarIntercambioAprobado: jest.fn().mockResolvedValue(undefined),
      notificarIntercambioRechazado: jest.fn().mockResolvedValue(undefined),
    };
    intercambios = new IntercambioTurnoService();
    aplicador = new IntercambioTurnoAplicadorService(new CompensatorioService(), notificationService);
  });

  it('flujo principal: A propone, B acepta, Manager aprueba → turnos intercambiados', async () => {
    const tx = createFakeTx();
    const tenantId = 't-1';
    tx._employees.set('emp-a', { id: 'emp-a', estado: 'activo' });
    tx._employees.set('emp-b', { id: 'emp-b', estado: 'activo' });
    const fecha = fechaFutura(10);
    tx._asignaciones.set(tx._keyAsig('emp-a', fecha), { id: 'asig-a', tipoDia: 'TURNO', turnoId: 'turno-dia' });
    tx._asignaciones.set(tx._keyAsig('emp-b', fecha), { id: 'asig-b', tipoDia: 'TURNO', turnoId: 'turno-noche' });

    const propuesta = await intercambios.proponer(tx, {
      tenantId, employeeIdA: 'emp-a', employeeIdB: 'emp-b', fecha, mensajeA: 'Tengo cita', creadoPor: 'emp-a',
    });
    expect(propuesta.estado).toBe('PENDIENTE_ACEPTACION_B');

    const aceptada = await intercambios.aceptar(tx, tenantId, propuesta.id, 'emp-b');
    expect(aceptada.estado).toBe('ACEPTADA_POR_B');

    const aprobada = await aplicador.aprobar(tx, tenantId, propuesta.id, 'mgr-1');
    expect(aprobada.estado).toBe('APROBADA_MANAGER');
    expect(aprobada.decididoPor).toBe('mgr-1');

    expect(tx._asignaciones.get(tx._keyAsig('emp-a', fecha)).tipoDia).toBe('TURNO');
    expect(tx._asignaciones.get(tx._keyAsig('emp-a', fecha)).turnoId).toBe('turno-noche');
    expect(tx._asignaciones.get(tx._keyAsig('emp-b', fecha)).turnoId).toBe('turno-dia');
    expect(notificationService.notificarIntercambioAprobado).toHaveBeenCalledWith(
      tenantId, 'emp-a', 'emp-b', fecha, false,
    );
  });

  it('B rechaza la propuesta: no llega al manager, no se ejecuta swap', async () => {
    const tx = createFakeTx();
    const tenantId = 't-1';
    tx._employees.set('emp-a', { id: 'emp-a', estado: 'activo' });
    tx._employees.set('emp-b', { id: 'emp-b', estado: 'activo' });
    const fecha = fechaFutura(10);
    tx._asignaciones.set(tx._keyAsig('emp-a', fecha), { id: 'asig-a', tipoDia: 'TURNO' });
    tx._asignaciones.set(tx._keyAsig('emp-b', fecha), { id: 'asig-b', tipoDia: 'DESCANSO' });

    const propuesta = await intercambios.proponer(tx, {
      tenantId, employeeIdA: 'emp-a', employeeIdB: 'emp-b', fecha, creadoPor: 'emp-a',
    });
    const rechazada = await intercambios.rechazarPorB(tx, tenantId, propuesta.id, 'emp-b', 'No puedo');

    expect(rechazada.estado).toBe('RECHAZADA_POR_B');
    expect(tx._asignaciones.get(tx._keyAsig('emp-a', fecha)).tipoDia).toBe('TURNO'); // sin cambios
  });

  it('auto-aprobación por plazo de 48h sin decisión del manager', async () => {
    const tx = createFakeTx();
    const tenantId = 't-1';
    tx._employees.set('emp-a', { id: 'emp-a', estado: 'activo' });
    tx._employees.set('emp-b', { id: 'emp-b', estado: 'activo' });
    const fecha = fechaFutura(30);
    tx._asignaciones.set(tx._keyAsig('emp-a', fecha), { id: 'asig-a', tipoDia: 'TURNO', turnoId: 'turno-dia' });
    tx._asignaciones.set(tx._keyAsig('emp-b', fecha), { id: 'asig-b', tipoDia: 'TURNO', turnoId: 'turno-noche' });

    const propuesta = await intercambios.proponer(tx, {
      tenantId, employeeIdA: 'emp-a', employeeIdB: 'emp-b', fecha, creadoPor: 'emp-a',
    });
    await intercambios.aceptar(tx, tenantId, propuesta.id, 'emp-b');
    // Simula que aceptó hace 49h (más allá del plazo de 48h)
    tx._intercambios.get(propuesta.id).aceptadoEn = new Date(Date.now() - 49 * 60 * 60 * 1000);

    await aplicador.barrido(tx, tenantId);

    const resuelta = tx._intercambios.get(propuesta.id);
    expect(resuelta.estado).toBe('AUTO_APROBADA');
    expect(resuelta.motivoResolucion).toBe('PLAZO_48H');
    expect(resuelta.decididoPor).toBeNull();
    expect(tx._asignaciones.get(tx._keyAsig('emp-a', fecha)).turnoId).toBe('turno-noche');
  });

  it('auto-aprobación por fecha alcanzada, incluso sin pasar 48h', async () => {
    const tx = createFakeTx();
    const tenantId = 't-1';
    tx._employees.set('emp-a', { id: 'emp-a', estado: 'activo' });
    tx._employees.set('emp-b', { id: 'emp-b', estado: 'activo' });
    const fecha = fechaFutura(1);
    tx._asignaciones.set(tx._keyAsig('emp-a', fecha), { id: 'asig-a', tipoDia: 'TURNO', turnoId: 'turno-dia' });
    tx._asignaciones.set(tx._keyAsig('emp-b', fecha), { id: 'asig-b', tipoDia: 'TURNO', turnoId: 'turno-noche' });

    const propuesta = await intercambios.proponer(tx, {
      tenantId, employeeIdA: 'emp-a', employeeIdB: 'emp-b', fecha, creadoPor: 'emp-a',
    });
    await intercambios.aceptar(tx, tenantId, propuesta.id, 'emp-b');
    // "Avanza el calendario": la fecha del turno ya llegó, aceptó hace 1h.
    tx._intercambios.get(propuesta.id).fecha = fechaFutura(0);
    tx._intercambios.get(propuesta.id).aceptadoEn = new Date(Date.now() - 60 * 60 * 1000);
    tx._asignaciones.set(tx._keyAsig('emp-a', fechaFutura(0)), tx._asignaciones.get(tx._keyAsig('emp-a', fecha)));
    tx._asignaciones.set(tx._keyAsig('emp-b', fechaFutura(0)), tx._asignaciones.get(tx._keyAsig('emp-b', fecha)));

    await aplicador.barrido(tx, tenantId);

    const resuelta = tx._intercambios.get(propuesta.id);
    expect(resuelta.estado).toBe('AUTO_APROBADA');
    expect(resuelta.motivoResolucion).toBe('FECHA_ALCANZADA');
  });

  it('rechazo automático: el turno de A cambió entre la propuesta y la aprobación del manager', async () => {
    const tx = createFakeTx();
    const tenantId = 't-1';
    tx._employees.set('emp-a', { id: 'emp-a', estado: 'activo' });
    tx._employees.set('emp-b', { id: 'emp-b', estado: 'activo' });
    const fecha = fechaFutura(10);
    tx._asignaciones.set(tx._keyAsig('emp-a', fecha), { id: 'asig-a', tipoDia: 'TURNO', turnoId: 'turno-dia' });
    tx._asignaciones.set(tx._keyAsig('emp-b', fecha), { id: 'asig-b', tipoDia: 'TURNO', turnoId: 'turno-noche' });

    const propuesta = await intercambios.proponer(tx, {
      tenantId, employeeIdA: 'emp-a', employeeIdB: 'emp-b', fecha, creadoPor: 'emp-a',
    });
    await intercambios.aceptar(tx, tenantId, propuesta.id, 'emp-b');

    // El manager reasigna a A a DESCANSO esa fecha antes de que se apruebe el intercambio.
    tx._asignaciones.set(tx._keyAsig('emp-a', fecha), { id: 'asig-a', tipoDia: 'DESCANSO' });

    const resultado = await aplicador.aprobar(tx, tenantId, propuesta.id, 'mgr-1');

    expect(resultado.estado).toBe('RECHAZADA_AUTOMATICA');
    expect(resultado.motivoResolucion).toBe('TURNO_MODIFICADO');
    expect(notificationService.notificarIntercambioRechazado).toHaveBeenCalled();
  });

  it('rechazo automático: fecha alcanzada sin que B respondiera', async () => {
    const tx = createFakeTx();
    const tenantId = 't-1';
    tx._employees.set('emp-a', { id: 'emp-a', estado: 'activo' });
    tx._employees.set('emp-b', { id: 'emp-b', estado: 'activo' });
    const fecha = fechaFutura(1);
    tx._asignaciones.set(tx._keyAsig('emp-a', fecha), { id: 'asig-a', tipoDia: 'TURNO' });
    tx._asignaciones.set(tx._keyAsig('emp-b', fecha), { id: 'asig-b', tipoDia: 'TURNO' });

    const propuesta = await intercambios.proponer(tx, {
      tenantId, employeeIdA: 'emp-a', employeeIdB: 'emp-b', fecha, creadoPor: 'emp-a',
    });
    // B nunca responde. La fecha del turno llega.
    tx._intercambios.get(propuesta.id).fecha = fechaFutura(0);

    await aplicador.barrido(tx, tenantId);

    const resuelta = tx._intercambios.get(propuesta.id);
    expect(resuelta.estado).toBe('RECHAZADA_AUTOMATICA');
    expect(resuelta.motivoResolucion).toBe('FECHA_ALCANZADA_SIN_RESPUESTA_B');
  });

  it('duplicado: no permite 2 propuestas pendientes del mismo par para la misma fecha', async () => {
    const tx = createFakeTx();
    const tenantId = 't-1';
    tx._employees.set('emp-a', { id: 'emp-a', estado: 'activo' });
    tx._employees.set('emp-b', { id: 'emp-b', estado: 'activo' });
    const fecha = fechaFutura(10);
    tx._asignaciones.set(tx._keyAsig('emp-a', fecha), { id: 'asig-a', tipoDia: 'TURNO' });
    tx._asignaciones.set(tx._keyAsig('emp-b', fecha), { id: 'asig-b', tipoDia: 'TURNO' });

    await intercambios.proponer(tx, { tenantId, employeeIdA: 'emp-a', employeeIdB: 'emp-b', fecha, creadoPor: 'emp-a' });

    await expect(
      intercambios.proponer(tx, { tenantId, employeeIdA: 'emp-a', employeeIdB: 'emp-b', fecha, creadoPor: 'emp-a' }),
    ).rejects.toThrow(/pendiente/);
  });
});
