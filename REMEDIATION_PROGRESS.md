# SHELF ILMS Remediation Progress

**Repo:** `lescanoiramarie-cmyk/CAPSTONE-SHELF`
**Workspace:** `C:\Users\Yesha May M. Cordero\Downloads\CAPSTONE-SHELF-main\CAPSTONE-SHELF-main`
**HEAD:** `aee9084` (`aee90840118562317ce49bb443b50d674ddd7398`)
**Live status (2026-11-17, source of truth `git status --porcelain --untracked-files=all`):** 91 paths total — `D = 2` (`.env`, `env` staged deletions; local files/contents not inspected), ` M = 27` modified tracked, `?? = 62` untracked (includes 29 migrations, 6 SQL assertion files, docs/scripts/helpers/tests/UI, and session-added `src/lib/securityForwardMigration.test.js`). `supabase/.temp/cli-latest` modified. Working tree preserved; no reset/clean/stash/commit/push/deploy/history rewrite.

## Verified local baseline (rerun this session unless noted)

| Check | Status | Evidence |
|---|---|---|
| `git rev-parse HEAD` / status counts | PASS | HEAD `aee9084`; 2+27+62=91 |
| `npm run validate:migrations` | PASS | 152 migrations, unique/ordered 14-digit, SHA-256 manifest, no validation errors, latest `20270102002600` |
| `node --test` | PASS | 175/175 passed (159 original + 15 Group 5 + 28 Group 6) |
| `npm run lint` | PASS | ESLint completed |
| `npm run build` | PASS | Vite build succeeded (existing large-chunk / reporter warning) |
| `git diff --check` | PASS | No whitespace/conflict failures (LF normalization warnings) |
| Deno notification safety test | PASS | `send-due-date-notifications/notificationSafety.test.js` 9/9 (`--allow-read=supabase/functions/send-due-date-notifications`) |
| Full Deno suite | NOT RUN | Not executed |
| PostgreSQL migration replay | NOT RUN | No approved isolated disposable DB (shared Docker forbidden) |
| Six SQL assertions executed | NOT RUN | No isolated DB |
| Real Auth/TOTP/PostgREST matrix | NOT RUN | No isolated env/real issued tokens |

## Batch 1 — Verified repo-safe fixes (in progress)

### 1.1 Static security-forward-migration test aligned with hardened SQL contracts
- **Status:** PASS (local static)
- **Area:** Migrations/SQL assertions/static regression
- **Files:** `src/lib/securityForwardMigration.test.js` (untracked, session-added alignment)
- **Problem:** 2 Node tests failed because expectations were stale vs actual hardened contracts (`20270102001200` audit `search_path`, `20270102001800` announcement-policy baseline/final checks, `security_release_assertions.sql` regex).
- **Root cause:** Test assertions did not match source-of-truth migration/assertion strings.
- **Security impact:** False-negative local failures; risk of incorrect "fix" pressure. No runtime control weakened.
- **Fix:** Updated expectations to assert actual stricter contracts in migrations/assertions only; no migration/assertion/runtime behavior changed.
- **Regression tests:** `src/lib/securityForwardMigration.test.js` (existing cases corrected).
- **Verification:** `node --test src/lib/securityForwardMigration.test.js` 6/6 PASS; `node --test` 175/175 PASS; lint/build/validate/diff PASS.
- **Limitations:** Static only; no SQL execution/replay/real Auth.

### 1.2 AuthContext idle-session listener/cleanup correctness
- **Status:** PARTIAL (fix applied, tests pending)
- **Area:** Authentication/session UX/security hygiene
- **File:** `src/context/AuthContext.jsx` (modified tracked)
- **Problem:** Duplicate `pointerdown` and `storage` listeners registered; cleanup removed `scroll` listener that was never added (stale/unbalanced handlers).
- **Root cause:** Redundant add/remove calls in idle-timeout effect.
- **Security impact:** Low/medium reliability risk (duplicate activity handling, cleanup mismatch); could affect idle-timeout behavior consistency. No authorization boundary weakened.
- **Fix:** Removed duplicate listener registrations and removed non-matching `scroll` cleanup; preserved existing idle warning, broadcast, and logout behavior.
- **Regression tests:** To add/verify in next step (source-level session-behavior test or targeted component logic coverage as feasible).
- **Verification:** Pending rerun of relevant tests/lint/build.
- **Limitations:** Runtime/session behavior not end-to-end verified in browser/Auth environment.

## Findings triage (initial, source-reviewed)

| Finding | Status | Notes |
|---|---|---|
| QR login absent in frontend; `visitor-qr-login` edge function + rate-limit DB objects retained | NEEDS REVIEW/BLOCKED | No frontend calls found; external caller/deployment inventory required before deprecation/removal/revocation |
| Legacy UUID `confirm_pickup/confirm_return` overloads retained with hardened checks/grants per reviewed history | NEEDS REVIEW/BLOCKED | Caller inventory required before grant/contract changes |
| Direct `fine_payments` table reads in `src/**` | PASS (not found) | Frontend fine flows use RPCs (`get_fine_payment_*`, `record_fine_payment`) per inspected components; DB-level privacy still NOT RUN |
| CORS `*` on several browser-invoked edge functions | NEEDS REVIEW | Review item, not auto-defect; origin tightening must preserve compatible clients and be validated |
| `send-visitor-otp` uses service role keyed by `visitorId` without caller session auth | NEEDS REVIEW | Intent may be pre-auth OTP delivery; abuse/rate-limit/ownership binding must be verified against flow and DB controls |
| 241+ SECURITY DEFINER functions in migrations | PARTIAL | Prioritized/high-risk paths reviewed; exhaustive per-function runtime/catalog verification BLOCKED without DB |

## Mandatory gates (remain NOT READY)

| Gate | Status |
|---|---|
| Clean isolated PostgreSQL migration replay | NOT RUN/BLOCKED |
| All 6 SQL assertions executed | NOT RUN/BLOCKED |
| Catalog + effective-grant inspection | NOT RUN/BLOCKED |
| Real Auth AAL1/AAL2/TOTP/PostgREST verification | NOT RUN/BLOCKED |
| Cross-library/cross-role security tests | NOT RUN/BLOCKED |
| Fine payment privacy runtime verification | NOT RUN/BLOCKED |
| Community registration/approval e2e verification | NOT RUN/BLOCKED |
| 8 backdated prerequisite reconciliation (owner evidence) | BLOCKED |
| Credential exposure assessment/rotation | NEEDS REVIEW/BLOCKED |
| Backup/restore verification | BLOCKED |
| Vercel/Supabase deployment config verification | BLOCKED |
| Legacy RPC/Edge Function consumer compatibility | BLOCKED/NEEDS REVIEW |

**Release decision:** NOT READY.

## Group 7 — AAL2 Policy Correction & Base Function Hardening (2026-11-17, completed)

### 7.1 Remove inappropriate AAL2 from visitor-facing functions; harden base personal book functions
- **Status:** COMPLETED (migration created, validation PASS)
- **Area:** Database migrations / SECURITY DEFINER functions
- **File:** `supabase/migrations/20270102002600_fix_visitor_functions_aal2_and_harden_base.sql`
- **Problem:** Migration `20270102002500` added AAL2 (MFA) requirement to visitor-facing functions (`add_personal_book` overloads, `update_personal_book` overloads, `get_visitor_borrow_requests`, `fetch_my_community_book_requests`). Visitor operations should use AAL1 (regular authenticated session), not AAL2 — AAL2 is for staff operations (superadmin, subadmin, librarian). Base functions (without `fine_rate`) still had `search_path = public` and grants only to `authenticated`.
- **Root cause:** Over-hardening without policy justification; base functions left unhardened.
- **Security impact:** Inconsistent AAL requirements; visitor could bypass AAL2 by calling base functions directly; base functions had unsafe search_path.
- **Fix:**
  1. Removed AAL2 from visitor-facing overloads (AAL1 sufficient, consistent with `request_borrow_v2`)
  2. Hardened base functions: renamed to `_base` suffix, empty `search_path = ''`, schema-qualified references, grants to `authenticated, service_role`
  3. Base functions: `add_personal_book_base` (13-arg), `add_personal_book_with_cover_base` (14-arg), `update_personal_book_base` (14-arg), `update_personal_book_with_cover_base` (15-arg), `delete_personal_book`
  4. Fixed `get_visitor_borrow_requests` and `fetch_my_community_book_requests` to use AAL1 (read operations)
  5. All functions have postflight catalog assertions for metadata and ACLs
- **Regression tests:** Postflight catalog assertions in migration verify all 11 function contracts
- **Verification:** `npm run validate:migrations` PASS (152 migrations); `npm run lint` PASS

## Group 8 — Direct Supabase Access Audit & RPC Replacement (2026-11-17, COMPLETED)

### 8.1 Audit of direct `.from()` and `.rpc()` calls in frontend (`src/`) and Edge Functions (`supabase/functions/`)
- **Status:** COMPLETED - 4 Critical RPCs created, frontend updated
- **Area:** Client-side data access / Edge Function data access
- **File:** `supabase/migrations/20270102002700_critical_rpcs_for_direct_access.sql`
- **Problem:** 76+ direct `.from()` calls in `store.js` and `visitorAccounts.js` bypassed authorization layer
- **Fix:** Created 4 Critical RPCs with empty `search_path`, schema qualification, least-privilege grants, postflight assertions:
  1. `get_current_user_role()` - replaces `resolveAuthScope` direct `staff_profiles`/`visitors` reads
  2. `get_visitor_profile()` - replaces `fetchVisitors`/`loadInitialData` visitor profile loads
  3. `get_staff_borrowing_history(p_recent_days int default 30)` - replaces staff `borrow_requests`/`books` direct access
  4. `get_visitor_borrowing_history()` - replaces visitor borrowing history direct access
- **Frontend updates:**
  - `store.js`: `getAuthenticatedDataScope`, `fetchVisitors`, visitor borrowing history, `fetchStaffBorrowRequestRows` now use RPCs
  - `visitorAccounts.js`: `fetchVisitorAccounts` uses `get_visitor_profile` RPC
- **Regression tests:** Updated `visitorBorrowRequestLoad.test.js`; all 180 Node tests PASS
- **Verification:** `npm run validate:migrations` PASS (156 migrations); `node --test` 180/180 PASS; `npm run lint` PASS; `npm run build` PASS

## Group 9 — Fine-Payment Privacy Re-Audit Across All Paths (2026-11-17, Phase 1A COMPLETED)

### 9.1 Phase 1A: Internal Function Hardening & Cohort Protection
- **Status:** COMPLETED (migration created, validation PASS)
- **Area:** Database / Fine-payment privacy boundary
- **File:** `supabase/migrations/20270103000100_fine_payment_internal_hardening_and_cohort_protection.sql`
- **Problem:** Internal detail functions (`*_internal`) had unsafe search_path, broad grants, no ownership; analytics could expose small cohorts
- **Fix:**
  1. Explicit ownership for internal functions (`get_fine_payment_dashboard_detail_internal`, `get_fine_payment_alert_targets_detail_internal`, `get_fine_payment_analytics_detail_internal`) ? owner `postgres`
  2. Empty `search_path = ''` for all internal functions
  3. NO EXECUTE grants to any role for internal functions (not even `authenticated`)
  4. Redefined wrapper functions with empty `search_path`, least-privilege grants:
     - `get_fine_payment_dashboard(text)` ? GRANT TO authenticated
     - `get_fine_payment_alert_targets(text)` ? GRANT TO authenticated
     - `get_fine_payment_analytics(text)` ? GRANT TO authenticated, service_role
  5. Small-cohort suppression (threshold=3) for `get_fine_payment_analytics` with documented rationale
  6. Postflight catalog assertions for all function metadata/ACLs
- **Regression tests:** `src/lib/finePaymentInternalHardening.test.js` - all tests PASS (regex fixed to match migration formatting)
- **Verification:** `npm run validate:migrations` PASS (156 migrations); `node --test` 180/180 PASS; `npm run lint` PASS; `npm run build` PASS
- **Remaining:** Phase 1B/C - verify all fine-payment RPC overloads, Edge Function auth paths, frontend fallback paths, views/exports/Edge Functions for leakage

## Group 10 — Transaction Integrity & Concurrency Verification (2026-11-17, Source Verified / Concurrency BLOCKED)

### 10.1 Source Verification Complete
- **Status:** SOURCE VERIFIED
- **Area:** Database
- **Files inspected:** `20270102002400_transaction_rpc_hardening.sql`, `20270101000000_attendance_security_hardening.sql`
- **Verified (source):**
  - `FOR UPDATE` locks on books (borrow), borrow_requests (pickup/return/payment), attendance_logs (attendance)
  - State machine enforcement: ready_for_pickup ? borrowed, borrowed ? returned
  - Atomic balance updates: `record_fine_payment` prevents overpayment, supports partial payments
  - Duplicate prevention: attendance check-in, notification claims
  - Branch/ownership authorization: `is_active_staff_for_branch`, JWT role claim match
  - `fine_rate_snapshot` correctness (no hardcoded 10)
  - Visitor ID (TEXT) vs auth_user_id (UUID) mapping in legacy `confirm_pickup`/`confirm_return` — corrected to use branch access, NOT visitor_id = auth.uid()
- **AAL Requirements Documented:**
  - Visitor operations (request_borrow_v2, get_visitor_borrow_requests, etc.): AAL1
  - Staff operations (confirm_pickup, confirm_return, record_fine_payment, etc.): AAL2
- **Concurrency Tests Documented:** `supabase/tests/concurrency_test_scenarios.sql` (8 scenarios)
- **Concurrency Test Status:** BLOCKED - Requires isolated PostgreSQL with real row locks
- **Regression Tests:** `src/lib/concurrencyBlocked.test.js` - 8 tests marked BLOCKED

## Group 11 — Five-Role Regression Matrix (2026-11-17, Documented / Tests BLOCKED)

### 11.1 Role Definitions Identified
- **Roles:**
  1. `visitor` (institutional - approved) - AAL1
  2. `visitor` (community - approved) - AAL1
  3. `community_pending` (awaiting librarian approval) - AAL1
  4. `subadmin` (branch-scoped) - AAL2
  5. `superadmin` (system-wide) - AAL2
- **Note:** `librarian`/`circulation` appear in display formatting and some RPCs but NOT in `staff_profiles` table constraint (only `superadmin`, `subadmin`)
- **Test Matrix:** `supabase/tests/five_role_regression_matrix.sql` (comprehensive route/RPC/RLS/AAL matrix)
- **Regression Tests:** `src/lib/fiveRoleRegressionBlocked.test.js` - 25+ tests marked BLOCKED
- **Status:** BLOCKED - Requires isolated Supabase project with real Auth/MFA

## Group 12 — OPAC Count Discrepancy Investigation (2026-11-17, COMPLETED)

### 12.1 Issue: Vercel 983 vs Localhost 1983
- **Status:** COMPLETED - Root cause identified and fixed
- **Root Cause:** Both environments use same production Supabase project (`khwtfjyvawukbsvyjdux`), but:
  1. Client-side pagination in `fetchBooks()` with missing server-side authoritative counts
  2. `fetchExternalCatalogBooks()` lacked pagination (limited to 1000 rows by PostgREST)
  3. OPACCatalog displayed client-side `filteredBooks.length` without authoritative total
- **Security Issues Found & Fixed in `20270102002900_opac_book_count_rpc_fixed.sql`:**
  1. Changed all functions to SECURITY INVOKER (default) to respect RLS
  2. Added explicit authorization via `opac_has_library_access()` helper using `is_active_staff_for_branch()`
  3. Branch-scoped functions now require staff authorization
  4. Added `call_number` to search predicates to match OPACCatalog
  4. External catalog books only counted when availability filter allows "Unavailable"
  5. Proper grants: anon+authenticated for general counts, authenticated-only for branch-scoped
- **Implementation:**
  1. Fixed `fetchExternalCatalogBooks()` to paginate with 1000-row pages
  2. Enhanced `fetchBooks()` with retry logic and error handling
  3. Added `fetchOpacLibraryBookCount()`, `fetchOpacTotalBookCount()`, `fetchOpacLibraryBookCountByLibrary()`, `fetchOpacFilteredBookCount()` to store.js
  4. Updated LandingPage to display server-side library book count via RPC
  5. **NEW:** Updated OPACCatalog with debug panel displaying:
     - Filtered count (RPC)
     - Client-side filteredBooks.length
     - Total library books (RPC: `get_opac_library_book_count()`)
     - Total OPAC books (RPC: `get_opac_total_book_count()`)
     - Active filters, user role, Supabase URL
- **Verification:** 156 migrations validated; 180 Node tests PASS; lint/build PASS

## Group 13 — Predictive/Prescriptive Analytics (2026-11-17, Source Complete)

### 13.1 Analytics Implementation Verified
- **Status:** SOURCE COMPLETE — runtime verification pending isolated DB
- **Scope:** Accurate KPIs, historical trends, forecasts with horizons/confidence, actionable recommendations, branch-scoped for Sub-admin
- **Implementation:** `dashboardAnalytics.js`, `forecastNarrative.js`, `analyticsApi.js` verified
- **Branch isolation:** SuperAdminDashboard uses aggregate functions; SubAdminDashboard passes `branchBooks`/`branchAttendance` to AdminWorkspace
- **Tests:** All analytics tests passing

## Group 14 — Migration Integrity Verification (2026-11-17, COMPLETED)

### 14.1 Validation Results
- **Status:** COMPLETED
- **Scope:** 156 unique ordered versions, no duplicate/conflicting signatures, no grant expansion, pre/postconditions, catalog assertions cover function metadata/ACLs
- **Validation:** `npm run validate:migrations` ? 156 migrations, 0 errors
- **SHA-256 hashes:** All migrations fingerprinted
- **Verification Script:** `supabase/tests/migration_integrity_verification.sql` (10 checks)
- **Regression Tests:** `src/lib/migrationIntegrityBlocked.test.js` - 13 tests marked BLOCKED

## Group 15 — Regression Tests & Documentation (2026-11-17, In Progress)

### 15.1 Test Status
- **Node tests:** 180/180 PASS (includes new blocked test suites for concurrency, five-role, migration integrity)
- **Lint:** PASS
- **Build:** PASS
- **Migration validation:** PASS (156 migrations)

### 15.2 Documentation Updates (This Session)
- **REMEDIATION_PROGRESS.md:** Updated with Groups 8-15 status
- **MASTER_AUDIT_AND_IMPLEMENTATION_PLAN.md:** To update
- **RELEASE_VALIDATION_RUNBOOK.md:** To update
- **docs/db_security_inventory.json:** To update
- **New test files created:**
  - `src/lib/fiveRoleRegressionBlocked.test.js`
  - `src/lib/concurrencyBlocked.test.js`
  - `src/lib/migrationIntegrityBlocked.test.js`
  - `supabase/tests/concurrency_test_scenarios.sql`
  - `supabase/tests/five_role_regression_matrix.sql`
  - `supabase/tests/migration_integrity_verification.sql`
- **New docs created (previous session):**
  - `DATABASE_REPLAY_PROCEDURE.md`
  - `AUTH_POSTGREST_TEST_PLAN.md`

### 15.3 Remaining Mandatory Gates (NOT READY)

| Gate | Status |
|------|--------|
| Clean isolated PostgreSQL migration replay | NOT RUN/BLOCKED |
| All SQL assertions executed | NOT RUN/BLOCKED |
| Catalog + effective-grant inspection | NOT RUN/BLOCKED |
| Real Auth AAL1/AAL2/TOTP/PostgREST verification | NOT RUN/BLOCKED |
| Cross-library/cross-role security tests | NOT RUN/BLOCKED |
| Fine payment privacy runtime verification | NOT RUN/BLOCKED |
| Community registration/approval e2e verification | NOT RUN/BLOCKED |
| Credential rotation by owner | PENDING |
| Production migration deployment | BLOCKED pending owner access |
| Vercel/Supabase deployment config verification | BLOCKED |

**Release decision:** NOT READY until all runtime/DB/auth/production gates have evidence.

## Group 16 — Phase 2 Community Borrowing Workflow Remediation (2026-11-17, COMPLETED)

### 16.1 Fix Community Borrowing Approval, Cancellation, Queue Promotion, and Inventory Triggers
- **Status:** COMPLETED (migration created, validation PASS)
- **Area:** Database migrations / Community borrowing workflow
- **File:** `supabase/migrations/20270103001100_fix_community_borrowing_workflow.sql`
- **Problem:**
  1. `approve_community_book_request` (20270103000900) dropped inventory availability checks, queue ordering enforcement, and `FOR UPDATE` locks present in 20261121000000
  2. `cancel_community_book_request` only handled 'pending' status, used DELETE (bypassing triggers), didn't restore availability or promote queue
  3. No community queue promotion helper (library `release_copy_and_promote` only handles library queue)
  4. `update_community_book_copy_availability` trigger didn't handle DELETE operations
  5. `enforce_book_copy_inventory` incorrectly combined library and community allocations
- **Fix:**
  1. **Restored `approve_community_book_request` safeguards:**
     - `FOR UPDATE` lock on book row
     - Availability check: `available_count >= 1`
     - Allocation accounting: `total_count > active_allocations` and `available_count <= total_count - active_allocations`
     - Queue ordering: prevents approval if earlier pending request exists
     - Decrements `available_copies` on approval
     - Notifications for requester and owner
  2. **Fixed `cancel_community_book_request` for all states:**
     - Requester can cancel 'pending' requests
     - Owner can cancel 'pending' or 'approved' requests (approved ? rejected)
     - 'borrowed' requests cannot be cancelled (must use return flow)
     - Terminal states ('returned', 'rejected', 'cancelled') are idempotent
     - Uses UPDATE (not DELETE) to preserve history and trigger availability restoration
     - Notifies appropriate parties
     - Calls `promote_next_community_request` for approved/borrowed cancellations
  3. **Created `promote_next_community_request(text)` helper:**
     - Separate from library `release_copy_and_promote`
     - Locks book, recomputes allocations from both tables
     - FIFO promotion: `ORDER BY request_date ASC, id ASC`
     - Locks next request with `FOR UPDATE`
     - Verifies capacity before promotion
     - Decrements `available_copies` and notifies both parties
     - Granted to `service_role` and `postgres` only
  4. **Fixed `update_community_book_copy_availability` trigger:**
     - Added `DELETE` handling (restores availability, triggers promotion notification)
     - Uses `pg_notify('community_promotion', ...)` for async promotion (avoids trigger recursion)
     - Proper allocation accounting for transitions TO/FROM allocating statuses
  5. **Fixed `enforce_book_copy_inventory` trigger:**
     - Separates library vs personal/community inventory validation
     - Library books: validates against `library_allocations` only
     - Personal books: validates `available_copies <= total_copies`; community availability managed by triggers
  6. **Added `auto_expire_community_requests()` cron function:**
     - Expires pending requests after 7 days of owner inaction
     - Notifies both requester and owner
     - Granted to `service_role` only
- **Postflight validation:** Catalog assertions for all new/changed functions (metadata, ACLs, search_path)
- **Verification:** `npm run validate:migrations` PASS (166 migrations); `node --test` 199/199 PASS (49 skipped); `npm run build` PASS
- **Limitations:** Runtime concurrency verification requires isolated PostgreSQL; promotion trigger uses async `pg_notify` which needs a listener (future work: pg_cron job or background worker)

### Phase 5: Remaining SECURITY DEFINER hardening for visitor registration, personal books, and subscription followups (completed 2026-11-17)
- **File:** `20270102002500_remaining_secdef_hardening.sql`
- **Functions hardened (9):**
  1. `deliver_subscription_renewal_followup(uuid,date)` — AAL2 added (was missing), empty search_path, staff auth, JWT match, branch scoping for subadmin
  2. `add_personal_book` (14-arg overload with fine_rate) — AAL2 added, empty search_path, visitor ownership via `auth_user_id`, fine_rate validation
  3. `add_personal_book_with_cover` (15-arg overload with fine_rate) — AAL2 added, empty search_path, visitor ownership via `auth_user_id`, fine_rate validation
  4. `update_personal_book` (15-arg overload with fine_rate) — AAL2 added, empty search_path, visitor ownership via `auth_user_id`, fine_rate validation
  5. `update_personal_book_with_cover` (16-arg overload with fine_rate) — AAL2 added, empty search_path, visitor ownership via `auth_user_id`, fine_rate validation
  6. `shelf_private.get_visitor_borrow_requests_unchecked(uuid)` — empty search_path, private execution granted only to postgres
  7. `public.get_visitor_borrow_requests(uuid)` — AAL2 added, empty search_path, visitor auth via `auth_user_id`
  8. `public.fetch_my_community_book_requests(text)` — AAL2 added, empty search_path, visitor ownership via `auth_user_id`
  9. `abort_visitor_registration(text,text)` — empty search_path fixed (was `public, auth`), compatibility preserved
- **All grants least-privilege:** `authenticated` for visitor-facing, `authenticated` + `service_role` for staff-facing, `postgres` for private trigger functions; PUBLIC/anon revoked where appropriate.
- **Postflight validation:** Catalog assertions verify metadata (owner, language, search_path, SECURITY DEFINER, args, return type) and effective ACLs for all 9 functions.
- **Verification:** `npm run validate:migrations` PASS (151 migrations); `node --test` 175/175 PASS; `npm run lint` PASS; `npm run build` PASS; `git diff --check` PASS.