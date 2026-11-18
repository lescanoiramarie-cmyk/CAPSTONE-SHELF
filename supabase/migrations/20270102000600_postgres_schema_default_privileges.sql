-- Remove application-role grants from every existing schema-specific default
-- ACL created by postgres. Global postgres defaults are hardened separately.
-- Existing object ACLs and service_role defaults are not changed.

DO $default_acl$
DECLARE
  v_schema name;
BEGIN
  FOR v_schema IN
    SELECT DISTINCT schema_name.nspname
    FROM pg_catalog.pg_default_acl AS default_acl
    JOIN pg_catalog.pg_namespace AS schema_name
      ON schema_name.oid = default_acl.defaclnamespace
    WHERE default_acl.defaclrole = 'postgres'::pg_catalog.regrole
      AND default_acl.defaclnamespace <> 0
  LOOP
    EXECUTE pg_catalog.format(
      'ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA %I REVOKE ALL ON TABLES FROM PUBLIC, anon, authenticated',
      v_schema
    );
    EXECUTE pg_catalog.format(
      'ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA %I REVOKE ALL ON SEQUENCES FROM PUBLIC, anon, authenticated',
      v_schema
    );
    EXECUTE pg_catalog.format(
      'ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA %I REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon, authenticated',
      v_schema
    );
  END LOOP;
END;
$default_acl$;