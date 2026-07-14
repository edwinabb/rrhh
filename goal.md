# GOAL: Sistema de Gestión de Recursos Humanos con Cumplimiento Normativo Peruano

## Objetivo

Construir una aplicación web full-stack de gestión de recursos humanos (HRMS) para empresas peruanas, que combine el cumplimiento estricto de la normativa local (SUNAT, SUNAFIL, MTPE) con estándares internacionales de eficiencia operativa. El sistema debe ser multi-empresa (multi-tenant), soportar múltiples regímenes laborales peruanos y estar diseñado para escalar de 10 a 5,000 trabajadores por empresa.

## Contexto normativo (crítico — no negociable)

El sistema opera bajo el marco legal peruano. Toda lógica de cálculo debe respetar:

- **Regímenes laborales**: General (D.Leg. 728), MYPE (micro y pequeña empresa con beneficios diferenciados), Agrario, y estructura extensible para otros regímenes especiales.
- **Planilla Electrónica SUNAT**: T-Registro (altas, bajas, modificaciones) y PDT PLAME (declaración mensual). El sistema genera archivos `.txt` estructurados compatibles con el PVS de SUNAT para carga masiva.
- **Control de asistencia**: D.S. 004-2006-TR. Los registros de marcación deben ser **inalterables** (append-only, con hash de integridad y trazabilidad completa) para blindaje ante inspecciones SUNAFIL (multas de hasta 52 UIT).
- **Firma digital**: Ley N.º 27269 (firmas y certificados digitales).
- **Protección de datos**: Ley N.º 29733 (datos personales), con especial cuidado en datos sensibles de salud e ingresos.
- **Retención documental**: hasta 20 años para registros de salud ocupacional; 5 años mínimo para asistencia y contratos exportables ante inspector.

## Stack técnico sugerido

- **Frontend**: Next.js 14+ (App Router) + TypeScript + Tailwind CSS + shadcn/ui.
- **Backend**: API Routes de Next.js o NestJS (elige y justifica). PostgreSQL como base de datos (Supabase es aceptable como BaaS).
- **Autenticación**: sesiones con roles RBAC granulares (ver Módulo 3).
- **Jobs asíncronos**: cola para procesos pesados (cierre de planilla, firma masiva, generación de archivos SUNAT).
- **Almacenamiento de documentos**: bucket S3-compatible con versionado y cifrado en reposo.
- Si algún punto del stack te parece subóptimo para el caso de uso, propón la alternativa y justifícala antes de implementar.

## Módulo 1: Cumplimiento y Nómina (Back-Office Peruano)

Motor del sistema. Procesa la planilla bajo los regímenes configurados.

### Procesos

1. **Sincronización con Planilla Electrónica**: generación automática de archivos `.txt` para carga masiva en T-Registro (altas, bajas, modificaciones) y PDT PLAME (declaración mensual). Validar estructura contra las especificaciones del PVS de SUNAT.
2. **Cálculo automatizado de beneficios sociales**:
   - CTS (depósitos de mayo y noviembre, con cálculo proporcional).
   - Gratificaciones (julio y diciembre) + bonificación extraordinaria del 9% (Ley 30334).
   - Utilidades anuales según sector y renta neta.
   - Liquidación de beneficios truncos generada en menos de 48 horas tras el cese (CTS trunca, gratificación trunca, vacaciones truncas).
3. **Gestión de provisiones**: cálculo y registro mensual de costos proyectados de CTS, gratificaciones y vacaciones (asiento contable exportable).
4. **Impuestos y aportes**:
   - Renta de Quinta Categoría (proyección anual, incluyendo ingresos de otras entidades declarados por el trabajador).
   - Retenciones AFP (aporte obligatorio, comisión, prima de seguro con tope de remuneración máxima asegurable) y ONP.
   - Aportes de EsSalud (9%) y EPS cuando aplique.

### Páginas y popups

- **Página "Dashboard de Planilla"**: estado del ciclo (Registrado → Procesado → Cerrado) con validaciones previas de inconsistencias antes de declarar (trabajadores sin cuenta bancaria, sin régimen pensionario, montos atípicos).
- **Popup "Exportación Planilla Electrónica"**: genera los `.txt` para T-Registro y PLAME, con log de validación por registro.
- **Página "Ficha de Alta de Trabajador"**: formulario con campos obligatorios por ley — régimen pensionario, cuenta bancaria de abono, asignación familiar, dirección, régimen laboral, tipo de contrato.
- **Popup "Conectividad Bancaria"**: generación de archivos de telecrédito (formato BCP como primer banco; arquitectura extensible a BBVA, Interbank, Scotiabank) para pago masivo de haberes y beneficios.

## Módulo 2: Control de Asistencia y Gestión del Tiempo (Blindaje SUNAFIL)

### Procesos

1. **Registro multimodal inalterable**: marcaciones por biometría facial, huella dactilar, palma o geolocalización (Google Maps) para personal en campo o teletrabajo. Cada marcación se persiste en tabla append-only con timestamp del servidor, hash encadenado y dispositivo/coordenadas de origen. Prohibida la edición directa: cualquier corrección genera un registro nuevo con justificación y aprobador.
2. **Flujo de aprobación de sobretiempo**: horas extras detectadas automáticamente → validación del jefe directo → integración automática en la nómina con las sobretasas legales (25% primeras 2 horas, 35% siguientes, 100% feriados/descanso).
3. **Gestión de descansos y vacaciones**: programación y control de los 30 días de vacaciones, alertas de vencimiento del periodo para evitar indemnización vacacional, y control de récord vacacional para prevenir desnaturalización de contratos.

### Páginas y popups

- **Página "Dashboard de Asistencia"**: tardanzas, faltas y horas laboradas en tiempo real, con filtros por sede y área.
- **Popup "Configuración de Radio GPS"**: mapa interactivo para definir el radio permitido de marcación desde la app móvil (geofencing por sede).
- **Página "Alertas Preventivas"**: contratos por vencer, periodos de vacaciones próximos a caducar, trabajadores cerca del límite de horas extras.
- **Popup "Expediente de Inspección"**: exporta en segundos todos los registros de asistencia y contratos de los últimos 5 años (PDF + Excel), listo para entregar a un inspector de SUNAFIL.

## Módulo 3: Gestión Documental y Firma Digital Certificada

### Procesos

1. **Firma electrónica y digital masiva**: el representante legal firma cientos de contratos, adendas o boletas con un solo clic. Integración con proveedor de certificados digitales acreditado en Perú (arquitectura con interfaz abstracta para el proveedor). Garantizar autenticidad, integridad y no repudio.
2. **Custodia y conservación**: legajo organizado por secciones (Identificación, Contratos, SST, Remuneraciones, Salud) con políticas de retención diferenciadas — hasta 20 años para registros de salud ocupacional.
3. **Portal de autoservicio (ESS)**: el colaborador descarga boletas firmadas y certificados de CTS, y solicita actualización de datos (ej. cambio de domicilio) adjuntando sustento, con workflow de aprobación.

### Páginas y popups

- **Página "Legajo Digital del Colaborador"**: carpetas inteligentes con búsqueda por metadatos (tipo de documento, fecha, estado de firma).
- **Popup "Workflow de Firma"**: monitor de quién firmó y quién tiene pendientes, con recordatorios automáticos por email.
- **Página "Gestión de Permisos Granulares" (RBAC)**: configuración de accesos por rol. Ejemplo obligatorio: un jefe de área NO puede ver datos sensibles de salud ni ingresos de sus reportes; RRHH sí. Implementar a nivel de fila y columna en la base de datos, no solo en la UI.

## Módulo 4: Reclutamiento (ATS)

### Procesos

1. **Multiposting**: publicación simultánea de vacantes en portales de empleo y redes sociales desde una sola interfaz (diseñar como integraciones plugables; implementar primero el portal corporativo propio).
2. **Cribado curricular con IA**: parsing de CVs (PDF/DOCX) y clasificación de candidatos según ajuste al perfil y respuestas a killer questions. Usar la API de Anthropic para el parsing y scoring semántico.
3. **Automatización de etapas**: movimiento de candidatos entre fases (Postulado → Entrevista → Seleccionado → Contratado) con notificaciones automáticas de estado al candidato. Al contratar, pre-poblar la Ficha de Alta del Módulo 1 con los datos del candidato.

### Páginas y popups

- **Página "Portal de Empleo Corporativo"**: sitio público personalizable con la marca de la empresa, listado de vacantes vigentes y formulario de postulación.
- **Página "Pipeline de Contratación"**: tablero Kanban drag-and-drop por etapa.
- **Popup "Perfil del Candidato"**: CV, resultados de pruebas psicométricas, anotaciones de reclutadores y scorecards de entrevistas.
- **Popup "Sincronización de Entrevistas"**: calendario integrado (Google Calendar / Outlook) para agendar citas con postulante y evaluadores.

## Requisitos no funcionales

- **Auditoría total**: toda operación sobre datos de planilla, asistencia y documentos genera un registro de auditoría inmutable (quién, qué, cuándo, desde dónde, valor anterior/nuevo).
- **Multi-tenant**: aislamiento estricto de datos por empresa (row-level security).
- **Idioma**: toda la UI en español (Perú). Formatos: moneda S/, fechas dd/mm/aaaa, zona horaria America/Lima.
- **Motor de reglas parametrizable**: UIT, RMV, tasas de EsSalud/AFP/ONP, topes y tramos de Quinta Categoría deben ser parámetros por periodo (vigencia desde/hasta), nunca constantes hardcodeadas, para absorber cambios normativos anuales.
- **Testing**: cobertura obligatoria con tests unitarios para TODOS los cálculos de nómina (CTS, gratificaciones, quinta categoría, horas extras, liquidaciones), incluyendo casos borde: ingreso a mitad de mes, cese antes del depósito de CTS, trabajador con remuneración variable, régimen MYPE vs General.
- **Seguridad**: cifrado en tránsito y en reposo, hashing de contraseñas con argon2/bcrypt, rate limiting, protección de datos sensibles según Ley 29733.

## Plan de ejecución sugerido

1. **Fase 0 — Fundaciones**: modelo de datos completo (diagrama ER primero, para mi revisión), auth + RBAC, multi-tenancy, motor de parámetros normativos, auditoría.
2. **Fase 1 — Módulo 1 (Nómina)**: es el corazón; sin esto nada más tiene valor. Empezar por régimen General, luego MYPE.
3. **Fase 2 — Módulo 2 (Asistencia)**: alimenta a la nómina (tardanzas, horas extras).
4. **Fase 3 — Módulo 3 (Documental y firma)**.
5. **Fase 4 — Módulo 4 (ATS)**.

## Criterios de aceptación

- Un ciclo completo de planilla mensual (alta de trabajador → marcaciones → horas extras aprobadas → cálculo → cierre → archivos PLAME/T-Registro → telecrédito → boletas firmadas en el legajo) funciona de extremo a extremo.
- Los archivos `.txt` generados pasan la validación de estructura documentada del PVS de SUNAT.
- El "Expediente de Inspección" exporta 5 años de registros en menos de 30 segundos con 1,000 trabajadores.
- Ninguna marcación de asistencia puede ser modificada ni eliminada; solo corregida vía registro complementario aprobado.
- Los tests de cálculo de nómina pasan al 100% con los casos borde definidos.

## Instrucciones de trabajo

- Antes de escribir código, presenta el modelo de datos (ER) y la arquitectura de carpetas para mi aprobación.
- Trabaja fase por fase; al terminar cada fase, entrega un resumen de lo implementado, decisiones tomadas y deuda técnica pendiente.
- Si una regla normativa peruana es ambigua o tiene más de una interpretación, pregúntame antes de asumir.
- Commits atómicos con mensajes descriptivos en español.
