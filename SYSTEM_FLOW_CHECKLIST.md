# SHELF ILMS System Flow Checklist

Use this checklist for release and end-to-end verification. Automated checks
confirm code and migration contracts; items marked for manual QA still need to
be exercised in the deployed application with test accounts.

## Release preflight

- [x] Production build completes.
- [x] Repository ESLint check passes.
- [x] Focused lending and registration regression tests pass.
- [x] Database migration dry-run targets only the three SHELF changes.
- [x] Confirm the public frontend serves the analytics URL correction: the
  production JavaScript bundle contains the active Render service hostname.
- [x] Confirm the linked database has all local migrations applied through
  `20261210000000` (rechecked 2026-11-03; no pending local migrations).

## Public landing and navigation

- [x] Load the landing page on desktop and mobile; confirm it renders without
  horizontal overflow at a 390px mobile viewport.
- [x] Confirm public library/book data loads on the landing page (13 libraries
  and 987 books observed in the local preview).
- [ ] Open announcements and feedback form; submit a test inquiry.
- [x] Verify visitor sign-in and protected-catalog redirect to sign-in.
- [x] Delay read-only landing-page data requests and confirm one opaque,
  full-viewport initial loader appears with logo, brand, tagline, and progress
  bar, then disappears when loading finishes.
- [ ] Verify route-load and refresh indicators on authenticated dashboards.

## Visitor registration and account

- [ ] Register with an email matching the selected partner's configured domain.
- [ ] Reject Gmail, an unrelated domain, a missing library, and a mismatched
  partner/domain at both UI and database boundaries.
- [x] Verify no Outside Visitor registration choice is available in the
  registration form; only configured partner libraries are listed.
- [ ] Complete email/OTP verification and confirm the visitor is assigned to the
  selected library.
- [ ] Sign in, sign out, and verify protected routes redirect correctly.
- [ ] Exercise password reset and login-attempt lockout with test accounts.
- [ ] Accept visitor terms and verify the accepted state persists.
- [ ] Verify a visitor cannot read or change another visitor's private data.

## Catalog and personal books

- [ ] Search and filter library, personal, and external catalog entries.
- [ ] Add a personal book without a cover and verify a success message and saved
  record.
- [ ] Add a personal book with an uploaded cover and verify the cover loads.
- [ ] Edit, change visibility/lending settings, and remove a personal book.
- [ ] Confirm invalid book categories or fine rates are rejected with a clear
  message.
- [ ] Verify only public, lending-enabled personal books can be requested.

## Community book requests

- [ ] Request an available community-book copy and verify queue position.
- [ ] Confirm a book with zero available copies cannot be requested from the UI
  or RPC.
- [ ] Confirm duplicate active requests and requests for one's own book are
  rejected.
- [ ] Approve a request as the owner and verify the requester receives an
  in-app notice directing them to My Requests & Borrows for details.
- [ ] Decline/cancel requests and confirm status and available inventory update.
- [ ] Confirm approval, pickup, and return update the queue and copy counts
  correctly.
- [ ] Verify community-book information remains left-aligned at mobile and
  desktop breakpoints.

## Library borrowing and returns

- [ ] Create a library-book request as a visitor and verify branch/inventory
  eligibility.
- [ ] Process the visitor's QR code as the correct branch sub-admin.
- [ ] Confirm library-book pickup is not blocked by the personal-book
  `lending_enabled` setting.
- [ ] Confirm another branch's sub-admin cannot process the request.
- [ ] Reject expired holds and requests that are not ready for pickup.
- [ ] Return the book and verify the borrow status, copy availability, and queue
  promotion.
- [ ] Verify fine calculation uses the checkout rate snapshot and preserves
  legacy records for manual review.

## Visitor services and notifications

- [ ] Generate, display, refresh, and scan the visitor QR pass.
- [ ] Verify attendance check-in/out and branch scoping.
- [ ] Check My Requests & Borrows, reading list, profile, and request history.
- [ ] Verify announcements and due-date reminders show the intended visitor and
  request details.

## Sub-admin dashboard

- [ ] Load branch inventory, requests, visitors, attendance, and reports.
- [ ] Add/update inventory and verify total, available, reserved, and borrowed
  copy counts remain consistent.
- [ ] Confirm/return a loan using the authorized branch account.
- [ ] Verify unauthorized branch actions are denied by the database, not only
  hidden by the UI.
- [ ] Verify dashboard loading, refresh, empty, and error states.

## Super-admin dashboard and staff accounts

- [ ] Add/edit a partner library and require a valid email domain.
- [ ] Create a sub-admin with a temporary password and assigned branch.
- [ ] Search and filter staff by name/email, branch, role, and active status.
- [ ] Edit a sub-admin and verify branch assignment and account updates.
- [ ] Disable/enable a sub-admin and confirm login/access is revoked/restored.
- [ ] Delete a test sub-admin and confirm the account is removed safely.
- [ ] Confirm super-admin accounts cannot be disabled or deleted through the
  staff-management UI or endpoint.
- [ ] Verify analytics, announcements, feedback, and report exports.

## Security and operations

- [x] Reviewed visitor-domain checks, staff management entry points, lending
  migrations, and relevant client/server trust boundaries; no exploitable issue
  was confirmed in that bounded review.
- [ ] Verify production RLS policies and RPC grants against the deployed
  database.
- [ ] Verify Supabase Edge Function authorization, secrets, and deployed
  function versions.
- [ ] Confirm no service-role or reset secrets are present in client bundles,
  repository history, or public assets.
- [ ] Review Supabase Auth redirect URLs, rate limits, email verification, and
  storage bucket policies in the target project.
- [ ] Check browser console/network for failed RPCs, CORS errors, and leaked
  sensitive responses.
- [ ] Perform role-based end-to-end smoke tests with dedicated test accounts;
  do not use real visitor credentials or real borrowing records.

## Verification notes

- Local browser smoke test on 2026-11-01 confirmed the landing page renders at
  desktop and mobile widths, partner library/book data loads, visitor
  registration has no Outside Visitor option, and an unauthenticated catalog
  route redirects to visitor sign-in.
- Registration form inspection confirmed only partner libraries with configured
  email domains are offered; no account was submitted or created.
- A delayed, read-only data-load test confirmed the initial full-screen loader
  covers a 390x844 viewport with an opaque backdrop and shows its logo, brand,
  tagline, and progress bar. A normal reload confirmed the loader clears after
  data loading.
- The responsive landing-page check reported no horizontal overflow at 390px.
- No registration, feedback submission, book, borrowing, staff, or account
  records were created or modified during these checks.
- The full-screen loader backdrop correction was made during this verification
  and still needs deployment.
- Authenticated workflows, mobile library details, invalid-email submission
  rejection, and deployed frontend delivery remain unverified and require
  dedicated test accounts or deployment access.

### Repeat verification on 2026-11-01

- [x] `npm run build` completed successfully (Vite reports the existing large
  bundle-size advisory).
- [x] Repository-wide `npm run lint` passed.
- [x] All 18 focused Node regression tests passed, including lending,
  registration-domain, personal-book fine-rate, and Gemini forecast display
  contracts.
- [x] Local public landing page loaded 13 participating libraries and showed
  the 987-book catalog summary. The announcements section finished loading,
  and the public feedback form rendered.
- [x] At a 390px browser viewport, the rendered document had no horizontal
  overflow (375px CSS viewport/document width).
- [x] Visitor registration route displayed 14 configured partner choices, the
  partner-domain restriction message, and no Outside Visitor option. No
  registration was submitted.
- [x] Direct unauthenticated navigation to `/catalog` redirected to
  `/visitor-login`.
- [x] Browser smoke test recorded no failed HTTP responses or uncaught page
  errors.
- [ ] Registration submission and server/database rejection cases remain
  unverified; do not treat form-option inspection as proof of the RPC boundary.
- [ ] No authenticated visitor, sub-admin, or super-admin workflows were
  exercised. Borrow/return, community requests, staff management, RLS/RPC
  authorization, account recovery, and role-specific dashboard behavior still
  require dedicated test accounts and a test environment.
- [ ] Production frontend deployment, production Supabase policies/functions,
  and Gemini service availability were not tested in this local browser run.
- Python syntax validation could not be run in this environment because the
  `python` command is unavailable.

### Repeat verification on 2026-11-03

- [x] Production build and repository ESLint pass after applying compatible
  dependency security updates.
- [x] All 45 available Node regression tests pass.
- [x] Analytics API Python source syntax passes `py -3` AST parsing.
- [x] Linked Supabase migration list matches local migrations through
  `20261208000000`; no pending local migrations were reported.
- [x] Read-only production database checks report approximately 615 MB by
  `pg_database_size`; largest relations are `book_reviews` (266 MB),
  `borrow_requests` (164 MB), `audit_logs` (112 MB), and `attendance_logs`
  (34 MB). The dashboard screenshot reports 660/500 MB, so its metric differs
  from SQL by about 45 MB. Estimated dead-row counts are negligible; no data
  was deleted.
- [x] Public production landing and registration pages rendered at a 390px
  viewport. Visitor registration loaded 14 partner choices and the
  location lists; unauthenticated catalog/staff routes redirected. No failed
  browser responses or uncaught page errors were observed.
- [x] Read-only RLS inspection found `borrowed_book_counts` has RLS disabled,
  but `anon` and `authenticated` have no table privileges.
- [x] Read-only query plans use the visitor-history, attendance-history,
  audit-log, and review book-id indexes. The review query still sorts matching
  rows by `created_at`; a replacement index would consume additional space.
- [ ] Review two small index candidates before any schema change:
  `attendance_logs_branch_time_idx` (~4.5 MB) overlaps the used composite
  attendance index, and `borrow_requests_popular_book_counts_idx` (~3.5 MB)
  currently reports zero scans. The statistics reset time is unknown, and the
  combined possible saving (~8 MB) is far below the ~160 MB plan overage.
- [ ] Optimize broad borrowing-history reads: staff paths can paginate through
  all `borrow_requests`; database stats show ~34,384 sequential scans and
  ~93.8 million sequentially read tuples, but stats have no known reset window.
  Explore scoped reads/summary RPCs and benchmark before changing behavior.
- [x] On 2026-11-03, after explicit user confirmation to proceed without a
  backup, deleted reviews beyond the 50 newest per book in batches. This
  permanently removed 816,060 reviews; no backup was created, so the deleted
  review history cannot be restored from this operation.
- [x] Verified 89,650 reviews remain across 1,793 books (exactly 50 per book),
  with zero rating-aggregate mismatches. The review-summary RPC returned 50
  reviews and a rating for a sampled book. `VACUUM (FULL, ANALYZE)` reclaimed
  table space: `book_reviews` fell from 266 MB to 23 MB, and the database from
  615 MB to 379 MB, below the 500 MB free-tier database cap. This confirms the
  review path, not every system flow; organization billing metrics may take
  time to refresh.
- [x] After the user reported rotating the database password, the linked
  read-only database-size query and deployed public homepage still succeeded.
  No new password was requested or recorded; direct-connection integrations
  still need their own credential update if they use the old password.
- [ ] Resolve review privacy: authenticated users can read all review rows,
  including `visitor_id` and `visitor_name` (`anon` has no SELECT grant).
  New reviews no longer fall back to email for display names; decide whether
  historical names/IDs should be masked before changing policies or records.
- [x] Resolved the analytics endpoint mismatch on 2026-11-03. The active
  Render service uses `https://shelf-analytics-q24u.onrender.com`; the old
  `shelf-analytics.onrender.com` hostname returned 404. Updated Render CORS
  configuration for `https://shelf-system.vercel.app`; production `/health`,
  `/openapi.json`, `/docs`, and `/forecast` respond successfully, and the
  production-origin CORS preflight returns 200.
- [ ] One active deployed Edge Function (`smart-responder`) is not present in
  local function configuration/source; confirm whether it is intentional and
  review its code before retaining or removing it.
- [x] `npm audit fix` removed the reported critical and high advisories without
  force-upgrading packages.
- [ ] Resolve the remaining 14 moderate advisories (nine in the production
  dependency tree); do not apply the proposed breaking downgrade without
  compatibility review.
- [ ] Full authenticated transaction flows, live account recovery, production
  RLS denials, and real notification delivery remain untested. The live role
  smoke test below exercised dashboards and a reversible reading-list action,
  but did not submit a borrow, process a pickup/return, or change staff,
  inventory, or account records.
- [x] Applied and verified migration `20261209000000` in Supabase. Community
  pickup now uses the established category rate only when `books.fine_rate` is
  NULL; an explicitly saved rate still takes precedence and is snapshotted at
  pickup. Read-only production checks found zero personal books missing a rate
  and zero approved community requests lacking a category fallback. No active
  community loans are missing a rate snapshot; 20 already-returned legacy
  loans remain flagged for manual fine review.
- [x] All 49 available JavaScript regression tests pass after the community
  legacy fine-rate fix; `npm run lint` and `npm run build` pass.
- [x] Local FastAPI smoke tests pass for `/health`, valid forecast responses,
  FAQ out-of-scope handling, and invalid forecast input. On 2026-11-03, after
  the user configured the Render secret, production `/health` reported
  `geminiConfigured: true`; `/faq/answer` and a valid `/forecast` request both
  returned 200, with the forecast reporting `analyticsSource: gemini`.
- [x] The frontend analytics URL correction is deployed. Its shared URL
  resolver maps the retired Render hostname to
  `https://shelf-analytics-q24u.onrender.com`, and defaults to that active host.
  The Vercel project environment variable was not inspected; the deployed
  bundle itself was verified to include the active hostname.
- [x] On 2026-11-03, authenticated production smoke tests were run using
  visitor, sub-admin, and super-admin accounts. Visitor dashboard tabs,
  catalog search (an exact-title search returned one result), book details,
  announcements, profile/history, and reading-list add/remove were exercised.
  The temporary reading-list entry was removed and the UI confirmed removal.
  Sub-admin overview, visitor accounts, attendance, book transactions,
  inventory, reservation queue, branch map, reports, analytics, feedback, and
  announcements rendered. Super-admin overview, inventory, libraries/map,
  staff accounts, visitor accounts, reports, analytics, feedback, and
  announcements rendered. No staff, inventory, or account data was changed.
- [ ] During repeated authenticated dashboard navigation on 2026-11-03,
  Supabase returned HTTP 500/statement-timeout errors for borrowing-history
  and library-data loads; the UI displayed “Unable to load library data” and
  a retry action. The same borrowing-history timeout appeared in both staff
  dashboards. This confirms the known broad borrowing-history query is an
  active production reliability issue. Do not retry repeatedly until the
  query is scoped/paginated and benchmarked.
- [ ] A full visitor-to-staff borrow/pickup/return transaction was not run:
  the available visitor and sub-admin test accounts were assigned to different
  branches, and no matching branch test-account pair was available. QR camera
  scanning, attendance mutations, feedback submission, staff CRUD, inventory
  CRUD, fines/returns, account recovery, notification delivery, and direct
  production RLS/RPC denial tests remain unverified.
- [x] A sub-admin session attempting to open `/superadmin` was redirected to
  `/subadmin`; after sign-out, protected routes did not retain the prior
  authenticated dashboard.
- [ ] The sub-admin analytics forecast was correctly unavailable because only
  3 days of branch history were available; the UI requires at least 14 days.

### Release-readiness recheck on 2026-11-03

- [x] Fresh `npm run lint`, `npm run build`, and all 51 Node tests passed.
- [x] `npx supabase migration list --linked` reports local and remote migration
  ledgers matching through `20261210000000`; do not apply that migration again.
- [ ] Production borrowing-history timeouts remain an observed reliability
  issue; the scoped query changes have not been deployed and verified against
  the production frontend.
- [ ] Full authenticated borrowing, pickup/return, attendance, inventory/staff
  CRUD, account recovery, notification delivery, and direct RLS denials remain
  unverified with role-matched disposable data.
- [ ] `npm audit --omit=dev` reports 9 moderate advisories. The suggested forced
  remediation downgrades ExcelJS to 3.4.0; do not apply it without compatibility
  review.
- [ ] The worktree has a modified tracked `.env`, untracked `supabase/.branches/`,
  and an untracked migration source file already present in the remote ledger.
  Exclude `.env` and local metadata from commits; retain the migration source
  file in version control for history.
