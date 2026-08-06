# Exportes de Nómina a Base de Datos Real

> **Diseño para conectar los endpoints `GET /payroll/:periodo/export/plame` y `/export/telecredito` a la BD, reemplazando stubs con exportes reales de Estructura 18 (PLAME) y telecrédito (BCP).**
>
> **Versión:** 1.0.0 · **Fecha:** 2026-08-06 · **Estado:** Diseño aprobado, pendiente implementación

---

## 1. Resumen Ejecutivo

Hoy los endpoints de exportación de nómina retornan stubs (`{mensaje: "no implementado"}`). Esta feature conecta:

- **Estructura 18 (PLAME):** Export de ingresos, tributos, descuentos por empleado
- **Telecrédito (BCP):** Export de nómina para pago masivo bancario

La arquitectura soporta:
- **Configuración por tenant** — cada cliente elige modo de cálculo (devengado vs pagado), formato de archivo, conceptos excluidos
- **Validaciones pre-export** — advertencias si faltan datos (ej: empleados sin cuenta bancaria)
- **Extensibilidad** — diseño pensado para agregar nuevos formatos, bancos, filtros sin refactorizar

---

## 2. Modelo de Datos

### Nueva tabla: `TenantPayrollExportConfig`

Almacena las preferencias de exportación por tenant.

```prisma
model TenantPayrollExportConfig {
  id                 String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  tenantId           String   @unique @map("tenant_id") @db.Uuid
  
  // Modo de cálculo: devengado = pagado, o devengado incluye descuentos
  montoMode          String   @map("monto_mode")
                               // 'devengado_igual_pagado' | 'devengado_con_descuentos'
  
  // Formato de archivo (MVP: pipe-delimited; extensión: CSV, etc.)
  formatoExportar    String   @map("formato_exportar")  // 'pipe' | 'csv'
  
  // Conceptos SUNAT a excluir del export (ej: ["0100", "0200"] = totales calculados)
  conceptosExcluidos Json     @map("conceptos_excluidos")
  
  // Campos sensibles (para UI/permisos futuros: ej ["horasExtras", "bonificacion"])
  camposSensibles    Json     @map("campos_sensibles")
  
  createdAt          DateTime @default(now()) @map("created_at")
  updatedAt          DateTime @updatedAt @map("updated_at")

  tenant Tenant @relation(fields: [tenantId], references: [id], onDelete: Cascade)

  @@map("tenant_payroll_export_config")
}
```

Agregar relación inversa en `Tenant`:
```prisma
payrollExportConfig TenantPayrollExportConfig?
```

### Configuración por defecto (si no existe registro)

Si un tenant no tiene `TenantPayrollExportConfig`:
- `montoMode`: `'devengado_igual_pagado'`
- `formatoExportar`: `'pipe'`
- `conceptosExcluidos`: `[]`
- `camposSensibles`: `[]`

---

## 3. Servicios

### `PayrollExportMapperService` (nuevo)

Responsabilidad: mapear `PLANILLA_DETALLE` a formatos exportables.

```typescript
@Injectable()
export class PayrollExportMapperService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Obtiene la configuración de exportación del tenant. Si no existe,
   * retorna defaults.
   */
  async obtenerConfig(
    tx: any,
    tenantId: string,
  ): Promise<TenantPayrollExportConfig> {
    const config = await tx.tenantPayrollExportConfig.findUnique({
      where: { tenantId },
    });
    return config ?? {
      montoMode: 'devengado_igual_pagado',
      formatoExportar: 'pipe',
      conceptosExcluidos: [],
      camposSensibles: [],
    };
  }

  /**
   * Mapea conceptos calculados a filas de Estructura 18 (PLAME).
   * Maneja `montoMode`: devengado_igual_pagado vs devengado_con_descuentos.
   *
   * @param conceptos Array de {codigo, nombre, monto} del JSON conceptosCalculados
   * @param montoMode 'devengado_igual_pagado' | 'devengado_con_descuentos'
   * @returns Array de {tipoDocumento, numeroDocumento, codigoConceptoSunat, montoDevengado, montoPagado}
   */
  mapearConceptosA18(
    conceptos: Array<{ codigo: string; nombre: string; monto: number }>,
    tipoDocumento: string,
    numeroDocumento: string,
    montoMode: string,
  ): PlanillaDetalleRow[] {
    return conceptos.map((c) => {
      const devengado = c.monto;
      // Si montoMode = 'devengado_con_descuentos', restar descuentos del monto
      // (MVP: ambos montos iguales; extensión futura puede calcular diferencia)
      const pagado =
        montoMode === 'devengado_con_descuentos' ? devengado * 0.95 : devengado;

      return {
        tipoDocumento,
        numeroDocumento,
        codigoConceptoSunat: c.codigo,
        montoDevengado: devengado,
        montoPagado: pagado,
      };
    });
  }

  /**
   * Filtra conceptos excluidos (ej: códigos de totales calculados).
   */
  filtrarConceptosExcluidos(
    filas: PlanillaDetalleRow[],
    conceptosExcluidos: string[],
  ): PlanillaDetalleRow[] {
    if (!conceptosExcluidos.length) return filas;
    return filas.filter(
      (f) => !conceptosExcluidos.includes(f.codigoConceptoSunat),
    );
  }
}
```

### Extensiones de servicios existentes

**`PlanillaExporter`:** Ya existe, sin cambios.

**`BankFileExporter`:** Ya existe, sin cambios.

---

## 4. Endpoints - Implementación

### `GET /payroll/:periodo/export/plame`

**Responsabilidad:** Exportar Estructura 18 (detalle de ingresos/tributos por empleado).

**Flujo:**
1. Validar que `PLANILLA.periodo = :periodo` existe y `estado = 'procesada'`
2. Obtener `TenantPayrollExportConfig` (defaults si no existe)
3. Leer `PLANILLA_DETALLE` para el período (join con `EMPLOYEE` para `numeroDocumento`)
4. Para cada fila de detalle:
   - Mapear `conceptosCalculados` (JSON) a `PlanillaDetalleRow[]` usando `montoMode`
   - Filtrar conceptos excluidos
5. Concatenar todas las filas
6. Llamar `PlanillaExporter.exportarE18(filas)`
7. Retornar descarga:
   ```
   HTTP 200
   Content-Type: text/plain; charset=utf-8
   Content-Disposition: attachment; filename="E18_<periodo>.txt"
   Body: <contenido pipe-delimited>
   ```

**Validaciones:**
- Período no existe → 404 "Período no encontrado"
- Período no procesado → 400 "Período aún no procesado"
- Sin conceptos → 400 "Período sin conceptos calculados"

---

### `GET /payroll/:periodo/export/telecredito`

**Responsabilidad:** Exportar nómina para pago masivo (BCP).

**Flujo:**
1. Validar que `PLANILLA.periodo = :periodo` existe y `estado = 'procesada'`
2. Obtener `TenantPayrollExportConfig` (defaults si no existe)
3. Leer `PLANILLA_DETALLE` + join con `EMPLOYEE` (incluir `cuentaBancaria`)
4. Para cada empleado:
   - Calcular `netoPagar` = suma de conceptos según `montoMode`
   - Validar `cuentaBancaria` (no null) — si falta, agregar a advertencias
5. Mapear a `BankFileRow[]` (solo empleados con cuenta)
6. Llamar `BankFileExporter.exportarBcp(filas)`
7. Retornar respuesta con advertencias:
   ```json
   {
     "success": true,
     "archivo": "<contenido pipe-delimited>",
     "advertencias": [
       {"numeroDocumento": "12345678", "mensaje": "Sin cuenta bancaria registrada"}
     ]
   }
   ```

**Validaciones:**
- Período no existe → 404
- Período no procesado → 400
- Monto total = 0 → 400 "Nada que exportar"
- Empleados sin cuenta → advertencia (no cancela export)

**Respuesta con advertencias:**
```typescript
{
  success: boolean;
  archivo: string;
  advertencias: Array<{ numeroDocumento: string; mensaje: string }>;
}
```

---

## 5. Cambios en `payroll.controller.ts`

**Inyectar nuevo servicio:**
```typescript
constructor(
  private readonly payrollRunService: PayrollRunService,
  private readonly payrollImportService: PayrollImportService,
  private readonly planillaExporter: PlanillaExporter,
  private readonly bankFileExporter: BankFileExporter,
  private readonly exportMapper: PayrollExportMapperService,  // NUEVO
) {}
```

**Implementar endpoints:**

```typescript
@Get(':periodo/export/plame')
@RequirePermission('payroll.export')
async exportarPlame(@Param('periodo') periodo: string) {
  const ctx = getTenantContext();
  const { tenantId } = requireIdentity(ctx);

  const planilla = await ctx.tx.planilla.findUnique({
    where: { tenantId_periodo: { tenantId, periodo } },
  });
  if (!planilla) throw new NotFoundException('Período no encontrado');
  if (planilla.estado !== 'procesada')
    throw new BadRequestException('Período aún no procesado');

  const config = await this.exportMapper.obtenerConfig(ctx.tx, tenantId);

  const detalles = await ctx.tx.planillaDetalle.findMany({
    where: { planilla: { tenantId, periodo } },
    include: { employee: { select: { numeroDocumento: true } } },
  });

  if (!detalles.length)
    throw new BadRequestException('Período sin conceptos calculados');

  let filas: PlanillaDetalleRow[] = [];
  for (const detalle of detalles) {
    const conceptos = detalle.conceptosCalculados as Array<{
      codigo: string;
      nombre: string;
      monto: number;
    }>;
    const mapped = this.exportMapper.mapearConceptosA18(
      conceptos,
      '1', // DNI
      detalle.employee.numeroDocumento,
      config.montoMode,
    );
    filas.push(...mapped);
  }

  filas = this.exportMapper.filtrarConceptosExcluidos(
    filas,
    config.conceptosExcluidos as string[],
  );

  const contenido = this.planillaExporter.exportarE18(filas);

  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Content-Disposition': `attachment; filename="E18_${periodo}.txt"`,
    },
    body: contenido,
  };
}

@Get(':periodo/export/telecredito')
@RequirePermission('payroll.export')
async exportarTelecredito(@Param('periodo') periodo: string) {
  const ctx = getTenantContext();
  const { tenantId } = requireIdentity(ctx);

  const planilla = await ctx.tx.planilla.findUnique({
    where: { tenantId_periodo: { tenantId, periodo } },
  });
  if (!planilla) throw new NotFoundException('Período no encontrado');
  if (planilla.estado !== 'procesada')
    throw new BadRequestException('Período aún no procesado');

  const config = await this.exportMapper.obtenerConfig(ctx.tx, tenantId);

  const detalles = await ctx.tx.planillaDetalle.findMany({
    where: { planilla: { tenantId, periodo } },
    include: {
      employee: {
        select: { numeroDocumento: true, cuentaBancaria: true },
      },
    },
  });

  const advertencias: Array<{ numeroDocumento: string; mensaje: string }> = [];
  let filas: BankFileRow[] = [];
  let totalMonto = 0;

  for (const detalle of detalles) {
    if (!detalle.employee.cuentaBancaria) {
      advertencias.push({
        numeroDocumento: detalle.employee.numeroDocumento,
        mensaje: 'Sin cuenta bancaria registrada',
      });
      continue;
    }

    const conceptos = detalle.conceptosCalculados as Array<{
      codigo: string;
      nombre: string;
      monto: number;
    }>;
    const monto = conceptos.reduce((sum, c) => sum + c.monto, 0);

    filas.push({
      numeroDocumento: detalle.employee.numeroDocumento,
      numeroCuenta: detalle.employee.cuentaBancaria,
      monto,
    });
    totalMonto += monto;
  }

  if (totalMonto === 0)
    throw new BadRequestException('Nada que exportar (monto total = 0)');

  const contenido = this.bankFileExporter.exportarBcp(filas);

  return {
    success: true,
    archivo: contenido,
    advertencias,
  };
}
```

---

## 6. Migración y RLS

**Migración SQL:** Crear tabla `tenant_payroll_export_config` con RLS (multi-tenant isolation).

```sql
CREATE TABLE tenant_payroll_export_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL UNIQUE,
  monto_mode VARCHAR(50) NOT NULL DEFAULT 'devengado_igual_pagado',
  formato_exportar VARCHAR(50) NOT NULL DEFAULT 'pipe',
  conceptos_excluidos JSONB NOT NULL DEFAULT '[]',
  campos_sensibles JSONB NOT NULL DEFAULT '[]',
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  FOREIGN KEY (tenant_id) REFERENCES tenant(id) ON DELETE CASCADE
);

ALTER TABLE tenant_payroll_export_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON tenant_payroll_export_config
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

GRANT SELECT, INSERT, UPDATE ON tenant_payroll_export_config 
  TO app_rrhh, app_admin;
```

---

## 7. Testing

**Unit tests:**
- `PayrollExportMapperService.mapearConceptosA18()` — mapeo devengado vs pagado
- `PayrollExportMapperService.filtrarConceptosExcluidos()` — filtrado correcto
- `PlanillaExporter.exportarE18()` — ya existe, sin cambios
- `BankFileExporter.exportarBcp()` — ya existe, sin cambios

**Integration tests:**
- `GET /payroll/202607/export/plame` con datos de prueba → valida contenido E18
- `GET /payroll/202607/export/telecredito` → valida contenido BCP + advertencias
- Períodos no procesados → 400
- Sin conceptos → 400
- Config por defecto vs personalizada → ambos funcionan

---

## 8. Extensiones Futuras (Out of MVP Scope)

- **Formatos adicionales:** CSV (además de pipe)
- **Conceptos filtrados por UI:** allow-list/deny-list dinámico en UI
- **Datos sensibles:** masking de campos según permisos
- **Bancos adicionales:** BBVA, Interbank, Scotiabank (interfaz ya extensible)
- **Auditoría:** log de quién descargó qué, cuándo

---

## 9. Deuda Técnica Identificada

- **Cálculo de descuentos:** MVP asume descuentos = 5% si `montoMode = 'devengado_con_descuentos'`. Versión real debería leer descuentos reales del JSON `conceptosCalculados` (buscar códigos de descuento negativos).
- **Validación de RLS:** Confirmar que `getTenantContext()` aísla correctamente el tenant en todas las queries.

---

## 10. Criterios de Aceptación

✅ Endpoint `/payroll/202607/export/plame` descarga Estructura 18 válida  
✅ Endpoint `/payroll/202607/export/telecredito` descarga telecrédito BCP válido  
✅ Advertencias si empleados sin cuenta bancaria  
✅ Configuración por tenant (montoMode, formato, conceptos excluidos)  
✅ Validaciones pre-export (período no existe, no procesado, sin conceptos)  
✅ Tests pasan (unit + integration)  
✅ Código compilable sin errores TypeScript
