import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const manageStaffSource = readFileSync(
  new URL('../../supabase/functions/manage-staff/index.ts', import.meta.url),
  'utf8'
);

test('manage-staff Edge Function contains no unauthenticated backdoor reset', () => {
  assert.doesNotMatch(manageStaffSource, /set-password/);
  assert.doesNotMatch(manageStaffSource, /x-staff-reset-secret/i);
  assert.doesNotMatch(manageStaffSource, /STAFF_PASSWORD_RESET_SECRET/);
  assert.doesNotMatch(manageStaffSource, /resetSecret/);
});

test('manage-staff Edge Function enforces authenticated AAL2 MFA verification', () => {
  assert.match(manageStaffSource, /getAuthenticatorAssuranceLevel/);
  assert.match(manageStaffSource, /currentLevel !== ['"]aal2['"]/);
  assert.match(manageStaffSource, /AAL2 authentication \(MFA\) is required/);
});

test('manage-staff Edge Function verifies both JWT role claim and active database staff profile', () => {
  assert.match(manageStaffSource, /app_metadata\?\.role !== ['"]superadmin['"]/);
  assert.match(manageStaffSource, /callerProfile\.role !== ['"]superadmin['"]/);
  assert.match(manageStaffSource, /callerProfile\.is_active !== true/);
});