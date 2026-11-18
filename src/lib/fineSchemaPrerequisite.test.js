import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migration = readFileSync(
  new URL('../../supabase/migrations/20261108160959_fine_schema_prerequisite.sql', import.meta.url),
  'utf8'
);

test('fine schema prerequisite accepts canonical text and varchar partial-index renderings only', () => {
  assert.match(migration, /format_type\(a\.atttypid, a\.atttypmod\)/);
  assert.match(migration, /v_borrow_status_type\s+IS\s+DISTINCT\s+FROM\s+'text'/i);
  assert.match(migration, /v_borrow_status_type\s+NOT\s+LIKE\s+'character varying%'/i);
  assert.match(migration, /WHEN v_index\.index_name = 'borrow_requests_fine_dashboard_status_book_due_idx'/);
  assert.match(migration, /v_borrow_status_type/);
  assert.match(migration, /pg_catalog\.regexp_replace\(/);
  assert.match(migration, /v_index_predicate\s+IS\s+DISTINCT\s+FROM\s+v_expected_predicate/);
});