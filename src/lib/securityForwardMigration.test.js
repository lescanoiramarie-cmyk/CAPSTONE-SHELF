import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migration = readFileSync(
  new URL('../../supabase/migrations/20270102001800_fail_closed_staff_claims_and_handover.sql', import.meta.url),
  'utf8'
);
const sqlAssertions = readFileSync(
  new URL('../../supabase/tests/security_release_assertions.sql', import.meta.url),
  'utf8'
);
const roleAssertions = readFileSync(
  new URL('../../supabase/tests/security_hardening_assertions.sql', import.meta.url),
  'utf8'
);
const auditAssertions = readFileSync(
  new URL('../../supabase/tests/audit_trigger_assertions.sql', import.meta.url),
  'utf8'
);
const communityAssertions = readFileSync(
  new URL('../../supabase/tests/public_community_visitor_registration.sql', import.meta.url),
  'utf8'
);

test('forward hardening migration closes remaining active staff role fallbacks', () => {
  assert.match(migration, /public\.confirm_pickup\(uuid,text\)/);
  assert.match(migration, /public\.confirm_return\(uuid,text\)/);
  assert.match(migration, /v_jwt_role IS DISTINCT FROM v_staff_role/);
  assert.match(migration, /public\.accept_subadmin_terms\(\)/);
  assert.match(migration, /auth\.jwt\(\).*app_metadata.*role.*IS NOT NULL/is);
  assert.match(migration, /CREATE POLICY "staff manage announcements"/);
  assert.match(migration, /public\.is_active_staff_for_branch\(library_id::text\)/);
  assert.doesNotMatch(migration, /COALESCE\(auth\.jwt\(\) -> 'app_metadata' ->> 'role', staff\.role\)/i);
});

test('announcement policy replacement validates the historical baseline and exact final catalog contract', () => {
  for (const expected of [
    'v_policy_count <> 1',
    "policy.polrelid = 'public.announcements'::regclass",
    "policy.polname = 'staff manage announcements'",
    "policy.polcmd = '*'",
    'policy.polpermissive IS TRUE',
    "policy.polroles = ARRAY['authenticated'::regrole::oid]",
    'v_using IS DISTINCT FROM v_check',
    "pg_catalog.regexp_count(v_using, '[[:space:]]and[[:space:]]', 1, 'i') <> 3",
    "pg_catalog.regexp_count(v_using, '[[:space:]]or[[:space:]]', 1, 'i') <> 1",
    "pg_catalog.regexp_count(v_using, '=', 1, 'i') <> 3",
    'refusing to replace an unexpected policy',
    'v_policy_roles IS DISTINCT FROM ARRAY[\'authenticated\'::regrole::oid]',
    'v_policy_command IS DISTINCT FROM \'*\'::"char"',
    'v_policy_permissive IS DISTINCT FROM TRUE',
    'v_policy_using IS DISTINCT FROM v_policy_check',
    "v_using !~* 'is_active_staff_for_branch'",
    "pg_catalog.regexp_count(v_using, 'is_active_staff_for_branch', 1, 'i') <> 1",
  ]) {
    assert.ok(migration.includes(expected), `Missing announcement policy check: ${expected}`);
  }
  assert.match(migration, /v_check IS NULL/);
  assert.match(migration, /v_using !~\* 'is_active_staff_for_branch'/);
  assert.match(migration, /CREATE POLICY "staff manage announcements"[\s\S]*?FOR ALL TO authenticated[\s\S]*?USING[\s\S]*?WITH CHECK/);

  for (const expected of [
    "policy.polrelid = 'public.announcements'::regclass",
    "policy.polname = 'staff manage announcements'",
    "policy.polcmd = '*'",
    'policy.polpermissive IS TRUE',
    "policy.polroles = ARRAY['authenticated'::regrole::oid]",
    'pg_get_expr(policy.polqual, policy.polrelid) IS NOT NULL',
    'pg_get_expr(policy.polwithcheck, policy.polrelid) IS NOT NULL',
    'IS NOT DISTINCT FROM pg_catalog.pg_get_expr(policy.polwithcheck, policy.polrelid)',
    "~ '^(public[.])?is_active_staff_for_branch([a-z_][a-z0-9_]*[.])?library_id::text$'",
  ]) {
    assert.ok(sqlAssertions.includes(expected), `Missing release policy assertion: ${expected}`);
  }
});

test('legacy handover overloads enforce AAL2 and preserve function metadata and grants', () => {
  assert.match(migration, /confirm_pickup\(text,text\)[\s\S]*?confirm_return\(text,text\)/);
  assert.match(migration, /auth\.jwt\(\) ->> ''aal'' IS DISTINCT FROM ''aal2''/);
  assert.match(migration, /v_after_owner IS DISTINCT FROM v_owner/);
  assert.match(migration, /v_after_config IS DISTINCT FROM v_config/);
  assert.match(migration, /v_after_acl IS DISTINCT FROM v_acl/);
  assert.match(migration, /v_after_secdef IS DISTINCT FROM v_secdef/);
  assert.doesNotMatch(migration, /INSERT\s+INTO\s+public\.(visitors|attendance_logs|fine_payments|book_reviews)/i);
  assert.doesNotMatch(migration, /UPDATE\s+public\.(visitors|attendance_logs|fine_payments|book_reviews)/i);
  assert.doesNotMatch(migration, /DELETE\s+FROM\s+public\.(visitors|attendance_logs|fine_payments|book_reviews)/i);
});

test('handover migration validates reviewed baseline metadata and exact direct/effective grants', () => {
  for (const expected of [
    "v_expected_config := ARRAY['search_path=public']::text[]",
    "v_expected_config := ARRAY['search_path=\"\"']::text[]",
    "v_expected_config := ARRAY['search_path=public, pg_temp']::text[]",
    "v_expected_grantees := ARRAY['postgres', 'authenticated']::text[]",
    "v_expected_grantees := ARRAY['postgres', 'authenticated', 'service_role']::text[]",
    "pg_catalog.oidvectortypes",
    "pg_catalog.aclexplode(v_acl)",
    "pg_catalog.has_function_privilege('anon'",
    "pg_catalog.has_function_privilege('authenticated'",
    "pg_catalog.has_function_privilege('service_role'",
    'Function % postflight direct ACL differs',
  ]) {
    assert.ok(migration.includes(expected), `Missing migration baseline check: ${expected}`);
  }
  assert.match(migration, /v_after_volatility IS DISTINCT FROM 'v'::"char"/);
  assert.match(migration, /v_after_return_type IS DISTINCT FROM v_expected_return_type/);
  assert.match(migration, /v_after_config IS DISTINCT FROM v_expected_config/);
});

test('SQL catalog assertions cover attendance, fine privacy, review identity, grants, and defaults', () => {
  for (const required of [
    'public.find_visitor_by_qr(text,uuid)',
    'public.toggle_attendance(text,text)',
    'public.lookup_attendance_visitor_v2(text,text)',
    'public.get_fine_payment_analytics(text)',
    'public.get_fine_payment_dashboard(text)',
    'public.get_fine_payment_alert_targets(text)',
    'public.get_book_reviews(text,integer,integer)',
    'public.save_my_book_review(text,integer,text)',
    'public.delete_my_book_review(text)',
    'pg_default_acl',
    'TRUNCATE',
    'Verified Reader',
  ]) {
    assert.ok(sqlAssertions.includes(required), `Missing SQL assertion coverage: ${required}`);
  }
  for (const expected of [
    "procedure.proowner = 'postgres'::regrole::oid",
    "procedure.prorettype = 'trigger'::regtype::oid",
    'procedure.prosecdef IS TRUE',
    "ARRAY['search_path=pg_catalog, public, pg_temp']::text[]",
    'procedure.proretset IS FALSE',
  ]) {
    assert.ok(auditAssertions.includes(expected), `Missing audit function metadata assertion: ${expected}`);
  }
  for (const expected of [
    "policy_row.polname = 'visitor and staff read scoped visitor profiles'",
    "v_policy_command IS DISTINCT FROM 'r'::\"char\"",
    "v_policy_roles IS DISTINCT FROM ARRAY['authenticated'::pg_catalog.regrole::oid]",
    'v_policy_check IS NOT NULL',
    'is_active_staff_for_branch[[:space:]]*[(]',
    "procedure_row.proowner = 'postgres'::pg_catalog.regrole::oid",
    "ARRAY['search_path=\"\"']::text[]",
    'Signup RPC must have exactly the reviewed owner/anon/authenticated EXECUTE grants.',
    'Community approval RPC must have exactly the reviewed owner/authenticated EXECUTE grants.',
    'pg_catalog.aclexplode(procedure_row.proacl)',
  ]) {
    assert.ok(communityAssertions.includes(expected), `Missing community registration catalog assertion: ${expected}`);
  }
  for (const expected of [
    'public.confirm_pickup(text,text)',
    'public.confirm_return(text,text)',
    'public.confirm_pickup(uuid,text)',
    'public.confirm_return(uuid,text)',
    'public.accept_subadmin_terms()',
    'Handover/terms exact ACL or effective grant mismatch',
    'service_role_execute',
    'policy.polwithcheck',
    "policy.polname = 'book review RPC owner reads reviews'",
    "ARRAY['shelf_book_reviews_rpc_owner'::regrole::oid]",
    "policy.polname = 'book review RPC owner reads visitors'",
    'v_policy_using IS DISTINCT FROM',
    'otp_verified[[:space:]]+IS[[:space:]]+TRUE',
    'is_active[[:space:]]+IS[[:space:]]+TRUE',
    "('anon'::text), ('authenticated')",
    "'public.fine_payments'",
    'Do not assert or alter an existing service_role table ACL here',
    "'service_role', 'public.book_reviews', v_privilege",
  ]) {
    assert.ok(sqlAssertions.includes(expected), `Missing catalog assertion: ${expected}`);
  }
});

test('rollback-only SQL assertions cover role-claim and staff/branch authorization cases', () => {
  for (const expected of [
    'Missing app_metadata.role',
    'null app_metadata.role',
    "ARRAY['', 'visitor']",
    "ARRAY['superadmin', 'SubAdmin', ' subadmin ']",
    'Inactive staff stays denied',
    'valid sub-admin branch/role authorization',
    'AAL1 super-admin passed attendance MFA policy helper',
    'AAL2 super-admin was rejected',
    'UUID pickup did not reject AAL1',
    'UUID return did not reject AAL1',
    'legacy UUID RPC guard',
    'SET LOCAL ROLE service_role',
    'valid AAL2 pickup role was rejected before request lookup',
    'valid AAL2 return role was rejected before request lookup',
    'Unauthorized staff role.',
    'Active staff profile required.',
    'AAL2 authentication is required.',
  ]) {
    assert.ok(roleAssertions.includes(expected), `Missing synthetic SQL assertion case: ${expected}`);
  }
  assert.match(roleAssertions, /ROLLBACK;/);
  assert.match(migration, /public\.confirm_pickup\(uuid,text\)[\s\S]*?IS DISTINCT FROM ''aal2''/);
  assert.match(migration, /public\.confirm_return\(uuid,text\)[\s\S]*?IS DISTINCT FROM ''aal2''/);
});
