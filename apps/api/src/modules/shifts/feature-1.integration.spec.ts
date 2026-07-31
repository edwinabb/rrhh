import { RotacionPatronService } from './rotacion-patron.service';
import { RotacionAplicadorService } from './rotacion-aplicador.service';
import { ShiftPlanService } from './shift-plan.service';

/**
 * Fake Prisma transaction: an in-memory store backing the subset of the
 * Prisma client surface touched by RotacionPatronService, RotacionAplicadorService
 * and ShiftPlanService. This lets the three real services collaborate exactly as
 * they would inside a `prisma.$transaction(async (tx) => ...)` call, without
 * requiring a live database connection.
 */
function createFakeTx() {
  const rotacionPatrones = new Map<string, any>();
  const employees = new Map<string, any>();
  const turnos = new Map<string, any>();
  const turnoAsignaciones = new Map<string, any>();
  const compensatorioMovimientos: any[] = [];

  let patronSeq = 0;
  let asigSeq = 0;

  const keyAsignacion = (tenantId: string, employeeId: string, fecha: Date) =>
    `${tenantId}|${employeeId}|${fecha.toISOString().slice(0, 10)}`;

  const tx = {
    rotacionPatron: {
      findFirst: async ({ where }: any) => {
        for (const p of rotacionPatrones.values()) {
          if (p.tenantId === where.tenantId && p.nombre === where.nombre && (!where.NOT || p.id !== where.NOT.id)) {
            return p;
          }
        }
        return null;
      },
      findUnique: async ({ where }: any) => rotacionPatrones.get(where.id) ?? null,
      findMany: async () => [...rotacionPatrones.values()],
      create: async ({ data }: any) => {
        const id = `pat-${++patronSeq}`;
        const record = { id, activo: true, ...data };
        rotacionPatrones.set(id, record);
        return record;
      },
      update: async ({ where, data }: any) => {
        const existing = rotacionPatrones.get(where.id);
        const updated = { ...existing, ...data };
        rotacionPatrones.set(where.id, updated);
        return updated;
      },
    },
    employee: {
      findUnique: async ({ where }: any) => employees.get(where.id) ?? null,
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
    turnoAsignacion: {
      findUnique: async ({ where }: any) => {
        const k = where.tenantId_employeeId_fecha;
        return turnoAsignaciones.get(keyAsignacion(k.tenantId, k.employeeId, k.fecha)) ?? null;
      },
      upsert: async ({ where, update, create }: any) => {
        // Prisma serializes inputs on write, so clone `fecha` here too — the
        // caller (RotacionAplicadorService) reuses/mutates a single Date
        // instance across the loop, and without cloning every stored record
        // would alias that same mutable object.
        const k = where.tenantId_employeeId_fecha;
        const key = keyAsignacion(k.tenantId, k.employeeId, k.fecha);
        const existing = turnoAsignaciones.get(key);
        const record = existing
          ? { ...existing, ...update, fecha: new Date(k.fecha) }
          : { id: `asig-${++asigSeq}`, ...create, fecha: new Date(create.fecha) };
        turnoAsignaciones.set(key, record);
        return record;
      },
      findMany: async () => [...turnoAsignaciones.values()],
    },
    compensatorioMovimiento: {
      create: async ({ data }: any) => {
        compensatorioMovimientos.push(data);
        return data;
      },
      aggregate: async () => ({ _sum: { dias: 0 } }),
    },
  };

  return { tx, employees, turnos, turnoAsignaciones };
}

describe('Feature 1: Autogeneración de Patrones (E2E)', () => {
  it('Manager crea patrón 2-2-2-1 y lo aplica a 2 empleados durante agosto', async () => {
    const tenantId = 't-1';

    const { tx, employees, turnos, turnoAsignaciones } = createFakeTx();

    // --- Setup: tenant, empleados, turnos catálogo ---
    employees.set('emp-1', { id: 'emp-1', tenantId, estado: 'activo' });
    employees.set('emp-2', { id: 'emp-2', tenantId, estado: 'activo' });

    turnos.set('turno-dia', {
      id: 'turno-dia', tenantId, codigo: 'DIA', nombre: 'Día', activo: true,
    });
    turnos.set('turno-noche', {
      id: 'turno-noche', tenantId, codigo: 'NOCHE', nombre: 'Noche', activo: true,
    });

    const patronService = new RotacionPatronService();
    const shiftPlanService = new ShiftPlanService();
    const notificationService = { notificarPatronAplicado: jest.fn().mockResolvedValue(undefined) } as any;
    const aplicadorService = new RotacionAplicadorService(shiftPlanService, notificationService);

    // --- Setup: crear patrón "2-2-2-1" ---
    const patron = await patronService.crearPatron(tx, {
      tenantId,
      nombre: '2-2-2-1',
      descripcion: '2 días, 2 noches, 3 descansos',
      secuencia: ['DIA', 'DIA', 'NOCHE', 'NOCHE', 'DESC', 'DESC', 'DESC'],
      duracionCiclo: 7,
      creadoPor: 'u-manager',
    });

    // --- Execute: aplicar patrón a 2 empleados durante agosto 2026 ---
    const resultado = await aplicadorService.aplicarPatron(tx, {
      tenantId,
      patronId: patron.id,
      employeeIds: ['emp-1', 'emp-2'],
      desde: new Date(2026, 7, 1),
      hasta: new Date(2026, 7, 31),
      diaInicioCiclo: new Date(2026, 7, 4), // Lunes
      creadoPor: 'u-manager',
    });

    // --- Assert: resultado de la aplicación ---
    // Agosto 2026 tiene 31 días; el rango [2026-08-01, 2026-08-31] es inclusivo
    // en ambos extremos (ver aplicarPatron: `while (fechaActual <= hasta)`),
    // por lo tanto son 31 días x 2 empleados = 62 registros.
    expect(resultado).toEqual({ procesadas: 62, errores: [] });

    // --- Assert: 62 registros totales (2 empleados x 31 días de agosto) ---
    const todasLasAsignaciones = [...turnoAsignaciones.values()];
    expect(todasLasAsignaciones).toHaveLength(62);

    // --- Assert: notificación disparada ---
    expect(notificationService.notificarPatronAplicado).toHaveBeenCalledWith(
      tenantId,
      ['emp-1', 'emp-2'],
      '2-2-2-1',
    );

    // --- Assert: ciclo correcto de fechas para emp-1 ---
    const casosEsperados: { fecha: string; tipoDia: 'TURNO' | 'DESCANSO'; codigoTurno?: string }[] = [
      { fecha: '2026-08-04', tipoDia: 'TURNO', codigoTurno: 'DIA' },     // Lunes
      { fecha: '2026-08-05', tipoDia: 'TURNO', codigoTurno: 'DIA' },     // Martes
      { fecha: '2026-08-06', tipoDia: 'TURNO', codigoTurno: 'NOCHE' },   // Miércoles
      { fecha: '2026-08-07', tipoDia: 'TURNO', codigoTurno: 'NOCHE' },   // Jueves
      { fecha: '2026-08-08', tipoDia: 'DESCANSO' },                      // Viernes
      { fecha: '2026-08-09', tipoDia: 'DESCANSO' },                      // Sábado
      { fecha: '2026-08-10', tipoDia: 'DESCANSO' },                      // Domingo
      { fecha: '2026-08-11', tipoDia: 'TURNO', codigoTurno: 'DIA' },     // Lunes: el ciclo se repite
    ];

    for (const empleadoId of ['emp-1', 'emp-2']) {
      for (const caso of casosEsperados) {
        const key = `${tenantId}|${empleadoId}|${caso.fecha}`;
        const registro = turnoAsignaciones.get(key);
        expect(registro).toBeDefined();
        expect(registro.tipoDia).toBe(caso.tipoDia);

        if (caso.codigoTurno) {
          expect(registro.turnoId).toBeDefined();
          const turno = turnos.get(registro.turnoId);
          expect(turno.codigo).toBe(caso.codigoTurno);
        } else {
          expect(registro.turnoId).toBeFalsy();
        }
      }
    }

    // --- Assert: todos los registros de agosto 2026 tienen tipoDia y (si aplica) turnoId consistentes ---
    for (const registro of todasLasAsignaciones) {
      expect(['TURNO', 'DESCANSO']).toContain(registro.tipoDia);
      if (registro.tipoDia === 'TURNO') {
        expect(registro.turnoId).toBeTruthy();
      } else {
        expect(registro.turnoId).toBeFalsy();
      }
    }
  });
});
