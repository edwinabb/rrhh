import { ShiftPlanImportService } from './shift-plan-import.service';

function mockTx() {
  return {
    turno: { findMany: jest.fn().mockResolvedValue([{ id: 'turno-dia', codigo: 'DIA', activo: true }]) },
    employee: { findFirst: jest.fn().mockResolvedValue({ id: 'emp-1', estado: 'activo' }) },
  } as any;
}

describe('ShiftPlanImportService', () => {
  it('plantilla: header + ejemplos con DESCANSO y COMPENSATORIO', () => {
    const service = new ShiftPlanImportService({ upsertAsignacion: jest.fn() } as any);
    const plantilla = service.generarPlantilla();
    expect(plantilla).toContain('numero_documento,fecha,turno');
    expect(plantilla).toContain('DESCANSO');
  });

  it('importa filas válidas: turno por código, DESCANSO y COMPENSATORIO', async () => {
    const shiftPlan = { upsertAsignacion: jest.fn().mockResolvedValue({}) } as any;
    const service = new ShiftPlanImportService(shiftPlan);
    const csv = [
      'numero_documento,fecha,turno',
      '45678901,2026-08-01,DIA',
      '45678901,2026-08-02,DESCANSO',
      '45678901,2026-08-03,COMPENSATORIO',
    ].join('\n');
    const r = await service.importarCsv(mockTx(), csv, 't-1', 'u-1');
    expect(r.procesadas).toBe(3);
    expect(r.errores).toHaveLength(0);
    expect(shiftPlan.upsertAsignacion).toHaveBeenNthCalledWith(1, expect.anything(),
      expect.objectContaining({ tipoDia: 'TURNO', turnoId: 'turno-dia' }));
    expect(shiftPlan.upsertAsignacion).toHaveBeenNthCalledWith(3, expect.anything(),
      expect.objectContaining({ tipoDia: 'DESCANSO_COMPENSATORIO', forzarSinSaldo: false }));
  });

  it('errores por fila sin abortar: turno inexistente, empleado no encontrado, fecha inválida', async () => {
    const shiftPlan = { upsertAsignacion: jest.fn().mockResolvedValue({}) } as any;
    const service = new ShiftPlanImportService(shiftPlan);
    const tx = mockTx();
    tx.employee.findFirst.mockResolvedValueOnce({ id: 'emp-1', estado: 'activo' });
    const csv = [
      'numero_documento,fecha,turno',
      '45678901,2026-08-01,NOEXISTE',
      '99999999,2026-08-01,DIA',
      '45678901,2026-13-45,DIA',
    ].join('\n');
    tx.employee.findFirst.mockImplementation(({ where }: any) =>
      Promise.resolve(where.numeroDocumento === '45678901' ? { id: 'emp-1', estado: 'activo' } : null),
    );
    const r = await service.importarCsv(tx, csv, 't-1', 'u-1');
    expect(r.procesadas).toBe(0);
    expect(r.errores).toHaveLength(3);
    expect(r.errores.map((e) => e.fila)).toEqual([2, 3, 4]);
  });

  it('el 422 de goce sin saldo se acumula como error de fila', async () => {
    const shiftPlan = {
      upsertAsignacion: jest.fn().mockRejectedValue(Object.assign(new Error('sin saldo'), { status: 422 })),
    } as any;
    const service = new ShiftPlanImportService(shiftPlan);
    const csv = ['numero_documento,fecha,turno', '45678901,2026-08-03,COMPENSATORIO'].join('\n');
    const r = await service.importarCsv(mockTx(), csv, 't-1', 'u-1');
    expect(r.procesadas).toBe(0);
    expect(r.errores[0]!.mensaje).toContain('sin saldo');
  });
});
