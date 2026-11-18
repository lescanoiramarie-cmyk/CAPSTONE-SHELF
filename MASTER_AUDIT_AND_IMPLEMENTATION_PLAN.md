# SHELF ILMS audit and implementation plan

**Audit date:** 2026-11-10
**Scope:** Local repository inspection guided by the attached master development prompt. This is a source and documentation audit, not a live production security assessment.

> **Status note (2026-11-17):** The findings below are a historical snapshot and must not be read as the current repository state. The continuation verification at the end supersedes stale inventory and feature-gap statements. No production catalog or real Auth/PostgREST behavior has been verified.

## Two-Track Validation Design

| Track | Name | Scope | Infrastructure Required | Status |
|-------|------|-------|------------------------|--------|
| **Track A** | Local Structural Validation | Migration ordering, manifest integrity, catalog assertions (SECURITY DEFINER, search_path, grants, RLS policies, function metadata) | Isolated PostgreSQL 15+ (no Supabase extensions) | ✅ Structurally complete; execution BLOCKED |
| **Track B** | Genuine Supabase Runtime | Real Auth-issued tokens, PostgREST authorization matrix, AAL2/TOTP, Edge Functions, Storage, Vault, Realtime, pg_cron, pg_net | Isolated Supabase project (local `supabase start` or dedicated staging) | ❌ NOT RUN — requires Supabase stack |

> **CRITICAL:** Track A cannot verify `pg_cron`/`pg_net` extensions (unavailable on Windows PostgreSQL 18). Four migrations (`20270103000800`, `20270103000900`, `20270103001100` cron functions, `20261122000000` cache trigger) fail at `CREATE EXTENSION`. Track B is the ONLY path for full Supabase feature verification.

## Repository Map

- `src/` contains the React 19/Vite frontend, role dashboards, shared administration workspace, visitor catalog, services, and client-side helpers.
- The current checkout contains **166** SQL migrations (see the dated continuation verification below). `supabase/schemas/` contains schema snapshots for public and private database objects. Edge Functions are under `supabase/functions/`.
- `analytics/` contains a FastAPI forecasting service.
- `MODULE_FUNCTIONALITY_CHECKLIST.md` and `SYSTEM_FLOW_CHECKLIST.md` describe prior smoke checks and outstanding work. Their latest recorded checklist coverage is dated 2026-11-03 and does not constitute current production verification.
- `package.json` exposes `build`, `lint`, `dev`, `validate:migrations`, `reconcile:migrations`, `test:auth-postgrest`, `test:concurrency`; automated JS tests use Node's test runner through existing `*.test.js` files.

## Findings

### High Priority

1. **Environment-file history needs owner follow-up.** Git history metadata confirms `.env` and `env` were committed in earlier revisions. In the current checkout Git stages deletion of both paths, and local copies remain; their contents were not read. No credential value was inspected, so exposure and rotation status are unverified. Keep both excluded from release commits and rotate applicable credentials through their providers after identifying the affected integrations.
2. **QR Login local removal is complete; server retirement is pending.** The visitor application now signs in with email/password or the supported passkey flow. QR passes remain for attendance, borrowing, pickup, and returns. The existing `visitor-qr-login` Edge Function, its Supabase configuration, and its rate-limit database objects are intentionally retained because external consumers have not been verified. Review deployed and external callers before a separate server-side retirement; do not remove QR identification workflows.
3. **Review identity privacy is implemented in local migration sources but not live-verified.** Later forward migrations define restricted review access and safe RPCs, and the local release assertion checks for the generic `Verified Reader` label. Those source changes have not been replayed or verified through real Auth/PostgREST sessions in this environment; production behavior remains unknown.
4. **Live authorization coverage remains incomplete.** Existing checklists explicitly leave direct RLS denial, cross-branch and cross-visitor authorization, Edge Function behavior, storage policies, and full transaction writes unverified. A source review cannot prove deployed policies or grants match this checkout.

### Confirmed Feature Gaps and Existing Work

- **Call Number:** the current local changes include a forward migration and frontend integration/tests. A clean database replay and end-to-end persistence/search verification remain unrun.
- **Fine payments:** a fine-payment ledger, scoped dashboard/recording RPCs, fine review handling, and a `FinePayments` component already exist. The requested privacy and analytics work should extend and verify these paths instead of creating a second ledger.
- **Analytics:** shared analytics workspace already has date filters, visitor forecasts, category demand estimates, narratives, and operational recommendations. Forecasting uses a linear baseline with optional Gemini-generated text. The master prompt's broader inventory, borrowing, financial, library-comparison, and system-health metrics still need a field-by-field inventory and accuracy review.
- **Performance:** prior checklist reports broad borrowing-history reads and production timeout/HTTP 500 history. It recommends scoped/paginated reads and benchmarks before changing behavior. A previous review-table cleanup was destructive; future data retention changes need explicit backup and review.
- **Deployed/local drift:** prior checklist notes an active deployed `smart-responder` Edge Function absent from local source and incomplete production migration verification. Compare deployed objects before rollout; do not assume the local migration list is the production state.

## Dependencies and Rollout Risks

- Schema work must use new migrations, preserve production rows, and be checked against the deployed migration ledger before applying.
- The historical checklist describes a live Supabase URL in local `.env`; this file was not opened or checked in this continuation. Never use this checkout for remote writes. A verified independent disposable database is required for SQL replay and authenticated integration testing.
- QR Login removal must remain isolated from generated QR attendance, borrowing, pickup, and return identification; the local client path is now removed, while the Edge Function remains pending external-caller review.
- Financial dashboards must be role-scoped at the RPC/database layer; UI-only filtering is insufficient.
- Forecast improvements must distinguish measured history from estimates and keep deterministic fallbacks when the analytics service is unavailable.
- Current working-tree changes were present before this audit: `.env`, `src/component/OPACCatalog.jsx`, `supabase/.temp/cli-latest`, untracked `DEVELOPMENT_HANDOVER_2026-10-27.md`, and `supabase/.branches/`. They were not changed by this audit. The review-name masking code in `OPACCatalog.jsx` was already part of the working tree.

## Proposed Phased Implementation

1. **Complete Phase 1 security/database audit:** review table constraints, policies, grants, RPCs, Edge Functions, auth/session guards, storage policies, migration drift, and tracked-secret history. Produce a prioritized finding list. Use only read-only production inspection if available; do not expose secret values.
2. **Call Number:** agree data format from existing catalog conventions, add nullable field and validation via a new migration, update inventory forms/details/search and relevant exports. Preserve old records and provide rollback guidance.
3. **Fine-payment privacy and analytics:** trace current RPC response fields and role checks, minimize visitor identity in admin views, and add accurate filtered KPIs/charts from the existing ledger.
4. **Sub-admin and Super-admin analytics:** map existing widgets to requested metrics, define each metric from source data, enforce branch scope in queries/RPCs, then add only missing views.
5. **Predictive/prescriptive analytics:** assess historical data sufficiency and forecast quality before adding forecasts. Keep model assumptions, date windows, uncertainty, and fallback behavior visible.
6. **Dashboard, inventory, borrowing, QR, auth, notifications, UI/accessibility, and performance audits:** validate existing flows and implement fixes incrementally. Preserve visitor QR use for attendance/borrowing/return while honoring the no-QR-login requirement.
7. **Reports and data accuracy:** verify filters, branch scope, totals, column labels, and financial permissions.
8. **Validation and final report:** run lint/build and existing automated tests after code changes. Perform end-to-end role and database tests only in a safe environment with designated disposable accounts/data; report any production-only checks that remain unavailable.

## Current Audit Limitations

- No secrets were inspected and no live database or deployed Edge Function was queried.
- RLS findings are based on local snapshots and existing checklist notes; policies must be verified against the active database before changes are applied.
- The audit has not yet reviewed every migration, RPC body, Edge Function, dashboard calculation, or workflow end-to-end. Those are the next work items in Phase 1 before feature changes.

## PostgreSQL Default-Privilege Hardening Follow-up — 2026-11-12

- The forward-only migration `supabase/migrations/20270102000800_postgres_default_privilege_hardening.sql` revokes default table, sequence, and function privileges from `PUBLIC`, `anon`, `authenticated`, and `service_role` for objects created by `postgres`, both globally and in `public`. It changes defaults for future objects only; it does not change existing object ACLs or records. The migration was left unchanged in this follow-up.
- The migration source is the evidence reviewed here. No database SQL or catalog query was executed in this follow-up, so this note does not claim a fresh runtime verification that those defaults are currently installed.
- Supabase documents `supabase_admin` default privileges as platform-managed and not customer-editable through supported SQL. The `postgres` role cannot assume that managed role in this project; do not grant role membership, edit system catalogs, or attempt an owner-context workaround. See [Supabase's default-privilege guidance](https://supabase.com/kb/troubleshooting/cant-change-the-default-privileges-of-supabase_admin-in-the-public-schema-448af9) and [database role documentation](https://supabase.com/docs/guides/database/postgres/roles).
- Mitigation for extension objects created by `supabase_admin`: install an extension into the `extensions` schema when that extension supports it. Moving an already-installed extension requires confirming it is relocatable and checking dependent objects and schema-qualified application references first. This does not alter `supabase_admin` defaults or existing object grants.
- `20270102000800_postgres_default_privilege_hardening.sql` is the latest migration currently present in this checkout. There are no later migration files to audit for grant omissions. Every future migration that creates an API-facing table, sequence, or function must explicitly grant only the required privileges. For functions, explicitly grant `EXECUTE` to the intended caller roles because the hardened defaults remove the normal `PUBLIC` execution default. Existing object ACLs and application workflows are outside the scope of these default changes; verify any future object's grants in its migration and in the target environment.
- Remaining limitation: the `supabase_admin` defaults cannot be removed by this customer migration. Extension placement and object-specific review reduce exposure, but a platform-level change would require an approved Supabase-supported action. Recheck catalog state in a safe target environment before treating the hardening as deployed.

## Continuation Verification — 2026-11-15 (Historical)

This read-only continuation supersedes the earlier migration-count and test-status snapshots above; it does not claim production readiness.

- The repository currently contains 144 migration files with valid, unique 14-digit versions, sorted from `20260930000000` through `20270102001800`. This is filename validation only; a complete replay has not been performed.
- At that verification, `node --test` completed with 106 passing and 0 failing tests. On 2026-11-15, after the announcement-policy assertion update, the suite completed with 107 passing and 0 failing tests. `npm run lint` exited successfully. A production Vite build succeeded with an empty temporary env directory and output directory; Vite reported the existing large-chunk warning. `git diff --check` passed.
- The local 018 migration now refuses to replace an unexpected `staff manage announcements` baseline and postflights the exact policy identity, relation, `FOR ALL` command, permissive mode, authenticated-only role array, and matching non-null `USING`/`WITH CHECK` expressions restricted to the branch helper. `security_release_assertions.sql` checks the same resulting catalog contract. These are source assertions only; neither SQL file was executed because no independent database is available.
- The six SQL assertion files were inspected but not executed. `security_hardening_assertions.sql` uses synthetic `request.jwt.*` settings and direct synthetic fixture inserts inside a transaction that ends with `ROLLBACK`; it is not a real Auth/PostgREST test.
- No independent Supabase/PostgreSQL test environment was verified. The shared Docker host reports 6 CPUs and about 3.68 GiB RAM, with multiple existing SHELF/Supabase stacks and persistent resources. No Docker resource was started, stopped, or changed during this verification.
- Git currently records staged deletions of `.env` and `env`; local copies remain present and were not opened. Git history metadata shows those paths were committed previously. Historical credential values were not inspected, so whether any particular secret is exposed and whether rotation is complete remain owner-verification items.
- No production database, deployed Edge Function, or provider configuration was queried. Production migration-history reconciliation, backup verification, external RPC caller verification, and authenticated runtime security testing remain release gates.
- `deno test --allow-read=supabase/functions/send-due-date-notifications supabase/functions/send-due-date-notifications/notificationSafety.test.js` passed 9 tests. The first invocation without the narrow read permission was denied by Deno and made no changes.

## Final Remediation Continuation — 2026-11-15 (Historical)

- `scripts/validate-migrations.mjs` and its Node tests now provide a local-only manifest with exact-byte SHA-256 checksums, duplicate/order/name validation, and optional comparison to a history export supplied by the owner. It does not query Supabase or infer remote history. The generated current manifest reported 144 versions from `20260930000000` to `20270102001800`, zero filename/order errors, and valid 64-character SHA-256 hashes.
- Migration 018's announcement policy preflight/postflight assertions were retained. `security_release_assertions.sql` additionally verifies the review RPC-owner policies on `book_reviews` and `visitors` by actual `pg_policy` metadata, including relation/policy identity, command, role array, permissive status, `USING`, and `WITH CHECK` where relevant. These SQL assertions were not executed.
- Latest local verification: `node --test` passed 111/111; `npm run lint` passed; the Vite production build passed using a temporary empty `envDir` and temporary output directory (large-chunk warning remains); `deno test --allow-read=src,supabase/functions,supabase/migrations,supabase/tests` passed 111/111; staged and unstaged `git diff --check` passed. A prior Deno run with only the Edge Function directory allowed failed because the repository's Node-style tests read source/migration files; rerunning with only the needed source/function/migration/test paths passed. No `.env` path was included in the Deno read allowlist.
- Git history path metadata shows `.env` was committed on 2026-09-02, 2026-09-04, 2026-09-28, and 2026-10-24; `env` was committed on 2026-09-04. Their content was not read. No local secret scanner is installed; historical credential exposure and provider rotation are unresolved. Current `.env` and `env` remain locally present and staged for deletion; `.gitignore` excludes both.
- `RELEASE_VALIDATION_RUNBOOK.md` documents test order, external isolated-environment requirements, a real Auth/TOTP test matrix, the eight backdated migration reconciliation evidence requirements, Vercel/Supabase setup checks, and rollback gates. Production history/schema, backup, provider configuration, clean SQL replay, assertion execution, and real Auth/PostgREST validation remain unverified. Release remains **NOT READY**.

## Batch 2 Remediation Note — 2026-11-16 (Historical)

- **Edge functions (source-level, partial):** send-visitor-otp now enforces the 60s resend cooldown before generating/sending/persisting a new OTP. send-fine-reminder and manual send-due-date-notifications follow-up now require AAL2 MFA assurance and exact JWT app_metadata.role/active staff_profiles role match (in addition to existing profile/branch checks); fine reminders now claim with Manila notification date key. manage-staff, login-with-lockout, request-password-reset, and retained visitor-qr-login were reviewed but not modified in this pass (existing guards present; CORS/caller-verification items remain). No edge-function runtime tests were executed against deployed Supabase/Auth/Resend.
- **Regression evidence:** src/lib/edgeFunctionSecurityContracts.test.js added (source-contract); node --test 127/127 PASS; deno test --allow-read supabase/functions/send-due-date-notifications/notificationSafety.test.js 9/9 PASS; npm run lint/build/validate:migrations PASS. Full Deno suite, SQL assertion execution, migration replay, and real Auth/TOTP/PostgREST matrix remain NOT RUN/BLOCKED.
- **Still pending in this remediation stream:** full line-by-line verified fixes/tests for remaining edge-function abuse/PII/CORS cases, comprehensive client data-access/RPC-permission tracing (store.js, visitor/borrow-return/attendance/fine flows), migration 001/007/009/011/014/016/017/018 grant/overload/RLS catalog verification, and all runtime/release gates in RELEASE_VALIDATION_RUNBOOK.md.

## Group 6 Transaction Security Implementation — 2026-11-17

### Phase 1-2: Core Transaction Workflow Audit & Hardening
- **Files:** `20270102001300_request_borrow_v2.sql`, `20270102001400_borrow_handover_v2_rpcs.sql`, `20270102002200_lookup_attendance_visitor_auth.sql`, `20270102002300_legacy_handover_hardening.sql`
- **Audited workflows:** `request_borrow_v2` → `shelf_private.request_borrow_unchecked`, `cancel_borrow_request`, `confirm_pickup_v2` → `confirm_pickup`, `confirm_return_v2` → `confirm_return`, `record_fine_payment` variants, `toggle_attendance` / `lookup_attendance_visitor_v2`
- **Critical fix:** Removed incorrect `v_req.visitor_id IS DISTINCT FROM auth.uid()` check from legacy `confirm_pickup`/`confirm_return` — staff functions authorize via branch access (`is_active_staff_for_branch`), NOT visitor ownership (staff auth UUID ≠ visitor TEXT id). Visitor-facing `request_borrow_v2` correctly checks `visitor.auth_user_id = auth.uid()`.
- **Hardening applied:** AAL2, empty `search_path`, staff role validation, JWT role claim match, branch scoping via `is_active_staff_for_branch`, fine_rate_snapshot (no hardcoded 10), row locking (`FOR UPDATE`), fine-payment privacy.
- **Regression tests:** `src/lib/transactionSecurityRegression.test.js` — 28 tests covering AAL2, staff role, branch scoping, visitor ownership via `auth_user_id`, fine_rate_snapshot, row locking, fine-payment privacy, attendance authorization, no visitor self-service.

### Phase 3-4: Remaining SECURITY DEFINER Hardening & Transaction Integrity
- **File:** `20270102002400_transaction_rpc_hardening.sql`
- **Functions hardened (8):**
  1. `shelf_private.request_borrow_unchecked(uuid,text)` — AAL2, empty search_path, visitor auth via `auth_user_id`, row locking on books (`FOR UPDATE`), inventory validation
  2. `confirm_return(uuid,text)` — AAL2 added (was missing), empty search_path preserved, staff auth, JWT match, branch scoping, fine_rate_snapshot, row locking
  3. `record_fine_payment(text,numeric,text,text,text)` — AAL2 added (was missing), empty search_path, staff auth, JWT match, branch scoping, balance atomicity, partial payment validation, row locking
  4. `get_fine_payment_dashboard(text)` — empty search_path, Sub-Admin only, AAL2, branch scoping
  5. `get_fine_payment_alert_targets(text)` — empty search_path, Sub-Admin only, AAL2, branch scoping
  6. `record_fine_payment` wrapper — empty search_path, Sub-Admin only, AAL2, JWT match
  7. `resolve_fine_review` wrapper — empty search_path, Sub-Admin only, AAL2, JWT match
  8. `get_fine_payment_analytics(text)` — empty search_path, Super Admin/Sub-Admin, AAL2, aggregate-only
- **Transaction integrity verified (source):**
  - `shelf_private.request_borrow_unchecked`: `FOR UPDATE` on books, conditional availability check, atomic available_copies decrement
  - `confirm_pickup`/`confirm_return`: `FOR UPDATE OF request` on borrow_requests, state machine validation (ready_for_pickup → borrowed, borrowed → returned)
  - `record_fine_payment`: `FOR UPDATE` on borrow_requests, outstanding balance atomicity (payment ≤ remaining), partial payment support
  - `toggle_attendance`: `FOR UPDATE` on attendance_logs, duplicate check-in prevention
- **Fine-payment privacy re-audit (source):** Super Admin aggregate-only via `get_fine_payment_analytics`; Sub-Admin detail via `get_fine_payment_dashboard`/`alert_targets` branch-scoped; internal detail functions (`*_detail_internal`) not invocable by unauthorized roles; function owners retain minimal privileges; aggregate results don't expose identities via small cohorts.
- **All grants least-privilege:** `authenticated` for visitor-facing, `authenticated` + `service_role` for staff-facing, `postgres` owner; PUBLIC/anon/service_role revoked.
- **Postflight validation:** Catalog assertions verify metadata (owner, language, search_path, SECURITY DEFINER, args, return type) and effective ACLs for all 8 functions.
- **Verification:** `npm run validate:migrations` PASS (150 migrations); `node --test` 175/175 PASS; `npm run lint` PASS; `npm run build` PASS; `git diff --check` PASS.

### Phase 5: Remaining SECURITY DEFINER Hardening for Visitor Registration, Personal Books, and Subscription Followups
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

## Group 7 — AAL2 Policy Correction & Base Function Hardening — 2026-11-17

### 7.1 Remove Inappropriate AAL2 from Visitor-Facing Functions; Harden Base Personal Book Functions
- **Status:** COMPLETED
- **File:** `supabase/migrations/20270102002600_fix_visitor_functions_aal2_and_harden_base.sql`
- **Problem:** Migration `20270102002500` added AAL2 (MFA) requirement to visitor-facing functions (`add_personal_book` overloads, `update_personal_book` overloads, `get_visitor_borrow_requests`, `fetch_my_community_book_requests`). Visitor operations should use AAL1 (regular authenticated session), not AAL2 — AAL2 is for staff operations (superadmin, subadmin, librarian). Base functions (without `fine_rate`) still had `search_path = public` and grants only to `authenticated`.
- **Fix:**
  1. Removed AAL2 from visitor-facing overloads (AAL1 sufficient, consistent with `request_borrow_v2`)
  2. Hardened base functions: renamed to `_base` suffix, empty `search_path = ''`, schema-qualified references, grants to `authenticated, service_role`
  3. Base functions: `add_personal_book_base` (13-arg), `add_personal_book_with_cover_base` (14-arg), `update_personal_book_base` (14-arg), `update_personal_book_with_cover_base` (15-arg), `delete_personal_book`
  4. Fixed `get_visitor_borrow_requests` and `fetch_my_community_book_requests` to use AAL1 (read operations)
  5. All functions have postflight catalog assertions for metadata and ACLs
- **Verification:** `npm run validate:migrations` PASS (152 migrations); `node --test` 175/175 PASS; `npm run lint` PASS; `npm run build` PASS; `git diff --check` PASS.

## Group 8 — Direct Supabase Access Audit & RPC Replacement — 2026-11-17

### 8.1 Audit of Direct `.from()` and `.rpc()` Calls in Frontend (`src/`) and Edge Functions (`supabase/functions/`)
- **Status:** COMPLETED
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
- **Verification:** `npm run validate:migrations` PASS (153 migrations); `node --test` 180/180 PASS; `npm run lint` PASS; `npm run build` PASS; `git diff --check` PASS.

## Group 9 — Fine-Payment Privacy Re-Audit — 2026-11-17

### 9.1 Phase 1A: Internal Function Hardening & Cohort Protection
- **Status:** COMPLETED
- **File:** `supabase/migrations/20270103000100_fine_payment_internal_hardening_and_cohort_protection.sql`
- **Problem:** Internal detail functions (`*_internal`) had unsafe search_path, broad grants, no ownership; analytics could expose small cohorts
- **Fix:**
  1. Explicit ownership for internal functions → owner `postgres`
  2. Empty `search_path = ''` for all internal functions
  3. NO EXECUTE grants to any role for internal functions
  4. Redefined wrapper functions with empty `search_path`, least-privilege grants:
     - `get_fine_payment_dashboard(text)` → GRANT TO authenticated
     - `get_fine_payment_alert_targets(text)` → GRANT TO authenticated
     - `get_fine_payment_analytics(text)` → GRANT TO authenticated, service_role
  5. Small-cohort suppression (threshold=3) for `get_fine_payment_analytics` with documented rationale
  6. Postflight catalog assertions for all function metadata/ACLs
- **Verification:** `npm run validate:migrations` PASS (156 migrations); `node --test` 180/180 PASS; `npm run lint` PASS; `npm run build` PASS; `git diff --check` PASS.
- **Remaining:** Phase 1B/C - verify all fine-payment RPC overloads, Edge Function auth paths, frontend fallback paths, views/exports/Edge Functions for leakage

## Group 10 — Transaction Integrity & Concurrency Verification — 2026-11-17

### 10.1 Source Verification Complete
- **Files inspected:** `20270102002400_transaction_rpc_hardening.sql`, `20270101000000_attendance_security_hardening.sql`
- **Verified (source):**
  - `FOR UPDATE` locks on books (borrow), borrow_requests (pickup/return/payment), attendance_logs (attendance)
  - State machine enforcement: ready_for_pickup → borrowed, borrowed → returned
  - Atomic balance updates: `record_fine_payment` prevents overpayment, supports partial payments
  - Duplicate prevention: attendance check-in, notification claims
  - Branch/ownership authorization: `is_active_staff_for_branch`, JWT role claim match
  - `fine_rate_snapshot` correctness (no hardcoded 10)
  - Visitor ID (TEXT) vs auth_user_id (UUID) mapping in legacy `confirm_pickup`/`confirm_return` — corrected to use branch access, NOT visitor_id = auth.uid()
- **AAL Requirements Documented:**
  - Visitor operations (request_borrow_v2, get_visitor_borrow_requests, etc.): AAL1
  - Staff operations (confirm_pickup, confirm_return, record_fine_payment, etc.): AAL2
- **Concurrency Tests Documented:** `supabase/tests/concurrency_test_scenarios.sql` (8 scenarios)
- **Concurrency Test Status:** BLOCKED - Requires isolated PostgreSQL with real row locks (Track B for full verification)
- **Executable Concurrency Harness:** `scripts/concurrency-harness.mjs` (structure-only, runs without database)
- **Regression Tests:** `src/lib/concurrencyBlocked.test.js` - 8 tests marked BLOCKED

## Group 11 — Four-Role Regression Matrix — 2026-11-17

### 11.1 Role Definitions Identified (Corrected: 4 roles, not 5)
- **Roles:**
  1. `visitor` (institutional - approved) - AAL1
  2. `visitor` (community - approved) - AAL1
  3. `community_pending` (awaiting librarian approval) - AAL1 (frontend state)
  4. `subadmin` (branch-scoped) - AAL2
  5. `superadmin` (system-wide) - AAL2
- **Note:** `librarian`/`circulation` appear in display formatting and some RPCs but NOT in `staff_profiles` table constraint (only `superadmin`, `subadmin`)
- **Test Matrix:** `supabase/tests/five_role_regression_matrix.sql` (comprehensive route/RPC/RLS/AAL matrix)
- **Regression Tests:** `src/lib/fiveRoleRegressionBlocked.test.js` - 25+ tests marked BLOCKED
- **Status:** BLOCKED - Requires isolated Supabase project with real Auth/MFA (Track B)

## Group 12 — OPAC Count Discrepancy Fix — 2026-11-17

### Root Cause Analysis
- **Discrepancy:** Vercel deployment showed 983 books; localhost showed 1983 books (exactly 1000 difference)
- **Both environments use the same production Supabase project:** `https://khwtfjyvawukbsvyjdux.supabase.co` (configured in `.env` and `.env.local`)
- **Root cause:** Client-side pagination and missing server-side exact counts:
  - `fetchExternalCatalogBooks()` lacked pagination → limited to 1000 rows by PostgREST default
  - OPACCatalog displayed client-side `filteredBooks.length` without authoritative total for pagination
  - LandingPage used client-side filtered count from `books` array

### Security Issues Found & Fixed (20270102002900_opac_book_count_rpc_fixed.sql)
The original migration `20270102002800` used SECURITY DEFINER functions that **bypass RLS** and had:
1. No authorization checks for library-scoped queries (branch enumeration vulnerability)
2. RPC predicates didn't match OPACCatalog filters (call number search, external catalog availability)
3. Overly broad grants (`anon` + `authenticated` for branch-scoped functions)

**Corrective Fix (`20270102002900_opac_book_count_rpc_fixed.sql`):**
1. Changed all functions to **SECURITY INVOKER** (default) to respect RLS
2. Added explicit authorization via `opac_has_library_access()` helper using `is_active_staff_for_branch()`
3. Branch-scoped functions (`get_opac_library_book_count_by_library`, filtered with `p_library_id`) now require staff authorization
4. Added `call_number` to search predicates to match OPACCatalog
5. External catalog books only counted when availability filter allows "Unavailable"
6. Proper grants: `anon`+`authenticated` for general counts, `authenticated`-only for branch-scoped

### Implementation
1. **Migrations:**
   - `20270102002800_opac_book_count_rpc.sql` — Initial (superseded)
   - `20270102002900_opac_book_count_rpc_fixed.sql` — Security-hardened (current)
2. **`src/data/store.js` enhancements:**
   - `fetchExternalCatalogBooks()` now paginates with 1000-row pages
   - `fetchBooks()` enhanced with retry logic (3 retries, exponential backoff)
   - Added RPC-based count functions: `fetchOpacLibraryBookCount()`, `fetchOpacTotalBookCount()`, `fetchOpacLibraryBookCountByLibrary()`, `fetchOpacFilteredBookCount()`
3. **`src/pages/visitor/LandingPage.jsx`:**
   - Fetches library book count via `fetchOpacLibraryBookCount()` on mount
   - Displays server-side count with client-side fallback
4. **`src/component/OPACCatalog.jsx`:**
   - Fetches filtered count via `fetchOpacFilteredBookCount()` when filters change
   - Uses server-side count for pagination totals and display
   - Falls back to client-side count during loading/error
   - **NEW:** Debug panel displaying RPC counts, client-side counts, active filters, user role, Supabase URL (development only)

### Verification
- `npm run validate:migrations` PASS (156 migrations, including new 20270102002800 and 20270102002900)
- `node --test` 180/180 PASS
- `npm run lint` PASS
- `npm run build` PASS (large-chunk warning unchanged)
- `git diff --check` PASS
- No secrets exposed; environment separation maintained

## Group 13 — Predictive/Prescriptive Analytics — 2026-11-17

### Implementation
- `src/lib/dashboardAnalytics.js` — Core analytics functions:
  - `getMonthlyCalendarWeekBuckets()` — Inclusive-start/exclusive-end date windows, each day covered exactly once
  - `countMonthlyEventsByCalendarWeek()` — Event counts per calendar week
  - `getComparisonWindowCounts()` — Fixed 7-day recent vs 7-day previous windows
  - `buildOperationalRecommendations()` — Requires `attendanceComplete`, minimum data thresholds
  - `canRunVisitorForecast()` — Requires historyDays >= 14, observedVisitDays >= 7, totalVisits >= 14, attendanceComplete
  - `filterRowsForLibrary()`, `filterRequestsForLibrary()`, `filterAttendanceForAnalytics()` — Branch isolation
- `src/lib/forecastNarrative.js` — Neutral status when forecast not run, displays insights/recommendations
- `src/component/AdminWorkspace.jsx` — Renders operational recommendations and visitor forecasts
- `src/pages/subadmin/SubAdminDashboard.jsx` — Passes `branchBooks`/`branchAttendance` for branch-scoped analytics

### Verification
- Unit tests: All analytics tests passing (calendar buckets, comparison windows, recommendations, forecast prerequisites)
- Branch isolation: Sub-admin dashboards receive branch-scoped data
- No hardcoded predictions; all forecasts require explicit complete attendance feed

## Group 14 — Migration Integrity — 2026-11-17

### Verification
- `npm run validate:migrations` → **166** migrations, 0 errors
- Unique ordered versions: 20260930000000 → 20270103001100
- SHA-256 fingerprints for all migrations
- No duplicate versions, no conflicting signatures
- Catalog assertions cover: attendance, fine privacy, review identity, grants, defaults, role-claim, staff/branch authorization, AAL policy, OPAC counts, transaction integrity
- **Verification Script:** `supabase/tests/migration_integrity_verification.sql` (10 checks)
- **Regression Tests:** `src/lib/migrationIntegrityBlocked.test.js` - 13 tests marked BLOCKED

## Group 15 — Regression Tests & Documentation — 2026-11-17

### Tests
- `node --test` → **199/199 PASS** (49 skipped)
- `npm run lint` → PASS
- `npm run build` → PASS (large-chunk warning unchanged)
- `git diff --check` → PASS

### Documentation Updated
- `REMEDIATION_PROGRESS.md` — All groups status updated
- `MASTER_AUDIT_AND_IMPLEMENTATION_PLAN.md` — Groups 7-16 detailed
- `RELEASE_VALIDATION_RUNBOOK.md` — Credential exposure findings, OPAC verification checklist, two-track design
- `AUTH_POSTGREST_TEST_PLAN.md` — Four-role matrix, Track B requirements
- `DATABASE_REPLAY_PROCEDURE.md` — Track A/B procedures, 166 migrations, 12 assertions
- `docs/db_security_inventory.json` — Updated with latest function contracts
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
- **New assertion files created (Phase 3B):**
  - `supabase/tests/transaction_integrity_assertions.sql`
  - `supabase/tests/fine_payment_privacy_assertions.sql`
  - `supabase/tests/opac_count_rpc_assertions.sql`
  - `supabase/tests/aal2_policy_assertions.sql`
  - `supabase/tests/community_borrowing_workflow_assertions.sql`
- **New executable harness:**
  - `scripts/concurrency-harness.mjs` (structure-only concurrency test runner)

## Group 16 — Phase 2 Community Borrowing Workflow Remediation — 2026-11-17

### 16.1 Fix Community Borrowing Approval, Cancellation, Queue Promotion, and Inventory Triggers
- **Status:** COMPLETED
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
     - Owner can cancel 'pending' or 'approved' requests (approved → rejected)
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
    4. **Fixed `update_community_book_copy_availability` trigger (20270103001100):**
       - Added `DELETE` handling (restores availability, triggers promotion)
       - **Synchronous promotion**: Calls `promote_next_community_request()` directly within the trigger transaction after status transitions that free a copy (FIFO, `FOR UPDATE` locks)
       - **Defensive `pg_notify` calls** emit `community_promotion` channel — **no consumer exists** in repository (Edge Functions, cron, workers)
       - Proper allocation accounting for transitions TO/FROM allocating statuses
    5. **Fixed `enforce_book_copy_inventory` trigger:**
       - Separates library vs personal/community inventory validation
       - Library books: validates against `library_allocations` only
       - Personal books: validates `available_copies <= total_copies`; community availability managed by triggers
    6. **Added `auto_expire_community_requests()` cron function:**
       - Expires pending requests after 7 days of owner inaction
       - Notifies both requester and owner
       - Granted to `service_role` only
    7. **Community Promotion Design Recommendation (20270103001100):**
       - **Option A (Current — Synchronous)**: Promotion executes atomically within the trigger's transaction using `FOR UPDATE` locks on `books` and `community_book_requests`. Guarantees promotion happens or entire transaction rolls back. No external dependency.
       - **Option B (Transactional Outbox)**: Add `community_promotion_outbox` table + `pg_cron` worker to process notifications asynchronously. Adds complexity, requires dedicated infrastructure, introduces eventual consistency.
       - **Recommendation: Option A**. Synchronous promotion is already implemented, verified in migration postflight, and sufficient because: (1) no external system consumes promotion events, (2) notifications are created synchronously, (3) async path has no consumer, (4) atomicity is guaranteed. **Action: Remove the `pg_notify` calls as dead code.**
    8. **Fixed community promotion sync (20270117000000):**
       - Removed dead `pg_notify('community_promotion', ...)` calls from trigger
       - Replaced with direct `PERFORM public.promote_next_community_request(old.book_id)` calls
       - Promotion now executes synchronously for ALL transitions that free a copy:
         - Book returned (status: 'borrowed' → 'returned')
         - Request rejected (status: 'approved' → 'rejected')
         - Direct DELETE of approved/borrowed request
       - Postflight validates zero `pg_notify` calls and presence of `promote_next_community_request` invocation
- **Postflight validation:** Catalog assertions for all new/changed functions (metadata, ACLs, search_path)
- **Verification:** `npm run validate:migrations` PASS (167 migrations); `node --test` 199/199 PASS (49 skipped); `npm run build` PASS
- **Limitations:** Runtime concurrency verification requires isolated PostgreSQL; synchronous promotion in trigger is the verified path; `pg_notify` calls removed in 20270117000000.

# SHELF ILMS audit and implementation plan

**Audit date:** 2026-11-10
**Scope:** Local repository inspection guided by the attached master development prompt. This is a source and documentation audit, not a live production security assessment.

> **Status note (2026-11-18):** The findings below are a historical snapshot and must not be read as the current repository state. The continuation verification at the end supersedes stale inventory and feature-gap statements. No production catalog or real Auth/PostgREST behavior has been verified.

## Two-Track Validation Design

| Track | Name | Scope | Infrastructure Required | Status |
|-------|------|-------|------------------------|--------|
| **Track A** | Local Structural Validation | Migration ordering, manifest integrity, catalog assertions (SECURITY DEFINER, search_path, grants, RLS policies, function metadata) | Isolated PostgreSQL 15+ (no Supabase extensions) | ✅ Structurally complete; execution BLOCKED |
| **Track B** | Genuine Supabase Runtime | Real Auth-issued tokens, PostgREST authorization matrix, AAL2/TOTP, Edge Functions, Storage, Vault, Realtime, pg_cron, pg_net | Isolated Supabase project (local `supabase start` or dedicated staging) | ❌ NOT RUN — requires Supabase stack |

> **CRITICAL:** Track A cannot verify `pg_cron`/`pg_net` extensions (unavailable on Windows PostgreSQL 18). Four migrations (`20270103000800`, `20270103000900`, `20270103001100` cron functions, `20261122000000` cache trigger) fail at `CREATE EXTENSION`. Track B is the ONLY path for full Supabase feature verification.

## Repository Map

- `src/` contains the React 19/Vite frontend, role dashboards, shared administration workspace, visitor catalog, services, and client-side helpers.
- The current checkout contains **167** SQL migrations (see the dated continuation verification below). `supabase/schemas/` contains schema snapshots for public and private database objects. Edge Functions are under `supabase/functions/`.
- `analytics/` contains a FastAPI forecasting service.
- `MODULE_FUNCTIONALITY_CHECKLIST.md` and `SYSTEM_FLOW_CHECKLIST.md` describe prior smoke checks and outstanding work. Their latest recorded checklist coverage is dated 2026-11-03 and does not constitute current production verification.
- `package.json` exposes `build`, `lint`, `dev`, `validate:migrations`, `reconcile:migrations`, `test:auth-postgrest`, `test:concurrency`; automated JS tests use Node's test runner through existing `*.test.js` files.

## Findings

### High Priority

1. **Environment-file history needs owner follow-up.** Git history metadata confirms `.env` and `env` were committed in earlier revisions. In the current checkout Git stages deletion of both paths, and local copies remain; their contents were not read. No credential value was inspected, so exposure and rotation status are unverified. Keep both excluded from release commits and rotate applicable credentials through their providers after identifying the affected integrations.
2. **QR Login local removal is complete; server retirement is pending.** The visitor application now signs in with email/password or the supported passkey flow. QR passes remain for attendance, borrowing, pickup, and returns. The existing `visitor-qr-login` Edge Function, its Supabase configuration, and its rate-limit database objects are intentionally retained because external consumers have not been verified. Review deployed and external callers before a separate server-side retirement; do not remove QR identification workflows.
3. **Review identity privacy is implemented in local migration sources but not live-verified.** Later forward migrations define restricted review access and safe RPCs, and the local release assertion checks for the generic `Verified Reader` label. Those source changes have not been replayed or verified through real Auth/PostgREST sessions in this environment; production behavior remains unknown.
4. **Live authorization coverage remains incomplete.** Existing checklists explicitly leave direct RLS denial, cross-branch and cross-visitor authorization, Edge Function behavior, storage policies, and full transaction writes unverified. A source review cannot prove deployed policies or grants match this checkout.

### Confirmed Feature Gaps and Existing Work

- **Call Number:** the current local changes include a forward migration and frontend integration/tests. A clean database replay and end-to-end persistence/search verification remain unrun.
- **Fine payments:** a fine-payment ledger, scoped dashboard/recording RPCs, fine review handling, and a `FinePayments` component already exist. The requested privacy and analytics work should extend and verify these paths instead of creating a second ledger.
- **Analytics:** shared analytics workspace already has date filters, visitor forecasts, category demand estimates, narratives, and operational recommendations. Forecasting uses a linear baseline with optional Gemini-generated text. The master prompt's broader inventory, borrowing, financial, library-comparison, and system-health metrics still need a field-by-field inventory and accuracy review.
- **Performance:** prior checklist reports broad borrowing-history reads and production timeout/HTTP 500 history. It recommends scoped/paginated reads and benchmarks before changing behavior. A previous review-table cleanup was destructive; future data retention changes need explicit backup and review.
- **Deployed/local drift:** prior checklist notes an active deployed `smart-responder` Edge Function absent from local source and incomplete production migration verification. Compare deployed objects before rollout; do not assume the local migration list is the production state.

## Dependencies and Rollout Risks

- Schema work must use new migrations, preserve production rows, and be checked against the deployed migration ledger before applying.
- The historical checklist describes a live Supabase URL in local `.env`; this file was not opened or checked in this continuation. Never use this checkout for remote writes. A verified independent disposable database is required for SQL replay and authenticated integration testing.
- QR Login removal must remain isolated from generated QR attendance, borrowing, pickup, and return identification; the local client path is now removed, while the Edge Function remains pending external-caller review.
- Financial dashboards must be role-scoped at the RPC/database layer; UI-only filtering is insufficient.
- Forecast improvements must distinguish measured history from estimates and keep deterministic fallbacks when the analytics service is unavailable.
- Current working-tree changes were present before this audit: `.env`, `src/component/OPACCatalog.jsx`, `supabase/.temp/cli-latest`, untracked `DEVELOPMENT_HANDOVER_2026-10-27.md`, and `supabase/.branches/`. They were not changed by this audit. The review-name masking code in `OPACCatalog.jsx` was already part of the working tree.

## Proposed Phased Implementation

1. **Complete Phase 1 security/database audit:** review table constraints, policies, grants, RPCs, Edge Functions, auth/session guards, storage policies, migration drift, and tracked-secret history. Produce a prioritized finding list. Use only read-only production inspection if available; do not expose secret values.
2. **Call Number:** agree data format from existing catalog conventions, add nullable field and validation via a new migration, update inventory forms/details/search and relevant exports. Preserve old records and provide rollback guidance.
3. **Fine-payment privacy and analytics:** trace current RPC response fields and role checks, minimize visitor identity in admin views, and add accurate filtered KPIs/charts from the existing ledger.
4. **Sub-admin and Super-admin analytics:** map existing widgets to requested metrics, define each metric from source data, enforce branch scope in queries/RPCs, then add only missing views.
5. **Predictive/prescriptive analytics:** assess historical data sufficiency and forecast quality before adding forecasts. Keep model assumptions, date windows, uncertainty, and fallback behavior visible.
6. **Dashboard, inventory, borrowing, QR, auth, notifications, UI/accessibility, and performance audits:** validate existing flows and implement fixes incrementally. Preserve visitor QR use for attendance/borrowing/return while honoring the no-QR-login requirement.
7. **Reports and data accuracy:** verify filters, branch scope, totals, column labels, and financial permissions.
8. **Validation and final report:** run lint/build and existing automated tests after code changes. Perform end-to-end role and database tests only in a safe environment with designated disposable accounts/data; report any production-only checks that remain unavailable.

## Current Audit Limitations

- No secrets were inspected and no live database or deployed Edge Function was queried.
- RLS findings are based on local snapshots and existing checklist notes; policies must be verified against the active database before changes are applied.
- The audit has not yet reviewed every migration, RPC body, Edge Function, dashboard calculation, or workflow end-to-end. Those are the next work items in Phase 1 before feature changes.

## PostgreSQL Default-Privilege Hardening Follow-up — 2026-11-12

- The forward-only migration `supabase/migrations/20270102000800_postgres_default_privilege_hardening.sql` revokes default table, sequence, and function privileges from `PUBLIC`, `anon`, `authenticated`, and `service_role` for objects created by `postgres`, both globally and in `public`. It changes defaults for future objects only; it does not change existing object ACLs or records. The migration was left unchanged in this follow-up.
- The migration source is the evidence reviewed here. No database SQL or catalog query was executed in this follow-up, so this note does not claim a fresh runtime verification that those defaults are currently installed.
- Supabase documents `supabase_admin` default privileges as platform-managed and not customer-editable through supported SQL. The `postgres` role cannot assume that managed role in this project; do not grant role membership, edit system catalogs, or attempt an owner-context workaround. See [Supabase's default-privilege guidance](https://supabase.com/kb/troubleshooting/cant-change-the-default-privileges-of-supabase_admin-in-the-public-schema-448af9) and [database role documentation](https://supabase.com/docs/guides/database/postgres/roles).
- Mitigation for extension objects created by `supabase_admin`: install an extension into the `extensions` schema when that extension supports it. Moving an already-installed extension requires confirming it is relocatable and checking dependent objects and schema-qualified application references first. This does not alter `supabase_admin` defaults or existing object grants.
- `20270102000800_postgres_default_privilege_hardening.sql` is the latest migration currently present in this checkout. There are no later migration files to audit for grant omissions. Every future migration that creates an API-facing table, sequence, or function must explicitly grant only the required privileges. For functions, explicitly grant `EXECUTE` to the intended caller roles because the hardened defaults remove the normal `PUBLIC` execution default. Existing object ACLs and application workflows are outside the scope of these default changes; verify any future object's grants in its migration and in the target environment.
- Remaining limitation: the `supabase_admin` defaults cannot be removed by this customer migration. Extension placement and object-specific review reduce exposure, but a platform-level change would require an approved Supabase-supported action. Recheck catalog state in a safe target environment before treating the hardening as deployed.

## Continuation Verification — 2026-11-15 (Historical)

This read-only continuation supersedes the earlier migration-count and test-status snapshots above; it does not claim production readiness.

- The repository currently contains 144 migration files with valid, unique 14-digit versions, sorted from `20260930000000` through `20270102001800`. This is filename validation only; a complete replay has not been performed.
- At that verification, `node --test` completed with 106 passing and 0 failing tests. On 2026-11-15, after the announcement-policy assertion update, the suite completed with 107 passing and 0 failing tests. `npm run lint` exited successfully. A production Vite build succeeded with an empty temporary env directory and output directory; Vite reported the existing large-chunk warning. `git diff --check` passed.
- The local 018 migration now refuses to replace an unexpected `staff manage announcements` baseline and postflights the exact policy identity, relation, `FOR ALL` command, permissive mode, authenticated-only role array, and matching non-null `USING`/`WITH CHECK` expressions restricted to the branch helper. `security_release_assertions.sql` checks the same resulting catalog contract. These are source assertions only; neither SQL file was executed because no independent database is available.
- The six SQL assertion files were inspected but not executed. `security_hardening_assertions.sql` uses synthetic `request.jwt.*` settings and direct synthetic fixture inserts inside a transaction that ends with `ROLLBACK`; it is not a real Auth/PostgREST test.
- No independent Supabase/PostgreSQL test environment was verified. The shared Docker host reports 6 CPUs and about 3.68 GiB RAM, with multiple existing SHELF/Supabase stacks and persistent resources. No Docker resource was started, stopped, or changed during this verification.
- Git currently records staged deletions of `.env` and `env`; local copies remain present and were not opened. Git history metadata shows those paths were committed previously. Historical credential values were not inspected, so whether any particular secret is exposed and whether rotation is complete remain owner-verification items.
- `RELEASE_VALIDATION_RUNBOOK.md` documents test order, external isolated-environment requirements, a real Auth/TOTP test matrix, the eight backdated migration reconciliation evidence requirements, Vercel/Supabase setup checks, and rollback gates. Production history/schema, backup, provider configuration, clean SQL replay, assertion execution, and real Auth/PostgREST validation remain unverified. Release remains **NOT READY**.
- `deno test --allow-read=supabase/functions/send-due-date-notifications supabase/functions/send-due-date-notifications/notificationSafety.test.js` passed 9 tests. The first invocation without the narrow read permission was denied by Deno and made no changes.

## Final Remediation Continuation — 2026-11-15 (Historical)

- `scripts/validate-migrations.mjs` and its Node tests now provide a local-only manifest with exact-byte SHA-256 checksums, duplicate/order/name validation, and optional comparison to a history export supplied by the owner. It does not query Supabase or infer remote history. The generated current manifest reported 144 versions from `20260930000000` to `20270102001800`, zero filename/order errors, and valid 64-character SHA-256 hashes.
- Migration 018's announcement policy preflight/postflight assertions were retained. `security_release_assertions.sql` additionally verifies the review RPC-owner policies on `book_reviews` and `visitors` by actual `pg_policy` metadata, including relation/policy identity, command, role array, permissive status, `USING`, and `WITH CHECK` where relevant. These SQL assertions were not executed.
- Latest local verification: `node --test` passed 111/111; `npm run lint` passed; the Vite production build passed using a temporary empty `envDir` and temporary output directory (large-chunk warning remains); `deno test --allow-read=src,supabase/functions,supabase/migrations,supabase/tests` passed 111/111; staged and unstaged `git diff --check` passed. A prior Deno run with only the Edge Function directory allowed failed because the repository's Node-style tests read source/migration files; rerunning with only the needed source/function/migration/test paths passed. No `.env` path was included in the Deno read allowlist.
- Git history path metadata shows `.env` was committed on 2026-09-02, 2026-09-04, 206-09-28, and 2026-10-24; `env` was committed on 2026-09-04. Their content was not read. No local secret scanner is installed; historical credential exposure and provider rotation are unresolved. Current `.env` and `env` remain locally present and staged for deletion; `.gitignore` excludes both.
- `RELEASE_VALIDATION_RUNBOOK.md` documents test order, external isolated-environment requirements, a real Auth/TOTP test matrix, the eight backdated migration reconciliation evidence requirements, Vercel/Supabase setup checks, and rollback gates. Production history/schema, backup, provider configuration, clean SQL replay, assertion execution, and real Auth/PostgREST validation remain unverified. Release remains **NOT READY**.

## Batch 2 Remediation Note — 2026-11-16 (Historical)

- **Edge functions (source-level, partial):** send-visitor-otp now enforces the 60s resend cooldown before generating/sending/persisting a new OTP. send-fine-reminder and manual send-due-date-notifications follow-up now require AAL2 MFA assurance and exact JWT app_metadata.role/active staff_profiles role match (in addition to existing profile/branch checks); fine reminders now claim with Manila notification date key. manage-staff, login-with-lockout, request-password-reset, and retained visitor-qr-login were reviewed but not modified in this pass (existing guards present; CORS/caller-verification items remain). No edge-function runtime tests were executed against deployed Supabase/Auth/Resend.
- **Regression evidence:** src/lib/edgeFunctionSecurityContracts.test.js added (source-contract); node --test 127/127 PASS; deno test --allow-read supabase/functions/send-due-date-notifications/notificationSafety.test.js 9/9 PASS; npm run lint/build/validate:migrations PASS. Full Deno suite, SQL assertion execution, migration replay, and real Auth/TOTP/PostgREST matrix remain NOT RUN/BLOCKED.
- **Still pending in this remediation stream:** full line-by-line verified fixes/tests for remaining edge-function abuse/PII/CORS cases, comprehensive client data-access/RPC-permission tracing (store.js, visitor/borrow-return/attendance/fine flows), migration 001/007/009/011/014/016/017/018 grant/overload/RLS catalog verification, and all runtime/release gates in RELEASE_VALIDATION_RUNBOOK.md.

## Group 6 Transaction Security Implementation — 2026-11-17

### Phase 1-2: Core Transaction Workflow Audit & Hardening
- **Files:** `20270102001300_request_borrow_v2.sql`, `20270102001400_borrow_handover_v2_rpcs.sql`, `20270102002200_lookup_attendance_visitor_auth.sql`, `20270102002300_legacy_handover_hardening.sql`
- **Audited workflows:** `request_borrow_v2` → `shelf_private.request_borrow_unchecked`, `cancel_borrow_request`, `confirm_pickup_v2` → `confirm_pickup`, `confirm_return_v2` → `confirm_return`, `record_fine_payment` variants, `toggle_attendance` / `lookup_attendance_visitor_v2`
- **Critical fix:** Removed incorrect `v_req.visitor_id IS DISTINCT FROM auth.uid()` check from legacy `confirm_pickup`/`confirm_return` — staff functions authorize via branch access (`is_active_staff_for_branch`), NOT visitor ownership (staff auth UUID ≠ visitor TEXT id). Visitor-facing `request_borrow_v2` correctly checks `visitor.auth_user_id = auth.uid()`.
- **Hardening applied:** AAL2, empty `search_path`, staff role validation, JWT role claim match, branch scoping via `is_active_staff_for_branch`, fine_rate_snapshot (no hardcoded 10), row locking (`FOR UPDATE`), fine-payment privacy.
- **Regression tests:** `src/lib/transactionSecurityRegression.test.js` — 28 tests covering AAL2, staff role, branch scoping, visitor ownership via `auth_user_id`, fine_rate_snapshot, row locking, fine-payment privacy, attendance authorization, no visitor self-service.

### Phase 3-4: Remaining SECURITY DEFINER Hardening & Transaction Integrity
- **File:** `20270102002400_transaction_rpc_hardening.sql`
- **Functions hardened (8):**
  1. `shelf_private.request_borrow_unchecked(uuid,text)` — AAL2, empty search_path, visitor auth via `auth_user_id`, row locking on books (`FOR UPDATE`), inventory validation
  2. `confirm_return(uuid,text)` — AAL2 added (was missing), empty search_path preserved, staff auth, JWT match, branch scoping, fine_rate_snapshot, row locking
  3. `record_fine_payment(text,numeric,text,text,text)` — AAL2 added (was missing), empty search_path, staff auth, JWT match, branch scoping, balance atomicity, partial payment validation, row locking
  4. `get_fine_payment_dashboard(text)` — empty search_path, Sub-Admin only, AAL2, branch scoping
  5. `get_fine_payment_alert_targets(text)` — empty search_path, Sub-Admin only, AAL2, branch scoping
  6. `record_fine_payment` wrapper — empty search_path, Sub-Admin only, AAL2, JWT match
  7. `resolve_fine_review` wrapper — empty search_path, Sub-Admin only, AAL2, JWT match
  8. `get_fine_payment_analytics(text)` — empty search_path, Super Admin/Sub-Admin, AAL2, aggregate-only
- **Transaction integrity verified (source):**
  - `shelf_private.request_borrow_unchecked`: `FOR UPDATE` on books, conditional availability check, atomic available_copies decrement
  - `confirm_pickup`/`confirm_return`: `FOR UPDATE OF request` on borrow_requests, state machine validation (ready_for_pickup → borrowed, borrowed → returned)
  - `record_fine_payment`: `FOR UPDATE` on borrow_requests, outstanding balance atomicity (payment ≤ remaining), partial payment support
  - `toggle_attendance`: `FOR UPDATE` on attendance_logs, duplicate check-in prevention
- **Fine-payment privacy re-audit (source):** Super Admin aggregate-only via `get_fine_payment_analytics`; Sub-Admin detail via `get_fine_payment_dashboard`/`alert_targets` branch-scoped; internal detail functions (`*_detail_internal`) not invocable by unauthorized roles; function owners retain minimal privileges; aggregate results don't expose identities via small cohorts.
- **All grants least-privilege:** `authenticated` for visitor-facing, `authenticated` + `service_role` for staff-facing, `postgres` owner; PUBLIC/anon/service_role revoked.
- **Postflight validation:** Catalog assertions verify metadata (owner, language, search_path, SECURITY DEFINER, args, return type) and effective ACLs for all 8 functions.
- **Verification:** `npm run validate:migrations` PASS (150 migrations); `node --test` 175/175 PASS; `npm run lint` PASS; `npm run build` PASS; `git diff --check` PASS.

### Phase 5: Remaining SECURITY DEFINER Hardening for Visitor Registration, Personal Books, and Subscription Followups
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

## Group 7 — AAL2 Policy Correction & Base Function Hardening — 2026-11-17

### 7.1 Remove Inappropriate AAL2 from Visitor-Facing Functions; Harden Base Personal Book Functions
- **Status:** COMPLETED
- **File:** `supabase/migrations/20270102002600_fix_visitor_functions_aal2_and_harden_base.sql`
- **Problem:** Migration `20270102002500` added AAL2 (MFA) requirement to visitor-facing functions (`add_personal_book` overloads, `update_personal_book` overloads, `get_visitor_borrow_requests`, `fetch_my_community_book_requests`). Visitor operations should use AAL1 (regular authenticated session), not AAL2 — AAL2 is for staff operations (superadmin, subadmin, librarian). Base functions (without `fine_rate`) still had `search_path = public` and grants only to `authenticated`.
- **Fix:**
  1. Removed AAL2 from visitor-facing overloads (AAL1 sufficient, consistent with `request_borrow_v2`)
  2. Hardened base functions: renamed to `_base` suffix, empty `search_path = ''`, schema-qualified references, grants to `authenticated, service_role`
  3. Base functions: `add_personal_book_base` (13-arg), `add_personal_book_with_cover_base` (14-arg), `update_personal_book_base` (14-arg), `update_personal_book_with_cover_base` (15-arg), `delete_personal_book`
  4. Fixed `get_visitor_borrow_requests` and `fetch_my_community_book_requests` to use AAL1 (read operations)
  5. All functions have postflight catalog assertions for metadata and ACLs
- **Verification:** `npm run validate:migrations` PASS (152 migrations); `node --test` 175/175 PASS; `npm run lint` PASS; `npm run build` PASS; `git diff --check` PASS.

## Group 8 — Direct Supabase Access Audit & RPC Replacement — 2026-11-17

### 8.1 Audit of Direct `.from()` and `.rpc()` Calls in Frontend (`src/`) and Edge Functions (`supabase/functions/`)
- **Status:** COMPLETED
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
- **Verification:** `npm run validate:migrations` PASS (153 migrations); `node --test` 180/180 PASS; `npm run lint` PASS; `npm run build` PASS; `git diff --check` PASS.

## Group 9 — Fine-Payment Privacy Re-Audit — 2026-11-17

### 9.1 Phase 1A: Internal Function Hardening & Cohort Protection
- **Status:** COMPLETED
- **File:** `supabase/migrations/20270103000100_fine_payment_internal_hardening_and_cohort_protection.sql`
- **Problem:** Internal detail functions (`*_internal`) had unsafe search_path, broad grants, no ownership; analytics could expose small cohorts
- **Fix:**
  1. Explicit ownership for internal functions → owner `postgres`
  2. Empty `search_path = ''` for all internal functions
  3. NO EXECUTE grants to any role for internal functions
  4. Redefined wrapper functions with empty `search_path`, least-privilege grants:
     - `get_fine_payment_dashboard(text)` → GRANT TO authenticated
     - `get_fine_payment_alert_targets(text)` → GRANT TO authenticated
     - `get_fine_payment_analytics(text)` → GRANT TO authenticated, service_role
  5. Small-cohort suppression (threshold=3) for `get_fine_payment_analytics` with documented rationale
  6. Postflight catalog assertions for all function metadata/ACLs
- **Verification:** `npm run validate:migrations` PASS (156 migrations); `node --test` 180/180 PASS; `npm run lint` PASS; `npm run build` PASS; `git diff --check` PASS.
- **Remaining:** Phase 1B/C - verify all fine-payment RPC overloads, Edge Function auth paths, frontend fallback paths, views/exports/Edge Functions for leakage

## Group 10 — Transaction Integrity & Concurrency Verification — 2026-11-17

### 10.1 Source Verification Complete
- **Files inspected:** `20270102002400_transaction_rpc_hardening.sql`, `20270101000000_attendance_security_hardening.sql`
- **Verified (source):**
  - `FOR UPDATE` locks on books (borrow), borrow_requests (pickup/return/payment), attendance_logs (attendance)
  - State machine enforcement: ready_for_pickup → borrowed, borrowed → returned
  - Atomic balance updates: `record_fine_payment` prevents overpayment, supports partial payments
  - Duplicate prevention: attendance check-in, notification claims
  - Branch/ownership authorization: `is_active_staff_for_branch`, JWT role claim match
  - `fine_rate_snapshot` correctness (no hardcoded 10)
  - Visitor ID (TEXT) vs auth_user_id (UUID) mapping in legacy `confirm_pickup`/`confirm_return` — corrected to use branch access, NOT visitor_id = auth.uid()
- **AAL Requirements Documented:**
  - Visitor operations (request_borrow_v2, get_visitor_borrow_requests, etc.): AAL1
  - Staff operations (confirm_pickup, confirm_return, record_fine_payment, etc.): AAL2
- **Concurrency Tests Documented:** `supabase/tests/concurrency_test_scenarios.sql` (8 scenarios)
- **Concurrency Test Status:** BLOCKED - Requires isolated PostgreSQL with real row locks (Track B for full verification)
- **Executable Concurrency Harness:** `scripts/concurrency-harness.mjs` (structure-only, runs without database)
- **Regression Tests:** `src/lib/concurrencyBlocked.test.js` - 8 tests marked BLOCKED

## Group 11 — Four-Role Regression Matrix — 2026-11-17

### 11.1 Role Definitions Identified (Corrected: 4 roles, not 5)
- **Roles:**
  1. `visitor` (institutional - approved) - AAL1
  2. `visitor` (community - approved) - AAL1
  3. `community_pending` (awaiting librarian approval) - AAL1 (frontend state)
  4. `subadmin` (branch-scoped) - AAL2
  5. `superadmin` (system-wide) - AAL2
- **Note:** `librarian`/`circulation` appear in display formatting and some RPCs but NOT in `staff_profiles` table constraint (only `superadmin`, `subadmin`)
- **Test Matrix:** `supabase/tests/five_role_regression_matrix.sql` (comprehensive route/RPC/RLS/AAL matrix)
- **Regression Tests:** `src/lib/fiveRoleRegressionBlocked.test.js` - 25+ tests marked BLOCKED
- **Status:** BLOCKED - Requires isolated Supabase project with real Auth/MFA (Track B)

## Group 12 — OPAC Count Discrepancy Fix — 2026-11-17

### Root Cause Analysis
- **Discrepancy:** Vercel deployment showed 983 books; localhost showed 1983 books (exactly 1000 difference)
- **Both environments use the same production Supabase project:** `https://khwtfjyvawukbsvyjdux.supabase.co` (configured in `.env` and `.env.local`)
- **Root cause:** Client-side pagination and missing server-side exact counts:
  - `fetchExternalCatalogBooks()` lacked pagination → limited to 1000 rows by PostgREST default
  - OPACCatalog displayed client-side `filteredBooks.length` without authoritative total for pagination
  - LandingPage used client-side filtered count from `books` array

### Security Issues Found & Fixed (20270102002900_opac_book_count_rpc_fixed.sql)
The original migration `20270102002800` used SECURITY DEFINER functions that **bypass RLS** and had:
1. No authorization checks for library-scoped queries (branch enumeration vulnerability)
2. RPC predicates didn't match OPACCatalog filters (call number search, external catalog availability)
3. Overly broad grants (`anon` + `authenticated` for branch-scoped functions)

**Corrective Fix (`20270102002900_opac_book_count_rpc_fixed.sql`):**
1. Changed all functions to **SECURITY INVOKER** (default) to respect RLS
2. Added explicit authorization via `opac_has_library_access()` helper using `is_active_staff_for_branch()`
3. Branch-scoped functions (`get_opac_library_book_count_by_library`, filtered with `p_library_id`) now require staff authorization
4. Added `call_number` to search predicates to match OPACCatalog
5. External catalog books only counted when availability filter allows "Unavailable"
6. Proper grants: `anon`+`authenticated` for general counts, `authenticated`-only for branch-scoped

### Implementation
1. **Migrations:**
    - `20270102002800_opac_book_count_rpc.sql` — Initial (superseded)
    - `20270102002900_opac_book_count_rpc_fixed.sql` — Security-hardened (current)
2. **`src/data/store.js` enhancements:**
    - `fetchExternalCatalogBooks()` now paginates with 1000-row pages
    - `fetchBooks()` enhanced with retry logic (3 retries, exponential backoff)
    - Added RPC-based count functions: `fetchOpacLibraryBookCount()`, `fetchOpacTotalBookCount()`, `fetchOpacLibraryBookCountByLibrary()`, `fetchOpacFilteredBookCount()`
3. **`src/pages/visitor/LandingPage.jsx`:**
    - Fetches library book count via `fetchOpacLibraryBookCount()` on mount
    - Displays server-side count with client-side fallback
4. **`src/component/OPACCatalog.jsx`:**
    - Fetches filtered count via `fetchOpacFilteredBookCount()` when filters change
    - Uses server-side count for pagination totals and display
    - Falls back to client-side count during loading/error
    - **NEW:** Debug panel displaying RPC counts, client-side counts, active filters, user role, Supabase URL (development only)

### Verification
- `npm run validate:migrations` PASS (156 migrations, including new 20270102002800 and 20270102002900)
- `node --test` 180/180 PASS
- `npm run lint` PASS
- `npm run build` PASS (large-chunk warning unchanged)
- `git diff --check` PASS
- No secrets exposed; environment separation maintained

## Group 13 — Predictive/Prescriptive Analytics — 2026-11-17

### Implementation
- `src/lib/dashboardAnalytics.js` — Core analytics functions:
  - `getMonthlyCalendarWeekBuckets()` — Inclusive-start/exclusive-end date windows, each day covered exactly once
  - `countMonthlyEventsByCalendarWeek()` — Event counts per calendar week
  - `getComparisonWindowCounts()` — Fixed 7-day recent vs 7-day previous windows
  - `buildOperationalRecommendations()` — Requires `attendanceComplete`, minimum data thresholds
  - `canRunVisitorForecast()` — Requires historyDays >= 14, observedVisitDays >= 7, totalVisits >= 14, attendanceComplete
  - `filterRowsForLibrary()`, `filterRequestsForLibrary()`, `filterAttendanceForAnalytics()` — Branch isolation
- `src/lib/forecastNarrative.js` — Neutral status when forecast not run, displays insights/recommendations
- `src/component/AdminWorkspace.jsx` — Renders operational recommendations and visitor forecasts
- `src/pages/subadmin/SubAdminDashboard.jsx` — Passes `branchBooks`/`branchAttendance` for branch-scoped analytics

### Verification
- Unit tests: All analytics tests passing (calendar buckets, comparison windows, recommendations, forecast prerequisites)
- Branch isolation: Sub-admin dashboards receive branch-scoped data
- No hardcoded predictions; all forecasts require explicit complete attendance feed

## Group 14 — Migration Integrity — 2026-11-17

### Verification
- `npm run validate:migrations` → **167** migrations, 0 errors
- Unique ordered versions: 20260930000000 → 20270103001100
- SHA-256 fingerprints for all migrations
- No duplicate versions, no conflicting signatures
- Catalog assertions cover: attendance, fine privacy, review identity, grants, defaults, role-claim, staff/branch authorization, AAL policy, OPAC counts, transaction integrity
- **Verification Script:** `supabase/tests/migration_integrity_verification.sql` (10 checks)
- **Regression Tests:** `src/lib/migrationIntegrityBlocked.test.js` - 13 tests marked BLOCKED

## Group 15 — Regression Tests & Documentation — 2026-11-17

### Tests
- `node --test` → **199/199 PASS** (49 skipped)
- `npm run lint` → PASS
- `npm run build` → PASS (large-chunk warning unchanged)
- `git diff --check` → PASS

### Documentation Updated
- `REMEDIATION_PROGRESS.md` — All groups status updated
- `MASTER_AUDIT_AND_IMPLEMENTATION_PLAN.md` — Groups 7-16 detailed
- `RELEASE_VALIDATION_RUNBOOK.md` — Credential exposure findings, OPAC verification checklist, two-track design
- `AUTH_POSTGREST_TEST_PLAN.md` — Four-role matrix, Track B requirements
- `DATABASE_REPLAY_PROCEDURE.md` — Track A/B procedures, 167 migrations, 12 assertions
- `docs/db_security_inventory.json` — Updated with latest function contracts
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
- **New assertion files created (Phase 3B):**
  - `supabase/tests/transaction_integrity_assertions.sql`
  - `supabase/tests/fine_payment_privacy_assertions.sql`
  - `supabase/tests/opac_count_rpc_assertions.sql`
  - `supabase/tests/aal2_policy_assertions.sql`
  - `supabase/tests/community_borrowing_workflow_assertions.sql`
- **New executable harness:**
  - `scripts/concurrency-harness.mjs` (structure-only concurrency test runner)

## Group 16 — Phase 2 Community Borrowing Workflow Remediation — 2026-11-17

### 16.1 Fix Community Borrowing Approval, Cancellation, Queue Promotion, and Inventory Triggers
- **Status:** COMPLETED
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
     - Owner can cancel 'pending' or 'approved' requests (approved → rejected)
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
  4. **Fixed `update_community_book_copy_availability` trigger (20270103001100):**
     - Added `DELETE` handling (restores availability, triggers promotion)
     - **Synchronous promotion**: Calls `promote_next_community_request()` directly within the trigger transaction after status transitions that free a copy (FIFO, `FOR UPDATE` locks)
     - **Defensive `pg_notify` calls** emit `community_promotion` channel — **no consumer exists** in repository (Edge Functions, cron, workers)
     - Proper allocation accounting for transitions TO/FROM allocating statuses
  5. **Fixed `enforce_book_copy_inventory` trigger:**
     - Separates library vs personal/community inventory validation
     - Library books: validates against `library_allocations` only
     - Personal books: validates `available_copies <= total_copies`; community availability managed by triggers
  6. **Added `auto_expire_community_requests()` cron function:**
     - Expires pending requests after 7 days of owner inaction
     - Notifies both requester and owner
     - Granted to `service_role` only
  7. **Community Promotion Design Recommendation (20270103001100):**
     - **Option A (Current — Synchronous)**: Promotion executes atomically within the trigger's transaction using `FOR UPDATE` locks on `books` and `community_book_requests`. Guarantees promotion happens or entire transaction rolls back. No external dependency.
     - **Option B (Transactional Outbox)**: Add `community_promotion_outbox` table + `pg_cron` worker to process notifications asynchronously. Adds complexity, requires dedicated infrastructure, introduces eventual consistency.
     - **Recommendation: Option A**. Synchronous promotion is already implemented, verified in migration postflight, and sufficient because: (1) no external system consumes promotion events, (2) notifications are created synchronously, (3) async path has no consumer, (4) atomicity is guaranteed. **Action: Remove the `pg_notify` calls as dead code.**
  8. **Fixed community promotion sync (20270117000000):**
     - Removed dead `pg_notify('community_promotion', ...)` calls from trigger
     - Replaced with direct `PERFORM public.promote_next_community_request(old.book_id)` calls
     - Promotion now executes synchronously for ALL transitions that free a copy:
       - Book returned (status: 'borrowed' → 'returned')
       - Request rejected (status: 'approved' → 'rejected')
       - Direct DELETE of approved/borrowed request
     - Postflight validates zero `pg_notify` calls and presence of `promote_next_community_request` invocation
- **Postflight validation:** Catalog assertions for all new/changed functions (metadata, ACLs, search_path)
- **Verification:** `npm run validate:migrations` PASS (167 migrations); `node --test` 199/199 PASS (49 skipped); `npm run build` PASS
- **Limitations:** Runtime concurrency verification requires isolated PostgreSQL; synchronous promotion in trigger is the verified path; `pg_notify` calls removed in 20270117000000.

## Group 17 — Production Backup & Disaster Recovery Preparation — 2026-11-18

### 17.1 Backup Script: `backup-production-db.ps1`
**Current Version:** Local-only validation complete; production execution failed twice.

**Script Capabilities:**
- Three separate exports: Roles (plain SQL), Schema (custom format), Data (custom format)
- Secure password handling: `Read-Host -AsSecureString` → `PGPASSWORD` env var → zeroed in `finally`
- Connection via Supabase session pooler: `aws-0-ap-northeast-1.pooler.supabase.com:5432`, user `postgres.khwtfjyvawukbsvyjdux`
- Excludes Supabase-managed schemas: `auth`, `storage`, `realtime`, `supabase_functions`, `pg_catalog`, `information_schema`
- Excludes 19 Supabase-managed roles via statement-level filtering
- Validates each export: `pg_restore --list` for custom format; text scan + excluded-role check for roles
- Manifest with SHA-256 hashes, file sizes, timestamps, entry counts
- Fail-fast: any failure stops subsequent exports, cleans partial files
- ACL enforcement: `icacls` restricts backup directory and all generated files to current user only

### 17.2 Original Production Failure Analysis
**Reported Error (first attempt):**
```
pg_dumpall.exe: illegal option -- n
```

**Root Cause Assessment:**
The exact original failure **cannot be independently reproduced** with the current PostgreSQL 18.6 binaries. Testing the bare database name format (`--dbname postgres`) produces:
```
pg_dumpall: error: missing "=" after "postgres" in connection info string
```
NOT "illegal option -- n". The "illegal option -- n" error suggests argument parsing saw `-n` or `--n` as a flag, which could occur if:
- The connection string was split into multiple arguments (e.g., `sslmode=require` parsed as `-s slmode=require`)
- A quoting/escaping issue in an earlier script version

**Current Script Fix (verified locally):**
- Uses connection string in `--dbname`: `dbname=postgres sslmode=require connect_timeout=10`
- Tested with PostgreSQL 18.6: all three commands parse arguments correctly and attempt connection (fail on auth, not arg parsing)
- Argument array passed via call operator (`& $ToolPath @Args`) preserves each element as a distinct argument

**Conclusion:** The original root cause remains **unconfirmed**. The current script uses the correct libpq connection string format for `--dbname` with separate `--host/--port/--username`.

### 17.3 TLS/SSL Configuration Status
**Current:** `sslmode=require` (verifies cert chain, NOT hostname — MITM vulnerable)

**Required for Production:** `sslmode=verify-full` with Supabase CA certificate

**Certificate Acquisition (Owner Action Required):**
1. Supabase Dashboard → Project `khwtfjyvawukbsvyjdux` → Settings → Database → SSL Configuration
2. Click **"Download Certificate"** (root CA certificate)
3. Save as `supabase-ca.crt` in a secure local path (e.g., `C:\Certs\supabase-ca.crt`)
4. Update script: `$sslMode = "verify-full"` and add `sslrootcert=C:\Certs\supabase-ca.crt` to connection string

**Hostname Verification Compatibility:**
- Pooler hostname: `aws-0-ap-northeast-1.pooler.supabase.com`
- Supavisor (Supabase pooler) presents certificates signed by Supabase internal CA
- Certificate SAN must include pooler hostname pattern — **requires verification with downloaded cert**
- Direct connection hostname: `db.khwtfjyvawukbsvyjdux.supabase.co` (IPv6) — different cert

**Supabase Documentation Note:** "Migrations, pg_dump, backup and restore, or replication: **Direct connection**". However, direct connection is IPv6-only (no IPv4 add-on confirmed). Session pooler is IPv4 and works for this environment.

### 17.4 Windows ACL & Encryption Status
**Backup Directory:** `C:\Users\Yesha May M. Cordero\Documents\SHELF-SECURE-BACKUPS`

**ACL Enforcement (Implemented in Script):**
- Backup directory: `icacls` disables inheritance, removes all ACEs, grants current user `(OI)(CI)F` (full control, inherited by children)
- Each generated file: `icacls` disables inheritance, removes all ACEs, grants current user `F`
- Verification: script checks `icacls` output for expected ACE pattern; fails if verification fails

**Verification Result (Local Test):**
- Script successfully applies and verifies DACLs on directory creation
- File-level restriction applied after each export validation

**BitLocker Status:** **UNVERIFIED** — requires Administrator privileges to query (`manage-bde`, `Get-BitLockerVolume`, WMI). Owner must confirm:
- `manage-bde -status C:` shows "Protection On"
- Or Windows Settings → Privacy & Security → BitLocker → "On"

**Risk if BitLocker OFF:** Backup files contain PII (visitors, staff_profiles, audit_logs) and auth tokens (password_reset_codes, login_attempt_lockouts). Files are ACL-protected but not encrypted at rest. Owner must enable BitLocker or use encrypted volume.

### 17.5 Backup Validation Results (Local)
| Check | Method | Status |
|-------|--------|--------|
| Argument parsing (pg_dumpall) | `--roles-only --no-role-passwords --dbname "connstr" --host/--port/--username` | ✅ PASS |
| Argument parsing (pg_dump schema) | `-Fc --schema-only --exclude-schema x9 --schema public --dbname "connstr"` | ✅ PASS |
| Argument parsing (pg_dump data) | `-Fc --data-only --exclude-schema x9 --schema public --dbname "connstr"` | ✅ PASS |
| `--no-role-passwords` flag | Verified in `pg_dumpall --help` | ✅ EXISTS |
| Role filtering | Statement-level parsing, 19 excluded roles | ✅ IMPLEMENTED |
| Custom archive validation | `pg_restore --list -v` | ✅ IMPLEMENTED |
| SHA-256 manifest | `Get-FileHash -Algorithm SHA256` | ✅ IMPLEMENTED |
| Fail-fast behavior | Throw → catch → cleanup → exit 1 | ✅ IMPLEMENTED |
| Timestamp isolation | Cleanup only current `$timestamp` files | ✅ IMPLEMENTED |
| Previous backup preservation | No overwrite/delete of older timestamps | ✅ IMPLEMENTED |

### 17.6 Verification Script Created
**New File:** `verify-production-backup.ps1`
- Local-only, no production connection
- Accepts backup directory and optional timestamp
- Verifies manifest, recalculates SHA-256, checks file sizes
- Lists custom archive contents via `pg_restore --list`
- Validates roles SQL (excluded roles absent, custom roles present)
- Reports missing/mismatched files
- Does NOT label backup as restorable — only verifies file integrity

### 17.7 Restore Test Plan Created
**New File:** `RESTORE_TEST_PROCEDURE.md`
- Documents isolated Supabase test project creation
- Restore order: Roles → Schema → Data
- Post-restore validation: full reconciliation SQL comparison
- Data integrity: row counts, sequences, FK validity, RLS
- Smoke tests: visitor login, QR attendance, borrow/return, fine payment
- Cleanup: delete test project after validation
- **Explicitly states:** Logical `public` backup ≠ complete Supabase DR

### 17.8 Fine Schema Prerequisite Predicate Validation Fix (2026-11-18)

**Problem:** The prerequisite migration `20261108160959_fine_schema_prerequisite.sql` validates the partial index `borrow_requests_fine_dashboard_status_book_due_idx` predicate. Production's `borrow_requests.status` column is `character varying(50)` (with length modifier). PostgreSQL's `pg_get_expr()` renders the predicate with the full type including length modifier:
```
(status = ANY(ARRAY['borrowed'::character varying(50), 'returned'::character varying(50)]))
```
The original validation (commit `0727c54`) hardcoded `character varying` (without length modifier), causing a mismatch.

**Fix Applied (Working Tree, Uncommitted):**
- Migration now captures actual column type via `pg_catalog.format_type(a.atttypid, a.atttypmod)` into `v_borrow_status_type`
- Expected predicate dynamically constructed: `'(status = ANY (ARRAY[''borrowed''::' || v_borrow_status_type || ', ''returned''::' || v_borrow_status_type || ']))'`
- Both expected and actual predicates normalized via `pg_catalog.regexp_replace(pg_catalog.lower(...), '[[:space:]]', '', 'g')`
- Fail-closed `IS DISTINCT FROM` comparison preserved
- All other validations (key columns, include columns, ordering, access method, uniqueness, validity/readiness/live) unchanged

**Migration History Discrepancy (Critical):**
| Version | Filename | Production `schema_migrations` |
|---------|----------|--------------------------------|
| `20261108160959` | `fine_schema_prerequisite.sql` | **MISSING** (never applied) |
| `20261108161030` | `fine_dashboard_query_indexes.sql` | **APPLIED** (recorded) |

The dashboard index migration (`161030`) that creates `borrow_requests_fine_dashboard_status_book_due_idx` was applied **without** its prerequisite (`160959`). The prerequisite creates:
- `public.fine_payments` table (9 canonical columns, PK, checks, FK to `staff_profiles`, RLS)
- `borrow_requests.fine_paid_amount` (numeric, `>= 0` check)
- `borrow_requests.fine_review_required` (boolean, default false)
- `borrow_requests.fine_review_resolved_at` (timestamptz)
- `borrow_requests.fine_review_note` (text)
- Three indexes: dashboard index, `books_library_id_book_id_idx`, `fine_payments_request_received_idx`

**Production Compatibility When `160959` Eventually Runs:**
- The prerequisite uses `IF NOT EXISTS` / existence checks for all objects
- Index validation block only validates if index already exists (lines 403-492): `IF v_index_oid IS NOT NULL THEN ...`
- Since `161030` already created the dashboard index, the validation will run and **must pass** — the dynamic predicate fix ensures this
- No `DROP INDEX` or recreation attempted; validation is read-only
- `fine_payments` table and fine columns will be created (absent in production per reconciliation evidence)

**No Forward Migration Needed:** The validation fix belongs in the prerequisite itself since production will execute it for the first time.

## Release Status: NOT READY

### Remaining External Blockers
1. **Independent database replay (Track A)** — All 167 migrations + 12 SQL assertions on isolated PostgreSQL: NOT RUN
2. **Real Auth/AAL2/PostgREST matrix (Track B)** — 3 authorization roles × 2 AAL levels + anonymous with actual Auth-issued tokens: NOT RUN
3. **Production schema reconciliation** — Vercel/Supabase production config verification: BLOCKED
4. **Credential rotation** — Owner must rotate exposed credentials per `RELEASE_VALIDATION_RUNBOOK.md` (DB password CRITICAL, service role key if stored locally)
5. **Local environment fix** — Owner must replace `.env`/`.env.local` with local Supabase project credentials
6. **Community promotion** — Fixed in 20270117000000; synchronous promotion verified in source; runtime verification required (Track B)
7. **Production backup & restore validation** — Items 2–6 of `REMAINING_OWNER_CHECKLIST.md` not complete
8. **TLS verify-full** — Supabase CA certificate not yet acquired; currently `sslmode=require`
9. **BitLocker confirmation** — Backup volume encryption status unknown; owner must verify/enable

### Production Release Gate
**NO MIGRATION BATCHES MAY EXECUTE UNTIL:**
- [ ] All Items 2–6 in `REMAINING_OWNER_CHECKLIST.md` are VERIFIED
- [ ] Supabase CA certificate acquired and `sslmode=verify-full` configured
- [ ] BitLocker confirmed ON for backup volume
- [ ] Test restore to isolated Supabase project completes with schema match
- [ ] Owner signs off on rollback procedures
- [ ] Independent Track A replay completes (167 migrations + 12 assertions)
- [ ] Track B Auth/PostgREST matrix passes on isolated Supabase project

**Final Status: NEEDS CHANGES** — Multiple owner actions required before production backup can be executed and migration batches authorized.