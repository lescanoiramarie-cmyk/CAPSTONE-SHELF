import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const sendVisitorOtp = readFileSync(
  new URL('../../supabase/functions/send-visitor-otp/index.ts', import.meta.url),
  'utf8'
);
const requestPasswordReset = readFileSync(
  new URL('../../supabase/functions/request-password-reset/index.ts', import.meta.url),
  'utf8'
);
const loginWithLockout = readFileSync(
  new URL('../../supabase/functions/login-with-lockout/index.ts', import.meta.url),
  'utf8'
);
const sendFineReminder = readFileSync(
  new URL('../../supabase/functions/send-fine-reminder/index.ts', import.meta.url),
  'utf8'
);
const sendDueDateNotifications = readFileSync(
  new URL('../../supabase/functions/send-due-date-notifications/index.ts', import.meta.url),
  'utf8'
);
const manageStaff = readFileSync(
  new URL('../../supabase/functions/manage-staff/index.ts', import.meta.url),
  'utf8'
);
const visitorQrLogin = readFileSync(
  new URL('../../supabase/functions/visitor-qr-login/index.ts', import.meta.url),
  'utf8'
);

test('send-visitor-otp enforces proof/capability issuance, keyed OTP protection, durable intents, and fail-closed delivery', () => {
  assert.match(sendVisitorOtp, /verify_visitor_registration_send_proof/);
  assert.match(sendVisitorOtp, /consume_visitor_registration_send_proof/);
  assert.match(sendVisitorOtp, /consume_visitor_resend_capability/);
  assert.match(sendVisitorOtp, /issue_visitor_recovery_capability/);
  assert.match(sendVisitorOtp, /registrationNonce/);
  assert.match(sendVisitorOtp, /SHELF_OTP_HMAC_SECRET/);
  assert.doesNotMatch(sendVisitorOtp, /Deno\.env\.get\("SUPABASE_SERVICE_ROLE_" \+ "KEY"\) \|\| ""/);
  assert.match(sendVisitorOtp, /hmacSha256Hex/);
  assert.match(sendVisitorOtp, /visitor_otp_delivery_intents/);
  assert.match(sendVisitorOtp, /pending_claim/);
  assert.match(sendVisitorOtp, /provider_submitting/);
  assert.match(sendVisitorOtp, /provider_accepted/);
  assert.match(sendVisitorOtp, /provider_rejected/);
  assert.match(sendVisitorOtp, /ambiguous_timeout/);
  assert.match(sendVisitorOtp, /persisted/);
  assert.match(sendVisitorOtp, /fail closed|could not be confirmed/i);
  assert.match(sendVisitorOtp, /genericRecoveryResponse/);
  // Must not accept anonymous visitor-ID-only OTP requests.
  assert.match(sendVisitorOtp, /!body\?\.visitorId && !body\?\.capability && !body\?\.registrationNonce/);
  assert.match(sendVisitorOtp, /A valid verification request is required/);
  assert.match(sendVisitorOtp, /SHELF_TRUST_PROXY_IP_HEADERS/);
  assert.match(sendVisitorOtp, /SHELF_TRUSTED_CLIENT_IP_HEADER/);
  assert.doesNotMatch(sendVisitorOtp, /req\.headers\.get\(["']x-forwarded-for["']\)/i);
});

test('send-visitor-otp keeps QR email path closed pending authorized caller inventory and avoids PII/audit leakage', () => {
  assert.match(sendVisitorOtp, /type === "qr"/);
  assert.match(sendVisitorOtp, /QR email requests require an authorized caller/);
  assert.match(sendVisitorOtp, /visitor\.otp\.sent/);
  assert.match(sendVisitorOtp, /visitor\.otp\.email_failed/);
  assert.match(sendVisitorOtp, /visitor\.otp\.persist_failed/);
  assert.match(sendVisitorOtp, /visitor\.otp\.delivery_ambiguous/);
  assert.doesNotMatch(sendVisitorOtp, /visitor\.otp\.sent[\s\S]{0,120}email:/);
  assert.doesNotMatch(sendVisitorOtp, /visitor\.otp\.email_failed[\s\S]{0,120}email:/);
  assert.doesNotMatch(sendVisitorOtp, /visitor\.otp\.persist_failed[\s\S]{0,120}email:/);
});

test('send-visitor-otp keeps generic client-facing errors without exposing credentials or OTP values', () => {
  assert.doesNotMatch(sendVisitorOtp, /service role key/i);
  assert.doesNotMatch(sendVisitorOtp, /RESEND_API_KEY is not configured/);
  assert.doesNotMatch(sendVisitorOtp, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(sendVisitorOtp, /Email service is not configured\./);
  assert.match(sendVisitorOtp, /Unable to process email request\./);
});
test('send-visitor-otp delivery state machine and fail-closed transitions are present in source (mocked/source evidence)', () => {
  assert.match(sendVisitorOtp, /casIntent\(admin, intentId, "pending_claim", \{ state: "provider_submitting"/);
  assert.match(sendVisitorOtp, /casIntent\(admin, intentId, "provider_submitting", \{ state: "provider_accepted"/);
  assert.match(sendVisitorOtp, /casIntent\(admin, intentId, "provider_submitting", \{ state: "ambiguous_timeout"/);
  assert.match(sendVisitorOtp, /casIntent\(admin, intentId, "provider_submitting", \{ state: "provider_rejected"/);
  assert.match(sendVisitorOtp, /casIntent\(admin, intentId, \["provider_accepted", "provider_submitting"\], \{ state: "persisted"/);
  assert.match(sendVisitorOtp, /casIntent\(admin, intentId, "provider_accepted", \{ state: "failed", failure_code: "persist_failed"/);
  assert.match(sendVisitorOtp, /invalidate OTP material|otp = null, otp_expires_at = null, otp_last_sent_at = null/i);
  assert.match(sendVisitorOtp, /The verification email could not be confirmed\. Please wait before trying again\./);
});

test('visitor OTP hardening migration enforces keyed fail-closed verify and controlled legacy plaintext transition (source evidence)', () => {
  const migration = readFileSync(new URL('../../supabase/migrations/20270102001900_visitor_otp_delivery_hardening.sql', import.meta.url), 'utf8');
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.shelf_visitor_otp_hmac/);
  assert.match(migration, /app\.settings\.visitor_otp_hmac_secret/);
  assert.match(migration, /IF v_visitor\.otp ~ '\^\[0-9a-f\]\{64\}\$' THEN/);
  assert.match(migration, /v_matches := false; -- fail closed for keyed OTPs/);
  assert.match(migration, /ELSIF v_visitor\.otp ~ '\^\[0-9\]\{6\}\$' THEN/);
  assert.match(migration, /Controlled legacy transition: only pre-existing plaintext OTP rows/);
  assert.match(migration, /consume_visitor_registration_send_proof/);
  assert.match(migration, /registration_otp_send_consumed_at/);
  assert.match(migration, /visitor_otp_resend_capabilities/);
  assert.match(migration, /capability_hash text NOT NULL UNIQUE/);
  assert.match(migration, /consumed_at/);
  assert.match(migration, /expires_at/);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.issue_visitor_recovery_capability/);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.consume_visitor_resend_capability/);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.verify_visitor_registration_send_proof/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.verify_visitor_otp\(text, text\) TO anon, authenticated/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.issue_visitor_resend_capability\(text, text\) TO anon, authenticated/);
});

test('request-password-reset is server-side, enumeration-resistant, and avoids unexpected error leakage (source evidence)', () => {
  assert.match(requestPasswordReset, /issue_password_reset_code/);
  assert.match(requestPasswordReset, /verify_password_reset_code/);
  assert.match(requestPasswordReset, /consume_password_reset_code/);
  assert.match(requestPasswordReset, /If that address belongs to a SHELF account/);
  assert.match(requestPasswordReset, /admin\.auth\.admin\.updateUserById/);
  assert.match(requestPasswordReset, /error: "Unable to process the request\."/);
  assert.doesNotMatch(requestPasswordReset, /error instanceof Error\s*\?\s*error\.message/);
});

test('login-with-lockout performs server-side lockout checks/recording and fails closed on lockout state errors (source evidence)', () => {
  assert.match(loginWithLockout, /check_login_lockout/);
  assert.match(loginWithLockout, /record_login_failure/);
  assert.match(loginWithLockout, /clear_login_failures/);
  assert.match(loginWithLockout, /signInWithPassword/);
  assert.match(loginWithLockout, /Too many failed login attempts/);
  assert.match(loginWithLockout, /Unable to verify login status\. Try again later\./);
});

test('manage-staff requires authenticated AAL2 active superadmin (JWT + DB profile) and uses service role only after checks (source evidence)', () => {
  assert.match(manageStaff, /getAuthenticatorAssuranceLevel/);
  assert.match(manageStaff, /currentLevel !== "aal2"/);
  assert.match(manageStaff, /app_metadata\?\.role !== "superadmin"/);
  assert.match(manageStaff, /callerProfile\.role !== "superadmin"/);
  assert.match(manageStaff, /callerProfile\.is_active !== true/);
  assert.doesNotMatch(manageStaff, /set-password/);
  assert.doesNotMatch(manageStaff, /STAFF_PASSWORD_RESET_SECRET/);
});

test('visitor-qr-login enforces origin/rate-limit/state checks, trusted proxy IP gating, and delegates lockout (source evidence)', () => {
  assert.match(visitorQrLogin, /isAllowedOrigin/);
  assert.match(visitorQrLogin, /consume_visitor_qr_login_attempt/);
  assert.match(visitorQrLogin, /SHELF_TRUST_PROXY_IP_HEADERS/);
  assert.match(visitorQrLogin, /login-with-lockout/);
  assert.match(visitorQrLogin, /otp_verified !== true \|\|[\s\S]*visitor\.is_active !== true/);
  assert.match(visitorQrLogin, /account\.user\.user_metadata\?\.role !== "visitor"/);
});

test('notification edge functions enforce AAL2, exact staff claim/profile, branch scoping, and atomic claim-before-send (source evidence)', () => {
  assert.match(sendFineReminder, /getAuthenticatorAssuranceLevel/);
  assert.match(sendFineReminder, /currentLevel !== "aal2"/);
  assert.match(sendFineReminder, /jwtRole !== role/);
  assert.match(sendFineReminder, /staff\.is_active !== true/);
  assert.match(sendFineReminder, /loanRole === "subadmin"[\s\S]*book\.library_id !== staff\.library_id/);
  assert.match(sendFineReminder, /claimNotification/);
  assert.match(sendFineReminder, /sendWithNotificationClaim/);

  assert.match(sendDueDateNotifications, /getAuthenticatorAssuranceLevel/);
  assert.match(sendDueDateNotifications, /currentLevel !== "aal2"/);
  assert.match(sendDueDateNotifications, /jwtRole !== staffRole/);
  assert.match(sendDueDateNotifications, /staffRole === "subadmin"/);
  assert.match(sendDueDateNotifications, /You can only follow up on loans from your assigned branch/);
  assert.match(sendDueDateNotifications, /claimNotification/);
  assert.match(sendDueDateNotifications, /sendWithNotificationClaim/);
});