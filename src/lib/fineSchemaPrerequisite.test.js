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

test('fine schema prerequisite validates key columns exactly', () => {
  assert.match(migration, /v_index\.key_columns/);
  assert.match(migration, /ARRAY\['status','due_date','book_id'\]/);
  assert.match(migration, /v_index_keys\s+IS\s+DISTINCT\s+FROM\s+v_index\.key_columns/);
});

test('fine schema prerequisite validates include columns exactly', () => {
  assert.match(migration, /v_index\.include_columns/);
  assert.match(migration, /fine_amount/);
  assert.match(migration, /fine_paid_amount/);
  assert.match(migration, /fine_rate_snapshot/);
  assert.match(migration, /fine_review_required/);
  assert.match(migration, /fine_review_resolved_at/);
  assert.match(migration, /visitor_id/);
  assert.match(migration, /include_match=%/);
});

test('fine schema prerequisite validates ordering options exactly', () => {
  assert.match(migration, /v_index\.key_options/);
  assert.match(migration, /ARRAY\[0,0,0\]/);
  assert.match(migration, /v_index_options\s+IS\s+DISTINCT\s+FROM\s+v_index\.key_options/);
});

test('fine schema prerequisite validates index counts, owner, operator classes, and collations', () => {
  assert.match(migration, /v_index_nkeyatts\s+<>\s+pg_catalog\.cardinality\(v_index\.key_columns\)/);
  assert.match(migration, /v_index_natts\s+<>\s+pg_catalog\.cardinality\(v_index\.key_columns\)/);
  assert.match(migration, /v_index_owner_oid\s*<>\s*v_owner_oid/);
  assert.match(migration, /ARRAY\['pg_catalog\.text_ops','pg_catalog\.timestamptz_ops'/);
  assert.match(migration, /v_index_opclasses\s+IS DISTINCT FROM\s+v_index\.key_opclasses/);
  assert.match(migration, /v_index_collations\s+IS DISTINCT FROM\s+v_expected_collations/);
  assert.match(migration, /unnest\(i\.indcollation\)/);
  assert.match(migration, /COALESCE\(co\.collation_oid, 0::oid\)/);
  assert.match(migration, /array_agg\(a\.attcollation ORDER BY expected\.ord\)/);
  assert.match(migration, /v_index_exclusion/);
  assert.match(migration, /c\.conindid = v_index_oid/);
  assert.match(migration, /unexpectedly backs a constraint/);
});

test('fine schema prerequisite validates table oid match', () => {
  assert.match(migration, /v_index_table_oid\s+<>.*v_index\.table_oid/);
});

test('fine schema prerequisite validates access method is btree', () => {
  assert.match(migration, /v_index_method\s+<>.*'btree'/);
});

test('fine schema prerequisite validates non-unique index', () => {
  assert.match(migration, /v_index_unique/);
});

test('fine schema prerequisite validates index validity flags', () => {
  assert.match(migration, /v_index_valid/);
  assert.match(migration, /v_index_ready/);
  assert.match(migration, /v_index_live/);
});

test('fine schema prerequisite validates predicate for varchar status column', () => {
  assert.match(migration, /character varying%/);
  assert.match(migration, /\(\(status\)::text = ANY \(\(ARRAY\[''borrowed''::character varying, ''returned''::character varying\]\)::text\[\]\)\)/);
  assert.match(migration, /v_index_predicate\s+IS DISTINCT FROM\s+v_expected_predicate/);
});

test('fine schema prerequisite preserves the text-type predicate path', () => {
  assert.match(migration, /ELSE v_index\.predicate/);
  assert.match(migration, /\(status = ANY \(ARRAY\[''borrowed''::text, ''returned''::text\]\)\)/);
  assert.match(migration, /v_borrow_status_type\s+IS DISTINCT FROM\s+'text'/i);
});

test('fine schema prerequisite compares the rendered predicate directly', () => {
  assert.match(migration, /pg_catalog\.pg_get_expr\(i\.indpred, i\.indrelid\)/);
  assert.doesNotMatch(migration, /lower\(pg_catalog\.pg_get_expr\(i\.indpred/);
  assert.match(migration, /ELSE v_index\.predicate/);
});

test('fine schema prerequisite does not normalize predicate literals or accept case variants', () => {
  assert.match(migration, /THEN\s+'\(\(status\)::text = ANY \(\(ARRAY\[''borrowed''::character varying, ''returned''::character varying\]\)::text\[\]\)\)'/);
  assert.match(migration, /v_index_predicate\s+IS DISTINCT FROM\s+v_expected_predicate/);
  assert.doesNotMatch(migration, /lower\(pg_catalog\.pg_get_expr\(i\.indpred/);
});

const expectedProductionIndex = {
  schema: 'public',
  table: 'public.borrow_requests',
  accessMethod: 'btree',
  unique: false,
  valid: true,
  ready: true,
  live: true,
  natts: 9,
  nkeyatts: 3,
  keys: ['status', 'due_date', 'book_id'],
  includes: ['fine_amount', 'fine_paid_amount', 'fine_rate_snapshot', 'fine_review_required', 'fine_review_resolved_at', 'visitor_id'],
  options: [0, 0, 0],
  opclasses: ['pg_catalog.text_ops', 'pg_catalog.timestamptz_ops', 'pg_catalog.text_ops'],
  predicate: "((status)::text = ANY ((ARRAY['borrowed'::character varying, 'returned'::character varying])::text[]))",
  statusType: 'character varying(50)',
};

// Synthetic owner/collation values let the comparison helper test those
// branches without pretending the owner-supplied production output contained
// the still-missing owner OID or per-key collation OIDs.
const syntheticCanonicalIndex = {
  ...expectedProductionIndex,
  owner: 'postgres',
  exclusion: false,
  backingConstraint: false,
  collationOids: [100, 0, 100],
};

function assertCanonicalIndex(index) {
  assert.equal(index.schema, expectedProductionIndex.schema);
  assert.equal(index.table, expectedProductionIndex.table);
  assert.equal(index.owner, 'postgres');
  assert.equal(index.accessMethod, expectedProductionIndex.accessMethod);
  assert.equal(index.unique, expectedProductionIndex.unique);
  assert.equal(index.exclusion, false);
  assert.equal(index.backingConstraint, false);
  assert.equal(index.valid, expectedProductionIndex.valid);
  assert.equal(index.ready, expectedProductionIndex.ready);
  assert.equal(index.live, expectedProductionIndex.live);
  assert.equal(index.natts, expectedProductionIndex.natts);
  assert.equal(index.nkeyatts, expectedProductionIndex.nkeyatts);
  assert.deepEqual(index.keys, expectedProductionIndex.keys);
  assert.deepEqual(index.includes, expectedProductionIndex.includes);
  assert.deepEqual(index.options, expectedProductionIndex.options);
  assert.deepEqual(index.opclasses, expectedProductionIndex.opclasses);
  assert.deepEqual(index.collationOids, syntheticCanonicalIndex.collationOids);
  assert.equal(index.predicate, expectedProductionIndex.predicate);
  assert.equal(index.statusType, expectedProductionIndex.statusType);
}

test('provided production catalog fixture matches the canonical index shape', () => {
  assert.deepEqual(expectedProductionIndex.keys, ['status', 'due_date', 'book_id']);
  assert.deepEqual(expectedProductionIndex.includes, [
    'fine_amount', 'fine_paid_amount', 'fine_rate_snapshot',
    'fine_review_required', 'fine_review_resolved_at', 'visitor_id',
  ]);
  assert.equal(expectedProductionIndex.predicate,
    "((status)::text = ANY ((ARRAY['borrowed'::character varying, 'returned'::character varying])::text[]))");
});

test('synthetic canonical catalog fixture matches owner and collation expectations', () => {
  assert.doesNotThrow(() => assertCanonicalIndex(syntheticCanonicalIndex));
});

test('catalog fixture rejects wrong key order', () => {
  assert.throws(() => assertCanonicalIndex({
    ...syntheticCanonicalIndex,
    keys: ['due_date', 'status', 'book_id'],
  }));
});

test('catalog fixture rejects wrong INCLUDE order', () => {
  assert.throws(() => assertCanonicalIndex({
    ...syntheticCanonicalIndex,
    includes: [...expectedProductionIndex.includes].reverse(),
  }));
});

test('catalog fixture rejects wrong predicate', () => {
  assert.throws(() => assertCanonicalIndex({
    ...syntheticCanonicalIndex,
    predicate: "status = 'borrowed'",
  }));
});

test('catalog fixture rejects wrong operator class', () => {
  assert.throws(() => assertCanonicalIndex({
    ...syntheticCanonicalIndex,
    opclasses: ['pg_catalog.varchar_ops', ...expectedProductionIndex.opclasses.slice(1)],
  }));
});

test('catalog fixture rejects wrong table or schema ownership', () => {
  assert.throws(() => assertCanonicalIndex({ ...syntheticCanonicalIndex, schema: 'private' }));
  assert.throws(() => assertCanonicalIndex({ ...syntheticCanonicalIndex, table: 'public.books' }));
});

test('catalog fixture rejects wrong index owner', () => {
  assert.throws(() => assertCanonicalIndex({ ...syntheticCanonicalIndex, owner: 'authenticated' }));
});

test('catalog fixture rejects wrong key collation OIDs', () => {
  assert.throws(() => assertCanonicalIndex({
    ...syntheticCanonicalIndex,
    collationOids: [101, 0, 100],
  }));
});

test('catalog fixture rejects invalid or not-ready index flags', () => {
  assert.throws(() => assertCanonicalIndex({ ...syntheticCanonicalIndex, valid: false }));
  assert.throws(() => assertCanonicalIndex({ ...syntheticCanonicalIndex, ready: false }));
  assert.throws(() => assertCanonicalIndex({ ...syntheticCanonicalIndex, live: false }));
  assert.throws(() => assertCanonicalIndex({ ...syntheticCanonicalIndex, exclusion: true }));
  assert.throws(() => assertCanonicalIndex({ ...syntheticCanonicalIndex, backingConstraint: true }));
});

test('fine schema prerequisite includes detailed diagnostic on mismatch', () => {
  assert.match(migration, /keys_match=%/);
  assert.match(migration, /include_match=%/);
  assert.match(migration, /options_match=%/);
  assert.match(migration, /opclasses_match=%/);
  assert.match(migration, /collations_match=%/);
  assert.match(migration, /predicate_match=%/);
  assert.match(migration, /actual_keys=%/);
  assert.match(migration, /expected_keys=%/);
  assert.match(migration, /actual_include=%/);
  assert.match(migration, /expected_include=%/);
  assert.match(migration, /actual_options=%/);
  assert.match(migration, /expected_options=%/);
  assert.match(migration, /actual_predicate=%/);
  assert.match(migration, /expected_predicate=%/);
  assert.match(migration, /borrow_status_type=%/);
  assert.match(migration, /indexdef=%/);
});

test('read-only fine index diagnostic reports actual owner and index/table collation OIDs', () => {
  const diagnostic = readFileSync(
    new URL('../../scripts/verify-fine-dashboard-index-readonly.sql', import.meta.url),
    'utf8'
  );
  assert.match(diagnostic, /ic\.relowner AS index_owner_oid/);
  assert.match(diagnostic, /pg_catalog\.pg_get_userbyid\(ic\.relowner\) AS index_owner/);
  assert.match(diagnostic, /'indcollation_oid'[\s\S]*?co\.collation_oid/);
  assert.match(diagnostic, /'table_collation_oid'[\s\S]*?a\.attcollation/);
  assert.match(diagnostic, /pg_catalog\.pg_collation AS table_coll/);
});
