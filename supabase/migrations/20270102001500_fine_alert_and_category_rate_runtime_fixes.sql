-- Restore the category rate lookup used by community pickup and make the
-- internal fine-alert notification joins type-safe for legacy text IDs.
-- Existing ledger rows and function ACLs are preserved.
BEGIN;

DO $preflight$
DECLARE
  v_helper oid := pg_catalog.to_regprocedure('public.get_category_fine_rate(text)');
  v_helper_count integer;
  v_alert oid := pg_catalog.to_regprocedure(
    'public.get_fine_payment_alert_targets_detail_internal(text)'
  );
  v_definition text;
  v_matches integer;
BEGIN
  SELECT pg_catalog.count(*) INTO v_helper_count
  FROM pg_catalog.pg_proc AS p
  JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'get_category_fine_rate';

  IF v_helper_count > 1 OR (v_helper_count = 1 AND v_helper IS NULL) THEN
    RAISE EXCEPTION 'Unexpected overload exists for public.get_category_fine_rate.';
  END IF;

  IF v_helper IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS p
    JOIN pg_catalog.pg_language AS l ON l.oid = p.prolang
    WHERE p.oid = v_helper
      AND p.pronargs = 1
      AND p.proargtypes[0] = 'text'::regtype
      AND p.prorettype = 'integer'::regtype
      AND p.proowner = 'postgres'::regrole
      AND l.lanname = 'sql'
      AND p.provolatile = 'i'
      AND NOT p.prosecdef
      AND p.prosrc LIKE '%''general'' THEN 10%'
      AND p.prosrc LIKE '%''fiction'' THEN 15%'
      AND p.prosrc LIKE '%''business'' THEN 20%'
      AND p.prosrc LIKE '%''software engineering'' THEN 20%'
  ) THEN
    RAISE EXCEPTION 'Existing public.get_category_fine_rate(text) differs from the reviewed category-rate mapping.';
  END IF;

  IF v_alert IS NULL OR NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS p
    JOIN pg_catalog.pg_language AS l ON l.oid = p.prolang
    WHERE p.oid = v_alert
      AND p.proowner = 'postgres'::regrole
      AND l.lanname = 'plpgsql'
      AND p.prorettype = 'record'::regtype
      AND p.prosecdef
      AND p.proconfig = ARRAY['search_path=public, pg_temp']::text[]
  ) THEN
    RAISE EXCEPTION 'Expected internal fine-alert function or its security metadata is missing.';
  END IF;

  v_definition := pg_catalog.pg_get_functiondef(v_alert);
  SELECT pg_catalog.count(*) INTO v_matches
  FROM pg_catalog.regexp_matches(
    v_definition,
    'notification\.borrow_request_id\s*=\s*br\.id([[:space:]]|$)',
    'g'
  );
  IF v_matches <> 1 THEN
    RAISE EXCEPTION 'Fine-alert borrow-request comparison is missing or ambiguous.';
  END IF;

  SELECT pg_catalog.count(*) INTO v_matches
  FROM pg_catalog.regexp_matches(
    v_definition,
    'notification\.visitor_id\s*=\s*br\.visitor_id::text([[:space:]]|$)',
    'g'
  );
  IF v_matches <> 1 THEN
    RAISE EXCEPTION 'Fine-alert visitor comparison is missing or ambiguous.';
  END IF;
END;
$preflight$;

DO $create_category_rate$
BEGIN
  EXECUTE $create$
    CREATE OR REPLACE FUNCTION public.get_category_fine_rate(p_category text)
    RETURNS integer
    LANGUAGE sql
    IMMUTABLE
    PARALLEL SAFE
    SECURITY INVOKER
    SET search_path = pg_catalog
    AS $body$
      SELECT CASE pg_catalog.lower(pg_catalog.btrim(p_category))
        WHEN 'general' THEN 10
        WHEN 'reference' THEN 10
        WHEN 'self-help' THEN 10
        WHEN 'philosophy' THEN 10
        WHEN 'psychology' THEN 10
        WHEN 'science' THEN 10
        WHEN 'fiction' THEN 15
        WHEN 'filipino literature' THEN 15
        WHEN 'literature' THEN 15
        WHEN 'poetry' THEN 15
        WHEN 'young adult' THEN 15
        WHEN 'business' THEN 20
        WHEN 'computer science' THEN 20
        WHEN 'education' THEN 20
        WHEN 'engineering' THEN 20
        WHEN 'history' THEN 20
        WHEN 'information technology' THEN 20
        WHEN 'mathematics' THEN 20
        WHEN 'nursing & health' THEN 20
        WHEN 'physics' THEN 20
        WHEN 'software engineering' THEN 20
        ELSE NULL
      END
    $body$;
  $create$;

  IF pg_catalog.to_regprocedure('public.get_category_fine_rate(text)') IS NULL THEN
    RAISE EXCEPTION 'Could not create public.get_category_fine_rate(text).';
  END IF;
  ALTER FUNCTION public.get_category_fine_rate(text) OWNER TO postgres;
  REVOKE ALL ON FUNCTION public.get_category_fine_rate(text)
    FROM PUBLIC, anon, authenticated, service_role;
END;
$create_category_rate$;

DO $patch_alert$
DECLARE
  v_alert regprocedure :=
    'public.get_fine_payment_alert_targets_detail_internal(text)'::regprocedure;
  v_definition text := pg_catalog.pg_get_functiondef(
    'public.get_fine_payment_alert_targets_detail_internal(text)'::regprocedure
  );
  v_updated text;
BEGIN
  v_updated := pg_catalog.replace(
    v_definition,
    'notification.borrow_request_id = br.id',
    'notification.borrow_request_id::text = br.id::text'
  );
  v_updated := pg_catalog.replace(
    v_updated,
    'notification.visitor_id = br.visitor_id::text',
    'notification.visitor_id::text = br.visitor_id::text'
  );

  IF v_updated = v_definition
     OR pg_catalog.strpos(v_updated, 'notification.borrow_request_id::text = br.id::text') = 0
     OR pg_catalog.strpos(v_updated, 'notification.visitor_id::text = br.visitor_id::text') = 0 THEN
    RAISE EXCEPTION 'Could not apply the reviewed fine-alert UUID/text comparison fixes.';
  END IF;

  EXECUTE v_updated;
  IF pg_catalog.to_regprocedure('public.get_fine_payment_alert_targets_detail_internal(text)')
       IS DISTINCT FROM v_alert THEN
    RAISE EXCEPTION 'Fine-alert internal function identity changed unexpectedly.';
  END IF;
END;
$patch_alert$;

DO $postflight$
DECLARE
  v_helper regprocedure := 'public.get_category_fine_rate(text)'::regprocedure;
  v_alert regprocedure :=
    'public.get_fine_payment_alert_targets_detail_internal(text)'::regprocedure;
  v_acl_count integer;
  v_definition text := pg_catalog.pg_get_functiondef(
    'public.get_fine_payment_alert_targets_detail_internal(text)'::regprocedure
  );
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc AS p
    JOIN pg_catalog.pg_language AS l ON l.oid = p.prolang
    WHERE p.oid = v_helper
      AND p.proowner = 'postgres'::regrole
      AND l.lanname = 'sql'
      AND p.provolatile = 'i'
      AND NOT p.prosecdef
      AND p.proconfig = ARRAY['search_path=pg_catalog']::text[]
      AND p.prosrc LIKE '%WHEN ''general'' THEN 10%'
      AND p.prosrc LIKE '%WHEN ''software engineering'' THEN 20%'
      AND p.prosrc LIKE '%ELSE NULL%'
  ) OR pg_catalog.has_function_privilege('anon', v_helper, 'EXECUTE')
    OR pg_catalog.has_function_privilege('authenticated', v_helper, 'EXECUTE')
    OR pg_catalog.has_function_privilege('service_role', v_helper, 'EXECUTE') THEN
    RAISE EXCEPTION 'Category-rate helper metadata, body, or effective EXECUTE grants are unsafe.';
  END IF;

  SELECT pg_catalog.count(*) INTO v_acl_count
  FROM pg_catalog.pg_proc AS p
  CROSS JOIN LATERAL pg_catalog.aclexplode(p.proacl) AS acl
  WHERE p.oid = v_helper;
  IF v_acl_count <> 1 OR NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS p
    CROSS JOIN LATERAL pg_catalog.aclexplode(p.proacl) AS acl
    WHERE p.oid = v_helper
      AND acl.grantee = 'postgres'::regrole::oid
      AND acl.grantor = 'postgres'::regrole::oid
      AND acl.privilege_type = 'EXECUTE'
      AND NOT acl.is_grantable
  ) THEN
    RAISE EXCEPTION 'Category-rate helper has unexpected direct ACL entries.';
  END IF;

  IF pg_catalog.strpos(v_definition, 'notification.borrow_request_id::text = br.id::text') = 0
     OR pg_catalog.strpos(v_definition, 'notification.visitor_id::text = br.visitor_id::text') = 0
     OR pg_catalog.strpos(v_definition, 'notification.borrow_request_id = br.id') > 0
     OR pg_catalog.strpos(v_definition, 'notification.visitor_id = br.visitor_id::text') > 0
     OR pg_catalog.has_function_privilege('anon', v_alert, 'EXECUTE')
     OR pg_catalog.has_function_privilege('authenticated', v_alert, 'EXECUTE')
     OR pg_catalog.has_function_privilege('service_role', v_alert, 'EXECUTE') THEN
    RAISE EXCEPTION 'Fine-alert implementation or effective internal EXECUTE grants are unsafe.';
  END IF;
END;
$postflight$;

NOTIFY pgrst, 'reload schema';
COMMIT;
