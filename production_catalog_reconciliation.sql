-- SHELF ILMS — Production Catalog Reconciliation (Read-Only)
-- Run via secure psql connection (same as secure_psql_test.ps1)
-- Purpose: Compare actual production catalog state with the 180-file local migration chain.
-- Do not export credentials, user passwords, OTP values, personal visitor data, or fine-payment transaction data.
-- All queries are strictly read-only: no INSERT, UPDATE, DELETE, ALTER, DROP, CREATE, GRANT, REVOKE.
-- ACL NOTE: aclexplode() returns no rows for NULL ACLs (default privileges). Effective privileges = explicit ACL UNION pg_default_acl.
-- This script reports explicit ACLs only. Default privileges from pg_default_acl are NOT automatically included.
-- To see effective privileges, you must also inspect pg_default_acl for the relevant object types and roles.

BEGIN TRANSACTION READ ONLY;

SELECT current_setting('transaction_read_only') AS transaction_read_only;

\echo '=== 1. Migration History ==='
-- Discover actual columns in the migration history table (read-only catalog inspection)
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'supabase_migrations' AND table_name = 'schema_migrations'
ORDER BY ordinal_position;

SELECT version, name
FROM supabase_migrations.schema_migrations
ORDER BY version;

SELECT version,
       name AS production_ledger_name,
       'visitor_terms_acceptance'::text AS local_migration_name,
       name = 'visitor_terms_acceptance' AS ledger_name_matches_local,
       pg_catalog.to_regprocedure('public.diag_list_community_rpcs()') IS NOT NULL
           AS diagnostic_helper_currently_exists
FROM supabase_migrations.schema_migrations
WHERE version = '20261031000000';

\echo '=== 2. Tables and Columns ==='
SELECT t.table_schema, t.table_name, c.column_name, c.data_type, c.is_nullable, c.column_default
FROM information_schema.tables t
JOIN information_schema.columns c ON c.table_schema = t.table_schema AND c.table_name = t.table_name
WHERE t.table_schema = 'public'
ORDER BY t.table_name, c.ordinal_position;

\echo '=== 3. Constraints ==='
SELECT tc.table_schema, tc.table_name, tc.constraint_name, tc.constraint_type,
       cc.column_name, ccu.table_schema AS ref_schema, ccu.table_name AS ref_table, ccu.column_name AS ref_column
FROM information_schema.table_constraints tc
LEFT JOIN information_schema.key_column_usage cc ON cc.constraint_name = tc.constraint_name AND cc.table_schema = tc.table_schema
LEFT JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = tc.constraint_name
WHERE tc.table_schema = 'public'
ORDER BY tc.table_name, tc.constraint_name;

\echo '=== 4. Indexes ==='
SELECT schemaname, tablename, indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public'
ORDER BY tablename, indexname;

\echo '=== 4b. Fine dashboard index catalog identity and per-key metadata ==='
SELECT index_ns.nspname AS index_schema,
       index_class.relname AS index_name,
       table_ns.nspname AS table_schema,
       table_class.relname AS table_name,
       pg_catalog.pg_get_userbyid(index_class.relowner) AS index_owner,
       access_method.amname AS access_method,
       pg_catalog.pg_get_indexdef(index_class.oid) AS index_definition,
       index_meta.indisunique AS is_unique,
       index_meta.indisvalid AS is_valid,
       index_meta.indisready AS is_ready,
       index_meta.indislive AS is_live,
       index_meta.indnatts AS total_attribute_count,
       index_meta.indnkeyatts AS key_attribute_count,
       pg_catalog.pg_get_expr(index_meta.indpred, index_meta.indrelid) AS predicate,
       pg_catalog.format_type(status_column.atttypid, status_column.atttypmod) AS borrow_requests_status_type,
       key_meta.ordinality AS attribute_position,
       CASE WHEN key_meta.ordinality <= index_meta.indnkeyatts THEN 'KEY' ELSE 'INCLUDE' END AS attribute_kind,
       CASE WHEN key_meta.attnum = 0
            THEN pg_catalog.pg_get_indexdef(index_class.oid, key_meta.ordinality::integer, true)
            ELSE table_attribute.attname::text END AS attribute_or_expression,
       option_meta.option_value AS indoption,
       CASE WHEN key_meta.ordinality <= index_meta.indnkeyatts
            THEN (option_meta.option_value & 1) = 1 END AS descending,
       CASE WHEN key_meta.ordinality <= index_meta.indnkeyatts
            THEN (option_meta.option_value & 2) = 2 END AS nulls_first,
       opclass_meta.opclass_oid AS operator_class_oid,
       operator_class.opcname AS operator_class,
       collation_meta.collation_oid AS index_collation_oid,
       index_collation.collname AS index_collation,
       table_attribute.attcollation AS table_column_collation_oid,
       table_collation.collname AS table_column_collation
FROM pg_catalog.pg_index AS index_meta
JOIN pg_catalog.pg_class AS index_class ON index_class.oid = index_meta.indexrelid
JOIN pg_catalog.pg_namespace AS index_ns ON index_ns.oid = index_class.relnamespace
JOIN pg_catalog.pg_class AS table_class ON table_class.oid = index_meta.indrelid
JOIN pg_catalog.pg_namespace AS table_ns ON table_ns.oid = table_class.relnamespace
JOIN pg_catalog.pg_am AS access_method ON access_method.oid = index_class.relam
JOIN pg_catalog.pg_attribute AS status_column
  ON status_column.attrelid = table_class.oid AND status_column.attname = 'status'
CROSS JOIN LATERAL pg_catalog.unnest(index_meta.indkey) WITH ORDINALITY AS key_meta(attnum, ordinality)
LEFT JOIN LATERAL pg_catalog.unnest(index_meta.indoption) WITH ORDINALITY AS option_meta(option_value, ordinality)
  ON option_meta.ordinality = key_meta.ordinality AND key_meta.ordinality <= index_meta.indnkeyatts
LEFT JOIN LATERAL pg_catalog.unnest(index_meta.indclass) WITH ORDINALITY AS opclass_meta(opclass_oid, ordinality)
  ON opclass_meta.ordinality = key_meta.ordinality AND key_meta.ordinality <= index_meta.indnkeyatts
LEFT JOIN LATERAL pg_catalog.unnest(index_meta.indcollation) WITH ORDINALITY AS collation_meta(collation_oid, ordinality)
  ON collation_meta.ordinality = key_meta.ordinality AND key_meta.ordinality <= index_meta.indnkeyatts
LEFT JOIN pg_catalog.pg_attribute AS table_attribute
  ON table_attribute.attrelid = table_class.oid AND table_attribute.attnum = key_meta.attnum
LEFT JOIN pg_catalog.pg_opclass AS operator_class ON operator_class.oid = opclass_meta.opclass_oid
LEFT JOIN pg_catalog.pg_collation AS index_collation ON index_collation.oid = collation_meta.collation_oid
LEFT JOIN pg_catalog.pg_collation AS table_collation ON table_collation.oid = table_attribute.attcollation
WHERE index_ns.nspname = 'public'
  AND index_class.relname = 'borrow_requests_fine_dashboard_status_book_due_idx'
ORDER BY key_meta.ordinality;

\echo '=== 5. Functions (with owners) ==='
SELECT n.nspname AS schema, p.proname AS name, pg_get_function_identity_arguments(p.oid) AS args,
       pg_get_function_result(p.oid) AS returns, l.lanname AS language,
       p.prosecdef AS security_definer, p.provolatile AS volatility,
       p.proconfig AS config, pg_get_userbyid(p.proowner) AS owner
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
JOIN pg_language l ON l.oid = p.prolang
WHERE n.nspname = 'public'
ORDER BY p.proname;

\echo '=== 5b. Critical RPC definitions and authorization source ==='
SELECT n.nspname AS schema,
       p.proname AS function_name,
       pg_catalog.pg_get_function_identity_arguments(p.oid) AS identity_arguments,
       pg_catalog.pg_get_userbyid(p.proowner) AS owner,
       p.prosecdef AS security_definer,
       p.proconfig AS function_settings,
       pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_execute,
       pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_execute,
       pg_catalog.has_function_privilege('service_role', p.oid, 'EXECUTE') AS service_role_execute,
       pg_catalog.pg_get_functiondef(p.oid) AS function_definition
FROM pg_catalog.pg_proc AS p
JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN (
      'confirm_community_book_pickup', 'get_fine_payment_alert_targets',
      'get_fine_payment_dashboard', 'get_fine_payment_analytics',
      'create_visitor_notification', 'confirm_pickup', 'confirm_return',
      'delete_my_book_review'
  )
ORDER BY p.proname, pg_catalog.pg_get_function_identity_arguments(p.oid);

\echo '=== 6. Function Grants (explicit only; NULL ACL = default privileges) ==='
SELECT n.nspname AS schema, p.proname AS name, pg_get_function_identity_arguments(p.oid) AS args,
       acl.grantee::regrole AS grantee, acl.privilege_type, acl.is_grantable
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
CROSS JOIN LATERAL aclexplode(p.proacl) AS acl
WHERE n.nspname = 'public'
ORDER BY p.proname, acl.grantee;

\echo '=== 6b. Default Privileges for Functions (pg_default_acl) ==='
-- Default privileges (ALTER DEFAULT PRIVILEGES) that apply to functions in public schema
-- These supplement explicit ACLs above. Effective privileges = explicit UNION applicable defaults.
SELECT d.defaclobjtype AS object_type, r.rolname AS owner_role,
       acl.grantee::regrole AS grantee, acl.privilege_type, acl.is_grantable
FROM pg_default_acl d
JOIN pg_namespace n ON n.oid = d.defaclnamespace
JOIN pg_roles r ON r.oid = d.defaclrole
CROSS JOIN LATERAL aclexplode(d.defaclacl) AS acl
WHERE n.nspname = 'public' AND d.defaclobjtype = 'f'
ORDER BY r.rolname, acl.grantee;

\echo '=== 7. Triggers ==='
SELECT t.tgname AS trigger_name, c.relname AS table_name, n.nspname AS schema,
       p.proname AS function_name, t.tgenabled, t.tgtype
FROM pg_trigger t
JOIN pg_class c ON c.oid = t.tgrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
JOIN pg_proc p ON p.oid = t.tgfoid
WHERE n.nspname = 'public' AND NOT t.tgisinternal
ORDER BY c.relname, t.tgname;

\echo '=== 8. RLS Status ==='
SELECT c.relname AS table_name, c.relrowsecurity AS rls_enabled, c.relforcerowsecurity AS rls_forced
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind = 'r'
ORDER BY c.relname;

\echo '=== 9. Policies ==='
SELECT p.polname AS policy_name, c.relname AS table_name, n.nspname AS schema,
       p.polcmd AS command, p.polpermissive AS permissive, p.polroles::regrole[] AS roles,
       pg_get_expr(p.polqual, p.polrelid) AS using_expr,
       pg_get_expr(p.polwithcheck, p.polrelid) AS with_check_expr
FROM pg_policy p
JOIN pg_class c ON c.oid = p.polrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
ORDER BY c.relname, p.polname;

\echo '=== 10. Table Grants (explicit only; NULL ACL = default privileges) ==='
SELECT n.nspname AS schema, c.relname AS table_name,
       acl.grantee::regrole AS grantee, acl.privilege_type, acl.is_grantable
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
CROSS JOIN LATERAL aclexplode(c.relacl) AS acl
WHERE n.nspname = 'public' AND c.relkind = 'r'
ORDER BY c.relname, acl.grantee;

\echo '=== 10b. Default Privileges for Tables (pg_default_acl) ==='
-- Default privileges (ALTER DEFAULT PRIVILEGES) that apply to tables in public schema
-- These supplement explicit ACLs above. Effective privileges = explicit UNION applicable defaults.
SELECT d.defaclobjtype AS object_type, r.rolname AS owner_role,
       acl.grantee::regrole AS grantee, acl.privilege_type, acl.is_grantable
FROM pg_default_acl d
JOIN pg_namespace n ON n.oid = d.defaclnamespace
JOIN pg_roles r ON r.oid = d.defaclrole
CROSS JOIN LATERAL aclexplode(d.defaclacl) AS acl
WHERE n.nspname = 'public' AND d.defaclobjtype = 'r'
ORDER BY r.rolname, acl.grantee;

\echo '=== 11. Schema/Sequence/Function Grants (broad; explicit only) ==='
-- Schema grants
SELECT n.nspname AS schema, acl.grantee::regrole AS grantee, acl.privilege_type, acl.is_grantable
FROM pg_namespace n
CROSS JOIN LATERAL aclexplode(n.nspacl) AS acl
WHERE n.nspname = 'public';

-- Sequence grants
SELECT n.nspname AS schema, c.relname AS sequence_name,
       acl.grantee::regrole AS grantee, acl.privilege_type, acl.is_grantable
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
CROSS JOIN LATERAL aclexplode(c.relacl) AS acl
WHERE n.nspname = 'public' AND c.relkind = 'S';

\echo '=== 11b. Default Privileges for Sequences & Schemas (pg_default_acl) ==='
-- Default privileges for sequences
SELECT d.defaclobjtype AS object_type, r.rolname AS owner_role,
       acl.grantee::regrole AS grantee, acl.privilege_type, acl.is_grantable
FROM pg_default_acl d
JOIN pg_namespace n ON n.oid = d.defaclnamespace
JOIN pg_roles r ON r.oid = d.defaclrole
CROSS JOIN LATERAL aclexplode(d.defaclacl) AS acl
WHERE n.nspname = 'public' AND d.defaclobjtype = 'S'
ORDER BY r.rolname, acl.grantee;

-- Default privileges for schemas
SELECT d.defaclobjtype AS object_type, r.rolname AS owner_role,
       acl.grantee::regrole AS grantee, acl.privilege_type, acl.is_grantable
FROM pg_default_acl d
JOIN pg_namespace n ON n.oid = d.defaclnamespace
JOIN pg_roles r ON r.oid = d.defaclrole
CROSS JOIN LATERAL aclexplode(d.defaclacl) AS acl
WHERE n.nspname = 'public' AND d.defaclobjtype = 'n'
ORDER BY r.rolname, acl.grantee;

\echo '=== 12. Views and Materialized Views ==='
SELECT c.relname AS name, c.relkind AS kind, n.nspname AS schema,
       pg_get_viewdef(c.oid) AS definition
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind IN ('v','m')
ORDER BY c.relkind, c.relname;

\echo '=== 13. Extensions ==='
SELECT extname, extversion, extrelocatable
FROM pg_extension
ORDER BY extname;

\echo '=== 14. Roles (relevant) ==='
SELECT rolname, rolsuper, rolinherit, rolcreaterole, rolcreatedb, rolcanlogin, rolbypassrls
FROM pg_roles
WHERE rolname IN ('postgres', 'anon', 'authenticated', 'service_role',
                  'shelf_attendance_rpc_owner', 'shelf_book_reviews_rpc_owner')
ORDER BY rolname;

\echo '=== 15. Critical Objects for the Local Migration Chain ==='
-- Check critical objects referenced by the local migration chain.
SELECT 'fine_payments' AS object, to_regclass('public.fine_payments') IS NOT NULL AS exists;
SELECT 'borrow_requests.fine_paid_amount' AS object, EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='borrow_requests' AND column_name='fine_paid_amount') AS exists;
SELECT 'borrow_requests.fine_review_required' AS object, EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='borrow_requests' AND column_name='fine_review_required') AS exists;
SELECT 'borrow_requests.fine_review_resolved_at' AS object, EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='borrow_requests' AND column_name='fine_review_resolved_at') AS exists;
SELECT 'borrow_requests.fine_review_note' AS object, EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='borrow_requests' AND column_name='fine_review_note') AS exists;
SELECT 'community_book_requests.fine_review_required' AS object, EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='community_book_requests' AND column_name='fine_review_required') AS exists;
SELECT 'visitors.registration_type' AS object, EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='visitors' AND column_name='registration_type') AS exists;
SELECT 'visitors.approval_status' AS object, EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='visitors' AND column_name='approval_status') AS exists;
SELECT 'visitor_otp_delivery_intents' AS object, to_regclass('public.visitor_otp_delivery_intents') IS NOT NULL AS exists;
SELECT 'visitor_otp_resend_capabilities' AS object, to_regclass('public.visitor_otp_resend_capabilities') IS NOT NULL AS exists;
SELECT 'visitor_notifications' AS object, to_regclass('public.visitor_notifications') IS NOT NULL AS exists;
SELECT 'confirm_community_book_pickup(uuid,text)' AS object,
       pg_catalog.to_regprocedure('public.confirm_community_book_pickup(uuid,text)') IS NOT NULL AS exists;
SELECT 'get_fine_payment_alert_targets(text)' AS object,
       pg_catalog.to_regprocedure('public.get_fine_payment_alert_targets(text)') IS NOT NULL AS exists;
SELECT 'get_book_reviews(text,integer,integer)' AS object,
       pg_catalog.to_regprocedure('public.get_book_reviews(text,integer,integer)') IS NOT NULL AS exists;
SELECT 'save_my_book_review(text,integer,text)' AS object,
       pg_catalog.to_regprocedure('public.save_my_book_review(text,integer,text)') IS NOT NULL AS exists;
SELECT 'delete_my_book_review(text)' AS object,
       pg_catalog.to_regprocedure('public.delete_my_book_review(text)') IS NOT NULL AS exists;
SELECT 'is_active_staff_for_branch(text)' AS object,
       pg_catalog.to_regprocedure('public.is_active_staff_for_branch(text)') IS NOT NULL AS exists;
SELECT 'is_shelf_superadmin()' AS object,
       pg_catalog.to_regprocedure('public.is_shelf_superadmin()') IS NOT NULL AS exists;
SELECT 'shelf_rpc_request_uid()' AS object,
       pg_catalog.to_regprocedure('public.shelf_rpc_request_uid()') IS NOT NULL AS exists;
SELECT 'shelf_rpc_request_jwt()' AS object,
       pg_catalog.to_regprocedure('public.shelf_rpc_request_jwt()') IS NOT NULL AS exists;
\echo '=== 15b. Visitor notification type constraint exact catalog definition ==='
WITH expected(value) AS (
    VALUES
      ('borrow_request_created'), ('borrow_request_queued'), ('borrow_ready_for_pickup'),
      ('borrow_pickup_confirmed'), ('borrow_due_soon'), ('borrow_due_today'),
      ('borrow_overdue'), ('borrow_return_confirmed'), ('borrow_auto_cancelled'),
      ('borrow_cancelled'), ('community_request_pending'), ('community_request_approved'),
      ('community_request_rejected'), ('community_pickup_confirmed'),
      ('community_return_confirmed'), ('community_due_soon'), ('community_due_today'),
      ('community_overdue'), ('community_cancelled'), ('announcement'),
      ('fine_reminder'), ('feedback_reply')
), actual AS (
    SELECT constraint_row.oid,
           constraint_row.conrelid,
           constraint_row.conname,
           constraint_row.contype,
           constraint_row.convalidated,
           constraint_row.conkey,
           pg_catalog.pg_get_constraintdef(constraint_row.oid, true) AS definition,
           pg_catalog.array_agg(DISTINCT regex_match.captures[1] ORDER BY regex_match.captures[1])
               FILTER (WHERE regex_match.captures IS NOT NULL) AS allowed_values
    FROM pg_catalog.pg_constraint AS constraint_row
    JOIN pg_catalog.pg_class AS table_row ON table_row.oid = constraint_row.conrelid
    JOIN pg_catalog.pg_namespace AS schema_row ON schema_row.oid = table_row.relnamespace
    LEFT JOIN LATERAL pg_catalog.regexp_matches(
        pg_catalog.pg_get_constraintdef(constraint_row.oid, true), '''([^'']*)''', 'g'
    ) AS regex_match(captures) ON true
    WHERE schema_row.nspname = 'public'
      AND table_row.relname = 'visitor_notifications'
      AND constraint_row.conname = 'visitor_notifications_notification_type_check'
    GROUP BY constraint_row.oid, constraint_row.conrelid, constraint_row.conname, constraint_row.contype,
             constraint_row.convalidated, constraint_row.conkey
)
SELECT (constraint_row.oid IS NOT NULL) AS constraint_present,
       constraint_row.conname AS constraint_name,
       constraint_row.contype AS constraint_type,
       constraint_row.convalidated AS is_validated,
       constraint_row.definition AS actual_definition,
       constraint_row.conkey AS constrained_attribute_numbers,
       constraint_row.allowed_values,
       pg_catalog.cardinality(constraint_row.allowed_values) AS allowed_value_count,
       COALESCE(constraint_row.contype = 'c'
           AND constraint_row.convalidated
           AND constraint_row.conkey = ARRAY[attribute_row.attnum]::smallint[]
           AND constraint_row.allowed_values = (
               SELECT pg_catalog.array_agg(expected.value ORDER BY expected.value)
               FROM expected
           ), false) AS matches_canonical_allowed_values
FROM pg_catalog.pg_class AS table_row
JOIN pg_catalog.pg_namespace AS schema_row ON schema_row.oid = table_row.relnamespace
JOIN pg_catalog.pg_attribute AS attribute_row
  ON attribute_row.attrelid = table_row.oid
 AND attribute_row.attname = 'notification_type'
 AND attribute_row.attnum > 0
LEFT JOIN actual AS constraint_row ON constraint_row.conrelid = table_row.oid
WHERE schema_row.nspname = 'public' AND table_row.relname = 'visitor_notifications';
\echo '=== 15c. borrowed_book_counts RLS, effective API grants, and defaults ==='
SELECT table_row.relrowsecurity AS rls_enabled,
       table_row.relforcerowsecurity AS rls_forced,
       pg_catalog.pg_get_userbyid(table_row.relowner) AS table_owner,
       pg_catalog.has_table_privilege('anon', table_row.oid, 'SELECT') AS anon_select,
       pg_catalog.has_table_privilege('anon', table_row.oid, 'INSERT') AS anon_insert,
       pg_catalog.has_table_privilege('anon', table_row.oid, 'UPDATE') AS anon_update,
       pg_catalog.has_table_privilege('anon', table_row.oid, 'DELETE') AS anon_delete,
       pg_catalog.has_table_privilege('authenticated', table_row.oid, 'SELECT') AS authenticated_select,
       pg_catalog.has_table_privilege('authenticated', table_row.oid, 'INSERT') AS authenticated_insert,
       pg_catalog.has_table_privilege('authenticated', table_row.oid, 'UPDATE') AS authenticated_update,
       pg_catalog.has_table_privilege('authenticated', table_row.oid, 'DELETE') AS authenticated_delete,
       table_row.relacl AS explicit_acl,
       CASE WHEN defaults.default_acl_schema = 0 THEN 'GLOBAL' ELSE schema_row.nspname END AS default_acl_scope,
       defaults.owner_role AS default_acl_owner,
       defaults.grantee,
       defaults.privilege_type AS default_privilege
FROM pg_catalog.pg_class AS table_row
JOIN pg_catalog.pg_namespace AS schema_row ON schema_row.oid = table_row.relnamespace
LEFT JOIN LATERAL (
    SELECT default_acl.defaclnamespace AS default_acl_schema,
           owner_role.rolname AS owner_role,
           acl.grantee::regrole::text AS grantee,
           acl.privilege_type
    FROM pg_catalog.pg_default_acl AS default_acl
    JOIN pg_catalog.pg_roles AS owner_role ON owner_role.oid = default_acl.defaclrole
    CROSS JOIN LATERAL pg_catalog.aclexplode(default_acl.defaclacl) AS acl
    WHERE default_acl.defaclnamespace IN (0, schema_row.oid)
      AND default_acl.defaclobjtype = 'r'
) AS defaults ON true
WHERE schema_row.nspname = 'public' AND table_row.relname = 'borrowed_book_counts';

COMMIT;
