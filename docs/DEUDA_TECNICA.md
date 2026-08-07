# Deuda Técnica — Sistema HRMS Perú

**Versión:** v1.5.0 MVP  
**Fecha:** Agosto 7, 2026  
**Estado:** MVP OPERATIVO — Deuda técnica minimizada para producción

---

## 📊 Clasificación de Deuda

**Total identificado:** 12 items  
- ✅ **Bloqueante:** 0 (resuelto)
- ⏳ **Importante (Sprint siguiente):** 3
- 📋 **Menor (Backlog):** 9

---

## 🚨 Bloqueante (Severity 0)

**Ninguno.** Todos los blockers críticos para MVP fueron resueltos:
- [x] Tests con fechas hardcodeadas (Sprints 6-7)
- [x] Webpack Image component error (login redesign)
- [x] ATS dependencia Claude API → simplificado a MVP manual

---

## ⏳ Importante — Próximo Sprint

### 1. **Conectar Exportes PLAME/Telecrédito a BD Real**
- **Archivo:** `apps/api/src/modules/payroll/export/*.service.ts`
- **Estado:** Endpoints existen pero hardcodean datos; no leen de `payroll_detail`
- **Impacto:** Exportadores SUNAT/BCP devuelven placeholders, no datos reales
- **Esfuerzo:** 2-3 días (service + 4-5 tests)
- **Dependencia:** Estructura de `payroll_detail` confirmada en Fase 1
- **Prioridad:** ALTA — bloqueador de integración con gobiernos/bancos

### 2. **Mapeo Automático Sistema Biométrico Chino**
- **Archivo:** `apps/api/src/modules/attendance/biometric-import.service.ts`
- **Estado:** Template CSV existe pero no hay mapeo de formato externo (a la espera del archivo de ejemplo)
- **Impacto:** Import manual desde relojes requiere normalización previa en Excel
- **Esfuerzo:** 1-2 días (parser + tests, depende del formato)
- **Bloqueador:** Ejemplo de archivo de exportación del reloj chino
- **Prioridad:** MEDIA — afecta productividad RRH

### 3. **Configuración ANTHROPIC_API_KEY para ATS**
- **Archivo:** `apps/api/src/modules/ats/cv-parser.service.ts`
- **Estado:** Parser de CV implementado pero deshabilitado (key no configurada)
- **Impacto:** ATS simplificado a MVP sin parsing automático
- **Esfuerzo:** 30 min (env var + test con mock)
- **Bloqueador:** Clave API pagada + evaluación de costos
- **Prioridad:** BAJA → MVP con formulario manual es funcional; IA es mejora futura
- **Nota:** Usuario decidió deshabilitar por costo (no cargar a empresa)

---

## 📋 Menor — Backlog Técnico

### 4. **Firmas Digitales en Documentos**
- **Módulo:** Documental (Fase 3)
- **Descripción:** Validación de integridad y trazabilidad (certificados X.509, timestamps notariales)
- **Esfuerzo:** 5-7 días
- **Prioridad:** BAJA — no mandatario en MVP; requerimiento futuro de auditoría

### 5. **Kanban Visual para ATS**
- **Módulo:** Reclutamiento (Fase 4)
- **Descripción:** Pipeline visual (drag-drop entre estados: APLICADO → REVISADO → ENTREVISTA → OFERTA)
- **Esfuerzo:** 3-4 días (frontend + react-dnd)
- **Prioridad:** BAJA — funcionalidad existe en tabla; UI es cosmético

### 6. **Exportadores Bancarios Adicionales**
- **Módulo:** Nómina (Fase 1)
- **Descripción:** Archivos de pago para BBVA, Interbank, Scotiabank (actualmente solo BCP)
- **Esfuerzo:** 1-2 días por banco (template + tests)
- **Prioridad:** MEDIA → depende de expansión comercial

### 7. **Estructuras SUNAT Adicionales**
- **Módulo:** Nómina (Fase 1)
- **Descripción:** Implementar E04, E05, E11, E14, E15, E26, E30 (actualmente solo E18)
- **Esfuerzo:** 1 día por estructura (~1h mapper + validaciones)
- **Prioridad:** BAJA → E18 cubre casos generales; otros son especializados

### 8. **Notificaciones por Email**
- **Módulo:** Multi-módulo (turnos, justificaciones, intercambios, etc.)
- **Descripción:** Emails transaccionales para cambios de estado (solicitud aprobada/rechazada, pendiente aprobación, etc.)
- **Estado actual:** Notificaciones in-app existe; email es placeholder
- **Esfuerzo:** 2-3 días (queue + email template service + tests)
- **Prioridad:** MEDIA → mejora UX; MVP con in-app es suficiente

### 9. **Auditoría UI (drill-down)**
- **Módulo:** Admin
- **Descripción:** Vista detallada de cambios: quién cambió qué, cuándo, valores antes/después (ahora es tabla cruda)
- **Esfuerzo:** 2-3 días (frontend con filtros + paginación)
- **Prioridad:** BAJA → funcionalidad existe; UI es mejora de usabilidad

### 10. **Sincronización en Tiempo Real (WebSocket)**
- **Módulo:** Turnos, Intercambios
- **Descripción:** Notificaciones live cuando manager aprueba cambio (sin refrescar página)
- **Esfuerzo:** 2-3 días (Socket.IO setup + frontend listeners)
- **Prioridad:** BAJA → polling/refresho manual es suficiente para MVP

### 11. **Validación de Foto en Trabajo Extra**
- **Módulo:** Turnos Feature 3
- **Descripción:** Detección automática de timestamp visible en imagen (OCR) vs. validación manual
- **Estado:** Validación manual implementada; OCR es mejora
- **Esfuerzo:** 3-4 días (Tesseract.js + tests)
- **Prioridad:** BAJA → MVP valida manualmente

### 12. **Performance: Índices de BD Adicionales**
- **Módulo:** Database
- **Descripción:** Índices en búsquedas frecuentes (asistencia por período, nómina por empleado, documentos por tipo)
- **Estado:** Índices básicos existen; fine-tuning posible
- **Esfuerzo:** 1 día (análisis con EXPLAIN ANALYZE + creación)
- **Prioridad:** BAJA → no hay problemas de latencia en 5k empleados; escalar si es necesario

---

## 🔄 Gestión de Deuda

### Política de nuevo código
- **TDD obligatorio:** Todo código nuevo debe incluir tests
- **Cobertura mínima:** 80% por módulo
- **Deuda al crear:** Registrar en PR description si se incurre en deuda técnica temporal
- **Revisión trimestral:** Cada 3 meses, evaluar top-3 items del backlog vs. nuevos requisitos

### Refactoring programado
- **Agosto 2026:** Pausa (MVP acaba de completarse)
- **Septiembre 2026:** Sprint de deuda — items 6-9 (mejoras UX/cosmético)
- **Octubre 2026:** Sprint de exportadores — items 1, 6-7 (integración SUNAT/bancos)

---

## 📈 Deuda Por Módulo

| Módulo | Items | Criticidad | Esfuerzo (días) |
|--------|-------|-----------|-----------------|
| Nómina | 1, 6, 7 | Alta | 4-5 |
| Asistencia | 2 | Media | 1-2 |
| ATS | 3, 5 | Baja | 4 |
| Turnos | Ninguno | — | — |
| Documental | 4 | Baja | 5-7 |
| Admin | 9 | Baja | 2-3 |
| Infraestructura | 8, 10, 12 | Baja | 6-8 |

---

## 🎯 Recomendaciones

1. **Inmediato (Semana 1 agosto):**
   - Item 1: Conectar exportes PLAME/Telecrédito
   - Razón: Bloqueador de integración regulatoria

2. **Corto plazo (Semana 2-3 agosto):**
   - Item 2: Esperando formato biométrico externo
   - Item 3: Evaluar costo API Claude vs. MVP manual

3. **Medio plazo (Septiembre-Octubre):**
   - Items 6, 7: Expansión comercial (otros bancos + estructuras SUNAT)
   - Item 8: Notificaciones email (mejora UX)

4. **Largo plazo (Backlog):**
   - Items 4, 5, 9, 10, 11, 12: Mejoras de cosmético/performance

---

**Documento actualizado:** 2026-08-07  
**Responsable:** Equipo de Desarrollo  
**Revisión próxima:** 2026-11-07
