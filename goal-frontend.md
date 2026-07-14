# GOAL: Frontend Web del HRMS Perú (Fases 1–4 + Administración)

## Objetivo

Construir la capa web completa del HRMS sobre el backend ya operativo (NestJS, 25 endpoints, 182 tests, multi-tenant con RLS), de modo que RRHH, gerentes y colaboradores operen los 4 módulos sin tocar la API a mano. La UI debe reflejar los permisos RBAC reales de la sesión: cada usuario ve exactamente lo que puede hacer, y nada más.

## Contexto técnico (no negociable)

- **Stack:** Next.js 14 App Router + TypeScript + Tailwind CSS, ya instalados en `apps/web`. **Prohibido agregar dependencias** (nada de react-query, axios, ui-kits): el fetch nativo con el wrapper `apiFetch` existente basta.
- **Autenticación:** cookie de sesión httpOnly contra `http://localhost:3001/api` con `credentials: include`. El JavaScript del navegador **nunca** maneja un token.
- **Fuente de verdad de los contratos:** los controllers reales en `apps/api/src/modules/<modulo>/`. Está prohibido inventar shapes de request/response: se leen del código del backend. Si un endpoint retorna un stub (los exports de nómina), la UI muestra ese estado tal cual, sin datos falsos.
- **El RBAC del cliente es solo UX.** Ocultar botones no es seguridad; la autoridad es siempre el backend (guards + RLS). Nunca asumir que ocultar algo lo protege.
- **Estilo:** slate minimalista de la página de login existente. Consistencia sobre novedad.
- **Idioma:** toda la UI en español (Perú). Moneda S/, fechas dd/mm/aaaa, zona horaria America/Lima.

## Módulo 0: Shell autenticado

1. **`GET /auth/me`** en la API (único cambio de backend permitido): retorna `{userId, tenantId, pgRole, permissions}` desde la sesión.
2. **AuthProvider** en el grupo de rutas `(app)`: carga la identidad al montar, expone `hasPermission(code)`, y redirige a `/login` ante 401.
3. **Layout con sidebar** filtrado por permisos: Inicio (siempre), Asistencia (`attendance.read`), Nómina (`payroll.process`), Legajo (`documents.read`), Reclutamiento (`ats.read`), Administración (`normative_param.write` o `audit_log.read`). Header con rol visible y "Cerrar sesión".
4. **Dashboard de inicio**: tarjetas por módulo con los mismos filtros de permiso.

## Módulo 1: Nómina (`/nomina`)

- **Página "Procesar planilla"**: selector de período, confirmación explícita antes de procesar (es una acción de negocio con efectos), resultado visible con estado de la planilla.
- **Exportaciones**: botones PLAME (E18) y telecrédito BCP. Mientras los endpoints retornen stub, mostrar el aviso "pendiente de conexión a BD" — jamás datos inventados.
- **Iteración siguiente**: dashboard del ciclo (Registrado → Procesado → Cerrado) con validaciones previas (trabajadores sin cuenta bancaria, sin régimen pensionario, montos atípicos) y ficha de alta de trabajador con los campos obligatorios por ley.

## Módulo 2: Asistencia (`/asistencia`)

- **Marcación con GPS del navegador**: botones ENTRADA/SALIDA → `navigator.geolocation` → el backend valida geofence/biometría/secuencia. La UI distingue tres resultados: aceptada, bloqueada (con motivo SUNAFIL visible) y requiere autorización. GPS denegado no es un error de UI: se envía sin coordenadas y se muestra el bloqueo del backend.
- **Resumen mensual**: tabla por día (entrada, salida, horas, tardanza, falta, justificado) con selector de mes.
- **Justificaciones**: crear solicitud (motivo, fecha, descripción); con `attendance.approve`, bandeja de pendientes con Aprobar/Rechazar (rechazo exige motivo).
- **Dashboard de equipo** (con `attendance.read.team`): vista gerencial del período.
- **Iteración siguiente**: mapa interactivo para configurar el radio de geofence por sede; expediente de inspección SUNAFIL (export masivo PDF/Excel).

## Módulo 3: Legajo (`/legajo`)

- **Vista de legajo por empleado**: documentos agrupados por tipo con los tipos faltantes destacados (completitud del expediente visible de un vistazo).
- **Subida** (con `documents.upload`) respetando el encoding que el controller acepta; **descarga** como blob con el nombre original; **eliminación** (con `documents.delete`) que exige motivo — es soft-delete por Ley 29733 y la UI lo comunica.
- **Búsqueda** por tipo y rango de fechas.
- **Iteración siguiente**: portal de autoservicio (ESS) para que el colaborador descargue sus boletas; workflow de firma digital con monitor de pendientes.

## Módulo 4: Reclutamiento (`/ats`)

- **Lista de vacantes** con estado (badge) y rango salarial; crear y cerrar vacantes con `ats.manage`.
- **Detalle de vacante**: registro de candidato con CV en texto y **checkbox obligatorio de consentimiento LPDP** (sin marcar, no se envía — Ley 29733). El backend parsea el CV con Claude API; la UI muestra el resultado estructurado legible (experiencia, habilidades, formación, idiomas).
- **Pipeline**: cambio de estado limitado a las transiciones válidas (APLICADO→REVISADO→ENTREVISTA→OFERTA→CONTRATADO/RECHAZADO; rechazo desde cualquiera). "Contratar" visible solo en OFERTA (vincula con Employee, D.Leg. 728). Notas internas por candidato.
- **Iteración siguiente**: tablero Kanban drag-and-drop; portal público de empleo con marca de la empresa.

## Módulo 5: Administración (`/admin`)

- **Parámetros normativos**: tabla con vigencias; con `normative_param.write`, form "nueva versión" (JSON validado en cliente). Nunca editar versiones anteriores — el motor es de vigencias.
- **Auditoría**: tabla del log inmutable (fecha, usuario, tabla, acción).
- **Empleados**: listado del tenant.

## Requisitos no funcionales

- **Errores siempre visibles**: toda llamada fallida muestra el mensaje del backend en la UI (formato NestJS `{message}`); nada de fallos silenciosos en consola.
- **Estados de carga** explícitos ("Cargando…").
- **401 → `/login`** desde cualquier página; **403 → mensaje claro** (defensa en profundidad: el elemento normalmente ni se muestra).
- **Verificación**: `tsc --noEmit` limpio y `next build` sin errores como barra mínima por tarea; la suite backend (182 tests) queda intacta. Prueba manual con los 3 usuarios demo — cada rol ve solo sus secciones.

## Plan de ejecución

1. **Shell** (Módulo 0) — primero y secuencial: todo lo demás depende del AuthProvider y el layout.
2. **Módulos 1–5 en paralelo** — carpetas separadas (`asistencia/`, `nomina/`, `legajo/`, `ats/`, `admin/`), sin conflictos de archivos.
3. **Verificación integral** — build + tests + consistencia de navegación + prueba manual por rol.
4. Commits atómicos en español (`feat(web): …`); push al terminar la verificación.

Documentos de soporte:
- Spec de diseño: `docs/superpowers/specs/2026-07-14-frontend-fases1-4-design.md`
- Plan por tareas: `docs/superpowers/plans/2026-07-14-frontend-fases1-4-plan.md`
- Contratos de API: `docs/RESUMEN_SISTEMA.md`

## Criterios de aceptación

- Un usuario `rrhh@demo.pe` puede, solo desde el navegador: marcar asistencia con GPS, ver su resumen mensual, aprobar una justificación, procesar la planilla del mes, subir un contrato al legajo de un empleado, crear una vacante, registrar un candidato con consentimiento LPDP y moverlo por el pipeline hasta contratarlo.
- Un usuario `empleado@demo.pe` ve únicamente Inicio, Asistencia y Legajo (lectura); no existe en su UI ningún botón de nómina, ATS ni administración.
- `next build` compila sin errores y los 182 tests del backend siguen en verde.
- Ninguna pantalla muestra datos inventados: lo que el backend no retorna todavía, la UI lo declara como pendiente.
