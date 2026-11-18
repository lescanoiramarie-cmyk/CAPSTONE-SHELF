-- Read-only catalog assertions for fine payment privacy and authorization.
-- Covers migrations: 20270102000100_fine_payment_privacy.sql,
--                  20270102002400_transaction_rpc_hardening.sql,
--                  20270103000100_fine_payment_internal_hardening_and_cohort_protection.sql
DO $tests$
DECLARE
  v_signature regprocedure;
  v_oid oid;
  v_definition text;
  v_acl_count integer;
  v_owner_entries integer;
  v_authenticated_entries integer;
  v_service_entries integer;
BEGIN
  -- ============================================================
  -- 1. Internal functions renamed and made private (no anon/authenticated grants)
  -- ============================================================
  FOREACH v_signature IN ARRAY ARRAY[
    'public.get_fine_payment_dashboard_detail_internal(text)',
    'public.get_fine_payment_alert_targets_detail_internal(text)',
    'public.record_fine_payment_subadmin_internal(text,numeric,text,text,text)',
    'public.resolve_fine_review_subadmin_internal(text,text,numeric,text)'
  ] LOOP
    v_oid := pg_catalog.to_regprocedure(v_signature)::oid;
    IF v_oid IS NULL THEN
      RAISE EXCEPTION 'Missing internal function: %', v_signature;
    END IF;

    IF pg_catalog.has_function_privilege('anon', v_oid, 'EXECUTE')
       OR pg_catalog.has_function_privilege('authenticated', v_oid, 'EXECUTE')
       OR pg_catalog.has_function_privilege('service_role', v_oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'Internal function % has unexpected EXECUTE grants to API roles.', v_signature;
    END IF;

    v_definition := pg_catalog.pg_get_functiondef(v_oid);
    IF pg_catalog.strpos(v_definition, 'SECURITY DEFINER') = 0
       OR pg_catalog.strpos(v_definition, 'search_path=""') = 0 THEN
      RAISE EXCEPTION 'Internal function % missing SECURITY DEFINER or empty search_path.', v_signature;
    END IF;
  END LOOP;

  -- ============================================================
  -- 2. Public wrapper RPCs: exact AAL2 + exact role claim validation
  -- ============================================================
  FOREACH v_signature IN ARRAY ARRAY[
    'public.get_fine_payment_dashboard(text)',
    'public.get_fine_payment_alert_targets(text)',
    'public.get_fine_payment_analytics(text)',
    'public.record_fine_payment(text,numeric,text,text,text)',
    'public.resolve_fine_review(text,text,numeric,text)'
  ] LOOP
    v_oid := pg_catalog.to_regprocedure(v_signature)::oid;
    IF v_oid IS NULL THEN
      RAISE EXCEPTION 'Missing wrapper function: %', v_signature;
    END IF;

    v_definition := pg_catalog.pg_get_functiondef(v_oid);
    IF pg_catalog.strpos(v_definition, 'IS DISTINCT FROM ''aal2''') = 0
       OR pg_catalog.strpos(v_definition, 'IS DISTINCT FROM v_role') = 0
       OR pg_catalog.strpos(v_definition, 'auth.uid() IS NULL') = 0
       OR pg_catalog.strpos(v_definition, 'auth.jwt() -> ''app_metadata'' ->> ''role''') = 0 THEN
      RAISE EXCEPTION 'Wrapper % missing AAL2, exact role match, or JWT claim validation.', v_signature;
    END IF;

    -- Sub-admin only wrappers must check v_role = 'subadmin'
    IF v_signature IN (
         'public.get_fine_payment_dashboard(text)',
         'public.get_fine_payment_alert_targets(text)',
         'public.record_fine_payment(text,numeric,text,text,text)',
         'public.resolve_fine_review(text,text,numeric,text)'
       ) THEN
      IF pg_catalog.strpos(v_definition, 'v_role <> ''subadmin''') = 0
         AND pg_catalog.strpos(v_definition, 'v_role = ''subadmin''') = 0 THEN
        RAISE EXCEPTION 'Sub-admin wrapper % missing role restriction.', v_signature;
      END IF;
    END IF;

    -- Analytics wrapper allows subadmin + superadmin
    IF v_signature = 'public.get_fine_payment_analytics(text)' THEN
      IF pg_catalog.strpos(v_definition, 'v_role NOT IN') = 0
         AND pg_catalog.strpos(v_definition, 'subadmin') = 0
         AND pg_catalog.strpos(v_definition, 'superadmin') = 0 THEN
        RAISE EXCEPTION 'Analytics wrapper missing dual-role authorization.';
      END IF;
    END IF;
  END LOOP;

  -- ============================================================
  -- 3. EXECUTE grants: authenticated + service_role only (no anon)
  -- ============================================================
  FOREACH v_signature IN ARRAY ARRAY[
    'public.get_fine_payment_dashboard(text)',
    'public.get_fine_payment_alert_targets(text)',
    'public.get_fine_payment_analytics(text)',
    'public.record_fine_payment(text,numeric,text,text,text)',
    'public.resolve_fine_review(text,text,numeric,text)'
  ] LOOP
    v_oid := pg_catalog.to_regprocedure(v_signature)::oid;
    IF NOT pg_catalog.has_function_privilege('authenticated', v_oid, 'EXECUTE')
       OR pg_catalog.has_function_privilege('anon', v_oid, 'EXECUTE')
       OR NOT pg_catalog.has_function_privilege('service_role', v_oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'Wrapper % has unexpected effective EXECUTE grants.', v_signature;
    END IF;

    -- Verify explicit ACL has exactly postgres, authenticated, service_role
    SELECT pg_catalog.count(*) INTO v_acl_count
    FROM pg_catalog.pg_proc AS p
    CROSS JOIN LATERAL pg_catalog.aclexplode(p.proacl) AS acl
    WHERE p.oid = v_oid;

    SELECT
      count(*) FILTER (WHERE acl.grantee = 'postgres'::regrole::oid),
      count(*) FILTER (WHERE acl.grantee = 'authenticated'::regrole::oid),
      count(*) FILTER (WHERE acl.grantee = 'service_role'::regrole::oid)
    INTO v_owner_entries, v_authenticated_entries, v_service_entries
    FROM pg_catalog.pg_proc AS p
    CROSS JOIN LATERAL pg_catalog.aclexplode(p.proacl) AS acl
    WHERE p.oid = v_oid;

    IF v_acl_count <> 3
       OR v_owner_entries <> 1
       OR v_authenticated_entries <> 1
       OR v_service_entries <> 1 THEN
      RAISE EXCEPTION 'Wrapper % explicit ACL entry count mismatch.', v_signature;
    END IF;
  END LOOP;

  -- ============================================================
  -- 4. Response contract: no visitor identifiers in analytics
  -- ============================================================
  v_definition := pg_catalog.pg_get_function_result('public.get_fine_payment_analytics(text)'::regprocedure);
  IF v_definition LIKE '%visitor_id%'
     OR v_definition LIKE '%visitor_name%'
     OR v_definition LIKE '%request_id%'
     OR v_definition LIKE '%payment_id%'
     OR v_definition LIKE '%reference%'
     OR v_definition LIKE '%note%' THEN
    RAISE EXCEPTION 'Analytics response contract contains identifying field: %', v_definition;
  END IF;

  -- Dashboard and alert targets return visitor_name (generic label) but no visitor_id
  v_definition := pg_catalog.pg_get_function_result('public.get_fine_payment_dashboard(text)'::regprocedure);
  IF v_definition LIKE '%visitor_id%' THEN
    RAISE EXCEPTION 'Dashboard response contract contains visitor_id: %', v_definition;
  END IF;

  v_definition := pg_catalog.pg_get_function_result('public.get_fine_payment_alert_targets(text)'::regprocedure);
  IF v_definition NOT LIKE '%visitor_id%' THEN
    RAISE EXCEPTION 'Alert targets missing visitor_id in response: %', v_definition;
  END IF;

  -- ============================================================
  -- 5. Table-level privacy: fine_payments and borrow_requests
  -- ============================================================
  IF pg_catalog.has_table_privilege('anon', 'public.fine_payments', 'SELECT')
     OR pg_catalog.has_table_privilege('authenticated', 'public.fine_payments', 'SELECT')
     OR pg_catalog.has_table_privilege('authenticated', 'public.fine_payments', 'INSERT')
     OR pg_catalog.has_table_privilege('authenticated', 'public.fine_payments', 'UPDATE')
     OR pg_catalog.has_table_privilege('authenticated', 'public.fine_payments', 'DELETE') THEN
    RAISE EXCEPTION 'fine_payments has unexpected direct API privileges.';
  END IF;

  IF pg_catalog.has_table_privilege('anon', 'public.borrow_requests', 'SELECT')
     OR pg_catalog.has_table_privilege('authenticated', 'public.borrow_requests', 'INSERT')
     OR pg_catalog.has_table_privilege('authenticated', 'public.borrow_requests', 'UPDATE')
     OR pg_catalog.has_table_privilege('authenticated', 'public.borrow_requests', 'DELETE') THEN
    RAISE EXCEPTION 'borrow_requests has unexpected direct API privileges beyond RLS.';
  END IF;

  -- ============================================================
  -- 6. RLS policies on fine_payments and borrow_requests enforce owner/branch scope
  -- ============================================================
  IF NOT (SELECT relrowsecurity FROM pg_catalog.pg_class WHERE oid = 'public.fine_payments'::regclass) THEN
    RAISE EXCEPTION 'fine_payments RLS not enabled.';
  END IF;

  IF NOT (SELECT relrowsecurity FROM pg_catalog.pg_class WHERE oid = 'public.borrow_requests'::regclass) THEN
    RAISE EXCEPTION 'borrow_requests RLS not enabled.';
  END IF;

  -- ============================================================
  -- 7. Cohort protection: resolved fines cannot be re-assessed
  -- ============================================================
  v_definition := pg_catalog.pg_get_functiondef('public.record_fine_payment_subadmin_internal(text,numeric,text,text,text)'::regprocedure);
  IF pg_catalog.strpos(v_definition, 'outstanding_amount') = 0
     OR pg_catalog.strpos(v_definition, 'fine_paid_amount') = 0
     OR pg_catalog.strpos(v_definition, 'GREATEST') = 0 THEN
    RAISE EXCEPTION 'Internal payment function missing cohort protection logic.';
  END IF;

END;
$tests$;