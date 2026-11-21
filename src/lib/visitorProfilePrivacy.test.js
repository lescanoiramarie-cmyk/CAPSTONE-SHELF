import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const migration = readFileSync(
  new URL('../../supabase/migrations/20270205000000_pending_visitor_status_privacy.sql', import.meta.url),
  'utf8',
);
const store = readFileSync(new URL('../data/store.js', import.meta.url), 'utf8');
const pendingPage = readFileSync(new URL('../pages/visitor/CommunityVisitorPending.jsx', import.meta.url), 'utf8');
const visitorAccounts = readFileSync(new URL('../data/visitorAccounts.js', import.meta.url), 'utf8');
const authContext = readFileSync(new URL('../context/AuthContext.jsx', import.meta.url), 'utf8');
const registration = readFileSync(new URL('../pages/visitor/VisitorRegister.jsx', import.meta.url), 'utf8');
const communityRegistrationSqlTest = readFileSync(
  new URL('../../supabase/tests/public_community_visitor_registration.sql', import.meta.url),
  'utf8',
);

test('pending visitor reads are column-restricted and the direct pending-row policy is removed', () => {
  assert.match(migration, /REVOKE SELECT ON TABLE public\.visitors FROM PUBLIC, anon, authenticated/);
  assert.match(migration, /REVOKE SELECT \(%s\) ON TABLE public\.visitors FROM PUBLIC, anon, authenticated/);
  assert.match(migration, /GRANT SELECT \(id, auth_user_id, otp_verified, is_active, library_id, approval_status\)/);
  assert.doesNotMatch(migration, /GRANT SELECT \([^)]*\b(?:email|full_name|address|qr_code|profile_image_path)\b/i);
  assert.match(migration, /approval_status = 'approved'\s+AND is_active IS TRUE/);
  assert.doesNotMatch(migration, /approval_status = 'pending'\s+AND is_active IS FALSE/);
});

test('community registration SQL regression test matches the final pending-row privacy policy', () => {
  const policyAssertions = communityRegistrationSqlTest.match(
    /IF NOT \(SELECT relation\.relrowsecurity[\s\S]*?THEN/,
  )?.[0] || '';
  assert.ok(policyAssertions);
  assert.match(policyAssertions, /approval_status[^\n]*''approved''/);
  assert.match(policyAssertions, /v_policy_using ~\* 'approval_status[\s\S]*''pending''/);
  assert.match(policyAssertions, /regexp_count\(v_policy_using, 'approval_status', 1, 'i'\) <> 1/);
  assert.doesNotMatch(policyAssertions, /institutional|community/);
});

test('pending status RPC uses only auth.uid and returns no visitor identifier or private profile fields', () => {
  const statusRpc = migration.match(
    /CREATE OR REPLACE FUNCTION public\.get_my_visitor_approval_status\(\)([\s\S]*?)\$function\$;/,
  )?.[0] || '';
  assert.ok(statusRpc);
  assert.match(statusRpc, /registration_type text,\s+approval_status text,\s+otp_verified boolean,\s+is_active boolean/);
  assert.match(statusRpc, /WHERE visitor\.auth_user_id = auth\.uid\(\)/);
  assert.match(statusRpc, /Email verification is required/);
  assert.match(statusRpc, /visitor\.otp_verified IS TRUE/);
  assert.doesNotMatch(statusRpc, /p_visitor_id|visitor\.email|visitor\.full_name|visitor\.qr_code/);
  assert.match(statusRpc, /SECURITY DEFINER[\s\S]*SET search_path = ''/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.get_my_visitor_approval_status\(\)\s+TO authenticated/);
});

test('full visitor profile access remains available only through approved and active paths', () => {
  assert.match(migration, /get_visitor_profile\(\)[\s\S]*?approval_status IS DISTINCT FROM 'approved'[\s\S]*?is_active IS NOT TRUE/);
  assert.match(migration, /get_my_visitor_profile_v2\(\)[\s\S]*?approval_status IS DISTINCT FROM 'approved'[\s\S]*?is_active IS NOT TRUE/);
  assert.doesNotMatch(migration, /v_visitor\.(?:profile_image_url|created_at|updated_at|status|visitor_type)/);
  assert.match(store, /get_my_visitor_profile_v2/);
  assert.match(store, /getAuthenticatedVisitorForSession[\s\S]*?get_my_visitor_approval_status[\s\S]*?get_my_visitor_profile_v2/);
  assert.match(authContext, /if \(approvalPending\) \{[\s\S]*?return null/);
});

test('staff profile listing remains read-only, AAL2, and branch-scoped', () => {
  const listRpc = migration.match(
    /CREATE OR REPLACE FUNCTION public\.list_visitor_accounts_v2\([\s\S]*?\$function\$;/,
  )?.[0] || '';
  assert.ok(listRpc);
  assert.match(listRpc, /auth\.jwt\(\) ->> 'aal'.*'aal2'/);
  assert.match(listRpc, /public\.is_active_staff_for_branch/);
  assert.match(listRpc, /staff\.library_id/);
  assert.match(listRpc, /app_metadata.*role/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.list_visitor_accounts_v2[\s\S]*?TO authenticated/);
  assert.match(visitorAccounts, /list_visitor_accounts_v2/);
  assert.doesNotMatch(visitorAccounts, /\.from\('visitors'\)/);
});

test('pending page uses status RPC only and preserves an information-only no-session state', () => {
  assert.match(pendingPage, /supabase\.auth\.getSession\(\)/);
  assert.match(pendingPage, /supabase\.auth\.getUser\(\)/);
  assert.match(pendingPage, /if \(!session\?\.user\?\.id\)[\s\S]*setStatus\('information'\)/);
  assert.match(pendingPage, /get_my_visitor_approval_status/);
  assert.doesNotMatch(pendingPage, /\.from\('visitors'\)|useSearchParams|visitor_id/);
  assert.doesNotMatch(pendingPage, /pendingInfo\.email/);
});

test('pending OTP responses and registration UI do not expose an active QR pass', () => {
  assert.match(migration, /v_visitor\.approval_status = 'pending'[\s\S]*v_qr := NULL/);
  assert.match(migration, /RETURN QUERY SELECT v_visitor\.id::text, NULL::text, NULL::text, NULL::text, NULL::text/);
  assert.doesNotMatch(registration, /QRCodeSVG|qrPassValue/);
  assert.match(registration, /active QR pass will become available only after approval/);
});
