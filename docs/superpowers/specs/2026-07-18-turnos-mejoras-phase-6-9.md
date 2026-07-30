# Turnos: Mejoras Fase 6-9 (Autoservicio + Gestión Avanzada)

> **Especificación de diseño:** 4 features independientes con tabs dedicados, usuarios distintos por feature, flujos de aprobación integrados.
>
> **Versión:** 1.0.0 (v1.0.0 del HRMS finaliza v1.0 del módulo core; estas mejoras son fase 6-9)
>
> **Fecha:** 2026-07-18 · **Estado:** Diseño aprobado, pendiente implementación

---

## 1. Resumen Ejecutivo

El módulo de Turnos (v1.0.0) proporciona gestión básica: catálogo, plan, compensatorios e integración con asistencia. Esta especificación extiende con 4 features de autoservicio y gestión avanzada:

| # | Feature | Usuario Primario | Entrada | Output | Impacto |
|---|---------|------------------|---------|--------|---------|
| 1 | Autogeneración de patrones | Manager | Patrón + empleados + período | Plan masivo inyectado | Eficiencia operacional |
| 2 | Cambios de turno | Empleado | Fecha + turno solicitado + motivo | Turno modificado/rechazado | Flexibilidad laboral |
| 3 | Trabajo fuera de turno | Empleado/Manager | Tarea + fecha + horas | Compensatorio/overtime registrado | Auditoría de sobrecarga |
| 4 | Intercambios autoservicio | Empleado | Empleado B + fecha | Turnos intercambiados | Negociación peer-to-peer |

**Principios de diseño:**
- Cada feature es un **tab independiente** en la UI `/turnos`
- Usuarios distintos acceden diferentes vistas (filtradas por RBAC)
- Flujos de aprobación **separados pero coordinados** (Manager es punto de validación)
- Notificaciones por email + in-app para cada estado
- Auditoría completa (quién, cuándo, decisión, motivo si aplica)

---

## 2. Feature 1: Autogeneración de Patrones de Rotación

### 2.1 Objetivo
Manager define un patrón recurrente (ej: 2 DIA + 2 NOCHE + 2 DESC + 1 DESC = ciclo 7 días) e inyecta masivamente al plan de múltiples empleados para un período.

### 2.2 Actores y Permisos
- **Manager/Director:** `shift.manage` - puede crear, editar, aplicar patrones
- **Empleado:** `shift.read` - puede visualizar patrones aplicados (no modificar)

### 2.3 Modelos de Datos

```typescript
RotacionPatron {
  id: string (UUID)
  tenantId: string
  nombre: string              // "2-2-2-1"
  descripcion?: string        // "2 DIA + 2 NOCHE + 2 DESC + 1 DESC"
  secuencia: TipoDiaPlan[]   // [DIA, DIA, NOCHE, NOCHE, DESC, DESC, DESC]
  duracionCiclo: number       // 7
  activo: boolean
  creadoEn: DateTime
  creadoPor: string
  actualizadoEn?: DateTime
  actualizadoPor?: string
}
```

### 2.4 Endpoints API

```
POST   /turnos/patrones                    [shift.manage]
       Crear patrón
       Input: { nombre, descripcion?, secuencia, duracionCiclo }
       Output: RotacionPatron

GET    /turnos/patrones                    [shift.read]
       Listar patrones activos
       Output: RotacionPatron[]

PUT    /turnos/patrones/:id                [shift.manage]
       Editar patrón
       Input: { nombre?, descripcion?, secuencia?, activo? }
       Output: RotacionPatron

POST   /turnos/patrones/:id/aplicar        [shift.manage]
       Inyectar patrón a empleados (bulk upsert)
       Input: {
         employeeIds: string[]
         desde: Date
         hasta: Date
         diaInicioCiclo: Date    // Lunes de la semana de inicio
         ajustes?: { fecha: Date, tipoDia: TipoDiaPlan }[]
       }
       Output: { procesadas: number, errores: ErrorInyeccion[] }
```

### 2.5 Flujo Principal

1. **Manager crea patrón:** Nombre + secuencia (7 días) → Guardar en catálogo
2. **Manager aplica patrón:**
   - Selecciona empleados (multi-select)
   - Rango de fechas (desde/hasta)
   - Día de inicio del ciclo (Lunes)
   - Vista previa muestra grilla 30 días
3. **Manager ajusta (opcional):** Edita celdas individuales antes de inyectar
4. **Sistema inyecta:** Upsert masivo de `turnoAsignacion` registros
5. **Notificación:** Email a empleados "Tu plan fue actualizado usando patrón [nombre]"

### 2.6 Validaciones
- Secuencia debe tener 7 elementos (1 por día de semana)
- Duración ciclo = 7
- Período de inyección no puede estar en el pasado (desde >= hoy)
- Empleados deben estar activos (no cesados)
- Si empleado ya tiene plan en esas fechas → upsert sobrescribe (no error)

### 2.7 Auditoría
- Registra: patrón_id, empleados_inyectados, período, quién, cuándo
- Permite rollback manual via edición individual de celdas

---

## 3. Feature 2: Cambios de Turno - Solicitud y Aprobación

### 3.1 Objetivo
Empleado solicita cambiar un turno específico (reemplazar por otro turno o descanso). Manager aprueba o rechaza. Si rechaza, empleado puede reintentar.

### 3.2 Actores y Permisos
- **Empleado:** `shift.read` - solicita cambios propios
- **Manager:** `shift.manage` - aprueba/rechaza solicitudes

### 3.3 Modelos de Datos

```typescript
SolicitudCambioTurno {
  id: string (UUID)
  tenantId: string
  employeeId: string
  fecha: Date
  turnoActual: TipoDiaPlan       // qué tiene asignado
  turnoSolicitado: TipoDiaPlan   // qué quiere
  motivo?: string                 // "Médico", "Personal", etc.
  
  estado: 'PENDIENTE' | 'APROBADA' | 'RECHAZADA' | 'JUSTIFICACION_PENDIENTE'
  
  managerId?: string
  motivoRechazo?: string
  creadoEn: DateTime
  decidoEn?: DateTime
  
  turnoAsignacionId?: string (ref para auditoría)
}
```

### 3.4 Endpoints API

```
POST   /turnos/cambios/solicitar           [shift.read]
       Crear solicitud
       Input: { fecha: Date, turnoSolicitado: TipoDiaPlan, motivo?: string }
       Output: SolicitudCambioTurno

GET    /turnos/cambios/mis-solicitudes     [shift.read]
       Ver solicitudes propias (filtro: employeeId actual)
       Output: SolicitudCambioTurno[]

GET    /turnos/cambios/pendientes          [shift.manage]
       Board Manager - solicitudes PENDIENTE
       Output: SolicitudCambioTurno[]

PUT    /turnos/cambios/:id/aprobar         [shift.manage]
       Manager aprueba
       Input: {}
       Output: { success, turnoAsignacionId }

PUT    /turnos/cambios/:id/rechazar        [shift.manage]
       Manager rechaza
       Input: { motivoRechazo?: string }
       Output: { success }
```

### 3.5 Flujo Principal

1. **Empleado solicita:** Fecha + turno deseado + motivo (opt) → PENDIENTE
2. **Sistema valida:** Fecha futura, no conflicto, sin solicitud previa esa fecha
3. **Manager revisa board:** Ve PENDIENTES, filtra por empleado/fecha
4. **Manager decide:**
   - APROBAR → turnoAsignacion se actualiza → estado: APROBADA → notif
   - RECHAZAR → estado: RECHAZADA → notif con motivo (opt)
5. **Empleado (si rechazada):** Ve estado, puede [REINTENTAR] → nueva solicitud

### 3.6 Validaciones
- Solo empleados pueden solicitar cambios propios
- Fecha debe ser futura (>= mañana)
- Sin 2 solicitudes PENDIENTES del mismo empleado, misma fecha
- No puede generar conflictos (2 turnos mismo día)
- Manager no puede aprobar si causa overlap en plan

### 3.7 Notificaciones
- **Solicitud creada:** Email a Manager: "[Emp] solicita cambiar [fecha] de [turno_actual] a [turno_deseado]. Motivo: [motivo opt]"
- **Aprobada:** Email a Emp: "Tu solicitud fue APROBADA. Nuevo turno: [turno]"
- **Rechazada:** Email a Emp: "Tu solicitud fue RECHAZADA. Motivo: [motivo opt]"

---

## 4. Feature 3: Validación y Autorización de Trabajo Fuera de Turno

### 4.1 Objetivo
Empleado solicita realizar una tarea fuera de turno (urgente, con potencial de horas extras). Manager valida impacto (>48h/semana), aprueba al empleado o reasigna. Empleado ejecuta y entrega reporte (actividades + fotos con timestamp). Manager valida reporte y registra compensatorio/overtime.

### 4.2 Actores y Permisos
- **Empleado:** `shift.read` - solicita y reporta
- **Manager/Director:** `shift.manage`, `shift.resolve` - aprueba y valida reportes
- **RRHH:** `shift.resolve` - acceso a reportes (informativo)

### 4.3 Modelos de Datos

```typescript
SolicitudTrabajoAdicional {
  id: string (UUID)
  tenantId: string
  employeeIdSolicitante: string     // quién lo solicita
  employeeIdAsignado: string        // quién lo ejecuta (puede reasignar)
  descripcionTarea: string
  fechaEstimada: Date
  horasEstimadas: number            // > 0 y <= 12
  urgencia: 'NORMAL' | 'URGENTE'
  
  causaHorasExtras: boolean         // ¿suma >48h esa semana?
  horasAcumuladas?: number          // 🔒 PRIVADO AL MANAGER
  saldoCompensatoriosMgr?: number   // 🔒 PRIVADO AL MANAGER
  
  estado: 'PENDIENTE_APROBACIÓN' 
        | 'APROBADA' 
        | 'REASIGNADA' 
        | 'RECHAZADA' 
        | 'REPORTE_PENDIENTE_VALIDACIÓN' 
        | 'REPORTE_RECHAZADO' 
        | 'VALIDADA'
  
  managerId?: string
  motivoRechazo?: string
  creadoEn: DateTime
  decidoEn?: DateTime
  
  // Reporte del empleado
  reporteDescripcion?: string       // listado de actividades
  reporteFotos?: string[]           // array de URLs (timestamp visible)
  reporteNotas?: string
  reporteEnviadoEn?: DateTime
  validadoEn?: DateTime
}
```

### 4.4 Endpoints API

```
POST   /turnos/trabajo-adicional/solicitar        [shift.read]
       Empleado solicita
       Input: { descripcionTarea, fechaEstimada, horasEstimadas, urgencia }
       Output: SolicitudTrabajoAdicional

GET    /turnos/trabajo-adicional/mis-solicitudes  [shift.read]
       Ver mis solicitudes (empleado)
       Output: SolicitudTrabajoAdicional[]

GET    /turnos/trabajo-adicional/pendientes       [shift.manage]
       Board Manager - solicitudes PENDIENTE_APROBACIÓN
       Output: SolicitudTrabajoAdicional[]

GET    /turnos/trabajo-adicional/validar          [shift.manage]
       Board Manager - REPORTE_PENDIENTE_VALIDACIÓN
       Output: SolicitudTrabajoAdicional[]

PUT    /turnos/trabajo-adicional/:id/aprobar      [shift.manage]
       Manager aprueba
       Input: {}
       Output: { success }

PUT    /turnos/trabajo-adicional/:id/reasignar    [shift.manage]
       Manager reasigna a otro empleado
       Input: { employeeIdNuevo: string, confirmado: boolean }
       Output: { success, emailEnviado: boolean }

POST   /turnos/trabajo-adicional/:id/reporte      [shift.read]
       Empleado envía reporte
       Input: { descripcionActividades, fotos: File[], notas?: string }
       Output: { success, estado: 'REPORTE_PENDIENTE_VALIDACIÓN' }

PUT    /turnos/trabajo-adicional/:id/validar      [shift.manage]
       Manager valida y registra compensatorio
       Input: {}
       Output: { success, compensatorioId }

PUT    /turnos/trabajo-adicional/:id/reporte-rechazar [shift.manage]
       Manager rechaza reporte y pide reentrega
       Input: { motivo?: string }
       Output: { success }
```

### 4.5 Flujo Principal

**Solicitud:**
1. Empleado accede "Solicitar Trabajo Adicional"
2. Completa: descripción + fecha + horas + urgencia
3. Sistema valida: fecha futura, empleado activo
4. **Sistema calcula (privado para Manager):**
   - ¿Suma >48h esa semana? SÍ/NO
   - Horas acumuladas esa semana (con + sin tarea)
   - Saldo compensatorios pendientes del empleado
5. Solicitud guardada → PENDIENTE_APROBACIÓN
6. Notif a Manager: "[Emp] solicita trabajo adicional [fecha]: [tarea]. Horas: [h]. ¿Extras? [SÍ/NO]"

**Aprobación (Manager):**
1. Manager ve board "Pendientes de Aprobación"
2. Lee info privada: causaHorasExtras, horasAcumuladas, saldoCompensatorios
3. Decide:
   - **APROBAR:** estado → APROBADA → notif a Emp "Aprobada. Entregar reporte cuando completes"
   - **REASIGNAR:** Abre modal de selección de empleado
     - Selecciona Emp B
     - Sistema muestra compensatorios de Emp B (informativos)
     - Manager confirma → estado → REASIGNADA
     - Email a Emp B: "Se te asignó trabajo urgente: [tarea]. Detalles: [descripción]. Fecha: [fecha]. Horas: [h]"
   - **RECHAZAR:** estado → RECHAZADA → notif a Emp con motivo (opt)

**Ejecución y Reporte:**
1. Empleado (asignado o reasignado) completa la tarea
2. Recopila fotos con **fecha/hora VISIBLE** en cada foto (inicial y final)
3. Accede a "Mis Trabajos Adicionales"
4. Envía REPORTE:
   - Listado de actividades realizadas (ej: "1. Análisis (1h), 2. Desarrollo (2.5h), 3. Testing (30min)")
   - 2+ fotos JPG/PNG (<=5MB cada) con timestamp visible
   - Notas opcionales
5. Estado → REPORTE_PENDIENTE_VALIDACIÓN
6. Notif a Manager: "[Emp] entregó reporte de trabajo adicional [fecha]"

**Validación (Manager):**
1. Manager ve board "Validar Reportes"
2. Revisa:
   - Descripción de actividades
   - Galería de fotos (verifica timestamps visibles)
   - Coherencia con tarea solicitada
3. Decide:
   - **VALIDAR:** estado → VALIDADA
     - Sistema registra CompensatorioMovimiento (GANADO) O HorasExtra (para payroll)
     - Notif a Emp: "Reporte validado. Compensatorio registrado"
   - **PEDIR REENTREGA:** estado → REPORTE_RECHAZADO
     - Notif a Emp: "Reporte incompleto. Motivo: [motivo opt]. Por favor reentrega"
     - Emp puede reintentar → nuevas fotos + descripción → vuelve a step "Validación"

### 4.6 Validaciones
- Horas estimadas: > 0 y <= 12
- Fecha debe ser futura
- Empleado debe estar activo (no cesado)
- Reporte requiere mínimo 2 fotos con timestamps visibles
- Fotos: JPG/PNG, <=5MB cada
- Los saldos de compensatorios mostrados al Manager son **informativos** (no bloquean)

### 4.7 Auditoría
- Registra: solicitud_id, quién solicitó, quién ejecutó, manager_decisión, reporte_fotos, validación
- Si rechaza reporte: registra motivo y reintentos

### 4.8 Notificaciones
- **Solicitud creada:** Email a Manager con info privada
- **Aprobada:** Email a Emp
- **Reasignada:** Email a nuevo Emp con detalles completos
- **Rechazada:** Email a Emp
- **Reporte enviado:** Email a Manager "Reporte entregado"
- **Validada:** Email a Emp "Compensatorio registrado"
- **Reporte rechazado:** Email a Emp "Reentrega solicitada"

---

## 5. Feature 4: Portal de Intercambios Autoservicio

### 5.1 Objetivo
Empleado A propone intercambiar su turno con Empleado B en una fecha. Empleado B acepta o rechaza. Si ambos aceptan, va al Manager para aprobación final. Manager aprueba o rechaza. Si aprueba, turnos se intercambian (operación neutra: no impacta compensatorios).

### 5.2 Actores y Permisos
- **Empleado A:** `shift.read` - propone intercambio
- **Empleado B:** `shift.read` - acepta/rechaza propuesta
- **Manager:** `shift.resolve` - aprueba/rechaza intercambio

### 5.3 Modelos de Datos

```typescript
IntercambioTurno {
  id: string (UUID)
  tenantId: string
  employeeIdA: string             // propone
  employeeIdB: string             // puede aceptar
  fecha: Date
  turnoActualA: TipoDiaPlan       // qué tiene A
  turnoActualB: TipoDiaPlan       // qué tiene B
  mensajeA?: string               // motivo/mensaje de A a B
  
  estado: 'PENDIENTE_ACEPTACIÓN_B' 
        | 'ACEPTADA_POR_B' 
        | 'RECHAZADA_POR_B' 
        | 'APROBADA_MANAGER' 
        | 'RECHAZADA_MANAGER'
  
  estadoB?: 'ACEPTADO' | 'RECHAZADO' | 'PENDIENTE'
  
  managerId?: string
  motivoRechazo?: string
  creadoEn: DateTime
  aceptadoEn?: DateTime
  decidoEn?: DateTime
  
  turnoAsignacionAId?: string (ref auditoría)
  turnoAsignacionBId?: string (ref auditoría)
}
```

### 5.4 Endpoints API

```
POST   /turnos/intercambios/proponer              [shift.read]
       Emp A propone
       Input: { employeeIdB: string, fecha: Date, mensajeA?: string }
       Output: IntercambioTurno

GET    /turnos/intercambios/mis-propuestas        [shift.read]
       Ver mis propuestas (Emp A)
       Output: IntercambioTurno[]

GET    /turnos/intercambios/propuestas-para-mi    [shift.read]
       Ver propuestas para mí (Emp B)
       Output: IntercambioTurno[]

PUT    /turnos/intercambios/:id/aceptar           [shift.read]
       Emp B acepta
       Input: {}
       Output: { success, estado: 'ACEPTADA_POR_B' }

PUT    /turnos/intercambios/:id/rechazar          [shift.read]
       Emp B rechaza (o Manager rechaza)
       Input: { motivoRechazo?: string }
       Output: { success }

GET    /turnos/intercambios/pendientes            [shift.resolve]
       Board Manager - ACEPTADA_POR_B
       Output: IntercambioTurno[]

PUT    /turnos/intercambios/:id/aprobar           [shift.resolve]
       Manager aprueba (intercambia turnos)
       Input: {}
       Output: { success, intercambioRealizado: boolean }
```

### 5.5 Flujo Principal

1. **Emp A propone:**
   - Selecciona fecha en su plan
   - Selecciona Emp B
   - Visualiza: "Tú tienes [turno A], [Emp B] tiene [turno B]. Intercambiar?"
   - Agrega mensaje (opt): "Tengo cita ese día"
   - Envía propuesta → PENDIENTE_ACEPTACIÓN_B
   - Notif a Emp B

2. **Emp B revisa:**
   - Ve propuesta: "Emp A propone intercambiar su [turno A] por tu [turno B] el [fecha]"
   - Ve mensaje de A
   - Ve su saldo compensatorios (informativos)
   - Decide:
     - **ACEPTAR:** estado → ACEPTADA_POR_B → va a Manager → notif a Manager
     - **RECHAZAR:** estado → RECHAZADA_POR_B → notif a Emp A

3. **Manager revisa:**
   - Ve board "Intercambios Pendientes de Aprobación"
   - Info visible:
     - Emp A: turno actual, turno que recibe
     - Emp B: turno actual, turno que recibe
     - Saldos compensatorios de ambos (informativos)
   - Decide:
     - **APROBAR:** estado → APROBADA_MANAGER
       - Sistema intercambia turnoAsignacion records (swap tipoDia/turnoId)
       - **NO crea movimientos de compensatorios** (operación neutra)
       - Notif a ambos: "Intercambio aprobado. Tus turnos han sido intercambiados"
     - **RECHAZAR:** estado → RECHAZADA_MANAGER → notif a ambos

### 5.6 Validaciones
- Ambos empleados deben estar activos (no cesados)
- Fecha debe ser futura
- Ambos deben tener turnos asignados esa fecha (no puede intercambiar un DESCANSO vs nada)
- Emp A no puede proponer intercambio consigo mismo
- Sin 2 propuestas PENDIENTES del mismo par (A→B) para la misma fecha
- **El intercambio es NEUTRO para compensatorios:** no crea ni consume movimientos

### 5.7 Auditoría
- Registra: intercambio_id, Emp A, Emp B, fecha, manager_decisión, cuándo
- Si rechaza: registra motivo

### 5.8 Notificaciones
- **Propuesta creada:** Email a Emp B: "[Emp A] propone intercambiar su [turno A] por tu [turno B] el [fecha]. Mensaje: [mensaje opt]"
- **Aceptada por B:** Email a Manager: "Intercambio aceptado entre [Emp A] y [Emp B] para [fecha]. Pendiente de aprobación"
- **Rechazada por B:** Email a Emp A: "[Emp B] rechazó tu propuesta de intercambio. Motivo: [motivo opt]"
- **Aprobada Manager:** Email a ambos: "Intercambio aprobado. Tus turnos han sido intercambiados"
- **Rechazada Manager:** Email a ambos: "Intercambio rechazado. Motivo: [motivo opt]"

---

## 6. Arquitectura General

### 6.1 Permisos RBAC

| Feature | `shift.read` | `shift.manage` | `shift.resolve` |
|---------|:------------:|:--------------:|:---------------:|
| 1. Patrones | ✓ (ver) | ✓ (CRUD) | - |
| 2. Cambios turno | ✓ (solicitar) | ✓ (aprobar) | - |
| 3. Trabajo adicional | ✓ (solicitar, reportar) | ✓ (aprobar, reasignar, validar) | ✓ (acceso informativo) |
| 4. Intercambios | ✓ (proponer, aceptar) | - | ✓ (aprobar, rechazar) |

### 6.2 Integración con Módulos Existentes

- **ShiftPlanService (Feature 1):** Upsert masivo de turnoAsignacion
- **ShiftComplianceService (Feature 3):** Cálculo de horasAcumuladas semanales
- **CompensatorioService (Feature 3):** Registra GANADO/GOZADO al validar reporte
- **NotificationService:** Emails + in-app para cada estado
- **AuditService:** Registra decisiones y cambios

### 6.3 Flujos de Aprobación

```
Feature 1: Manager → inyecta (no aprobación, es decisión)
Feature 2: Emp → Manager aprueba/rechaza
Feature 3: Emp → Manager aprueba/reasigna → Emp reporta → Manager valida/rechaza
Feature 4: Emp A → Emp B acepta/rechaza → Manager aprueba/rechaza
```

---

## 7. Datos Privados del Manager

En Features 1 y 3, el Manager ve información **privada** que el Empleado NO ve:

**Feature 1:** N/A (no hay datos privados)

**Feature 3:**
- `causaHorasExtras` (¿suma >48h?)
- `horasAcumuladas` (breakdown semanal con/sin tarea)
- `saldoCompensatoriosMgr` (saldo pendiente del empleado)

Esta información guía la decisión de Manager pero **no aparece en la UI del Empleado**.

---

## 8. Testing

### 8.1 Unit Tests
- Validaciones de fechas (futuro, conflictos)
- Cálculos de horas semanales
- Transiciones de estado
- Regex fotos (timestamp visible)

### 8.2 Integration Tests
- Feature 1: crear patrón → aplicar a 3 empleados → verificar turnoAsignacion
- Feature 2: empleado solicita → manager aprueba → turno actualizado
- Feature 3: solicita → aprueba → reporta → valida → compensatorio registrado
- Feature 3 (rechazada): reporta → rechazada → reentrega → valida → éxito
- Feature 4: Emp A propone → Emp B acepta → Manager aprueba → turnos intercambiados

### 8.3 E2E (manual, opcional)
- Demo con usuarios reales: Manager aplica patrón, Emp solicita cambio, etc.

---

## 9. Consideraciones Futuras (Fuera de Scope)

- Patrones con reglas condicionales (ej: evitar 3+ turnos NOCHE seguidos)
- Aprobación de cambios por parte del empleado mismo (self-approved)
- Validación de horas extra semanales (>48h) automática (hoy es solo informativa)
- Mobile app para reportes fotográficos (hoy es web)
- Integración con sistema de tickets para "tarea urgente" (hoy es texto libre)

---

## 10. Aceptación

Esta especificación define 4 features independientes con tests unitarios e integración. Está lista para implementación en 4 sprints (1 por feature).

**Aprobación:** [Pendiente de user review]

