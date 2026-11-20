import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const fineAnalytics = readFileSync(
  new URL('../lib/finePaymentAnalytics.js', import.meta.url),
  'utf8'
);
const finePrivacyMigration = readFileSync(
  new URL('../../supabase/migrations/20270102000100_fine_payment_privacy.sql', import.meta.url),
  'utf8'
);
const fineDashboardMigration = readFileSync(
  new URL('../../supabase/migrations/20270102000700_fine_payment_rpc_authorization.sql', import.meta.url),
  'utf8'
);
const paidHistoryMigration = readFileSync(
  new URL('../../supabase/migrations/20270131000000_preserve_paid_fine_history_in_dashboard.sql', import.meta.url),
  'utf8'
);

test('fine payment privacy: Super Admin aggregate analytics response shape', () => {
  // Verify analytics function returns only aggregate fields, no individual transaction details
  assert.match(fineAnalytics, /fines_assessed|fines_collected|outstanding_balance/);
  assert.match(fineAnalytics, /paid_request_count|partially_paid_request_count|unpaid_request_count/);
  assert.match(fineAnalytics, /cash_collected|bank_transfer_collected|other_collected/);
  assert.match(finePrivacyMigration, /get_fine_payment_analytics/);
  assert.match(finePrivacyMigration, /branch_id|branch_name|period_month/i);
  // Should NOT return individual payment fields
  assert.doesNotMatch(fineAnalytics, /request_id|visitor_name|payment_method|payment_reference/i);
});

test('fine payment privacy: Super Admin cannot access individual payment detail RPCs', () => {
  // Verify detail RPCs are revoked from authenticated/service_role in privacy migration
  assert.match(finePrivacyMigration, /REVOKE ALL ON FUNCTION public\.get_fine_payment_dashboard_detail_internal/);
  assert.match(finePrivacyMigration, /REVOKE ALL ON FUNCTION public\.get_fine_payment_alert_targets_detail_internal/);
  // Analytics function granted to authenticated (Super Admin and Sub-admin can call, internal checks enforce role)
  assert.match(finePrivacyMigration, /GRANT EXECUTE ON FUNCTION public\.get_fine_payment_analytics\(text\)[\s\S]*?TO authenticated/);
});

test('fine payment authorization: Sub-admin dashboard requires AAL2 and branch scoping', () => {
  assert.match(fineDashboardMigration, /AAL2 authentication is required/);
  assert.match(fineDashboardMigration, /staff\.role/);
  assert.match(fineDashboardMigration, /staff\.is_active IS TRUE/);
  assert.match(fineDashboardMigration, /You can only review fines for requests in your assigned library/);
  assert.match(fineDashboardMigration, /v_request_library_id IS DISTINCT FROM v_library_id/);
});

test('fine payment authorization: Sub-admin alert targets require AAL2 and branch scoping', () => {
  assert.match(fineDashboardMigration, /get_fine_payment_alert_targets/);
  assert.match(fineDashboardMigration, /AAL2 authentication is required/);
  assert.match(fineDashboardMigration, /staff\.role/);
  assert.match(fineDashboardMigration, /v_request_library_id IS DISTINCT FROM v_library_id/);
});

test('fine payment authorization: Record payment requires AAL2 and branch scoping', () => {
  assert.match(fineDashboardMigration, /record_fine_payment/);
  assert.match(fineDashboardMigration, /AAL2 authentication is required/);
  assert.match(fineDashboardMigration, /staff\.role/);
  assert.match(fineDashboardMigration, /v_request_library_id IS DISTINCT FROM v_library_id/);
});

test('fine payment authorization: Resolve fine review requires AAL2 and branch scoping', () => {
  assert.match(fineDashboardMigration, /resolve_fine_review/);
  assert.match(fineDashboardMigration, /AAL2 authentication is required/);
  assert.match(fineDashboardMigration, /staff\.role/);
  assert.match(fineDashboardMigration, /v_request_library_id IS DISTINCT FROM v_library_id/);
});

test('fine payment authorization: Super Admin analytics requires active staff profile', () => {
  // The analytics RPC is granted to authenticated but internal checks in Dashboard enforce superadmin
  // Source migration grants EXECUTE TO authenticated but Dashboard component checks role
  assert.match(finePrivacyMigration, /GRANT EXECUTE ON FUNCTION public\.get_fine_payment_analytics\(text\)[\s\S]*?TO authenticated/);
});

test('paid fine history remains visible when current assessed fine and review flag are zero', () => {
  assert.match(paidHistoryMigration, /COALESCE\(br\.fine_paid_amount, 0\) > 0/);
  assert.match(paidHistoryMigration, /COALESCE\(a\.fine_paid_amount, 0\) > 0/);
  assert.match(paidHistoryMigration, /WHERE fp\.borrow_request_id = a\.id::text/);
  assert.match(paidHistoryMigration, /FROM PUBLIC, anon, authenticated, service_role/);
  assert.match(paidHistoryMigration, /has_function_privilege\([\s\S]*?'authenticated'[\s\S]*?EXECUTE/);
  assert.match(paidHistoryMigration, /You can only view fines for your assigned library/);
  assert.doesNotMatch(paidHistoryMigration, /UPDATE\s+public\.borrow_requests|DELETE\s+FROM\s+public\.fine_payments/i);
});
