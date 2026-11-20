-- Keep the aggregate cache private to its SECURITY DEFINER maintenance and
-- public-count RPC paths. API roles receive neither direct table grants nor
-- row policies; the owning postgres SECURITY DEFINER routines retain access.
BEGIN;

ALTER TABLE public.borrowed_book_counts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.borrowed_book_counts
  FROM PUBLIC, anon, authenticated, service_role;

DO $postflight$
DECLARE
  v_getter oid := pg_catalog.to_regprocedure('public.get_popular_borrowed_book_counts(integer)');
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_class AS table_row
    WHERE table_row.oid = 'public.borrowed_book_counts'::pg_catalog.regclass
      AND table_row.relrowsecurity IS TRUE
  ) THEN
    RAISE EXCEPTION 'borrowed_book_counts must enforce RLS.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_policy AS policy_row
    WHERE policy_row.polrelid = 'public.borrowed_book_counts'::pg_catalog.regclass
  ) THEN
    RAISE EXCEPTION 'borrowed_book_counts must not expose rows through API-role policies.';
  END IF;

  IF pg_catalog.has_table_privilege('anon', 'public.borrowed_book_counts', 'SELECT')
     OR pg_catalog.has_table_privilege('anon', 'public.borrowed_book_counts', 'INSERT')
     OR pg_catalog.has_table_privilege('anon', 'public.borrowed_book_counts', 'UPDATE')
     OR pg_catalog.has_table_privilege('anon', 'public.borrowed_book_counts', 'DELETE')
     OR pg_catalog.has_table_privilege('authenticated', 'public.borrowed_book_counts', 'SELECT')
     OR pg_catalog.has_table_privilege('authenticated', 'public.borrowed_book_counts', 'INSERT')
     OR pg_catalog.has_table_privilege('authenticated', 'public.borrowed_book_counts', 'UPDATE')
     OR pg_catalog.has_table_privilege('authenticated', 'public.borrowed_book_counts', 'DELETE')
     OR pg_catalog.has_table_privilege('service_role', 'public.borrowed_book_counts', 'SELECT')
     OR pg_catalog.has_table_privilege('service_role', 'public.borrowed_book_counts', 'INSERT')
     OR pg_catalog.has_table_privilege('service_role', 'public.borrowed_book_counts', 'UPDATE')
     OR pg_catalog.has_table_privilege('service_role', 'public.borrowed_book_counts', 'DELETE') THEN
    RAISE EXCEPTION 'borrowed_book_counts must remain inaccessible directly to API roles.';
  END IF;

  IF v_getter IS NULL OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc AS function_row
    WHERE function_row.oid = v_getter
      AND function_row.prosecdef IS TRUE
      AND function_row.proowner = 'postgres'::pg_catalog.regrole
      AND function_row.proconfig = ARRAY['search_path=public, pg_temp']::text[]
  ) THEN
    RAISE EXCEPTION 'The public aggregate-count getter must retain its verified SECURITY DEFINER owner and search_path.';
  END IF;

  IF pg_catalog.has_function_privilege('anon', v_getter, 'EXECUTE') IS NOT TRUE
     OR pg_catalog.has_function_privilege('authenticated', v_getter, 'EXECUTE') IS NOT TRUE THEN
    RAISE EXCEPTION 'The approved public aggregate-count RPC must remain callable.';
  END IF;
END;
$postflight$;

COMMIT;
