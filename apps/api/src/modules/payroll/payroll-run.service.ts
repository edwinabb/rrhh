import { Injectable } from '@nestjs/common';
import { NormativeParameterService } from '../normative-params/normative-parameter.service';
import { calcularCts } from './calculators/cts.calculator';
import { calcularGratificacion } from './calculators/gratificacion.calculator';
import { calcularRetencionPensionaria } from './calculators/afp-onp.calculator';
import { calcularAporteEssalud } from './calculators/essalud.calculator';
import { calcularAsignacionFamiliar } from './calculators/asignacion-familiar.calculator';
import { calcularRetencionQuinta } from './calculators/quinta-categoria.calculator';

export interface PlanillaProcesada {
  id: string;
  estado: string;
}

export interface ConceptoCalculado {
  codigo: string;
  nombre: string;
  monto: number;
}

/**
 * Orquesta un ciclo de planilla: para cada trabajador activo del tenant,
 * resuelve los parámetros normativos vigentes a la fecha del periodo y ejecuta
 * las calculadoras puras (Tasks 2-7), guardando el resultado en
 * PLANILLA_DETALLE.conceptos_calculados. No contiene lógica de cálculo propia
 * — todo el cálculo vive en las funciones puras de ./calculators.
 */
@Injectable()
export class PayrollRunService {
  constructor(private readonly normativeParams: NormativeParameterService) {}

  async procesarPeriodo(client: any, periodo: string): Promise<PlanillaProcesada> {
    const fechaPeriodo = new Date(`${periodo}-01`);
    const planilla = await client.planilla.create({
      data: { periodo, estado: 'registrado', tenantId: 'placeholder-tenant' },
    });

    const empleados = await client.employee.findMany({
      where: { estado: 'activo' },
      include: {
        contratos: true,
        regimenesPensionarios: true,
        cuentasBancarias: true,
      },
    });

    // Resolver parámetros normativos vigentes
    const uit = (await this.normativeParams.resolve(client, 'UIT', fechaPeriodo)) as number;
    const rmv = (await this.normativeParams.resolve(client, 'RMV', fechaPeriodo)) as number;
    const tasaEssalud = (await this.normativeParams.resolve(
      client,
      'ESSALUD_TASA',
      fechaPeriodo,
    )) as number;
    const tasaOnp = (await this.normativeParams.resolve(client, 'ONP_TASA', fechaPeriodo)) as
      | number
      | undefined;
    const tasaAfpAporte = (await this.normativeParams.resolve(
      client,
      'AFP_APORTE_OBLIGATORIO',
      fechaPeriodo,
    )) as number;
    const tasaAsignacionFamiliar = (await this.normativeParams.resolve(
      client,
      'ASIGNACION_FAMILIAR_TASA',
      fechaPeriodo,
    )) as number;

    for (const empleado of empleados) {
      const contrato = empleado.contratos[0];
      const regimenPensionario = empleado.regimenesPensionarios[0];
      const remuneracion = contrato.remuneracionBasica.toNumber();

      const conceptosCalculados: ConceptoCalculado[] = [];
      let totalDescuentos = 0;

      // 1. Remuneración Base
      conceptosCalculados.push({ codigo: '0121', nombre: 'Sueldo', monto: remuneracion });

      // 2. Asignación Familiar
      const asignacionFamiliar = calcularAsignacionFamiliar({
        tieneHijosODependientes: true, // TODO: leer de employee.tieneHijos
        rmvVigente: rmv,
        tasaAsignacionFamiliar,
      });
      if (asignacionFamiliar.monto > 0) {
        conceptosCalculados.push({
          codigo: '0201',
          nombre: 'Asignación Familiar',
          monto: asignacionFamiliar.monto,
        });
      }

      // 3. EsSalud (aporte empleador, no descuento)
      const essalud = calcularAporteEssalud({
        remuneracion,
        tieneConvenioEps: false, // TODO: leer de tenant.tieneConvenioEps
        tasaEssalud,
        tasaEssaludConEps: 0.025,
      });
      // EsSalud es un aporte del empleador, se registra pero no afecta neto

      // 4. Retención Pensionaria (AFP/ONP)
      const retencionPensionaria = calcularRetencionPensionaria({
        sistema: regimenPensionario?.sistema === 'afp' ? 'afp' : 'onp',
        remuneracion,
        tasaOnp: tasaOnp ?? 0.13,
        aportacionObligatoriaAfp: tasaAfpAporte,
        comisionAfp: 0.016, // TODO: parametrizar
        tipoComision: 'flujo',
        primaSeguroAfp: 0.0174, // TODO: parametrizar
        topeRemuneracionMaximaAsegurable: 15 * rmv, // TODO: parametrizar
      });
      conceptosCalculados.push({
        codigo: '0701',
        nombre: `Descuento ${regimenPensionario?.sistema === 'afp' ? 'AFP' : 'ONP'}`,
        monto: -retencionPensionaria.montoRetenido,
      });
      totalDescuentos += retencionPensionaria.montoRetenido;

      // 5. Quinta Categoría (simplificado: sin proyección anual, solo remuneración actual)
      const mesesRestantesDelAnio = 12 - new Date(fechaPeriodo).getMonth();
      const tramos = [
        { hasta: 5 * uit, tasa: 0.08 },
        { hasta: 20 * uit, tasa: 0.14 },
        { hasta: 35 * uit, tasa: 0.17 },
        { hasta: 45 * uit, tasa: 0.2 },
        { hasta: Infinity, tasa: 0.3 },
      ];
      const quinta = calcularRetencionQuinta({
        remuneracionProyectadaRestante: remuneracion * mesesRestantesDelAnio,
        conceptosYaPagadosEnElAnio: 0, // TODO: sumar meses anteriores del año
        ingresosOtrasEntidadesDeclarados: 0, // TODO: leer de employee
        deduccionUit: 7,
        uit,
        tramos,
        mesesRestantes: mesesRestantesDelAnio,
      });
      if (quinta.retencionMensual > 0) {
        conceptosCalculados.push({
          codigo: '0801',
          nombre: 'Retención Quinta Categoría',
          monto: -quinta.retencionMensual,
        });
        totalDescuentos += quinta.retencionMensual;
      }

      // Neto a pagar
      const netoPagar = remuneracion + asignacionFamiliar.monto - totalDescuentos;

      // Guardar en PLANILLA_DETALLE
      await client.planillaDetalle.create({
        data: {
          planillaId: planilla.id,
          employeeId: empleado.id,
          conceptosCalculados: conceptosCalculados,
          netoPagar,
        },
      });
    }

    // Cambiar estado a procesado
    const actualizada = await client.planilla.update({
      where: { id: planilla.id },
      data: { estado: 'procesado' },
    });

    return { id: planilla.id, estado: actualizada.estado ?? 'procesado' };
  }
}
