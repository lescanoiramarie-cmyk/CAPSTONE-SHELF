BEGIN;

-- The November 3 migration defines this RPC as RETURNS TABLE, while the
-- November 30 migration changes it to RETURNS void using CREATE OR REPLACE.
-- PostgreSQL cannot change a function's return type with CREATE OR REPLACE.
-- Prepare the canonical November 30 contract before that migration on a clean
-- replay. If November 30 is already in migration history, validate the final
-- function and leave it untouched (important for already-migrated databases).
DO $community_pickup_return_contract$
DECLARE
  v_november_30_applied boolean;
  v_function_oid oid;
  v_return_type text;
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
BEGIN
  IF current_user <> 'postgres' THEN
    RAISE EXCEPTION
      'Community pickup return-contract prerequisite requires current_user=postgres; found %',
      current_user;
  END IF;

  IF pg_catalog.to_regclass('supabase_migrations.schema_migrations') IS NULL THEN
    RAISE EXCEPTION
      'supabase_migrations.schema_migrations is unavailable; cannot safely determine whether the November 30 migration already ran';
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM supabase_migrations.schema_migrations AS migration
    WHERE migration.version = '20261130000000'
  )
  INTO v_november_30_applied;

  v_function_oid := pg_catalog.to_regprocedure(
    'public.confirm_community_book_pickup(uuid,text)'
  );

  IF v_november_30_applied THEN
    IF v_function_oid IS NULL THEN
      RAISE EXCEPTION
        'November 30 is recorded as applied, but public.confirm_community_book_pickup(uuid,text) is missing';
    END IF;

    SELECT pg_catalog.pg_get_function_result(p.oid), owner_role.rolname,
           language.lanname, p.provolatile, p.prosecdef, p.proconfig
      INTO v_return_type, v_owner, v_language, v_volatility,
           v_security_definer, v_config
    FROM pg_catalog.pg_proc AS p
    JOIN pg_catalog.pg_roles AS owner_role ON owner_role.oid = p.proowner
    JOIN pg_catalog.pg_language AS language ON language.oid = p.prolang
    WHERE p.oid = v_function_oid;

    IF v_return_type IS DISTINCT FROM 'void'
       OR v_owner IS DISTINCT FROM 'postgres'
       OR v_language IS DISTINCT FROM 'plpgsql'
       OR v_volatility IS DISTINCT FROM 'v'::"char"
       OR v_security_definer IS DISTINCT FROM true
       OR v_config IS DISTINCT FROM ARRAY['search_path=""']::text[] THEN
      RAISE EXCEPTION
        'November 30 is recorded as applied, but public.confirm_community_book_pickup(uuid,text) does not have the expected final signature/security metadata';
    END IF;

    IF pg_catalog.has_function_privilege('anon', v_function_oid, 'EXECUTE')
       OR NOT pg_catalog.has_function_privilege('authenticated', v_function_oid, 'EXECUTE')
       OR NOT pg_catalog.has_function_privilege('service_role', v_function_oid, 'EXECUTE') THEN
      RAISE EXCEPTION
        'November 30 is recorded as applied, but public.confirm_community_book_pickup(uuid,text) has unexpected effective EXECUTE privileges';
    END IF;

    -- Later checked-in migrations intentionally revise this function body.
    -- Do not replace it on databases where the November 30 migration ran.
    RETURN;
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

  IF v_function_oid IS NOT NULL THEN
    SELECT pg_catalog.pg_get_function_result(p.oid), owner_role.rolname,
           language.lanname, p.provolatile, p.prosecdef, p.proconfig,
           pg_catalog.md5(pg_catalog.btrim(
             pg_catalog.regexp_replace(
               pg_catalog.replace(p.prosrc, E'\r\n', E'\n'),
               '[[:blank:]]+$', '', 'gm'
             ), E' \t\n\r'
           ))
      INTO v_return_type, v_owner, v_language, v_volatility,
           v_security_definer, v_config, v_body_md5
    FROM pg_catalog.pg_proc AS p
    JOIN pg_catalog.pg_roles AS owner_role ON owner_role.oid = p.proowner
    JOIN pg_catalog.pg_language AS language ON language.oid = p.prolang
    WHERE p.oid = v_function_oid;

    IF v_return_type = 'void' THEN
      IF v_owner IS DISTINCT FROM 'postgres'
         OR v_language IS DISTINCT FROM 'plpgsql'
         OR v_volatility IS DISTINCT FROM 'v'::"char"
         OR v_security_definer IS DISTINCT FROM true
         OR v_config IS DISTINCT FROM ARRAY['search_path=""']::text[]
         OR v_body_md5 IS DISTINCT FROM '10044b01b6396bcd6cde6ed65945d0a9' THEN
        RAISE EXCEPTION
          'Existing void public.confirm_community_book_pickup(uuid,text) differs from the canonical November 30 definition or security properties';
      END IF;
    ELSIF v_return_type = 'TABLE(id uuid, status text, borrow_date timestamp with time zone, due_date timestamp with time zone, confirmed_by text)' THEN
      IF v_owner IS DISTINCT FROM 'postgres'
         OR v_language IS DISTINCT FROM 'plpgsql'
         OR v_volatility IS DISTINCT FROM 'v'::"char"
         OR v_security_definer IS DISTINCT FROM true
         OR v_config IS DISTINCT FROM ARRAY['search_path=public']::text[]
         OR v_body_md5 IS DISTINCT FROM '63a51f5182cf7bac225d3ec762b0aba9' THEN
        RAISE EXCEPTION
          'Existing table-returning public.confirm_community_book_pickup(uuid,text) differs from the canonical November 3 definition or security properties';
      END IF;
    ELSE
      RAISE EXCEPTION
        'Existing public.confirm_community_book_pickup(uuid,text) has an unexpected return contract: %',
        v_return_type;
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
      (SELECT p.proacl FROM pg_catalog.pg_proc AS p WHERE p.oid = v_function_oid),
      pg_catalog.acldefault('f'::"char", v_owner_oid)
    )) AS acl;

    IF v_owner_exec_count <> 1
       OR v_authenticated_exec_count <> 1
       OR v_public_exec_count <> 0
       OR v_anon_exec_count <> 0
       OR v_bad_acl_count <> 0
       OR v_acl_count <> v_owner_exec_count + v_authenticated_exec_count + v_service_exec_count THEN
      RAISE EXCEPTION
        'Existing public.confirm_community_book_pickup(uuid,text) has unexpected direct ACL entries';
    END IF;

    IF pg_catalog.has_function_privilege('anon', v_function_oid, 'EXECUTE')
       OR NOT pg_catalog.has_function_privilege('authenticated', v_function_oid, 'EXECUTE') THEN
      RAISE EXCEPTION
        'Existing public.confirm_community_book_pickup(uuid,text) has unexpected effective anon/authenticated EXECUTE privileges';
    END IF;

    IF v_return_type <> 'void' THEN
      DROP FUNCTION public.confirm_community_book_pickup(uuid, text);
      v_function_oid := NULL;
    ELSE
      -- The already-canonical function must not be replaced or have its ACL
      -- changed on the valid-existing path.
      RETURN;
    END IF;
  END IF;

  EXECUTE $function_ddl$
    CREATE FUNCTION public.confirm_community_book_pickup(
      p_request_id uuid,
      p_owner_visitor_id text
    )
    RETURNS void
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path TO ''
    AS $function$
DECLARE
  v_req public.community_book_requests%ROWTYPE;
  v_book_type text;
  v_book_owner_id text;
  v_lending_enabled boolean;
  v_category text;
  v_fine_rate integer;
BEGIN
  -- Verify authenticated, active, OTP-verified owner.
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication is required.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.visitors AS v
    WHERE v.id::text = trim(p_owner_visitor_id)
      AND v.auth_user_id = auth.uid()
      AND v.otp_verified = true
      AND v.is_active = true
  ) THEN
    RAISE EXCEPTION
      'The authenticated, verified owner account could not be found.';
  END IF;

  -- Lock the request.
  SELECT cbr.*
  INTO v_req
  FROM public.community_book_requests AS cbr
  WHERE cbr.id = p_request_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Request not found.';
  END IF;

  IF v_req.owner_visitor_id <> trim(p_owner_visitor_id) THEN
    RAISE EXCEPTION
      'Only the owner of this community book can confirm pickup.';
  END IF;

  IF v_req.status <> 'approved' THEN
    RAISE EXCEPTION
      'This request is not approved for pickup.';
  END IF;

  -- Lock and validate the personal book.
  SELECT
    b.book_type,
    b.owner_visitor_id,
    b.lending_enabled,
    b.category
  INTO
    v_book_type,
    v_book_owner_id,
    v_lending_enabled,
    v_category
  FROM public.books AS b
  WHERE b.id = v_req.book_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Community book not found.';
  END IF;

  IF lower(trim(v_book_type)) <> 'personal'
     OR v_book_owner_id IS DISTINCT FROM trim(p_owner_visitor_id)
  THEN
    RAISE EXCEPTION
      'This book is not owned by the authenticated community book owner.';
  END IF;

  IF v_lending_enabled IS NOT TRUE THEN
    RAISE EXCEPTION
      'Pickup cannot proceed because lending is disabled for this book.';
  END IF;

  -- Derive the rate from the approved category mapping.
  v_fine_rate := public.get_category_fine_rate(v_category);

  IF v_fine_rate IS NULL THEN
    RAISE EXCEPTION
      'Pickup cannot proceed because this book has an unsupported or missing category.';
  END IF;

  -- Start the fixed seven-day loan and save its rate snapshot.
  UPDATE public.community_book_requests AS cbr
  SET
    status = 'borrowed',
    borrow_date = now(),
    due_date = now() + interval '7 days',
    confirmed_by = trim(p_owner_visitor_id),
    fine_rate_snapshot = v_fine_rate,
    fine_review_required = false,
    updated_at = now()
  WHERE cbr.id = p_request_id;
END;
    $function$
  $function_ddl$;

  GRANT EXECUTE ON FUNCTION public.confirm_community_book_pickup(uuid, text)
    TO authenticated, postgres, service_role;
  REVOKE ALL ON FUNCTION public.confirm_community_book_pickup(uuid, text)
    FROM PUBLIC, anon;

  v_function_oid := pg_catalog.to_regprocedure(
    'public.confirm_community_book_pickup(uuid,text)'
  );

  SELECT pg_catalog.pg_get_function_result(p.oid), owner_role.rolname,
         language.lanname, p.provolatile, p.prosecdef, p.proconfig,
         pg_catalog.md5(pg_catalog.btrim(
           pg_catalog.regexp_replace(
             pg_catalog.replace(p.prosrc, E'\r\n', E'\n'),
             '[[:blank:]]+$', '', 'gm'
           ), E' \t\n\r'
         ))
    INTO v_return_type, v_owner, v_language, v_volatility,
         v_security_definer, v_config, v_body_md5
  FROM pg_catalog.pg_proc AS p
  JOIN pg_catalog.pg_roles AS owner_role ON owner_role.oid = p.proowner
  JOIN pg_catalog.pg_language AS language ON language.oid = p.prolang
  WHERE p.oid = v_function_oid;

  IF v_return_type IS DISTINCT FROM 'void'
     OR v_owner IS DISTINCT FROM 'postgres'
     OR v_language IS DISTINCT FROM 'plpgsql'
     OR v_volatility IS DISTINCT FROM 'v'::"char"
     OR v_security_definer IS DISTINCT FROM true
     OR v_config IS DISTINCT FROM ARRAY['search_path=""']::text[]
     OR v_body_md5 IS DISTINCT FROM '10044b01b6396bcd6cde6ed65945d0a9'
     OR NOT pg_catalog.has_function_privilege('authenticated', v_function_oid, 'EXECUTE')
     OR NOT pg_catalog.has_function_privilege('service_role', v_function_oid, 'EXECUTE')
     OR pg_catalog.has_function_privilege('anon', v_function_oid, 'EXECUTE') THEN
    RAISE EXCEPTION
      'Created public.confirm_community_book_pickup(uuid,text) failed canonical definition/security validation';
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
    (SELECT p.proacl FROM pg_catalog.pg_proc AS p WHERE p.oid = v_function_oid),
    pg_catalog.acldefault('f'::"char", v_owner_oid)
  )) AS acl;

  IF v_owner_exec_count <> 1
     OR v_authenticated_exec_count <> 1
     OR v_service_exec_count <> 1
     OR v_bad_acl_count <> 0
     OR v_acl_count <> 3 THEN
    RAISE EXCEPTION
      'Created public.confirm_community_book_pickup(uuid,text) has unexpected explicit ACL entries';
  END IF;
END
$community_pickup_return_contract$;

COMMIT;