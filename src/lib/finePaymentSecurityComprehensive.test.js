import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const fineUiSource = readFileSync(
  new URL('../component/FinePayments.jsx', import.meta.url),
  'utf8'
);
const fineAnalyticsHelper = readFileSync(
  new URL('../lib/finePaymentAnalytics.js', import.meta.url),
  'utf8'
);
const cohortHardeningMigration = readFileSync(
  new URL('../../supabase/migrations/20270103000100_fine_payment_internal_hardening_and_cohort_protection.sql', import.meta.url),
  'utf8'
);

test('Sub Admin sees only authorized branch data and Super Admin sees only aggregate analytics in frontend', () => {
  // Super Admin path exclusively calls FINE_PAYMENT_ANALYTICS_RPC and clears individual rows
  const superAdminStart = fineUiSource.indexOf('if (isSuperAdmin)');
  const superAdminBranch = fineUiSource.slice(superAdminStart, superAdminStart + 1000);
  assert.ok(superAdminBranch, 'Super Admin check exists in FinePayments.jsx');
  assert.match(superAdminBranch, /supabase\.rpc\(\s*FINE_PAYMENT_ANALYTICS_RPC/);
  assert.match(superAdminBranch, /setRows\(\[\]\)/);
  assert.match(superAdminBranch, /return;/);

  // Sub Admin path exclusively calls branch-scoped get_fine_payment_dashboard
  const subAdminBranch = fineUiSource.slice(superAdminStart);
  assert.match(subAdminBranch, /supabase\.rpc\('get_fine_payment_dashboard'/);
  assert.match(subAdminBranch, /supabase\.rpc\('get_fine_payment_alert_targets'/);
});

test('aggregate analytics return fields strictly exclude PII and transaction identifiers', () => {
  const returnTable = cohortHardeningMigration.match(
    /CREATE OR REPLACE FUNCTION public\.get_fine_payment_analytics\([\s\S]*?RETURNS TABLE \(([\s\S]*?)\)\s*LANGUAGE/i
  )?.[1];
  assert.ok(returnTable, 'get_fine_payment_analytics return table definition exists');

  // Forbidden fields that would expose individual borrowers or loans
  assert.doesNotMatch(returnTable, /\bvisitor_id\b|\bvisitor_name\b|\brequest_id\b|\bborrow_request_id\b|\bbook_title\b|\bpayment_id\b|\breference_number\b/i);

  // Allowed aggregate metrics
  assert.match(returnTable, /\breport_kind text\b/);
  assert.match(returnTable, /\bperiod_month date\b/);
  assert.match(returnTable, /\bbranch_id text\b/);
  assert.match(returnTable, /\bbranch_name text\b/);
  assert.match(returnTable, /\bfines_assessed numeric\b/);
  assert.match(returnTable, /\bfines_collected numeric\b/);
  assert.match(returnTable, /\boutstanding_balance numeric\b/);
  assert.match(returnTable, /\bpaid_request_count bigint\b/);
  assert.match(returnTable, /\bpartially_paid_request_count bigint\b/);
  assert.match(returnTable, /\bunpaid_request_count bigint\b/);
  assert.match(returnTable, /\bcash_collected numeric\b/);
  assert.match(returnTable, /\bbank_transfer_collected numeric\b/);
  assert.match(returnTable, /\bother_collected numeric\b/);

  // Client helper also freezes permitted fields
  assert.match(fineAnalyticsHelper, /FINE_PAYMENT_ANALYTICS_FIELDS/);
  assert.doesNotMatch(fineAnalyticsHelper, /visitor_id|visitor_name|request_id/);
});

test('small-cohort suppression (threshold >= 3) prevents inferential reconstruction of private borrower records', () => {
  // Threshold constant definition
  assert.match(cohortHardeningMigration, /v_min_cohort constant int := 3;/);

  // Branch-level cohort suppression
  assert.match(cohortHardeningMigration, /branch_request_counts AS \([\s\S]*?HAVING count\(\*\) >= v_min_cohort/);
  assert.match(cohortHardeningMigration, /JOIN branch_request_counts brc ON brc\.library_id = d\.library_id/);

  // Monthly breakdown cohort suppression
  assert.match(cohortHardeningMigration, /monthly_cohort AS \([\s\S]*?HAVING count\(DISTINCT request\.id\) >= v_min_cohort/);
  assert.match(cohortHardeningMigration, /JOIN monthly_cohort mc/);
});

test('internal detail functions are completely revoked and wrapper functions require AAL2 and role match', () => {
  // Internal functions have EXECUTE revoked from all roles
  for (const fn of ['get_fine_payment_dashboard_detail_internal', 'get_fine_payment_alert_targets_detail_internal']) {
    assert.match(
      cohortHardeningMigration,
      new RegExp(`REVOKE ALL ON FUNCTION public\\.${fn}\\(text\\)\\s+FROM PUBLIC, anon, authenticated, service_role;`, 'i')
    );
  }

  // Wrapper functions require AAL2 MFA and matching active staff role
  for (const fn of ['get_fine_payment_dashboard', 'get_fine_payment_analytics']) {
    const fnDef = cohortHardeningMigration.match(new RegExp(`CREATE OR REPLACE FUNCTION public\\.${fn}[\\s\\S]*?\\$function\\$;`, 'i'))?.[0];
    assert.ok(fnDef, `${fn} function definition is present`);
    assert.match(fnDef, /COALESCE\((?:v_jwt|auth\.jwt\(\)) ->> 'aal', 'aal1'\) <> 'aal2'/);
    assert.match(fnDef, /(?:v_jwt -> 'app_metadata' ->> 'role'|v_jwt_role) IS DISTINCT FROM v_role/);
  }
});
