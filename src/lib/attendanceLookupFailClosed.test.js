import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const originalMigration = readFileSync(
  new URL('../../supabase/migrations/20270102002200_lookup_attendance_visitor_auth.sql', import.meta.url),
  'utf8'
);
const forwardMigration = readFileSync(
  new URL('../../supabase/migrations/20270118000000_fail_closed_attendance_lookup_role_claim.sql', import.meta.url),
  'utf8'
);

test('attendance lookup currently permits an absent app_metadata role claim', () => {
  assert.match(originalMigration, /IF v_jwt_role IS NOT NULL[\s\S]*?lower\(pg_catalog\.btrim\(v_jwt_role\)\) <> v_role THEN/);
});

test('forward migration changes only the absent-claim guard and fails closed', () => {
  for (const signature of [
    'public.lookup_attendance_visitor_v2(text,text)',
    'public.get_current_user_role()',
    'public.confirm_pickup(text,text)',
    'public.confirm_return(text,text)',
    'public.confirm_return(uuid,text)',
  ]) assert.ok(forwardMigration.includes(`'${signature}'::regprocedure`), `${signature} is covered`);
  assert.match(forwardMigration, /old_count = 1 AND new_count = 0/);
  assert.match(forwardMigration, /old_count = 0 AND new_count = 1/);
  assert.match(forwardMigration, /IS DISTINCT FROM v_role/);
  assert.match(forwardMigration, /IS DISTINCT FROM v_staff_role/);
  assert.match(forwardMigration, /v_jwt_role IS DISTINCT FROM v_staff\.role/);
  assert.match(forwardMigration, /COALESCE\\\(v_jwt_role, v_staff_role\\\)/);
  assert.match(forwardMigration, /Unexpected role-claim guard/);
  assert.match(forwardMigration, /Could not install fail-closed role validation/);
  assert.match(forwardMigration, /pg_get_functiondef\(function_signature\)/);
});

test('missing and mismatched claims both fail the replacement SQL predicate', () => {
  const rejectsClaim = (jwtRole, databaseRole) => jwtRole !== databaseRole;
  assert.equal(rejectsClaim(null, 'subadmin'), true);
  assert.equal(rejectsClaim('superadmin', 'subadmin'), true);
  assert.equal(rejectsClaim('subadmin', 'subadmin'), false);
  assert.match(forwardMigration, /IS DISTINCT FROM v_role/);
});

test('forward migration preserves lookup scope, function metadata, and caller privileges', () => {
  assert.match(originalMigration, /v_role NOT IN \('subadmin', 'superadmin'\)/);
  assert.match(originalMigration, /v_role = 'subadmin'[\s\S]*?v_staff_library_id IS DISTINCT FROM v_library_id/);
  assert.match(originalMigration, /visitor\.otp_verified IS TRUE[\s\S]*?visitor\.is_active IS TRUE/);
  assert.match(originalMigration, /SET search_path = ''/);
  assert.match(originalMigration, /ALTER FUNCTION public\.lookup_attendance_visitor_v2\(text, text\)\s+OWNER TO postgres/);
  assert.match(originalMigration, /GRANT EXECUTE ON FUNCTION public\.lookup_attendance_visitor_v2\(text, text\)[\s\S]*?TO authenticated, service_role/);
  assert.match(forwardMigration, /EXECUTE function_definition/);
  assert.match(forwardMigration, /has_function_privilege\('anon',[\s\S]*?'EXECUTE'\)/);
  assert.match(forwardMigration, /has_function_privilege\('authenticated',[\s\S]*?'EXECUTE'\)/);
  assert.match(forwardMigration, /has_function_privilege\('service_role',[\s\S]*?'EXECUTE'\)/);
  assert.match(forwardMigration, /has_function_privilege\('service_role', 'public\.confirm_pickup\(text,text\)'::regprocedure, 'EXECUTE'\)/);
  assert.match(forwardMigration, /has_function_privilege\('service_role', 'public\.confirm_return\(text,text\)'::regprocedure, 'EXECUTE'\)/);
  assert.match(forwardMigration, /function_signatures regprocedure\[\]/);
  assert.match(forwardMigration, /procedure\.proowner = 'postgres'::regrole/);
  assert.match(forwardMigration, /procedure\.proconfig = ARRAY\['search_path=""'\]::text\[\]/);
});

test('current borrowing and returning definitions contain missing-claim fail-open guards', () => {
  const notifications = readFileSync(
    new URL('../../supabase/migrations/20270103000900_notification_lifecycle_events.sql', import.meta.url),
    'utf8'
  );
  const transaction = readFileSync(
    new URL('../../supabase/migrations/20270102002400_transaction_rpc_hardening.sql', import.meta.url),
    'utf8'
  );
  const roleHelper = readFileSync(
    new URL('../../supabase/migrations/20270103000200_fix_get_current_user_role.sql', import.meta.url),
    'utf8'
  );
  assert.match(notifications, /CREATE OR REPLACE FUNCTION public\.confirm_pickup\([\s\S]*?v_jwt_role IS NOT NULL[\s\S]*?<> v_role/);
  assert.match(notifications, /CREATE OR REPLACE FUNCTION public\.confirm_return\([\s\S]*?v_jwt_role IS NOT NULL[\s\S]*?<> v_role/);
  assert.match(transaction, /CREATE OR REPLACE FUNCTION public\.confirm_return\([\s\S]*?COALESCE\(v_jwt_role, v_staff_role\) <> v_staff_role/);
  assert.match(roleHelper, /COALESCE\(v_jwt_role, v_staff\.role\) <> v_staff\.role/);
});

test('the frontend continues to use the protected attendance lookup RPC', () => {
  const store = readFileSync(new URL('../data/store.js', import.meta.url), 'utf8');
  assert.match(store, /'lookup_attendance_visitor_v2'/);
  assert.doesNotMatch(store, /visitor-qr-login/);
});
