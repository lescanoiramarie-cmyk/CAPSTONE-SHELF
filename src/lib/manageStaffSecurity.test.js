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
  assert.match(manageStaffSource, /callerProfile\.role !== authData\.user\.app_metadata\?\.role/);
});

test('manage-staff Edge Function rejects self-targeting and Super Admin escalation', () => {
  assert.match(manageStaffSource, /userId === authData\.user\.id \|\| userId === EXISTING_SUPERADMIN_ID/);
  assert.match(manageStaffSource, /profile\?\.role === ['"]superadmin['"]/);
  assert.match(manageStaffSource, /Super Admin accounts cannot be modified through this endpoint/);
  assert.match(manageStaffSource, /Super Admin accounts cannot be deactivated through this endpoint/);
  assert.match(manageStaffSource, /Super Admin accounts cannot be deleted through this endpoint/);
});

test('manage-staff Edge Function checks target user profile and sanitizes DB errors before mutation', () => {
  assert.match(manageStaffSource, /function sanitizeDbError\(message: string\)/);
  assert.match(manageStaffSource, /sanitizeDbError\(profileError\.message\)/);
  assert.match(manageStaffSource, /if \(!profile \|\| profile\.role !== ['"]subadmin['"]\)/);
});

test('manage-staff provides all CRUD operations and compensates failed multi-system updates', () => {
  for (const operation of ['create', 'update', 'delete', 'set-active']) {
    assert.match(manageStaffSource, new RegExp(`body\\.operation === ['"]${operation}['"]`));
  }
  assert.match(manageStaffSource, /Restore the database profile if updating Auth fails/);
  assert.match(manageStaffSource, /account status update failed and could not be rolled back/);
});
