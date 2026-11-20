-- Read-only catalog assertions for 20270102001500.
DO $test$
DECLARE
  v_rate regprocedure;
  v_alert regprocedure;
  v_definition text;
  v_acl_count integer;
BEGIN
  v_rate := pg_catalog.to_regprocedure('public.get_category_fine_rate(text)');
  IF v_rate IS NULL OR NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS p
    JOIN pg_catalog.pg_language AS l ON l.oid = p.prolang
    WHERE p.oid = v_rate
      AND p.proowner = 'postgres'::regrole
      AND p.prorettype = 'integer'::regtype
      AND p.pronargs = 1
      AND p.proargtypes[0] = 'text'::regtype
      AND l.lanname = 'sql'
      AND p.provolatile = 'i'
      AND NOT p.prosecdef
      AND p.proconfig = ARRAY['search_path=pg_catalog']::text[]
  ) THEN
    RAISE EXCEPTION 'Category-rate helper metadata assertion failed.';
  END IF;

  IF public.get_category_fine_rate(' General ') <> 10
     OR public.get_category_fine_rate('Fiction') <> 15
     OR public.get_category_fine_rate('Computer Science') <> 20
     OR public.get_category_fine_rate('unsupported') IS NOT NULL
     OR public.get_category_fine_rate(NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'Category-rate behavior differs from the frontend category map.';
  END IF;

  IF pg_catalog.has_function_privilege('anon', v_rate, 'EXECUTE')
     OR pg_catalog.has_function_privilege('authenticated', v_rate, 'EXECUTE')
     OR pg_catalog.has_function_privilege('service_role', v_rate, 'EXECUTE') THEN
    RAISE EXCEPTION 'Category-rate helper is directly executable by an API role.';
  END IF;
  SELECT pg_catalog.count(*) INTO v_acl_count
  FROM pg_catalog.pg_proc AS p
  CROSS JOIN LATERAL pg_catalog.aclexplode(p.proacl) AS acl
  WHERE p.oid = v_rate
    AND acl.grantee = 'postgres'::regrole::oid
    AND acl.grantor = 'postgres'::regrole::oid
    AND acl.privilege_type = 'EXECUTE'
    AND NOT acl.is_grantable;
  IF v_acl_count <> 1 THEN
    RAISE EXCEPTION 'Category-rate helper owner ACL assertion failed.';
  END IF;

  v_alert := pg_catalog.to_regprocedure(
    'public.get_fine_payment_alert_targets_detail_internal(text)'
  );
  IF v_alert IS NULL THEN
    RAISE EXCEPTION 'Internal alert-target function is missing.';
  END IF;
  v_definition := pg_catalog.pg_get_functiondef(v_alert);
  IF pg_catalog.position('notification.borrow_request_id::text = br.id::text' IN v_definition) = 0
     OR pg_catalog.position('notification.visitor_id::text = br.visitor_id::text' IN v_definition) = 0
     OR pg_catalog.has_function_privilege('anon', v_alert, 'EXECUTE')
     OR pg_catalog.has_function_privilege('authenticated', v_alert, 'EXECUTE')
     OR pg_catalog.has_function_privilege('service_role', v_alert, 'EXECUTE') THEN
    RAISE EXCEPTION 'Fine-alert cast or authorization assertion failed.';
  END IF;
END;
$test$;
