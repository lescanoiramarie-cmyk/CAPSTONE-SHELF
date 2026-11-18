import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const reviewReconciliation = read('../../supabase/migrations/20270119000000_reconcile_book_reviews_and_eligibility.sql');
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
  const grant = reviewReconciliation.match(
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
    reviewReconciliation,
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

test('review RPC signatures and result types match the captured production table types', () => {
  const migrations = [
    reviewReconciliation,
  ];
  assert.match(bookReviewTable, /"id"\s+bigint/);
  assert.match(bookReviewTable, /"rating"\s+integer/);
  for (const sql of migrations) {
    for (const functionName of ['get_book_reviews', 'save_my_book_review']) {
      const definition = sql.match(new RegExp(
        `CREATE(?: OR REPLACE)? FUNCTION public\\.${functionName}\\([\\s\\S]*?RETURNS TABLE \\(([\\s\\S]*?)\\)\\s*LANGUAGE`,
        'i'
      ));
      if (definition) {
        assert.match(definition[1], /\bid text\b/);
        assert.match(definition[1], /\brating integer\b/);
        assert.doesNotMatch(definition[1], /\bid (?:uuid|bigint)\b|\brating smallint\b/);
      }
    }
    if (/CREATE(?: OR REPLACE)? FUNCTION public\.save_my_book_review\(/i.test(sql)) {
      assert.match(sql, /v_review_id text;/);
      const saveStart = sql.search(/CREATE(?: OR REPLACE)? FUNCTION public\.save_my_book_review\(/i);
      const saveEnd = sql.indexOf('$function$;', saveStart);
      assert.match(sql.slice(saveStart, saveEnd), /saved\.rating::integer/);
    }
    if (/CREATE(?: OR REPLACE)? FUNCTION public\.delete_my_book_review\(/i.test(sql)) {
      assert.match(sql, /FUNCTION public\.delete_my_book_review\(p_review_id text\)/);
      assert.match(sql, /v_deleted_id text;/);
      assert.doesNotMatch(sql, /CREATE(?: OR REPLACE)? FUNCTION public\.delete_my_book_review\((?:uuid|bigint)\)/i);
    }
  }
});

test('review RPC API remains compatible with UUID/smallint and bigint/integer table variants', () => {
  const initialSchema = read('../../supabase/migrations/20261002000000_security_features.sql');
  assert.match(initialSchema, /create table if not exists public\.book_reviews \([\s\S]*?id uuid primary key[\s\S]*?rating smallint[\s\S]*?unique \(book_id, visitor_id\)/i);
  for (const sql of [reviewReconciliation]) {
    assert.match(sql, /RETURNS TABLE \([\s\S]*?id text[\s\S]*?rating integer/i);
    assert.match(sql, /(?:review|saved)\.id::text/);
    assert.match(sql, /(?:review|saved)\.rating::integer/);
  }
  assert.match(reviewReconciliation, /DROP FUNCTION IF EXISTS public\.delete_my_book_review\(uuid\)/);
  assert.match(reviewReconciliation, /CREATE OR REPLACE FUNCTION public\.get_book_reviews\(/);
  assert.match(reviewReconciliation, /CREATE OR REPLACE FUNCTION public\.save_my_book_review/);
});

test('reconciled review save definition uses the unique key through an atomic upsert', () => {
  const migrations = [
    reviewReconciliation,
  ];
  for (const sql of migrations) {
    const functionStart = sql.search(/CREATE(?: OR REPLACE)? FUNCTION public\.save_my_book_review\(/i);
    assert.notEqual(functionStart, -1, 'review save RPC definition is present');
    const functionEnd = sql.indexOf('$function$;', functionStart);
    const definition = sql.slice(functionStart, functionEnd);
    assert.match(definition, /ON CONFLICT \(book_id, visitor_id\) DO UPDATE/);
    assert.match(definition, /SET rating = EXCLUDED\.rating,[\s\S]*comment = EXCLUDED\.comment/);
    assert.doesNotMatch(definition, /SELECT review\.id INTO v_review_id[\s\S]*?FOR UPDATE/);
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


test('visitor login fail-fast regex captures unconfirmed and inactive visitor states without blocking staff login', () => {
  const failFastMatch = authContext.match(/if\s*\(\s*(\/[^/]+\/[a-z]*)\.test\(\s*visitorLoginMessage\s*\)\s*\)/i);
  assert.ok(failFastMatch, 'fail-fast regex is present in AuthContext');
  const regex = eval(failFastMatch[1]);

  // Outcomes that should fail fast (immediately throw to visitor UI)
  assert.equal(regex.test('Invalid email or password.'), true);
  assert.equal(regex.test('Too many failed login attempts.'), true);
  assert.equal(regex.test('Unable to process login.'), true);
  assert.equal(regex.test('Email has not been confirmed'), true);
  assert.equal(regex.test('Email not confirmed'), true);
  assert.equal(regex.test('Please verify your OTP code before logging in.'), true);
  assert.equal(regex.test('This visitor account is currently inactive.'), true);

  // Staff login outcome that must NOT be blocked, allowing fallback to staff login
  assert.equal(regex.test('This account is not registered as a SHELF visitor.'), false);
  assert.equal(regex.test('Visitor account was not found.'), false);

  // Correlation ID and sanitized diagnostic logging present
  assert.match(authContext, /cidPrefix\s*=\s*cid\s*\?\s*`\[cid:\$\{cid\}\]\s*`\s*:\s*''/);
  assert.match(authContext, /status=\$\{sanitizedStatus\}/);
  assert.doesNotMatch(authContext, /console\.error\([^)]*(?:password|token|code|otp|newPassword)/i);
});
