# Spec de Diseño: Frontend HRMS Perú (Fases 1–4 + Administración)

**Fecha:** 2026-07-14 · **Estado:** aprobada, en implementación (workflow multi-agente)
**Plan de implementación:** `docs/superpowers/plans/2026-07-14-frontend-fases1-4-plan.md`
**Prompt goal:** `goal-frontend.md` (raíz del repo)

---

## 1. Objetivo

Construir la capa web del HRMS sobre el backend ya operativo (25 endpoints, 182 tests), de modo que un usuario pueda operar los 4 módulos (Nómina, Asistencia, Legajo, ATS) y la administración sin usar la API a mano. La UI es en español (Perú), con navegación filtrada por permisos RBAC reales de la sesión.

## 2. Contexto y restricciones

- **Stack existente:** Next.js 14 App Router + TypeScript + Tailwind CSS en `apps/web`. Backend NestJS en `apps/api` (`http://localhost:3001/api`).
- **Autenticación:** cookie de sesión httpOnly (Redis). El JS del navegador nunca ve un token. CORS ya configurado con `credentials: include`.
- **Sin dependencias nuevas:** solo React/Next/Tailwind ya instalados. Nada de react-query, axios, ni ui-kits. (YAGNI: el fetch nativo con un wrapper basta.)
- **Estilo:** el slate minimalista de la página de login existente (`bg-white`, `border-slate-200`, `text-sm`, botones `bg-slate-900`). Consistencia sobre novedad.
- **Brecha del backend detectada:** no existía forma de que el frontend supiera quién está logueado ni con qué permisos → se agrega `GET /auth/me` (único cambio de backend de esta spec).

## 3. Arquitectura

### 3.1 Grupos de rutas

```
apps/web/src/app/
├── (auth)/login/page.tsx      ← existente, sin cambios
└── (app)/                     ← NUEVO grupo autenticado
    ├── layout.tsx             ← sidebar + header + AuthProvider
    ├── page.tsx               ← dashboard (tarjetas por módulo)   [ruta /]
    ├── asistencia/page.tsx    ← Fase 2
    ├── nomina/page.tsx        ← Fase 1
    ├── legajo/page.tsx        ← Fase 3
    ├── ats/page.tsx           ← Fase 4 (lista) + ats/[id]/page.tsx (detalle)
    └── admin/page.tsx         ← parámetros normativos + auditoría + empleados
```

La home pública anterior (`app/page.tsx`) se elimina: `/` pasa a ser el dashboard autenticado; sin sesión, el AuthProvider redirige a `/login`.

### 3.2 Sesión y permisos en el cliente

- `GET /auth/me` → `{ userId, tenantId, pgRole, permissions: string[] }` (lee `req.session`, protegido por el guard global; sin permiso adicional).
- `AuthProvider` (client component en el layout del grupo `(app)`): llama `getMe()` al montar; expone `{ me, loading, hasPermission(code) }` vía contexto. `401` → `router.replace('/login')`.
- **El RBAC del cliente es solo UX** (ocultar lo que no se puede usar); la autoridad real sigue siendo el backend (guard + RLS). Nunca se confía en el cliente.

### 3.3 Navegación filtrada por permisos

| Entrada del sidebar | Ruta | Permiso requerido |
|---|---|---|
| Inicio | `/` | (sesión) |
| Asistencia | `/asistencia` | `attendance.read` |
| Nómina | `/nomina` | `payroll.process` |
| Legajo | `/legajo` | `documents.read` |
| Reclutamiento | `/ats` | `ats.read` |
| Administración | `/admin` | `normative_param.write` o `audit_log.read` |

### 3.4 Cliente API

`apps/web/src/lib/api-client.ts` se extiende (no se duplica): una función tipada por endpoint, manejo uniforme de errores (`parseApiError` para el shape NestJS `{message}`), `UnauthorizedError` para 401, y tipos TS que reflejan el shape REAL de cada controller (verificado leyendo el código del backend, no inventado).

## 4. Diseño por sección

### 4.1 Asistencia (`/asistencia`)

- **Marcar asistencia:** botones ENTRADA/SALIDA → `navigator.geolocation` → `POST /attendance/marcaciones` con lat/lng. Estados visibles: aceptada ✓ / bloqueada con motivo / requiere autorización. GPS denegado → se envía sin coordenadas y se muestra la advertencia del backend (la marcación queda bloqueada por geofence: comportamiento correcto, no error de UI).
- **Resumen mensual:** selector de mes (default actual) → `GET /attendance/resumen/:periodo` → tabla fecha/entrada/salida/horas/tardanza/falta/justificado.
- **Justificaciones:** form (motivo, fecha, descripción) → `POST /attendance/justificaciones`. Con `attendance.approve`: lista de pendientes con Aprobar/Rechazar (rechazo exige motivo) → `PUT /attendance/justificaciones/:id/resolver`.
- **Dashboard de equipo** (con `attendance.read.team`): `GET /attendance/dashboard/:periodo`.

### 4.2 Nómina (`/nomina`)

- Selector de período + **"Procesar planilla"** con confirmación explícita (es una acción de negocio con efectos) → `POST /payroll/:periodo/procesar` → estado de planilla resultante y detalle si la API lo retorna.
- Botones **Exportar PLAME (E18)** y **telecrédito BCP**: los endpoints hoy retornan stub `{mensaje}` — la UI muestra ese mensaje como "pendiente de conexión a BD", **sin inventar datos**.
- Tarjeta informativa de los conceptos que calcula el motor (CTS, gratificación, AFP/ONP, EsSalud, asignación familiar, quinta, utilidades, liquidación).

### 4.3 Legajo (`/legajo`)

- Selector de empleado (`GET /employees`) → vista de legajo (`GET /documents/legajo/:employeeId`): documentos agrupados por tipo, tipos faltantes destacados.
- Subida (con `documents.upload`): tipo + archivo → `POST /documents` (con el encoding que el controller realmente acepta).
- Descarga como blob con nombre original (`GET /documents/:id/download`); eliminación (con `documents.delete`) **exige motivo** → `DELETE /documents/:id` (soft-delete Ley 29733).
- Búsqueda por tipo y rango de fechas (`GET /documents/search`).

### 4.4 Reclutamiento (`/ats` y `/ats/[id]`)

- Lista de vacantes con badge de estado (ABIERTA/PAUSADA/CERRADA) y rango salarial. Con `ats.manage`: crear vacante y cerrarla.
- Detalle: candidatos con badge por etapa del pipeline. Registro de candidato (con `ats.apply`): nombre, email, teléfono, CV en texto y **checkbox obligatorio de consentimiento LPDP** (Ley 29733) — sin marcar, el botón no envía.
- Por candidato (con `ats.manage`): cambio de estado limitado a las **transiciones válidas** desde el estado actual (APLICADO→REVISADO→ENTREVISTA→OFERTA→CONTRATADO/RECHAZADO; rechazo desde cualquiera), notas internas, CV parseado renderizado legible (experiencia/habilidades/formación/idiomas), y **Contratar** visible solo en estado OFERTA.

### 4.5 Administración (`/admin`)

- **Parámetros normativos** (`normative_param.read`): tabla código/valor/vigencia/descripción. Con `normative_param.write`: form "nueva versión" con JSON validado en cliente.
- **Auditoría** (`audit_log.read`): tabla fecha/usuario/tabla/acción/registro.
- **Empleados:** tabla de `GET /employees`.

## 5. Manejo de errores y estados

- Toda llamada muestra error legible en la UI (mensaje del backend vía `parseApiError`); nunca `console.log` silencioso.
- Estados de carga: texto "Cargando…" simple (sin spinners custom — YAGNI).
- 401 en cualquier página → redirect a `/login` (vía AuthProvider o `UnauthorizedError`).
- 403 → mensaje "No tienes permiso para…" (defensa en profundidad: normalmente el elemento ni se muestra).

## 6. Testing y verificación

- El repo no tiene infraestructura de tests de frontend; **la barra de verificación es**: `tsc --noEmit` limpio + `next build` sin errores + los 182 tests del backend intactos (el cambio de `/auth/me` puede sumar tests al módulo auth).
- Verificación funcional manual con los 3 usuarios demo (admin/rrhh/empleado) — cada rol debe ver solo sus secciones.

## 7. Fuera de alcance (iteraciones siguientes — ver goal-frontend.md)

- Kanban drag-and-drop del pipeline ATS; portal público de empleo.
- Mapa interactivo para configurar geofence; expediente de inspección SUNAFIL.
- Portal de autoservicio (ESS) con descarga de boletas; workflow de firma digital.
- Dashboard de planilla con validaciones previas (trabajadores sin cuenta, montos atípicos).
- Ficha de alta de trabajador (el alta hoy es por seed/API).
