/**
 * Ventana de captura de marcaciones de un turno asignado (spec §4.1):
 * [inicio del turno − margenAntes, fin del turno + margenDespues]. Si
 * horaFin <= horaInicio el turno cruza medianoche y el fin cae en el día
 * siguiente. Toda marcación dentro de la ventana se atribuye a la FECHA DEL
 * TURNO (no a la fecha calendario); en solapes gana el inicio más cercano.
 * @pure
 */
export interface TurnoHorario {
  horaInicio: string; // HH:mm
  horaFin: string; // HH:mm
}

export interface VentanaTurno {
  inicioVentana: Date;
  finVentana: Date;
  inicioTurno: Date;
  finTurno: Date;
}

export interface VentanaCandidata {
  fecha: Date;
  ventana: VentanaTurno;
}

const MS_POR_MINUTO = 60_000;

function horaEnFecha(fecha: Date, horaHHmm: string): Date {
  const [horas = 0, minutos = 0] = horaHHmm.split(':').map(Number);
  const d = new Date(fecha);
  d.setHours(horas, minutos, 0, 0);
  return d;
}

export function construirVentanaTurno(
  fecha: Date,
  turno: TurnoHorario,
  margenAntesMinutos: number,
  margenDespuesMinutos: number,
): VentanaTurno {
  const inicioTurno = horaEnFecha(fecha, turno.horaInicio);
  let finTurno = horaEnFecha(fecha, turno.horaFin);
  if (finTurno.getTime() <= inicioTurno.getTime()) {
    finTurno = new Date(finTurno.getTime() + 24 * 60 * MS_POR_MINUTO); // cruza medianoche
  }
  return {
    inicioTurno,
    finTurno,
    inicioVentana: new Date(inicioTurno.getTime() - margenAntesMinutos * MS_POR_MINUTO),
    finVentana: new Date(finTurno.getTime() + margenDespuesMinutos * MS_POR_MINUTO),
  };
}

export function atribuirFechaTurno(
  timestamp: Date,
  candidatas: VentanaCandidata[],
): Date | null {
  let mejor: VentanaCandidata | null = null;
  let mejorDistancia = Infinity;
  for (const candidata of candidatas) {
    const { inicioVentana, finVentana, inicioTurno } = candidata.ventana;
    if (timestamp.getTime() < inicioVentana.getTime() || timestamp.getTime() > finVentana.getTime()) {
      continue;
    }
    const distancia = Math.abs(timestamp.getTime() - inicioTurno.getTime());
    if (distancia < mejorDistancia) {
      mejor = candidata;
      mejorDistancia = distancia;
    }
  }
  return mejor ? mejor.fecha : null;
}
