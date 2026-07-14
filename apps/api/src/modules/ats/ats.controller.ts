import type { Prisma } from '@rrhh/database';
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import {
  getTenantContext,
  TenantContext,
} from '../../common/database/tenant-request-context';
import { VacanteService, EstadoVacante } from './vacante.service';
import { CandidateService, EstadoCandidato } from './candidate.service';
import {
  CVParsingService,
  CvParseado,
  CvParseError,
  CvRateLimitError,
} from './cv-parsing.service';

// ---------------------------------------------------------------------------
// DTOs (sin class-validator: el proyecto no lo usa; validación mínima manual)
// ---------------------------------------------------------------------------

export class CrearVacanteDto {
  titulo!: string;
  descripcion!: string;
  /** Estructura libre: skills, experiencia, educación... */
  requisitos!: unknown;
  salarioMin?: number;
  salarioMax?: number;
  sedeId?: string;
}

export class RegistrarCandidatoDto {
  nombreCompleto!: string;
  email!: string;
  telefono?: string;
  /**
   * Texto plano del CV (MVP: el CV llega como texto en el body; la subida
   * del archivo original a MinIO llegará con el módulo documental).
   */
  cvTexto!: string;
  /** Clave del objeto CV en MinIO; si se omite se genera una clave MVP. */
  cvRutaMinio?: string;
  /** Consentimiento LPDP (Ley 29733) — obligatorio para tratar los datos. */
  consentimientoLpdp!: boolean;
  /** Idioma esperado del CV para el parsing (default 'es'). */
  idioma?: string;
}

export class CambiarEstadoCandidatoDto {
  estado!: EstadoCandidato;
}

export class AgregarNotaDto {
  nota!: string;
}

export class ContratarCandidatoDto {
  /** Employee ya creado (D.Leg. 728) al que se vincula el candidato. */
  employeeId!: string;
}

const ESTADOS_CANDIDATO: EstadoCandidato[] = [
  'APLICADO',
  'REVISADO',
  'ENTREVISTA',
  'OFERTA',
  'RECHAZADO',
  'CONTRATADO',
];

const ESTADOS_VACANTE: EstadoVacante[] = ['ABIERTA', 'PAUSADA', 'CERRADA'];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** tenantId/userId son nullables en el contexto; estos endpoints los exigen. */
function requireIdentity(ctx: TenantContext): { tenantId: string; userId: string } {
  if (!ctx.tenantId || !ctx.userId) {
    throw new BadRequestException('Request sin tenant o usuario resuelto');
  }
  return { tenantId: ctx.tenantId, userId: ctx.userId };
}

// ---------------------------------------------------------------------------
// Controller
// ---------------------------------------------------------------------------

@Controller('ats')
@UseGuards(PermissionsGuard)
export class AtsController {
  constructor(
    private readonly vacanteService: VacanteService,
    private readonly candidateService: CandidateService,
    private readonly cvParsingService: CVParsingService,
  ) {}

  /** POST /ats/vacantes — crea una vacante en estado ABIERTA. */
  @Post('vacantes')
  @RequirePermission('ats.manage')
  async crearVacante(@Body() dto: CrearVacanteDto) {
    const ctx = getTenantContext();
    const { tenantId, userId } = requireIdentity(ctx);

    if (!dto.titulo || !dto.descripcion) {
      throw new BadRequestException('titulo y descripcion son obligatorios');
    }

    return this.vacanteService.crearVacante(ctx.tx, {
      tenantId,
      titulo: dto.titulo,
      descripcion: dto.descripcion,
      requisitos: dto.requisitos ?? {},
      salarioMin: dto.salarioMin,
      salarioMax: dto.salarioMax,
      sedeId: dto.sedeId,
      creadoPor: userId,
    });
  }

  /** GET /ats/vacantes — lista las vacantes del tenant (filtro ?estado=). */
  @Get('vacantes')
  @RequirePermission('ats.read')
  async listarVacantes(@Query('estado') estado?: string) {
    const ctx = getTenantContext();
    const { tenantId } = requireIdentity(ctx);

    if (estado && !ESTADOS_VACANTE.includes(estado as EstadoVacante)) {
      throw new BadRequestException(
        `Estado de vacante inválido: "${estado}" (valores: ${ESTADOS_VACANTE.join(', ')})`,
      );
    }

    return this.vacanteService.listarVacantes(ctx.tx, {
      tenantId,
      estado: estado as EstadoVacante | undefined,
    });
  }

  /** PUT /ats/vacantes/:id/cerrar — estado → CERRADA (terminal). */
  @Put('vacantes/:id/cerrar')
  @RequirePermission('ats.manage')
  async cerrarVacante(@Param('id') id: string) {
    const ctx = getTenantContext();
    requireIdentity(ctx);

    return this.vacanteService.cerrarVacante(ctx.tx, id);
  }

  /**
   * POST /ats/vacantes/:id/candidatos — registra un candidato en la vacante.
   * MVP: el CV llega como texto plano en el body; se parsea con Claude
   * (CVParsingService) y el resultado se guarda en cvParseado. Si el parsing
   * falla (CV ilegible o rate limit del tenant), el candidato queda registrado
   * igualmente con cvParseado = null y se devuelve una advertencia — el
   * registro del postulante no debe perderse por un fallo del LLM.
   */
  @Post('vacantes/:id/candidatos')
  @RequirePermission('ats.apply')
  async registrarCandidato(
    @Param('id') vacanteId: string,
    @Body() dto: RegistrarCandidatoDto,
  ) {
    const ctx = getTenantContext();
    const { tenantId } = requireIdentity(ctx);

    if (!dto.nombreCompleto || !dto.email || !dto.cvTexto) {
      throw new BadRequestException(
        'nombreCompleto, email y cvTexto son obligatorios',
      );
    }
    if (dto.consentimientoLpdp !== true) {
      throw new BadRequestException(
        'Se requiere el consentimiento LPDP del candidato (Ley 29733)',
      );
    }

    // Clave MVP en MinIO mientras el CV llega como texto plano en el body.
    const emailNormalizado = dto.email.trim().toLowerCase();
    const cvRutaMinio =
      dto.cvRutaMinio ??
      `cv/${vacanteId}/${encodeURIComponent(emailNormalizado)}.txt`;

    const candidato = await this.candidateService.registrarCandidato(ctx.tx, {
      tenantId,
      vacanteId,
      nombreCompleto: dto.nombreCompleto,
      email: dto.email,
      telefono: dto.telefono,
      cvRutaMinio,
      consentimientoLpdp: dto.consentimientoLpdp,
    });

    let cvParseado: CvParseado | null = null;
    let advertencia: string | undefined;
    try {
      cvParseado = await this.cvParsingService.parsearCv(
        tenantId,
        dto.cvTexto,
        dto.idioma ?? 'es',
      );
    } catch (err) {
      if (err instanceof CvParseError || err instanceof CvRateLimitError) {
        advertencia = `CV no parseado automáticamente: ${err.message}`;
      } else {
        throw err;
      }
    }

    const actualizado = cvParseado
      ? await ctx.tx.candidato.update({
          where: { id: candidato.id },
          // CvParseado es JSON serializable; el cast lo adapta al tipo Json de Prisma
          data: { cvParseado: cvParseado as unknown as Prisma.InputJsonValue },
        })
      : candidato;

    return advertencia ? { ...actualizado, advertencia } : actualizado;
  }

  /**
   * PUT /ats/candidatos/:id/estado — transición del pipeline
   * (APLICADO → REVISADO → ENTREVISTA → OFERTA → CONTRATADO/RECHAZADO).
   */
  @Put('candidatos/:id/estado')
  @RequirePermission('ats.manage')
  async cambiarEstado(
    @Param('id') id: string,
    @Body() dto: CambiarEstadoCandidatoDto,
  ) {
    const ctx = getTenantContext();
    requireIdentity(ctx);

    if (!dto.estado || !ESTADOS_CANDIDATO.includes(dto.estado)) {
      throw new BadRequestException(
        `Estado de candidato inválido: "${dto.estado}" (valores: ${ESTADOS_CANDIDATO.join(', ')})`,
      );
    }

    return this.candidateService.cambiarEstado(ctx.tx, id, dto.estado);
  }

  /** POST /ats/candidatos/:id/notas — nota interna del equipo reclutador. */
  @Post('candidatos/:id/notas')
  @RequirePermission('ats.manage')
  async agregarNota(@Param('id') id: string, @Body() dto: AgregarNotaDto) {
    const ctx = getTenantContext();
    const { userId } = requireIdentity(ctx);

    if (!dto.nota || !dto.nota.trim()) {
      throw new BadRequestException('nota es obligatoria');
    }

    return this.candidateService.agregarNota(ctx.tx, id, userId, dto.nota);
  }

  /**
   * PUT /ats/candidatos/:id/contratar — OFERTA → CONTRATADO y vincula el
   * Employee creado (D.Leg. 728).
   */
  @Put('candidatos/:id/contratar')
  @RequirePermission('ats.manage')
  async contratar(@Param('id') id: string, @Body() dto: ContratarCandidatoDto) {
    const ctx = getTenantContext();
    requireIdentity(ctx);

    if (!dto.employeeId) {
      throw new BadRequestException('employeeId es obligatorio');
    }

    return this.candidateService.contratar(ctx.tx, id, dto.employeeId);
  }
}
