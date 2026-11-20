-- ============================================================================
-- SHELF ILMS — Read-Only Production Failed Migration Diagnostic Workflow
-- File: scripts/verify-failed-migration-state-readonly.sql
--
-- Objective: Independently inspect the state of the database following the
-- failed 20270102000300 migration attempt (ERROR: column "updated_at" does not exist).
--
-- SAFETY RULES:
-- 1. Strictly read-only: SELECT and WITH statements only.
-- 2. No DDL (CREATE, ALTER, DROP), No DML (INSERT, UPDATE, DELETE), No GRANT/REVOKE.
-- 3. No visitor personal data or passwords/tokens are selected.
-- 4. Each section has a descriptive title and returns a clear, single result set.
-- ============================================================================

-- === 0. CONNECTION & ENVIRONMENT CONTEXT ===
-- Confirm the connected database, server version, and effective user role.
SELECT current_database() AS database_name,
       session_user AS session_user,
       current_user AS effective_user,
       inet_server_addr() AS server_address,
       inet_server_port() AS server_port,
       current_setting('server_version') AS server_version;

-- === 1. CURRENT MIGRATION HISTORY AND EXPECTED MIGRATION VERSION STATUS ===
-- 1.1 Complete migration ledger
SELECT version, name
FROM supabase_migrations.schema_migrations
ORDER BY version;

-- 1.2 Expected vs recorded status for target review and hardening migrations
WITH expected(version, description) AS (VALUES
  ('20270102000000', 'baseline hardening'),
  ('20270102000100', 'security updates'),
  ('20270102000200', 'access prerequisites'),
  ('20270102000300', 'book_reviews_privacy (FAILED ATTEMPT)'),
  ('20270102000400', 'rpc_owner_auth_claim_access'),
  ('20270102001100', 'attendance_claims_review_labels_and_table_acl'),
  ('20270103000200', 'fix_get_current_user_role'),
  ('20270103001000', 'review_eligibility_enforcement')
)
SELECT expected.version,
       expected.description,
       history.name AS recorded_name,
       history.version IS NOT NULL AS is_recorded
FROM expected
LEFT JOIN supabase_migrations.schema_migrations AS history
  ON history.version = expected.version
ORDER BY expected.version;

-- === 2. ACTUAL BOOK_REVIEWS COLUMNS AND DATA TYPES ===
-- Inspect actual columns and data types without assuming updated_at exists.
SELECT a.attnum AS ordinal_position,
       a.attname AS column_name,
       pg_catalog.format_type(a.atttypid, a.atttypmod) AS data_type,
       a.attnotnull AS is_not_null,
       pg_catalog.pg_get_expr(d.adbin, d.adrelid) AS default_expression
FROM pg_catalog.pg_class AS c
JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
JOIN pg_catalog.pg_attribute AS a ON a.attrelid = c.oid
LEFT JOIN pg_catalog.pg_attrdef AS d ON d.adrelid = c.oid AND d.adnum = a.attnum
WHERE n.nspname = 'public' AND c.relname = 'book_reviews'
  AND a.attnum > 0 AND NOT a.attisdropped
ORDER BY a.attnum;

-- === 3. TABLE-LEVEL AND COLUMN-LEVEL PRIVILEGES ===
-- 3.1 Table-level grants on book_reviews
SELECT grantee, privilege_type, is_grantable
FROM information_schema.role_table_grants
WHERE table_schema = 'public' AND table_name = 'book_reviews'
ORDER BY grantee, privilege_type;

-- 3.2 Column-level grants on book_reviews
SELECT grantee, column_name, privilege_type, is_grantable
FROM information_schema.column_privileges
WHERE table_schema = 'public' AND table_name = 'book_reviews'
ORDER BY grantee, column_name, privilege_type;

-- === 4. REVIEW RPC SIGNATURES, OWNERS, SECURITY DEFINER, SEARCH PATHS, AND EXECUTE PRIVILEGES ===
SELECT n.nspname AS function_schema,
       p.proname AS function_name,
       pg_catalog.pg_get_function_identity_arguments(p.oid) AS identity_arguments,
       pg_catalog.pg_get_function_result(p.oid) AS result_type,
       pg_catalog.pg_get_userbyid(p.proowner) AS function_owner,
       p.prosecdef AS is_security_definer,
       p.proconfig AS function_settings,
       pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_can_execute,
       pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_can_execute,
       pg_catalog.has_function_privilege('service_role', p.oid, 'EXECUTE') AS service_role_can_execute,
       CASE WHEN EXISTS (
         SELECT 1 FROM pg_catalog.pg_roles AS r WHERE r.rolname = 'shelf_book_reviews_rpc_owner'
       ) THEN pg_catalog.has_function_privilege('shelf_book_reviews_rpc_owner', p.oid, 'EXECUTE')
       ELSE false END AS rpc_owner_can_execute
FROM pg_catalog.pg_proc AS p
JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN (
    'get_book_reviews',
    'save_my_book_review',
    'delete_my_book_review',
    'is_review_eligible',
    'get_current_user_role'
  )
ORDER BY p.proname, pg_catalog.pg_get_function_identity_arguments(p.oid);

-- === 5. RLS ENABLED/FORCED STATUS AND POLICIES ===
-- 5.1 RLS enabled and forced status for book_reviews, borrow_requests, and community_book_requests
SELECT n.nspname AS table_schema,
       c.relname AS table_name,
       pg_catalog.pg_get_userbyid(c.relowner) AS table_owner,
       c.relrowsecurity AS rls_enabled,
       c.relforcerowsecurity AS rls_forced
FROM pg_catalog.pg_class AS c
JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname IN ('book_reviews', 'borrow_requests', 'community_book_requests')
ORDER BY c.relname;

-- 5.2 RLS policies for book_reviews, borrow_requests, and community_book_requests
SELECT p.schemaname,
       p.tablename,
       p.policyname,
       p.permissive,
       p.roles,
       p.cmd,
       p.qual,
       p.with_check
FROM pg_catalog.pg_policies AS p
WHERE p.schemaname = 'public'
  AND p.tablename IN ('book_reviews', 'borrow_requests', 'community_book_requests')
ORDER BY p.tablename, p.policyname;

-- === 6. EXISTING UNIQUE CONSTRAINTS AND INDEXES REQUIRED BY REVIEW UPSERT BEHAVIOR ===
-- 6.1 Unique and Primary Key constraints on public.book_reviews
SELECT constraint_row.conname AS constraint_name,
       constraint_row.contype AS constraint_type,
       pg_catalog.pg_get_constraintdef(constraint_row.oid) AS constraint_definition
FROM pg_catalog.pg_constraint AS constraint_row
WHERE constraint_row.conrelid = 'public.book_reviews'::regclass
  AND constraint_row.contype IN ('u', 'p')
ORDER BY constraint_row.conname;

-- 6.2 Indexes on public.book_reviews
SELECT index_row.indexrelid::regclass AS index_name,
       index_row.indisunique AS is_unique,
       index_row.indisvalid AS is_valid,
       pg_catalog.pg_get_indexdef(index_row.indexrelid) AS index_definition
FROM pg_catalog.pg_index AS index_row
WHERE index_row.indrelid = 'public.book_reviews'::regclass
ORDER BY index_row.indexrelid::regclass::text;

-- === 7. DUPLICATE (BOOK_ID, VISITOR_ID) RECORDS ===
-- Exposes count only to maintain visitor privacy while verifying upsert prerequisites.
SELECT count(*) AS duplicate_nonnull_visitor_book_pairs
FROM (
    SELECT book_id, visitor_id
    FROM public.book_reviews
    WHERE visitor_id IS NOT NULL
    GROUP BY book_id, visitor_id
    HAVING count(*) > 1
) AS duplicate_pairs;

-- === 8. POSSIBLE PARTIAL EFFECTS FROM THE FAILED MIGRATION ===
-- Check whether shelf_book_reviews_rpc_owner or partial policies/functions persist
SELECT 'role_exists' AS check_item,
       EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'shelf_book_reviews_rpc_owner')::text AS result
UNION ALL
SELECT 'schema_usage',
       CASE WHEN EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'shelf_book_reviews_rpc_owner')
            THEN pg_catalog.has_schema_privilege('shelf_book_reviews_rpc_owner', 'public', 'USAGE')::text
            ELSE 'false' END
UNION ALL
SELECT 'schema_create',
       CASE WHEN EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'shelf_book_reviews_rpc_owner')
            THEN pg_catalog.has_schema_privilege('shelf_book_reviews_rpc_owner', 'public', 'CREATE')::text
            ELSE 'false' END
UNION ALL
SELECT 'policies_on_book_reviews_count',
       (SELECT count(*)::text FROM pg_catalog.pg_policies WHERE schemaname = 'public' AND tablename = 'book_reviews')
UNION ALL
SELECT 'functions_matching_review_count',
       (SELECT count(*)::text FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.proname IN ('get_book_reviews', 'save_my_book_review', 'delete_my_book_review'));

-- === 9. RELEVANT ROLE EXISTENCE, ATTRIBUTES, MEMBERSHIPS, AND GRANTS ===
-- 9.1 Role attributes and memberships for shelf_book_reviews_rpc_owner
SELECT r.rolname AS role_name,
       r.rolcanlogin AS can_login,
       r.rolinherit AS inherits,
       r.rolbypassrls AS bypass_rls,
       r.rolsuper AS is_superuser,
       pg_catalog.pg_has_role('anon', r.oid, 'MEMBER') AS anon_is_member,
       pg_catalog.pg_has_role('authenticated', r.oid, 'MEMBER') AS authenticated_is_member,
       pg_catalog.pg_has_role('service_role', r.oid, 'MEMBER') AS service_role_is_member,
       pg_catalog.pg_has_role('postgres', r.oid, 'MEMBER') AS postgres_is_member
FROM pg_catalog.pg_roles AS r
WHERE r.rolname = 'shelf_book_reviews_rpc_owner';

-- 9.2 Column privileges on borrowing tables granted to shelf_book_reviews_rpc_owner
SELECT table_name, column_name, privilege_type, is_grantable
FROM information_schema.column_privileges
WHERE table_schema = 'public'
  AND table_name IN ('borrow_requests', 'community_book_requests')
  AND grantee = 'shelf_book_reviews_rpc_owner'
ORDER BY table_name, column_name, privilege_type;
