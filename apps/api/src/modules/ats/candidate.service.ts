import { Injectable } from '@nestjs/common';

export type EstadoCandidato =
  | 'APLICADO'
  | 'REVISADO'
  | 'ENTREVISTA'
  | 'OFERTA'
  | 'RECHAZADO'
  | 'CONTRATADO';

export interface RegistrarCandidatoInput {
  tenantId: string;
  vacanteId: string;
  nombreCompleto: string;
  email: string;
  telefono?: string;
  /** Clave del objeto CV en MinIO. */
  cvRutaMinio: string;
  /** Consentimiento LPDP (Ley 29733) — obligatorio para tratar los datos. */
  consentimientoLpdp: boolean;
}

/**
 * Máquina de estados del pipeline de reclutamiento:
 * APLICADO → REVISADO → ENTREVISTA → OFERTA → (CONTRATADO | RECHAZADO).
 * RECHAZADO es alcanzable desde cualquier estado no terminal.
 * RECHAZADO y CONTRATADO son terminales (sin transiciones de salida).
 */
const TRANSICIONES_VALIDAS: Record<EstadoCandidato, EstadoCandidato[]> = {
  APLICADO: ['REVISADO', 'RECHAZADO'],
  REVISADO: ['ENTREVISTA', 'RECHAZADO'],
  ENTREVISTA: ['OFERTA', 'RECHAZADO'],
  OFERTA: ['CONTRATADO', 'RECHAZADO'],
  RECHAZADO: [],
  CONTRATADO: [],
};

/**
 * Servicio de candidatos (ATS, Fase 4). Cada método recibe el cliente/tx de
 * Prisma como parámetro (el controller decide la transacción).
 *
 * Reglas de negocio:
 * - Ley 29733 (LPDP): sin consentimiento explícito no se registra al candidato.
 * - Solo se aceptan candidatos en vacantes ABIERTAS.
 * - Email único por vacante (normalizado a minúsculas, respalda el
 *   @@unique([vacanteId, email]) del schema).
 * - contratar() vincula el candidato al Employee creado (D.Leg. 728).
 */
@Injectable()
export class CandidateService {
  /** Registra un candidato en estado APLICADO sobre una vacante ABIERTA. */
  async registrarCandidato(tx: any, input: RegistrarCandidatoInput) {
    // Ley 29733: sin consentimiento no se tratan datos personales.
    if (!input.consentimientoLpdp) {
      throw new Error(
        'Se requiere el consentimiento LPDP del candidato (Ley 29733) para registrar sus datos',
      );
    }

    const vacante = await tx.vacante.findUnique({ where: { id: input.vacanteId } });
    if (!vacante) {
      throw new Error(`Vacante no encontrada: ${input.vacanteId}`);
    }
    if (vacante.estado !== 'ABIERTA') {
      throw new Error(
        `Solo se aceptan candidatos en vacantes ABIERTAS (estado actual: ${vacante.estado})`,
      );
    }

    const email = input.email.trim().toLowerCase();

    const existente = await tx.candidato.findUnique({
      where: { vacanteId_email: { vacanteId: input.vacanteId, email } },
    });
    if (existente) {
      throw new Error(`El candidato con email ${email} ya postuló a esta vacante`);
    }

    return tx.candidato.create({
      data: {
        tenantId: input.tenantId,
        vacanteId: input.vacanteId,
        nombreCompleto: input.nombreCompleto,
        email,
        telefono: input.telefono,
        cvRutaMinio: input.cvRutaMinio,
        consentimientoLpdp: true,
        estado: 'APLICADO',
      },
    });
  }

  /**
   * Cambia el estado del candidato validando la máquina de estados.
   * Cualquier transición fuera de TRANSICIONES_VALIDAS lanza error.
   */
  async cambiarEstado(tx: any, candidatoId: string, nuevoEstado: EstadoCandidato) {
    const candidato = await tx.candidato.findUnique({ where: { id: candidatoId } });
    if (!candidato) {
      throw new Error(`Candidato no encontrado: ${candidatoId}`);
    }

    const permitidas = TRANSICIONES_VALIDAS[candidato.estado as EstadoCandidato] ?? [];
    if (!permitidas.includes(nuevoEstado)) {
      throw new Error(
        `Transición de estado inválida: ${candidato.estado} → ${nuevoEstado}`,
      );
    }

    return tx.candidato.update({
      where: { id: candidatoId },
      data: { estado: nuevoEstado },
    });
  }

  /** Agrega una nota interna del equipo de reclutamiento sobre el candidato. */
  async agregarNota(tx: any, candidatoId: string, autorId: string, nota: string) {
    if (!nota || !nota.trim()) {
      throw new Error('La nota no puede estar vacía');
    }

    const candidato = await tx.candidato.findUnique({ where: { id: candidatoId } });
    if (!candidato) {
      throw new Error(`Candidato no encontrado: ${candidatoId}`);
    }

    return tx.candidatoNota.create({
      data: {
        tenantId: candidato.tenantId,
        candidatoId,
        autorId,
        nota: nota.trim(),
      },
    });
  }

  /**
   * Contrata al candidato: OFERTA → CONTRATADO y vincula el employeeId del
   * trabajador creado (migración a Employee, D.Leg. 728).
   */
  async contratar(tx: any, candidatoId: string, employeeId: string) {
    const candidato = await tx.candidato.findUnique({ where: { id: candidatoId } });
    if (!candidato) {
      throw new Error(`Candidato no encontrado: ${candidatoId}`);
    }
    if (candidato.estado !== 'OFERTA') {
      throw new Error(
        `Solo se puede contratar a un candidato en estado OFERTA (estado actual: ${candidato.estado})`,
      );
    }

    return tx.candidato.update({
      where: { id: candidatoId },
      data: { estado: 'CONTRATADO', employeeId },
    });
  }
}
