/**
 * Cumplimiento de un turno asignado (spec §4.2):
 * - minutosRetraso: entrada real − inicio de turno (ceil), aunque esté en gracia.
 * - tardanzaMinutos: solo si minutosRetraso >= tolerancia (a los 30:00 ya es
 *   tarde); se cuenta desde la hora oficial.
 * - salidaEsperada = fin de turno + minutosRetraso (compensación minuto a minuto).
 * - deficitMinutos = max(salida esperada − salida real, horas esperadas −
 *   trabajadas, 0) en minutos.
 * - horasExtras = max(0, salida real − salida esperada) en horas.
 * @pure
 */
import { MarcacionDia } from './asistencia-resumen.calculator';
import { VentanaTurno } from './ventana-turno.calculator';

export interface CumplimientoTurnoInput {
  ventana: VentanaTurno;
  horasEsperadas: number;
  toleranciaMinutos: number;
  marcaciones: MarcacionDia[];
  justificacionAprobada?: { id: string };
}

export interface CumplimientoTurnoResult {
  horaEntrada: Date | null;
  horaSalida: Date | null;
  horasTrabajadas: number;
  minutosRetraso: number;
  tardanzaMinutos: number;
  salidaEsperada: Date | null;
  deficitMinutos: number;
  horasExtras: number;
  falta: boolean;
  justificado: boolean;
  justificacionId: string | null;
  inconsistente: boolean;
}

const MS_POR_MINUTO = 60_000;
const MS_POR_HORA = 3_600_000;

function redondear2(valor: number): number {
  return Math.round(valor * 100) / 100;
}

export function evaluarCumplimientoTurno(input: CumplimientoTurnoInput): CumplimientoTurnoResult {
  const entradas = input.marcaciones
    .filter((m) => m.tipo === 'ENTRADA')
    .sort((a, b) => a.timestampActual.getTime() - b.timestampActual.getTime());
  const salidas = input.marcaciones
    .filter((m) => m.tipo === 'SALIDA')
    .sort((a, b) => a.timestampActual.getTime() - b.timestampActual.getTime());

  const horaEntrada = entradas[0]?.timestampActual ?? null;
  const horaSalida = salidas[salidas.length - 1]?.timestampActual ?? null;
  const justificado = input.justificacionAprobada !== undefined;
  const sinMarcaciones = horaEntrada === null && horaSalida === null;
  const falta = sinMarcaciones && !justificado;
  const inconsistente = !sinMarcaciones && (horaEntrada === null || horaSalida === null);

  const minutosRetraso =
    horaEntrada !== null
      ? Math.max(
          0,
          Math.ceil((horaEntrada.getTime() - input.ventana.inicioTurno.getTime()) / MS_POR_MINUTO),
        )
      : 0;
  const tardanzaMinutos = minutosRetraso >= input.toleranciaMinutos ? minutosRetraso : 0;
  const salidaEsperada =
    horaEntrada !== null
      ? new Date(input.ventana.finTurno.getTime() + minutosRetraso * MS_POR_MINUTO)
      : null;

  let horasTrabajadas = 0;
  let deficitMinutos = 0;
  let horasExtras = 0;
  if (horaEntrada !== null && horaSalida !== null && salidaEsperada !== null) {
    horasTrabajadas = redondear2((horaSalida.getTime() - horaEntrada.getTime()) / MS_POR_HORA);
    const deficitSalida = Math.ceil(
      (salidaEsperada.getTime() - horaSalida.getTime()) / MS_POR_MINUTO,
    );
    const deficitHoras = Math.ceil((input.horasEsperadas - horasTrabajadas) * 60);
    deficitMinutos = Math.max(0, deficitSalida, deficitHoras);
    horasExtras = redondear2(
      Math.max(0, (horaSalida.getTime() - salidaEsperada.getTime()) / MS_POR_HORA),
    );
  }

  return {
    horaEntrada,
    horaSalida,
    horasTrabajadas,
    minutosRetraso,
    tardanzaMinutos,
    salidaEsperada,
    deficitMinutos,
    horasExtras,
    falta,
    justificado,
    justificacionId: input.justificacionAprobada?.id ?? null,
    inconsistente,
  };
}
