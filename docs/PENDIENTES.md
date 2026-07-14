# Pendientes y Plan de Trabajo

**Actualizado:** 2026-07-14 (fin de jornada) · **Estado del sistema:** todo verde — 208 tests, frontend completo, deploy local operativo.

---

## 🎯 Plan de mañana (2026-07-15)

Prioridad sugerida, en orden:

### 1. Conectar los exportes de nómina a la BD real ⭐ (mayor valor, ~medio día)
Los endpoints `GET /payroll/:periodo/export/plame` y `/export/telecredito` hoy retornan un stub `{mensaje}`. Los servicios `PlanillaExporter` (Estructura 18) y `BankFileExporter` (BCP) ya existen y están testeados — falta el cableado:
- Leer `PLANILLA_DETALLE` del período procesado + `CuentaBancaria` de cada empleado
- Mapear conceptos internos a códigos SUNAT (catálogo `Concepto`)
- Retornar el archivo como descarga (`text/plain`, `Content-Disposition`)
- Actualizar la UI de `/nomina` para descargar el archivo real
- **Criterio de aceptación:** procesar julio 2026 con las novedades ya importadas y descargar un E18 y un telecrédito con los 3 empleados demo

### 2. Mapeo del sistema biométrico chino (bloqueado: falta el archivo)
El usuario va a conseguir el formato real del export del reloj. Cuando llegue:
- Agregar modo de mapeo en `AttendanceImportService` (detectar columnas, formato fecha/hora, separador)
- Idealmente autodetección de formato en el mismo `POST /attendance/import`

### 3. Configurar `ANTHROPIC_API_KEY` real (~15 min, requiere la key del usuario)
El `.env` tiene un placeholder. Sin key real, el parsing de CVs en ATS falla (el resto del flujo funciona). Probar el registro de un candidato con CV real tras configurarla.

### 4. Validaciones previas al procesar planilla (si queda tiempo)
Dashboard del ciclo con advertencias antes de procesar: trabajadores sin cuenta bancaria, sin régimen pensionario, montos atípicos (ya descrito en `goal.md` Módulo 1).

---

## 📋 Backlog priorizado (después de mañana)

### Nómina
- [ ] Estructuras SUNAT adicionales: E04, E05, E11, E14, E15, E26, E30 (T-Registro/PLAME completos)
- [ ] Exportadores bancarios BBVA, Interbank, Scotiabank (arquitectura ya extensible)
- [ ] Provisiones mensuales (CTS, gratificaciones, vacaciones) con asiento contable exportable
- [ ] Ficha de alta de trabajador en el frontend (hoy el alta es por seed/API)
- [ ] Boletas de pago (PDF) por empleado

### Asistencia
- [ ] Confirmar valores normativos marcados "sin confirmar" en el seed (UIT, RMV, tasas) contra fuente oficial — ver `docs/superpowers/specs/validaciones-normativas-pendientes.md`
- [ ] Mapa interactivo para configurar geofence por sede
- [ ] Expediente de inspección SUNAFIL (export masivo 5 años, PDF/Excel, <30s)
- [ ] Vacaciones: programación, control de 30 días, alertas de vencimiento
- [ ] Flujo de aprobación de sobretiempo (jefe valida horas extra antes de nómina)

### Documental
- [ ] Firma digital certificada (Ley 27269) con proveedor acreditado — interfaz abstracta
- [ ] Workflow de firma masiva con monitor de pendientes
- [ ] Portal de autoservicio (ESS): el colaborador descarga sus boletas y certificados
- [ ] Políticas de retención diferenciadas (20 años salud ocupacional)

### ATS
- [ ] Scoring automático de candidatos con Claude (ajuste al perfil, killer questions)
- [ ] Tablero Kanban drag-and-drop del pipeline
- [ ] Portal público de empleo con marca de la empresa
- [ ] Pre-poblar Ficha de Alta al contratar

### Técnico / Deuda
- [ ] Tests de frontend (no existe infraestructura; hoy la barra es tsc + next build)
- [ ] UI para cambiar de rol activo cuando un usuario tiene varios (deuda declarada en Fase 0)
- [ ] Job de retención de documentos (hard-delete a 90 días, Ley 29733)
- [ ] Nunca ejecutar `next build` con el dev server corriendo (comparten `.next` y se corrompe — pasó el 2026-07-14)
- [ ] CI/CD (GitHub Actions: tests + build en cada push)

---

## 🔑 Contexto operativo (para retomar la sesión)

- **Levantar todo:** `docker-compose up -d` → API: `pnpm --filter @rrhh/api dev` (:3001) → Web: `pnpm --filter @rrhh/web dev` (:3000)
- **BD:** migraciones al día (7), seed idempotente (`cd packages/database && pnpm run seed`)
- **Usuarios demo:** `admin@demo.pe`/`Admin123!` · `rrhh@demo.pe`/`Rrhh123!` · `empleado@demo.pe`/`Empleado123!`
- **Datos de prueba cargados:** 3 empleados con contrato y régimen pensionario, 1 vacante ATS, marcaciones del 13/07 importadas por CSV (con horas extra calculadas), novedades de julio importadas
- **Documentos clave:** `goal.md` y `goal-frontend.md` (prompts de objetivo), `docs/RESUMEN_SISTEMA.md` (contratos de API), `docs/superpowers/specs/` y `plans/` (diseños y planes por fase)
