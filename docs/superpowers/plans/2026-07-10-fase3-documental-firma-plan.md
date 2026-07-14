# Fase 3 — Módulo 3 (Gestión Documental y Firma Digital Certificada): Plan de Implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Construir el legajo digital del colaborador (documentos con retención diferenciada por sección), el flujo de firma masiva detrás de una interfaz de proveedor abstracta, y el portal de autoservicio (ESS) con su flujo de solicitud de actualización de datos.

**Architecture:** `DocumentoService` calcula la fecha de expiración de retención al crear el documento (nunca al leerlo) y delega el almacenamiento físico a `StorageService` de Fase 0 (MinIO). La firma es una interfaz `DigitalSignatureProvider` — Fase 3 entrega la interfaz + un provider mock, el proveedor real acreditado en Perú es una decisión comercial pendiente (punto abierto #2). El portal ESS reutiliza el mismo patrón "propuesta + sustento + aprobador" que `MarcacionCorreccionService` de Fase 2, ahora para `SolicitudActualizacion`.

**Tech Stack:** NestJS (apps/api), Prisma (packages/database), `StorageService`/`QueueModule` de Fase 0, `crypto` (Node) para hash de verificación de firma.

## Global Constraints

- Retención documental: hasta 20 años para registros de salud ocupacional; 5 años mínimo para asistencia y contratos exportables ante inspector. (goal.md)
- Ningún borrado automático de documentos vencidos — solo se marcan para revisión humana (riesgo legal de borrado automático incorrecto). (especificaciones-fases.md, Fase 3)
- Firma electrónica y digital: garantizar autenticidad, integridad y no repudio; arquitectura con interfaz abstracta para el proveedor (Ley N.º 27269). (goal.md)
- RBAC de fila/columna ya definido en Fase 0 rige qué secciones del legajo puede ver cada rol — un jefe de área NUNCA ve Salud/Remuneraciones de sus reportes. (goal.md, diseño Fase 0)
- Toda operación sobre `DOCUMENTO`/`FIRMA`/`SOLICITUD_ACTUALIZACION` genera auditoría inmutable (mismo trigger de Fase 0).
- Toda la UI en español, fechas `dd/mm/aaaa`, zona horaria `America/Lima`. (goal.md)
- Fuera de alcance de este plan (ver `especificaciones-fases.md`): selección e integración real de un proveedor de certificados digitales (punto abierto #2, implica contrato comercial); multiposting de portales de empleo (Fase 4); páginas/UI de frontend (requieren pasada de `frontend-design`).

---

### Task 1: Extender el schema con `DOCUMENTO`, `FIRMA`, `SOLICITUD_ACTUALIZACION`

**Files:**
- Modify: `packages/database/prisma/schema.prisma`
- Create: `packages/database/prisma/migrations/20260713000000_fase3_documental/migration.sql`

**Interfaces:**
- Produces: modelos Prisma `Documento`, `Firma`, `SolicitudActualizacion` — consumidos por todas las tareas siguientes.

- [ ] **Step 1: Añadir los modelos**

Agregar a `packages/database/prisma/schema.prisma`:

```prisma
model Documento {
  id                      String    @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  tenantId                String    @map("tenant_id") @db.Uuid
  employeeId              String    @map("employee_id") @db.Uuid
  seccion                 String    @db.VarChar(20) // identificacion|contratos|sst|remuneraciones|salud
  tipo                    String    @db.VarChar(50)
  storageKey              String    @map("storage_key")
  storageVersion          String    @map("storage_version")
  estadoFirma             String    @default("pendiente") @map("estado_firma") @db.VarChar(20)
  fechaExpiracionRetencion DateTime @map("fecha_expiracion_retencion") @db.Date
  createdAt               DateTime  @default(now()) @map("created_at")

  employee Employee @relation(fields: [employeeId], references: [id])
  firmas   Firma[]

  @@index([tenantId])
  @@index([employeeId, seccion])
  @@map("documento")
}

model Firma {
  id           String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  documentoId  String   @map("documento_id") @db.Uuid
  firmanteId   String   @map("firmante_id") @db.Uuid
  proveedor    String   @db.VarChar(30)
  hashFirma    String   @map("hash_firma") @db.VarChar(64)
  timestamp    DateTime @default(now())
  estado       String   @default("vigente") @db.VarChar(20) // vigente | revocada

  documento Documento @relation(fields: [documentoId], references: [id], onDelete: Cascade)

  @@index([documentoId])
  @@map("firma")
}

model SolicitudActualizacion {
  id                  String  @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  employeeId          String  @map("employee_id") @db.Uuid
  campo               String  @db.VarChar(50)
  valorPropuesto       String  @map("valor_propuesto")
  sustentoStorageKey   String? @map("sustento_storage_key")
  estado              String  @default("pendiente") @db.VarChar(20) // pendiente|aprobada|rechazada
  aprobadorId          String? @map("aprobador_id") @db.Uuid

  employee Employee @relation(fields: [employeeId], references: [id])

  @@index([employeeId])
  @@map("solicitud_actualizacion")
}
```

Añadir las relaciones inversas al modelo `Employee`:

```prisma
  documentos               Documento[]
  solicitudesActualizacion SolicitudActualizacion[]
```

- [ ] **Step 2: Validar el schema**

Run: `pnpm --filter @rrhh/database exec prisma validate`
Expected: `The schema at prisma/schema.prisma is valid 🚀`

- [ ] **Step 3: Escribir la migración SQL (RLS + seguridad de columna por sección)**

Crear `packages/database/prisma/migrations/20260713000000_fase3_documental/migration.sql`:

```sql
-- Fase 3 — Documental y Firma: legajo, firmas, solicitudes de actualizacion (ESS).

CREATE TABLE "documento" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "seccion" VARCHAR(20) NOT NULL,
    "tipo" VARCHAR(50) NOT NULL,
    "storage_key" TEXT NOT NULL,
    "storage_version" TEXT NOT NULL,
    "estado_firma" VARCHAR(20) NOT NULL DEFAULT 'pendiente',
    "fecha_expiracion_retencion" DATE NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "documento_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "documento_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employee"("id")
);
CREATE INDEX "documento_tenant_id_idx" ON "documento"("tenant_id");
CREATE INDEX "documento_employee_id_seccion_idx" ON "documento"("employee_id", "seccion");

CREATE TABLE "firma" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "documento_id" UUID NOT NULL,
    "firmante_id" UUID NOT NULL,
    "proveedor" VARCHAR(30) NOT NULL,
    "hash_firma" VARCHAR(64) NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "estado" VARCHAR(20) NOT NULL DEFAULT 'vigente',
    CONSTRAINT "firma_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "firma_documento_id_fkey" FOREIGN KEY ("documento_id") REFERENCES "documento"("id") ON DELETE CASCADE
);
CREATE INDEX "firma_documento_id_idx" ON "firma"("documento_id");

CREATE TABLE "solicitud_actualizacion" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "employee_id" UUID NOT NULL,
    "campo" VARCHAR(50) NOT NULL,
    "valor_propuesto" TEXT NOT NULL,
    "sustento_storage_key" TEXT,
    "estado" VARCHAR(20) NOT NULL DEFAULT 'pendiente',
    "aprobador_id" UUID,
    CONSTRAINT "solicitud_actualizacion_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "solicitud_actualizacion_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employee"("id")
);
CREATE INDEX "solicitud_actualizacion_employee_id_idx" ON "solicitud_actualizacion"("employee_id");

-- RLS
ALTER TABLE "documento" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "documento" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "documento"
    USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid);

ALTER TABLE "firma" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "firma" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "firma"
    USING (EXISTS (
        SELECT 1 FROM "documento" d
        WHERE d."id" = "firma"."documento_id"
        AND d."tenant_id" = current_setting('app.tenant_id', true)::uuid
    ));

ALTER TABLE "solicitud_actualizacion" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "solicitud_actualizacion" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "solicitud_actualizacion"
    USING (EXISTS (
        SELECT 1 FROM "employee" e
        WHERE e."id" = "solicitud_actualizacion"."employee_id"
        AND e."tenant_id" = current_setting('app.tenant_id', true)::uuid
    ));

-- Seguridad de columna por sección: un jefe de área (app_manager) jamás debe
-- ver documentos de Salud/Remuneraciones de sus reportes (goal.md, ejemplo
-- obligatorio de RBAC). Se implementa con una vista que excluye esas
-- secciones para app_manager/app_employee, mismo patrón que
-- employee_view_manager de Fase 0.
REVOKE ALL ON "documento" FROM app_manager, app_employee;

CREATE VIEW "documento_view_manager" AS
    SELECT "id", "tenant_id", "employee_id", "seccion", "tipo", "storage_key",
           "storage_version", "estado_firma", "fecha_expiracion_retencion", "created_at"
    FROM "documento"
    WHERE "seccion" NOT IN ('salud', 'remuneraciones');

CREATE VIEW "documento_view_employee" AS
    SELECT "id", "tenant_id", "employee_id", "seccion", "tipo", "storage_key",
           "storage_version", "estado_firma", "created_at"
    FROM "documento";
    -- El propio colaborador SÍ ve sus documentos de salud/remuneraciones (portal ESS,
    -- descarga de boletas y certificados de CTS) — la exclusión de sección es
    -- solo para el jefe de área sobre SUS REPORTES, no para el titular sobre sí mismo.

GRANT SELECT ON "documento_view_manager" TO app_manager;
GRANT SELECT ON "documento_view_employee" TO app_employee;
GRANT SELECT, INSERT, UPDATE ON "documento", "firma" TO app_rrhh, app_admin;
GRANT DELETE ON "documento", "firma" TO app_admin;

GRANT SELECT, INSERT ON "solicitud_actualizacion" TO app_rrhh, app_manager, app_employee, app_admin;
GRANT UPDATE ON "solicitud_actualizacion" TO app_rrhh, app_admin; -- solo RRHH/Admin aprueban/rechazan

CREATE TRIGGER "documento_audit" AFTER INSERT OR UPDATE OR DELETE ON "documento"
    FOR EACH ROW EXECUTE FUNCTION audit_trigger();
CREATE TRIGGER "firma_audit" AFTER INSERT OR UPDATE OR DELETE ON "firma"
    FOR EACH ROW EXECUTE FUNCTION audit_trigger();
CREATE TRIGGER "solicitud_actualizacion_audit" AFTER INSERT OR UPDATE OR DELETE ON "solicitud_actualizacion"
    FOR EACH ROW EXECUTE FUNCTION audit_trigger();
```

- [ ] **Step 4: Commit**

```bash
git add packages/database/prisma/schema.prisma packages/database/prisma/migrations/20260713000000_fase3_documental
git commit -m "feat(fase3): schema y migracion de legajo, firma y solicitud de actualizacion"
```

---

### Task 2: `RetencionCalculator` — fecha de expiración por sección del legajo

**Files:**
- Create: `apps/api/src/modules/documents/retencion.calculator.ts`
- Test: `apps/api/src/modules/documents/retencion.calculator.spec.ts`

**Interfaces:**
- Produces: `calcularFechaExpiracionRetencion(input: RetencionInput): Date` — usado por `DocumentoService` (Task 4).

- [ ] **Step 1: Escribir el test que falla**

```typescript
// apps/api/src/modules/documents/retencion.calculator.spec.ts
import { calcularFechaExpiracionRetencion } from './retencion.calculator';

describe('calcularFechaExpiracionRetencion', () => {
  it('Salud: retiene 20 años desde la fecha de creacion del documento', () => {
    const fecha = calcularFechaExpiracionRetencion({
      seccion: 'salud',
      fechaCreacion: new Date('2026-06-15'),
    });
    expect(fecha.getUTCFullYear()).toBe(2046);
  });

  it('Asistencia/Contratos: retiene 5 años minimo', () => {
    const fecha = calcularFechaExpiracionRetencion({
      seccion: 'contratos',
      fechaCreacion: new Date('2026-06-15'),
    });
    expect(fecha.getUTCFullYear()).toBe(2031);
  });

  it('Identificacion, SST y Remuneraciones tambien usan el minimo de 5 años (no hay regla especial mas alla de Salud)', () => {
    for (const seccion of ['identificacion', 'sst', 'remuneraciones']) {
      const fecha = calcularFechaExpiracionRetencion({
        seccion,
        fechaCreacion: new Date('2026-01-01'),
      });
      expect(fecha.getUTCFullYear()).toBe(2031);
    }
  });

  it('rechaza una seccion desconocida en vez de asumir un default silencioso', () => {
    expect(() =>
      calcularFechaExpiracionRetencion({
        seccion: 'inexistente',
        fechaCreacion: new Date('2026-01-01'),
      }),
    ).toThrow(/sección desconocida/i);
  });
});
```

- [ ] **Step 2: Ejecutar el test y verificar que falla**

Run: `pnpm --filter @rrhh/api test -- retencion.calculator`
Expected: FAIL — módulo no existe

- [ ] **Step 3: Implementación mínima**

```typescript
// apps/api/src/modules/documents/retencion.calculator.ts

/**
 * Retención: DOCUMENTO.fecha_expiracion_retencion se calcula al CREAR el
 * documento según su sección (Salud = 20 años, resto = 5 años mínimo); un job
 * periódico marca documentos vencidos para revisión humana, NUNCA borra
 * automáticamente. Ver especificaciones-fases.md, Fase 3, decisión "Retención".
 */
export type SeccionLegajo = 'identificacion' | 'contratos' | 'sst' | 'remuneraciones' | 'salud';

const AÑOS_RETENCION: Record<SeccionLegajo, number> = {
  identificacion: 5,
  contratos: 5,
  sst: 5,
  remuneraciones: 5,
  salud: 20,
};

export interface RetencionInput {
  seccion: string;
  fechaCreacion: Date;
}

export function calcularFechaExpiracionRetencion(input: RetencionInput): Date {
  const años = AÑOS_RETENCION[input.seccion as SeccionLegajo];
  if (años === undefined) {
    throw new Error(`Sección desconocida del legajo: '${input.seccion}'`);
  }
  const fecha = new Date(input.fechaCreacion);
  fecha.setUTCFullYear(fecha.getUTCFullYear() + años);
  return fecha;
}
```

- [ ] **Step 4: Ejecutar el test y verificar que pasa**

Run: `pnpm --filter @rrhh/api test -- retencion.calculator`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/documents/retencion.calculator.ts apps/api/src/modules/documents/retencion.calculator.spec.ts
git commit -m "feat(fase3): RetencionCalculator (20 anios salud, 5 anios el resto)"
```

---

### Task 3: `DigitalSignatureProvider` (interfaz + mock)

**Files:**
- Create: `apps/api/src/modules/documents/digital-signature-provider.interface.ts`
- Create: `apps/api/src/modules/documents/mock-signature.provider.ts`
- Test: `apps/api/src/modules/documents/mock-signature.provider.spec.ts`

**Interfaces:**
- Produces: `DigitalSignatureProvider.sign(documento, certificado): Promise<DocumentoFirmado>` — usado por `FirmaMasivaService` (Task 5).

- [ ] **Step 1: Escribir el test que falla**

```typescript
// apps/api/src/modules/documents/mock-signature.provider.spec.ts
import { MockSignatureProvider } from './mock-signature.provider';

describe('MockSignatureProvider.sign', () => {
  it('devuelve un hash de verificacion deterministico basado en el contenido del documento', async () => {
    const provider = new MockSignatureProvider();

    const resultado = await provider.sign(
      { contenido: Buffer.from('contrato de trabajo v1') },
      { firmanteId: 'user-1' },
    );

    expect(resultado.hashVerificacion).toHaveLength(64);
    expect(resultado.proveedor).toBe('mock');
  });

  it('produce hashes distintos para contenidos distintos (no repudio: el hash ata la firma al contenido exacto)', async () => {
    const provider = new MockSignatureProvider();

    const firma1 = await provider.sign({ contenido: Buffer.from('version 1') }, { firmanteId: 'user-1' });
    const firma2 = await provider.sign({ contenido: Buffer.from('version 2') }, { firmanteId: 'user-1' });

    expect(firma1.hashVerificacion).not.toBe(firma2.hashVerificacion);
  });
});
```

- [ ] **Step 2: Ejecutar el test y verificar que falla**

Run: `pnpm --filter @rrhh/api test -- mock-signature.provider`
Expected: FAIL — módulo no existe

- [ ] **Step 3: Implementación mínima**

```typescript
// apps/api/src/modules/documents/digital-signature-provider.interface.ts

/**
 * Interfaz abstracta de firma digital — el goal pide explícitamente esta
 * arquitectura porque elegir proveedor concreto acreditado en Perú es una
 * decisión comercial/legal, no puramente técnica (punto abierto #2).
 */
export interface DocumentoParaFirmar {
  contenido: Buffer;
}

export interface CertificadoFirmante {
  firmanteId: string;
}

export interface DocumentoFirmado {
  proveedor: string;
  hashVerificacion: string;
  timestamp: Date;
}

export interface DigitalSignatureProvider {
  sign(documento: DocumentoParaFirmar, certificado: CertificadoFirmante): Promise<DocumentoFirmado>;
}
```

```typescript
// apps/api/src/modules/documents/mock-signature.provider.ts
import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import {
  DigitalSignatureProvider,
  DocumentoParaFirmar,
  CertificadoFirmante,
  DocumentoFirmado,
} from './digital-signature-provider.interface';

/** Provider mock — sustituto hasta elegir un proveedor acreditado (punto abierto #2). */
@Injectable()
export class MockSignatureProvider implements DigitalSignatureProvider {
  async sign(
    documento: DocumentoParaFirmar,
    _certificado: CertificadoFirmante,
  ): Promise<DocumentoFirmado> {
    const hashVerificacion = createHash('sha256').update(documento.contenido).digest('hex');
    return { proveedor: 'mock', hashVerificacion, timestamp: new Date() };
  }
}
```

- [ ] **Step 4: Ejecutar el test y verificar que pasa**

Run: `pnpm --filter @rrhh/api test -- mock-signature.provider`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/documents/digital-signature-provider.interface.ts apps/api/src/modules/documents/mock-signature.provider.ts apps/api/src/modules/documents/mock-signature.provider.spec.ts
git commit -m "feat(fase3): interfaz DigitalSignatureProvider y mock"
```

---

### Task 4: `DocumentoService` — sube a MinIO y calcula retención

**Files:**
- Create: `apps/api/src/modules/documents/documento.service.ts`
- Test: `apps/api/src/modules/documents/documento.service.spec.ts`

**Interfaces:**
- Consumes: `StorageService` de Fase 0 (`apps/api/src/common/storage/storage.service.ts`), `calcularFechaExpiracionRetencion` (Task 2).
- Produces: `DocumentoService.crear(client, storage, input): Promise<DocumentoCreado>` — usado por el controller de legajo (fuera de alcance, ver sección final) y por `FirmaMasivaService` (Task 5).

- [ ] **Step 1: Escribir el test que falla**

```typescript
// apps/api/src/modules/documents/documento.service.spec.ts
import { DocumentoService } from './documento.service';

describe('DocumentoService.crear', () => {
  it('sube el contenido a storage y guarda el documento con fecha de expiracion calculada', async () => {
    const storage = {
      upload: jest.fn().mockResolvedValue(undefined),
    };
    const client = {
      documento: {
        create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'doc-1', ...data })),
      },
    };
    const service = new DocumentoService();

    const resultado = await service.crear(client as any, storage as any, {
      tenantId: 'tenant-1',
      employeeId: 'emp-1',
      seccion: 'contratos',
      tipo: 'contrato_trabajo',
      contenido: Buffer.from('PDF fake content'),
      fechaCreacion: new Date('2026-06-15'),
    });

    expect(storage.upload).toHaveBeenCalledWith(
      expect.stringContaining('emp-1'),
      expect.any(Buffer),
      undefined,
    );
    expect(client.documento.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          seccion: 'contratos',
          fechaExpiracionRetencion: new Date('2031-06-15'),
        }),
      }),
    );
    expect(resultado.id).toBe('doc-1');
  });
});
```

- [ ] **Step 2: Ejecutar el test y verificar que falla**

Run: `pnpm --filter @rrhh/api test -- documento.service`
Expected: FAIL — módulo no existe

- [ ] **Step 3: Implementación mínima**

```typescript
// apps/api/src/modules/documents/documento.service.ts
import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { calcularFechaExpiracionRetencion } from './retencion.calculator';

export interface CrearDocumentoInput {
  tenantId: string;
  employeeId: string;
  seccion: string;
  tipo: string;
  contenido: Buffer;
  fechaCreacion?: Date;
}

export interface DocumentoCreado {
  id: string;
}

/**
 * Sube el archivo a StorageService (MinIO, Fase 0) y persiste los metadatos +
 * fecha de expiración de retención calculada al momento de la creación —
 * nunca recalculada al leer, para que un cambio de reloj o de reglas futuras
 * no altere retroactivamente cuánto debía conservarse un documento ya creado.
 */
@Injectable()
export class DocumentoService {
  async crear(client: any, storage: any, input: CrearDocumentoInput): Promise<DocumentoCreado> {
    const fechaCreacion = input.fechaCreacion ?? new Date();
    const storageKey = `${input.employeeId}/${input.seccion}/${randomUUID()}`;

    await storage.upload(storageKey, input.contenido, undefined);

    const fechaExpiracionRetencion = calcularFechaExpiracionRetencion({
      seccion: input.seccion,
      fechaCreacion,
    });

    const documento = await client.documento.create({
      data: {
        tenantId: input.tenantId,
        employeeId: input.employeeId,
        seccion: input.seccion,
        tipo: input.tipo,
        storageKey,
        storageVersion: '1',
        estadoFirma: 'pendiente',
        fechaExpiracionRetencion,
      },
    });

    return { id: documento.id };
  }
}
```

- [ ] **Step 4: Ejecutar el test y verificar que pasa**

Run: `pnpm --filter @rrhh/api test -- documento.service`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/documents/documento.service.ts apps/api/src/modules/documents/documento.service.spec.ts
git commit -m "feat(fase3): DocumentoService sube a MinIO y calcula retencion al crear"
```

---

### Task 5: `FirmaMasivaService` — job asíncrono que firma un lote

**Files:**
- Create: `apps/api/src/modules/documents/firma-masiva.service.ts`
- Test: `apps/api/src/modules/documents/firma-masiva.service.spec.ts`

**Interfaces:**
- Consumes: `DigitalSignatureProvider` (Task 3).
- Produces: `FirmaMasivaService.procesarLote(client, storage, provider, documentoIds, firmanteId): Promise<{ firmados: number; fallidos: number }>` — invocado por un `Processor` de BullMQ (mismo patrón que `ExampleProcessor` de Fase 0), fuera de alcance de este plan (ver nota final).

- [ ] **Step 1: Escribir el test que falla**

```typescript
// apps/api/src/modules/documents/firma-masiva.service.spec.ts
import { FirmaMasivaService } from './firma-masiva.service';

describe('FirmaMasivaService.procesarLote', () => {
  it('firma cada documento pendiente, actualiza estado_firma y guarda el hash de verificacion', async () => {
    const client = {
      documento: {
        findUnique: jest.fn().mockResolvedValue({ id: 'doc-1', storageKey: 'key-1' }),
        update: jest.fn().mockResolvedValue({}),
      },
      firma: {
        create: jest.fn().mockResolvedValue({ id: 'firma-1' }),
      },
    };
    const storage = { download: jest.fn().mockResolvedValue(Buffer.from('contenido')) };
    const provider = {
      sign: jest.fn().mockResolvedValue({
        proveedor: 'mock',
        hashVerificacion: 'a'.repeat(64),
        timestamp: new Date(),
      }),
    };
    const service = new FirmaMasivaService();

    const resultado = await service.procesarLote(
      client as any,
      storage as any,
      provider as any,
      ['doc-1'],
      'user-legal-rep-1',
    );

    expect(provider.sign).toHaveBeenCalledTimes(1);
    expect(client.firma.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ documentoId: 'doc-1', hashFirma: 'a'.repeat(64) }),
      }),
    );
    expect(client.documento.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'doc-1' }, data: { estadoFirma: 'firmado' } }),
    );
    expect(resultado).toEqual({ firmados: 1, fallidos: 0 });
  });

  it('continua con el resto del lote si un documento falla (no aborta todo el job)', async () => {
    const client = {
      documento: {
        findUnique: jest
          .fn()
          .mockResolvedValueOnce(null) // doc-1 no existe -> falla
          .mockResolvedValueOnce({ id: 'doc-2', storageKey: 'key-2' }),
        update: jest.fn().mockResolvedValue({}),
      },
      firma: { create: jest.fn().mockResolvedValue({ id: 'firma-2' }) },
    };
    const storage = { download: jest.fn().mockResolvedValue(Buffer.from('contenido')) };
    const provider = {
      sign: jest
        .fn()
        .mockResolvedValue({ proveedor: 'mock', hashVerificacion: 'b'.repeat(64), timestamp: new Date() }),
    };
    const service = new FirmaMasivaService();

    const resultado = await service.procesarLote(
      client as any,
      storage as any,
      provider as any,
      ['doc-1', 'doc-2'],
      'user-legal-rep-1',
    );

    expect(resultado).toEqual({ firmados: 1, fallidos: 1 });
  });
});
```

- [ ] **Step 2: Ejecutar el test y verificar que falla**

Run: `pnpm --filter @rrhh/api test -- firma-masiva.service`
Expected: FAIL — módulo no existe

- [ ] **Step 3: Implementación mínima**

```typescript
// apps/api/src/modules/documents/firma-masiva.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { DigitalSignatureProvider } from './digital-signature-provider.interface';

export interface FirmaMasivaResultado {
  firmados: number;
  fallidos: number;
}

/**
 * Firma masiva: itera un lote de documentos pendientes, invoca el provider,
 * actualiza estado_firma y guarda hash de verificación. Un documento que
 * falla no aborta el resto del lote — volumen (cientos de documentos)
 * requiere resiliencia parcial. Ver especificaciones-fases.md, Fase 3,
 * decisión "Firma masiva".
 */
@Injectable()
export class FirmaMasivaService {
  private readonly logger = new Logger(FirmaMasivaService.name);

  async procesarLote(
    client: any,
    storage: any,
    provider: DigitalSignatureProvider,
    documentoIds: string[],
    firmanteId: string,
  ): Promise<FirmaMasivaResultado> {
    let firmados = 0;
    let fallidos = 0;

    for (const documentoId of documentoIds) {
      try {
        const documento = await client.documento.findUnique({ where: { id: documentoId } });
        if (!documento) {
          throw new Error(`Documento ${documentoId} no encontrado`);
        }

        const contenido = await storage.download(documento.storageKey);
        const firmado = await provider.sign({ contenido }, { firmanteId });

        await client.firma.create({
          data: {
            documentoId: documento.id,
            firmanteId,
            proveedor: firmado.proveedor,
            hashFirma: firmado.hashVerificacion,
            timestamp: firmado.timestamp,
            estado: 'vigente',
          },
        });

        await client.documento.update({
          where: { id: documento.id },
          data: { estadoFirma: 'firmado' },
        });

        firmados += 1;
      } catch (error) {
        this.logger.warn(`Fallo al firmar documento ${documentoId}: ${(error as Error).message}`);
        fallidos += 1;
      }
    }

    return { firmados, fallidos };
  }
}
```

- [ ] **Step 4: Ejecutar el test y verificar que pasa**

Run: `pnpm --filter @rrhh/api test -- firma-masiva.service`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/documents/firma-masiva.service.ts apps/api/src/modules/documents/firma-masiva.service.spec.ts
git commit -m "feat(fase3): FirmaMasivaService procesa lote sin abortar en el primer fallo"
```

---

### Task 6: `SolicitudActualizacionService` — portal ESS (propuesta + sustento + aprobador)

**Files:**
- Create: `apps/api/src/modules/documents/solicitud-actualizacion.service.ts`
- Test: `apps/api/src/modules/documents/solicitud-actualizacion.service.spec.ts`

**Interfaces:**
- Produces: `SolicitudActualizacionService.solicitar(client, input): Promise<{ id: string }>` y `SolicitudActualizacionService.resolver(client, input): Promise<{ id: string; estado: string }>`.

- [ ] **Step 1: Escribir el test que falla**

```typescript
// apps/api/src/modules/documents/solicitud-actualizacion.service.spec.ts
import { SolicitudActualizacionService } from './solicitud-actualizacion.service';

describe('SolicitudActualizacionService', () => {
  it('solicitar() crea una solicitud en estado pendiente, sin tocar el dato real todavia', async () => {
    const client = {
      solicitudActualizacion: {
        create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'sol-1', ...data })),
      },
    };
    const service = new SolicitudActualizacionService();

    const resultado = await service.solicitar(client as any, {
      employeeId: 'emp-1',
      campo: 'direccion',
      valorPropuesto: 'Av. Nueva 123, Lima',
      sustentoStorageKey: 'emp-1/sustento/recibo-luz.pdf',
    });

    expect(client.solicitudActualizacion.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ estado: 'pendiente' }) }),
    );
    expect(resultado.id).toBe('sol-1');
  });

  it('resolver() con aprobacion cambia el estado a aprobada y registra al aprobador', async () => {
    const client = {
      solicitudActualizacion: {
        update: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'sol-1', ...data })),
      },
    };
    const service = new SolicitudActualizacionService();

    const resultado = await service.resolver(client as any, {
      solicitudId: 'sol-1',
      aprobadorId: 'user-rrhh-1',
      aprobar: true,
    });

    expect(client.solicitudActualizacion.update).toHaveBeenCalledWith({
      where: { id: 'sol-1' },
      data: { estado: 'aprobada', aprobadorId: 'user-rrhh-1' },
    });
    expect(resultado.estado).toBe('aprobada');
  });

  it('resolver() con rechazo cambia el estado a rechazada', async () => {
    const client = {
      solicitudActualizacion: {
        update: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'sol-1', ...data })),
      },
    };
    const service = new SolicitudActualizacionService();

    const resultado = await service.resolver(client as any, {
      solicitudId: 'sol-1',
      aprobadorId: 'user-rrhh-1',
      aprobar: false,
    });

    expect(resultado.estado).toBe('rechazada');
  });
});
```

- [ ] **Step 2: Ejecutar el test y verificar que falla**

Run: `pnpm --filter @rrhh/api test -- solicitud-actualizacion.service`
Expected: FAIL — módulo no existe

- [ ] **Step 3: Implementación mínima**

```typescript
// apps/api/src/modules/documents/solicitud-actualizacion.service.ts
import { Injectable } from '@nestjs/common';

export interface SolicitarActualizacionInput {
  employeeId: string;
  campo: string;
  valorPropuesto: string;
  sustentoStorageKey?: string;
}

export interface ResolverSolicitudInput {
  solicitudId: string;
  aprobadorId: string;
  aprobar: boolean;
}

/**
 * Portal ESS: el colaborador propone un cambio (ej. dirección) adjuntando
 * sustento; el cambio NO se aplica hasta que RRHH aprueba. Mismo patrón que
 * MARCACION_CORRECCION de Fase 2 (propuesta + sustento + aprobador).
 * Ver especificaciones-fases.md, Fase 3, decisión "Portal ESS".
 */
@Injectable()
export class SolicitudActualizacionService {
  async solicitar(client: any, input: SolicitarActualizacionInput): Promise<{ id: string }> {
    const solicitud = await client.solicitudActualizacion.create({
      data: {
        employeeId: input.employeeId,
        campo: input.campo,
        valorPropuesto: input.valorPropuesto,
        sustentoStorageKey: input.sustentoStorageKey,
        estado: 'pendiente',
      },
    });
    return { id: solicitud.id };
  }

  async resolver(
    client: any,
    input: ResolverSolicitudInput,
  ): Promise<{ id: string; estado: string }> {
    const estado = input.aprobar ? 'aprobada' : 'rechazada';
    const actualizada = await client.solicitudActualizacion.update({
      where: { id: input.solicitudId },
      data: { estado, aprobadorId: input.aprobadorId },
    });
    return { id: actualizada.id, estado: actualizada.estado };
  }
}
```

- [ ] **Step 4: Ejecutar el test y verificar que pasa**

Run: `pnpm --filter @rrhh/api test -- solicitud-actualizacion.service`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/documents/solicitud-actualizacion.service.ts apps/api/src/modules/documents/solicitud-actualizacion.service.spec.ts
git commit -m "feat(fase3): SolicitudActualizacionService para el portal ESS"
```

> **Nota importante:** `resolver()` con `aprobar: true` deja pendiente aplicar `valorPropuesto` al campo real del `Employee` — este plan entrega el flujo de aprobación, no el mapeo campo-por-campo hacia `Employee`/`Contrato` (depende de qué campos se habiliten para autoservicio, decisión de producto no tomada aún). Señalado aquí explícitamente, no oculto.

---

### Task 7: `documents.module.ts` — ensamblar el módulo y registrarlo en `AppModule`

**Files:**
- Create: `apps/api/src/modules/documents/documents.module.ts`
- Modify: `apps/api/src/app.module.ts`

**Interfaces:**
- Consumes: todos los servicios de Tasks 2–6.
- Produces: `DocumentsModule`, importado por `AppModule`.

- [ ] **Step 1: Escribir el módulo**

```typescript
// apps/api/src/modules/documents/documents.module.ts
import { Module } from '@nestjs/common';
import { DocumentoService } from './documento.service';
import { FirmaMasivaService } from './firma-masiva.service';
import { SolicitudActualizacionService } from './solicitud-actualizacion.service';
import { MockSignatureProvider } from './mock-signature.provider';

@Module({
  providers: [
    DocumentoService,
    FirmaMasivaService,
    SolicitudActualizacionService,
    { provide: 'DigitalSignatureProvider', useClass: MockSignatureProvider },
  ],
  exports: [DocumentoService, FirmaMasivaService, SolicitudActualizacionService],
})
export class DocumentsModule {}
```

- [ ] **Step 2: Registrar en `AppModule`**

Modificar `apps/api/src/app.module.ts`: agregar `DocumentsModule` al arreglo `imports`, junto a `AttendanceModule` (de Fase 2).

- [ ] **Step 3: Verificar que el proyecto compila**

Run: `pnpm --filter @rrhh/api build`
Expected: compilación exitosa sin errores de tipos

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/modules/documents/documents.module.ts apps/api/src/app.module.ts
git commit -m "feat(fase3): ensamblar DocumentsModule en AppModule"
```

---

## Fuera de alcance de este plan (deuda técnica explícita, no placeholders)

- **Proveedor de firma digital concreto** (punto abierto #2) — solo se entrega la interfaz y el mock.
- **Controller/endpoints REST** del legajo, firma masiva y portal ESS — mismo patrón de `payroll.controller.ts` (Fase 1), pendiente de exponer vía HTTP.
- **Job periódico de documentos vencidos** (marcar para revisión humana, nunca borrar) — este plan entrega `RetencionCalculator`, no el cron que lo recorre; mismo patrón que `VacacionesAlertasProcessor` de Fase 2.
- **Mapeo de `SolicitudActualizacion.valorPropuesto` hacia el campo real de `Employee`/`Contrato`** al aprobar — señalado explícitamente en Task 6.
- **Página Legajo Digital, Workflow de Firma, Gestión de Permisos Granulares (UI)** — requieren pasada de `frontend-design`.
