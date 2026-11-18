import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const finePayments = readFileSync(new URL('../component/FinePayments.jsx', import.meta.url), 'utf8');
const fineAnalytics = readFileSync(new URL('../lib/finePaymentAnalytics.js', import.meta.url), 'utf8');
const migration = readFileSync(new URL('../../supabase/migrations/20270102000100_fine_payment_privacy.sql', import.meta.url), 'utf8');
const migration007 = readFileSync(new URL('../../supabase/migrations/20270102000700_fine_payment_rpc_authorization.sql', import.meta.url), 'utf8');

test('super-admin fine UI uses aggregate analytics RPC and never requests individual dashboard rows', () => {
  assert.match(finePayments, /if \(isSuperAdmin\)/);
  assert.match(finePayments, /FINE_PAYMENT_ANALYTICS_RPC/);
  assert.match(finePayments, /setRows\(\[\]\)/, 'super-admin path must clear individual rows');
  assert.match(finePayments, /sanitizeFinePaymentAnalyticsRows/);
  assert.doesNotMatch(finePayments, /get_fine_payment_dashboard_detail_internal/);
});

test('fine analytics contract is aggregate-only in client and SQL', () => {
  assert.equal(fineAnalytics.includes('visitor_name'), false);
  assert.equal(fineAnalytics.includes('request_id'), false);
  assert.equal(fineAnalytics.includes('payment_id'), false);
  assert.equal(fineAnalytics.includes('reference_number'), false);
  assert.match(fineAnalytics, /FINE_PAYMENT_ANALYTICS_FIELDS = Object\.freeze\(/);

  const start001 = migration.search(/CREATE(?: OR REPLACE)? FUNCTION public\.get_fine_payment_analytics/i);
  assert.ok(start001 >= 0, 'analytics RPC definition missing in migration 001');
  const after001 = migration.slice(start001);
  const revoke001 = /\nREVOKE ALL ON FUNCTION public\.get_fine_payment_analytics/i.exec(after001);
  const analytics001 = revoke001 ? after001.slice(0, revoke001.index) : after001;

  const returns001 = analytics001.match(/RETURNS TABLE\s*\(([\s\S]*?)\)\s*LANGUAGE/i)?.[1] || '';
  assert.ok(returns001, 'analytics RETURNS TABLE missing in migration 001');
  assert.doesNotMatch(
    returns001,
    /visitor_name|visitor_id|request_id|payment_id|\bpayments\b|reference_number|\bnote\b|book_title/i
  );
  assert.match(returns001, /report_kind/i);
  assert.match(returns001, /fines_assessed|fines_collected|outstanding_balance/i);
  assert.match(analytics001, /SECURITY DEFINER/i);
  assert.match(analytics001, /AAL2/i);
  assert.match(analytics001, /v_jwt_role IS DISTINCT FROM v_role|role claim does not match/i);

  // Migration 007 preserves analytics as the only Super Admin fine read (aggregate-only)
  // and must not broaden its grants; it legitimately adds Sub-Admin detailed RPCs.
  assert.match(migration007, /get_fine_payment_analytics[\s\S]*aggregate/i);
  assert.doesNotMatch(migration007, /CREATE(?: OR REPLACE)? FUNCTION public\.get_fine_payment_analytics/i);
  assert.match(migration007, /REVOKE ALL ON FUNCTION public\.get_fine_payment_analytics\(text\)/i);
  assert.match(migration007, /GRANT EXECUTE ON FUNCTION public\.get_fine_payment_analytics\(text\) TO authenticated/i);
  assert.doesNotMatch(migration007, /GRANT EXECUTE ON FUNCTION public\.get_fine_payment_analytics[^\n]*TO\s+(PUBLIC|anon)/i);
});