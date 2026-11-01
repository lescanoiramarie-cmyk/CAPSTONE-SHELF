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
const libraryContextSource = readFileSync(
  new URL('../context/LibraryContext.jsx', import.meta.url),
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

test('authenticated visitor borrow history uses a visitor-scoped RLS query', () => {
  const visitorRequestBranch = storeSource.match(
    /if\s*\(\s*authenticatedUserId\s*\)\s*\{\s*if\s*\([\s\S]*?\n\s*\}\s*else\s*\{/
  );
  assert.ok(visitorRequestBranch, 'Expected a separate authenticated visitor request path.');
  assert.match(visitorRequestBranch[0], /normalizedVisitorId/);
  assert.match(visitorRequestBranch[0], /\.from\('borrow_requests'\)/);
  assert.match(visitorRequestBranch[0], /\.eq\('visitor_id',\s*normalizedVisitorId\)/);
  assert.match(visitorRequestBranch[0], /\.abortSignal\(signal\)/);
  assert.doesNotMatch(visitorRequestBranch[0], /'get_visitor_borrow_requests'/);
  assert.doesNotMatch(visitorRequestBranch[0], /fetchAllBorrowRequestRows/);
  assert.doesNotMatch(storeSource, /borrowRequestsFetchesInFlight/);
});

test('library refresh does not fetch requester community requests twice', () => {
  assert.match(
    storeSource,
    /export async function fetchBorrowRequests\(\{\s*includeCommunityRequests = true,\s*visitorId = null,\s*signal,\s*\} = \{\}\)/
  );
  assert.match(
    storeSource,
    /if\s*\(includeCommunityRequests\)\s*\{[\s\S]*?'fetch_my_community_book_requests'/
  );
  assert.match(
    libraryContextSource,
    /store\.fetchBorrowRequests\(\{\s*includeCommunityRequests:\s*false,\s*visitorId,\s*signal:\s*controller\.signal,\s*\}\)/
  );
  assert.match(
    libraryContextSource,
    /store\.fetchMyCommunityBookRequests\(currentVisitorId\)/
  );
});

test('visitor borrow history does not block the main dashboard refresh', () => {
  assert.match(
    libraryContextSource,
    /currentVisitorId\s*\?\s*Promise\.resolve\(\[\]\)\s*:\s*waitForData\([\s\S]*?'Borrowing history'/
  );
  assert.match(
    libraryContextSource,
    /void loadVisitorBorrowRequests\(currentVisitorId,\s*refreshSequence\)/
  );
  assert.match(
    libraryContextSource,
    /borrowRequestsAbortControllerRef\.current\?\.abort\(\)/
  );
  assert.match(
    libraryContextSource,
    /controller\.abort\(\)/
  );
  assert.match(
    libraryContextSource,
    /borrowRequestsLoadSequenceRef\.current \+= 1/
  );
});

test('visitor can see and retry borrowing history loading errors', () => {
  assert.match(
    libraryContextSource,
    /const retryBorrowRequests = useCallback\(async \(\) =>/
  );
  assert.match(
    readFileSync(new URL('../component/OPACCatalog.jsx', import.meta.url), 'utf8'),
    /Library borrowing history is unavailable:[\s\S]*?onClick=\{\(\) => void onRetryBorrowRequests\(\)\}/
  );
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
