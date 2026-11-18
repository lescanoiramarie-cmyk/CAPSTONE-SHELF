import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
  buildFinePaymentAnalyticsArgs,
  FINE_PAYMENT_ANALYTICS_FIELDS,
  FINE_PAYMENT_ANALYTICS_RPC,
  sanitizeFinePaymentAnalyticsRows,
} from './finePaymentAnalytics.js';

test('frontend calls the aggregate RPC with the exact PostgREST argument name and text value', () => {
  assert.equal(FINE_PAYMENT_ANALYTICS_RPC, 'get_fine_payment_analytics');
  assert.deepEqual(buildFinePaymentAnalyticsArgs('branch-17'), { p_library_id: 'branch-17' });
  assert.deepEqual(buildFinePaymentAnalyticsArgs(null), { p_library_id: null });
  assert.deepEqual(buildFinePaymentAnalyticsArgs(17), { p_library_id: '17' });
});

test('frontend aggregate row contract contains no visitor or transaction identifiers', () => {
  assert.deepEqual(FINE_PAYMENT_ANALYTICS_FIELDS, [
    'report_kind', 'period_month', 'branch_id', 'branch_name',
    'fines_assessed', 'fines_collected', 'outstanding_balance',
    'paid_request_count', 'partially_paid_request_count', 'unpaid_request_count',
    'cash_collected', 'bank_transfer_collected', 'other_collected',
  ]);
  assert.equal(FINE_PAYMENT_ANALYTICS_FIELDS.some((field) => /visitor|request_id|payment_id|reference|note/i.test(field)), false);
  assert.deepEqual(sanitizeFinePaymentAnalyticsRows([{
    report_kind: 'summary',
    fines_collected: 10,
    visitor_id: 'must-not-be-retained',
    payment_id: 'must-not-be-retained',
    reference: 'must-not-be-retained',
  }]), [{ report_kind: 'summary', fines_collected: 10 }]);
});

test('final function migration preserves the text argument, aggregate return fields, and staff AAL2 checks', async () => {
  const migrationUrl = new URL('../../supabase/migrations/20270102000500_fine_analytics_count_types.sql', import.meta.url);
  const migration = await readFile(fileURLToPath(migrationUrl), 'utf8');
  const functionStart = migration.indexOf('CREATE OR REPLACE FUNCTION public.get_fine_payment_analytics(p_library_id text DEFAULT NULL)');
  assert.notEqual(functionStart, -1);
  const returnStart = migration.indexOf('RETURNS TABLE (', functionStart);
  const returnEnd = migration.indexOf('\n)', returnStart);
  const declaredFields = [...migration.slice(returnStart, returnEnd).matchAll(/^\s*([a-z_]+)\s+/gm)].map((match) => match[1]);
  assert.deepEqual(declaredFields, FINE_PAYMENT_ANALYTICS_FIELDS);
  const functionBody = migration.slice(functionStart);
  assert.match(functionBody, /auth\.jwt\(\).*aal|aal.*auth\.jwt\(\)/is);
  assert.match(functionBody, /staff\.is_active\s+IS\s+TRUE/i);
  assert.match(functionBody, /app_metadata/i);
  assert.match(functionBody, /role claim does not match/i);
  assert.match(functionBody, /subadmin.*superadmin|superadmin.*subadmin/is);

  const grantMigrationUrl = new URL('../../supabase/migrations/20270102000700_fine_payment_rpc_authorization.sql', import.meta.url);
  const grantMigration = await readFile(fileURLToPath(grantMigrationUrl), 'utf8');
  assert.match(grantMigration, /REVOKE ALL ON FUNCTION public\.get_fine_payment_analytics\(text\)\s+FROM PUBLIC, anon, authenticated, service_role/i);
  assert.match(grantMigration, /GRANT EXECUTE ON FUNCTION public\.get_fine_payment_analytics\(text\) TO authenticated/i);
});