import { atribuirFechaTurno, construirVentanaTurno } from './ventana-turno.calculator';

const DIA = { horaInicio: '08:00', horaFin: '20:00' };
const NOCHE = { horaInicio: '20:00', horaFin: '08:00' };

describe('construirVentanaTurno', () => {
  it('turno diurno: ventana [inicio − 2h, fin + 4h] el mismo día', () => {
    const v = construirVentanaTurno(new Date(2026, 6, 20), DIA, 120, 240);
    expect(v.inicioTurno).toEqual(new Date(2026, 6, 20, 8, 0));
    expect(v.finTurno).toEqual(new Date(2026, 6, 20, 20, 0));
    expect(v.inicioVentana).toEqual(new Date(2026, 6, 20, 6, 0));
    expect(v.finVentana).toEqual(new Date(2026, 6, 20, 24, 0)); // 00:00 del 21
  });

  it('turno nocturno (horaFin <= horaInicio): el fin cae al día siguiente', () => {
    const v = construirVentanaTurno(new Date(2026, 6, 20), NOCHE, 120, 240);
    expect(v.inicioTurno).toEqual(new Date(2026, 6, 20, 20, 0));
    expect(v.finTurno).toEqual(new Date(2026, 6, 21, 8, 0));
    expect(v.finVentana).toEqual(new Date(2026, 6, 21, 12, 0));
  });
});

describe('atribuirFechaTurno', () => {
  const candidatas = [
    { fecha: new Date(2026, 6, 20), ventana: construirVentanaTurno(new Date(2026, 6, 20), NOCHE, 120, 240) },
    { fecha: new Date(2026, 6, 22), ventana: construirVentanaTurno(new Date(2026, 6, 22), NOCHE, 120, 240) },
  ];

  it('la salida de las 08:03 del día siguiente pertenece al turno de la víspera', () => {
    expect(atribuirFechaTurno(new Date(2026, 6, 21, 8, 3), candidatas)).toEqual(new Date(2026, 6, 20));
  });

  it('la entrada de las 19:55 pertenece al turno de ese día', () => {
    expect(atribuirFechaTurno(new Date(2026, 6, 20, 19, 55), candidatas)).toEqual(new Date(2026, 6, 20));
  });

  it('marcación fuera de toda ventana → null', () => {
    expect(atribuirFechaTurno(new Date(2026, 6, 21, 15, 0), candidatas)).toBeNull();
  });

  it('solape: gana la ventana con inicio de turno más cercano', () => {
    const solapadas = [
      { fecha: new Date(2026, 6, 20), ventana: construirVentanaTurno(new Date(2026, 6, 20), DIA, 120, 600) },
      { fecha: new Date(2026, 6, 20), ventana: construirVentanaTurno(new Date(2026, 6, 20), NOCHE, 120, 240) },
    ];
    // 19:00: dentro de ambas; inicio NOCHE (20:00) está a 1h vs DIA (08:00) a 11h
    expect(atribuirFechaTurno(new Date(2026, 6, 20, 19, 0), solapadas)).toEqual(new Date(2026, 6, 20));
  });
});
