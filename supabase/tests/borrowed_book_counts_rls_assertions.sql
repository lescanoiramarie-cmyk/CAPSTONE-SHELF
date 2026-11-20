CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
BEGIN;
SELECT extensions.plan(5);

SELECT extensions.ok(
  (SELECT relrowsecurity FROM pg_catalog.pg_class
   WHERE oid = 'public.borrowed_book_counts'::pg_catalog.regclass),
  'borrowed_book_counts enables RLS'
);
SELECT extensions.is(
  (SELECT pg_catalog.count(*)::integer FROM pg_catalog.pg_policy
   WHERE polrelid = 'public.borrowed_book_counts'::pg_catalog.regclass),
  0,
  'borrowed_book_counts has no API-facing policies'
);
SELECT extensions.ok(
  NOT pg_catalog.has_table_privilege('anon', 'public.borrowed_book_counts', 'SELECT')
  AND NOT pg_catalog.has_table_privilege('anon', 'public.borrowed_book_counts', 'INSERT')
  AND NOT pg_catalog.has_table_privilege('authenticated', 'public.borrowed_book_counts', 'SELECT')
  AND NOT pg_catalog.has_table_privilege('authenticated', 'public.borrowed_book_counts', 'INSERT')
  AND NOT pg_catalog.has_table_privilege('service_role', 'public.borrowed_book_counts', 'SELECT')
  AND NOT pg_catalog.has_table_privilege('service_role', 'public.borrowed_book_counts', 'INSERT'),
  'anon, authenticated, and service_role have no direct cache access'
);
SELECT extensions.ok(
  (SELECT prosecdef AND proowner = 'postgres'::pg_catalog.regrole
          AND proconfig = ARRAY['search_path=public, pg_temp']::text[]
   FROM pg_catalog.pg_proc
   WHERE oid = 'public.get_popular_borrowed_book_counts(integer)'::pg_catalog.regprocedure),
  'aggregate-count RPC uses the verified owner and fixed search_path'
);
SELECT extensions.ok(
  pg_catalog.has_function_privilege('anon', 'public.get_popular_borrowed_book_counts(integer)', 'EXECUTE')
  AND pg_catalog.has_function_privilege('authenticated', 'public.get_popular_borrowed_book_counts(integer)', 'EXECUTE'),
  'public aggregate-count workflow remains available through its RPC'
);

SELECT * FROM extensions.finish();
ROLLBACK;
