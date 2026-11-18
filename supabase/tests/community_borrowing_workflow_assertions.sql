-- Read-only catalog assertions for community borrowing workflow.
-- Covers migration: 20270103001100_fix_community_borrowing_workflow.sql
DO $tests$
DECLARE
  v_signature regprocedure;
  v_oid oid;
  v_definition text;
  v_acl_count integer;
  v_owner text;
  v_language text;
  v_volatility "char";
  v_secdef boolean;
  v_config text[];
  v_trigger_count integer;
  v_trigger_definition text;
BEGIN
  -- ============================================================
  -- 1. promote_next_community_request(text)
  -- ============================================================
  v_signature := 'public.promote_next_community_request(text)'::regprocedure;
  v_oid := pg_catalog.to_regprocedure(v_signature)::oid;
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'Missing function: public.promote_next_community_request(text)';
  END IF;

  SELECT p.proowner, l.lanname, p.provolatile, p.prosecdef, p.proconfig
    INTO v_owner, v_language, v_volatility, v_secdef, v_config
  FROM pg_catalog.pg_proc AS p
  JOIN pg_catalog.pg_language AS l ON l.oid = p.prolang
  WHERE p.oid = v_oid;

  IF v_owner <> 'postgres'
     OR v_language <> 'plpgsql'
     OR v_volatility IS DISTINCT FROM 'v'
     OR NOT v_secdef
     OR v_config IS DISTINCT FROM ARRAY['search_path=""']::text[] THEN
    RAISE EXCEPTION 'promote_next_community_request metadata differs from contract.';
  END IF;

  v_definition := pg_catalog.pg_get_functiondef(v_oid);
  IF pg_catalog.strpos(v_definition, 'book_type = ''personal''') = 0
     OR pg_catalog.strpos(v_definition, 'FOR UPDATE') = 0
     OR pg_catalog.strpos(v_definition, 'community_book_requests') = 0
     OR pg_catalog.strpos(v_definition, 'create_visitor_notification') = 0
     OR pg_catalog.strpos(v_definition, 'available_copies') = 0
     OR pg_catalog.strpos(v_definition, 'total_copies') = 0 THEN
    RAISE EXCEPTION 'promote_next_community_request missing personal book check, FOR UPDATE, queue logic, notifications, or inventory math.';
  END IF;

  -- Grants: service_role + postgres only
  SELECT pg_catalog.count(*) INTO v_acl_count
  FROM pg_catalog.pg_proc AS p
  CROSS JOIN LATERAL pg_catalog.aclexplode(p.proacl) AS acl
  WHERE p.oid = v_oid;

  IF v_acl_count <> 2
     OR NOT pg_catalog.has_function_privilege('service_role', v_signature, 'EXECUTE')
     OR NOT pg_catalog.has_function_privilege('postgres', v_signature, 'EXECUTE')
     OR pg_catalog.has_function_privilege('anon', v_signature, 'EXECUTE')
     OR pg_catalog.has_function_privilege('authenticated', v_signature, 'EXECUTE') THEN
    RAISE EXCEPTION 'promote_next_community_request grants differ from service_role+postgres contract.';
  END IF;

  -- ============================================================
  // 2. approve_community_book_request(uuid, text, text)
  // ============================================================
  v_signature := 'public.approve_community_book_request(uuid,text,text)'::regprocedure;
  v_oid := pg_catalog.to_regprocedure(v_signature)::oid;
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'Missing function: public.approve_community_book_request(uuid,text,text)';
  END IF;

  SELECT p.proowner, l.lanname, p.provolatile, p.prosecdef, p.proconfig
    INTO v_owner, v_language, v_volatility, v_secdef, v_config
  FROM pg_catalog.pg_proc AS p
  JOIN pg_catalog.pg_language AS l ON l.oid = p.prolang
  WHERE p.oid = v_oid;

  IF v_owner <> 'postgres'
     OR v_language <> 'plpgsql'
     OR v_volatility IS DISTINCT FROM 'v'
     OR NOT v_secdef
     OR v_config IS DISTINCT FROM ARRAY['search_path=""']::text[] THEN
    RAISE EXCEPTION 'approve_community_book_request metadata differs from contract.';
  END IF;

  v_definition := pg_catalog.pg_get_functiondef(v_oid);
  IF pg_catalog.strpos(v_definition, 'otp_verified') = 0
     OR pg_catalog.strpos(v_definition, 'is_active') = 0
     OR pg_catalog.strpos(v_definition, 'auth.uid()') = 0
     OR pg_catalog.strpos(v_definition, 'owner_visitor_id') = 0
     OR pg_catalog.strpos(v_definition, 'book_type = ''personal''') = 0
     OR pg_catalog.strpos(v_definition, 'lending_enabled') = 0
     OR pg_catalog.strpos(v_definition, 'is_public') = 0
     OR pg_catalog.strpos(v_definition, 'FOR UPDATE') = 0
     OR pg_catalog.strpos(v_definition, 'available_copies') = 0
     OR pg_catalog.strpos(v_definition, 'total_copies') = 0
     OR pg_catalog.strpos(v_definition, 'request_date') = 0
     OR pg_catalog.strpos(v_definition, 'create_visitor_notification') = 0
     OR pg_catalog.strpos(v_definition, 'community_request_approved') = 0 THEN
    RAISE EXCEPTION 'approve_community_book_request missing auth, ownership, book checks, FOR UPDATE, queue ordering, inventory math, or notifications.';
  END IF;

  -- Queue ordering: earlier pending request check
  IF pg_catalog.strpos(v_definition, 'earlier.request_date') = 0
     OR pg_catalog.strpos(v_definition, 'earlier.id') = 0 THEN
    RAISE EXCEPTION 'approve_community_book_request missing FIFO queue ordering check.';
  END IF;

  -- Grants: authenticated only
  IF NOT pg_catalog.has_function_privilege('authenticated', v_signature, 'EXECUTE')
     OR pg_catalog.has_function_privilege('anon', v_signature, 'EXECUTE')
     OR pg_catalog.has_function_privilege('service_role', v_signature, 'EXECUTE') THEN
    RAISE EXCEPTION 'approve_community_book_request grants differ from authenticated-only contract.';
  END IF;

  SELECT pg_catalog.count(*) INTO v_acl_count
  FROM pg_catalog.pg_proc AS p
  CROSS JOIN LATERAL pg_catalog.aclexplode(p.proacl) AS acl
  WHERE p.oid = v_oid;

  IF v_acl_count <> 1 THEN
    RAISE EXCEPTION 'approve_community_book_request ACL entry count mismatch (expected 1).';
  END IF;

  -- ============================================================
  // 3. cancel_community_book_request(uuid, text, text)
  // ============================================================
  v_signature := 'public.cancel_community_book_request(uuid,text,text)'::regprocedure;
  v_oid := pg_catalog.to_regprocedure(v_signature)::oid;
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'Missing function: public.cancel_community_book_request(uuid,text,text)';
  END IF;

  SELECT p.proowner, l.lanname, p.provolatile, p.prosecdef, p.proconfig
    INTO v_owner, v_language, v_volatility, v_secdef, v_config
  FROM pg_catalog.pg_proc AS p
  JOIN pg_catalog.pg_language AS l ON l.oid = p.prolang
  WHERE p.oid = v_oid;

  IF v_owner <> 'postgres'
     OR v_language <> 'plpgsql'
     OR v_volatility IS DISTINCT FROM 'v'
     OR NOT v_secdef
     OR v_config IS DISTINCT FROM ARRAY['search_path=""']::text[] THEN
    RAISE EXCEPTION 'cancel_community_book_request metadata differs from contract.';
  END IF;

  v_definition := pg_catalog.pg_get_functiondef(v_oid);
  IF pg_catalog.strpos(v_definition, 'otp_verified') = 0
     OR pg_catalog.strpos(v_definition, 'is_active') = 0
     OR pg_catalog.strpos(v_definition, 'auth.uid()') = 0
     OR pg_catalog.strpos(v_definition, 'requester_visitor_id') = 0
     OR pg_catalog.strpos(v_definition, 'owner_visitor_id') = 0
     OR pg_catalog.strpos(v_definition, 'FOR UPDATE') = 0
     OR pg_catalog.strpos(v_definition, 'promote_next_community_request') = 0
     OR pg_catalog.strpos(v_definition, 'community_cancelled') = 0
     OR pg_catalog.strpos(v_definition, 'community_request_rejected') = 0
     OR pg_catalog.strpos(v_definition, 'status IN') = 0 THEN
    RAISE EXCEPTION 'cancel_community_book_request missing auth, authorization, FOR UPDATE, promotion, notifications, or status handling.';
  END IF;

  -- Grants: authenticated + service_role
  IF NOT pg_catalog.has_function_privilege('authenticated', v_signature, 'EXECUTE')
     OR NOT pg_catalog.has_function_privilege('service_role', v_signature, 'EXECUTE')
     OR pg_catalog.has_function_privilege('anon', v_signature, 'EXECUTE') THEN
    RAISE EXCEPTION 'cancel_community_book_request grants differ from authenticated+service_role contract.';
  END IF;

  SELECT pg_catalog.count(*) INTO v_acl_count
  FROM pg_catalog.pg_proc AS p
  CROSS JOIN LATERAL pg_catalog.aclexplode(p.proacl) AS acl
  WHERE p.oid = v_oid;

  IF v_acl_count <> 2 THEN
    RAISE EXCEPTION 'cancel_community_book_request ACL entry count mismatch (expected 2).';
  END IF;

  -- ============================================================
  // 4. update_community_book_copy_availability trigger function
  // ============================================================
  v_signature := 'public.update_community_book_copy_availability()'::regprocedure;
  v_oid := pg_catalog.to_regprocedure(v_signature)::oid;
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'Missing trigger function: public.update_community_book_copy_availability()';
  END IF;

  SELECT p.proowner, l.lanname, p.provolatile, p.prosecdef, p.proconfig
    INTO v_owner, v_language, v_volatility, v_secdef, v_config
  FROM pg_catalog.pg_proc AS p
  JOIN pg_catalog.pg_language AS l ON l.oid = p.prolang
  WHERE p.oid = v_oid;

  IF v_owner <> 'postgres'
     OR v_language <> 'plpgsql'
     OR v_volatility IS DISTINCT FROM 'v'
     OR NOT v_secdef
     OR v_config IS DISTINCT FROM ARRAY['search_path=public']::text[] THEN
    RAISE EXCEPTION 'update_community_book_copy_availability metadata differs from contract.';
  END IF;

  v_definition := pg_catalog.pg_get_functiondef(v_oid);
  IF pg_catalog.strpos(v_definition, 'tg_op') = 0
     OR pg_catalog.strpos(v_definition, 'INSERT') = 0
     OR pg_catalog.strpos(v_definition, 'UPDATE') = 0
     OR pg_catalog.strpos(v_definition, 'DELETE') = 0
     OR pg_catalog.strpos(v_definition, 'community_promotion') = 0
     OR pg_catalog.strpos(v_definition, 'pg_notify') = 0
     OR pg_catalog.strpos(v_definition, 'available_copies') = 0
     OR pg_catalog.strpos(v_definition, 'total_copies') = 0
     OR pg_catalog.strpos(v_definition, 'book_type = ''personal''') = 0 THEN
    RAISE EXCEPTION 'Trigger function missing tg_op handling, pg_notify, inventory math, or personal book filter.';
  END IF;

  -- Grants: postgres + service_role only
  IF NOT pg_catalog.has_function_privilege('postgres', v_signature, 'EXECUTE')
     OR NOT pg_catalog.has_function_privilege('service_role', v_signature, 'EXECUTE')
     OR pg_catalog.has_function_privilege('anon', v_signature, 'EXECUTE')
     OR pg_catalog.has_function_privilege('authenticated', v_signature, 'EXECUTE') THEN
    RAISE EXCEPTION 'Trigger function grants differ from postgres+service_role contract.';
  END IF;

  // Trigger attachment
  SELECT pg_catalog.count(*)::integer
    INTO v_trigger_count
  FROM pg_catalog.pg_trigger AS t
  JOIN pg_catalog.pg_class AS c ON c.oid = t.tgrelid
  JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relname = 'community_book_requests'
    AND t.tgname = 'community_book_copy_availability'
    AND t.tgfoid = v_oid
    AND t.tgenabled = 'O';

  IF v_trigger_count <> 1 THEN
    RAISE EXCEPTION 'community_book_copy_availability trigger missing or not attached to community_book_requests.';
  END IF;

  // ============================================================
  // 5. require_available_community_book_copy trigger function
  // ============================================================
  v_signature := 'public.require_available_community_book_copy()'::regprocedure;
  v_oid := pg_catalog.to_regprocedure(v_signature)::oid;
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'Missing trigger function: public.require_available_community_book_copy()';
  END IF;

  // Grants: postgres + service_role only
  IF NOT pg_catalog.has_function_privilege('postgres', v_signature, 'EXECUTE')
     OR NOT pg_catalog.has_function_privilege('service_role', v_signature, 'EXECUTE')
     OR pg_catalog.has_function_privilege('anon', v_signature, 'EXECUTE')
     OR pg_catalog.has_function_privilege('authenticated', v_signature, 'EXECUTE') THEN
    RAISE EXCEPTION 'require_available_community_book_copy grants differ from postgres+service_role contract.';
  END IF;

  // ============================================================
  // 6. enforce_book_copy_inventory trigger function
  // ============================================================
  v_signature := 'public.enforce_book_copy_inventory()'::regprocedure;
  v_oid := pg_catalog.to_regprocedure(v_signature)::oid;
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'Missing trigger function: public.enforce_book_copy_inventory()';
  END IF;

  SELECT p.proowner, l.lanname, p.provolatile, p.prosecdef, p.proconfig
    INTO v_owner, v_language, v_volatility, v_secdef, v_config
  FROM pg_catalog.pg_proc AS p
  JOIN pg_catalog.pg_language AS l ON l.oid = p.prolang
  WHERE p.oid = v_oid;

  IF v_owner <> 'postgres'
     OR v_language <> 'plpgsql'
     OR v_volatility IS DISTINCT FROM 'v'
     OR NOT v_secdef
     OR v_config IS DISTINCT FROM ARRAY['search_path=public']::text[] THEN
    RAISE EXCEPTION 'enforce_book_copy_inventory metadata differs from contract.';
  END IF;

  v_definition := pg_catalog.pg_get_functiondef(v_oid);
  IF pg_catalog.strpos(v_definition, 'book_type = ''library''') = 0
     OR pg_catalog.strpos(v_definition, 'book_type = ''personal''') = 0
     OR pg_catalog.strpos(v_definition, 'INVENTORY_CONFLICT') = 0
     OR pg_catalog.strpos(v_definition, 'library_allocations') = 0
     OR pg_catalog.strpos(v_definition, 'community_allocations') = 0
     OR pg_catalog.strpos(v_definition, 'available_copies') = 0
     OR pg_catalog.strpos(v_definition, 'total_copies') = 0 THEN
    RAISE EXCEPTION 'enforce_book_copy_inventory missing library/personal separation, conflict codes, or allocation counts.';
  END IF;

  // Grants: postgres + service_role only
  IF NOT pg_catalog.has_function_privilege('postgres', v_signature, 'EXECUTE')
     OR NOT pg_catalog.has_function_privilege('service_role', v_signature, 'EXECUTE')
     OR pg_catalog.has_function_privilege('anon', v_signature, 'EXECUTE')
     OR pg_catalog.has_function_privilege('authenticated', v_signature, 'EXECUTE') THEN
    RAISE EXCEPTION 'enforce_book_copy_inventory grants differ from postgres+service_role contract.';
  END IF;

  // ============================================================
  // 7. auto_expire_community_requests cron function
  // ============================================================
  v_signature := 'public.auto_expire_community_requests()'::regprocedure;
  v_oid := pg_catalog.to_regprocedure(v_signature)::oid;
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'Missing function: public.auto_expire_community_requests()';
  END IF;

  SELECT p.proowner, l.lanname, p.provolatile, p.prosecdef, p.proconfig
    INTO v_owner, v_language, v_volatility, v_secdef, v_config
  FROM pg_catalog.pg_proc AS p
  JOIN pg_catalog.pg_language AS l ON l.oid = p.prolang
  WHERE p.oid = v_oid;

  IF v_owner <> 'postgres'
     OR v_language <> 'plpgsql'
     OR v_volatility IS DISTINCT FROM 'v'
     OR NOT v_secdef
     OR v_config IS DISTINCT FROM ARRAY['search_path=""']::text[] THEN
    RAISE EXCEPTION 'auto_expire_community_requests metadata differs from contract.';
  END IF;

  v_definition := pg_catalog.pg_get_functiondef(v_oid);
  IF pg_catalog.strpos(v_definition, '7 days') = 0
     OR pg_catalog.strpos(v_definition, 'community_cancelled') = 0
     OR pg_catalog.strpos(v_definition, 'create_visitor_notification') = 0
     OR pg_catalog.strpos(v_definition, 'request_date') = 0
     OR pg_catalog.strpos(v_definition, 'status = ''pending''') = 0 THEN
    RAISE EXCEPTION 'auto_expire_community_requests missing 7-day expiry, notifications, or pending status filter.';
  END IF;

  // Grants: service_role only
  IF NOT pg_catalog.has_function_privilege('service_role', v_signature, 'EXECUTE')
     OR pg_catalog.has_function_privilege('anon', v_signature, 'EXECUTE')
     OR pg_catalog.has_function_privilege('authenticated', v_signature, 'EXECUTE')
     OR pg_catalog.has_function_privilege('postgres', v_signature, 'EXECUTE') THEN
    RAISE EXCEPTION 'auto_expire_community_requests grants differ from service_role-only contract.';
  END IF;

  SELECT pg_catalog.count(*) INTO v_acl_count
  FROM pg_catalog.pg_proc AS p
  CROSS JOIN LATERAL pg_catalog.aclexplode(p.proacl) AS acl
  WHERE p.oid = v_oid;

  IF v_acl_count <> 1 THEN
    RAISE EXCEPTION 'auto_expire_community_requests ACL entry count mismatch (expected 1).';
  END IF;

  // ============================================================
  // 8. pg_notify channel for community promotion
  // ============================================================
  v_definition := pg_catalog.pg_get_functiondef('public.update_community_book_copy_availability()'::regprocedure);
  IF pg_catalog.strpos(v_definition, 'community_promotion') = 0
     OR pg_catalog.strpos(v_definition, 'book_id') = 0 THEN
    RAISE EXCEPTION 'pg_notify channel or payload missing from trigger function.';
  END IF;

  // ============================================================
  // 9. Response type contracts
  // ============================================================
  v_definition := pg_catalog.pg_get_function_result('public.approve_community_book_request(uuid,text,text)'::regprocedure);
  IF v_definition NOT LIKE 'TABLE(id uuid, book_id text, book_title text, requester_visitor_id text, requester_name text, status text, approved_at timestamptz, owner_response text)' THEN
    RAISE EXCEPTION 'approve_community_book_request response contract changed: %', v_definition;
  END IF;

  // ============================================================
  // 10. Inventory math: available_copies never exceeds total_copies
  // ============================================================
  // Verify the constraint logic exists in trigger functions
  IF pg_catalog.strpos(
       pg_catalog.pg_get_functiondef('public.enforce_book_copy_inventory()'::regprocedure),
       'available_copies > total_copies') = 0
     OR pg_catalog.strpos(
       pg_catalog.pg_get_functiondef('public.update_community_book_copy_availability()'::regprocedure),
       'available_copies > 0') = 0 THEN
    RAISE EXCEPTION 'Inventory bounds checks missing from trigger functions.';
  END IF;

END;
$tests$;