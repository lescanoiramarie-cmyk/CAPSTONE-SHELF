-- Database-side invariants for the final replay. Migration file inventory and
-- duplicate source versions are checked by scripts/validate-migrations.mjs;
-- PostgreSQL cannot inspect repository files (and pg_ls_dir is not available
-- to the test role).
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
BEGIN;
SELECT extensions.plan(8);

SELECT extensions.ok(
  to_regclass('supabase_migrations.schema_migrations') IS NOT NULL,
  'Supabase migration history table exists after replay'
);
SELECT extensions.ok(
  (SELECT count(*) > 0 FROM supabase_migrations.schema_migrations),
  'The local replay recorded migration versions'
);
SELECT extensions.ok(
  to_regprocedure('public.request_borrow_v2(text)') IS NOT NULL,
  'Current visitor borrowing RPC signature exists'
);
SELECT extensions.ok(
  to_regprocedure('public.confirm_pickup(uuid,text)') IS NOT NULL
  AND to_regprocedure('public.confirm_return(uuid,text)') IS NOT NULL,
  'Current UUID handover RPC signatures exist'
);
SELECT extensions.ok(
  to_regprocedure('public.is_active_staff_for_branch(text)') IS NOT NULL
  AND to_regprocedure('public.is_shelf_superadmin()') IS NOT NULL,
  'Fail-closed staff authorization helpers exist'
);
SELECT extensions.ok(
  NOT pg_catalog.has_function_privilege(
    'authenticated', 'shelf_private.request_borrow_unchecked(uuid,text)', 'EXECUTE'
  ),
  'Unchecked borrowing implementation is not executable by authenticated users'
);
SELECT extensions.ok(
  NOT pg_catalog.has_function_privilege(
    'authenticated', 'public.get_fine_payment_alert_targets_detail_internal(text)', 'EXECUTE'
  ),
  'Fine alert detail implementation is not executable by authenticated users'
);

SELECT extensions.ok(
  NOT pg_catalog.has_table_privilege('anon', 'public.borrowed_book_counts', 'SELECT')
  AND NOT pg_catalog.has_table_privilege('authenticated', 'public.borrowed_book_counts', 'SELECT')
  AND NOT pg_catalog.has_table_privilege('anon', 'public.borrowed_book_counts', 'INSERT')
  AND NOT pg_catalog.has_table_privilege('authenticated', 'public.borrowed_book_counts', 'INSERT')
  AND pg_catalog.has_function_privilege('anon', 'public.get_popular_borrowed_book_counts(integer)', 'EXECUTE')
  AND pg_catalog.has_function_privilege('authenticated', 'public.get_popular_borrowed_book_counts(integer)', 'EXECUTE')
  AND pg_catalog.pg_get_function_result('public.get_popular_borrowed_book_counts(integer)'::regprocedure)
      = 'TABLE(book_id text, borrow_count bigint)',
  'borrowed_book_counts has no direct API table grants; OPAC receives only aggregate book counts through its intended RPC'
);

SELECT * FROM extensions.finish();
ROLLBACK;
