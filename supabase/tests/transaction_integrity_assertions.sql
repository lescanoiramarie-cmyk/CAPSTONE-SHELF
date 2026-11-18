-- Read-only catalog assertions for transaction-critical RPC hardening.
-- Covers migrations: 20270102002400_transaction_rpc_hardening.sql
DO $tests$
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
  v_oid := pg_catalog.to_regprocedure(v_signature)::oid;
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
  IF pg_catalog.strpos(v_definition, 'IS DISTINCT FROM ''aal2''') = 0
     OR pg_catalog.strpos(v_definition, 'auth.jwt() ->> ''aal''') = 0
     OR pg_catalog.strpos(v_definition, 'auth.uid() IS NULL') = 0
     OR pg_catalog.strpos(v_definition, 'FOR UPDATE') = 0
     OR pg_catalog.strpos(v_definition, 'auth_user_id = p_visitor_id') = 0
     OR pg_catalog.strpos(v_definition, 'id = p_visitor_id::text') = 0 THEN
    RAISE EXCEPTION 'request_borrow_unchecked missing AAL2, auth.uid(), FOR UPDATE, or visitor lookup.';
  END IF;

  SELECT pg_catalog.count(*) INTO v_acl_count
  FROM pg_catalog.pg_proc AS p
  CROSS JOIN LATERAL pg_catalog.aclexplode(p.proacl) AS acl
  WHERE p.oid = v_oid;

  IF v_acl_count <> 1
     OR pg_catalog.has_function_privilege('anon', v_signature, 'EXECUTE')
     OR NOT pg_catalog.has_function_privilege('authenticated', v_signature, 'EXECUTE')
     OR pg_catalog.has_function_privilege('service_role', v_signature, 'EXECUTE') THEN
    RAISE EXCEPTION 'request_borrow_unchecked EXECUTE grants differ from least-privilege contract.';
  END IF;

  -- ============================================================
  -- 2. public.confirm_return(uuid, text) - legacy UUID overload
  -- ============================================================
  v_signature := 'public.confirm_return(uuid,text)'::regprocedure;
  v_oid := pg_catalog.to_regprocedure(v_signature)::oid;
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
  IF pg_catalog.strpos(v_definition, 'IS DISTINCT FROM ''aal2''') = 0
     OR pg_catalog.strpos(v_definition, 'IS DISTINCT FROM v_staff_role') = 0
     OR pg_catalog.strpos(v_definition, 'is_active_staff_for_branch') = 0
     OR pg_catalog.strpos(v_definition, 'release_copy_and_promote') = 0
     OR pg_catalog.strpos(v_definition, 'FOR UPDATE') = 0 THEN
    RAISE EXCEPTION 'confirm_return(uuid,text) missing AAL2, exact role match, branch auth, promote, or FOR UPDATE.';
  END IF;

  SELECT pg_catalog.count(*) INTO v_acl_count
  FROM pg_catalog.pg_proc AS p
  CROSS JOIN LATERAL pg_catalog.aclexplode(p.proacl) AS acl
  WHERE p.oid = v_oid;

  IF v_acl_count <> 2
     OR NOT pg_catalog.has_function_privilege('authenticated', v_signature, 'EXECUTE')
     OR NOT pg_catalog.has_function_privilege('service_role', v_signature, 'EXECUTE')
     OR pg_catalog.has_function_privilege('anon', v_signature, 'EXECUTE') THEN
    RAISE EXCEPTION 'confirm_return(uuid,text) EXECUTE grants differ from contract.';
  END IF;

  -- ============================================================
  -- 3. public.record_fine_payment(text, numeric, text, text, text)
  -- ============================================================
  v_signature := 'public.record_fine_payment(text,numeric,text,text,text)'::regprocedure;
  v_oid := pg_catalog.to_regprocedure(v_signature)::oid;
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'Missing function: public.record_fine_payment(text,numeric,text,text,text)';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS p
    JOIN pg_catalog.pg_language AS l ON l.oid = p.prolang
    WHERE p.oid = v_oid
      AND p.proowner = 'postgres'::regrole
      AND p.prorettype = 'jsonb'::regtype
      AND p.pronargs = 5
      AND l.lanname = 'plpgsql'
      AND p.provolatile = 'v'
      AND p.prosecdef
      AND p.proconfig = ARRAY['search_path=""']::text[]
  ) THEN
    RAISE EXCEPTION 'record_fine_payment metadata differs from contract.';
  END IF;

  v_definition := pg_catalog.pg_get_functiondef(v_oid);
  IF pg_catalog.strpos(v_definition, 'IS DISTINCT FROM ''aal2''') = 0
     OR pg_catalog.strpos(v_definition, 'IS DISTINCT FROM v_role') = 0
     OR pg_catalog.strpos(v_definition, 'fine_paid_amount') = 0
     OR pg_catalog.strpos(v_definition, 'fine_payments') = 0
     OR pg_catalog.strpos(v_definition, 'FOR UPDATE') = 0 THEN
    RAISE EXCEPTION 'record_fine_payment missing AAL2, exact role match, payment tracking, or FOR UPDATE.';
  END IF;

  SELECT pg_catalog.count(*) INTO v_acl_count
  FROM pg_catalog.pg_proc AS p
  CROSS JOIN LATERAL pg_catalog.aclexplode(p.proacl) AS acl
  WHERE p.oid = v_oid;

  IF v_acl_count <> 2
     OR NOT pg_catalog.has_function_privilege('authenticated', v_signature, 'EXECUTE')
     OR NOT pg_catalog.has_function_privilege('service_role', v_signature, 'EXECUTE')
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
    v_oid := pg_catalog.to_regprocedure(v_signature)::oid;
    IF v_oid IS NULL THEN
      RAISE EXCEPTION 'Missing wrapper function: %', v_signature;
    END IF;

    v_definition := pg_catalog.pg_get_functiondef(v_oid);
    IF pg_catalog.strpos(v_definition, 'IS DISTINCT FROM ''aal2''') = 0
       OR pg_catalog.strpos(v_definition, 'IS DISTINCT FROM v_role') = 0
       OR pg_catalog.strpos(v_definition, 'auth.uid() IS NULL') = 0 THEN
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
      AND (p.proconfig IS NULL OR p.proconfig = '{}' OR
           p.proconfig @> ARRAY['search_path=public']::text[] OR
           p.proconfig @> ARRAY['search_path=public, pg_temp']::text[])
      AND p.proname NOT IN (
        'capture_shelf_audit_event',
        'get_opac_category_book_counts'
      )
  ) THEN
    RAISE EXCEPTION 'SECURITY DEFINER function has non-empty search_path in public schema.';
  END IF;
END;
$tests$;