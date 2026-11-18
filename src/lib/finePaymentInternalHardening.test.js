import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migration = readFileSync(
  new URL('../../supabase/migrations/20270103000100_fine_payment_internal_hardening_and_cohort_protection.sql', import.meta.url),
  'utf8'
);

test('fine payment internal functions have explicit ownership and empty search_path', () => {
  // Internal functions should have explicit OWNER TO postgres
  assert.match(migration, /ALTER FUNCTION public\.get_fine_payment_dashboard_detail_internal\(text\)\s+OWNER TO postgres;/);
  assert.match(migration, /ALTER FUNCTION public\.get_fine_payment_alert_targets_detail_internal\(text\)\s+OWNER TO postgres;/);
  assert.match(migration, /ALTER FUNCTION public\.record_fine_payment_subadmin_internal\(text, numeric, text, text, text\)\s+OWNER TO postgres;/);
  assert.match(migration, /ALTER FUNCTION public\.resolve_fine_review_subadmin_internal\(text, text, numeric, text\)\s+OWNER TO postgres;/);

  // Internal functions should have empty search_path
  assert.match(migration, /ALTER FUNCTION public\.get_fine_payment_dashboard_detail_internal\(text\)\s+SET search_path = '';/);
  assert.match(migration, /ALTER FUNCTION public\.get_fine_payment_alert_targets_detail_internal\(text\)\s+SET search_path = '';/);
  assert.match(migration, /ALTER FUNCTION public\.record_fine_payment_subadmin_internal\(text, numeric, text, text, text\)\s+SET search_path = '';/);
  assert.match(migration, /ALTER FUNCTION public\.resolve_fine_review_subadmin_internal\(text, text, numeric, text\)\s+SET search_path = '';/);

  // Internal functions should have REVOKE ALL from all roles
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.get_fine_payment_dashboard_detail_internal\(text\)\s+FROM PUBLIC, anon, authenticated, service_role;/);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.get_fine_payment_alert_targets_detail_internal\(text\)\s+FROM PUBLIC, anon, authenticated, service_role;/);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.record_fine_payment_subadmin_internal\(text, numeric, text, text, text\)\s+FROM PUBLIC, anon, authenticated, service_role;/);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.resolve_fine_review_subadmin_internal\(text, text, numeric, text\)\s+FROM PUBLIC, anon, authenticated, service_role;/);
});

test('wrapper functions are redefined with empty search_path and proper grants', () => {
  // Wrapper functions should have SECURITY DEFINER with empty search_path
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.get_fine_payment_dashboard\([\s\S]*?SECURITY DEFINER[\s\S]*?SET search_path = ''/);
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.get_fine_payment_alert_targets\([\s\S]*?SECURITY DEFINER[\s\S]*?SET search_path = ''/);
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.record_fine_payment\([\s\S]*?SECURITY DEFINER[\s\S]*?SET search_path = ''/);
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.resolve_fine_review\([\s\S]*?SECURITY DEFINER[\s\S]*?SET search_path = ''/);

  // Wrapper functions should have OWNER TO postgres
  assert.match(migration, /ALTER FUNCTION public\.get_fine_payment_dashboard\(text\) OWNER TO postgres;/);
  assert.match(migration, /ALTER FUNCTION public\.get_fine_payment_alert_targets\(text\) OWNER TO postgres;/);
  assert.match(migration, /ALTER FUNCTION public\.record_fine_payment\(text, numeric, text, text, text\) OWNER TO postgres;/);
  assert.match(migration, /ALTER FUNCTION public\.resolve_fine_review\(text, text, numeric, text\) OWNER TO postgres;/);

  // Wrapper functions should grant EXECUTE to authenticated only
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.get_fine_payment_dashboard\(text\) TO authenticated;/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.get_fine_payment_alert_targets\(text\) TO authenticated;/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.record_fine_payment\(text, numeric, text, text, text\) TO authenticated;/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.resolve_fine_review\(text, text, numeric, text\) TO authenticated;/);

  // Wrapper functions should NOT grant to service_role, anon, or PUBLIC
  assert.doesNotMatch(migration, /GRANT EXECUTE ON FUNCTION public\.get_fine_payment_dashboard\(text\) TO (service_role|anon|PUBLIC)/);
  assert.doesNotMatch(migration, /GRANT EXECUTE ON FUNCTION public\.get_fine_payment_alert_targets\(text\) TO (service_role|anon|PUBLIC)/);
  assert.doesNotMatch(migration, /GRANT EXECUTE ON FUNCTION public\.record_fine_payment\(text, numeric, text, text, text\) TO (service_role|anon|PUBLIC)/);
  assert.doesNotMatch(migration, /GRANT EXECUTE ON FUNCTION public\.resolve_fine_review\(text, text, numeric, text\) TO (service_role|anon|PUBLIC)/);
});

test('analytics function has small-cohort suppression with documented threshold', () => {
  // Analytics function should be redefined with empty search_path
  assert.match(migration, /DROP FUNCTION IF EXISTS public\.get_fine_payment_analytics\(text\);/);
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.get_fine_payment_analytics\([\s\S]*?SECURITY DEFINER[\s\S]*?SET search_path = ''/);

  // Analytics function should have OWNER TO postgres
  assert.match(migration, /ALTER FUNCTION public\.get_fine_payment_analytics\(text\) OWNER TO postgres;/);

  // Analytics function should grant to authenticated and service_role (for cron)
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.get_fine_payment_analytics\(text\) TO authenticated, service_role;/);

  // Small-cohort threshold constant should be defined and documented
  assert.match(migration, /v_min_cohort constant int := 3;/);
  assert.match(migration, /Threshold: minimum 3 requests per branch per period/);
  assert.match(migration, /Rationale: With fewer than 3 requests, individual financial activity/);

  // Branch summary should join with branch_request_counts to apply suppression
  assert.match(migration, /branch_request_counts AS \(/);
  assert.match(migration, /HAVING count\(\*\) >= v_min_cohort/);
  assert.match(migration, /FROM detail_rows AS d\s+JOIN branch_request_counts brc ON brc\.library_id = d\.library_id/);

  // Monthly breakdowns should also apply cohort suppression
  assert.match(migration, /monthly_cohort AS \(/);
  assert.match(migration, /HAVING count\(DISTINCT request\.id\) >= v_min_cohort/);
  assert.match(migration, /monthly_filtered AS \(/);
  assert.match(migration, /FROM monthly_filtered AS monthly/);

  // Postflight should validate internal functions have no EXECUTE grants
  assert.match(migration, /IF pg_catalog\.has_function_privilege\('anon', v_signature, 'EXECUTE'\)/);
  assert.match(migration, /Internal function % has unexpected EXECUTE grants/);
});

test('analytics function preserves Super Admin system-wide and Sub-Admin branch-scoped access', () => {
  // Super Admin should see all libraries when p_library_id is null
  assert.match(migration, /CASE WHEN v_role = 'subadmin' THEN v_library_id::text ELSE p_library_id END/);

  // Sub-Admin should be restricted to their assigned library
  assert.match(migration, /IF v_role = 'subadmin'\s+AND p_library_id IS NOT NULL\s+AND p_library_id <> v_library_id::text/);
  assert.match(migration, /RAISE EXCEPTION 'You can only view analytics for your assigned library.'/);

  // Monthly aggregation should respect role scoping
  assert.match(migration, /WHERE \(v_role = 'superadmin' OR COALESCE\(request\.library_id, book\.library_id\) = v_library_id\)/);
});

test('postflight validates all function metadata and ACLs', () => {
  // Postflight should check internal function ownership, search_path, and no grants
  assert.match(migration, /FOR v_signature IN\s+SELECT oid::regprocedure FROM pg_catalog\.pg_proc/);
  assert.match(migration, /proname IN \(\s*'get_fine_payment_dashboard_detail_internal',/);
  assert.match(migration, /p\.proowner = 'postgres'::regrole/);
  assert.match(migration, /p\.proconfig = ARRAY\['search_path=""'\]::text\[\]/);

  // Postflight should check internal functions have no EXECUTE grants to any role
  assert.match(migration, /IF pg_catalog\.has_function_privilege\('anon', v_signature, 'EXECUTE'\)/);
  assert.match(migration, /Internal function % has unexpected EXECUTE grants/);

  // Postflight should check wrapper function ownership, search_path, and grants
  assert.match(migration, /proname IN \(\s*'get_fine_payment_dashboard',/);

  // Postflight should check analytics function ownership, search_path, and grants (including service_role)
  assert.match(migration, /v_signature := 'public\.get_fine_payment_analytics\(text\)'::regprocedure;/);
  assert.match(migration, /v_acl_count <> 2/);
  assert.match(migration, /pg_catalog\.has_function_privilege\('service_role', v_signature, 'EXECUTE'\)/);
});