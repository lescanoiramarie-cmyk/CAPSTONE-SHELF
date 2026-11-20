-- SHELF ILMS — Production Catalog Reconciliation (Read-Only)
-- Run via secure psql connection (same as secure_psql_test.ps1)
-- Purpose: Compare actual production catalog state with the 179-file local migration chain.
-- Do not export credentials, user passwords, OTP values, personal visitor data, or fine-payment transaction data.
-- All queries are strictly read-only: no INSERT, UPDATE, DELETE, ALTER, DROP, CREATE, GRANT, REVOKE.
-- ACL NOTE: aclexplode() returns no rows for NULL ACLs (default privileges). Effective privileges = explicit ACL UNION pg_default_acl.
-- This script reports explicit ACLs only. Default privileges from pg_default_acl are NOT automatically included.
-- To see effective privileges, you must also inspect pg_default_acl for the relevant object types and roles.

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
SELECT 'confirm_community_book_pickup(uuid,text)' AS object, to_regproc('public.confirm_community_book_pickup(uuid,text)') IS NOT NULL AS exists;
SELECT 'get_fine_payment_alert_targets(text)' AS object, to_regproc('public.get_fine_payment_alert_targets(text)') IS NOT NULL AS exists;
SELECT 'get_book_reviews' AS object, to_regproc('public.get_book_reviews(text,integer,integer)') IS NOT NULL AS exists;
SELECT 'save_my_book_review' AS object, to_regproc('public.save_my_book_review(text,integer,text)') IS NOT NULL AS exists;
SELECT 'delete_my_book_review' AS object, to_regproc('public.delete_my_book_review(uuid)') IS NOT NULL AS exists;
SELECT 'is_active_staff_for_branch(text)' AS object, to_regproc('public.is_active_staff_for_branch(text)') IS NOT NULL AS exists;
SELECT 'is_shelf_superadmin()' AS object, to_regproc('public.is_shelf_superadmin()') IS NOT NULL AS exists;
SELECT 'shelf_rpc_request_uid()' AS object, to_regproc('public.shelf_rpc_request_uid()') IS NOT NULL AS exists;
SELECT 'shelf_rpc_request_jwt()' AS object, to_regproc('public.shelf_rpc_request_jwt()') IS NOT NULL AS exists;
SELECT 'notification_type_check (21 types)' AS object,
       EXISTS(SELECT 1 FROM pg_constraint WHERE conname='visitor_notifications_notification_type_check'
              AND pg_get_constraintdef(oid) LIKE '%21%') AS exists;
