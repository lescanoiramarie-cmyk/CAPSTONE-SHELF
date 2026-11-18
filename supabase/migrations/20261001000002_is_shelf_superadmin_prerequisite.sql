-- Make the super-admin predicate available before migrations that reference it.
-- Existing definitions are validated in place; this migration never replaces them.
DO $migration$
DECLARE
  v_function_oid oid;
  v_name_matches integer;
  v_postgres_oid oid;
  v_actual_acl_count integer;
  v_actual_acl_valid boolean;
  v_unexpected_effective_role text;
  v_normalized_body text;
  v_expected_body constant text :=
    'select exists ( select 1 from public.staff_profiles staff where staff.id = auth.uid() and staff.role = ''superadmin'' and staff.is_active = true and coalesce(auth.jwt() -> ''app_metadata'' ->> ''role'', staff.role) = ''superadmin'' );';
BEGIN
  SELECT count(*)
    INTO v_name_matches
    FROM pg_catalog.pg_proc AS p
    JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname = 'is_shelf_superadmin';

  IF v_name_matches > 1 THEN
    RAISE EXCEPTION 'Expected only public.is_shelf_superadmin() with no overloads; found % same-name functions.', v_name_matches;
  END IF;

  SELECT r.oid
    INTO v_postgres_oid
    FROM pg_catalog.pg_roles AS r
   WHERE r.rolname = 'postgres';

  IF v_postgres_oid IS NULL THEN
    RAISE EXCEPTION 'Required owner role postgres does not exist.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'anon')
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'authenticated')
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'service_role') THEN
    RAISE EXCEPTION 'Required Supabase roles anon, authenticated, and service_role must exist.';
  END IF;

  IF v_name_matches = 0 THEN
    IF current_user <> 'postgres' THEN
      RAISE EXCEPTION 'Cannot create public.is_shelf_superadmin() with owner postgres: migration current_user is %.', current_user;
    END IF;

    EXECUTE $create_function$
      CREATE FUNCTION public.is_shelf_superadmin()
      RETURNS boolean
      LANGUAGE sql
      STABLE
      SECURITY DEFINER
      SET search_path = public, pg_temp
      AS $function_body$
        select exists (
          select 1 from public.staff_profiles staff
          where staff.id = auth.uid()
            and staff.role = 'superadmin'
            and staff.is_active = true
            and coalesce(auth.jwt() -> 'app_metadata' ->> 'role', staff.role) = 'superadmin'
        );
      $function_body$
    $create_function$;

    EXECUTE 'REVOKE ALL PRIVILEGES ON FUNCTION public.is_shelf_superadmin() FROM PUBLIC, anon';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.is_shelf_superadmin() TO authenticated, service_role';
  END IF;

  SELECT p.oid,
         pg_catalog.btrim(
           pg_catalog.regexp_replace(
             p.prosrc,
             '[[:space:]]+',
             ' ',
             'g'
           )
         )
    INTO v_function_oid, v_normalized_body
    FROM pg_catalog.pg_proc AS p
    JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname = 'is_shelf_superadmin'
     AND p.pronargs = 0;

  IF v_function_oid IS NULL THEN
    RAISE EXCEPTION 'Expected zero-argument public.is_shelf_superadmin(); an unexpected overload or signature exists.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_proc AS p
      JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
      JOIN pg_catalog.pg_language AS l ON l.oid = p.prolang
     WHERE p.oid = v_function_oid
       AND n.nspname = 'public'
       AND p.proname = 'is_shelf_superadmin'
       AND p.pronargs = 0
       AND p.prorettype = 'pg_catalog.bool'::pg_catalog.regtype
       AND p.proowner = v_postgres_oid
       AND l.lanname = 'sql'
       AND p.provolatile = 's'
       AND p.prosecdef IS TRUE
       AND p.proconfig IS NOT DISTINCT FROM ARRAY['search_path=public, pg_temp']::text[]
  ) THEN
    RAISE EXCEPTION 'Existing public.is_shelf_superadmin() has an unexpected signature, return type, owner, language, volatility, SECURITY DEFINER setting, or search_path.';
  END IF;

  IF v_normalized_body IS DISTINCT FROM v_expected_body THEN
    RAISE EXCEPTION 'Existing public.is_shelf_superadmin() body does not match the canonical December definition.';
  END IF;

  SELECT count(*),
         COALESCE(bool_and(
           x.privilege_type = 'EXECUTE'
           AND x.is_grantable IS FALSE
           AND (
             (x.grantee = v_postgres_oid AND x.grantor = v_postgres_oid)
             OR (x.grantee = (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = 'authenticated') AND x.grantor = v_postgres_oid)
             OR (x.grantee = (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = 'service_role') AND x.grantor = v_postgres_oid)
           )
         ), FALSE)
    INTO v_actual_acl_count, v_actual_acl_valid
    FROM pg_catalog.pg_proc AS p
    CROSS JOIN LATERAL pg_catalog.aclexplode(p.proacl) AS x
   WHERE p.oid = v_function_oid;

  IF v_actual_acl_count <> 3 OR NOT v_actual_acl_valid THEN
    RAISE EXCEPTION 'public.is_shelf_superadmin() direct ACL must contain exactly owner, authenticated, and service_role EXECUTE entries, all without grant option; found % entries.', v_actual_acl_count;
  END IF;

  IF pg_catalog.has_function_privilege('anon', v_function_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'anon has effective EXECUTE on public.is_shelf_superadmin(); check direct ACL and role memberships.';
  END IF;

  IF NOT pg_catalog.has_function_privilege('authenticated', v_function_oid, 'EXECUTE')
     OR NOT pg_catalog.has_function_privilege('service_role', v_function_oid, 'EXECUTE')
     OR NOT pg_catalog.has_function_privilege('postgres', v_function_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'Expected authenticated, service_role, and postgres to have effective EXECUTE on public.is_shelf_superadmin().';
  END IF;

  SELECT r.rolname
    INTO v_unexpected_effective_role
    FROM pg_catalog.pg_roles AS r
   WHERE NOT r.rolsuper
     AND r.rolname NOT IN ('postgres', 'authenticated', 'service_role')
     AND pg_catalog.has_function_privilege(r.oid, v_function_oid, 'EXECUTE')
   ORDER BY r.rolname
   LIMIT 1;

  IF v_unexpected_effective_role IS NOT NULL THEN
    RAISE EXCEPTION 'Unexpected role % has effective EXECUTE on public.is_shelf_superadmin(); check role memberships.', v_unexpected_effective_role;
  END IF;
END;
$migration$;