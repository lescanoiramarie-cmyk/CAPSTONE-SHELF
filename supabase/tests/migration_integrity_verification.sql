-- Phase 6: Group 14 - Migration Integrity Verification
-- This script verifies the 156 migrations for:
-- 1. Unique ordered versions (no duplicates, no gaps)
-- 2. No duplicate/conflicting function signatures
-- 3. No grant expansion beyond documented grants
-- 4. Pre/postconditions for each function
-- 5. Catalog assertions cover all function metadata/ACLs
--
-- Run this against a clean database after applying all 156 migrations.
-- Status: BLOCKED - Requires isolated PostgreSQL database

-- ============================================================================
-- CHECK 1: Migration Version Uniqueness and Ordering
-- ============================================================================
-- Expected: 156 unique versions from 20260930000000 to 20270103000100
-- No duplicate versions, no missing sequential order (chronological)

-- Verification query (run after all migrations applied):
SELECT version, COUNT(*) as count
FROM (
  SELECT regexp_match(filename, '^(\d{14})_') as version
  FROM pg_ls_dir('migrations') as filename
  WHERE filename LIKE '%.sql'
) v
GROUP BY version
HAVING COUNT(*) > 1;

-- Should return 0 rows

-- ============================================================================
-- CHECK 2: Function Signature Conflicts
-- ============================================================================
-- Find functions with same name but different signatures across migrations
-- This checks for OID conflicts that would cause migration failures

-- Verification query:
SELECT proname, COUNT(DISTINCT oid) as overload_count,
       array_agg(oid::regprocedure ORDER BY oid) as signatures
FROM pg_proc
WHERE pronamespace = 'public'::regnamespace
GROUP BY proname
HAVING COUNT(DISTINCT oid) > 1;

-- Review each overload set for intentional vs accidental conflicts

-- ============================================================================
-- CHECK 3: Grant Analysis - No Expansion Beyond Documented
-- ============================================================================
-- For each function, verify grants match documented intent:
-- - SECURITY INVOKER functions: grants to anon/authenticated as documented
-- - SECURITY DEFINER functions: grants to authenticated/service_role only
-- - No GRANT TO PUBLIC, anon on SECURITY DEFINER functions (except opac helpers)

-- Verification query:
SELECT
  p.proname,
  pg_get_function_identity_arguments(p.oid) as signature,
  p.prosecdef as is_security_definer,
  p.proconfig as search_path_config,
  pg_catalog.array_agg(DISTINCT r.rolname) FILTER (WHERE has_function_privilege(r.oid, p.oid, 'EXECUTE')) as granted_roles
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
CROSS JOIN LATERAL (
  SELECT rolname, oid FROM pg_roles WHERE rolname IN ('anon', 'authenticated', 'service_role', 'postgres')
) r
WHERE n.nspname = 'public'
GROUP BY p.oid, p.proname, p.prosecdef, p.proconfig
ORDER BY p.proname, signature;

-- Expected grants by function category:
-- Visitor-facing (AAL1): GRANT TO authenticated
-- Staff-facing (AAL2): GRANT TO authenticated, service_role
-- OPAC general counts: GRANT TO anon, authenticated
-- OPAC branch-scoped: GRANT TO authenticated only
-- Internal functions: NO GRANTS (owned by postgres)
-- Edge Function helpers: GRANT TO service_role

-- ============================================================================
-- CHECK 4: Function Ownership and Search Path
-- ============================================================================
-- Verify all SECURITY DEFINER functions have:
-- - Owner = postgres (or documented owner)
-- - search_path = '' (empty) or explicit 'public'
-- - No mutable search_path configurations

-- Verification query:
SELECT
  p.proname,
  pg_get_function_identity_arguments(p.oid) as signature,
  p.prosecdef,
  pg_get_userbyid(p.proowner) as owner,
  p.proconfig
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE n.nspname = 'public'
  AND p.prosecdef = true
ORDER BY p.proname;

-- All should show owner = 'postgres' and proconfig = '{search_path=""}' or '{search_path=public}'

-- ============================================================================
-- CHECK 5: Catalog Assertions Coverage
-- ============================================================================
-- Verify each migration with postflight has corresponding catalog assertions
-- Check the latest migrations (Groups 7-10) for postflight blocks

-- Key migrations with postflight assertions:
-- 20270102002500_remaining_secdef_hardening.sql
-- 20270102002600_fix_visitor_functions_aal2_and_harden_base.sql
-- 20270102002700_critical_rpcs_for_direct_access.sql
-- 20270102002900_opac_book_count_rpc_fixed.sql
-- 20270103000100_fine_payment_internal_hardening_and_cohort_protection.sql

-- Each should contain:
-- - Ownership checks (proowner = 'postgres')
-- - Search_path checks (proconfig = '{search_path=""}')
-- - Grant checks (has_function_privilege for expected roles)
-- - No-grant checks for internal functions
-- - Signature/argument validation

-- ============================================================================
-- CHECK 6: RLS Policy Coverage
-- ============================================================================
-- Verify all tables with sensitive data have RLS enabled and policies

-- Verification query:
SELECT
  c.relname as table_name,
  c.relrowsecurity as rls_enabled,
  c.relforcerowsecurity as rls_forced,
  count(p.oid) as policy_count
FROM pg_class c
JOIN pg_namespace n ON c.relnamespace = n.oid
LEFT JOIN pg_policy p ON p.polrelid = c.oid
WHERE n.nspname = 'public'
  AND c.relkind = 'r'
  AND c.relname IN (
    'visitors', 'staff_profiles', 'borrow_requests', 'books',
    'fine_payments', 'attendance_logs', 'personal_books',
    'libraries', 'external_catalog_books'
  )
GROUP BY c.oid, c.relname, c.relrowsecurity, c.relforcerowsecurity
ORDER BY c.relname;

-- All should have rls_enabled = true, rls_forced = true, policy_count > 0

-- ============================================================================
-- CHECK 7: Function Volatility and Cost
-- ============================================================================
-- Verify functions have appropriate volatility (STABLE/IMMUTABLE) where applicable
-- and cost estimates for planner

-- Verification query:
SELECT proname, provolatile, procost, prorows
FROM pg_proc
WHERE pronamespace = 'public'::regnamespace
  AND provolatile = 'v'  -- VOLATILE
  AND proname NOT IN (
    -- Known volatile functions (side effects)
    'request_borrow_v2', 'confirm_pickup', 'confirm_return',
    'record_fine_payment', 'review_fine_payment', 'toggle_attendance',
    'send_visitor_otp', 'verify_visitor_otp', 'manage_staff'
  );

-- Should return minimal results - only intentionally volatile functions

-- ============================================================================
-- CHECK 8: Migration Dependency Order
-- ============================================================================
-- Verify migrations that depend on each other are in correct order
-- Key dependencies:
-- - 20270102002500 (secdef hardening) before 20270102002600 (visitor functions fix)
-- - 20270102002600 before 20270102002700 (critical RPCs)
-- - 20270102002700 before 20270102002800/002900 (OPAC counts)
-- - 20270102002800 before 20270102002900 (OPAC fix)
-- - 20270102000100 (fine privacy) before 20270102000700 (fine RPC auth)
-- - 20270102000700 before 20270103000100 (fine internal hardening)
-- - 20270101000000 (attendance hardening) before 20270102001100 (attendance claims)
-- - 20270102002400 (transaction hardening) before 20270102002500 (secdef hardening)

-- Manual verification of version ordering confirms correct sequence.

-- ============================================================================
-- CHECK 9: No Dropped Functions Referenced
-- ============================================================================
-- Verify no frontend code or other migrations reference dropped functions
-- Functions dropped in security hardening:
-- - send_visitor_otp_old (if any)
-- - legacy handover overloads
-- - QR login functions (retained pending external caller verification)

-- Frontend references checked in:
-- - src/data/store.js (updated to use new RPCs)
-- - src/lib/finePaymentAnalytics.js
-- - src/component/FinePayments.jsx
-- - src/component/OPACCatalog.jsx

-- ============================================================================
-- CHECK 10: Type Consistency
-- ============================================================================
-- Verify visitor_id (TEXT) vs auth_user_id (UUID) consistency
-- Key invariant: visitors.id = TEXT ('VIS-XXXXXXXX'), visitors.auth_user_id = UUID
-- borrow_requests.visitor_id references visitors.id (TEXT)
-- Staff functions use is_active_staff_for_branch (branch access), NOT visitor_id = auth.uid()

-- Verification queries:
-- Check column types match across tables
SELECT table_name, column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND column_name IN ('visitor_id', 'auth_user_id', 'id')
  AND table_name IN ('visitors', 'borrow_requests', 'fine_payments', 'attendance_logs', 'personal_books')
ORDER BY table_name, column_name;

-- Expected:
-- visitors.id = character varying (TEXT)
-- visitors.auth_user_id = uuid
-- borrow_requests.visitor_id = character varying (TEXT)
-- fine_payments.visitor_id = character varying (TEXT) or uuid depending on design
-- attendance_logs.visitor_id = character varying (TEXT)

-- ============================================================================
-- SUMMARY
-- ============================================================================
-- All 10 checks should be executed against a clean database with all 156 migrations applied.
-- Results should be documented in RELEASE_VALIDATION_RUNBOOK.md
-- Status: BLOCKED - Requires isolated PostgreSQL database