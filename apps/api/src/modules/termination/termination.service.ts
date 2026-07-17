import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { NormativeParameterService } from '../normative-params/normative-parameter.service';
import { CeseDocumentsService } from './cese-documents.service';
import { PeriodoVacacionalInput } from '../payroll/calculators/vacaciones.calculator';
import { RegimenLaboral } from '../payroll/calculators/indemnizacion-despido.calculator';
import { calcularLiquidacion, MotivoCese } from '../payroll/calculators/liquidacion.calculator';

/**
 * Forma del inputSnapshot del Cese: TODOS los datos con los que se calcula la
 * liquidación, pre-llenados desde BD y corregibles por RRHH antes de calcular
 * (trazabilidad: la hoja de liquidación siempre puede reproducirse).
 */
export interface CeseSnapshot {
  regimen: RegimenLaboral;
  tipoContrato: 'indeterminado' | 'plazo_fijo';
  fechaInicioContrato: string; // ISO date
  fechaFinContrato: string | null;
  remuneracionComputable: number;
  sistemaPensionario: 'afp' | 'onp';
  afiliadoEps: boolean;
  excluidoIndemnizacionVacacional: boolean;
  cts: {
    gratificacionSemestralPercibida: number;
    mesesCompletosDesdeUltimoDeposito: number;
    diasAdicionales: number;
  };
  gratificacionTrunca: { mesesCompletos: number };
  vacaciones: PeriodoVacacionalInput[];
  remuneracionesPendientes: Array<{ concepto: string; monto: number }>;
  gratificacionExtraordinaria: number;
  derechohabientes: Array<{
    nombre: string;
    tipoDocumento: string;
    numeroDocumento: string;
    parentesco: string;
    porcentaje: number;
  }> | null;
  quinta: { rentaPagadaEnElAnio: number; retencionesYaEfectuadas: number };
}

export interface CrearCeseInput {
  tenantId: string;
  employeeId: string;
  fechaCese: Date;
  motivo: MotivoCese;
  creadoPor: string;
}

const DIAS_POR_MES = 30;

/** Plazo legal de pago: 48 horas desde el cese (D.S. 001-97-TR). */
export function calcularFechaLimitePago(fechaCese: Date): Date {
  const limite = new Date(fechaCese);
  limite.setUTCDate(limite.getUTCDate() + 2);
  return limite;
}

/** Meses calendario completos + días sueltos desde `desde` hasta `hasta` (30/360). */
function mesesYDias(desde: Date, hasta: Date): { meses: number; dias: number } {
  let meses =
    (hasta.getUTCFullYear() - desde.getUTCFullYear()) * 12 +
    (hasta.getUTCMonth() - desde.getUTCMonth());
  let dias = hasta.getUTCDate() - desde.getUTCDate();
  if (dias < 0) {
    meses -= 1;
    dias += DIAS_POR_MES;
  }
  return { meses: Math.max(0, meses), dias: Math.max(0, dias) };
}

/** Inicio del período CTS vigente a una fecha: 1-may (may-oct) o 1-nov (nov-abr). */
function inicioPeriodoCts(fecha: Date): Date {
  const mes = fecha.getUTCMonth(); // 0-based
  const anio = fecha.getUTCFullYear();
  if (mes >= 4 && mes <= 9) return new Date(Date.UTC(anio, 4, 1)); // may-oct
  if (mes >= 10) return new Date(Date.UTC(anio, 10, 1)); // nov-dic
  return new Date(Date.UTC(anio - 1, 10, 1)); // ene-abr → nov del año anterior
}

/** Inicio del semestre de gratificación: 1-ene (ene-jun) o 1-jul (jul-dic). */
function inicioSemestreGrati(fecha: Date): Date {
  const anio = fecha.getUTCFullYear();
  return fecha.getUTCMonth() < 6 ? new Date(Date.UTC(anio, 0, 1)) : new Date(Date.UTC(anio, 6, 1));
}

function redondear(monto: number): number {
  return Math.round(monto * 100) / 100;
}

@Injectable()
export class TerminationService {
  constructor(
    private readonly normativeParams: NormativeParameterService,
    private readonly ceseDocuments?: CeseDocumentsService,
  ) {}

  async listar(tx: any): Promise<any[]> {
    return tx.cese.findMany({
      orderBy: { creadoEn: 'desc' },
      include: { employee: { select: { nombres: true, apellidos: true, numeroDocumento: true } } },
    });
  }

  async detalle(tx: any, ceseId: string): Promise<any> {
    const cese = await tx.cese.findUnique({
      where: { id: ceseId },
      include: { employee: { select: { nombres: true, apellidos: true, numeroDocumento: true } } },
    });
    if (!cese) throw new NotFoundException(`Cese ${ceseId} no encontrado`);
    return cese;
  }

  async aprobar(tx: any, ceseId: string, aprobadoPor: string): Promise<any> {
    const cese = await this.obtenerCese(tx, ceseId);
    if (cese.estado !== 'CALCULADA') {
      throw new ConflictException(`Solo se aprueba una liquidación CALCULADA (actual: ${cese.estado})`);
    }

    // Validaciones de completitud por motivo (422 con lista de faltantes).
    const faltantes: string[] = [];
    if (cese.motivo === 'FALLECIMIENTO') {
      const derechohabientes = cese.derechohabientes ?? [];
      if (derechohabientes.length === 0) {
        faltantes.push('derechohabientes: obligatorios en cese por fallecimiento');
      } else {
        const suma = derechohabientes.reduce((s: number, d: any) => s + Number(d.porcentaje), 0);
        if (Math.abs(suma - 100) > 0.01) {
          faltantes.push(`derechohabientes: los porcentajes suman ${suma}, deben sumar 100`);
        }
      }
    }
    if (!cese.componentes) faltantes.push('componentes: la liquidación no está calculada');
    if (faltantes.length > 0) {
      throw new UnprocessableEntityException({ message: 'Cese incompleto', faltantes });
    }

    const empleado = await tx.employee.findUnique({ where: { id: cese.employeeId } });
    const tenant = await tx.tenant.findUnique({ where: { id: cese.tenantId } });

    // Documentos PRIMERO: si MinIO falla, el estado no avanza (reintento seguro;
    // re-subir crea versiones nuevas, no duplica documentos).
    await this.ceseDocuments!.generarDocumentosCese(tx, cese, empleado, tenant, aprobadoPor);

    await tx.employee.update({ where: { id: cese.employeeId }, data: { estado: 'cesado' } });
    await tx.vacacionPeriodo.updateMany({
      where: { employeeId: cese.employeeId, estado: { in: ['EN_CURSO', 'VENCIDO_PENDIENTE'] } },
      data: { estado: 'LIQUIDADO' },
    });

    return tx.cese.update({
      where: { id: ceseId },
      data: { estado: 'APROBADA', aprobadoPor, aprobadoEn: new Date() },
    });
  }

  async pagar(tx: any, ceseId: string, fechaPago: Date = new Date()): Promise<any> {
    const cese = await this.obtenerCese(tx, ceseId);
    if (cese.estado !== 'APROBADA') {
      throw new ConflictException(`Solo se paga una liquidación APROBADA (actual: ${cese.estado})`);
    }
    const fueraDePlazo = fechaPago.getTime() > new Date(cese.fechaLimitePago).getTime() + 86_399_999;
    return tx.cese.update({
      where: { id: ceseId },
      data: { estado: 'PAGADA', pagadoEn: fechaPago, pagoFueraDePlazo: fueraDePlazo },
    });
  }

  async anular(tx: any, ceseId: string, motivo: string): Promise<any> {
    if (!motivo || motivo.trim() === '') {
      throw new BadRequestException('El motivo de anulación es obligatorio');
    }
    const cese = await this.obtenerCese(tx, ceseId);
    if (cese.estado === 'PAGADA' || cese.estado === 'ANULADA') {
      throw new ConflictException(`Un cese ${cese.estado} no puede anularse`);
    }
    if (cese.estado === 'APROBADA') {
      // Aproximación conservadora: los períodos vuelven a VENCIDO_PENDIENTE;
      // RRHH corrige el estado real por período con PUT /vacaciones/periodos/:id.
      await tx.employee.update({ where: { id: cese.employeeId }, data: { estado: 'activo' } });
      await tx.vacacionPeriodo.updateMany({
        where: { employeeId: cese.employeeId, estado: 'LIQUIDADO' },
        data: { estado: 'VENCIDO_PENDIENTE' },
      });
    }
    return tx.cese.update({
      where: { id: ceseId },
      data: { estado: 'ANULADA', motivoAnulacion: motivo.trim() },
    });
  }

  async crearCese(tx: any, input: CrearCeseInput): Promise<any> {
    const empleado = await tx.employee.findUnique({ where: { id: input.employeeId } });
    if (!empleado) throw new NotFoundException(`Empleado ${input.employeeId} no encontrado`);

    const ceseVigente = await tx.cese.findFirst({
      where: { employeeId: input.employeeId, estado: { not: 'ANULADA' } },
    });
    if (ceseVigente || empleado.estado === 'cesado') {
      throw new ConflictException('El empleado ya tiene un cese vigente');
    }

    const contrato = await tx.contrato.findFirst({
      where: { employeeId: input.employeeId },
      orderBy: { fechaInicio: 'desc' },
    });
    if (!contrato) throw new BadRequestException('El empleado no tiene contrato registrado');
    if (input.fechaCese.getTime() < new Date(contrato.fechaInicio).getTime()) {
      throw new BadRequestException('La fecha de cese es anterior al inicio del contrato');
    }
    if (input.motivo === 'TERMINO_CONTRATO' && !contrato.fechaFin) {
      throw new BadRequestException(
        'TERMINO_CONTRATO requiere un contrato a plazo fijo (con fecha de fin)',
      );
    }

    const snapshot = await this.preLlenarSnapshot(tx, input, contrato);

    return tx.cese.create({
      data: {
        tenantId: input.tenantId,
        employeeId: input.employeeId,
        fechaCese: input.fechaCese,
        motivo: input.motivo,
        estado: 'BORRADOR',
        inputSnapshot: snapshot,
        fechaLimitePago: calcularFechaLimitePago(input.fechaCese),
        creadoPor: input.creadoPor,
      },
    });
  }

  async actualizarDatos(tx: any, ceseId: string, cambios: Partial<CeseSnapshot>): Promise<any> {
    const cese = await this.obtenerCese(tx, ceseId);
    if (cese.estado !== 'BORRADOR' && cese.estado !== 'CALCULADA') {
      throw new ConflictException(
        `Los datos solo se corrigen en BORRADOR o CALCULADA (estado actual: ${cese.estado})`,
      );
    }
    return tx.cese.update({
      where: { id: ceseId },
      data: {
        estado: 'BORRADOR', // toda corrección invalida el cálculo anterior
        inputSnapshot: { ...cese.inputSnapshot, ...cambios },
        componentes: null,
        totalBruto: null,
        totalDeducciones: null,
        netoPagar: null,
        ...(cambios.gratificacionExtraordinaria !== undefined
          ? { gratificacionExtraordinaria: cambios.gratificacionExtraordinaria }
          : {}),
        ...(cambios.derechohabientes !== undefined
          ? { derechohabientes: cambios.derechohabientes }
          : {}),
      },
    });
  }

  async calcular(tx: any, ceseId: string): Promise<any> {
    const cese = await this.obtenerCese(tx, ceseId);
    if (cese.estado !== 'BORRADOR' && cese.estado !== 'CALCULADA') {
      throw new ConflictException(
        `Solo se calcula en BORRADOR o CALCULADA (estado actual: ${cese.estado})`,
      );
    }

    const snapshot: CeseSnapshot = cese.inputSnapshot;
    const fechaCese = new Date(cese.fechaCese);

    // Parámetros normativos vigentes a la fecha del cese.
    const resolve = (codigo: string) => this.normativeParams.resolve(tx, codigo, fechaCese);
    const uit = (await resolve('UIT')) as number;
    const rmv = (await resolve('RMV')) as number;
    const tasaOnp = ((await resolve('ONP_TASA')) as number) ?? 0.13;
    const tasaAfp = ((await resolve('AFP_APORTE_OBLIGATORIO')) as number) ?? 0.1;
    const bonif = ((await resolve('GRATIFICACION_BONIF_EXTRAORD')) as any) ?? {
      essalud: 0.09,
      eps: 0.0675,
    };
    const deduccionUit = ((await resolve('QUINTA_DEDUCCION_UIT')) as number) ?? 7;
    const factoresMype = ((await resolve('MYPE_FACTOR_CTS_GRATI')) as any) ?? {
      mype_pequena: 0.5,
      mype_micro: 0,
    };
    const topeIndemnizacion = ((await resolve('INDEMNIZACION_TOPE_REMUNERACIONES')) as number) ?? 12;
    const indemnizacionMype = ((await resolve('INDEMNIZACION_MYPE')) as any) ?? {
      mype_pequena: { diasPorAnio: 20, topeDias: 120 },
      mype_micro: { diasPorAnio: 10, topeDias: 90 },
    };

    const factorRegimen =
      snapshot.regimen === 'mype_micro'
        ? factoresMype.mype_micro
        : snapshot.regimen === 'mype_pequena'
          ? factoresMype.mype_pequena
          : 1;

    // Tiempo de servicios para la indemnización por despido.
    const inicioContrato = new Date(snapshot.fechaInicioContrato);
    const servicio = mesesYDias(inicioContrato, fechaCese);
    const mesesRestantesContrato = snapshot.fechaFinContrato
      ? Math.max(0, mesesYDias(fechaCese, new Date(snapshot.fechaFinContrato)).meses)
      : 0;

    const resultado = calcularLiquidacion({
      motivo: cese.motivo,
      regimen: snapshot.regimen,
      fechaCese,
      remuneracionComputable: snapshot.remuneracionComputable,
      factorRegimenCtsGrati: factorRegimen,
      cts: snapshot.cts,
      gratificacionTrunca: {
        mesesCompletos: snapshot.gratificacionTrunca.mesesCompletos,
        afiliadoEps: snapshot.afiliadoEps,
        tasaBonifEssalud: bonif.essalud,
        tasaBonifEps: bonif.eps,
      },
      vacaciones: {
        periodos: snapshot.vacaciones.map((p) => ({
          ...p,
          periodoInicio: new Date(p.periodoInicio),
          periodoFin: new Date(p.periodoFin),
        })),
        excluidoIndemnizacion: snapshot.excluidoIndemnizacionVacacional,
      },
      remuneracionesPendientes: snapshot.remuneracionesPendientes,
      gratificacionExtraordinaria: snapshot.gratificacionExtraordinaria,
      indemnizacionDespido:
        cese.motivo === 'DESPIDO_ARBITRARIO'
          ? {
              tipoContrato: snapshot.tipoContrato,
              aniosCompletos: Math.floor(servicio.meses / 12),
              mesesAdicionales: servicio.meses % 12,
              diasAdicionales: servicio.dias,
              mesesRestantesContrato,
              topeRemuneraciones: topeIndemnizacion,
              mypeParams: indemnizacionMype,
            }
          : null,
      deducciones: {
        pension: {
          sistema: snapshot.sistemaPensionario,
          tasaOnp,
          aportacionObligatoriaAfp: tasaAfp,
          comisionAfp: 0.016, // TODO parametrizar (deuda declarada en payroll-run)
          tipoComision: 'flujo',
          primaSeguroAfp: 0.0174, // TODO parametrizar
          topeRemuneracionMaximaAsegurable: 15 * rmv,
        },
        quinta: {
          uit,
          deduccionUit,
          tramos: [
            { hasta: 5 * uit, tasa: 0.08 },
            { hasta: 20 * uit, tasa: 0.14 },
            { hasta: 35 * uit, tasa: 0.17 },
            { hasta: 45 * uit, tasa: 0.2 },
            { hasta: Infinity, tasa: 0.3 },
          ],
          rentaPagadaEnElAnio: snapshot.quinta.rentaPagadaEnElAnio,
          retencionesYaEfectuadas: snapshot.quinta.retencionesYaEfectuadas,
        },
      },
    });

    return tx.cese.update({
      where: { id: ceseId },
      data: {
        estado: 'CALCULADA',
        componentes: { ingresos: resultado.ingresos, deducciones: resultado.deducciones },
        totalBruto: resultado.totalBruto,
        totalDeducciones: resultado.totalDeducciones,
        netoPagar: resultado.netoPagar,
      },
    });
  }

  /** Pre-llenado del snapshot: mejores datos disponibles, todo corregible por RRHH. */
  private async preLlenarSnapshot(
    tx: any,
    input: CrearCeseInput,
    contrato: any,
  ): Promise<CeseSnapshot> {
    const remuneracion = contrato.remuneracionBasica.toNumber
      ? contrato.remuneracionBasica.toNumber()
      : Number(contrato.remuneracionBasica);

    const regimenPensionario = await tx.regimenPensionario.findFirst({
      where: { employeeId: input.employeeId },
    });

    // CTS: meses/días desde el inicio del período semestral vigente (may/nov),
    // sin exceder la fecha de ingreso si es posterior.
    const inicioCts = inicioPeriodoCts(input.fechaCese);
    const desdeCts =
      new Date(contrato.fechaInicio).getTime() > inicioCts.getTime()
        ? new Date(contrato.fechaInicio)
        : inicioCts;
    const cts = mesesYDias(desdeCts, input.fechaCese);

    // Gratificación trunca: meses calendario COMPLETOS del semestre en curso.
    const inicioGrati = inicioSemestreGrati(input.fechaCese);
    const desdeGrati =
      new Date(contrato.fechaInicio).getTime() > inicioGrati.getTime()
        ? new Date(contrato.fechaInicio)
        : inicioGrati;
    const grati = mesesYDias(desdeGrati, input.fechaCese);

    // Vacaciones: períodos con saldo del récord vacacional.
    const periodos = await tx.vacacionPeriodo.findMany({
      where: { employeeId: input.employeeId, estado: { in: ['EN_CURSO', 'VENCIDO_PENDIENTE'] } },
      orderBy: { periodoInicio: 'asc' },
    });

    // Pendientes: sueldo del mes en curso prorrateado + horas extra no incluidas
    // en nómina (DIARIAS al 25%, SEMANALES al 35% — simplificación corregible).
    const pendientes: Array<{ concepto: string; monto: number }> = [];
    const diaCese = input.fechaCese.getUTCDate();
    pendientes.push({
      concepto: `Sueldo ${input.fechaCese.toISOString().slice(0, 7)} (${diaCese} días)`,
      monto: redondear((remuneracion * Math.min(diaCese, DIAS_POR_MES)) / DIAS_POR_MES),
    });

    const horasDia = Number((contrato.jornada as any)?.horasDia ?? 8) || 8;
    const valorHora = remuneracion / DIAS_POR_MES / horasDia;
    const horasExtra = await tx.horasExtra.findMany({
      where: { employeeId: input.employeeId, incluidoEnNomina: false },
    });
    let montoHoras = 0;
    for (const he of horasExtra) {
      const recargo = he.tipo === 'SEMANALES' ? 1.35 : 1.25;
      montoHoras += Number(he.horasCalculadas) * valorHora * recargo;
    }
    if (montoHoras > 0) {
      pendientes.push({
        concepto: 'Horas extra pendientes de nómina',
        monto: redondear(montoHoras),
      });
    }

    // 5ta: renta pagada en el año desde las planillas procesadas del ejercicio.
    const anio = input.fechaCese.getUTCFullYear();
    const detalles = await tx.planillaDetalle.findMany({
      where: {
        employeeId: input.employeeId,
        planilla: { periodo: { startsWith: `${anio}-` }, estado: { in: ['procesado', 'cerrado'] } },
      },
      include: { planilla: true },
    });
    let rentaPagada = 0;
    let retenciones5ta = 0;
    for (const detalle of detalles) {
      for (const concepto of (detalle.conceptosCalculados as any[]) ?? []) {
        if (concepto.monto > 0) rentaPagada += concepto.monto;
        if (concepto.codigo === '0801') retenciones5ta += -concepto.monto;
      }
    }

    return {
      regimen: contrato.regimenLaboral,
      tipoContrato: contrato.fechaFin ? 'plazo_fijo' : 'indeterminado',
      fechaInicioContrato: new Date(contrato.fechaInicio).toISOString().slice(0, 10),
      fechaFinContrato: contrato.fechaFin
        ? new Date(contrato.fechaFin).toISOString().slice(0, 10)
        : null,
      remuneracionComputable: remuneracion,
      sistemaPensionario: regimenPensionario?.sistema === 'afp' ? 'afp' : 'onp',
      afiliadoEps: false,
      excluidoIndemnizacionVacacional: false,
      cts: {
        gratificacionSemestralPercibida: remuneracion, // aprox. 1 sueldo; corregible
        mesesCompletosDesdeUltimoDeposito: cts.meses,
        diasAdicionales: cts.dias,
      },
      gratificacionTrunca: { mesesCompletos: grati.meses },
      vacaciones: periodos.map((p: any) => ({
        periodoInicio: new Date(p.periodoInicio),
        periodoFin: new Date(p.periodoFin),
        diasGanados: p.diasGanados,
        diasGozados: Number(p.diasGozados),
        estado: p.estado,
      })),
      remuneracionesPendientes: pendientes,
      gratificacionExtraordinaria: 0,
      derechohabientes: null,
      quinta: {
        rentaPagadaEnElAnio: redondear(rentaPagada),
        retencionesYaEfectuadas: redondear(retenciones5ta),
      },
    };
  }

  protected async obtenerCese(tx: any, ceseId: string): Promise<any> {
    const cese = await tx.cese.findUnique({ where: { id: ceseId } });
    if (!cese) throw new NotFoundException(`Cese ${ceseId} no encontrado`);
    return cese;
  }
}
