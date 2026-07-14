-- Hotfix: auth_lookup_user es SECURITY DEFINER con owner rrhh_auth_lookup
-- (BYPASSRLS), pero BYPASSRLS solo exime de RLS, no de los privilegios de
-- tabla — sin este GRANT el login falla con 42501 "permission denied for
-- table app_user". Alcance mínimo: solo SELECT, solo app_user.
GRANT SELECT ON "app_user" TO rrhh_auth_lookup;
