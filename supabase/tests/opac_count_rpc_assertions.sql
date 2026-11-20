CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
BEGIN;
SELECT extensions.plan(1);

-- Read-only catalog assertions for OPAC book count RPCs.
-- Covers migrations: 20270102002800_opac_book_count_rpc.sql,
--                  20270102002900_opac_book_count_rpc_fixed.sql,
--                  20270103000400_opac_category_book_counts.sql
SELECT extensions.lives_ok($tap$DO $tests$
DECLARE
  v_signature regprocedure;
  v_oid oid;
  v_definition text;
  v_acl_count integer;
  v_result text;
  v_owner text;
  v_language text;
  v_volatility "char";
  v_secdef boolean;
  v_config text[];
BEGIN
  -- ============================================================
  -- 1. General OPAC counts: SECURITY INVOKER, grants to anon + authenticated
  -- ============================================================
  FOREACH v_signature IN ARRAY ARRAY[
    'public.get_opac_library_book_count()',
    'public.get_opac_total_book_count()',
    'public.get_opac_filtered_book_count(text,text,uuid,text)'
  ] LOOP
    v_oid := v_signature::oid;
    IF v_oid IS NULL THEN
      RAISE EXCEPTION 'Missing function: %', v_signature;
    END IF;

    SELECT pg_catalog.pg_get_userbyid(p.proowner), l.lanname, p.provolatile,
           p.prosecdef, p.proconfig, p.prorettype
      INTO v_owner, v_language, v_volatility, v_secdef, v_config, v_result
    FROM pg_catalog.pg_proc AS p
    JOIN pg_catalog.pg_language AS l ON l.oid = p.prolang
    WHERE p.oid = v_oid;

    IF v_secdef THEN
      RAISE EXCEPTION 'Function % must be SECURITY INVOKER (not DEFINER).', v_signature;
    END IF;

    IF v_owner <> 'postgres'
       OR (v_signature = 'public.get_opac_filtered_book_count(text,text,uuid,text)'::regprocedure
           AND v_language <> 'plpgsql')
       OR (v_signature <> 'public.get_opac_filtered_book_count(text,text,uuid,text)'::regprocedure
           AND v_language <> 'sql')
       OR v_volatility IS DISTINCT FROM 'v'
       OR v_config IS DISTINCT FROM ARRAY['search_path=public']::text[] THEN
      RAISE EXCEPTION 'Function % metadata differs from contract (owner/lang/volatility/config).', v_signature;
    END IF;

    -- Grants: anon + authenticated only
    SELECT pg_catalog.count(*) INTO v_acl_count
    FROM pg_catalog.pg_proc AS p
    CROSS JOIN LATERAL pg_catalog.aclexplode(p.proacl) AS acl
    WHERE p.oid = v_oid;

    IF NOT pg_catalog.has_function_privilege('anon', v_oid, 'EXECUTE')
       OR NOT pg_catalog.has_function_privilege('authenticated', v_oid, 'EXECUTE')
       OR pg_catalog.has_function_privilege('service_role', v_oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'Function % grants differ from anon+authenticated contract.', v_signature;
    END IF;
  END LOOP;

  -- ============================================================
  -- 2. Branch-scoped count: authenticated only, authorization check
  -- ============================================================
  v_signature := 'public.get_opac_library_book_count_by_library(uuid)'::regprocedure;
  v_oid := v_signature::oid;
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'Missing function: public.get_opac_library_book_count_by_library(uuid)';
  END IF;

  SELECT pg_catalog.pg_get_userbyid(p.proowner), l.lanname, p.provolatile,
         p.prosecdef, p.proconfig
    INTO v_owner, v_language, v_volatility, v_secdef, v_config
  FROM pg_catalog.pg_proc AS p
  JOIN pg_catalog.pg_language AS l ON l.oid = p.prolang
  WHERE p.oid = v_oid;

  IF v_secdef THEN
    RAISE EXCEPTION 'Branch-scoped function must be SECURITY INVOKER.';
  END IF;

  IF v_owner <> 'postgres'
     OR v_language <> 'plpgsql'
     OR v_volatility IS DISTINCT FROM 'v'
     OR v_config IS DISTINCT FROM ARRAY['search_path=public']::text[] THEN
    RAISE EXCEPTION 'Branch-scoped function metadata differs from contract.';
  END IF;

  v_definition := pg_catalog.pg_get_functiondef(v_oid);
  IF pg_catalog.strpos(v_definition, 'opac_has_library_access') = 0
     OR pg_catalog.strpos(v_definition, '42501') = 0
     OR pg_catalog.strpos(v_definition, 'Insufficient privileges') = 0 THEN
    RAISE EXCEPTION 'Branch-scoped function missing authorization check.';
  END IF;

  -- Grants: authenticated only (no anon)
  IF NOT pg_catalog.has_function_privilege('authenticated', v_oid, 'EXECUTE')
     OR pg_catalog.has_function_privilege('anon', v_oid, 'EXECUTE')
     OR pg_catalog.has_function_privilege('service_role', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'Branch-scoped function grants differ from authenticated-only contract.';
  END IF;

  -- ============================================================
  -- 3. Helper function: opac_has_library_access
  -- ============================================================
  v_signature := 'public.opac_has_library_access(uuid)'::regprocedure;
  v_oid := v_signature::oid;
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'Missing helper: public.opac_has_library_access(uuid)';
  END IF;

  IF NOT pg_catalog.has_function_privilege('authenticated', v_oid, 'EXECUTE')
     OR pg_catalog.has_function_privilege('anon', v_oid, 'EXECUTE')
     OR pg_catalog.has_function_privilege('service_role', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'Helper function grants differ from authenticated-only contract.';
  END IF;

  v_definition := pg_catalog.pg_get_functiondef(v_oid);
  IF pg_catalog.strpos(v_definition, 'is_active_staff_for_branch') = 0
     OR pg_catalog.strpos(v_definition, 'auth.uid()') = 0 THEN
    RAISE EXCEPTION 'Helper missing staff branch access check.';
  END IF;

  -- ============================================================
  -- 4. Category counts: SECURITY DEFINER, empty search_path, grants to anon + authenticated
  -- ============================================================
  v_signature := 'public.get_opac_category_book_counts(text)'::regprocedure;
  v_oid := v_signature::oid;
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'Missing function: public.get_opac_category_book_counts(uuid)';
  END IF;

  SELECT pg_catalog.pg_get_userbyid(p.proowner), l.lanname, p.provolatile,
         p.prosecdef, p.proconfig
    INTO v_owner, v_language, v_volatility, v_secdef, v_config
  FROM pg_catalog.pg_proc AS p
  JOIN pg_catalog.pg_language AS l ON l.oid = p.prolang
  WHERE p.oid = v_oid;

  IF NOT v_secdef THEN
    RAISE EXCEPTION 'Category counts must be SECURITY DEFINER.';
  END IF;

  IF v_owner <> 'postgres'
     OR v_language <> 'plpgsql'
     OR v_volatility IS DISTINCT FROM 'v'
     OR v_config IS DISTINCT FROM ARRAY['search_path=""']::text[] THEN
    RAISE EXCEPTION 'Category counts metadata differs from contract.';
  END IF;

  v_definition := pg_catalog.pg_get_functiondef(v_oid);
  IF pg_catalog.strpos(v_definition, 'book_type = ''library''') = 0
     OR pg_catalog.strpos(v_definition, 'COALESCE') = 0
     OR pg_catalog.strpos(v_definition, 'Uncategorized') = 0 THEN
    RAISE EXCEPTION 'Category counts logic missing expected filters or fallback.';
  END IF;

  -- Grants: anon + authenticated only
  IF NOT pg_catalog.has_function_privilege('anon', v_oid, 'EXECUTE')
     OR NOT pg_catalog.has_function_privilege('authenticated', v_oid, 'EXECUTE')
     OR NOT pg_catalog.has_function_privilege('service_role', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'Category counts grants differ from anon/authenticated/service-role contract.';
  END IF;

  -- ============================================================
  -- 5. Response type contracts
  -- ============================================================
  v_result := pg_catalog.pg_get_function_result('public.get_opac_library_book_count()'::regprocedure);
  IF v_result <> 'bigint' THEN
    RAISE EXCEPTION 'get_opac_library_book_count return type changed: %', v_result;
  END IF;

  v_result := pg_catalog.pg_get_function_result('public.get_opac_total_book_count()'::regprocedure);
  IF v_result <> 'bigint' THEN
    RAISE EXCEPTION 'get_opac_total_book_count return type changed: %', v_result;
  END IF;

  v_result := pg_catalog.pg_get_function_result('public.get_opac_library_book_count_by_library(uuid)'::regprocedure);
  IF v_result <> 'bigint' THEN
    RAISE EXCEPTION 'get_opac_library_book_count_by_library return type changed: %', v_result;
  END IF;

  v_result := pg_catalog.pg_get_function_result('public.get_opac_filtered_book_count(text,text,uuid,text)'::regprocedure);
  IF v_result <> 'bigint' THEN
    RAISE EXCEPTION 'get_opac_filtered_book_count return type changed: %', v_result;
  END IF;

  v_result := pg_catalog.pg_get_function_result('public.get_opac_category_book_counts(text)'::regprocedure);
  IF v_result <> 'TABLE(category text, book_count bigint)' THEN
    RAISE EXCEPTION 'get_opac_category_book_counts return type changed: %', v_result;
  END IF;

  -- ============================================================
  -- 6. SECURITY DEFINER functions must pin an approved, explicit search path.
  -- ============================================================
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS p
    JOIN pg_catalog.pg_namespace AS n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public'
      AND p.prosecdef
      AND p.proconfig IS NOT NULL
      AND (pg_catalog.cardinality(p.proconfig) <> 1
        OR p.proconfig[1] NOT IN (
          'search_path=""',
          'search_path=public',
          'search_path=public, pg_temp',
          'search_path=public, auth',
          'search_path=pg_catalog, public, pg_temp',
          'search_path=pg_catalog, public, auth, pg_temp'
        ))
  ) THEN
    RAISE EXCEPTION 'SECURITY DEFINER function has non-empty search_path.';
  END IF;
END;
$tests$;$tap$, 'opac count rpc assertions contract block 1');

SELECT * FROM extensions.finish();
ROLLBACK;
