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
const activeBorrowDashboardIndexMigration = readFileSync(
  new URL(
    '../../supabase/migrations/20261210000000_index_active_borrow_dashboard_queries.sql',
    import.meta.url
  ),
  'utf8'
);
const visitorProfileImageStorageMigration = readFileSync(
  new URL(
    '../../supabase/migrations/20261213000000_fix_visitor_profile_image_upload_rls.sql',
    import.meta.url
  ),
  'utf8'
);
const visitorProfilePhotoCropSource = readFileSync(
  new URL('../component/VisitorProfilePhotoCropDialog.jsx', import.meta.url),
  'utf8'
);
const visitorAddressReadOnlyMigration = readFileSync(
  new URL(
    '../../supabase/migrations/20261214000000_keep_visitor_address_read_only.sql',
    import.meta.url
  ),
  'utf8'
);
const visitorBookCoverStorageMigration = readFileSync(
  new URL(
    '../../supabase/migrations/20261215000000_fix_visitor_book_cover_upload_rls.sql',
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

test('staff borrowing history is branch-scoped and limited to recent or active requests', () => {
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
  const staffHistoryStart = storeSource.indexOf(
    'async function fetchStaffBorrowRequestRows('
  );
  const staffHistoryEnd = storeSource.indexOf(
    '// FETCH LIBRARIES',
    staffHistoryStart
  );
  assert.ok(staffHistoryStart >= 0 && staffHistoryEnd > staffHistoryStart);
  const staffHistorySource = storeSource.slice(staffHistoryStart, staffHistoryEnd);
  assert.match(staffHistorySource, /staff\.role === 'subadmin'/);
  assert.match(staffHistorySource, /\.eq\('library_id',\s*staff\.library_id\)/);
  assert.match(staffHistorySource, /\.in\('book_id',\s*branchBookIds\)/);
  assert.match(staffHistorySource, /BORROW_DASHBOARD_RECENT_DAYS/);
  assert.match(staffHistorySource, /\.in\('status',\s*BORROW_DASHBOARD_ACTIVE_STATUSES\)/);
  assert.doesNotMatch(staffHistorySource, /\.select\('\*'\)/);
  assert.doesNotMatch(storeSource, /fetchAllBorrowRequestRows/);
  assert.match(
    libraryContextSource,
    /void loadAllBorrowRequests\(\)/
  );
  assert.match(
    libraryContextSource,
    /if\s*\(currentVisitorId\)\s*\{\s*void loadVisitorBorrowRequests\(currentVisitorId\);\s*\}\s*else if\s*\(user\?\.role === 'visitor'\)\s*\{[\s\S]*?setBorrowRequestsLoadError\([\s\S]*?\);\s*\}\s*else\s*\{\s*void loadAllBorrowRequests\(\);/
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

test('staff and visitor dashboards do not load every visitor profile into shared state', () => {
  assert.match(
    storeSource,
    /export async function fetchVisitorCount\(\)[\s\S]*?select\('id',\s*\{\s*count:\s*'exact',\s*head:\s*true\s*\}\)/
  );
  assert.match(
    libraryContextSource,
    /currentVisitorId\s*\?\s*waitForData\([\s\S]*?store\.fetchVisitors\([\s\S]*?\)\s*:\s*Promise\.resolve\(\[\]\)/
  );
  assert.match(
    libraryContextSource,
    /store\.fetchVisitorCount\(\)/
  );
  assert.match(
    libraryContextSource,
    /visitorCount:\s*Number\(data\.visitorCount\)\s*\|\|\s*0/
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

test('visitor profiles remain readable before the profile-photo migration is applied', () => {
  assert.match(
    storeSource,
    /function isMissingVisitorProfileImageColumn\(error\)[\s\S]*?profile_image_path/
  );
  assert.match(
    storeSource,
    /export async function getVisitor\([\s\S]*?isMissingVisitorProfileImageColumn\(error\)[\s\S]*?LEGACY_VISITOR_PROFILE_COLUMNS/
  );
  assert.match(
    storeSource,
    /export async function fetchVisitors\([\s\S]*?isMissingVisitorProfileImageColumn\(error\)[\s\S]*?LEGACY_VISITOR_PROFILE_COLUMNS/
  );
  assert.match(
    storeSource,
    /visitor profile photos are unavailable because profile_image_path is missing/i
  );
});

test('staff session resolution skips visitor-profile lookup', () => {
  const visitorResolver = libraryContextSource.match(
    /const\s+getCurrentVisitorId\s*=\s*useCallback\(async\s+\(role\)\s*=>\s*\{([\s\S]*?)\n\s*\},\s*\[\]\);/
  );
  assert.ok(visitorResolver, 'Expected a role-aware visitor resolver.');
  assert.match(visitorResolver[1], /if\s*\(role\s*!==\s*'visitor'\)\s*return\s+null/);
  assert.ok(
    visitorResolver[1].indexOf("role !== 'visitor'") <
      visitorResolver[1].indexOf('store.getVisitor(authUserId)'),
    'Staff sessions must skip the visitor-table lookup.'
  );
  assert.match(libraryContextSource, /getCurrentVisitorId\(user\?\.role\)/);
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

test('active and queued staff requests have a partial dashboard index', () => {
  assert.match(
    activeBorrowDashboardIndexMigration,
    /CREATE INDEX IF NOT EXISTS borrow_requests_active_status_date_idx/i
  );
  assert.match(
    activeBorrowDashboardIndexMigration,
    /ON public\.borrow_requests\s*\(status,\s*request_date DESC,\s*id ASC\)/i
  );
  assert.match(
    activeBorrowDashboardIndexMigration,
    /WHERE status IN\s*\('pending',\s*'queued',\s*'ready_for_pickup',\s*'borrowed'\)/i
  );
});

test('visitor profile photo storage upload is owner-scoped and relies on bucket file limits', () => {
  const insertPolicy = visitorProfileImageStorageMigration.match(
    /create policy "Visitors can upload own profile images"[\s\S]*?for insert[\s\S]*?with check \(([\s\S]*?)\n\);/i
  );
  assert.ok(insertPolicy, 'Expected a visitor-owned storage insert policy.');
  assert.match(insertPolicy[1], /bucket_id = 'visitor-profile-images'/);
  assert.match(insertPolicy[1], /visitor\.auth_user_id = auth\.uid\(\)/);
  assert.match(insertPolicy[1], /visitor\.otp_verified/);
  assert.match(insertPolicy[1], /visitor\.is_active/);
  assert.doesNotMatch(insertPolicy[1], /metadata/i);
});

test('visitor profile photo selection opens a draggable square crop workflow', () => {
  assert.match(visitorProfilePhotoCropSource, /Crop profile photo/);
  assert.match(visitorProfilePhotoCropSource, /onPointerMove/);
  assert.match(visitorProfilePhotoCropSource, /type="range"/);
  assert.match(visitorProfilePhotoCropSource, /OUTPUT_SIZE = 512/);
});

test('visitor address is read-only in the profile editor and database update path', () => {
  const updateProfileFunction = storeSource.match(
    /export async function updateVisitorProfile\([\s\S]*?\n\}/
  );
  assert.ok(updateProfileFunction, 'Expected the visitor profile update function.');
  assert.doesNotMatch(updateProfileFunction[0], /normalizedAddress|\baddress\s*:/);
  assert.match(visitorAddressReadOnlyMigration, /revoke update \(address\)/i);

  const visitorProfileEditor = readFileSync(
    new URL('../pages/visitor/VisitorDashboard.jsx', import.meta.url),
    'utf8'
  );
  assert.match(visitorProfileEditor, /Edit profile[\s\S]*?Contact number/);
  assert.doesNotMatch(visitorProfileEditor, /profileForm\.address|Address\s*<textarea/);
});

test('visitor community book cover uploads use owner-scoped RLS without storage metadata checks', () => {
  const insertPolicy = visitorBookCoverStorageMigration.match(
    /create policy "Visitors can upload personal book covers"[\s\S]*?for insert[\s\S]*?with check \(([\s\S]*?)\n\);/i
  );
  assert.ok(insertPolicy, 'Expected a visitor-owned book cover insert policy.');
  assert.match(insertPolicy[1], /bucket_id = 'book-covers'/);
  assert.match(insertPolicy[1], /visitor\.id::text = \(storage\.foldername\(name\)\)\[1\]/);
  assert.match(insertPolicy[1], /visitor\.auth_user_id = auth\.uid\(\)/);
  assert.match(insertPolicy[1], /visitor\.otp_verified/);
  assert.match(insertPolicy[1], /visitor\.is_active/);
  assert.doesNotMatch(insertPolicy[1], /metadata/i);
});
