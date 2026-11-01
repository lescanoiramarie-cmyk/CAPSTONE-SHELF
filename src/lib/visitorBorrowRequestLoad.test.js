import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const authContextSource = readFileSync(
  new URL('../context/AuthContext.jsx', import.meta.url),
  'utf8'
);
const storeSource = readFileSync(
  new URL('../data/store.js', import.meta.url),
  'utf8'
);
const visitorBorrowIndexMigration = readFileSync(
  new URL(
    '../../supabase/migrations/20261207000000_index_borrow_requests_by_visitor.sql',
    import.meta.url
  ),
  'utf8'
);

test('restoring the saved auth user does not dispatch a duplicate initial data refresh', () => {
  assert.match(
    authContextSource,
    /persistedUserSnapshotRef\s*=\s*useRef\(JSON\.stringify\(user\)\)/
  );
  assert.match(
    authContextSource,
    /if\s*\(nextSnapshot\s*!==\s*persistedUserSnapshotRef\.current\)\s*\{\s*persistedUserSnapshotRef\.current\s*=\s*nextSnapshot;\s*notifyVisitorSessionChanged\(\);/s
  );
});

test('authenticated visitor borrow history uses the self-verifying visitor RPC', () => {
  const visitorRequestBranch = storeSource.match(
    /if\s*\(\s*authenticatedUserId\s*===\s*authUserId[\s\S]*?\n\s*\}\s*else\s*\{/
  );
  assert.ok(visitorRequestBranch, 'Expected a separate authenticated visitor request path.');
  assert.match(visitorRequestBranch[0], /normalizedVisitorId/);
  assert.match(visitorRequestBranch[0], /'get_visitor_borrow_requests'/);
  assert.match(visitorRequestBranch[0], /p_visitor_id:\s*authUserId/);
  assert.doesNotMatch(visitorRequestBranch[0], /fetchAllBorrowRequestRows/);
});

test('visitor borrow RPC lookup has a matching request-date index migration', () => {
  assert.match(
    visitorBorrowIndexMigration,
    /CREATE INDEX IF NOT EXISTS borrow_requests_visitor_request_date_idx/i
  );
  assert.match(
    visitorBorrowIndexMigration,
    /ON public\.borrow_requests\s*\(visitor_id,\s*request_date DESC\)/i
  );
});
