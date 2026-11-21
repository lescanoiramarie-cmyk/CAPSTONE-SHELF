import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const migration1700 = readFileSync(new URL('../../supabase/migrations/20270102001700_public_community_visitor_registration.sql', import.meta.url), 'utf8');
const migration1900 = readFileSync(new URL('../../supabase/migrations/20270102001900_visitor_otp_delivery_hardening.sql', import.meta.url), 'utf8');
const migration20270204 = readFileSync(new URL('../../supabase/migrations/20270204000000_institutional_visitor_librarian_approval.sql', import.meta.url), 'utf8');
const privacyMigration = readFileSync(new URL('../../supabase/migrations/20270205000000_pending_visitor_status_privacy.sql', import.meta.url), 'utf8');
const attendanceSecurity = readFileSync(new URL('../../supabase/migrations/20270101000000_attendance_security_hardening.sql', import.meta.url), 'utf8');
const authContext = readFileSync(new URL('../context/AuthContext.jsx', import.meta.url), 'utf8');
const store = readFileSync(new URL('../data/store.js', import.meta.url), 'utf8');
const visitorAccounts = readFileSync(new URL('../data/visitorAccounts.js', import.meta.url), 'utf8');
const visitorLogin = readFileSync(new URL('../pages/visitor/VisitorLogin.jsx', import.meta.url), 'utf8');
const accountManagement = readFileSync(new URL('../component/VisitorAccountManagement.jsx', import.meta.url), 'utf8');
const visitorRegistration = readFileSync(new URL('../lib/visitorRegistration.js', import.meta.url), 'utf8');
const app = readFileSync(new URL('../App.jsx', import.meta.url), 'utf8');
const pendingPage = readFileSync(new URL('../pages/visitor/CommunityVisitorPending.jsx', import.meta.url), 'utf8');

test('visitor lifecycle: pending approval page does not require an app visitor session', () => {
  assert.match(
    app,
    /path="\/visitor\/pending-approval"\s+element={<CommunityVisitorPending\s*\/>}\s*\/>/,
  );

  assert.match(pendingPage, /supabase\.auth\.getUser\(\)/);
  assert.match(pendingPage, /get_my_visitor_approval_status/);
  assert.ok(
    pendingPage.indexOf('supabase.auth.getUser()') <
      pendingPage.indexOf('get_my_visitor_approval_status'),
  );
  assert.doesNotMatch(pendingPage, /\.from\('visitors'\)|pendingInfo\.email/);
  assert.doesNotMatch(pendingPage, /to="\/catalog"/);
  assert.match(pendingPage, /authorized librarian/i);
});

test('visitor lifecycle: both pending visitor types cannot create active visitor sessions', () => {
  assert.match(migration20270204, /false,\s+NULL,\s+NEW\.id,\s+false,\s+v_library_id,\s+v_type,\s+'pending'/);
  assert.match(migration20270204, /v_profile_approval IS DISTINCT FROM 'pending'[\s\S]*v_profile_active IS DISTINCT FROM false[\s\S]*v_profile_otp_verified IS DISTINCT FROM false/);
  assert.match(store, /status\.approval_status === 'pending'[\s\S]*status\.is_active !== false/);
  assert.match(store, /approvalPending: true,\s+registrationType: status\.registration_type/);
  assert.match(store, /get_my_visitor_approval_status/);
  assert.match(authContext, /const approvalPending = visitor\.approvalPending === true/);
  assert.match(authContext, /if \(approvalPending\) \{/);
  assert.match(authContext, /return null/);
  assert.doesNotMatch(authContext, /pending_visitor_id/);
  assert.match(visitorLogin, /navigate\('\/visitor\/pending-approval'\)/);
});

test('visitor lifecycle: inactive visitor blocked from login and protected workflows', () => {
  // loginVisitor checks is_active and throws for inactive (non-pending) visitors
  assert.match(store, /status\.approval_status !== 'approved' \|\| status\.is_active !== true/);

  // Profile refresh in AuthContext validates isActive and logs out if deactivated
  // (pending community visitors don't have sessions, so this only applies to deactivated active visitors)
  assert.match(authContext, /visitor\.isActive === false/);
  assert.match(authContext, /clearClientSessionState/);
});

test('visitor lifecycle: unverified visitor (otp_verified=false) cannot gain active access', () => {
  // loginVisitor requires otp_verified === true
  assert.match(store, /status\.otp_verified !== true/);
  assert.match(store, /Please verify your email before logging in/);

  // Passkey and password login share the identity-bound status check.
  assert.match(store, /fetchVisitorForPasskey[\s\S]*?getAuthenticatedVisitorForSession/);

  // Profile refresh validates otpVerified
  assert.match(authContext, /visitor\.otpVerified !== true/);
  assert.match(authContext, /clearClientSessionState/);

  // Pending status access is identity-bound and full profile access is gated.
  assert.match(privacyMigration, /WHERE visitor\.auth_user_id = auth\.uid\(\)/);
  assert.match(privacyMigration, /An approved, active, email-verified visitor account is required/);
});

test('visitor lifecycle: approved community visitor can access permitted workflows', () => {
  // approve_community_visitor sets is_active = true, approval_status = 'approved', generates QR
  assert.match(migration20270204, /SET approval_status = 'approved'/);
  assert.match(migration20270204, /is_active = true/);
  assert.match(migration20270204, /qr_code = COALESCE\(NULLIF\(visitor\.qr_code, ''\), public\.generate_visitor_qr_code\(\)\)/);

  // After approval, loginVisitor allows access only for approved and active profiles.
  assert.match(store, /status\.approval_status === 'pending'/);
  assert.match(store, /status\.approval_status !== 'approved' \|\| status\.is_active !== true/);

  // createVisitorSession assigns 'visitor' role for approved visitors
  assert.match(authContext, /role: 'visitor'/);
});

test('visitor lifecycle: institutional visitor behavior remains compatible', () => {
  // Existing visitors default to institutional/approved/active
  assert.match(migration1700, /ADD COLUMN IF NOT EXISTS registration_type text NOT NULL DEFAULT 'institutional'/);
  assert.match(migration1700, /ADD COLUMN IF NOT EXISTS approval_status text NOT NULL DEFAULT 'approved'/);
  assert.match(migration20270204, /visitor\.auth_user_id = NEW\.id[\s\S]*IF v_existing_id IS NOT NULL THEN\s+RETURN NEW;/);
  const authLinkFunction = migration20270204.match(/CREATE OR REPLACE FUNCTION public\.link_visitor_auth_user\(\)[\s\S]*?\$function\$;/)?.[0] || '';
  assert.ok(authLinkFunction);
  assert.doesNotMatch(authLinkFunction, /UPDATE public\.visitors/);

  // loginVisitor defaults registrationType to 'institutional' if missing
  assert.match(store, /registrationType: r\.registration_type \|\| 'institutional'/);

  // createVisitorSession defaults registrationType
  assert.match(authContext, /registrationType: visitor\.registrationType \|\| VISITOR_REGISTRATION_TYPES\.INSTITUTIONAL/);
});

test('visitor lifecycle: missing or unknown status values fail closed', () => {
  // Registration type check constraint only allows 'institutional' or 'community'
  assert.match(migration1700, /registration_type.*institutional.*community/);

  // Approval status check constraint only allows 'approved' or 'pending'
  assert.match(migration1700, /approval_status.*approved.*pending/);

  // normalizeVisitorRegistrationType returns null for unknown types (uses Object.values check)
  assert.match(visitorRegistration, /Object\.values\(VISITOR_REGISTRATION_TYPES\)\.includes\(type\)/);
  assert.match(visitorRegistration, /\.includes\(type\)\s*\?\s*type\s*:\s*null/);

  // validateVisitorRegistrationEmail rejects unknown registration types
  assert.match(visitorRegistration, /Select a valid visitor registration type/);
});

test('visitor lifecycle: visitor A cannot load visitor B profile', () => {
  assert.match(privacyMigration, /WHERE visitor\.auth_user_id = auth\.uid\(\)/);
  assert.match(store, /get_my_visitor_profile_v2/);
  assert.match(store, /\[visitor\.id, visitor\.auth_user_id\]\.some/);

  // VisitorAccountManagement uses RPCs that enforce branch scoping
  assert.match(visitorAccounts, /approve_visitor/);
  assert.match(visitorAccounts, /set_visitor_active/);
  assert.match(visitorAccounts, /list_visitor_accounts_v2/);
});

test('visitor lifecycle: cross-library approval denied', () => {
  // approve_community_visitor checks is_active_staff_for_branch(visitor.library_id)
  assert.match(migration20270204, /public\.is_active_staff_for_branch\(v_visitor\.library_id::text\)/);
  assert.match(migration20270204, /You are not authorized to approve visitors for this library/);

  // set_visitor_active also enforces branch scoping
  assert.match(migration20270204, /public\.is_active_staff_for_branch\(v_visitor\.library_id::text\)/);
  assert.match(migration20270204, /You are not authorized to update this visitor account/);

  // register_visitor_v2 prevents moving existing visitor to another branch
  assert.match(migration20270204, /v_profile_library_id IS DISTINCT FROM p_library_id/);
  assert.match(migration20270204, /The visitor profile does not match the original pending registration request/);
});

test('visitor lifecycle: QR eligibility changes only after valid approval', () => {
  assert.match(privacyMigration, /v_visitor\.approval_status = 'pending'[\s\S]*v_qr := NULL/);
  assert.match(privacyMigration, /IF COALESCE\(v_visitor\.otp_verified, false\)[\s\S]*NULL::text, NULL::text, NULL::text, NULL::text/);

  // approve_community_visitor generates QR if missing
  assert.match(migration20270204, /qr_code = COALESCE\(NULLIF\(visitor\.qr_code, ''\), public\.generate_visitor_qr_code\(\)\)/);

  assert.match(accountManagement, /visitor\.otpVerified === true\s+&& visitor\.isActive === false/);
  const visitorRegister = readFileSync(new URL('../pages/visitor/VisitorRegister.jsx', import.meta.url), 'utf8');
  assert.doesNotMatch(visitorRegister, /QRCodeSVG|qrPassValue/);
  assert.match(visitorRegister, /active QR pass will become available only after approval/);
  assert.doesNotMatch(visitorAccounts, /qr_code/);
  assert.match(attendanceSecurity, /visitor\.is_active IS TRUE[\s\S]*visitor\.otp_verified IS TRUE/);

  // createVisitorSession passes qrCode through
  assert.match(authContext, /qrCode: visitor\.qrCode/);
});

test('visitor lifecycle: self-approval denied', () => {
  // approve_community_visitor checks visitor.auth_user_id <> auth.uid()
  assert.match(migration20270204, /v_visitor\.auth_user_id = auth\.uid\(\)/);
  assert.match(migration20270204, /Visitors cannot approve their own accounts/);
});

test('visitor lifecycle: approval requires AAL2 staff session', () => {
  // approve_community_visitor requires auth.jwt() ->> 'aal' = 'aal2'
  assert.match(migration20270204, /auth\.jwt\(\) ->> 'aal'[\s\S]*'aal2'/);
  assert.match(migration20270204, /A verified AAL2 staff session is required/);

  assert.match(migration20270204, /auth\.jwt\(\) ->> 'aal'[\s\S]*'aal2'/);
  assert.match(migration20270204, /A verified AAL2 staff session is required/);
});

test('visitor lifecycle: approval requires verified email (otp_verified=true)', () => {
  // approve_community_visitor checks otp_verified IS TRUE
  assert.match(migration20270204, /v_visitor\.otp_verified IS NOT TRUE/);
  assert.match(migration20270204, /Only an email-verified inactive pending visitor can be approved/);
});

test('visitor lifecycle: duplicate or replayed approval prevented', () => {
  // approve_community_visitor checks registration_type = 'community' AND approval_status = 'pending'
  assert.match(migration20270204, /v_visitor\.registration_type NOT IN \('institutional', 'community'\)[\s\S]*v_visitor\.approval_status IS DISTINCT FROM 'pending'/);
  assert.match(migration20270204, /The visitor approval state changed/);

  assert.match(migration20270204, /p_is_active IS TRUE AND v_visitor\.approval_status = 'pending'/);
  assert.match(migration20270204, /Use the visitor approval action for pending accounts/);
});

test('visitor lifecycle: registration nonce prevents replay', () => {
  // register_visitor_v2 validates registration_nonce matches
  assert.match(migration1700, /v_metadata ->> 'registration_nonce' IS DISTINCT FROM p_registration_nonce/);
  assert.match(migration1700, /A matching visitor registration proof is required/);

  // consume_visitor_registration_send_proof marks nonce as consumed
  assert.match(migration1900, /registration_otp_send_consumed_at IS NULL/);
  assert.match(migration1900, /SET registration_otp_send_consumed_at = pg_catalog.now\(\)/);
});

test('visitor lifecycle: recovery flow does not disclose visitor existence', () => {
  // request_visitor_otp_recovery uses generic message regardless of account existence
  assert.match(migration1900, /If an unverified registration exists for that address, a new verification code will be sent/);

  // issue_visitor_recovery_capability returns no data if no matching unverified visitor
  assert.match(migration1900, /IF v_visitor\.id IS NULL THEN\s+RETURN;/);
});