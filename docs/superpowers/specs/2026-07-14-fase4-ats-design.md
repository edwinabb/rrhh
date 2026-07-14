# HRMS Peru - Fase 4: ATS MVP Specification

**Version:** 1.0  
**Date:** 2026-07-14  
**Status:** Specification (Design Phase)

---

## Descripción General

ATS MVP es un módulo de Recruitment integrado al HRMS peruano. Permite a departamentos de RRHH gestionar posiciones vacantes, recibir candidaturas vía upload de CV, parsear automáticamente la información con Claude Opus, y gestionar el pipeline de candidatos hasta oferta o rechazo.

El sistema es multi-tenant con Row Level Security (RLS), operando sobre PostgreSQL 16 vía Prisma ORM. Los CVs se procesan con Claude API (Opus 4.8) para extraer estructurado nombre, experiencia, habilidades, formación e idiomas. Los candidatos se crean automáticamente en BD con datos parseados y pueden ser anotados por RRHH/Managers.

**Stack técnico:** NestJS 10+ · TypeScript · Prisma 5+ · PostgreSQL 16 · Claude Opus 4.8 · Jest · MinIO (cloud storage)

---

## Scope MVP

### Funcionalidades Incluidas

- CRUD Vacantes (crear, listar, editar, cerrar)
- Upload de CV (PDF, DOCX, TXT)
- Parsing automático con Claude API
- Auto-creación de Candidatos en BD
- Listado de candidatos por posición con estados
- Estado de candidato: Aplicado → Revisado → Entrevista → Oferta → Contratado / Rechazado
- Notas y comentarios internos (timestamp, autor)
- Descarga de CV parseado (JSON)
- Listado de posiciones abiertas (vista pública/candidatos)
- Notificaciones básicas (nueva aplicación para RRHH)

### Out of Scope (Fase 5+)

- Scoring automático de candidatos
- Pipeline visual (Kanban)
- Cálculo automático de salarios / ofertas
- Integraciones LinkedIn, Indeed, portales headhunters
- Video interview recording/análisis
- Background checks API

---

## Modelos Prisma

Tres entidades core: Vacante (posición laboral), Candidato (aplicante), CandidatoNota (auditoría interna).

### 1. Modelo Vacante

```prisma
model Vacante {
  id                String   @id @default(cuid())
  tenantId          String   // Multi-tenant RLS
  titulo            String   // Ej: "Senior Backend Engineer"
  descripcion       String   @db.Text
  requisitos        String   @db.Text // Habilidades requeridas
  salarioMin        Float?
  salarioMax        Float?
  moneda            String   @default("PEN") // Soles
  departamento      String?  // Ej: "Ingeniería"
  manager           String?  // userId del responsable
  estado            String   @default("abierta") // abierta | cerrada | pausada
  creadoPor         String   // userId
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt
  publicada         Boolean  @default(false)
  fechaPublicacion  DateTime?

  candidatos        Candidato[]

  @@index([tenantId])
  @@index([estado])
}
```

### 2. Modelo Candidato

```prisma
model Candidato {
  id                  String   @id @default(cuid())
  tenantId            String   // Multi-tenant RLS
  vacanteId           String
  nombre              String
  email               String   @unique // Validado único por tenant
  telefono            String?

  // Datos parseados desde CV
  experiencia         Json?    // Array de {empresa, rol, años, desde, hasta}
  habilidades         String[] // Array de habilidades técnicas
  formacion           Json?    // Array de {titulo, institucion, año}
  idiomas             String[] // ["Español", "Inglés"]
  resumenCV           String?  @db.Text // Resumen parseado

  // Archivos
  cvOriginalUrl       String?  // MinIO: s3://bucket/tenant/candidate/{id}/cv
  cvParsedJson        Json?    // JSON completo del parsing

  // Pipeline
  estado              String   @default("aplicado") // aplicado | revisado | entrevista | oferta | contratado | rechazado
  razonRechazo        String?  // Si estado = rechazado

  aplicadoEn          DateTime @default(now())
  updatedAt           DateTime @updatedAt

  notas               CandidatoNota[]

  @@unique([tenantId, email, vacanteId])
  @@index([tenantId])
  @@index([estado])
  @@index([vacanteId])
}
```

### 3. Modelo CandidatoNota

```prisma
model CandidatoNota {
  id          String   @id @default(cuid())
  candidatoId String
  contenido   String   @db.Text
  creador     String   // userId de RRHH/Manager
  createdAt   DateTime @default(now())

  candidato   Candidato @relation(fields: [candidatoId], references: [id], onDelete: Cascade)

  @@index([candidatoId])
}
```

**Nota de Migración D.Leg. 728:** Cuando un candidato pasa a estado "contratado", se activa un hook que crea un registro Employee en la tabla employees. El Candidato mantiene referencia histórica via tenantId. Nuevos campos en Employee: candidatoId (FK), pasaporte (nullable), fecha_inicio_contrato, etc.

---

## Servicios Core

Tres servicios encapsulan lógica de negocio. CVParsingService orquesta llamadas a Claude. CandidateService y VacanteService manejan CRUD y estado.

### 1. CVParsingService

```typescript
export class CVParsingService {
  constructor(
    private anthropic: Anthropic,
    private prisma: PrismaService,
    private storage: CloudStorageService,
  ) {}

  // Parsea CV (PDF/DOCX/TXT) → extrae JSON estructurado
  async parseCVWithClaude(
    fileBuffer: Buffer,
    fileName: string,
    vacanteId: string,
  ): Promise<ParsedCV> {
    // 1. Convertir PDF/DOCX a texto (pdfparse, docxtemplater)
    // 2. Validar tamaño (máx 5MB)
    // 3. Llamar Claude API
    // 4. Validar respuesta JSON
    // 5. Retornar objeto ParsedCV
  }

  // Almacenar CV original en MinIO
  async storeCVOriginal(
    fileBuffer: Buffer,
    tenantId: string,
    candidatoId: string,
  ): Promise<string>
}
```

#### ParsedCV Interface

```typescript
interface ParsedCV {
  nombre: string;
  email?: string;
  telefono?: string;
  experiencia: {
    empresa: string;
    rol: string;
    años: number;
    desde: string;
    hasta?: string;
  }[];
  habilidades: string[];
  formacion: {
    titulo: string;
    institucion: string;
    año: number;
  }[];
  idiomas: string[];
  resumen: string;
}
```

### 2. CandidateService

```typescript
export class CandidateService {
  async createFromParsedCV(
    vacanteId: string,
    parsed: ParsedCV,
    cvOriginalUrl: string,
    tenantId: string,
  ): Promise<Candidato>

  async getCandidatesByVacante(
    vacanteId: string,
    tenantId: string,
    filters?: { estado?: string; skip?: number; take?: number },
  ): Promise<Candidato[]>

  async updateCandidateState(
    candidatoId: string,
    nuevoEstado: string,
    razonRechazo?: string,
    tenantId?: string,
  ): Promise<Candidato>

  async addNote(
    candidatoId: string,
    contenido: string,
    creadorId: string,
  ): Promise<CandidatoNota>

  async getParsedCVJson(
    candidatoId: string,
  ): Promise<Json>
}
```

### 3. VacanteService

```typescript
export class VacanteService {
  async createVacante(
    input: CreateVacanteDto,
    tenantId: string,
  ): Promise<Vacante>

  async getVacantesByTenant(
    tenantId: string,
    filters?: { estado?: string; },
  ): Promise<Vacante[]>

  async publishVacante(
    vacanteId: string,
    tenantId: string,
  ): Promise<Vacante>

  async closeVacante(
    vacanteId: string,
    tenantId: string,
  ): Promise<Vacante>

  async getOpenVacantes(
    tenantId: string,
  ): Promise<Vacante[]>
}
```

---

## Controllers & REST Endpoints

Dos controllers: AtsVacanteController (gestión posiciones) y AtsCVController (upload/parsing).

### AtsVacanteController

| Endpoint | Método | Descripción | Auth |
|----------|--------|-------------|------|
| `/ats/vacantes` | POST | Crear posición vacante | RRHH |
| `/ats/vacantes` | GET | Listar vacantes (por tenant) | RRHH |
| `/ats/vacantes/{id}` | GET | Obtener detalle de vacante | RRHH |
| `/ats/vacantes/{id}` | PATCH | Editar vacante (antes publicar) | RRHH |
| `/ats/vacantes/{id}/publish` | POST | Publicar vacante (visible candidatos) | RRHH |
| `/ats/vacantes/{id}/close` | POST | Cerrar vacante (no más aplicaciones) | RRHH |
| `/ats/vacantes/public` | GET | Listar vacantes abiertas (público) | Public |

### AtsCVController

| Endpoint | Método | Descripción | Auth |
|----------|--------|-------------|------|
| `/ats/cv/upload` | POST | Upload CV + parsing automático | Public/Candidato |
| `/ats/candidatos/{vacanteId}` | GET | Listar candidatos por posición | RRHH |
| `/ats/candidatos/{id}` | GET | Obtener detalle candidato | RRHH |
| `/ats/candidatos/{id}/estado` | PATCH | Cambiar estado (revisado, entrevista, oferta, etc) | RRHH |
| `/ats/candidatos/{id}/notas` | POST | Agregar nota interna | RRHH |
| `/ats/candidatos/{id}/cv/parsed` | GET | Descargar CV parseado (JSON) | RRHH |

### Upload CV Payload

```http
POST /ats/cv/upload

Content-Type: multipart/form-data
{
  file: File (PDF | DOCX | TXT, máx 5MB)
  vacanteId: string
  email: string (opcional, puede extraerse del CV)
  tenantId?: string (sí autenticado; omitir si público)
}

Response 201:
{
  candidatoId: string
  nombre: string
  email: string
  experiencia: [...],
  habilidades: [...],
  formacion: [...],
  idiomas: [...]
}
```

**Nota sobre RRHH auth:** Guards de NestJS validan roles. Se asume un usuario de tenant con rol "rrhh" o "admin". Public endpoints no requieren autenticación pero sí tenantId explícito o deducido.

---

## Claude API Integration

CVParsingService llama Claude Opus 4.8 para extraer datos de CV. Manejo robusto de errores, rate limiting y validación.

### Prompt de Parsing

```
"Eres un experto en parsing de CVs. Analiza el siguiente CV y extrae:
nombre completo, email, teléfono, experiencia laboral
(empresa, rol, años en puesto, fecha inicio, fecha fin),
habilidades técnicas, formación académica (título, institución, año),
idiomas, y un resumen breve.

Retorna ÚNICAMENTE un JSON válido (sin markdown) con esta estructura:
{
  "nombre": "string",
  "email": "string o null",
  "telefono": "string o null",
  "experiencia": [
    {
      "empresa": "string",
      "rol": "string",
      "años": number,
      "desde": "YYYY-MM-DD o null",
      "hasta": "YYYY-MM-DD o null"
    }
  ],
  "habilidades": ["string"],
  "formacion": [
    {
      "titulo": "string",
      "institucion": "string",
      "año": number
    }
  ],
  "idiomas": ["string"],
  "resumen": "string (máx 500 caracteres)"
}

CV a procesar:
[CV_TEXT_HERE]"
```

### Llamada a API

```typescript
const response = await anthropic.messages.create({
  model: "claude-opus-4-8-20250514",
  max_tokens: 2048,
  messages: [
    {
      role: "user",
      content: prompt,
    },
  ],
});

const content = response.content[0].text;
const parsed = JSON.parse(content);
```

### Error Handling

```typescript
// Rate Limiting (Redis)
const key = `cv-parsing:${tenantId}`;
const count = await redis.incr(key);
if (count > 100) // máx 100/hora
  throw new TooManyRequestsException();

try {
  const parsed = JSON.parse(claudeResponse);
  // Validar schema
  if (!parsed.nombre) throw new Error();
  return parsed;
} catch (e) {
  throw new BadRequestException(
    'CV no válido o Claude no pudo procesarlo',
  );
}
```

**Pricing:** Opus 4.8 cuesta ~$3 USD / 1M input tokens, ~$15 / 1M output. Un CV típico = 500-2000 tokens input + 200 tokens output = ~$0.002-0.005 por CV. Considerar cache para re-queries.

**Validación Datos Parseados:** Claude no siempre genera JSON válido o con estructura exacta. Implementar schema validator (Zod, Joi) y fallback humanizado si falla parsing.

---

## Security & Validación

Requisitos de seguridad: RLS multi-tenant, validación de archivos, rate limiting, y consentimiento GDPR/privacidad peruana.

### Row Level Security (RLS)

```sql
-- En PostgreSQL:
CREATE POLICY "Usuarios ven solo su tenant"
  ON Vacante
  USING (tenantId = current_setting('app.tenantId'));
```

```typescript
// En NestJS (middleware):
export class TenantMiddleware {
  use(req, res, next) {
    const tenantId = req.user.tenantId;
    prisma.$queryRaw`SET app.tenantId = ${tenantId}`;
  }
}
```

### Validación de Upload

- **Tipos permitidos:** application/pdf, application/vnd.openxmlformats-officedocument.wordprocessingml.document, text/plain
- **Tamaño máximo:** 5 MB
- **Escaneo de malware:** Considerar ClamAV o VirusTotal API
- **Validar estructura:** Rechazar archivos corruptos

### Rate Limiting

```typescript
// CV Parsing: máx 100 por hora, por tenant
@UseGuards(RateLimitGuard)
@RateLimit({ keyPrefix: 'cv-parsing', limit: 100, window: 3600 })
@Post('upload')
async uploadCV(@UploadedFile() file) { }

// General API: 1000 req/10min por IP
export const globalRateLimitMiddleware = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 1000,
});
```

### Consentimiento & Privacidad (Ley Peruana)

- **Ley de Protección de Datos Personales (LPDP):** Obtener consentimiento explícito del candidato antes de procesar CV
- **D.Leg. 728:** Si candidato es contratado, datos migran a módulo Employee; mantener auditoría
- **PDPA Consent Flow:**
  1. Candidato ve checkbox: "Consiento en que mi CV sea procesado con IA"
  2. Guardar consentimiento en DB (timestamp, versión de política)
  3. Solo procesar si consentimiento = true

### Otros Controles

- **Email validado:** Unique por (tenantId, email, vacanteId)
- **Descarga de CV parseado:** Solo RRHH del mismo tenant, con auditoría
- **Notas internas:** Cifradas en reposo (considerar field-level encryption)
- **Retención de datos:** CVs originales borrados 12 meses post-cierre de vacante (compliance)

---

## Casos de Prueba (TDD)

Jerarquía de tests: Unit (servicios) → Integration (controllers + BD) → E2E (workflows completos).

### CVParsingService Unit Tests

```typescript
describe('CVParsingService', () => {
  let service: CVParsingService;
  let mockClaude: Anthropic;
  let mockPrisma: PrismaService;

  it('debe parsear CV válido y retornar JSON', async () => {
    const buffer = Buffer.from('CV text...');
    const result = await service.parseCVWithClaude(buffer, 'test.pdf', 'vac-123');
    expect(result.nombre).toBeDefined();
    expect(result.experiencia).toBeInstanceOf(Array);
  });

  it('debe rechazar archivos > 5MB', async () => {
    const buffer = Buffer.alloc(6 * 1024 * 1024);
    await expect(service.parseCVWithClaude(buffer, ...))
      .rejects.toThrow(BadRequestException);
  });

  it('debe manejar errores de Claude API', async () => {
    mockClaude.messages.create = jest.fn()
      .mockRejectedValue(new Error('API Error'));
    await expect(service.parseCVWithClaude(...))
      .rejects.toThrow();
  });

  it('debe aplicar rate limit: máx 100/hora', async () => {
    // Simular 101 requests en 1 hora
    for (let i = 0; i < 101; i++) {
      if (i === 100) {
        await expect(service.parseCVWithClaude(...))
          .rejects.toThrow(TooManyRequestsException);
      }
    }
  });
});
```

### CandidateService Unit Tests

```typescript
describe('CandidateService', () => {
  it('debe crear candidato desde CV parseado', async () => {
    const parsed = { nombre: 'Juan Perez', ... };
    const candidate = await service.createFromParsedCV(
      'vac-123', parsed, 's3://url', 'tenant-1'
    );
    expect(candidate.nombre).toBe('Juan Perez');
    expect(candidate.estado).toBe('aplicado');
  });

  it('debe rechazar email duplicado en misma vacante', async () => {
    await service.createFromParsedCV('vac-1', { email: 'test@test.com', ... });
    await expect(service.createFromParsedCV('vac-1', { email: 'test@test.com', ... }))
      .rejects.toThrow(ConflictException);
  });

  it('debe cambiar estado: aplicado → revisado → entrevista → oferta', async () => {
    let cand = await service.createFromParsedCV(...);
    cand = await service.updateCandidateState(cand.id, 'revisado');
    expect(cand.estado).toBe('revisado');
  });

  it('debe requerir razonRechazo si estado = rechazado', async () => {
    await expect(service.updateCandidateState(cand.id, 'rechazado'))
      .rejects.toThrow('razonRechazo es requerido');
  });

  it('debe agregar nota y guardar creadorId + timestamp', async () => {
    const nota = await service.addNote(cand.id, 'Candidato promisorio', 'user-rrhh-1');
    expect(nota.creador).toBe('user-rrhh-1');
    expect(nota.createdAt).toBeDefined();
  });
});
```

### VacanteService Unit Tests

```typescript
describe('VacanteService', () => {
  it('debe crear vacante con validación de campos requeridos', async () => {
    const input = { titulo: 'Senior Dev', descripcion: '...', requisitos: '...' };
    const vacante = await service.createVacante(input, 'tenant-1');
    expect(vacante.titulo).toBe('Senior Dev');
  });

  it('debe publishar vacante y hacerla visible en listado público', async () => {
    const vacante = await service.createVacante(...);
    const published = await service.publishVacante(vacante.id, 'tenant-1');
    expect(published.publicada).toBe(true);
    expect(published.fechaPublicacion).toBeDefined();
  });

  it('debe listar solo vacantes abiertas (estado=abierta, publicada=true)', async () => {
    const open = await service.getOpenVacantes('tenant-1');
    expect(open.every(v => v.estado === 'abierta' && v.publicada)).toBe(true);
  });
});
```

### Integration Tests (Controllers)

```typescript
describe('AtsCVController (Integration)', () => {
  it('POST /ats/cv/upload debe parsear y crear candidato', async () => {
    const response = await request(app.getHttpServer())
      .post('/ats/cv/upload')
      .attach('file', './test.pdf')
      .field('vacanteId', 'vac-123');

    expect(response.status).toBe(201);
    expect(response.body.candidatoId).toBeDefined();
    expect(response.body.nombre).toBeDefined();
  });

  it('GET /ats/candidatos/{vacanteId} lista solo candidatos autenticados', async () => {
    const response = await request(app.getHttpServer())
      .get('/ats/candidatos/vac-123')
      .set('Authorization', `Bearer ${rrhh_token}`);

    expect(response.status).toBe(200);
    expect(Array.isArray(response.body)).toBe(true);
  });
});
```

### E2E Workflow Test

```typescript
describe('ATS E2E: Complete Hiring Flow', () => {
  it('Vacante → Upload CV → Parse → Candidato → Estado → Notas', async () => {
    // 1. Create vacante
    const vacante = await vacanteService.createVacante(...);

    // 2. Upload + Parse CV
    const candidato = await request(app.getHttpServer())
      .post('/ats/cv/upload')
      .attach('file', cvBuffer);

    expect(candidato.status).toBe(201);

    // 3. Update state
    const updated = await candidateService.updateCandidateState(
      candidato.body.candidatoId, 'revisado'
    );

    // 4. Add note
    await candidateService.addNote(candidato.body.candidatoId, 'Entrevista programada', userId);

    // 5. Verify
    const final = await candidateService.getCandidatesByVacante(vacante.id);
    expect(final.length).toBe(1);
    expect(final[0].estado).toBe('revisado');
  });
});
```

---

## Normativa Peruana & Compliance

Consideraciones legales para HRMS peruano. Énfasis en privacidad, contratación y derechos laborales.

### 1. Ley de Protección de Datos Personales (LPDP)

- **Consentimiento explícito:** Candidato debe consentir procesamiento de CV con IA antes de upload
- **Propósito delimitado:** Datos solo para evaluación de candidatura; no puede reutilizarse sin consentimiento adicional
- **Derecho al olvido:** Si candidato solicita, borrar CV + datos parseados en 30 días
- **Reporte de brechas:** Si ocurre compromiso de datos (ej: leak CV), notificar a Autoridad de Protección en 72h

### 2. D.Leg. 728 (Ley de Relaciones Laborales)

- **Aplicación de candidato:** Crea relación pre-contractual; empresa tiene deber de trato justo
- **Rechazo justificado:** Si candidato rechazado apela, empresa debe poder justificar (guardar criterios, notas)
- **Transición a empleado:** Si candidato es aceptado:
  1. Crear registro Employee en tabla employees
  2. Heredar datos: nombre, email, experiencia, formación
  3. Mantener FK candidatoId en Employee (auditoría)
  4. Iniciar módulo de nómina, beneficios, contrato

### 3. Protección Contra Discriminación

- **Prohibido:** Discriminar por edad, género, raza, religión, discapacidad, orientación sexual
- **En ATS:** No usar Claude para scoring basado en estos atributos
- **Auditoría:** Registrar quién rechaza a cada candidato, motivo, para auditoría interna

### 4. Conservación de Registros

- **CVs originales:** Guardar mín. 12 meses post-cierre vacante (auditoría laboral)
- **Datos parseados:** Mantener indefinidamente si contratado (pase a Employee); 12 meses si no
- **Notas de RRHH:** Auditoría inmutable (timestamp, autor), retención 3 años

### 5. LGPD Peruana vs GDPR

| Concepto | LPDP Peru | Nota para GDPR (si EU candidatos) |
|----------|-----------|-----------------------------------|
| Consentimiento | Explícito, anterior al procesamiento | Idem GDPR; más estricto para EU citizens |
| Derecho acceso | Sí, en 15 días | Sí, en 30 días (GDPR) |
| Portabilidad datos | Sí, formato máquina-legible | Sí, GDPR Art. 20 |
| Borrado | Sí, bajo condiciones | Sí, con excepciones (GDPR Art. 17) |

**Recomendación:** Implementar feature de "Data Subject Request" (DSR) en admin panel: candidatos pueden solicitar acceso/borrado, RRHH genera reporte de datos y procesa en plazo.

---

## Próximas Fases (Roadmap)

### Fase 5: Scoring & Pipeline Visual
Scoring automático con reglas configurables, Kanban visual, webhooks para cambios de estado.

### Fase 6: Integraciones Externas
LinkedIn Recruiting API, Indeed, portales headhunters, sincronización de postulaciones.

### Fase 7: Oferta & Onboarding
Generación de ofertas, firma digital e-DNI, transición automática a Employee con nómina.

---

**Especificación Formal - ATS MVP**  
Designed for production NestJS + Prisma + Claude deployment  
Ready for TDD implementation and team handoff
