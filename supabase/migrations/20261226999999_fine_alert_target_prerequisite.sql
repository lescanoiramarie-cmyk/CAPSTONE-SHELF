BEGIN;

-- The December 27 migration narrows this function's OUT columns from three
-- to two with CREATE OR REPLACE, which PostgreSQL rejects. Prepare that exact
-- two-column definition before the historical migration. A later forward
-- migration restores alerted_today because FinePayments.jsx still consumes it.
DO $fine_alert_target_prerequisite$
DECLARE
  v_oid oid;
  v_result text;
  v_owner name;
  v_language name;
  v_volatility "char";
  v_security_definer boolean;
  v_config text[];
  v_body_md5 text;
  v_owner_oid oid;
  v_anon_oid oid;
  v_authenticated_oid oid;
  v_service_role_oid oid;
  v_acl_count integer;
  v_bad_acl_count integer;
  v_owner_exec_count integer;
  v_authenticated_exec_count integer;
  v_service_exec_count integer;
  v_public_exec_count integer;
  v_anon_exec_count integer;
  v_contract_migration_applied boolean := false;
  v_contract_restore_applied boolean := false;
BEGIN
  IF current_user <> 'postgres' THEN
    RAISE EXCEPTION
      'Fine alert target prerequisite requires current_user=postgres; found %',
      current_user;
  END IF;

  SELECT oid INTO v_owner_oid FROM pg_catalog.pg_roles WHERE rolname = 'postgres';
  SELECT oid INTO v_anon_oid FROM pg_catalog.pg_roles WHERE rolname = 'anon';
  SELECT oid INTO v_authenticated_oid FROM pg_catalog.pg_roles WHERE rolname = 'authenticated';
  SELECT oid INTO v_service_role_oid FROM pg_catalog.pg_roles WHERE rolname = 'service_role';

  IF v_owner_oid IS NULL OR v_anon_oid IS NULL
     OR v_authenticated_oid IS NULL OR v_service_role_oid IS NULL THEN
    RAISE EXCEPTION
      'Required Supabase roles postgres, anon, authenticated, or service_role are missing';
  END IF;

  IF pg_catalog.to_regclass('supabase_migrations.schema_migrations') IS NULL THEN
    RAISE EXCEPTION
      'Cannot safely evaluate fine alert migration ordering: Supabase migration ledger is unavailable';
  END IF;

  EXECUTE $ledger_check$
    SELECT EXISTS (
      SELECT 1 FROM supabase_migrations.schema_migrations
      WHERE version = '20261227000000'
    )
  $ledger_check$ INTO v_contract_migration_applied;

  EXECUTE $ledger_check$
    SELECT EXISTS (
      SELECT 1 FROM supabase_migrations.schema_migrations
      WHERE version = '20261227000001'
    )
  $ledger_check$ INTO v_contract_restore_applied;

  v_oid := pg_catalog.to_regprocedure('public.get_fine_payment_alert_targets(text)');

  IF v_oid IS NOT NULL THEN
    SELECT pg_catalog.pg_get_function_result(p.oid), owner_role.rolname,
           language.lanname, p.provolatile, p.prosecdef, p.proconfig,
           pg_catalog.md5(pg_catalog.btrim(
             pg_catalog.regexp_replace(
               pg_catalog.replace(p.prosrc, E'\r\n', E'\n'),
               '[[:blank:]]+$', '', 'gm'
             ), E' \t\n\r'
           ))
      INTO v_result, v_owner, v_language, v_volatility,
           v_security_definer, v_config, v_body_md5
    FROM pg_catalog.pg_proc AS p
    JOIN pg_catalog.pg_roles AS owner_role ON owner_role.oid = p.proowner
    JOIN pg_catalog.pg_language AS language ON language.oid = p.prolang
    WHERE p.oid = v_oid;

    IF v_result NOT IN (
         'TABLE(request_id text, visitor_id text)',
         'TABLE(request_id text, visitor_id text, alerted_today boolean)'
       )
       OR v_owner IS DISTINCT FROM 'postgres'
       OR v_language IS DISTINCT FROM 'plpgsql'
       OR v_volatility IS DISTINCT FROM 'v'::"char"
       OR v_security_definer IS DISTINCT FROM true
       OR v_config IS DISTINCT FROM ARRAY['search_path=public, pg_temp']::text[] THEN
      RAISE EXCEPTION
        'Existing public.get_fine_payment_alert_targets(text) has an unexpected signature or security definition';
    END IF;

    IF (v_result = 'TABLE(request_id text, visitor_id text)'
        AND v_body_md5 IS DISTINCT FROM '1cf43ecab26431fbe481eaf0e509ad02')
       OR (v_result = 'TABLE(request_id text, visitor_id text, alerted_today boolean)'
           AND v_body_md5 IS DISTINCT FROM 'b5eac13336524a8b9f48745c4abd5bdd') THEN
      RAISE EXCEPTION
        'Existing public.get_fine_payment_alert_targets(text) body does not match either reviewed canonical definition';
    END IF;

    SELECT count(*)::integer,
           count(*) FILTER (WHERE acl.grantee = v_owner_oid AND acl.privilege_type = 'EXECUTE'
                                  AND NOT acl.is_grantable AND acl.grantor = v_owner_oid)::integer,
           count(*) FILTER (WHERE acl.grantee = v_authenticated_oid AND acl.privilege_type = 'EXECUTE'
                                  AND NOT acl.is_grantable AND acl.grantor = v_owner_oid)::integer,
           count(*) FILTER (WHERE acl.grantee = v_service_role_oid AND acl.privilege_type = 'EXECUTE'
                                  AND NOT acl.is_grantable AND acl.grantor = v_owner_oid)::integer,
           count(*) FILTER (WHERE acl.grantee = 0 AND acl.privilege_type = 'EXECUTE')::integer,
           count(*) FILTER (WHERE acl.grantee = v_anon_oid AND acl.privilege_type = 'EXECUTE')::integer,
           count(*) FILTER (
             WHERE acl.grantee NOT IN (v_owner_oid, v_authenticated_oid, v_service_role_oid)
                OR acl.privilege_type <> 'EXECUTE'
                OR acl.is_grantable
                OR acl.grantor <> v_owner_oid
           )::integer
      INTO v_acl_count, v_owner_exec_count, v_authenticated_exec_count,
           v_service_exec_count, v_public_exec_count, v_anon_exec_count,
           v_bad_acl_count
    FROM pg_catalog.aclexplode(COALESCE(
      (SELECT p.proacl FROM pg_catalog.pg_proc AS p WHERE p.oid = v_oid),
      pg_catalog.acldefault('f'::"char", v_owner_oid)
    )) AS acl;

    IF v_owner_exec_count <> 1
       OR v_authenticated_exec_count <> 1
       OR v_service_exec_count <> 1
       OR v_public_exec_count <> 0
       OR v_anon_exec_count <> 0
       OR v_bad_acl_count <> 0
       OR v_acl_count <> 3
       OR pg_catalog.has_function_privilege('anon', v_oid, 'EXECUTE')
       OR NOT pg_catalog.has_function_privilege('authenticated', v_oid, 'EXECUTE')
       OR NOT pg_catalog.has_function_privilege('service_role', v_oid, 'EXECUTE') THEN
      RAISE EXCEPTION
        'Existing public.get_fine_payment_alert_targets(text) has unexpected direct or effective EXECUTE privileges';
    END IF;

    IF v_result = 'TABLE(request_id text, visitor_id text)' THEN
      IF v_contract_restore_applied THEN
        RAISE EXCEPTION
          'Fine alert migration ledger records the final contract, but the function has the intermediate two-column result';
      END IF;
      -- This exact intermediate definition is already canonical.
      RETURN;
    END IF;

    -- A database that already recorded the historical narrowing migration
    -- has passed the point where this prerequisite may safely prepare the
    -- intermediate two-column contract. Preserve any reviewed final
    -- three-column definition instead of briefly removing alerted_today.
    IF v_contract_migration_applied THEN
      -- The subsequent migration is already recorded. Keep the existing
      -- canonical function intact; the paired restore migration validates it.
      RETURN;
    END IF;

    DROP FUNCTION public.get_fine_payment_alert_targets(text);
    v_oid := NULL;
  END IF;

  IF v_contract_migration_applied OR v_contract_restore_applied THEN
    RAISE EXCEPTION
      'Fine alert migration history is ahead of a missing function; refusing to recreate an intermediate contract';
  END IF;

  EXECUTE $function_ddl$
    CREATE FUNCTION public.get_fine_payment_alert_targets(p_library_id text DEFAULT NULL)
    RETURNS TABLE (request_id text, visitor_id text)
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $function$
DECLARE
  v_role text;
  v_library_id uuid;
  v_jwt_role text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authenticated staff account required.'; END IF;
  SELECT lower(sp.role), sp.library_id INTO v_role, v_library_id
  FROM public.staff_profiles sp WHERE sp.id = auth.uid() AND sp.is_active IS TRUE;
  IF NOT FOUND OR v_role NOT IN ('superadmin', 'subadmin') THEN RAISE EXCEPTION 'Active staff profile required.'; END IF;
  v_jwt_role := auth.jwt() -> 'app_metadata' ->> 'role';
  IF v_jwt_role IS NOT NULL AND v_jwt_role <> v_role THEN RAISE EXCEPTION 'Unauthorized staff role.'; END IF;
  IF v_role = 'subadmin' AND p_library_id IS NOT NULL AND p_library_id <> v_library_id::text THEN
    RAISE EXCEPTION 'You can only view fine alerts for your assigned library.';
  END IF;

  RETURN QUERY
  SELECT br.id::text, br.visitor_id::text
  FROM public.borrow_requests br
  JOIN public.books b ON b.id::text = br.book_id::text
  WHERE br.status IN ('borrowed', 'returned')
    AND (br.due_date IS NOT NULL OR COALESCE(br.fine_amount, 0) > 0)
    AND (v_role = 'superadmin' OR b.library_id = v_library_id)
    AND (p_library_id IS NULL OR b.library_id::text = p_library_id);
END;
$function$
  $function_ddl$;

  ALTER FUNCTION public.get_fine_payment_alert_targets(text) OWNER TO postgres;
  EXECUTE 'REVOKE ALL ON FUNCTION public.get_fine_payment_alert_targets(text) FROM PUBLIC, anon';
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.get_fine_payment_alert_targets(text) TO authenticated, service_role';

  v_oid := pg_catalog.to_regprocedure('public.get_fine_payment_alert_targets(text)');

  SELECT pg_catalog.pg_get_function_result(p.oid), owner_role.rolname,
         language.lanname, p.provolatile, p.prosecdef, p.proconfig,
         pg_catalog.md5(pg_catalog.btrim(
           pg_catalog.regexp_replace(
             pg_catalog.replace(p.prosrc, E'\r\n', E'\n'),
             '[[:blank:]]+$', '', 'gm'
           ), E' \t\n\r'
         ))
    INTO v_result, v_owner, v_language, v_volatility,
         v_security_definer, v_config, v_body_md5
  FROM pg_catalog.pg_proc AS p
  JOIN pg_catalog.pg_roles AS owner_role ON owner_role.oid = p.proowner
  JOIN pg_catalog.pg_language AS language ON language.oid = p.prolang
  WHERE p.oid = v_oid;

  IF v_result IS DISTINCT FROM 'TABLE(request_id text, visitor_id text)'
     OR v_owner IS DISTINCT FROM 'postgres'
     OR v_language IS DISTINCT FROM 'plpgsql'
     OR v_volatility IS DISTINCT FROM 'v'::"char"
     OR v_security_definer IS DISTINCT FROM true
     OR v_config IS DISTINCT FROM ARRAY['search_path=public, pg_temp']::text[]
     OR v_body_md5 IS DISTINCT FROM '1cf43ecab26431fbe481eaf0e509ad02'
     OR pg_catalog.has_function_privilege('anon', v_oid, 'EXECUTE')
     OR NOT pg_catalog.has_function_privilege('authenticated', v_oid, 'EXECUTE')
     OR NOT pg_catalog.has_function_privilege('service_role', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION
      'Created public.get_fine_payment_alert_targets(text) failed canonical definition/security validation';
  END IF;

  SELECT count(*)::integer,
         count(*) FILTER (WHERE acl.grantee = v_owner_oid AND acl.privilege_type = 'EXECUTE'
                                AND NOT acl.is_grantable AND acl.grantor = v_owner_oid)::integer,
         count(*) FILTER (WHERE acl.grantee = v_authenticated_oid AND acl.privilege_type = 'EXECUTE'
                                AND NOT acl.is_grantable AND acl.grantor = v_owner_oid)::integer,
         count(*) FILTER (WHERE acl.grantee = v_service_role_oid AND acl.privilege_type = 'EXECUTE'
                                AND NOT acl.is_grantable AND acl.grantor = v_owner_oid)::integer,
         count(*) FILTER (WHERE acl.grantee = 0 OR acl.grantee = v_anon_oid
                                OR acl.privilege_type <> 'EXECUTE' OR acl.is_grantable
                                OR acl.grantor <> v_owner_oid)::integer
    INTO v_acl_count, v_owner_exec_count, v_authenticated_exec_count,
         v_service_exec_count, v_bad_acl_count
  FROM pg_catalog.aclexplode(COALESCE(
    (SELECT p.proacl FROM pg_catalog.pg_proc AS p WHERE p.oid = v_oid),
    pg_catalog.acldefault('f'::"char", v_owner_oid)
  )) AS acl;

  IF v_owner_exec_count <> 1 OR v_authenticated_exec_count <> 1
     OR v_service_exec_count <> 1 OR v_bad_acl_count <> 0 OR v_acl_count <> 3 THEN
    RAISE EXCEPTION
      'Created public.get_fine_payment_alert_targets(text) has unexpected explicit ACL entries';
  END IF;
END
$fine_alert_target_prerequisite$;

COMMIT;