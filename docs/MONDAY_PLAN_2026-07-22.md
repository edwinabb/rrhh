# Plan de Continuación — Lunes 2026-07-22

## Objetivo
Iniciar implementación de Turnos Fases 6-9 (4 features de autoservicio y gestión avanzada).

---

## Pre-requisitos (viernes 17/07 — COMPLETADO)
- [x] Diseño spec aprobado: `docs/superpowers/specs/2026-07-18-turnos-mejoras-phase-6-9.md`
- [x] Plan de implementación creado: `docs/superpowers/plans/2026-07-18-turnos-mejoras-phase-6-9.md`
- [x] Documentación actualizada (RESUMEN_SISTEMA.md, PENDIENTES.md)
- [x] Versión bump: 1.0.0 → 1.1.0
- [x] Commit y push a GitHub

---

## Lunes 2026-07-22: Kickoff Sprint 6 (Patrones de Rotación)

### Sesión matutina (09:00–12:30)

**1. Revisión de plan (10 min)**
- Revisar `docs/superpowers/plans/2026-07-18-turnos-mejoras-phase-6-9.md`
- Confirmar Task 1 (schema + migration) está claro
- Responder preguntas de ambigüedad antes de iniciar

**2. Crear rama de feature (5 min)**
```bash
git checkout master
git pull origin master
git checkout -b feat/turnos-patrones-fase-6
```

**3. Ejecutar Sprint 6 con subagent-driven-development (REQUERIDO)**
- Usar skill: `superpowers:subagent-driven-development`
- Ejecutar Tasks 1-9 secuencialmente con fresh subagent per task
- Cada task: implementer → reviewer → complete
- Expected: 9 tasks × ~30-45 min promedio = ~5 horas de wall-clock (incluye review loops)

**Task checklist para Sprint 6:**
- [ ] Task 1: Backend - Modelo `RotacionPatron` + Migration
- [ ] Task 2: Backend - `RotacionPatronService` (CRUD)
- [ ] Task 3: Backend - `RotacionAplicadorService` (bulk injection)
- [ ] Task 4: API Controller - `POST /turnos/patrones`, `GET /turnos/patrones`, etc.
- [ ] Task 5: API Tests - Integration tests for all endpoints
- [ ] Task 6: Frontend - Catalog page (crear/editar patrones)
- [ ] Task 7: Frontend - Apply pattern tab (multi-select empleados, preview, inyectar)
- [ ] Task 8: Frontend - Notifications integration
- [ ] Task 9: E2E Manual verification (crear patrón, aplicar a empleados, verificar plan)

### Sesión vespertina (14:00–17:30, si sprint 6 termina antes)

**4. Lanzar Sprint 7 (si queda tiempo)**
- Cambios de Turno (15 tareas)
- Same pattern: subagent-driven-development
- Expected: 4-6 tareas completadas si Sprint 6 finaliza antes de 13:00

---

## Hitos por día

| Día | Sprint | Meta |
|-----|--------|------|
| 22/07 (Lunes) | 6 | Tasks 1-5 (backend complete) |
| 23/07 (Martes) | 6 | Tasks 6-9 (frontend + E2E complete) |
| 24/07 (Miércoles) | 7 | Tasks 1-8 (cambios de turno backend + UI) |
| 25/07 (Jueves) | 7 | Tasks 9-15 (cambios completo), kickoff Sprint 8 |
| 26/07 (Viernes) | 8+9 | Sprints 8 y 9 en paralelo (mitad por day) |

---

## Criterios de éxito por Sprint

### Sprint 6 (Patrones)
- ✅ `POST /turnos/patrones/:id/aplicar` inyecta masivamente sin errores
- ✅ UI tab "Patrones" muestra creación + aplicación
- ✅ Plan se actualiza correctamente (upsert)
- ✅ 18/18 tests pasando
- ✅ Notificaciones enviadas a empleados

### Sprint 7 (Cambios)
- ✅ Empleado solicita cambio → Manager ve PENDIENTE → aprueba/rechaza
- ✅ Rechazo permite reintentos
- ✅ Plan se actualiza al aprobar
- ✅ 15/15 tests pasando

### Sprint 8 (Trabajo Extra)
- ✅ Empleado reporta con fotos + timestamp
- ✅ Fotos validadas (timestamp visible en imagen)
- ✅ Director/RRHH ve datos privados solo ellos
- ✅ Genera compensatorio correctamente
- ✅ 20/20 tests pasando

### Sprint 9 (Intercambios)
- ✅ Empleado A propone → Empleado B ve + acepta/rechaza
- ✅ Manager aprueba swap
- ✅ Intercambio es neutral (no genera movimiento compensatorio)
- ✅ 15/15 tests pasando

---

## Notas operativas

**Subagent-driven-development:**
- Skill requerida: `superpowers:subagent-driven-development`
- Subagent fresco por task (no context pollution)
- Review automática post-task (spec ✅ + code quality ✅)
- Review loops para Critical/Important findings
- Merge a `feat/turnos-patrones-fase-6` (no directamente a master)

**Tests:**
- All 9 tests passing before merging Task N
- Integration tests required for API endpoints
- No E2E en Superpowers (manual verificación al final del sprint)

**Commits:**
- Frequent commits por task (TDD: red → green → refactor → commit)
- Message format: `feat(patrones): descripción`

**Documentation:**
- Code comments: solo WHY, no WHAT
- Update RESUMEN_SISTEMA.md post-Sprint 6 con endpoints finales

---

## Cuello de botella / Riesgos

| Riesgo | Mitigación |
|--------|------------|
| Schema migration compleja | Start early Monday, have Prisma docs ready |
| Photo timestamp validation | Frontend library research (demo en viernes si falta) |
| Performance en bulk injection | Profile con > 100 empleados; agregar índices si falta |
| Notification timing | Use existing NotificationService; test con seed users |

---

## Métricas de cierre

- **Commits:** ~40-50 commits totales (TDD + frequent)
- **Tests:** 80+ tests nuevos (18 + 15 + 20 + 15)
- **Ramas:** 1 rama feat/turnos-patrones-fase-6 (Sprint 6), rebase a master después
- **Docs:** RESUMEN_SISTEMA.md + PENDIENTES.md actualizados
- **Version:** 1.1.0 (ya bumped)

---

## Comandos de referencia

```bash
# Setup lunes mañana
git checkout master && git pull origin master
git checkout -b feat/turnos-patrones-fase-6

# Run tests (after each task)
pnpm --filter @rrhh/api test

# Build check
pnpm --filter @rrhh/api build
pnpm --filter @rrhh/web build

# View plan
cat docs/superpowers/plans/2026-07-18-turnos-mejoras-phase-6-9.md | head -100

# Merge a master (después de 4 sprints)
git checkout master
git pull origin master
git merge --no-ff feat/turnos-patrones-fase-6
```

---

*Documento generado: 2026-07-18. Próxima revisión: Lunes 2026-07-22 09:00.*
