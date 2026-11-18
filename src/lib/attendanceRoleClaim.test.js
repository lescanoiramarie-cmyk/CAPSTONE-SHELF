import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const migration = readFileSync(
  new URL('../../supabase/migrations/20270102000900_attendance_role_claim_fail_closed.sql', import.meta.url),
  'utf8'
);
const securityMigration = readFileSync(
  new URL('../../supabase/migrations/20270102001100_attendance_claims_review_labels_and_table_acl.sql', import.meta.url),
  'utf8'
);
const storeSource = readFileSync(new URL('../data/store.js', import.meta.url), 'utf8');
const bookTransactionsSource = readFileSync(new URL('../component/BookTransactions.jsx', import.meta.url), 'utf8');

test('attendance claim hardening covers both privileged RPC overloads and fails closed on missing roles', () => {
  assert.match(migration, /public\.find_visitor_by_qr\(text,uuid\)'::regprocedure/);
  assert.match(migration, /public\.toggle_attendance\(text,text\)'::regprocedure/);
  assert.match(migration, /IS DISTINCT FROM v_role/);
  assert.match(migration, /old_count = 1 AND new_count = 0/);
  assert.match(migration, /old_count = 0 AND new_count = 1/);
  assert.match(migration, /Unexpected role-claim guard/);
});

test('attendance QR identification stays on the protected v2 and toggle RPCs, not QR login', () => {
  assert.match(storeSource, /'lookup_attendance_visitor_v2'/);
  assert.match(storeSource, /'toggle_attendance'/);
  assert.match(storeSource, /SHELF-QR-\(\?:\[0-9\]\{6\}\|\[0-9A-F\]\{32\}\)/i);
  assert.doesNotMatch(storeSource, /visitor-qr-login/);
  assert.match(bookTransactionsSource, /findVisitorByQr\(code, libraryId\)/);
});

test('shared attendance SELECT helpers require an exact supported JWT role claim', () => {
  const activeHelperStart = securityMigration.indexOf(
    'CREATE OR REPLACE FUNCTION public.is_active_staff_for_branch'
  );
  const superadminHelperStart = securityMigration.indexOf(
    'CREATE OR REPLACE FUNCTION public.is_shelf_superadmin'
  );
  const reviewsStart = securityMigration.indexOf(
    'CREATE OR REPLACE FUNCTION public.get_book_reviews'
  );
  const activeHelper = securityMigration.slice(activeHelperStart, superadminHelperStart);
  const superadminHelper = securityMigration.slice(superadminHelperStart, reviewsStart);

  assert.match(securityMigration, /CREATE OR REPLACE FUNCTION public\.is_active_staff_for_branch/);
  assert.match(securityMigration, /CREATE OR REPLACE FUNCTION public\.is_shelf_superadmin/);
  assert.match(activeHelper, /staff\.role IN \('superadmin', 'subadmin'\)/);
  assert.match(activeHelper, /auth\.jwt\(\) -> 'app_metadata' ->> 'role' IS NOT NULL/);
  assert.match(activeHelper, /auth\.jwt\(\) -> 'app_metadata' ->> 'role' = staff\.role/);
  assert.doesNotMatch(activeHelper, /coalesce\(/);
  assert.match(superadminHelper, /auth\.jwt\(\) -> 'app_metadata' ->> 'role' IS NOT NULL/);
  assert.match(superadminHelper, /auth\.jwt\(\) -> 'app_metadata' ->> 'role' = 'superadmin'/);
  assert.doesNotMatch(superadminHelper, /coalesce\(/);
});