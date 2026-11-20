CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
BEGIN;
SELECT extensions.plan(1);

-- Read-only catalog assertions for transaction-critical RPC hardening.
-- Covers migrations: 20270102002400_transaction_rpc_hardening.sql
SELECT extensions.lives_ok($tap$DO $tests$
DECLARE
  v_signature regprocedure;
  v_oid oid;
  v_definition text;
  v_acl_count integer;
BEGIN
  -- ============================================================
  -- 1. shelf_private.request_borrow_unchecked(uuid, text)
  -- ============================================================
  v_signature := 'shelf_private.request_borrow_unchecked(uuid,text)'::regprocedure;
  v_oid := v_signature::oid;
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'Missing function: shelf_private.request_borrow_unchecked(uuid,text)';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS p
    JOIN pg_catalog.pg_language AS l ON l.oid = p.prolang
    WHERE p.oid = v_oid
      AND p.proowner = 'postgres'::regrole
      AND p.prorettype = 'public.borrow_requests'::regtype
      AND p.pronargs = 2
      AND p.proargtypes[0] = 'uuid'::regtype
      AND p.proargtypes[1] = 'text'::regtype
      AND l.lanname = 'plpgsql'
      AND p.provolatile = 'v'
      AND p.prosecdef
      AND p.proconfig = ARRAY['search_path=""']::text[]
  ) THEN
    RAISE EXCEPTION 'request_borrow_unchecked metadata differs from contract.';
  END IF;

  v_definition := pg_catalog.pg_get_functiondef(v_oid);
  IF pg_catalog.strpos(v_definition, 'v_uid IS NULL') = 0
     OR pg_catalog.strpos(v_definition, 'FOR UPDATE') = 0
     OR pg_catalog.strpos(v_definition, 'auth_user_id = p_visitor_id') = 0
     OR pg_catalog.strpos(v_definition, 'id = p_visitor_id::text') = 0 THEN
    RAISE EXCEPTION 'request_borrow_unchecked missing auth.uid(), FOR UPDATE, or visitor lookup.';
  END IF;

  SELECT pg_catalog.count(*) INTO v_acl_count
  FROM pg_catalog.pg_proc AS p
  CROSS JOIN LATERAL pg_catalog.aclexplode(p.proacl) AS acl
  WHERE p.oid = v_oid;

  IF v_acl_count <> 1
     OR pg_catalog.has_function_privilege('anon', v_signature, 'EXECUTE')
     OR pg_catalog.has_function_privilege('authenticated', v_signature, 'EXECUTE')
     OR pg_catalog.has_function_privilege('service_role', v_signature, 'EXECUTE') THEN
    RAISE EXCEPTION 'request_borrow_unchecked must be owner-only; API role EXECUTE grants are forbidden.';
  END IF;

  -- ============================================================
  -- 2. public.confirm_return(uuid, text) - legacy UUID overload
  -- ============================================================
  v_signature := 'public.confirm_return(uuid,text)'::regprocedure;
  v_oid := v_signature::oid;
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'Missing function: public.confirm_return(uuid,text)';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS p
    JOIN pg_catalog.pg_language AS l ON l.oid = p.prolang
    WHERE p.oid = v_oid
      AND p.proowner = 'postgres'::regrole
      AND p.prorettype = 'void'::regtype
      AND p.pronargs = 2
      AND p.proargtypes[0] = 'uuid'::regtype
      AND p.proargtypes[1] = 'text'::regtype
      AND l.lanname = 'plpgsql'
      AND p.provolatile = 'v'
      AND p.prosecdef
      AND p.proconfig = ARRAY['search_path=""']::text[]
  ) THEN
    RAISE EXCEPTION 'confirm_return(uuid,text) metadata differs from contract.';
  END IF;

  v_definition := pg_catalog.pg_get_functiondef(v_oid);
  IF pg_catalog.strpos(v_definition, 'confirm_return(p_request_id::text, p_staff_name)') = 0 THEN
    RAISE EXCEPTION 'UUID compatibility overload must delegate only after preserving the text validator.';
  END IF;
  v_definition := pg_catalog.pg_get_functiondef('public.confirm_return(text,text)'::regprocedure);
  IF pg_catalog.strpos(v_definition, 'IS DISTINCT FROM ''aal2''') = 0
     OR pg_catalog.strpos(v_definition, 'IS DISTINCT FROM v_staff_role') = 0
     OR pg_catalog.strpos(v_definition, 'sp.is_active IS TRUE') = 0
     OR pg_catalog.strpos(v_definition, 'FOR UPDATE') = 0 THEN
    RAISE EXCEPTION 'Text return implementation missing AAL2, exact role match, active staff, or row locking.';
  END IF;

  SELECT pg_catalog.count(*) INTO v_acl_count
  FROM pg_catalog.pg_proc AS p
  CROSS JOIN LATERAL pg_catalog.aclexplode(p.proacl) AS acl
  WHERE p.oid = v_oid;

  IF v_acl_count <> 1
     OR pg_catalog.has_function_privilege('authenticated', v_signature, 'EXECUTE')
     OR pg_catalog.has_function_privilege('service_role', v_signature, 'EXECUTE')
     OR pg_catalog.has_function_privilege('anon', v_signature, 'EXECUTE') THEN
    RAISE EXCEPTION 'confirm_return(uuid,text) EXECUTE grants differ from contract.';
  END IF;

  -- ============================================================
  -- 3. Public authenticated wrapper is the idempotent v2 RPC.
  -- ============================================================
  v_signature := 'public.record_fine_payment_v2(text,numeric,text,text,text,uuid)'::regprocedure;
  v_oid := v_signature::oid;
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'Missing function: public.record_fine_payment_v2(text,numeric,text,text,text,uuid)';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS p
    JOIN pg_catalog.pg_language AS l ON l.oid = p.prolang
    WHERE p.oid = v_oid
      AND p.proowner = 'postgres'::regrole
      AND p.prorettype = 'jsonb'::regtype
      AND p.pronargs = 6
      AND l.lanname = 'plpgsql'
      AND p.provolatile = 'v'
      AND p.prosecdef
      AND p.proconfig = ARRAY['search_path=""']::text[]
  ) THEN
    RAISE EXCEPTION 'record_fine_payment metadata differs from contract.';
  END IF;

  v_definition := pg_catalog.pg_get_functiondef(v_oid);
  IF pg_catalog.strpos(v_definition, 'IS DISTINCT FROM ''aal2''') = 0
     OR pg_catalog.strpos(v_definition, 'IS DISTINCT FROM ''subadmin''') = 0
     OR pg_catalog.strpos(v_definition, 'p_idempotency_key') = 0
     OR pg_catalog.strpos(v_definition, 'record_fine_payment_subadmin_internal') = 0 THEN
    RAISE EXCEPTION 'record_fine_payment_v2 must require AAL2, exact sub-admin claim, and delegate with an idempotency key.';
  END IF;

  SELECT pg_catalog.count(*) INTO v_acl_count
  FROM pg_catalog.pg_proc AS p
  CROSS JOIN LATERAL pg_catalog.aclexplode(p.proacl) AS acl
  WHERE p.oid = v_oid;

  IF v_acl_count <> 2
     OR NOT pg_catalog.has_function_privilege('authenticated', v_signature, 'EXECUTE')
     OR pg_catalog.has_function_privilege('service_role', v_signature, 'EXECUTE')
     OR pg_catalog.has_function_privilege('anon', v_signature, 'EXECUTE') THEN
    RAISE EXCEPTION 'record_fine_payment EXECUTE grants differ from contract.';
  END IF;

  -- ============================================================
  -- 4. Wrapper RPCs (get_fine_payment_dashboard, get_fine_payment_alert_targets,
  --    get_fine_payment_analytics, record_fine_payment wrapper, resolve_fine_review)
  -- ============================================================
  FOREACH v_signature IN ARRAY ARRAY[
    'public.get_fine_payment_dashboard(text)',
    'public.get_fine_payment_alert_targets(text)',
    'public.get_fine_payment_analytics(text)',
    'public.record_fine_payment(text,numeric,text,text,text)',  -- wrapper
    'public.resolve_fine_review(text,text,numeric,text)'
  ] LOOP
    v_oid := v_signature::oid;
    IF v_oid IS NULL THEN
      RAISE EXCEPTION 'Missing wrapper function: %', v_signature;
    END IF;

    v_definition := pg_catalog.pg_get_functiondef(v_oid);
    IF (pg_catalog.strpos(v_definition, 'IS DISTINCT FROM ''aal2''') = 0
        AND pg_catalog.strpos(v_definition, 'aal1') = 0)
       OR pg_catalog.strpos(v_definition, 'IS DISTINCT FROM v_role') = 0
       OR (pg_catalog.strpos(v_definition, 'auth.uid() IS NULL') = 0
           AND (pg_catalog.strpos(v_definition, 'auth.uid()') = 0
                OR pg_catalog.strpos(v_definition, 'IS NULL') = 0)) THEN
      RAISE EXCEPTION 'Wrapper % missing AAL2 or exact role validation.', v_signature;
    END IF;
  END LOOP;

  -- ============================================================
  -- 5. Search_path isolation on all SECURITY DEFINER functions
  -- ============================================================
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS p
    JOIN pg_catalog.pg_namespace AS n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public'
      AND p.prosecdef
      AND (p.proconfig IS NULL OR pg_catalog.cardinality(p.proconfig) <> 1 OR
           p.proconfig[1] NOT IN (
             'search_path=""',
             'search_path=public',
             'search_path=public, pg_temp',
             'search_path=public, auth',
             'search_path=pg_catalog, public, pg_temp',
             'search_path=pg_catalog, public, auth, pg_temp'
           ))
      AND p.proname NOT IN (
        'capture_shelf_audit_event',
        'get_opac_category_book_counts'
      )
  ) THEN
    RAISE EXCEPTION 'SECURITY DEFINER function has non-empty search_path in public schema.';
  END IF;
END;
$tests$;$tap$, 'transaction integrity assertions contract block 1');
SELECT * FROM extensions.finish();
ROLLBACK;
