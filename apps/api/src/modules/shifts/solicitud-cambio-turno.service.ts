import { Injectable, ConflictException, BadRequestException, NotFoundException } from '@nestjs/common';

export interface CrearSolicitudInput {
  tenantId: string;
  employeeId: string;
  fechaActual: Date;
  turnoIdActual?: string; // null si el día actual es DESCANSO
  fechaNueva: Date;
  turnoIdNuevo?: string; // null si se solicita DESCANSO
  creadoPor: string;
}

export interface FiltroSolicitudes {
  tenantId: string;
  estado?: 'PENDIENTE' | 'APROBADA' | 'RECHAZADA';
  employeeId?: string;
  decididoPor?: string;
  fechaDesde?: Date;
  fechaHasta?: Date;
}

const INCLUDE_RELACIONES = {
  employee: { select: { nombre: true, email: true } },
  turnoActual: true,
  turnoNuevo: true,
};

@Injectable()
export class SolicitudCambioTurnoService {
  async crearSolicitud(tx: any, input: CrearSolicitudInput): Promise<any> {
    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);

    // Validar fechas futuras (Global Constraint)
    if (new Date(input.fechaActual) < hoy) {
      throw new BadRequestException('La fecha actual del turno no puede estar en el pasado');
    }
    if (new Date(input.fechaNueva) < hoy) {
      throw new BadRequestException('La fecha nueva solicitada no puede estar en el pasado');
    }

    // Validar duplicado: solicitud PENDIENTE para el mismo empleado y fecha
    const duplicado = await tx.solicitudCambioTurno.findFirst({
      where: {
        tenantId: input.tenantId,
        employeeId: input.employeeId,
        fechaActual: input.fechaActual,
        estado: 'PENDIENTE',
      },
    });
    if (duplicado) {
      throw new ConflictException('Ya existe una solicitud pendiente para esa fecha');
    }

    // Validar que el turno actual coincide con la asignación existente
    const asignacionActual = await tx.turnoAsignacion.findFirst({
      where: {
        tenantId: input.tenantId,
        employeeId: input.employeeId,
        fecha: input.fechaActual,
      },
    });
    const turnoIdActualAsignado = asignacionActual?.turnoId ?? null;
    const turnoIdActualSolicitado = input.turnoIdActual ?? null;
    if (turnoIdActualAsignado !== turnoIdActualSolicitado) {
      throw new BadRequestException('El turno actual indicado no coincide con la asignación existente para esa fecha');
    }

    // Validar que el turno nuevo existe en el catálogo (si no es null)
    if (input.turnoIdNuevo) {
      const turnoNuevo = await tx.turno.findUnique({ where: { id: input.turnoIdNuevo } });
      if (!turnoNuevo || turnoNuevo.tenantId !== input.tenantId) {
        throw new BadRequestException('El turno nuevo indicado no existe en el catálogo');
      }
    }

    // Validar que no exista conflicto en la fecha nueva (asignación no-DESCANSO ya existente)
    const asignacionNueva = await tx.turnoAsignacion.findFirst({
      where: {
        tenantId: input.tenantId,
        employeeId: input.employeeId,
        fecha: input.fechaNueva,
      },
    });
    if (asignacionNueva && asignacionNueva.tipoDia !== 'DESCANSO') {
      throw new ConflictException('Ya existe una asignación de turno para la fecha nueva solicitada');
    }

    return tx.solicitudCambioTurno.create({
      data: {
        tenantId: input.tenantId,
        employeeId: input.employeeId,
        fechaActual: input.fechaActual,
        turnoIdActual: input.turnoIdActual ?? null,
        fechaNueva: input.fechaNueva,
        turnoIdNuevo: input.turnoIdNuevo ?? null,
        estado: 'PENDIENTE',
        creadoPor: input.creadoPor,
      },
    });
  }

  async listarSolicitudes(tx: any, filtros: FiltroSolicitudes): Promise<any[]> {
    return tx.solicitudCambioTurno.findMany({
      where: {
        tenantId: filtros.tenantId,
        ...(filtros.estado && { estado: filtros.estado }),
        ...(filtros.employeeId && { employeeId: filtros.employeeId }),
        ...(filtros.decididoPor && { decididoPor: filtros.decididoPor }),
        ...((filtros.fechaDesde || filtros.fechaHasta) && {
          fechaSolicitud: {
            ...(filtros.fechaDesde && { gte: filtros.fechaDesde }),
            ...(filtros.fechaHasta && { lte: filtros.fechaHasta }),
          },
        }),
      },
      include: INCLUDE_RELACIONES,
      orderBy: { fechaSolicitud: 'desc' },
    });
  }

  async listarMisSolicitudes(tx: any, tenantId: string, employeeId: string): Promise<any[]> {
    return this.listarSolicitudes(tx, { tenantId, employeeId });
  }

  async obtenerSolicitud(tx: any, id: string): Promise<any | null> {
    return tx.solicitudCambioTurno.findUnique({
      where: { id },
      include: INCLUDE_RELACIONES,
    });
  }

  async actualizarEstado(
    tx: any,
    id: string,
    nuevoEstado: 'APROBADA' | 'RECHAZADA',
    decididoPor: string,
    motivoRechazo?: string,
  ): Promise<any> {
    const solicitud = await tx.solicitudCambioTurno.findUnique({ where: { id } });
    if (!solicitud) {
      throw new NotFoundException(`Solicitud ${id} no encontrada`);
    }
    if (solicitud.estado !== 'PENDIENTE') {
      throw new BadRequestException('Solo se pueden decidir solicitudes en estado PENDIENTE');
    }

    if (nuevoEstado === 'APROBADA') {
      if (solicitud.turnoIdNuevo) {
        const turnoNuevo = await tx.turno.findUnique({ where: { id: solicitud.turnoIdNuevo } });
        if (!turnoNuevo || turnoNuevo.tenantId !== solicitud.tenantId) {
          throw new BadRequestException('El turno nuevo indicado no existe en el catálogo');
        }
      }

      const asignacionNueva = await tx.turnoAsignacion.findFirst({
        where: {
          tenantId: solicitud.tenantId,
          employeeId: solicitud.employeeId,
          fecha: solicitud.fechaNueva,
        },
      });
      if (asignacionNueva && asignacionNueva.tipoDia !== 'DESCANSO') {
        throw new ConflictException('Ya existe una asignación de turno para la fecha nueva solicitada');
      }
    }

    return tx.solicitudCambioTurno.update({
      where: { id },
      data: {
        estado: nuevoEstado,
        fechaDecision: new Date(),
        decididoPor,
        actualizadoPor: decididoPor,
        ...(nuevoEstado === 'RECHAZADA' && { motivoRechazo: motivoRechazo ?? null }),
      },
    });
  }
}
