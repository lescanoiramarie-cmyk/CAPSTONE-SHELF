import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  normalizeVisitorRegistrationType,
  validateVisitorRegistrationEmail,
} from './visitorRegistration.js';

test('community visitors may use valid personal email domains with a selected library', () => {
  for (const email of ['reader@gmail.com', 'reader@yahoo.com', 'reader@outlook.com']) {
    assert.equal(validateVisitorRegistrationEmail(email, 'community', null), '');
  }
});

test('institutional registration still enforces the selected library domain', () => {
  assert.equal(validateVisitorRegistrationEmail('person@school.example', 'institutional', 'school.example'), '');
  assert.equal(validateVisitorRegistrationEmail('person@dept.school.example', 'institutional', '@school.example'), '');
  assert.match(validateVisitorRegistrationEmail('person@gmail.com', 'institutional', 'school.example'), /selected partner library domain/);
  assert.match(validateVisitorRegistrationEmail('person@school.example.evil', 'institutional', 'school.example'), /selected partner library domain/);
});

test('registration types fail closed for unsupported values', () => {
  assert.equal(normalizeVisitorRegistrationType('COMMUNITY'), 'community');
  assert.equal(normalizeVisitorRegistrationType('staff'), null);
  assert.match(validateVisitorRegistrationEmail('reader@gmail.com', 'staff', 'school.example'), /registration type/);
});

test('invalid email is rejected for either registration type', () => {
  assert.match(validateVisitorRegistrationEmail('bad-email', 'community', null), /valid email/);
  assert.match(validateVisitorRegistrationEmail('bad-email', 'institutional', 'school.example'), /valid email/);
});

test('forward migration keeps community access pending until verified librarian approval', () => {
  const migrationPath = new URL('../../supabase/migrations/20270102001700_public_community_visitor_registration.sql', import.meta.url);
  const migration = readFileSync(fileURLToPath(migrationPath), 'utf8');
  assert.match(migration, /CASE WHEN v_type = 'community' THEN 'pending' ELSE 'approved' END/i);
  assert.match(migration, /v_type <> 'community'/i);
  assert.match(migration, /is_active = CASE WHEN v_type = 'community' THEN false ELSE visitor\.is_active END/i);
  assert.match(migration, /v_metadata\s*->>\s*'role'\s+IS\s+DISTINCT\s+FROM\s+'visitor'/i);
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.approve_community_visitor/i);
  assert.match(migration, /auth\.jwt\(\)\s*->>\s*'aal'[\s\S]*'aal2'/i);
  assert.match(migration, /Visitors cannot approve their own accounts/i);
  assert.match(migration, /public\.is_active_staff_for_branch\(v_visitor\.library_id::text\)/i);
  assert.match(migration, /Use the community visitor approval action for pending accounts/i);
  assert.match(migration, /v_profile_library_id\s+IS\s+DISTINCT\s+FROM\s+p_library_id/i);
  assert.match(migration, /does not match the original registration request/i);
  assert.doesNotMatch(migration, /UPDATE public\.visitors AS visitor\s+SET library_id = p_library_id/i);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.approve_community_visitor\(text\) TO authenticated/i);
});

test('pending community visitor is the only inactive visitor allowed to read its own status row', () => {
  const migration = readFileSync(fileURLToPath(new URL('../../supabase/migrations/20270102001700_public_community_visitor_registration.sql', import.meta.url)), 'utf8');
  assert.match(migration, /auth_user_id\s*=\s*auth\.uid\(\)\s+AND\s+otp_verified\s+IS\s+TRUE[\s\S]*is_active\s+IS\s+TRUE\s+OR\s*\(registration_type\s*=\s*'community'\s+AND\s+approval_status\s*=\s*'pending'\)/i);
  assert.match(migration, /registration_type\s*=\s*'community'\s+AND\s+v_visitor\.approval_status\s*=\s*'pending'[\s\S]*v_qr\s*:=\s*v_visitor\.qr_code/i);
});