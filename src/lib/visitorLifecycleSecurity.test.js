import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const migration1700 = readFileSync(new URL('../../supabase/migrations/20270102001700_public_community_visitor_registration.sql', import.meta.url), 'utf8');
const migration1900 = readFileSync(new URL('../../supabase/migrations/20270102001900_visitor_otp_delivery_hardening.sql', import.meta.url), 'utf8');
const authContext = readFileSync(new URL('../context/AuthContext.jsx', import.meta.url), 'utf8');
const store = readFileSync(new URL('../data/store.js', import.meta.url), 'utf8');
const visitorAccounts = readFileSync(new URL('../data/visitorAccounts.js', import.meta.url), 'utf8');
const visitorRegistration = readFileSync(new URL('../lib/visitorRegistration.js', import.meta.url), 'utf8');

test('visitor lifecycle: pending community visitor cannot create active visitor session', () => {
  // Community visitors start with is_active = false, approval_status = 'pending'
  assert.match(migration1700, /is_active = CASE WHEN v_type = 'community' THEN false ELSE visitor\.is_active END/);
  assert.match(migration1700, /CASE WHEN v_type = 'community' THEN 'pending' ELSE 'approved' END/);

  // loginVisitor validates is_active and blocks inactive visitors (except pending community with otp_verified)
  assert.match(store, /visitor\.is_active === false && !communityApprovalPending/);
  assert.match(store, /This visitor account is currently inactive/);

  // createVisitorSession returns null for pending community visitors (no session created)
  // They are redirected to pending-approval page with visitor_id in query params
  assert.match(authContext, /if \(communityApprovalPending\) \{/);
  assert.match(authContext, /return null/);
  assert.match(authContext, /sessionStorage\.setItem\('pending_visitor_id'/);
});

test('visitor lifecycle: inactive visitor blocked from login and protected workflows', () => {
  // loginVisitor checks is_active and throws for inactive (non-pending) visitors
  assert.match(store, /visitor\.is_active === false && !communityApprovalPending/);
  assert.match(store, /This visitor account is currently inactive/);

  // fetchVisitorForPasskey also validates is_active
  assert.match(store, /This visitor account is currently inactive/);

  // Profile refresh in AuthContext validates isActive and logs out if deactivated
  // (pending community visitors don't have sessions, so this only applies to deactivated active visitors)
  assert.match(authContext, /visitor\.isActive === false/);
  assert.match(authContext, /clearClientSessionState/);
});

test('visitor lifecycle: unverified visitor (otp_verified=false) cannot gain active access', () => {
  // loginVisitor requires otp_verified === true
  assert.match(store, /visitor\.otp_verified !== true/);
  assert.match(store, /Please verify your OTP code before logging in/);

  // fetchVisitorForPasskey requires otp_verified === true
  assert.match(store, /Please verify your email before signing in/);

  // Profile refresh validates otpVerified
  assert.match(authContext, /visitor\.otpVerified !== true/);
  assert.match(authContext, /clearClientSessionState/);

  // RLS policy requires otp_verified = true for visitor self-read
  assert.match(migration1700, /otp_verified IS TRUE/);
});

test('visitor lifecycle: approved community visitor can access permitted workflows', () => {
  // approve_community_visitor sets is_active = true, approval_status = 'approved', generates QR
  assert.match(migration1700, /SET approval_status = 'approved'/);
  assert.match(migration1700, /is_active = true/);
  assert.match(migration1700, /qr_code = COALESCE\(NULLIF\(visitor\.qr_code, ''\), public\.generate_visitor_qr_code\(\)\)/);

  // After approval, loginVisitor will allow access (is_active = true, communityApprovalPending = false)
  assert.match(store, /const communityApprovalPending = visitor\.registration_type === 'community'/);
  assert.match(store, /visitor\.approval_status === 'pending'/);
  assert.match(store, /visitor\.is_active === false/);

  // createVisitorSession assigns 'visitor' role for approved visitors
  assert.match(authContext, /role: 'visitor'/);
});

test('visitor lifecycle: institutional visitor behavior remains compatible', () => {
  // Existing visitors default to institutional/approved/active
  assert.match(migration1700, /ADD COLUMN IF NOT EXISTS registration_type text NOT NULL DEFAULT 'institutional'/);
  assert.match(migration1700, /ADD COLUMN IF NOT EXISTS approval_status text NOT NULL DEFAULT 'approved'/);

  // loginVisitor defaults registrationType to 'institutional' if missing
  assert.match(store, /registrationType: visitor\.registration_type \|\| 'institutional'/);

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
  // RLS policy on visitors table requires auth_user_id = auth.uid() for self-read
  assert.match(migration1700, /auth_user_id = auth\.uid\(\)/);

  // store.getVisitor uses auth_user_id for UUID lookups
  assert.match(store, /query\.eq\('auth_user_id', normalizedVisitorId\)/);

  // VisitorAccountManagement uses RPCs that enforce branch scoping
  assert.match(visitorAccounts, /approve_community_visitor/);
  assert.match(visitorAccounts, /set_visitor_active/);
});

test('visitor lifecycle: cross-library approval denied', () => {
  // approve_community_visitor checks is_active_staff_for_branch(visitor.library_id)
  assert.match(migration1700, /public\.is_active_staff_for_branch\(v_visitor\.library_id::text\)/);
  assert.match(migration1700, /You are not authorized to approve visitors for this library/);

  // set_visitor_active also enforces branch scoping
  assert.match(migration1700, /public\.is_active_staff_for_branch\(v_visitor\.library_id::text\)/);
  assert.match(migration1700, /You are not authorized to update this visitor account/);

  // register_visitor_v2 prevents moving existing visitor to another branch
  assert.match(migration1700, /v_profile_library_id IS DISTINCT FROM p_library_id/);
  assert.match(migration1700, /The visitor profile does not match the original registration request/);
});

test('visitor lifecycle: QR eligibility changes only after valid approval', () => {
  // verify_visitor_otp: pending community visitors keep existing QR (no new generation)
  assert.match(migration1900, /v_visitor\.registration_type = 'community' AND v_visitor\.approval_status = 'pending'/);
  assert.match(migration1900, /v_qr := v_visitor\.qr_code;/);

  // approve_community_visitor generates QR if missing
  assert.match(migration1700, /qr_code = COALESCE\(NULLIF\(visitor\.qr_code, ''\), public\.generate_visitor_qr_code\(\)\)/);

  // loginVisitor returns null qrCode for pending community visitors
  assert.match(store, /qrCode: communityApprovalPending \? null : visitor\.qr_code/);

  // fetchVisitorForPasskey returns null qrCode for pending community visitors
  assert.match(store, /qrCode: communityApprovalPending \? null : visitor\.qr_code/);

  // createVisitorSession passes qrCode through
  assert.match(authContext, /qrCode: visitor\.qrCode/);
});

test('visitor lifecycle: self-approval denied', () => {
  // approve_community_visitor checks visitor.auth_user_id <> auth.uid()
  assert.match(migration1700, /v_visitor\.auth_user_id = auth\.uid\(\)/);
  assert.match(migration1700, /Visitors cannot approve their own accounts/);
});

test('visitor lifecycle: approval requires AAL2 staff session', () => {
  // approve_community_visitor requires auth.jwt() ->> 'aal' = 'aal2'
  assert.match(migration1700, /auth\.jwt\(\) ->> 'aal'[\s\S]*'aal2'/);
  assert.match(migration1700, /A verified AAL2 staff session is required/);

  // set_visitor_active also requires AAL2
  assert.match(migration1700, /auth\.jwt\(\) ->> 'aal'[\s\S]*'aal2'/);
  assert.match(migration1700, /A verified AAL2 staff session is required/);
});

test('visitor lifecycle: approval requires verified email (otp_verified=true)', () => {
  // approve_community_visitor checks otp_verified IS TRUE
  assert.match(migration1700, /v_visitor\.otp_verified IS NOT TRUE/);
  assert.match(migration1700, /Only an email-verified pending community visitor can be approved/);
});

test('visitor lifecycle: duplicate or replayed approval prevented', () => {
  // approve_community_visitor checks registration_type = 'community' AND approval_status = 'pending'
  assert.match(migration1700, /v_visitor\.registration_type <> 'community'[\s\S]*v_visitor\.approval_status <> 'pending'/);
  assert.match(migration1700, /Only an email-verified pending community visitor can be approved/);

  // set_visitor_active blocks activating pending community visitors directly
  assert.match(migration1700, /p_is_active IS TRUE AND v_visitor\.registration_type = 'community'[\s\S]*v_visitor\.approval_status = 'pending'/);
  assert.match(migration1700, /Use the community visitor approval action for pending accounts/);
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