import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const reviewMigration = readFileSync(
  new URL('../../supabase/migrations/20270102000300_book_reviews_privacy.sql', import.meta.url),
  'utf8'
);
const reviewHardeningMigration = readFileSync(
  new URL('../../supabase/migrations/20270102001100_attendance_claims_review_labels_and_table_acl.sql', import.meta.url),
  'utf8'
);
const sqlAssertions = readFileSync(
  new URL('../../supabase/tests/security_hardening_assertions.sql', import.meta.url),
  'utf8'
);
const opacSource = readFileSync(new URL('../component/OPACCatalog.jsx', import.meta.url), 'utf8');

test('review UI uses safe read and save RPCs instead of direct raw table access', () => {
  assert.match(opacSource, /rpc\('get_book_reviews'/);
  assert.match(opacSource, /rpc\('save_my_book_review'/);
  assert.doesNotMatch(opacSource, /from\(['"]book_reviews['"]\)/);
  assert.match(opacSource, /review\.is_own === true/);
});

test('review migration binds writes to the verified session visitor and revokes direct access', () => {
  assert.match(reviewMigration, /RETURNS TABLE \([\s\S]*?visitor_name text[\s\S]*?is_own boolean/);
  assert.match(reviewMigration, /REVOKE ALL ON TABLE public\.book_reviews FROM PUBLIC, anon, authenticated/);
  assert.match(reviewMigration, /visitor\.auth_user_id = public\.shelf_rpc_request_uid\(\)[\s\S]*?visitor\.otp_verified IS TRUE[\s\S]*?visitor\.is_active IS TRUE/);
  assert.match(reviewMigration, /AND review\.visitor_id = v_visitor_id/);
  assert.match(reviewMigration, /visitor_name text/);
  assert.match(reviewMigration, /CREATE FUNCTION public\.delete_my_book_review\(p_review_id uuid\)/);
  assert.match(reviewMigration, /DELETE FROM public\.book_reviews AS review[\s\S]*?AND review\.visitor_id = v_visitor_id/);
  assert.match(reviewMigration, /GRANT EXECUTE ON FUNCTION public\.get_book_reviews\(text, integer, integer\)[\s\S]*?TO anon, authenticated, service_role/);
  assert.match(reviewMigration, /GRANT EXECUTE ON FUNCTION public\.save_my_book_review\(text, integer, text\)[\s\S]*?TO authenticated/);
});

test('public and saved review responses use a generic reader label', () => {
  assert.match(reviewHardeningMigration, /'Verified Reader'::text/);
  assert.match(reviewHardeningMigration, /CREATE OR REPLACE FUNCTION public\.get_book_reviews/);
  assert.match(reviewHardeningMigration, /CREATE OR REPLACE FUNCTION public\.save_my_book_review/);
  assert.doesNotMatch(reviewHardeningMigration, /left\(.*visitor_name|Anonymous Visitor|\*\*\*/);
  assert.match(opacSource, /review\.visitor_name \|\| 'Verified Reader'/);
});

test('table grants retain only required catalog operations and rollback-only role-claim assertions cover edge cases', () => {
  assert.match(reviewHardeningMigration, /REVOKE ALL PRIVILEGES ON TABLE public\.books FROM PUBLIC, anon, authenticated/);
  assert.match(reviewHardeningMigration, /GRANT SELECT ON TABLE public\.books TO anon, authenticated/);
  assert.match(reviewHardeningMigration, /GRANT INSERT, DELETE ON TABLE public\.books TO authenticated/);
  assert.match(reviewHardeningMigration, /GRANT UPDATE \(total_copies, available_copies, call_number\)/);
  assert.match(reviewHardeningMigration, /REVOKE ALL PRIVILEGES ON TABLE public\.staff_profiles FROM PUBLIC, anon, authenticated/);
  assert.match(reviewHardeningMigration, /GRANT SELECT ON TABLE public\.staff_profiles TO authenticated/);
  assert.match(sqlAssertions, /missing app_metadata\.role/);
  assert.match(sqlAssertions, /null app_metadata\.role/);
  assert.match(sqlAssertions, /valid exact role claim/);
  assert.match(sqlAssertions, /mismatched app_metadata\.role/);
  assert.match(sqlAssertions, /ROLLBACK;/);
});