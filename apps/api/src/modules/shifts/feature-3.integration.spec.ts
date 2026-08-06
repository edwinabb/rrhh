import { SolicitudTrabajoAdicionalService } from './solicitud-trabajo-adicional.service';
import { SolicitudTrabajoAdicionalAplicadorService } from './solicitud-trabajo-adicional-aplicador.service';
import { CompensatorioService } from './compensatorio.service';

/**
 * Fake Prisma transaction: an in-memory store backing the subset of the
 * Prisma client surface touched by SolicitudTrabajoAdicionalService,
 * SolicitudTrabajoAdicionalAplicadorService, and CompensatorioService.
 *
 * This lets the three real services collaborate exactly as they would inside
 * a `prisma.$transaction(async (tx) => ...)` call, without requiring a live
 * database connection.
 */
function createFakeTx() {
  const solicitudes = new Map<string, any>();
  const employees = new Map<string, any>();
  const compensatorioMovimientos: any[] = [];
  const asistenciaResumenes: any[] = [];

  let solicitudSeq = 0;
  let movimientoSeq = 0;

  /** Matches a single record field against a Prisma-style where clause value. */
  function matchWhereValue(recordVal: any, whereVal: any): boolean {
    if (whereVal instanceof Date) {
      return recordVal instanceof Date && recordVal.getTime() === whereVal.getTime();
    }
    if (whereVal && typeof whereVal === 'object') {
      if ('in' in whereVal) return whereVal.in.includes(recordVal);
      if ('not' in whereVal) return recordVal !== whereVal.not;
    }
    return recordVal === whereVal;
  }

  function matchWhere(record: any, where: any): boolean {
    if (!where) return true;
    return Object.entries(where).every(([key, val]) => matchWhereValue(record[key], val));
  }

  const tx = {
    solicitudTrabajoAdicional: {
      findUnique: async ({ where }: any) => solicitudes.get(where.id) ?? null,
      findFirst: async ({ where }: any) => {
        for (const s of solicitudes.values()) {
          if (matchWhere(s, where)) return s;
        }
        return null;
      },
      findMany: async ({ where, orderBy }: any) => {
        let results = [...solicitudes.values()].filter((s) => matchWhere(s, where));
        if (orderBy?.creadoEn === 'desc') {
          results = results.sort((a, b) => b.creadoEn.getTime() - a.creadoEn.getTime());
        }
        return results;
      },
      create: async ({ data }: any) => {
        const id = `sol-${++solicitudSeq}`;
        const record = { id, creadoEn: new Date(), ...data };
        solicitudes.set(id, record);
        return record;
      },
      update: async ({ where, data }: any) => {
        const existing = solicitudes.get(where.id);
        if (!existing) return null;
        const updated = { ...existing, ...data };
        solicitudes.set(where.id, updated);
        return updated;
      },
    },
    employee: {
      findUnique: async ({ where }: any) => employees.get(where.id) ?? null,
    },
    compensatorioMovimiento: {
      create: async ({ data }: any) => {
        const record = { id: `cm-${++movimientoSeq}`, creadoEn: new Date(), ...data };
        compensatorioMovimientos.push(record);
        return record;
      },
      aggregate: async ({ where }: any) => {
        const sum = compensatorioMovimientos
          .filter((m) => m.employeeId === where.employeeId)
          .reduce((total, m) => total + Number(m.dias), 0);
        return { _sum: { dias: sum } };
      },
      findMany: async ({ where }: any) => {
        return compensatorioMovimientos
          .filter((m) => matchWhere(m, where))
          .sort((a, b) => b.creadoEn.getTime() - a.creadoEn.getTime());
      },
    },
    asistenciaResumen: {
      findMany: async ({ where }: any) => {
        return asistenciaResumenes.filter((r) => {
          if (r.employeeId !== where.employeeId) return false;
          if (where.fecha) {
            const t = r.fecha.getTime();
            if (where.fecha.gte && t < where.fecha.gte.getTime()) return false;
            if (where.fecha.lte && t > where.fecha.lte.getTime()) return false;
          }
          return true;
        });
      },
    },
  };

  return {
    tx,
    solicitudes,
    employees,
    compensatorioMovimientos,
    asistenciaResumenes,
  };
}

// EmployeesService mock: delega en tx.employee.findUnique (ver Group B/D del
// review de fase 9).
const mockEmployees: any = {
  findById: jest.fn((ctx: any, id: string) => ctx.tx.employee.findUnique({ where: { id } })),
};
function ctxOf(tx: any) {
  return { tx, pgRole: 'app_rrhh' as const } as any;
}

function buildAplicador(compensatorios: CompensatorioService) {
  const solicitudService = new SolicitudTrabajoAdicionalService(compensatorios, mockEmployees);
  const mockNotificationService = {
    notificarTrabajoAprobado: jest.fn().mockResolvedValue(undefined),
    notificarTrabajoReasignado: jest.fn().mockResolvedValue(undefined),
    notificarTrabajoRechazado: jest.fn().mockResolvedValue(undefined),
    notificarReporteValidado: jest.fn().mockResolvedValue(undefined),
    notificarReportePedidoReentrega: jest.fn().mockResolvedValue(undefined),
  };
  const aplicadorService = new SolicitudTrabajoAdicionalAplicadorService(
    solicitudService,
    compensatorios,
    mockNotificationService as any,
  );
  return { solicitudService, aplicadorService, mockNotificationService };
}

describe('Feature 3: Trabajo Fuera de Turno (E2E)', () => {
  // Helper to generate relative dates (independent of when test runs)
  const addDays = (n: number): Date => {
    const date = new Date();
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() + n);
    return date;
  };

  it('Employee solicita, Manager aprueba/rechaza/reasigna, reportes se validan y generan compensatorios', async () => {
    const tenantId = 't-1';
    const { tx, solicitudes, employees, compensatorioMovimientos } = createFakeTx();

    // --- Setup: empleados ---
    employees.set('emp-a', { id: 'emp-a', tenantId, estado: 'activo', nombre: 'Ana', email: 'ana@test.com' });
    employees.set('emp-b', { id: 'emp-b', tenantId, estado: 'activo', nombre: 'Beto', email: 'beto@test.com' });
    employees.set('emp-c', { id: 'emp-c', tenantId, estado: 'activo', nombre: 'Carla', email: 'carla@test.com' });
    employees.set('emp-d', { id: 'emp-d', tenantId, estado: 'activo', nombre: 'Diego', email: 'diego@test.com' });

    const compensatorios = new CompensatorioService(mockEmployees);
    const { solicitudService, aplicadorService, mockNotificationService } = buildAplicador(compensatorios);

    // ===== STEP 1: Employee A creates solicitud "Análisis urgente", 3h, URGENTE =====
    const date1 = addDays(1);
    const date2 = addDays(2);
    const date3 = addDays(3);
    const date4 = addDays(4);
    const date5 = addDays(7);
    const date6 = addDays(8);

    const solicitud1 = await solicitudService.crearSolicitud(ctxOf(tx), {
      tenantId,
      employeeIdSolicitante: 'emp-a',
      employeeIdAsignado: 'emp-a',
      descripcionTarea: 'Análisis urgente',
      fechaEstimada: date1,
      horasEstimadas: 3,
      urgencia: 'URGENTE',
      creadoPor: 'emp-a',
    });

    // ===== STEP 2: Verify estado=PENDIENTE_APROBACION and computed private fields =====
    expect(solicitud1.id).toBeDefined();
    expect(solicitud1.estado).toBe('PENDIENTE_APROBACION');
    expect(solicitud1.employeeIdSolicitante).toBe('emp-a');
    expect(solicitud1.employeeIdAsignado).toBe('emp-a');
    expect(solicitud1.horasEstimadas).toBe(3);
    expect(solicitud1.urgencia).toBe('URGENTE');
    expect(solicitud1.causaHorasExtras).toBe(false);
    expect(solicitud1.horasAcumuladas).toBe(3);
    expect(solicitud1.saldoCompensatorios).toBe(0);
    expect(solicitudes.size).toBe(1);

    // ===== STEP 3: Manager approves solicitud =====
    const aprobada1 = await aplicadorService.aprobarSolicitud(tx, tenantId, solicitud1.id, 'mgr-1');

    expect(aprobada1.estado).toBe('APROBADA');
    expect(aprobada1.managerId).toBe('mgr-1');
    expect(solicitudes.get(solicitud1.id).estado).toBe('APROBADA');

    // ===== STEP 4: Verify notifications fired (mocked) =====
    expect(mockNotificationService.notificarTrabajoAprobado).toHaveBeenCalledWith(
      tenantId,
      'emp-a',
      'Análisis urgente',
    );
    expect(mockNotificationService.notificarTrabajoAprobado).toHaveBeenCalledTimes(1);

    // ===== STEP 5: Employee A uploads report: actividades + 2 fotos =====
    const reportada1 = await solicitudService.enviarReporte(tx, {
      tenantId,
      id: solicitud1.id,
      employeeId: 'emp-a',
      reporteDescripcion: 'Se realizó el análisis solicitado, sin incidentes.',
      reporteFotos: ['data:image/png;base64,foto1', 'data:image/png;base64,foto2'],
    });

    // ===== STEP 6: Verify estado=REPORTE_PENDIENTE_VALIDACION =====
    expect(reportada1.estado).toBe('REPORTE_PENDIENTE_VALIDACION');
    expect(reportada1.reporteFotos).toHaveLength(2);
    expect(reportada1.reporteEnviadoEn).toBeDefined();

    // ===== STEP 7: Manager validates report =====
    const validada1 = await aplicadorService.validarReporte(tx, tenantId, solicitud1.id, 'mgr-1');

    // ===== STEP 8: Verify CompensatorioMovimiento created (GANADO, 3h -> 0.38 días) =====
    expect(compensatorioMovimientos).toHaveLength(1);
    expect(compensatorioMovimientos[0].tipo).toBe('GANADO');
    expect(compensatorioMovimientos[0].dias).toBe(0.38);
    expect(compensatorioMovimientos[0].employeeId).toBe('emp-a');
    expect(compensatorioMovimientos[0].fechaReferencia).toEqual(date1);

    // ===== STEP 9: Verify estado=VALIDADA, notifications fired =====
    expect(validada1.estado).toBe('VALIDADA');
    expect(mockNotificationService.notificarReporteValidado).toHaveBeenCalledWith(
      tenantId,
      'emp-a',
      'Análisis urgente',
      0.38,
    );
    expect(await compensatorios.obtenerSaldo(tx, 'emp-a')).toBe(0.38);

    // ===== STEP 10: Manager rejects the report on ANOTHER solicitud (Employee B, different date) =====
    const solicitud2 = await solicitudService.crearSolicitud(ctxOf(tx), {
      tenantId,
      employeeIdSolicitante: 'emp-b',
      employeeIdAsignado: 'emp-b',
      descripcionTarea: 'Reparación de equipo',
      fechaEstimada: date2,
      horasEstimadas: 4,
      urgencia: 'NORMAL',
      creadoPor: 'emp-b',
    });
    expect(solicitud2.estado).toBe('PENDIENTE_APROBACION');

    await aplicadorService.aprobarSolicitud(tx, tenantId, solicitud2.id, 'mgr-1');
    await solicitudService.enviarReporte(tx, {
      tenantId,
      id: solicitud2.id,
      employeeId: 'emp-b',
      reporteDescripcion: 'Reparación completada.',
      reporteFotos: ['data:image/png;base64,fotoA', 'data:image/png;base64,fotoB'],
    });

    const rechazoReporte = await aplicadorService.rechazarReporte(
      tx,
      tenantId,
      solicitud2.id,
      'mgr-1',
      'Fotos borrosas, reenviar',
    );

    expect(rechazoReporte.estado).toBe('REPORTE_RECHAZADO');
    expect(rechazoReporte.motivoRechazo).toBe('Fotos borrosas, reenviar');
    expect(mockNotificationService.notificarReportePedidoReentrega).toHaveBeenCalledWith(
      tenantId,
      'emp-b',
      'Fotos borrosas, reenviar',
    );

    // ===== STEP 11: Employee B resubmits report (allowed from REPORTE_RECHAZADO) =====
    const reenvio = await solicitudService.enviarReporte(tx, {
      tenantId,
      id: solicitud2.id,
      employeeId: 'emp-b',
      reporteDescripcion: 'Reparación completada, fotos nítidas adjuntas.',
      reporteFotos: ['data:image/png;base64,fotoA2', 'data:image/png;base64,fotoB2'],
    });

    expect(reenvio.estado).toBe('REPORTE_PENDIENTE_VALIDACION');

    // ===== STEP 12: Manager validates the resubmitted report =====
    const validada2 = await aplicadorService.validarReporte(tx, tenantId, solicitud2.id, 'mgr-1');

    expect(validada2.estado).toBe('VALIDADA');
    expect(compensatorioMovimientos).toHaveLength(2);
    expect(compensatorioMovimientos[1].tipo).toBe('GANADO');
    expect(compensatorioMovimientos[1].dias).toBe(0.5); // 4h / 8 = 0.5
    expect(compensatorioMovimientos[1].employeeId).toBe('emp-b');
    expect(mockNotificationService.notificarReporteValidado).toHaveBeenCalledWith(
      tenantId,
      'emp-b',
      'Reparación de equipo',
      0.5,
    );

    // ===== STEP 13: Test reasignación (third solicitud): Manager reassigns Employee C -> Employee D =====
    const solicitud3 = await solicitudService.crearSolicitud(ctxOf(tx), {
      tenantId,
      employeeIdSolicitante: 'emp-c',
      employeeIdAsignado: 'emp-c',
      descripcionTarea: 'Inventario de bodega',
      fechaEstimada: date3,
      horasEstimadas: 2,
      urgencia: 'NORMAL',
      creadoPor: 'emp-c',
    });
    expect(solicitud3.estado).toBe('PENDIENTE_APROBACION');
    expect(solicitud3.employeeIdAsignado).toBe('emp-c');

    const reasignada = await aplicadorService.reasignarSolicitud(
      tx,
      tenantId,
      solicitud3.id,
      'emp-d',
      'mgr-1',
    );

    expect(reasignada.estado).toBe('REASIGNADA');
    expect(reasignada.employeeIdAsignado).toBe('emp-d');
    expect(reasignada.employeeIdSolicitante).toBe('emp-c'); // solicitante no cambia
    expect(reasignada.managerId).toBe('mgr-1');
    expect(mockNotificationService.notificarTrabajoReasignado).toHaveBeenCalledWith(
      tenantId,
      'emp-d',
      'Inventario de bodega',
      date3,
      2,
    );

    // Employee D (new assignee) submits and gets the report validated end-to-end
    const reporteD = await solicitudService.enviarReporte(tx, {
      tenantId,
      id: solicitud3.id,
      employeeId: 'emp-d',
      reporteDescripcion: 'Inventario completado y verificado.',
      reporteFotos: ['data:image/png;base64,fotoD1', 'data:image/png;base64,fotoD2'],
    });
    expect(reporteD.estado).toBe('REPORTE_PENDIENTE_VALIDACION');

    // Employee C (original solicitante, no longer asignado) cannot submit the report
    await expect(
      solicitudService.enviarReporte(tx, {
        tenantId,
        id: solicitud3.id,
        employeeId: 'emp-c',
        reporteDescripcion: 'Intento inválido',
        reporteFotos: ['data:image/png;base64,x1', 'data:image/png;base64,x2'],
      }),
    ).rejects.toThrow('Solo el empleado asignado puede enviar el reporte');

    const validada3 = await aplicadorService.validarReporte(tx, tenantId, solicitud3.id, 'mgr-1');

    expect(validada3.estado).toBe('VALIDADA');
    expect(compensatorioMovimientos).toHaveLength(3);
    expect(compensatorioMovimientos[2].tipo).toBe('GANADO');
    expect(compensatorioMovimientos[2].dias).toBe(0.25); // 2h / 8 = 0.25
    expect(compensatorioMovimientos[2].employeeId).toBe('emp-d');

    // ===== STEP 14: Verify all state transitions + side effects across the whole run =====
    expect(solicitudes.size).toBe(3);
    expect(solicitudes.get(solicitud1.id).estado).toBe('VALIDADA');
    expect(solicitudes.get(solicitud2.id).estado).toBe('VALIDADA');
    expect(solicitudes.get(solicitud3.id).estado).toBe('VALIDADA');
    expect(solicitudes.get(solicitud3.id).employeeIdAsignado).toBe('emp-d');

    expect(mockNotificationService.notificarTrabajoAprobado).toHaveBeenCalledTimes(2);
    expect(mockNotificationService.notificarReporteValidado).toHaveBeenCalledTimes(3);
    expect(mockNotificationService.notificarReportePedidoReentrega).toHaveBeenCalledTimes(1);
    expect(mockNotificationService.notificarTrabajoReasignado).toHaveBeenCalledTimes(1);
    expect(mockNotificationService.notificarTrabajoRechazado).not.toHaveBeenCalled();

    const totalDias = compensatorioMovimientos.reduce((t, m) => t + m.dias, 0);
    expect(Math.round(totalDias * 100) / 100).toBe(1.13); // 0.38 + 0.5 + 0.25
  });

  it('Duplicate prevention: rejects a second non-terminal solicitud for same employee + fecha', async () => {
    const tenantId = 't-1';
    const { tx, employees } = createFakeTx();
    employees.set('emp-x', { id: 'emp-x', tenantId, estado: 'activo' });

    const compensatorios = new CompensatorioService(mockEmployees);
    const solicitudService = new SolicitudTrabajoAdicionalService(compensatorios, mockEmployees);

    const date = addDays(4);

    const solicitud1 = await solicitudService.crearSolicitud(ctxOf(tx), {
      tenantId,
      employeeIdSolicitante: 'emp-x',
      employeeIdAsignado: 'emp-x',
      descripcionTarea: 'Tarea 1',
      fechaEstimada: date,
      horasEstimadas: 2,
      urgencia: 'NORMAL',
      creadoPor: 'emp-x',
    });
    expect(solicitud1.estado).toBe('PENDIENTE_APROBACION');

    await expect(
      solicitudService.crearSolicitud(ctxOf(tx), {
        tenantId,
        employeeIdSolicitante: 'emp-x',
        employeeIdAsignado: 'emp-x',
        descripcionTarea: 'Tarea 2 (duplicada)',
        fechaEstimada: date,
        horasEstimadas: 1,
        urgencia: 'NORMAL',
        creadoPor: 'emp-x',
      }),
    ).rejects.toThrow('Ya existe una solicitud de trabajo adicional para esa fecha');
  });

  it('crearSolicitud siempre calcula los campos privados (causaHorasExtras/horasAcumuladas/saldoCompensatorios); el filtrado por rol es responsabilidad del controller', async () => {
    const tenantId = 't-1';
    const { tx, employees, asistenciaResumenes, compensatorioMovimientos } = createFakeTx();
    employees.set('emp-y', { id: 'emp-y', tenantId, estado: 'activo' });

    // Semana anterior: registro de asistencia
    asistenciaResumenes.push({ employeeId: 'emp-y', fecha: addDays(7), horasTrabajadas: 46 });

    // Saldo compensatorio previo (AJUSTE_INICIAL simulado directamente en la tabla)
    compensatorioMovimientos.push({
      id: 'cm-prev',
      tenantId,
      employeeId: 'emp-y',
      tipo: 'AJUSTE_INICIAL',
      dias: 1.5,
      creadoEn: new Date(),
    });

    const compensatorios = new CompensatorioService(mockEmployees);
    const solicitudService = new SolicitudTrabajoAdicionalService(compensatorios, mockEmployees);

    const solicitud = await solicitudService.crearSolicitud(ctxOf(tx), {
      tenantId,
      employeeIdSolicitante: 'emp-y',
      employeeIdAsignado: 'emp-y',
      descripcionTarea: 'Soporte fin de semana',
      fechaEstimada: addDays(8),
      horasEstimadas: 5,
      urgencia: 'URGENTE',
      creadoPor: 'emp-y',
    });

    // Los 3 campos privados están presentes y con el tipo/valor correcto en la
    // respuesta cruda del servicio, sin importar quién llame (no hay
    // filtrado por rol a este nivel — eso es responsabilidad del controller).
    expect(typeof solicitud.causaHorasExtras).toBe('boolean');
    expect(typeof solicitud.horasAcumuladas).toBe('number');
    expect(typeof solicitud.saldoCompensatorios).toBe('number');

    expect(solicitud.horasAcumuladas).toBe(51); // 46 (semana) + 5 (nueva solicitud)
    expect(solicitud.causaHorasExtras).toBe(true); // 51 > 48 (default JORNADA_SEMANAL_MAXIMA)
    expect(solicitud.saldoCompensatorios).toBe(1.5); // saldo previo del empleado
  });
});
