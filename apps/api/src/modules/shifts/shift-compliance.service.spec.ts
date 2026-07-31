import { BadRequestException } from '@nestjs/common';
import { ShiftComplianceService } from './shift-compliance.service';

const EMPLEADO = { id: 'emp-1', nombres: 'Ana', apellidos: 'Torres', numeroDocumento: '45678901' };

function mockTx(overrides: any = {}) {
  return {
    turnoAsignacion: { findMany: jest.fn().mockResolvedValue([]) },
    asistenciaResumen: { findMany: jest.fn().mockResolvedValue([]) },
    compensatorioMovimiento: { findMany: jest.fn().mockResolvedValue([]) },
    employee: { findMany: jest.fn().mockResolvedValue([EMPLEADO]) },
    contrato: { findMany: jest.fn().mockResolvedValue([]) },
    ...overrides,
  };
}

const service = new ShiftComplianceService();

describe('ShiftComplianceService', () => {
  it('periodo inválido → 400', async () => {
    await expect(service.generarReporte(mockTx(), '2026-13')).rejects.toThrow(BadRequestException);
  });

  it('agrega por empleado: planificados, trabajados, tardanzas, déficit', async () => {
    const tx = mockTx();
    tx.turnoAsignacion.findMany.mockResolvedValue([
      { employeeId: 'emp-1', fecha: new Date(2026, 7, 3), tipoDia: 'TURNO' },
      { employeeId: 'emp-1', fecha: new Date(2026, 7, 4), tipoDia: 'TURNO' },
      { employeeId: 'emp-1', fecha: new Date(2026, 7, 5), tipoDia: 'DESCANSO' },
    ]);
    tx.asistenciaResumen.findMany.mockResolvedValue([
      { employeeId: 'emp-1', fecha: new Date(2026, 7, 3), horasTrabajadas: 12, tardanzaMinutos: 35, deficitMinutos: 0, falta: false, justificado: false, sinPlan: false },
      { employeeId: 'emp-1', fecha: new Date(2026, 7, 4), horasTrabajadas: 11.5, tardanzaMinutos: 0, deficitMinutos: 30, falta: false, justificado: false, sinPlan: false },
    ]);
    const r = await service.generarReporte(tx, '2026-08');
    const emp = r.empleados[0]!;
    expect(emp.diasPlanificados).toBe(2);
    expect(emp.diasTrabajados).toBe(2);
    expect(emp.diasTardanza).toBe(1);
    expect(emp.minutosTardanza).toBe(35);
    expect(emp.minutosDeficit).toBe(30);
  });

  it('falta: día TURNO pasado sin resumen; sinPlan empareja contraparte del mismo día', async () => {
    const tx = mockTx();
    tx.employee.findMany.mockResolvedValue([
      EMPLEADO,
      { id: 'emp-2', nombres: 'Carlos', apellidos: 'Mendoza', numeroDocumento: '87654321' },
    ]);
    tx.turnoAsignacion.findMany.mockResolvedValue([
      { employeeId: 'emp-2', fecha: new Date(2026, 6, 3), tipoDia: 'TURNO' },
    ]);
    tx.asistenciaResumen.findMany.mockResolvedValue([
      { employeeId: 'emp-1', fecha: new Date(2026, 6, 3), horasTrabajadas: 12, tardanzaMinutos: 0, deficitMinutos: 0, falta: false, justificado: false, sinPlan: true },
    ]);
    const r = await service.generarReporte(tx, '2026-07');
    const empA = r.empleados.find((e: any) => e.employeeId === 'emp-1')!;
    const empB = r.empleados.find((e: any) => e.employeeId === 'emp-2')!;
    expect(empB.faltas).toBe(1);
    expect(empA.pendientesSinPlan).toHaveLength(1);
    expect(empA.pendientesSinPlan[0]!.contraparteSugerida).toContain('Mendoza');
  });

  it('compensatorios: saldo inicial (antes del período), ganados/gozados del período y saldo actual', async () => {
    const tx = mockTx();
    tx.turnoAsignacion.findMany.mockResolvedValue([
      { employeeId: 'emp-1', fecha: new Date(2026, 7, 3), tipoDia: 'TURNO' },
    ]);
    tx.compensatorioMovimiento.findMany.mockResolvedValue([
      { employeeId: 'emp-1', tipo: 'AJUSTE_INICIAL', dias: 2, creadoEn: new Date(2026, 6, 1) },
      { employeeId: 'emp-1', tipo: 'GANADO', dias: 1, creadoEn: new Date(2026, 7, 10) },
      { employeeId: 'emp-1', tipo: 'GOZADO', dias: -1, creadoEn: new Date(2026, 7, 15) },
    ]);
    const r = await service.generarReporte(tx, '2026-08');
    expect(r.empleados[0]!.compensatorios).toEqual({
      saldoInicial: 2, ganados: 1, gozados: -1, saldoActual: 2,
    });
  });

  it('personal de confianza: nota informativa por semana con más de 48 h', async () => {
    const tx = mockTx();
    tx.contrato.findMany.mockResolvedValue([
      { employeeId: 'emp-1', personalDeConfianza: true, fechaInicio: new Date(2024, 0, 1) },
    ]);
    tx.turnoAsignacion.findMany.mockResolvedValue([
      { employeeId: 'emp-1', fecha: new Date(2026, 7, 3), tipoDia: 'TURNO' },
    ]);
    // Semana lun 3-ago a dom 9-ago: 4 × 13 h = 52 h > 48
    tx.asistenciaResumen.findMany.mockResolvedValue(
      [3, 4, 5, 6].map((dia) => ({
        employeeId: 'emp-1', fecha: new Date(2026, 7, dia), horasTrabajadas: 13,
        tardanzaMinutos: 0, deficitMinutos: 0, falta: false, justificado: false, sinPlan: false,
      })),
    );
    const r = await service.generarReporte(tx, '2026-08');
    expect(r.empleados[0]!.alertasConfianza).toHaveLength(1);
    expect(r.empleados[0]!.alertasConfianza[0]!).toContain('52');
    // Sin flag de confianza no hay alertas
    tx.contrato.findMany.mockResolvedValue([]);
    const r2 = await service.generarReporte(tx, '2026-08');
    expect(r2.empleados[0]!.alertasConfianza).toHaveLength(0);
  });

  it('exportarNovedadesCsv: header compatible con el import de novedades de nómina', async () => {
    const tx = mockTx();
    tx.turnoAsignacion.findMany.mockResolvedValue([
      { employeeId: 'emp-1', fecha: new Date(2026, 7, 3), tipoDia: 'TURNO' },
    ]);
    tx.asistenciaResumen.findMany.mockResolvedValue([
      { employeeId: 'emp-1', fecha: new Date(2026, 7, 3), horasTrabajadas: 12, tardanzaMinutos: 0, deficitMinutos: 0, falta: false, justificado: false, sinPlan: false },
    ]);
    const csv = await service.exportarNovedadesCsv(tx, '2026-08');
    expect(csv).toContain('numero_documento,dias_laborados,horas_extra_25,horas_extra_35,bonificaciones,descuentos');
    expect(csv).toContain('45678901,1,,,,');
  });
});
