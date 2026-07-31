import { Injectable, ConflictException, BadRequestException, NotFoundException } from '@nestjs/common';

export interface CrearPatronInput {
  tenantId: string;
  nombre: string;
  descripcion?: string;
  secuencia: TipoDiaPlan[];
  duracionCiclo: number;
  creadoPor: string;
}

export type TipoDiaPlan = 'DIA' | 'NOCHE' | 'DESC';

@Injectable()
export class RotacionPatronService {
  async listarPatrones(tx: any, tenantId: string, incluyeInactivos = false): Promise<any> {
    return tx.rotacionPatron.findMany({
      where: {
        tenantId,
        ...(incluyeInactivos ? {} : { activo: true }),
      },
      orderBy: { nombre: 'asc' },
    });
  }

  async crearPatron(tx: any, input: CrearPatronInput): Promise<any> {
    // Validar secuencia
    if (input.secuencia.length !== 7) {
      throw new BadRequestException('Secuencia debe tener exactamente 7 elementos (1 por día)');
    }
    if (input.duracionCiclo !== 7) {
      throw new BadRequestException('Duración del ciclo debe ser 7 días');
    }

    // Validar no duplicate
    const existente = await tx.rotacionPatron.findFirst({
      where: { tenantId: input.tenantId, nombre: input.nombre },
    });
    if (existente) {
      throw new ConflictException(`Ya existe un patrón con nombre "${input.nombre}"`);
    }

    return tx.rotacionPatron.create({
      data: {
        tenantId: input.tenantId,
        nombre: input.nombre,
        descripcion: input.descripcion ?? null,
        secuencia: JSON.stringify(input.secuencia),
        duracionCiclo: input.duracionCiclo,
        creadoPor: input.creadoPor,
      },
    });
  }

  async actualizarPatron(tx: any, id: string, cambios: Partial<Omit<CrearPatronInput, 'tenantId' | 'creadoPor'>> & { actualizadoPor?: string; activo?: boolean }): Promise<any> {
    const patron = await tx.rotacionPatron.findUnique({ where: { id } });
    if (!patron) throw new NotFoundException(`Patrón ${id} no encontrado`);

    if (cambios.secuencia && cambios.secuencia.length !== 7) {
      throw new BadRequestException('Secuencia debe tener exactamente 7 elementos');
    }

    // Validar nombre duplicado si se está cambiando el nombre
    if (cambios.nombre && cambios.nombre !== patron.nombre) {
      const duplicado = await tx.rotacionPatron.findFirst({
        where: {
          tenantId: patron.tenantId,
          nombre: cambios.nombre,
          NOT: { id },
        },
      });
      if (duplicado) {
        throw new ConflictException(`Ya existe un patrón con nombre "${cambios.nombre}"`);
      }
    }

    return tx.rotacionPatron.update({
      where: { id },
      data: {
        ...(cambios.nombre && { nombre: cambios.nombre }),
        ...(cambios.descripcion !== undefined && { descripcion: cambios.descripcion }),
        ...(cambios.secuencia && { secuencia: JSON.stringify(cambios.secuencia) }),
        ...(cambios.activo !== undefined && { activo: cambios.activo }),
        ...(cambios.actualizadoPor && { actualizadoPor: cambios.actualizadoPor }),
      },
    });
  }
}
