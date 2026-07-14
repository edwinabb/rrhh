# Frontend HRMS Perú (Fases 1–4 + Admin) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Nota de ejecución:** este plan se está ejecutando mediante un workflow multi-agente (Task 1 secuencial → Tasks 2–6 en paralelo → Task 7 verificación). Sirve también como contrato de revisión: cada task es verificable de forma independiente.

**Goal:** Capa web completa del HRMS: shell autenticado con navegación por permisos + 5 secciones operativas (Asistencia, Nómina, Legajo, ATS, Admin) sobre los 25 endpoints existentes.

**Architecture:** Next.js 14 App Router con grupo de rutas `(app)` protegido por un `AuthProvider` cliente que consume el nuevo `GET /auth/me`. Cada sección es una página client-side que llama a la API con el wrapper `apiFetch` (cookie de sesión, errores uniformes). El RBAC del cliente solo oculta UI; la autoridad es del backend.

**Tech Stack:** Next.js 14, TypeScript, Tailwind CSS (sin dependencias nuevas). Backend NestJS existente.

## Global Constraints

- UI completa en español (Perú). Moneda `S/`, fechas legibles dd/mm/aaaa.
- Estilo visual: el slate minimalista de `apps/web/src/app/(auth)/login/page.tsx` (`bg-white`, `border-slate-200`, `rounded`, `text-sm`, botones `bg-slate-900 text-white`).
- Prohibido agregar dependencias npm nuevas.
- Shapes de request/response: leerlos del controller/service real en `apps/api/src/modules/<modulo>/` — nunca inventarlos.
- Toda llamada muestra error legible en UI; estados de carga con "Cargando…".
- Ciclo de verificación por task (el repo no tiene tests de frontend): `cd apps/web && pnpm exec tsc --noEmit` limpio; al final `next build` + suite backend completa (182 tests) intacta.
- Commits en español, formato `feat(web): …`.

---

### Task 1: Shell — `GET /auth/me` + layout autenticado + dashboard

**Files:**
- Modify: `apps/api/src/modules/auth/auth.controller.ts` (agregar handler `GET /auth/me`)
- Modify: `apps/web/src/lib/api-client.ts` (agregar `logout()`, `getMe()`, tipo `Me`, `UnauthorizedError`, `parseApiError`)
- Create: `apps/web/src/components/auth-context.tsx`
- Create: `apps/web/src/app/(app)/layout.tsx`
- Create: `apps/web/src/app/(app)/page.tsx` (dashboard)
- Delete: `apps/web/src/app/page.tsx` (la home pública; `/` pasa al grupo `(app)`)

**Interfaces:**
- Consumes: `req.session` (ya contiene `userId`, `tenantId`, `pgRole`, `permissions` — ver `session.types.ts`).
- Produces (para Tasks 2–6):
  - `getMe(): Promise<Me | null>` con `Me = { userId: string; tenantId: string; pgRole: 'app_admin'|'app_rrhh'|'app_manager'|'app_employee'; permissions: string[] }`
  - Hook `useAuth(): { me: Me | null; loading: boolean; hasPermission(code: string): boolean }` exportado de `@/components/auth-context`
  - `parseApiError(res: Response, fallback: string): Promise<string>` y `class UnauthorizedError extends Error` en `@/lib/api-client`

- [ ] **Step 1: Endpoint `GET /auth/me`** — en `auth.controller.ts`:

```typescript
@Get('me')
me(@Req() req: Request) {
  return {
    userId: req.session.userId,
    tenantId: req.session.tenantId,
    pgRole: req.session.pgRole,
    permissions: req.session.permissions ?? [],
  };
}
```

- [ ] **Step 2: Verificar backend** — `cd apps/api && pnpm exec tsc --noEmit` (limpio) y `pnpm --filter @rrhh/api test auth` (pasan).

- [ ] **Step 3: Extender `api-client.ts`** con `logout()`, `Me`, `getMe()` (retorna `null` en 401), `UnauthorizedError` y `parseApiError` (lee `{message}` de NestJS, tolera string o array).

- [ ] **Step 4: `auth-context.tsx`** — client component:

```tsx
'use client';
const AuthContext = createContext<{ me: Me | null; loading: boolean; hasPermission: (c: string) => boolean }>(...);
export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();
  useEffect(() => {
    getMe().then((m) => {
      if (!m) { router.replace('/login'); return; }
      setMe(m); setLoading(false);
    }).catch(() => router.replace('/login'));
  }, [router]);
  const hasPermission = (code: string) => me?.permissions.includes(code) ?? false;
  if (loading) return <p className="p-8 text-sm text-slate-500">Cargando…</p>;
  return <AuthContext.Provider value={{ me, loading, hasPermission }}>{children}</AuthContext.Provider>;
}
export const useAuth = () => useContext(AuthContext);
```

- [ ] **Step 5: `(app)/layout.tsx`** — sidebar con los 6 enlaces filtrados por permiso (tabla en la spec §3.3), header con `pgRole` y botón "Cerrar sesión" (`logout()` → `/login`), todo dentro de `<AuthProvider>`.

- [ ] **Step 6: Dashboard `(app)/page.tsx`** — tarjetas por módulo (mismos filtros de permiso) con descripción y `<Link>`; eliminar `app/page.tsx` y verificar que no queden dos `page.tsx` resolviendo `/`.

- [ ] **Step 7: Verificar** — `cd apps/web && pnpm exec tsc --noEmit` limpio.

- [ ] **Step 8: Commit** — `git add -A && git commit -m "feat(web): shell autenticado - /auth/me, AuthProvider, sidebar RBAC y dashboard"`

---

### Task 2: Sección Asistencia

**Files:**
- Create: `apps/web/src/app/(app)/asistencia/page.tsx` (+ auxiliares en la misma carpeta si crecen)
- Modify: `apps/web/src/lib/api-client.ts` (funciones y tipos de attendance)

**Interfaces:**
- Consumes: `useAuth().hasPermission`, `apiFetch`, `parseApiError`, `UnauthorizedError` (Task 1). Shapes reales: `apps/api/src/modules/attendance/attendance.controller.ts` y `attendance.service.ts`.
- Produces: página autosuficiente; funciones `registrarMarcacion`, `getResumen`, `crearJustificacion`, `resolverJustificacion`, `getDashboardEquipo` en `api-client.ts`.

- [ ] **Step 1:** Tarjeta "Marcar asistencia": botones ENTRADA/SALIDA → `navigator.geolocation.getCurrentPosition` → `POST /attendance/marcaciones` `{ tipo, latitud, longitud }`. Renderizar resultado: aceptada / `bloqueado: true` con `motivoBloqueo` / `requiereAutorizacion`. GPS denegado → enviar sin coordenadas (el backend la bloqueará por geofence; mostrar ese motivo).
- [ ] **Step 2:** Tabla "Resumen del mes": `<input type="month">` (default actual) → `GET /attendance/resumen/:periodo` → columnas fecha, entrada, salida, horas, tardanza (min), falta, justificado.
- [ ] **Step 3:** Justificaciones: form (motivo `<select>` con los valores del enum `MotivoJustificacion`, fecha, descripción) → `POST /attendance/justificaciones`. Si `hasPermission('attendance.approve')`: pendientes con Aprobar / Rechazar (motivo obligatorio) → `PUT /attendance/justificaciones/:id/resolver`.
- [ ] **Step 4:** Si `hasPermission('attendance.read.team')`: tarjeta con `GET /attendance/dashboard/:periodo`.
- [ ] **Step 5:** Verificar `tsc --noEmit`. **Step 6: Commit** `feat(web): página de asistencia - marcación GPS, resumen mensual y justificaciones`.

---

### Task 3: Sección Nómina

**Files:**
- Create: `apps/web/src/app/(app)/nomina/page.tsx`
- Modify: `apps/web/src/lib/api-client.ts` (`procesarPlanilla`, `exportarPlanilla`, tipos `PlanillaProcesada`, `ExportacionPlanilla`)

**Interfaces:**
- Consumes: Task 1 + shapes de `payroll.controller.ts` / `payroll-run.service.ts`.
- Produces: página autosuficiente.

- [ ] **Step 1:** Selector de período (`<input type="month">`) + botón "Procesar planilla" con **confirmación previa** (diálogo: "Esto calculará y persistirá la planilla del período X"). → `POST /payroll/:periodo/procesar`; mostrar estado resultante y detalle por empleado solo si la respuesta lo trae (hoy retorna `{id, estado}`).
- [ ] **Step 2:** Botones "Exportar PLAME (E18)" y "Exportar telecrédito BCP" → endpoints de export. Hoy retornan stub `{mensaje}`: mostrarlo como aviso ámbar "pendiente de conexión a BD" — no inventar datos.
- [ ] **Step 3:** Tarjeta informativa con los 8 conceptos del motor de cálculo.
- [ ] **Step 4:** Verificar `tsc`. **Step 5: Commit** `feat(web): página de nómina - procesar período y exportes`.

---

### Task 4: Sección Legajo

**Files:**
- Create: `apps/web/src/app/(app)/legajo/page.tsx`
- Modify: `apps/web/src/lib/api-client.ts` (documents + `getEmployees`)

**Interfaces:**
- Consumes: Task 1 + shapes de `documents.controller.ts` / `document.service.ts` (**verificar cómo acepta el upload el controller — JSON base64 vs multipart — y ajustarse**), `GET /employees`.
- Produces: página autosuficiente.

- [ ] **Step 1:** Selector de empleado (`GET /employees` → `<select>` con nombres + documento).
- [ ] **Step 2:** Vista de legajo: `GET /documents/legajo/:employeeId` → grupos por tipo + tipos faltantes destacados en ámbar.
- [ ] **Step 3:** Con `documents.upload`: form tipo (`<select>` del enum `TipoDocumento`) + `<input type="file">`; convertir el archivo al formato que el controller acepte y `POST /documents`.
- [ ] **Step 4:** Por documento: Descargar (fetch → blob → `<a download>` con nombre original). Con `documents.delete`: Eliminar con **motivo obligatorio** → `DELETE /documents/:id`.
- [ ] **Step 5:** Búsqueda por tipo y rango de fechas (`GET /documents/search`).
- [ ] **Step 6:** Verificar `tsc`. **Step 7: Commit** `feat(web): página de legajo - documentos por empleado, subida, descarga y soft-delete`.

---

### Task 5: Sección Reclutamiento (ATS)

**Files:**
- Create: `apps/web/src/app/(app)/ats/page.tsx` (lista de vacantes)
- Create: `apps/web/src/app/(app)/ats/[id]/page.tsx` (detalle + candidatos)
- Modify: `apps/web/src/lib/api-client.ts` (ats)

**Interfaces:**
- Consumes: Task 1 + shapes de `ats.controller.ts` / `candidate.service.ts` / `vacante.service.ts`.
- Produces: páginas autosuficientes.

- [ ] **Step 1:** Lista de vacantes con badge por estado (verde ABIERTA / gris PAUSADA / rojo CERRADA) y rango salarial `S/`. Con `ats.manage`: form "Nueva vacante" y botón "Cerrar" por vacante.
- [ ] **Step 2:** Detalle `/ats/[id]`: candidatos con badge por etapa. Registro (con `ats.apply`): nombre, email, teléfono, CV en `<textarea>` y **checkbox obligatorio LPDP** (deshabilita submit si no está marcado) → `POST /ats/vacantes/:id/candidatos`.
- [ ] **Step 3:** Por candidato (con `ats.manage`): `<select>` de estado **solo con las transiciones válidas** desde el estado actual (APLICADO→REVISADO→ENTREVISTA→OFERTA→CONTRATADO/RECHAZADO; RECHAZADO desde cualquiera); notas internas (`POST …/notas`); `cvParseado` renderizado legible (experiencia, habilidades, formación, idiomas); botón "Contratar" **solo en OFERTA** → `PUT …/contratar`.
- [ ] **Step 4:** Verificar `tsc`. **Step 5: Commit** `feat(web): páginas de ATS - vacantes, candidatos, pipeline y CV parseado`.

---

### Task 6: Sección Administración

**Files:**
- Create: `apps/web/src/app/(app)/admin/page.tsx`
- Modify: `apps/web/src/lib/api-client.ts` (normative-params, audit-log, employees si falta)

**Interfaces:**
- Consumes: Task 1 + shapes de `normative-params.controller.ts` y `audit.controller.ts`.
- Produces: página autosuficiente con secciones condicionales por permiso.

- [ ] **Step 1:** Sección "Parámetros normativos" (si `normative_param.read`): tabla código / valor (JSON legible) / vigencia / descripción. Con `normative_param.write`: form "Nueva versión" con `JSON.parse` validado en cliente antes de enviar.
- [ ] **Step 2:** Sección "Auditoría" (si `audit_log.read`): tabla fecha / usuario / tabla / acción / registro, respetando los parámetros reales del endpoint.
- [ ] **Step 3:** Sección "Empleados": tabla de `GET /employees`.
- [ ] **Step 4:** Verificar `tsc`. **Step 5: Commit** `feat(web): página de administración - parámetros, auditoría y empleados`.

---

### Task 7: Verificación integral y cierre

**Files:**
- Modify: cualquier archivo de `apps/web/src/` que falle build (solo correcciones)

**Interfaces:**
- Consumes: todo lo anterior.
- Produces: build verde, suite backend intacta, navegación consistente.

- [ ] **Step 1:** `cd apps/web && pnpm exec tsc --noEmit` — limpio.
- [ ] **Step 2:** `cd apps/web && pnpm exec next build` — sin errores (vigilar: dos `page.tsx` compitiendo por `/`, imports rotos entre módulos, prerender de páginas client).
- [ ] **Step 3:** `pnpm --filter @rrhh/api test` — 182+ tests PASS (los preexistentes no se tocan).
- [ ] **Step 4:** Revisar que el sidebar enlace exactamente a las rutas existentes (`/asistencia`, `/nomina`, `/legajo`, `/ats`, `/admin`).
- [ ] **Step 5:** Prueba manual con los 3 usuarios demo: cada rol ve solo sus secciones (admin: todas; rrhh: sin escribir parámetros; empleado: solo Inicio + Asistencia + Legajo lectura).
- [ ] **Step 6: Commit final** — `git add -A && git commit -m "feat(web): frontend completo Fases 1-4 + admin" && git push origin master`.

---

## Self-Review (ejecutada)

- **Cobertura de spec:** §3 shell → Task 1; §4.1 → Task 2; §4.2 → Task 3; §4.3 → Task 4; §4.4 → Task 5; §4.5 → Task 6; §6 verificación → Task 7. Sin huecos.
- **Placeholders:** ninguno — cada step indica endpoint, permiso y comportamiento exacto; el código de contexto compartido (Task 1) está inline.
- **Consistencia de tipos:** `Me`, `useAuth`, `hasPermission`, `parseApiError`, `UnauthorizedError` definidos en Task 1 y consumidos con esos nombres exactos en Tasks 2–6.
