-- Grants-only migration, no schema diff.

-- El barrido perezoso de IntercambioTurnoAplicadorService se ejecuta al
-- inicio de endpoints gateados solo por shift.read (app_manager/app_employee)
-- y puede terminar ejecutando un swap (UPDATE turno_asignacion) en nombre de
-- quien haya disparado el request, no solo de quien creó el registro — misma
-- razón por la que app_employee ya tiene UPDATE sobre intercambio_turno
-- (ver 20260804182325_intercambio_turno/migration.sql). RLS sobre
-- turno_asignacion ya limita todo acceso por tenant_id, así que este grant
-- no cruza límites de tenant.
GRANT UPDATE ON "turno_asignacion" TO app_manager, app_employee;
