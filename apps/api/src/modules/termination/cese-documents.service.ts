import { BadRequestException, Injectable } from '@nestjs/common';
import PDFDocument from 'pdfkit';
import { DocumentService } from '../../modules/documents/document.service';
import { CONCEPTO_RETENCION_QUINTA } from '../payroll/calculators/liquidacion.calculator';

const MOTIVO_LABELS: Record<string, string> = {
  RENUNCIA: 'Renuncia voluntaria',
  TERMINO_CONTRATO: 'Término de contrato',
  MUTUO_DISENSO: 'Mutuo disenso',
  DESPIDO_ARBITRARIO: 'Despido arbitrario',
  FALLECIMIENTO: 'Fallecimiento',
};

/**
 * Genera los documentos obligatorios del cese como PDFs (pdfkit, sin
 * dependencias de red) y los archiva en el legajo vía DocumentService:
 * hoja de liquidación, certificado de trabajo, constancia de cese (retiro CTS)
 * y certificado de retención de 5ta. La carta de renuncia y el examen médico
 * de retiro (Ley 29783) se suben manualmente — fuera de este service.
 */
@Injectable()
export class CeseDocumentsService {
  constructor(private readonly documents: DocumentService) {}

  async generarDocumentosCese(
    tx: any,
    cese: any,
    empleado: any,
    tenant: any,
    subidoPor: string,
  ): Promise<string[]> {
    if (!cese.componentes) {
      throw new BadRequestException('Cese sin componentes calculados');
    }

    const docs: Array<{ tipo: string; nombre: string; contenido: Buffer }> = [
      {
        tipo: 'LIQUIDACION',
        nombre: `hoja-liquidacion-${cese.id}.pdf`,
        contenido: await this.pdfHojaLiquidacion(cese, empleado, tenant),
      },
      {
        tipo: 'CERTIFICADO_TRABAJO',
        nombre: `certificado-trabajo-${cese.id}.pdf`,
        contenido: await this.pdfCertificadoTrabajo(cese, empleado, tenant),
      },
      {
        tipo: 'CONSTANCIA_CESE',
        nombre: `constancia-cese-${cese.id}.pdf`,
        contenido: await this.pdfConstanciaCese(cese, empleado, tenant),
      },
      {
        tipo: 'CERTIFICADO_RETENCION_5TA',
        nombre: `certificado-retencion-5ta-${cese.id}.pdf`,
        contenido: await this.pdfCertificadoRetencion(cese, empleado, tenant),
      },
    ];

    const ids: string[] = [];
    for (const doc of docs) {
      const resultado = await this.documents.uploadDocument(tx, {
        tenantId: empleado.tenantId,
        employeeId: empleado.id,
        tipo: doc.tipo as any,
        nombreArchivo: doc.nombre,
        mimeType: 'application/pdf',
        contenido: doc.contenido,
        subidoPor,
      });
      ids.push(resultado.documento.id);
    }
    return ids;
  }

  /** Crea un PDF A4 con cabecera estándar y delega el cuerpo; retorna el buffer. */
  private crearPdf(titulo: string, tenant: any, cuerpo: (doc: any) => void): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ size: 'A4', margin: 50 });
      const chunks: Buffer[] = [];
      doc.on('data', (chunk: Buffer) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      doc.fontSize(10).text(`${tenant.razonSocial} — RUC ${tenant.ruc}`, { align: 'right' });
      doc.moveDown().fontSize(16).text(titulo, { align: 'center' }).moveDown();
      doc.fontSize(10);
      cuerpo(doc);
      doc.end();
    });
  }

  private datosEmpleado(doc: any, cese: any, empleado: any): void {
    doc.text(`Trabajador: ${empleado.apellidos}, ${empleado.nombres}`);
    doc.text(`Documento: ${empleado.numeroDocumento}`);
    doc.text(`Fecha de ingreso: ${cese.inputSnapshot.fechaInicioContrato}`);
    doc.text(`Fecha de cese: ${new Date(cese.fechaCese).toISOString().slice(0, 10)}`);
    doc.text(`Motivo: ${MOTIVO_LABELS[cese.motivo] ?? cese.motivo}`).moveDown();
  }

  private pdfHojaLiquidacion(cese: any, empleado: any, tenant: any): Promise<Buffer> {
    return this.crearPdf('LIQUIDACIÓN DE BENEFICIOS SOCIALES', tenant, (doc) => {
      this.datosEmpleado(doc, cese, empleado);
      doc.text('INGRESOS', { underline: true });
      for (const linea of cese.componentes.ingresos) {
        doc.text(`${linea.concepto} (${linea.baseLegal}): S/ ${linea.monto.toFixed(2)}`);
      }
      doc.moveDown().text('DEDUCCIONES', { underline: true });
      for (const linea of cese.componentes.deducciones) {
        doc.text(`${linea.concepto} (${linea.baseLegal}): S/ ${linea.monto.toFixed(2)}`);
      }
      doc.moveDown();
      doc.text(`Total bruto: S/ ${Number(cese.totalBruto).toFixed(2)}`);
      doc.text(`Total deducciones: S/ ${Number(cese.totalDeducciones).toFixed(2)}`);
      doc.fontSize(12).text(`NETO A PAGAR: S/ ${Number(cese.netoPagar).toFixed(2)}`);
      if (cese.derechohabientes?.length) {
        doc.moveDown().fontSize(10).text('Derechohabientes (Ley 29783 / art. 1 D.S. 001-97-TR):');
        for (const d of cese.derechohabientes) {
          doc.text(`- ${d.nombre} (${d.parentesco}, ${d.numeroDocumento}): ${d.porcentaje}%`);
        }
      }
      doc.moveDown(3).text('_______________________          _______________________');
      doc.text('        El empleador                         El trabajador');
    });
  }

  private pdfCertificadoTrabajo(cese: any, empleado: any, tenant: any): Promise<Buffer> {
    return this.crearPdf('CERTIFICADO DE TRABAJO', tenant, (doc) => {
      doc.text(
        `Por el presente, ${tenant.razonSocial} certifica que ${empleado.nombres} ${empleado.apellidos}, ` +
          `identificado(a) con documento N° ${empleado.numeroDocumento}, laboró en nuestra empresa ` +
          `desde el ${cese.inputSnapshot.fechaInicioContrato} hasta el ${new Date(cese.fechaCese)
            .toISOString()
            .slice(0, 10)}.`,
      );
      doc.moveDown().text('Se expide el presente a solicitud del interesado para los fines que estime conveniente.');
    });
  }

  private pdfConstanciaCese(cese: any, empleado: any, tenant: any): Promise<Buffer> {
    return this.crearPdf('CONSTANCIA DE CESE', tenant, (doc) => {
      this.datosEmpleado(doc, cese, empleado);
      doc.text(
        'Se deja constancia del cese del trabajador para efectos del retiro de la ' +
          'Compensación por Tiempo de Servicios (CTS) conforme al D.S. 001-97-TR.',
      );
    });
  }

  private pdfCertificadoRetencion(cese: any, empleado: any, tenant: any): Promise<Buffer> {
    return this.crearPdf('CERTIFICADO DE RETENCIONES — RENTA 5TA CATEGORÍA', tenant, (doc) => {
      this.datosEmpleado(doc, cese, empleado);
      const retencionLiquidacion = cese.componentes.deducciones.find((l: any) =>
        l.concepto === CONCEPTO_RETENCION_QUINTA,
      );
      doc.text(`Renta pagada en el ejercicio: S/ ${cese.inputSnapshot.quinta.rentaPagadaEnElAnio.toFixed(2)}`);
      doc.text(
        `Retenciones efectuadas en el ejercicio: S/ ${cese.inputSnapshot.quinta.retencionesYaEfectuadas.toFixed(2)}`,
      );
      doc.text(
        `Retención en la liquidación: S/ ${retencionLiquidacion ? Math.abs(retencionLiquidacion.monto).toFixed(2) : '0.00'}`,
      );
    });
  }
}
