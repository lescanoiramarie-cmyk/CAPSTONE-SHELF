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
    /export async function fetchBorrowRequests\(\{\s*includeCommunityRequests = true,\s*visitorId = null,\s*signal,\s*skipVisitorResolution = false,\s*\} = \{\}\)/
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

test('staff borrowing history loads after the main dashboard refresh', () => {
  assert.match(
    libraryContextSource,
    /currentVisitorId\s*\?\s*Promise\.resolve\(\[\]\)\s*:\s*Promise\.resolve\(\[\]\)/
  );
  assert.match(
    libraryContextSource,
    /void loadVisitorBorrowRequests\(currentVisitorId\)/
  );
  assert.match(
    libraryContextSource,
    /const loadAllBorrowRequests = useCallback\(async \(\) => \{[\s\S]*?BORROW_REQUESTS_LOAD_TIMEOUT_MS/
  );
  assert.match(
    libraryContextSource,
    /store\.fetchBorrowRequests\(\{[\s\S]*?skipVisitorResolution:\s*true,[\s\S]*?signal:\s*controller\.signal/
  );
  assert.match(
    libraryContextSource,
    /void loadAllBorrowRequests\(\)/
  );
  const refreshStart = libraryContextSource.match(
    /const refreshAll = useCallback\(async \(\) => \{([\s\S]*?)setLoading\(true\);/
  );
  assert.ok(refreshStart, 'Expected a main refresh setup.');
  assert.doesNotMatch(
    refreshStart[1],
    /borrowRequests(?:LoadSequenceRef|AbortControllerRef)\.current(?:\s*\+=|\?\.abort)/
  );
  assert.match(
    libraryContextSource,
    /borrowRequestsScopeRef\.current === scope[\s\S]*?borrowRequestsAbortControllerRef\.current[\s\S]*?return;/
  );
  assert.match(
    libraryContextSource,
    /if \(error\?\.name === 'AbortError'\) return/
  );
  assert.match(libraryContextSource, /borrowRequestsScopeRef\.current = scope/);
});

test('unresolved visitor sessions do not fall back to loading all borrow requests', () => {
  const missingVisitorBranch = storeSource.match(
    /if\s*\(skipVisitorResolution\)\s*\{[\s\S]*?normalRequests\s*=\s*staff\?\.is_active[\s\S]*?:\s*\[\];/
  );
  assert.ok(
    missingVisitorBranch,
    'Expected missing visitor IDs to load borrow history only for an active staff account.'
  );
  assert.match(
    missingVisitorBranch[0],
    /\.from\('staff_profiles'\)[\s\S]*?\.eq\('id',\s*authenticatedUserId\)/
  );
  assert.match(
    missingVisitorBranch[0],
    /getBorrowRequestsForSession\(\(\)\s*=>\s*fetchAllBorrowRequestRows\(signal\)\s*\)/
  );
});

test('aborted borrowing history requests are not logged as database failures', () => {
  const normalRequestsCatch = storeSource.match(
    /catch \(normalError\) \{([\s\S]*?)\n\s*\}\s*const libraryBorrowRequests/
  );
  assert.ok(normalRequestsCatch, 'Expected a borrowing-history error handler.');
  assert.match(
    normalRequestsCatch[1],
    /signal\?\.aborted \|\| normalError\?\.name === 'AbortError'/
  );
  assert.ok(
    normalRequestsCatch[1].indexOf('signal?.aborted') <
      normalRequestsCatch[1].indexOf("console.error("),
    'Expected cancellation handling before error logging.'
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

test('visitor dashboard loads only the signed-in visitor profile', () => {
  assert.match(
    storeSource,
    /export async function fetchVisitors\(visitorId = null,\s*knownVisitor = null\)/
  );
  assert.match(
    storeSource,
    /knownVisitor\?\.id[\s\S]*?normalizeText\(knownVisitor\.id\) === normalizedVisitorId/
  );
  assert.match(
    storeSource,
    /\.eq\('id', normalizedVisitorId\)[\s\S]*?\.maybeSingle\(\)/
  );
  assert.match(
    libraryContextSource,
    /store\.fetchVisitors\(\s*currentVisitorId,\s*currentVisitorProfileRef\.current\s*\)/
  );
  assert.match(
    libraryContextSource,
    /currentVisitorProfileRef\.current = visitor/
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
