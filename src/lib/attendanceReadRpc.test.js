import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migration = readFileSync(
  new URL('../../supabase/migrations/20270102002000_attendance_read_rpc_hardening.sql', import.meta.url),
  'utf8'
);
const storeSource = readFileSync(
  new URL('../data/store.js', import.meta.url),
  'utf8'
);

test('attendance read RPC migration enforces server-side authz, AAL2, scope, and least privilege', () => {
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.get_attendance_logs_v1\(\)/);
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.get_visitor_attendance_logs_v1\(/);
  assert.match(migration, /SECURITY DEFINER/);
  assert.match(migration, /SET search_path = ''/);
  assert.match(migration, /Authenticated session required/);
  assert.match(migration, /AAL2 authentication is required for staff attendance access/);
  assert.match(migration, /staff\.role = v_role/);
  assert.match(migration, /AND staff\.is_active IS TRUE/);
  assert.match(migration, /Authorized staff role required/);
  assert.match(migration, /Staff library scope is required/);
  assert.match(migration, /visitor\.otp_verified IS TRUE\s+AND visitor\.is_active IS TRUE/);
  assert.match(migration, /WHERE log\.library_id::text = v_staff_library/);
  assert.match(migration, /WHERE log\.visitor_id::text = v_visitor_id/);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.get_attendance_logs_v1\(\) FROM PUBLIC, anon;/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.get_attendance_logs_v1\(\) TO authenticated, service_role;/);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.get_visitor_attendance_logs_v1\(integer, timestamptz, text, timestamptz, timestamptz, text\) FROM PUBLIC, anon;/);
});

test('store attendance reads use scoped RPCs instead of direct attendance_logs table reads', () => {
  assert.match(storeSource, /supabase\.rpc\('get_attendance_logs_v1'\)/);
  assert.match(storeSource, /supabase\.rpc\('get_visitor_attendance_logs_v1'/);
  assert.doesNotMatch(storeSource, /\.from\('attendance_logs'\)/);
  assert.match(storeSource, /Server-side scoped RPCs enforce role, AAL2 \(staff\), ownership, and library/);
});