import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const eligibilityMigration = readFileSync(
  new URL('../../supabase/migrations/20270119000000_reconcile_book_reviews_and_eligibility.sql', import.meta.url),
  'utf8'
);

test('save_my_book_review enforces authenticated verified visitor session', () => {
  assert.match(eligibilityMigration, /public\.shelf_rpc_request_uid\(\) IS NULL/);
  assert.match(eligibilityMigration, /A signed-in visitor account is required/);
  assert.match(eligibilityMigration, /visitor\.auth_user_id = public\.shelf_rpc_request_uid\(\)/);
  assert.match(eligibilityMigration, /visitor\.otp_verified IS TRUE/);
  assert.match(eligibilityMigration, /visitor\.is_active IS TRUE/);
  assert.match(eligibilityMigration, /An active, verified visitor profile linked to this session is required/);
});

test('save_my_book_review validates rating bounds', () => {
  assert.match(eligibilityMigration, /p_rating IS NULL OR p_rating < 1 OR p_rating > 5/);
  assert.match(eligibilityMigration, /Rating must be between 1 and 5/);
});

test('save_my_book_review validates book existence', () => {
  assert.match(eligibilityMigration, /SELECT 1 FROM public\.books AS book WHERE book\.id::text = pg_catalog\.btrim\(p_book_id\)/);
  assert.match(eligibilityMigration, /Book not found/);
});

test('save_my_book_review enforces borrow-and-return eligibility for library books', () => {
  assert.match(eligibilityMigration, /FROM public\.borrow_requests AS br/);
  assert.match(eligibilityMigration, /br\.visitor_id = v_visitor_id/);
  assert.match(eligibilityMigration, /br\.book_id = pg_catalog\.btrim\(p_book_id\)/);
  assert.match(eligibilityMigration, /br\.status = 'returned'/);
  assert.match(eligibilityMigration, /br\.return_date IS NOT NULL/);
});

test('save_my_book_review enforces borrow-and-return eligibility for community books', () => {
  assert.match(eligibilityMigration, /FROM public\.community_book_requests AS cbr/);
  assert.match(eligibilityMigration, /cbr\.requester_visitor_id = v_visitor_id/);
  assert.match(eligibilityMigration, /cbr\.book_id = pg_catalog\.btrim\(p_book_id\)/);
  assert.match(eligibilityMigration, /cbr\.status = 'returned'/);
  assert.match(eligibilityMigration, /cbr\.return_date IS NOT NULL/);
});

test('save_my_book_review rejects visitors who have not borrowed and returned the book', () => {
  assert.match(eligibilityMigration, /IF NOT v_eligible THEN/);
  assert.match(eligibilityMigration, /You can only review books you have borrowed and returned/);
});

test('save_my_book_review uses an atomic upsert with the exact unique key', () => {
  assert.match(eligibilityMigration, /INSERT INTO public\.book_reviews \(book_id, visitor_id, visitor_name, rating, comment\)[\s\S]*ON CONFLICT \(book_id, visitor_id\) DO UPDATE[\s\S]*SET rating = EXCLUDED\.rating,[\s\S]*comment = EXCLUDED\.comment[\s\S]*RETURNING book_reviews\.id::text INTO v_review_id/);
  assert.doesNotMatch(eligibilityMigration, /SELECT review\.id INTO v_review_id[\s\S]*?FOR UPDATE/);
});

test('eligibility migration checks duplicate rows before ensuring the exact unique key', () => {
  assert.match(eligibilityMigration, /WHERE visitor_id IS NOT NULL\s+GROUP BY book_id, visitor_id\s+HAVING pg_catalog\.count\(\*\) > 1/);
  assert.match(eligibilityMigration, /Duplicate visitor book reviews exist; resolve them with an approved data plan/);
  assert.match(eligibilityMigration, /ADD CONSTRAINT book_reviews_book_id_visitor_id_key UNIQUE \(book_id, visitor_id\)/);
  assert.match(eligibilityMigration, /array_agg\(attribute_row\.attname::text ORDER BY key_column\.ordinality\)[\s\S]*?ARRAY\['book_id', 'visitor_id'\]::text\[\]/);
  assert.match(eligibilityMigration, /Exact unique constraint on \(book_id, visitor_id\) missing/);
});

test('review RPC owner receives only required eligibility read columns behind owner-only RLS policies', () => {
  assert.match(eligibilityMigration, /NOT rolcanlogin AND NOT rolinherit AND NOT rolbypassrls AND NOT rolsuper/);
  assert.match(eligibilityMigration, /pg_has_role\('authenticated', 'shelf_book_reviews_rpc_owner', 'MEMBER'\)/);
  assert.match(eligibilityMigration, /GRANT SELECT \(visitor_id, book_id, status, return_date\)[\s\S]*ON TABLE public\.borrow_requests TO shelf_book_reviews_rpc_owner/);
  assert.match(eligibilityMigration, /GRANT SELECT \(requester_visitor_id, book_id, status, return_date\)[\s\S]*ON TABLE public\.community_book_requests TO shelf_book_reviews_rpc_owner/);
  assert.match(eligibilityMigration, /ON public\.borrow_requests FOR SELECT TO shelf_book_reviews_rpc_owner\s+USING \(true\)/);
  assert.match(eligibilityMigration, /ON public\.community_book_requests FOR SELECT TO shelf_book_reviews_rpc_owner\s+USING \(true\)/);
  assert.match(eligibilityMigration, /has_column_privilege\('shelf_book_reviews_rpc_owner', 'public\.borrow_requests', 'return_date', 'SELECT'\)/);
  assert.match(eligibilityMigration, /Review RPC owner eligibility RLS policies mismatch/);
});

test('save_my_book_review returns verified reader label without PII', () => {
  assert.match(eligibilityMigration, /'Verified Reader'::text/);
  assert.match(eligibilityMigration, /RETURN QUERY/);
});

test('save_my_book_review ownership is set to dedicated RPC owner role', () => {
  assert.match(eligibilityMigration, /ALTER FUNCTION public\.save_my_book_review\(text, integer, text\) OWNER TO shelf_book_reviews_rpc_owner/);
});

test('direct table access on book_reviews is fully revoked', () => {
  assert.match(eligibilityMigration, /REVOKE ALL ON TABLE public\.book_reviews FROM PUBLIC, anon, authenticated, service_role/);
});

test('RLS policies are minimal and only for RPC owner', () => {
  assert.match(eligibilityMigration, /DROP POLICY IF EXISTS "read public reviews" ON public\.book_reviews/);
  assert.match(eligibilityMigration, /DROP POLICY IF EXISTS "visitors manage own reviews" ON public\.book_reviews/);
  assert.match(eligibilityMigration, /CREATE POLICY "book review RPC owner reads reviews"[\s\S]*ON public\.book_reviews FOR ALL TO shelf_book_reviews_rpc_owner/);
});

test('get_book_reviews grants are correct', () => {
  assert.match(eligibilityMigration, /REVOKE ALL ON FUNCTION public\.get_book_reviews\(text, integer, integer\)[\s\S]*FROM PUBLIC, anon, authenticated, service_role/);
  assert.match(eligibilityMigration, /GRANT EXECUTE ON FUNCTION public\.get_book_reviews\(text, integer, integer\)[\s\S]*TO anon, authenticated, service_role/);
});

test('delete_my_book_review enforces authenticated verified visitor session', () => {
  assert.match(eligibilityMigration, /CREATE OR REPLACE FUNCTION public\.delete_my_book_review\(p_review_id text\)/);
  assert.match(eligibilityMigration, /public\.shelf_rpc_request_uid\(\) IS NULL/);
  assert.match(eligibilityMigration, /visitor\.auth_user_id = public\.shelf_rpc_request_uid\(\)/);
  assert.match(eligibilityMigration, /visitor\.otp_verified IS TRUE/);
  assert.match(eligibilityMigration, /visitor\.is_active IS TRUE/);
});

test('delete_my_book_review verifies ownership before deletion', () => {
  assert.match(eligibilityMigration, /DELETE FROM public\.book_reviews AS review[\s\S]*WHERE review\.id::text = p_review_id[\s\S]*AND review\.visitor_id = v_visitor_id/);
  assert.match(eligibilityMigration, /RETURNING review\.id::text INTO v_deleted_id/);
  assert.match(eligibilityMigration, /RETURN v_deleted_id IS NOT NULL/);
});

test('delete_my_book_review ownership and grants are correct', () => {
  assert.ok(eligibilityMigration.includes('ALTER FUNCTION public.delete_my_book_review(text) OWNER TO shelf_book_reviews_rpc_owner'));
  assert.ok(eligibilityMigration.includes('REVOKE ALL ON FUNCTION public.delete_my_book_review(text)'));
  assert.ok(eligibilityMigration.includes('GRANT EXECUTE ON FUNCTION public.delete_my_book_review(text)'));
});

test('postflight validates function ownership, metadata, and search_path', () => {
  assert.match(eligibilityMigration, /proowner = 'shelf_book_reviews_rpc_owner'::regrole/);
  assert.match(eligibilityMigration, /lanname = 'plpgsql'/);
  assert.match(eligibilityMigration, /prosecdef/);
  assert.match(eligibilityMigration, /proconfig = ARRAY\['search_path=""'\]::text\[\]/);
});

test('postflight validates direct table access is revoked', () => {
  assert.match(eligibilityMigration, /has_table_privilege\('anon', 'public\.book_reviews', 'SELECT'\)/);
  assert.match(eligibilityMigration, /has_table_privilege\('authenticated', 'public\.book_reviews', 'INSERT'\)/);
  assert.match(eligibilityMigration, /has_table_privilege\('authenticated', 'public\.book_reviews', 'UPDATE'\)/);
  assert.match(eligibilityMigration, /has_table_privilege\('authenticated', 'public\.book_reviews', 'DELETE'\)/);
  assert.match(eligibilityMigration, /Unexpected direct table privileges remain on book_reviews/);
});

test('postflight validates unique constraint on (book_id, visitor_id)', () => {
  assert.match(eligibilityMigration, /book_reviews_book_id_visitor_id_key/);
  assert.match(eligibilityMigration, /Exact unique constraint on \(book_id, visitor_id\) missing/);
  assert.match(eligibilityMigration, /ARRAY\['book_id', 'visitor_id'\]::text\[\]/);
});

test('postflight validates RPC EXECUTE grants', () => {
  assert.match(eligibilityMigration, /has_function_privilege\('anon', v_get_sig, 'EXECUTE'\)/);
  assert.match(eligibilityMigration, /has_function_privilege\('authenticated', v_get_sig, 'EXECUTE'\)/);
  assert.match(eligibilityMigration, /has_function_privilege\('authenticated', v_save_sig, 'EXECUTE'\)/);
  assert.match(eligibilityMigration, /has_function_privilege\('authenticated', v_delete_sig, 'EXECUTE'\)/);
  assert.match(eligibilityMigration, /has_function_privilege\('anon', v_save_sig, 'EXECUTE'\)/);
  assert.match(eligibilityMigration, /has_function_privilege\('anon', v_delete_sig, 'EXECUTE'\)/);
  assert.match(eligibilityMigration, /RPC EXECUTE grants mismatch/);
});
