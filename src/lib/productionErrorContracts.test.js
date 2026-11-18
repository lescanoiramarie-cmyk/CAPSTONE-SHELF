import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const bookReviewPrivacy = read('../../supabase/migrations/20270102000300_book_reviews_privacy.sql');
const bookReviewTable = read('../../supabase/schemas/public/tables/book_reviews.sql');
const roleDefinition = read('../../supabase/migrations/20270102002700_critical_rpcs_for_direct_access.sql');
const roleHardening = read('../../supabase/migrations/20270103000200_fix_get_current_user_role.sql');
const roleClaimHardening = read('../../supabase/migrations/20270118000000_fail_closed_attendance_lookup_role_claim.sql');
const store = read('../data/store.js');
const visitorAccounts = read('../data/visitorAccounts.js');
const authContext = read('../context/AuthContext.jsx');
const visitorLogin = read('../../supabase/functions/login-with-lockout/index.ts');

test('book review RPC owner UPDATE grant only names columns in the current schema snapshot', () => {
  const tableDefinition = bookReviewTable.match(/CREATE TABLE[^;]+;/i)?.[0];
  assert.ok(tableDefinition, 'book_reviews table snapshot is present');
  const columns = new Set(
    [...tableDefinition.matchAll(/^\s*"([a-z_][a-z0-9_]*)"\s+/gim)].map((match) => match[1])
  );
  const grant = bookReviewPrivacy.match(
    /GRANT UPDATE\s*\(([^)]+)\)\s*ON TABLE public\.book_reviews/i
  );
  assert.ok(grant, 'RPC owner keeps a column-scoped UPDATE grant');
  const grantedColumns = grant[1].split(',').map((column) => column.trim());
  assert.deepEqual(grantedColumns, ['rating', 'comment']);
  assert.ok(grantedColumns.every((column) => columns.has(column)));
  assert.equal(columns.has('updated_at'), false, 'snapshot has no updated_at column');
});

test('book review save RPCs never write the absent updated_at column', () => {
  const migrations = [
    bookReviewPrivacy,
    read('../../supabase/migrations/20270102000400_rpc_owner_auth_claim_access.sql'),
    read('../../supabase/migrations/20270102001100_attendance_claims_review_labels_and_table_acl.sql'),
    read('../../supabase/migrations/20270103001000_review_eligibility_enforcement.sql'),
  ];
  for (const sql of migrations) {
    const updates = [...sql.matchAll(/UPDATE public\.book_reviews AS review\s+SET([\s\S]*?)WHERE review\.id/gi)];
    for (const update of updates) {
      assert.match(update[1], /rating\s*=/i);
      assert.match(update[1], /comment\s*=/i);
      assert.doesNotMatch(update[1], /updated_at\s*=/i);
    }
  }
});

test('frontend role RPC calls match the secured zero-argument database signature', () => {
  for (const sql of [roleDefinition, roleHardening]) {
    assert.match(sql, /CREATE FUNCTION public\.get_current_user_role\(\)/);
    assert.match(sql, /RETURNS TABLE\s*\([\s\S]*?user_type text[\s\S]*?role text[\s\S]*?is_active boolean/);
    assert.match(sql, /REVOKE ALL ON FUNCTION public\.get_current_user_role\(\) FROM PUBLIC, anon/);
    assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.get_current_user_role\(\) TO authenticated, service_role/);
    assert.match(sql, /NOTIFY pgrst, 'reload schema'/);
  }
  assert.match(store, /supabase\.rpc\('get_current_user_role'\)/);
  assert.match(visitorAccounts, /supabase\.rpc\('get_current_user_role'\)/);
  assert.doesNotMatch(store, /supabase\.rpc\('get_current_user_role',\s*\{/);
  assert.doesNotMatch(visitorAccounts, /supabase\.rpc\('get_current_user_role',\s*\{/);
});

test('role resolution failure stops protected attendance loading and concurrent callers share one lookup', () => {
  const scopeStart = store.indexOf('async function getAuthenticatedDataScope()');
  const scopeEnd = store.indexOf('\n}\n', scopeStart);
  const scopeHelper = store.slice(scopeStart, scopeEnd);
  const attendanceStart = store.indexOf('export async function fetchAttendanceLogs()');
  const attendanceEnd = store.indexOf('\n}\n', attendanceStart);
  const attendanceHelper = store.slice(attendanceStart, attendanceEnd);
  assert.match(scopeHelper, /authenticatedDataScopeRequests\.get\(accessToken\)/);
  assert.match(scopeHelper, /supabase\.auth\.getSession\(\)/);
  assert.match(scopeHelper, /authenticatedDataScopeRequests\.delete\(accessToken\)/);
  assert.match(scopeHelper, /if \(roleError\)\s*\{\s*throw cleanErr\(roleError, 'Unable to resolve the current user role\.'/);
  assert.match(attendanceHelper, /const scope = await getAuthenticatedDataScope\(\)/);
  assert.ok(attendanceHelper.indexOf('await getAuthenticatedDataScope()') < attendanceHelper.indexOf("supabase.rpc('get_attendance_logs_v1')"));
  assert.match(authContext, /reportClientError\('Staff login failed\.'\)/);
});

test('visitor password login request fields and account gates remain explicit and logs are sanitized', () => {
  assert.match(store, /functions\.invoke\(\s*'login-with-lockout',[\s\S]*?email: normalizeEmail\(normalizedIdentifier\),[\s\S]*?password: normalizedPassword/);
  assert.match(visitorLogin, /if \(!email \|\| !password\)[\s\S]*?Email and password are required/);
  assert.match(visitorLogin, /signInWithPassword\(\{\s*email,\s*password/);
  assert.match(visitorLogin, /Invalid email or password/);
  assert.doesNotMatch(visitorLogin, /console\.(?:error|warn)\([^\n]*(?:error|Error|password|email)/i);
  assert.match(authContext, /reportClientError\('Visitor login attempt failed\.'\)/);
  assert.match(store, /visitor\.otp_verified !== true/);
  assert.match(store, /communityApprovalPending/);
  assert.match(store, /qrCode:\s*communityApprovalPending \? null : visitor\.qr_code/);
});

test('latest staff role-claim migration retains exact fail-closed guards', () => {
  assert.match(roleClaimHardening, /v_jwt_role IS DISTINCT FROM v_staff\.role/);
  assert.match(roleClaimHardening, /pg_catalog\.lower\(pg_catalog\.btrim\(v_jwt_role\)\) IS DISTINCT FROM v_role/);
  assert.match(roleClaimHardening, /COALESCE\\\(v_jwt_role, v_staff_role\\\) <> v_staff_role/);
  assert.match(roleClaimHardening, /old_count = 1 AND new_count = 0/);
  assert.match(roleClaimHardening, /Unexpected role-claim guard/);
});
