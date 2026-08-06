import { SolicitudCambioTurnoService } from './solicitud-cambio-turno.service';
import { SolicitudCambioTurnoAplicadorService } from './solicitud-cambio-turno-aplicador.service';
import { ShiftPlanService } from './shift-plan.service';

/**
 * Fake Prisma transaction: an in-memory store backing the subset of the
 * Prisma client surface touched by SolicitudCambioTurnoService,
 * SolicitudCambioTurnoAplicadorService, and ShiftPlanService.
 *
 * This lets the three real services collaborate exactly as they would inside
 * a `prisma.$transaction(async (tx) => ...)` call, without requiring a live
 * database connection.
 */
function createFakeTx() {
  const solicitudes = new Map<string, any>();
  const turnoAsignaciones = new Map<string, any>();
  const turnos = new Map<string, any>();
  const employees = new Map<string, any>();
  const compensatorioMovimientos: any[] = [];

  let solicitudSeq = 0;
  let asigSeq = 0;

  const keyAsignacion = (tenantId: string, employeeId: string, fecha: Date) =>
    `${tenantId}|${employeeId}|${fecha.toISOString().slice(0, 10)}`;

  const tx = {
    solicitudCambioTurno: {
      findUnique: async ({ where }: any) => solicitudes.get(where.id) ?? null,
      findFirst: async ({ where }: any) => {
        for (const s of solicitudes.values()) {
          if (
            s.tenantId === where.tenantId &&
            s.employeeId === where.employeeId &&
            s.fechaActual.getTime() === where.fechaActual.getTime() &&
            s.estado === where.estado
          ) {
            return s;
          }
        }
        return null;
      },
      findMany: async ({ where, orderBy, include }: any) => {
        let results = [...solicitudes.values()];

        // Apply where filters
        if (where) {
          results = results.filter((s) => {
            if (where.tenantId && s.tenantId !== where.tenantId) return false;
            if (where.estado && s.estado !== where.estado) return false;
            if (where.employeeId && s.employeeId !== where.employeeId) return false;
            if (where.decididoPor && s.decididoPor !== where.decididoPor) return false;

            if (where.fechaSolicitud) {
              const fecha = s.fechaSolicitud.getTime();
              if (where.fechaSolicitud.gte && fecha < where.fechaSolicitud.gte.getTime()) return false;
              if (where.fechaSolicitud.lte && fecha > where.fechaSolicitud.lte.getTime()) return false;
            }

            return true;
          });
        }

        // Apply orderBy
        if (orderBy?.fechaSolicitud === 'desc') {
          results.sort((a, b) => b.fechaSolicitud.getTime() - a.fechaSolicitud.getTime());
        }

        // Hydrate relations
        if (include) {
          results = results.map((s) => ({
            ...s,
            ...(include.employee && {
              employee: employees.get(s.employeeId) ?? { nombre: 'Unknown', email: 'unknown@test.com' },
            }),
            ...(include.turnoActual && {
              turnoActual: s.turnoIdActual ? turnos.get(s.turnoIdActual) : null,
            }),
            ...(include.turnoNuevo && {
              turnoNuevo: s.turnoIdNuevo ? turnos.get(s.turnoIdNuevo) : null,
            }),
          }));
        }

        return results;
      },
      create: async ({ data }: any) => {
        const id = `sol-${++solicitudSeq}`;
        const record = {
          id,
          fechaSolicitud: new Date(),
          ...data,
          fechaActual: new Date(data.fechaActual),
          fechaNueva: new Date(data.fechaNueva),
        };
        solicitudes.set(id, record);
        return record;
      },
      update: async ({ where, data }: any) => {
        const existing = solicitudes.get(where.id);
        if (!existing) return null;
        const updated = {
          ...existing,
          ...data,
          ...(data.fechaDecision && { fechaDecision: new Date(data.fechaDecision) }),
        };
        solicitudes.set(where.id, updated);
        return updated;
      },
    },
    turnoAsignacion: {
      findUnique: async ({ where }: any) => {
        const k = where.tenantId_employeeId_fecha;
        return turnoAsignaciones.get(keyAsignacion(k.tenantId, k.employeeId, k.fecha)) ?? null;
      },
      findFirst: async ({ where }: any) => {
        for (const a of turnoAsignaciones.values()) {
          if (
            a.tenantId === where.tenantId &&
            a.employeeId === where.employeeId &&
            a.fecha.getTime() === where.fecha.getTime()
          ) {
            return a;
          }
        }
        return null;
      },
      findMany: async () => [...turnoAsignaciones.values()],
      upsert: async ({ where, update, create }: any) => {
        const k = where.tenantId_employeeId_fecha;
        const key = keyAsignacion(k.tenantId, k.employeeId, k.fecha);
        const existing = turnoAsignaciones.get(key);
        const record = existing
          ? { ...existing, ...update, fecha: new Date(k.fecha) }
          : { id: `asig-${++asigSeq}`, ...create, fecha: new Date(create.fecha) };
        turnoAsignaciones.set(key, record);
        return record;
      },
    },
    turno: {
      findUnique: async ({ where }: any) => {
        if (where.id) return turnos.get(where.id) ?? null;
        if (where.tenantId_codigo) {
          const { tenantId, codigo } = where.tenantId_codigo;
          for (const t of turnos.values()) {
            if (t.tenantId === tenantId && t.codigo === codigo) return t;
          }
        }
        return null;
      },
    },
    employee: {
      findUnique: async ({ where }: any) => employees.get(where.id) ?? null,
    },
    compensatorioMovimiento: {
      create: async ({ data }: any) => {
        compensatorioMovimientos.push(data);
        return data;
      },
      aggregate: async () => ({ _sum: { dias: 0 } }),
    },
  };

  return {
    tx,
    solicitudes,
    turnoAsignaciones,
    turnos,
    employees,
    compensatorioMovimientos,
  };
}

describe('Feature 2: Cambios de Turno (E2E)', () => {
  // Helper to generate relative dates (independent of when test runs)
  const addDays = (n: number): Date => {
    const date = new Date();
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() + n);
    return date;
  };

  it('Employee solicita cambio, Manager aprueba, verifica side effects, luego retry flow', async () => {
    const tenantId = 't-1';

    const { tx, solicitudes, turnoAsignaciones, turnos, employees, compensatorioMovimientos } =
      createFakeTx();

    // --- Setup: tenant, empleado, turnos catálogo ---
    employees.set('emp-1', { id: 'emp-1', tenantId, estado: 'activo', nombre: 'Juan', email: 'juan@test.com' });

    turnos.set('turno-noche', {
      id: 'turno-noche',
      tenantId,
      codigo: 'NOCHE',
      nombre: 'Noche',
      activo: true,
    });
    turnos.set('turno-dia', {
      id: 'turno-dia',
      tenantId,
      codigo: 'DIA',
      nombre: 'Día',
      activo: true,
    });

    // --- Setup: Asignaciones iniciales (empleado tiene NOCHE mañana) ---
    const dateActual = addDays(1);
    const dateNueva = addDays(5);
    const dateAlternate = addDays(10);

    turnoAsignaciones.set(`t-1|emp-1|${dateActual.toISOString().slice(0, 10)}`, {
      id: 'asig-1',
      tenantId,
      employeeId: 'emp-1',
      fecha: dateActual,
      tipoDia: 'TURNO',
      turnoId: 'turno-noche',
    });

    // 5 days from now está libre (DESCANSO)
    turnoAsignaciones.set(`t-1|emp-1|${dateNueva.toISOString().slice(0, 10)}`, {
      id: 'asig-2',
      tenantId,
      employeeId: 'emp-1',
      fecha: dateNueva,
      tipoDia: 'DESCANSO',
      turnoId: null,
    });

    const solicitudService = new SolicitudCambioTurnoService({} as any);
    const shiftPlanService = new ShiftPlanService({} as any);
    const mockNotificationService = {
      notificarSolicitudAprobada: jest.fn().mockResolvedValue(undefined),
      notificarSolicitudRechazada: jest.fn().mockResolvedValue(undefined),
    };
    const aplicadorService = new SolicitudCambioTurnoAplicadorService(
      solicitudService,
      shiftPlanService,
      mockNotificationService as any,
    );

    // ===== STEP 1: Employee creates request: change from NOCHE to DIA =====
    const solicitud1 = await solicitudService.crearSolicitud(tx, {
      tenantId,
      employeeId: 'emp-1',
      fechaActual: dateActual,
      turnoIdActual: 'turno-noche',
      fechaNueva: dateNueva,
      turnoIdNuevo: 'turno-dia',
      creadoPor: 'emp-1',
    });

    // ===== STEP 2: Verify solicitud created with estado=PENDIENTE =====
    expect(solicitud1.id).toBeDefined();
    expect(solicitud1.estado).toBe('PENDIENTE');
    expect(solicitud1.employeeId).toBe('emp-1');
    expect(solicitud1.fechaActual).toEqual(dateActual);
    expect(solicitud1.fechaNueva).toEqual(dateNueva);
    expect(solicitud1.turnoIdActual).toBe('turno-noche');
    expect(solicitud1.turnoIdNuevo).toBe('turno-dia');
    expect(solicitud1.creadoPor).toBe('emp-1');

    // Verify stored in tx
    expect(solicitudes.size).toBe(1);
    const storedSolicitud = solicitudes.get(solicitud1.id);
    expect(storedSolicitud.estado).toBe('PENDIENTE');

    // ===== STEP 3: Manager approves solicitud =====
    const aprobada = await aplicadorService.aprobarSolicitud(tx, solicitud1.id, 'mgr-1');

    // ===== STEP 4: Verify turnoAsignacion updated =====
    expect(aprobada.estado).toBe('APROBADA');
    expect(aprobada.decididoPor).toBe('mgr-1');

    // Check that turnoAsignacion was upserted
    const asigDia = turnoAsignaciones.get(`t-1|emp-1|${dateNueva.toISOString().slice(0, 10)}`);
    expect(asigDia).toBeDefined();
    expect(asigDia.tipoDia).toBe('TURNO');
    expect(asigDia.turnoId).toBe('turno-dia');

    // ===== STEP 5: Verify notifications fired (mocked) =====
    expect(mockNotificationService.notificarSolicitudAprobada).toHaveBeenCalledWith(
      tenantId,
      'emp-1',
      dateNueva,
      'Día',
    );

    // ===== STEP 6: Employee tries to request change for another date → creates new PENDIENTE =====
    // Re-assign dateActual back to NOCHE for the retry scenario
    turnoAsignaciones.set(`t-1|emp-1|${dateActual.toISOString().slice(0, 10)}`, {
      id: 'asig-1',
      tenantId,
      employeeId: 'emp-1',
      fecha: dateActual,
      tipoDia: 'TURNO',
      turnoId: 'turno-noche',
    });

    // Setup third date as DESCANSO
    turnoAsignaciones.set(`t-1|emp-1|${dateAlternate.toISOString().slice(0, 10)}`, {
      id: 'asig-3',
      tenantId,
      employeeId: 'emp-1',
      fecha: dateAlternate,
      tipoDia: 'DESCANSO',
      turnoId: null,
    });

    // Now employee requests another change: dateActual NOCHE → dateAlternate DESCANSO
    const solicitud2 = await solicitudService.crearSolicitud(tx, {
      tenantId,
      employeeId: 'emp-1',
      fechaActual: dateActual,
      turnoIdActual: 'turno-noche',
      fechaNueva: dateAlternate,
      turnoIdNuevo: undefined, // Requesting DESCANSO
      creadoPor: 'emp-1',
    });

    // ===== STEP 7: Verify new solicitud created (PENDIENTE) =====
    expect(solicitud2.id).toBeDefined();
    expect(solicitud2.estado).toBe('PENDIENTE');
    expect(solicitud2.employeeId).toBe('emp-1');
    expect(solicitud2.fechaNueva).toEqual(dateAlternate);

    // ===== STEP 8: Manager rejects with motivo "Ya hay cobertura" =====
    const rechazada = await aplicadorService.rechazarSolicitud(
      tx,
      solicitud2.id,
      'mgr-1',
      'Ya hay cobertura',
    );

    // ===== STEP 9: Verify estado=RECHAZADA =====
    expect(rechazada.estado).toBe('RECHAZADA');
    expect(rechazada.motivoRechazo).toBe('Ya hay cobertura');
    expect(rechazada.decididoPor).toBe('mgr-1');
    expect(rechazada.fechaDecision).toBeDefined();

    // ===== STEP 10: Employee retries (loop enabled) =====
    // After rejection, employee can request the same change again.
    // Let's verify they CAN create a new solicitud (no blocking on the rejected one).

    const solicitud3 = await solicitudService.crearSolicitud(tx, {
      tenantId,
      employeeId: 'emp-1',
      fechaActual: dateActual,
      turnoIdActual: 'turno-noche',
      fechaNueva: dateAlternate,
      turnoIdNuevo: undefined,
      creadoPor: 'emp-1',
    });

    expect(solicitud3.id).toBeDefined();
    expect(solicitud3.estado).toBe('PENDIENTE');
    expect(solicitud3.id).not.toBe(solicitud2.id); // Different ID from rejected request

    // ===== STEP 11: Verify all state transitions + side effects correct =====

    // Total solicitudes created
    expect(solicitudes.size).toBe(3);

    // turnoAsignaciones: 3 total (2026-08-05, 2026-08-10, 2026-08-15)
    expect(turnoAsignaciones.size).toBe(3);

    // Check state of solicitudes
    const sol1Final = solicitudes.get(solicitud1.id);
    expect(sol1Final.estado).toBe('APROBADA');
    expect(sol1Final.decididoPor).toBe('mgr-1');

    const sol2Final = solicitudes.get(solicitud2.id);
    expect(sol2Final.estado).toBe('RECHAZADA');
    expect(sol2Final.motivoRechazo).toBe('Ya hay cobertura');

    const sol3Final = solicitudes.get(solicitud3.id);
    expect(sol3Final.estado).toBe('PENDIENTE');

    // Verify the approvals actually updated the plan
    const asigNuevaFinal = turnoAsignaciones.get(`t-1|emp-1|${dateNueva.toISOString().slice(0, 10)}`);
    expect(asigNuevaFinal.tipoDia).toBe('TURNO');
    expect(asigNuevaFinal.turnoId).toBe('turno-dia');

    // dateAlternate should still be DESCANSO (never approved)
    const asigAltFinal = turnoAsignaciones.get(`t-1|emp-1|${dateAlternate.toISOString().slice(0, 10)}`);
    expect(asigAltFinal.tipoDia).toBe('DESCANSO');

    // dateActual should still be NOCHE (we didn't approve changing it)
    const asigActualFinal = turnoAsignaciones.get(`t-1|emp-1|${dateActual.toISOString().slice(0, 10)}`);
    expect(asigActualFinal.tipoDia).toBe('TURNO');
    expect(asigActualFinal.turnoId).toBe('turno-noche');

    // Verify notifications were called appropriately
    expect(mockNotificationService.notificarSolicitudAprobada).toHaveBeenCalledTimes(1);
    expect(mockNotificationService.notificarSolicitudRechazada).toHaveBeenCalledTimes(1);
  });

  it('Reject duplicate PENDIENTE requests for same date', async () => {
    const tenantId = 't-1';
    const { tx, turnoAsignaciones, turnos, employees } = createFakeTx();

    employees.set('emp-1', { id: 'emp-1', tenantId, estado: 'activo' });
    turnos.set('turno-noche', { id: 'turno-noche', tenantId, codigo: 'NOCHE', nombre: 'Noche', activo: true });
    turnos.set('turno-dia', { id: 'turno-dia', tenantId, codigo: 'DIA', nombre: 'Día', activo: true });

    const dateActual = addDays(1);
    const dateNueva = addDays(5);

    turnoAsignaciones.set(`t-1|emp-1|${dateActual.toISOString().slice(0, 10)}`, {
      id: 'asig-1',
      tenantId,
      employeeId: 'emp-1',
      fecha: dateActual,
      tipoDia: 'TURNO',
      turnoId: 'turno-noche',
    });

    const service = new SolicitudCambioTurnoService({} as any);

    const solicitud1 = await service.crearSolicitud(tx, {
      tenantId,
      employeeId: 'emp-1',
      fechaActual: dateActual,
      turnoIdActual: 'turno-noche',
      fechaNueva: dateNueva,
      turnoIdNuevo: 'turno-dia',
      creadoPor: 'emp-1',
    });

    expect(solicitud1.estado).toBe('PENDIENTE');

    // Try to create duplicate
    await expect(
      service.crearSolicitud(tx, {
        tenantId,
        employeeId: 'emp-1',
        fechaActual: dateActual,
        turnoIdActual: 'turno-noche',
        fechaNueva: dateNueva,
        turnoIdNuevo: 'turno-dia',
        creadoPor: 'emp-1',
      }),
    ).rejects.toThrow('Ya existe una solicitud pendiente para esa fecha');
  });

  it('Only allows decision on PENDIENTE solicitud', async () => {
    const tenantId = 't-1';
    const { tx, turnos, employees, solicitudes } = createFakeTx();

    employees.set('emp-1', { id: 'emp-1', tenantId, estado: 'activo' });
    turnos.set('turno-noche', { id: 'turno-noche', tenantId, codigo: 'NOCHE', nombre: 'Noche', activo: true });

    const dateActual = addDays(1);
    const dateNueva = addDays(5);

    // Manually insert an already-decided solicitud
    solicitudes.set('sol-decided', {
      id: 'sol-decided',
      tenantId,
      employeeId: 'emp-1',
      fechaActual: dateActual,
      fechaNueva: dateNueva,
      turnoIdActual: 'turno-noche',
      turnoIdNuevo: null,
      estado: 'APROBADA',
      decididoPor: 'mgr-1',
      fechaDecision: new Date(),
    });

    const service = new SolicitudCambioTurnoService({} as any);

    await expect(
      service.actualizarEstado(tx, 'sol-decided', 'RECHAZADA', 'mgr-2', 'Cambié de opinión'),
    ).rejects.toThrow('Solo se pueden decidir solicitudes en estado PENDIENTE');
  });

  it('Verify turno existence before approval', async () => {
    const tenantId = 't-1';
    const { tx, turnos, employees, solicitudes } = createFakeTx();

    employees.set('emp-1', { id: 'emp-1', tenantId, estado: 'activo' });
    turnos.set('turno-noche', { id: 'turno-noche', tenantId, codigo: 'NOCHE', nombre: 'Noche', activo: true });

    const dateActual = addDays(1);
    const dateNueva = addDays(5);

    // Create a solicitud referencing a non-existent turno
    solicitudes.set('sol-bad-turno', {
      id: 'sol-bad-turno',
      tenantId,
      employeeId: 'emp-1',
      fechaActual: dateActual,
      fechaNueva: dateNueva,
      turnoIdActual: 'turno-noche',
      turnoIdNuevo: 'turno-inexistente',
      estado: 'PENDIENTE',
    });

    const service = new SolicitudCambioTurnoService({} as any);

    await expect(service.actualizarEstado(tx, 'sol-bad-turno', 'APROBADA', 'mgr-1')).rejects.toThrow(
      'El turno nuevo indicado no existe',
    );
  });

  it('Notifications are non-blocking even if they fail', async () => {
    const tenantId = 't-1';
    const { tx, solicitudes, turnoAsignaciones, turnos, employees } = createFakeTx();

    employees.set('emp-1', { id: 'emp-1', tenantId, estado: 'activo', nombre: 'Juan', email: 'juan@test.com' });
    turnos.set('turno-dia', { id: 'turno-dia', tenantId, codigo: 'DIA', nombre: 'Día', activo: true });
    turnos.set('turno-noche', { id: 'turno-noche', tenantId, codigo: 'NOCHE', nombre: 'Noche', activo: true });

    const dateActual = addDays(1);
    const dateNueva = addDays(5);

    turnoAsignaciones.set(`t-1|emp-1|${dateActual.toISOString().slice(0, 10)}`, {
      id: 'asig-1',
      tenantId,
      employeeId: 'emp-1',
      fecha: dateActual,
      tipoDia: 'TURNO',
      turnoId: 'turno-noche',
    });

    // Create a pending solicitud
    const sol = await tx.solicitudCambioTurno.create({
      data: {
        tenantId,
        employeeId: 'emp-1',
        fechaActual: dateActual,
        turnoIdActual: 'turno-noche',
        fechaNueva: dateNueva,
        turnoIdNuevo: 'turno-dia',
        estado: 'PENDIENTE',
        creadoPor: 'emp-1',
      },
    });

    const mockNotificationService = {
      notificarSolicitudAprobada: jest.fn().mockRejectedValue(new Error('Email service down')),
      notificarSolicitudRechazada: jest.fn().mockResolvedValue(undefined),
    };

    const aplicador = new SolicitudCambioTurnoAplicadorService(
      new SolicitudCambioTurnoService({} as any),
      new ShiftPlanService({} as any),
      mockNotificationService as any,
    );

    // Even though notification fails, approval should succeed
    const result = await aplicador.aprobarSolicitud(tx, sol.id, 'mgr-1');

    expect(result.estado).toBe('APROBADA');
    expect(mockNotificationService.notificarSolicitudAprobada).toHaveBeenCalled();

    // turnoAsignacion should be updated despite notification failure
    const asig = turnoAsignaciones.get(`t-1|emp-1|${dateNueva.toISOString().slice(0, 10)}`);
    expect(asig).toBeDefined();
    expect(asig.tipoDia).toBe('TURNO');
    expect(asig.turnoId).toBe('turno-dia');
  });
});
