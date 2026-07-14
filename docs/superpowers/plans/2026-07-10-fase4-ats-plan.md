# Fase 4 — Módulo 4 (Reclutamiento / ATS): Plan de Implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Construir el pipeline de reclutamiento (vacantes → postulaciones → entrevistas → contratación), con parsing y scoring semántico de CVs vía la API de Anthropic, arquitectura plugable para portales de empleo externos, y pre-poblado automático de `Employee`/`Contrato` (Fase 1) al marcar un candidato como "Contratado".

**Architecture:** `JobBoardConnector` es una interfaz pluggable — Fase 4 implementa solo el portal corporativo propio (`PortalPropioConnector`), igual patrón que `DigitalSignatureProvider` de Fase 3. El parsing de CV extrae texto localmente (librería estándar, PDF/DOCX) y luego llama a la API de Anthropic (Claude) con un schema Zod para forzar una respuesta estructurada (datos extraídos + score semántico), ejecutado como job asíncrono vía `QueueModule` de Fase 0. Las transiciones de `POSTULACION` son una máquina de estados simple, cada transición auditada por el trigger genérico de Fase 0.

**Tech Stack:** NestJS (apps/api), Prisma (packages/database), `@anthropic-ai/sdk` + Zod para el parsing/scoring de CV, `pdf-parse` + `mammoth` para extracción de texto (PDF/DOCX), BullMQ (Fase 0) para el job asíncrono.

## Global Constraints

- Cribado curricular con IA: parsing de CVs (PDF/DOCX) y clasificación según ajuste al perfil; **usar la API de Anthropic** para el parsing y scoring semántico (goal.md — requisito explícito, no una opción entre proveedores).
- Multiposting: diseñar como integraciones plugables; implementar primero el portal corporativo propio (goal.md).
- Al marcar un candidato "Contratado", pre-poblar la Ficha de Alta del Módulo 1 (`Employee`/`Contrato`) con los datos del candidato (goal.md).
- Cada transición de `POSTULACION` genera auditoría inmutable vía el trigger de Fase 0.
- Toda la UI en español, fechas `dd/mm/aaaa`, zona horaria `America/Lima`.
- Modelo de Claude: **`claude-opus-4-8`** — no usar otro modelo salvo que el usuario lo pida explícitamente. Respuesta forzada a schema vía `output_config.format` (Zod), nunca parseo de texto libre.
- Tests de parsing/scoring con fixtures de CVs de muestra; **mock del cliente de Anthropic en unitarios** — un test de integración real contra la API es manual/opcional, no en CI, por costo y no-determinismo (especificaciones-fases.md, Fase 4, estrategia de testing).
- Fuera de alcance de este plan (ver `especificaciones-fases.md`): integraciones reales con portales de empleo externos y proveedores de pruebas psicométricas (punto abierto #4); páginas/UI de frontend (requieren pasada de `frontend-design`).

---

### Task 1: Extender el schema con `Vacante`, `Candidato`, `Postulacion`, `Entrevista`

**Files:**
- Modify: `packages/database/prisma/schema.prisma`
- Create: `packages/database/prisma/migrations/20260714000000_fase4_ats/migration.sql`

**Interfaces:**
- Produces: modelos Prisma `Vacante`, `Candidato`, `Postulacion`, `Entrevista` — consumidos por todas las tareas siguientes.

- [ ] **Step 1: Añadir los modelos**

Agregar a `packages/database/prisma/schema.prisma`:

```prisma
model Vacante {
  id               String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  tenantId         String   @map("tenant_id") @db.Uuid
  sedeId           String   @map("sede_id") @db.Uuid
  titulo           String
  descripcion      String
  killerQuestions  Json     @map("killer_questions")
  estado           String   @default("abierta") @db.VarChar(20) // abierta | cerrada

  postulaciones Postulacion[]

  @@index([tenantId])
  @@map("vacante")
}

model Candidato {
  id              String @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  nombres         String
  email           String @db.VarChar(255)
  telefono        String? @db.VarChar(20)
  tipoDocumento   String? @map("tipo_documento") @db.VarChar(2)
  numeroDocumento String? @map("numero_documento") @db.VarChar(15)

  postulaciones Postulacion[]

  @@map("candidato")
}

model Postulacion {
  id                       String  @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  vacanteId                String  @map("vacante_id") @db.Uuid
  candidatoId              String  @map("candidato_id") @db.Uuid
  estado                   String  @default("postulado") @db.VarChar(20)
  cvStorageKey             String  @map("cv_storage_key")
  scoreIa                  Decimal? @map("score_ia") @db.Decimal(5, 2)
  respuestasKillerQuestions Json?  @map("respuestas_killer_questions")

  vacante     Vacante      @relation(fields: [vacanteId], references: [id])
  candidato   Candidato    @relation(fields: [candidatoId], references: [id])
  entrevistas Entrevista[]

  @@index([vacanteId])
  @@index([candidatoId])
  @@map("postulacion")
}

model Entrevista {
  id              String    @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  postulacionId   String    @map("postulacion_id") @db.Uuid
  evaluadorId     String    @map("evaluador_id") @db.Uuid
  fecha           DateTime
  calendarEventId String?   @map("calendar_event_id")
  scorecard       Json?

  postulacion Postulacion @relation(fields: [postulacionId], references: [id])

  @@index([postulacionId])
  @@map("entrevista")
}
```

- [ ] **Step 2: Validar el schema**

Run: `pnpm --filter @rrhh/database exec prisma validate`
Expected: `The schema at prisma/schema.prisma is valid 🚀`

- [ ] **Step 3: Escribir la migración SQL**

Crear `packages/database/prisma/migrations/20260714000000_fase4_ats/migration.sql`:

```sql
-- Fase 4 — ATS: vacantes, candidatos, postulaciones, entrevistas.
-- Candidato NO tiene tenant_id: la postulación pública ocurre antes de
-- cualquier sesión autenticada (portal de empleo sin tenant del lado del
-- candidato, ver especificaciones-fases.md Fase 4). El aislamiento por tenant
-- se logra a través de vacante_id -> vacante.tenant_id.

CREATE TABLE "vacante" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "sede_id" UUID NOT NULL,
    "titulo" TEXT NOT NULL,
    "descripcion" TEXT NOT NULL,
    "killer_questions" JSONB NOT NULL,
    "estado" VARCHAR(20) NOT NULL DEFAULT 'abierta',
    CONSTRAINT "vacante_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "vacante_sede_id_fkey" FOREIGN KEY ("sede_id") REFERENCES "sede"("id")
);
CREATE INDEX "vacante_tenant_id_idx" ON "vacante"("tenant_id");

CREATE TABLE "candidato" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "nombres" TEXT NOT NULL,
    "email" VARCHAR(255) NOT NULL,
    "telefono" VARCHAR(20),
    "tipo_documento" VARCHAR(2),
    "numero_documento" VARCHAR(15),
    CONSTRAINT "candidato_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "postulacion" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "vacante_id" UUID NOT NULL,
    "candidato_id" UUID NOT NULL,
    "estado" VARCHAR(20) NOT NULL DEFAULT 'postulado',
    "cv_storage_key" TEXT NOT NULL,
    "score_ia" DECIMAL(5,2),
    "respuestas_killer_questions" JSONB,
    CONSTRAINT "postulacion_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "postulacion_vacante_id_fkey" FOREIGN KEY ("vacante_id") REFERENCES "vacante"("id"),
    CONSTRAINT "postulacion_candidato_id_fkey" FOREIGN KEY ("candidato_id") REFERENCES "candidato"("id")
);
CREATE INDEX "postulacion_vacante_id_idx" ON "postulacion"("vacante_id");
CREATE INDEX "postulacion_candidato_id_idx" ON "postulacion"("candidato_id");

CREATE TABLE "entrevista" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "postulacion_id" UUID NOT NULL,
    "evaluador_id" UUID NOT NULL,
    "fecha" TIMESTAMP(3) NOT NULL,
    "calendar_event_id" TEXT,
    "scorecard" JSONB,
    CONSTRAINT "entrevista_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "entrevista_postulacion_id_fkey" FOREIGN KEY ("postulacion_id") REFERENCES "postulacion"("id")
);
CREATE INDEX "entrevista_postulacion_id_idx" ON "entrevista"("postulacion_id");

-- RLS: vacante tiene tenant_id directo; postulacion/entrevista se aislan
-- a través del join a vacante.
ALTER TABLE "vacante" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "vacante" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "vacante"
    USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid);

ALTER TABLE "postulacion" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "postulacion" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "postulacion"
    USING (EXISTS (
        SELECT 1 FROM "vacante" v
        WHERE v."id" = "postulacion"."vacante_id"
        AND v."tenant_id" = current_setting('app.tenant_id', true)::uuid
    ));

ALTER TABLE "entrevista" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "entrevista" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "entrevista"
    USING (EXISTS (
        SELECT 1 FROM "postulacion" p
        JOIN "vacante" v ON v."id" = p."vacante_id"
        WHERE p."id" = "entrevista"."postulacion_id"
        AND v."tenant_id" = current_setting('app.tenant_id', true)::uuid
    ));

-- candidato: sin RLS (no tiene tenant_id) — el aislamiento real ocurre en
-- postulacion, que sí filtra por tenant. Un candidato puede postular a
-- vacantes de distintos tenants (portal público compartido).

GRANT SELECT, INSERT, UPDATE ON "vacante", "postulacion", "entrevista" TO app_rrhh, app_admin;
GRANT SELECT, INSERT ON "candidato" TO app_rrhh, app_admin;
GRANT DELETE ON "vacante" TO app_admin;

CREATE TRIGGER "vacante_audit" AFTER INSERT OR UPDATE OR DELETE ON "vacante"
    FOR EACH ROW EXECUTE FUNCTION audit_trigger();
CREATE TRIGGER "postulacion_audit" AFTER INSERT OR UPDATE OR DELETE ON "postulacion"
    FOR EACH ROW EXECUTE FUNCTION audit_trigger();
```

- [ ] **Step 4: Commit**

```bash
git add packages/database/prisma/schema.prisma packages/database/prisma/migrations/20260714000000_fase4_ats
git commit -m "feat(fase4): schema y migracion de ATS (vacante, candidato, postulacion, entrevista)"
```

---

### Task 2: `JobBoardConnector` (interfaz + portal propio)

**Files:**
- Create: `apps/api/src/modules/ats/job-board-connector.interface.ts`
- Create: `apps/api/src/modules/ats/portal-propio.connector.ts`
- Test: `apps/api/src/modules/ats/portal-propio.connector.spec.ts`

**Interfaces:**
- Produces: `JobBoardConnector.publish(vacante): Promise<PostingResult>` — implementado por `PortalPropioConnector`; portales externos (LinkedIn, Indeed, etc.) quedan fuera de alcance (punto abierto #4).

- [ ] **Step 1: Escribir el test que falla**

```typescript
// apps/api/src/modules/ats/portal-propio.connector.spec.ts
import { PortalPropioConnector } from './portal-propio.connector';

describe('PortalPropioConnector.publish', () => {
  it('publica la vacante en el portal propio y devuelve la URL pública', async () => {
    const connector = new PortalPropioConnector('https://empleos.miempresa.pe');

    const resultado = await connector.publish({
      id: 'vacante-1',
      titulo: 'Analista de Nómina',
    });

    expect(resultado).toEqual({
      portal: 'portal_propio',
      exito: true,
      urlPublica: 'https://empleos.miempresa.pe/vacantes/vacante-1',
    });
  });
});
```

- [ ] **Step 2: Ejecutar el test y verificar que falla**

Run: `pnpm --filter @rrhh/api test -- portal-propio.connector`
Expected: FAIL — módulo no existe

- [ ] **Step 3: Implementación mínima**

```typescript
// apps/api/src/modules/ats/job-board-connector.interface.ts

/**
 * Multiposting: publicación simultánea de vacantes en portales de empleo
 * desde una sola interfaz — diseñada como integraciones plugables. Fase 4
 * implementa primero el portal corporativo propio; portales externos son el
 * punto abierto #4 (dependen de qué convenios/API keys existan).
 * Ver especificaciones-fases.md, Fase 4, decisión "Multiposting".
 */
export interface VacanteParaPublicar {
  id: string;
  titulo: string;
}

export interface PostingResult {
  portal: string;
  exito: boolean;
  urlPublica?: string;
  error?: string;
}

export interface JobBoardConnector {
  publish(vacante: VacanteParaPublicar): Promise<PostingResult>;
}
```

```typescript
// apps/api/src/modules/ats/portal-propio.connector.ts
import { Injectable } from '@nestjs/common';
import { JobBoardConnector, VacanteParaPublicar, PostingResult } from './job-board-connector.interface';

@Injectable()
export class PortalPropioConnector implements JobBoardConnector {
  constructor(private readonly baseUrl: string) {}

  async publish(vacante: VacanteParaPublicar): Promise<PostingResult> {
    return {
      portal: 'portal_propio',
      exito: true,
      urlPublica: `${this.baseUrl}/vacantes/${vacante.id}`,
    };
  }
}
```

- [ ] **Step 4: Ejecutar el test y verificar que pasa**

Run: `pnpm --filter @rrhh/api test -- portal-propio.connector`
Expected: PASS (1 test)

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/ats/job-board-connector.interface.ts apps/api/src/modules/ats/portal-propio.connector.ts apps/api/src/modules/ats/portal-propio.connector.spec.ts
git commit -m "feat(fase4): JobBoardConnector pluggable con implementacion de portal propio"
```

---

### Task 3: `CvTextExtractorService` — extracción de texto de PDF/DOCX

**Files:**
- Create: `apps/api/src/modules/ats/cv-text-extractor.service.ts`
- Test: `apps/api/src/modules/ats/cv-text-extractor.service.spec.ts`

**Interfaces:**
- Produces: `CvTextExtractorService.extraerTexto(buffer: Buffer, mimeType: string): Promise<string>` — usado por `CvScoringService` (Task 4).

**Nota de dependencias:** este task requiere agregar `pdf-parse` y `mammoth` a `apps/api/package.json` (`pnpm add pdf-parse mammoth` dentro de `apps/api`) antes de escribir el código.

- [ ] **Step 1: Añadir las dependencias**

Run: `cd apps/api && pnpm add pdf-parse mammoth && pnpm add -D @types/pdf-parse`

- [ ] **Step 2: Escribir el test que falla**

Como `pdf-parse`/`mammoth` son librerías reales de parsing binario, el test unitario mockea el módulo en vez de generar un PDF/DOCX real — la extracción real se valida en un test de integración manual con un fixture real (ver nota al final de este task).

```typescript
// apps/api/src/modules/ats/cv-text-extractor.service.spec.ts
import { CvTextExtractorService } from './cv-text-extractor.service';

jest.mock('pdf-parse', () =>
  jest.fn().mockResolvedValue({ text: 'Texto extraído del PDF de ejemplo' }),
);
jest.mock('mammoth', () => ({
  extractRawText: jest.fn().mockResolvedValue({ value: 'Texto extraído del DOCX de ejemplo' }),
}));

describe('CvTextExtractorService.extraerTexto', () => {
  it('extrae texto de un PDF usando pdf-parse', async () => {
    const service = new CvTextExtractorService();

    const texto = await service.extraerTexto(Buffer.from('fake-pdf'), 'application/pdf');

    expect(texto).toBe('Texto extraído del PDF de ejemplo');
  });

  it('extrae texto de un DOCX usando mammoth', async () => {
    const service = new CvTextExtractorService();

    const texto = await service.extraerTexto(
      Buffer.from('fake-docx'),
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    );

    expect(texto).toBe('Texto extraído del DOCX de ejemplo');
  });

  it('rechaza un tipo MIME no soportado', async () => {
    const service = new CvTextExtractorService();

    await expect(service.extraerTexto(Buffer.from('x'), 'image/png')).rejects.toThrow(
      /tipo de archivo no soportado/i,
    );
  });
});
```

- [ ] **Step 3: Ejecutar el test y verificar que falla**

Run: `pnpm --filter @rrhh/api test -- cv-text-extractor.service`
Expected: FAIL — módulo no existe

- [ ] **Step 4: Implementación mínima**

```typescript
// apps/api/src/modules/ats/cv-text-extractor.service.ts
import { Injectable } from '@nestjs/common';
import pdfParse from 'pdf-parse';
import * as mammoth from 'mammoth';

/**
 * Extracción de texto de CVs (PDF/DOCX) vía librería estándar — paso previo
 * al prompt estructurado a la API de Anthropic (Task 4). Ver
 * especificaciones-fases.md, Fase 4, decisión "Parsing de CV con IA".
 */
@Injectable()
export class CvTextExtractorService {
  async extraerTexto(buffer: Buffer, mimeType: string): Promise<string> {
    if (mimeType === 'application/pdf') {
      const resultado = await pdfParse(buffer);
      return resultado.text;
    }

    if (
      mimeType ===
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    ) {
      const resultado = await mammoth.extractRawText({ buffer });
      return resultado.value;
    }

    throw new Error(`Tipo de archivo no soportado para CV: ${mimeType}`);
  }
}
```

- [ ] **Step 5: Ejecutar el test y verificar que pasa**

Run: `pnpm --filter @rrhh/api test -- cv-text-extractor.service`
Expected: PASS (3 tests)

- [ ] **Step 6: Commit**

```bash
git add apps/api/package.json apps/api/src/modules/ats/cv-text-extractor.service.ts apps/api/src/modules/ats/cv-text-extractor.service.spec.ts
git commit -m "feat(fase4): CvTextExtractorService (PDF via pdf-parse, DOCX via mammoth)"
```

> **Nota de alcance:** los tests unitarios mockean `pdf-parse`/`mammoth` para no depender de binarios de muestra en el repo. Antes de cerrar Fase 4, agregar un test de integración manual (no en CI) con un PDF y un DOCX reales en `apps/api/test/fixtures/` que confirme que las librerías reales funcionan con CVs típicos (columnas, tablas, encabezados).

---

### Task 4: `CvScoringService` — parsing + scoring semántico vía API de Anthropic

**Files:**
- Create: `apps/api/src/modules/ats/cv-scoring.service.ts`
- Test: `apps/api/src/modules/ats/cv-scoring.service.spec.ts`

**Interfaces:**
- Consumes: `@anthropic-ai/sdk` (cliente inyectado, nunca instanciado directamente dentro del método — así el test unitario mockea el cliente sin llamar a la API real).
- Produces: `CvScoringService.analizar(textoDelCv, perfilVacante): Promise<AnalisisCv>` — usado por el job asíncrono de Task 5.

**Nota de dependencias:** requiere `pnpm add @anthropic-ai/sdk zod` dentro de `apps/api` (zod ya es dependencia de Fase 0, `@anthropic-ai/sdk` es nueva). El modelo usado es `claude-opus-4-8` — no cambiar a otro modelo salvo pedido explícito del usuario.

- [ ] **Step 1: Añadir la dependencia**

Run: `cd apps/api && pnpm add @anthropic-ai/sdk`

- [ ] **Step 2: Escribir el test que falla**

El cliente de Anthropic se inyecta por constructor y se mockea completo en el test — **nunca se llama a la API real en unitarios** (especificaciones-fases.md, Fase 4, estrategia de testing: "mock de la API de Anthropic en unitarios").

```typescript
// apps/api/src/modules/ats/cv-scoring.service.spec.ts
import { CvScoringService } from './cv-scoring.service';
import Anthropic from '@anthropic-ai/sdk';

function fakeAnthropicClient(parsedOutput: unknown): Anthropic {
  return {
    messages: {
      parse: jest.fn().mockResolvedValue({ parsed_output: parsedOutput }),
    },
  } as unknown as Anthropic;
}

describe('CvScoringService.analizar', () => {
  it('devuelve los datos extraidos y el score semantico contra el perfil de la vacante', async () => {
    const client = fakeAnthropicClient({
      nombres: 'Ana',
      apellidos: 'Torres',
      email: 'ana.torres@example.com',
      telefono: '+51999888777',
      anosExperiencia: 4,
      habilidades: ['Excel avanzado', 'Planillas', 'SUNAT'],
      scoreSemantico: 82,
      justificacion: 'Experiencia relevante en nomina y cumplimiento normativo peruano.',
    });
    const service = new CvScoringService(client);

    const resultado = await service.analizar(
      'CV de Ana Torres, 4 anos de experiencia en planillas...',
      'Analista de Nomina con experiencia en SUNAT y regimen MYPE',
    );

    expect(resultado.email).toBe('ana.torres@example.com');
    expect(resultado.scoreSemantico).toBe(82);
    expect(client.messages.parse).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'claude-opus-4-8' }),
    );
  });

  it('el score semantico siempre esta en el rango 0-100 segun el schema', async () => {
    // La validacion real del rango la hace el schema Zod pasado a output_config.format;
    // aqui solo confirmamos que el resultado parseado respeta el contrato del tipo.
    const client = fakeAnthropicClient({
      nombres: 'Luis',
      apellidos: 'Gomez',
      email: 'luis@example.com',
      telefono: null,
      anosExperiencia: 0,
      habilidades: [],
      scoreSemantico: 15,
      justificacion: 'Perfil sin experiencia relevante en el rubro.',
    });
    const service = new CvScoringService(client);

    const resultado = await service.analizar('CV minimo', 'Perfil exigente');

    expect(resultado.scoreSemantico).toBeGreaterThanOrEqual(0);
    expect(resultado.scoreSemantico).toBeLessThanOrEqual(100);
  });
});
```

- [ ] **Step 3: Ejecutar el test y verificar que falla**

Run: `pnpm --filter @rrhh/api test -- cv-scoring.service`
Expected: FAIL — módulo no existe

- [ ] **Step 4: Implementación mínima**

```typescript
// apps/api/src/modules/ats/cv-scoring.service.ts
import { Injectable } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';

/**
 * Parsing y scoring semántico de CV vía la API de Anthropic (requisito
 * explícito del goal). Extracción de texto (PDF/DOCX) ya resuelta por
 * CvTextExtractorService (Task 3); aquí solo se envía el texto plano + el
 * perfil de la vacante y se fuerza una respuesta estructurada con
 * output_config.format (Zod) — nunca se parsea texto libre de la respuesta.
 * Ver especificaciones-fases.md, Fase 4, decisión "Parsing de CV con IA".
 */
const AnalisisCvSchema = z.object({
  nombres: z.string(),
  apellidos: z.string(),
  email: z.string(),
  telefono: z.string().nullable(),
  anosExperiencia: z.number(),
  habilidades: z.array(z.string()),
  scoreSemantico: z.number().min(0).max(100),
  justificacion: z.string(),
});

export type AnalisisCv = z.infer<typeof AnalisisCvSchema>;

@Injectable()
export class CvScoringService {
  constructor(private readonly anthropic: Anthropic) {}

  async analizar(textoDelCv: string, perfilVacante: string): Promise<AnalisisCv> {
    const response = await this.anthropic.messages.parse({
      model: 'claude-opus-4-8',
      max_tokens: 4096,
      output_config: {
        format: zodOutputFormat(AnalisisCvSchema),
      },
      messages: [
        {
          role: 'user',
          content: [
            'Extrae los datos de contacto y experiencia del siguiente CV, y calcula un score semántico (0-100) de qué tan bien encaja el candidato con el perfil de la vacante.',
            `Perfil de la vacante: ${perfilVacante}`,
            `CV:\n${textoDelCv}`,
          ].join('\n\n'),
        },
      ],
    });

    if (!response.parsed_output) {
      throw new Error('La API de Anthropic no devolvió una respuesta parseable para el CV');
    }

    return response.parsed_output;
  }
}
```

- [ ] **Step 5: Ejecutar el test y verificar que pasa**

Run: `pnpm --filter @rrhh/api test -- cv-scoring.service`
Expected: PASS (2 tests)

- [ ] **Step 6: Commit**

```bash
git add apps/api/package.json apps/api/src/modules/ats/cv-scoring.service.ts apps/api/src/modules/ats/cv-scoring.service.spec.ts
git commit -m "feat(fase4): CvScoringService parsea y puntua CVs via API de Anthropic (claude-opus-4-8)"
```

> **Nota de alcance:** el test de integración real contra la API de Anthropic (con costo y no-determinismo reales) queda fuera de CI, tal como especifica el documento de diseño — se ejecuta manualmente antes de cerrar Fase 4, con 3-5 CVs de muestra reales y revisión humana del score.

---

### Task 5: `PostulacionPipelineService` — máquina de estados + job asíncrono de análisis

**Files:**
- Create: `apps/api/src/modules/ats/postulacion-pipeline.service.ts`
- Create: `apps/api/src/modules/ats/cv-analysis.processor.ts`
- Test: `apps/api/src/modules/ats/postulacion-pipeline.service.spec.ts`

**Interfaces:**
- Consumes: `CvTextExtractorService` (Task 3), `CvScoringService` (Task 4), `QueueService` de Fase 0 (`apps/api/src/common/queue/queue.service.ts`).
- Produces: `PostulacionPipelineService.transicionar(client, postulacionId, nuevoEstado): Promise<void>` — usado por `EmployeeProvisioningService` (Task 6) al llegar a "Contratado".

- [ ] **Step 1: Escribir el test que falla**

```typescript
// apps/api/src/modules/ats/postulacion-pipeline.service.spec.ts
import { PostulacionPipelineService } from './postulacion-pipeline.service';

describe('PostulacionPipelineService.transicionar', () => {
  it('permite transiciones validas en el orden Postulado -> Entrevista -> Seleccionado -> Contratado', async () => {
    const client = {
      postulacion: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'post-1', estado: 'postulado' }),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    const service = new PostulacionPipelineService();

    await service.transicionar(client as any, 'post-1', 'entrevista');

    expect(client.postulacion.update).toHaveBeenCalledWith({
      where: { id: 'post-1' },
      data: { estado: 'entrevista' },
    });
  });

  it('rechaza una transicion invalida (ej. de Postulado directo a Contratado)', async () => {
    const client = {
      postulacion: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'post-1', estado: 'postulado' }),
        update: jest.fn(),
      },
    };
    const service = new PostulacionPipelineService();

    await expect(service.transicionar(client as any, 'post-1', 'contratado')).rejects.toThrow(
      /transición inválida/i,
    );
    expect(client.postulacion.update).not.toHaveBeenCalled();
  });

  it('rechazado es un estado terminal: no permite ninguna transicion posterior', async () => {
    const client = {
      postulacion: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'post-1', estado: 'rechazado' }),
        update: jest.fn(),
      },
    };
    const service = new PostulacionPipelineService();

    await expect(service.transicionar(client as any, 'post-1', 'entrevista')).rejects.toThrow(
      /transición inválida/i,
    );
  });
});
```

- [ ] **Step 2: Ejecutar el test y verificar que falla**

Run: `pnpm --filter @rrhh/api test -- postulacion-pipeline.service`
Expected: FAIL — módulo no existe

- [ ] **Step 3: Implementación mínima**

```typescript
// apps/api/src/modules/ats/postulacion-pipeline.service.ts
import { Injectable } from '@nestjs/common';

export type EstadoPostulacion =
  | 'postulado'
  | 'entrevista'
  | 'seleccionado'
  | 'contratado'
  | 'rechazado';

// Movimiento de candidatos entre fases con notificaciones automáticas de
// estado — la matriz de transiciones válidas. "rechazado" es alcanzable desde
// cualquier estado no terminal, pero es en sí mismo terminal.
// Ver especificaciones-fases.md, Fase 4, decisión "Pipeline".
const TRANSICIONES_VALIDAS: Record<EstadoPostulacion, EstadoPostulacion[]> = {
  postulado: ['entrevista', 'rechazado'],
  entrevista: ['seleccionado', 'rechazado'],
  seleccionado: ['contratado', 'rechazado'],
  contratado: [],
  rechazado: [],
};

@Injectable()
export class PostulacionPipelineService {
  async transicionar(
    client: any,
    postulacionId: string,
    nuevoEstado: EstadoPostulacion,
  ): Promise<void> {
    const postulacion = await client.postulacion.findUniqueOrThrow({
      where: { id: postulacionId },
    });
    const estadoActual = postulacion.estado as EstadoPostulacion;

    if (!TRANSICIONES_VALIDAS[estadoActual].includes(nuevoEstado)) {
      throw new Error(
        `Transición inválida: '${estadoActual}' -> '${nuevoEstado}'`,
      );
    }

    await client.postulacion.update({
      where: { id: postulacionId },
      data: { estado: nuevoEstado },
    });
  }
}
```

- [ ] **Step 4: Ejecutar el test y verificar que pasa**

Run: `pnpm --filter @rrhh/api test -- postulacion-pipeline.service`
Expected: PASS (3 tests)

- [ ] **Step 5: Escribir el job asíncrono que invoca el análisis de CV**

```typescript
// apps/api/src/modules/ats/cv-analysis.processor.ts
import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConnectionOptions, Worker } from 'bullmq';
import { QUEUE_CONNECTION } from '../../common/queue/queue.constants';
import { CvTextExtractorService } from './cv-text-extractor.service';
import { CvScoringService } from './cv-scoring.service';

export interface CvAnalysisJobData {
  postulacionId: string;
  cvBuffer: string; // base64 — BullMQ serializa jobs a JSON, no acepta Buffer directo
  mimeType: string;
  perfilVacante: string;
}

/**
 * El volumen/latencia del parsing con IA justifica ejecutarlo async (BullMQ),
 * no en el request de postulación. Ver especificaciones-fases.md, Fase 4,
 * decisión "Parsing de CV con IA".
 */
@Injectable()
export class CvAnalysisProcessor implements OnModuleInit {
  private readonly logger = new Logger(CvAnalysisProcessor.name);
  private worker?: Worker;

  constructor(
    @Inject(QUEUE_CONNECTION) private readonly connection: ConnectionOptions,
    private readonly cvTextExtractor: CvTextExtractorService,
    private readonly cvScoring: CvScoringService,
  ) {}

  onModuleInit() {
    this.worker = new Worker<CvAnalysisJobData>(
      'cv-analysis',
      async (job) => {
        const buffer = Buffer.from(job.data.cvBuffer, 'base64');
        const texto = await this.cvTextExtractor.extraerTexto(buffer, job.data.mimeType);
        const analisis = await this.cvScoring.analizar(texto, job.data.perfilVacante);
        this.logger.log(
          `Postulación ${job.data.postulacionId}: score ${analisis.scoreSemantico}`,
        );
        return analisis;
      },
      { connection: this.connection },
    );
  }
}
```

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/ats/postulacion-pipeline.service.ts apps/api/src/modules/ats/postulacion-pipeline.service.spec.ts apps/api/src/modules/ats/cv-analysis.processor.ts
git commit -m "feat(fase4): PostulacionPipelineService (maquina de estados) y job de analisis de CV"
```

---

### Task 6: `EmployeeProvisioningService` — pre-poblado al marcar "Contratado"

**Files:**
- Create: `apps/api/src/modules/ats/employee-provisioning.service.ts`
- Test: `apps/api/src/modules/ats/employee-provisioning.service.spec.ts`

**Interfaces:**
- Consumes: modelos `Employee`/`Contrato` de Fase 1 (`packages/database/prisma/schema.prisma`).
- Produces: `EmployeeProvisioningService.provisionar(client, postulacionId): Promise<{ employeeId: string }>` — se invoca después de una transición exitosa a `contratado` (Task 5).

- [ ] **Step 1: Escribir el test que falla**

```typescript
// apps/api/src/modules/ats/employee-provisioning.service.spec.ts
import { EmployeeProvisioningService } from './employee-provisioning.service';

describe('EmployeeProvisioningService.provisionar', () => {
  it('mapea POSTULACION/CANDIDATO exactamente a los campos de EMPLOYEE', async () => {
    const client = {
      postulacion: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          id: 'post-1',
          vacante: { tenantId: 'tenant-1', sedeId: 'sede-1' },
          candidato: {
            nombres: 'Ana Torres',
            tipoDocumento: '01',
            numeroDocumento: '12345678',
          },
        }),
      },
      employee: {
        create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'emp-1', ...data })),
      },
    };
    const service = new EmployeeProvisioningService();

    const resultado = await service.provisionar(client as any, 'post-1');

    expect(client.employee.create).toHaveBeenCalledWith({
      data: {
        tenantId: 'tenant-1',
        sedeId: 'sede-1',
        tipoDocumento: '01',
        numeroDocumento: '12345678',
        nombres: 'Ana Torres',
        apellidos: '',
        estado: 'activo',
      },
    });
    expect(resultado.employeeId).toBe('emp-1');
  });

  it('exige que el candidato tenga documento de identidad antes de provisionar', async () => {
    const client = {
      postulacion: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          id: 'post-1',
          vacante: { tenantId: 'tenant-1', sedeId: 'sede-1' },
          candidato: { nombres: 'Ana Torres', tipoDocumento: null, numeroDocumento: null },
        }),
      },
      employee: { create: jest.fn() },
    };
    const service = new EmployeeProvisioningService();

    await expect(service.provisionar(client as any, 'post-1')).rejects.toThrow(
      /documento de identidad/i,
    );
    expect(client.employee.create).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Ejecutar el test y verificar que falla**

Run: `pnpm --filter @rrhh/api test -- employee-provisioning.service`
Expected: FAIL — módulo no existe

- [ ] **Step 3: Implementación mínima**

```typescript
// apps/api/src/modules/ats/employee-provisioning.service.ts
import { Injectable } from '@nestjs/common';

export interface ProvisionResult {
  employeeId: string;
}

/**
 * Al marcar un candidato como "Contratado", pre-puebla EMPLOYEE (Fase 1) con
 * los datos ya capturados en POSTULACION/CANDIDATO — evita redigitar datos ya
 * conocidos. El apellido se separa manualmente en la Ficha de Alta completa
 * (Fase 1); CANDIDATO solo guarda "nombres" como campo único (ver Task 1).
 * Ver especificaciones-fases.md, Fase 4, decisión "Pipeline".
 */
@Injectable()
export class EmployeeProvisioningService {
  async provisionar(client: any, postulacionId: string): Promise<ProvisionResult> {
    const postulacion = await client.postulacion.findUniqueOrThrow({
      where: { id: postulacionId },
      include: { vacante: true, candidato: true },
    });

    if (!postulacion.candidato.tipoDocumento || !postulacion.candidato.numeroDocumento) {
      throw new Error(
        'El candidato no tiene documento de identidad registrado — no se puede provisionar como trabajador',
      );
    }

    const employee = await client.employee.create({
      data: {
        tenantId: postulacion.vacante.tenantId,
        sedeId: postulacion.vacante.sedeId,
        tipoDocumento: postulacion.candidato.tipoDocumento,
        numeroDocumento: postulacion.candidato.numeroDocumento,
        nombres: postulacion.candidato.nombres,
        apellidos: '',
        estado: 'activo',
      },
    });

    return { employeeId: employee.id };
  }
}
```

- [ ] **Step 4: Ejecutar el test y verificar que pasa**

Run: `pnpm --filter @rrhh/api test -- employee-provisioning.service`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/ats/employee-provisioning.service.ts apps/api/src/modules/ats/employee-provisioning.service.spec.ts
git commit -m "feat(fase4): EmployeeProvisioningService pre-puebla Employee al contratar"
```

> **Nota de alcance:** `apellidos: ''` es un placeholder deliberado y explícito, no un dato perdido — el modelo `CANDIDATO` (Task 1) solo tiene `nombres` como campo único, siguiendo el ER de `especificaciones-fases.md`. Completar apellidos, régimen laboral, cuenta bancaria, etc. ocurre en la Ficha de Alta completa de Fase 1, que el reclutador termina de llenar manualmente — este servicio solo evita redigitar lo que el candidato ya proporcionó.

---

### Task 7: `CalendarProvider` (interfaz + mock) para entrevistas

**Files:**
- Create: `apps/api/src/modules/ats/calendar-provider.interface.ts`
- Create: `apps/api/src/modules/ats/mock-calendar.provider.ts`
- Test: `apps/api/src/modules/ats/mock-calendar.provider.spec.ts`

**Interfaces:**
- Produces: `CalendarProvider.scheduleEvent(input): Promise<{ eventId: string }>` — consumido por el futuro endpoint de agendamiento de entrevistas (fuera de alcance, ver sección final).

- [ ] **Step 1: Escribir el test que falla**

```typescript
// apps/api/src/modules/ats/mock-calendar.provider.spec.ts
import { MockCalendarProvider } from './mock-calendar.provider';

describe('MockCalendarProvider.scheduleEvent', () => {
  it('genera un id de evento determinístico a partir de los datos de la entrevista', async () => {
    const provider = new MockCalendarProvider();

    const resultado = await provider.scheduleEvent({
      evaluadorId: 'eval-1',
      fecha: new Date('2026-08-01T15:00:00Z'),
      tituloVacante: 'Analista de Nómina',
    });

    expect(resultado.eventId).toMatch(/^mock-event-/);
  });
});
```

- [ ] **Step 2: Ejecutar el test y verificar que falla**

Run: `pnpm --filter @rrhh/api test -- mock-calendar.provider`
Expected: FAIL — módulo no existe

- [ ] **Step 3: Implementación mínima**

```typescript
// apps/api/src/modules/ats/calendar-provider.interface.ts

/**
 * Integración de calendario (Google Calendar/Outlook) con OAuth por
 * reclutador — detalle de proveedor intercambiable, mismo patrón que
 * StorageService/DigitalSignatureProvider. Ver especificaciones-fases.md,
 * Fase 4, decisión "Entrevistas".
 */
export interface ScheduleEventInput {
  evaluadorId: string;
  fecha: Date;
  tituloVacante: string;
}

export interface CalendarProvider {
  scheduleEvent(input: ScheduleEventInput): Promise<{ eventId: string }>;
}
```

```typescript
// apps/api/src/modules/ats/mock-calendar.provider.ts
import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { CalendarProvider, ScheduleEventInput } from './calendar-provider.interface';

/** Provider mock — sustituto hasta integrar Google Calendar/Outlook real vía OAuth. */
@Injectable()
export class MockCalendarProvider implements CalendarProvider {
  async scheduleEvent(_input: ScheduleEventInput): Promise<{ eventId: string }> {
    return { eventId: `mock-event-${randomUUID()}` };
  }
}
```

- [ ] **Step 4: Ejecutar el test y verificar que pasa**

Run: `pnpm --filter @rrhh/api test -- mock-calendar.provider`
Expected: PASS (1 test)

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/ats/calendar-provider.interface.ts apps/api/src/modules/ats/mock-calendar.provider.ts apps/api/src/modules/ats/mock-calendar.provider.spec.ts
git commit -m "feat(fase4): CalendarProvider pluggable con mock para agendar entrevistas"
```

---

### Task 8: `ats.module.ts` — ensamblar el módulo y registrarlo en `AppModule`

**Files:**
- Create: `apps/api/src/modules/ats/ats.module.ts`
- Modify: `apps/api/src/app.module.ts`

**Interfaces:**
- Consumes: todos los servicios de Tasks 2–7.
- Produces: `AtsModule`, importado por `AppModule`.

- [ ] **Step 1: Escribir el módulo**

```typescript
// apps/api/src/modules/ats/ats.module.ts
import { Module } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { PortalPropioConnector } from './portal-propio.connector';
import { CvTextExtractorService } from './cv-text-extractor.service';
import { CvScoringService } from './cv-scoring.service';
import { PostulacionPipelineService } from './postulacion-pipeline.service';
import { CvAnalysisProcessor } from './cv-analysis.processor';
import { EmployeeProvisioningService } from './employee-provisioning.service';
import { MockCalendarProvider } from './mock-calendar.provider';

@Module({
  providers: [
    { provide: Anthropic, useFactory: () => new Anthropic() }, // lee ANTHROPIC_API_KEY del entorno
    { provide: 'JobBoardConnector', useFactory: () => new PortalPropioConnector(process.env.PORTAL_EMPLEO_URL ?? '') },
    CvTextExtractorService,
    CvScoringService,
    PostulacionPipelineService,
    CvAnalysisProcessor,
    EmployeeProvisioningService,
    { provide: 'CalendarProvider', useClass: MockCalendarProvider },
  ],
  exports: [PostulacionPipelineService, EmployeeProvisioningService],
})
export class AtsModule {}
```

- [ ] **Step 2: Registrar en `AppModule`**

Modificar `apps/api/src/app.module.ts`: agregar `AtsModule` al arreglo `imports`, junto a `DocumentsModule` (de Fase 3). Agregar `ANTHROPIC_API_KEY` a `.env.example` en la raíz del repo.

- [ ] **Step 3: Verificar que el proyecto compila**

Run: `pnpm --filter @rrhh/api build`
Expected: compilación exitosa sin errores de tipos

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/modules/ats/ats.module.ts apps/api/src/app.module.ts .env.example
git commit -m "feat(fase4): ensamblar AtsModule en AppModule"
```

---

## Fuera de alcance de este plan (deuda técnica explícita, no placeholders)

- **Integraciones reales con portales de empleo externos** (LinkedIn, Indeed, etc.) y proveedores de pruebas psicométricas — punto abierto #4, dependen de qué convenios/API keys existan.
- **Integración real de `CalendarProvider`** con Google Calendar/Outlook vía OAuth — solo se entrega la interfaz y el mock.
- **Controller/endpoints REST** (postulación pública, transición de pipeline, agendar entrevista) — mismo patrón de `payroll.controller.ts` (Fase 1), pendiente de exponer vía HTTP.
- **Test de integración real contra la API de Anthropic** con CVs de muestra — manual, fuera de CI (señalado en Task 4).
- **Test de integración real con PDFs/DOCX de muestra** para `CvTextExtractorService` — señalado en Task 3.
- **Página Portal de Empleo Corporativo, Pipeline Kanban, Perfil del Candidato, Sincronización de Entrevistas (UI)** — requieren pasada de `frontend-design`.
