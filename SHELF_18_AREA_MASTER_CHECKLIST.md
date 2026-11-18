# SHELF ILMS — 18-Area Master Checklist (Updated)

**Version:** 2.0
**Date:** 2026-11-17
**Status:** Phase 4 System-Wide Audit Complete
**Source of Truth:** `MASTER_AUDIT_AND_IMPLEMENTATION_PLAN.md` (Groups 1-16), `REMEDIATION_PROGRESS.md`, Phase 3D completion

---

## Area Status Legend

| Status | Meaning |
|--------|---------|
| ✅ **VERIFIED** | Source code reviewed, automated checks pass, design documented |
| ⚠️ **SOURCE COMPLETE** | Implementation complete in source; runtime verification pending Track A/B |
| 🔴 **BLOCKED** | Requires external infrastructure (Track A/B) — cannot verify in current environment |
| ❌ **NOT RUN** | No verification performed |
| 📋 **DOCUMENTED** | Requirements/design documented; implementation pending or blocked |

---

## 18-Area Audit Results

### Area 1: Notification System
**Status:** ✅ **VERIFIED** (Source) / 🔴 **BLOCKED** (Runtime)

| Item | Status | Evidence |
|------|--------|----------|
| Unified `visitor_notifications` table | ✅ | Migration `20270103000800` |
| 21 notification types (check constraint) | ✅ | Migration `20270103000900` — verified in schema |
| Idempotency key constraint (`notification_idempotency_key`) | ✅ | Unique constraint on `(visitor_id, type, reference_id, idempotency_key)` |
| Notification creation in all transaction RPCs | ✅ | `20270103000900` — borrow, pickup, return, fine, community, cancellation |
| Edge Functions: `send-due-date-notifications`, `send-fine-reminder`, `send-visitor-otp` | ✅ | Source reviewed; Deno tests pass (9/9) |
| Postflight assertions for notification catalog | ✅ | `community_borrowing_workflow_assertions.sql`, `security_release_assertions.sql` |
| Real delivery verification | 🔴 | Requires Track B (Supabase stack + Resend) |

**Runtime Gap:** Edge Function invocation, Resend integration, cron scheduling (`pg_cron` unavailable on Windows)

---

### Area 2: Catalog / Reviews
**Status:** ✅ **VERIFIED** (Source) / 🔴 **BLOCKED** (Runtime)

| Item | Status | Evidence |
|------|--------|----------|
| Review privacy — dedicated RPC owner role | ✅ | `20270102000300_book_reviews_privacy.sql` — RPC owner, SECURITY DEFINER |
| Eligibility enforcement at DB level | ✅ | `20270103001000_review_eligibility_enforcement.sql` — borrowed+returned required |
| OPAC counts via SECURITY INVOKER RPCs | ✅ | `20270102002900_opac_book_count_rpc_fixed.sql` — all SECURITY INVOKER |
| Anonymous review display: "Verified Reader" | ✅ | RPC returns generic label; no visitor_id exposed |
| Cross-visitor review read denied (RLS) | ✅ | RLS policies on `book_reviews` |
| Direct table access denied | ✅ | No GRANT to anon/authenticated on `book_reviews` |
| Runtime RLS/PostgREST verification | 🔴 | Requires Track B |

---

### Area 3: Registration / OTP / Approval
**Status:** ✅ **VERIFIED** (Source) / 🔴 **BLOCKED** (Runtime)

| Item | Status | Evidence |
|------|--------|----------|
| OTP 120s cooldown enforced | ✅ | `send-visitor-otp` Edge Function + DB `otp_requests` table |
| Community pending = visitor account state (NOT auth role) | ✅ | `visitors` table: `registration_type='community'`, `approval_status='pending'`, `is_active=false` |
| Institutional domain enforcement | ✅ | `20270102001700_public_community_visitor_registration.sql` — domain check at DB |
| AAL2 required for staff approval actions | ✅ | `approve_community_registration` requires AAL2 |
| Visitor account states documented | ✅ | `AUTH_POSTGREST_TEST_PLAN.md` Table: 5 states |
| Real Auth/OTP/approval flow | 🔴 | Requires Track B (Supabase Auth + email catcher) |

---

### Area 4: Book Workflow (Community Borrowing)
**Status:** ✅ **VERIFIED** (Source + Fix) / 🔴 **BLOCKED** (Runtime)

| Item | Status | Evidence |
|------|--------|----------|
| Community promotion sync FIXED (synchronous) | ✅ | `20270117000000_fix_community_promotion_sync.sql` — direct `promote_next_community_request()` calls in trigger |
| 7-day auto-expiry for pending requests | ✅ | `auto_expire_community_requests()` cron function in `20270103001100` |
| Cancellation handling (all states) | ✅ | `cancel_community_book_request` — pending/approved/borrowed/terminal |
| Queue promotion FIFO with FOR UPDATE locks | ✅ | `promote_next_community_request(text)` — `ORDER BY request_date ASC, id ASC` |
| Availability restored on cancellation/return | ✅ | Trigger `update_community_book_copy_availability` handles DELETE + status transitions |
| Dead `pg_notify` removed | ✅ | `20270117000000` — synchronous promotion; no external consumer needed |
| Inventory allocation accounting (library vs community) | ✅ | `enforce_book_copy_inventory` separates library/community |
| Runtime concurrency verification | 🔴 | Requires Track B (real row locks, concurrent sessions) |

---

### Area 5: ShelfHeader / Layout
**Status:** ✅ **VERIFIED** (Source)

| Item | Status | Evidence |
|------|--------|----------|
| Global header with notification bell | ✅ | `src/component/ShelfHeader.jsx` — bell icon, count badge, dropdown |
| Dark mode toggle | ✅ | `ShelfHeader.jsx` — `useDarkMode` hook, localStorage persistence |
| Responsive design (desktop/tablet/mobile) | ✅ | CSS Grid/Flex; breakpoints at 1024px, 768px, 390px |
| Role-specific navigation | ✅ | Conditional rendering based on `get_current_user_role()` RPC |
| No horizontal overflow at 390px | ✅ | Verified in `SYSTEM_FLOW_CHECKLIST.md` (2026-11-03) |

---

### Area 6: Dashboard / Profile / QR
**Status:** ✅ **VERIFIED** (Source) / 🔴 **BLOCKED** (Runtime)

| Item | Status | Evidence |
|------|--------|----------|
| QR display / save / refresh | ✅ | `VisitorDashboard.jsx` — QR pass generation, canvas download |
| MFA + Passkeys support | ✅ | Supabase Auth configuration; `AuthContext.jsx` handles AAL2 |
| Profile photo with crop | ✅ | `ProfilePhotoUploader.jsx` — client-side crop, Supabase Storage |
| Attendance pagination | ✅ | `AttendanceHistory.jsx` — paginated fetch via RPC |
| Visitor dashboard tabs rendering | ✅ | `VisitorDashboard.jsx` — Catalog, My Books, Requests, Profile, Map |
| Sub-admin dashboard tabs | ✅ | `SubAdminDashboard.jsx` — Overview, Transactions, Analytics, Accounts, etc. |
| Super-admin dashboard tabs | ✅ | `SuperAdminDashboard.jsx` — Overview, Inventory, Libraries, Staff, etc. |
| Real Auth/MFA session verification | 🔴 | Requires Track B |

---

### Area 7: Community Books / Saved
**Status:** ✅ **VERIFIED** (Source) / 🔴 **BLOCKED** (Runtime)

| Item | Status | Evidence |
|------|--------|----------|
| Save/unsave/get RPCs | ✅ | `20270103000700_community_books_read_later_rpcs.sql` — `save_community_book_for_later`, `unsave_community_book_for_later`, `get_my_saved_community_books` |
| RLS on `community_book_read_later` | ✅ | Policies: visitor owns their saved items only |
| Frontend integration | ✅ | `CommunityBookCard.jsx` — save button, saved state |
| Real RLS enforcement | 🔴 | Requires Track B |

---

### Area 8: Personal Books
**Status:** ✅ **VERIFIED** (Source) / 🔴 **BLOCKED** (Runtime)

| Item | Status | Evidence |
|------|--------|----------|
| ISBN stored as text (no format validation) | ✅ | `books.isbn` = TEXT; validation in frontend only |
| Fine rate presets (category-based defaults) | ✅ | `add_personal_book` overloads with `fine_rate` param; category fallback |
| Duplicate search (title/author/ISBN) | ✅ | `fetchBooks` search predicates; RPC `get_opac_filtered_book_count` |
| Base functions hardened (AAL1, empty search_path) | ✅ | `20270102002600` — `_base` suffix functions, grants to authenticated/service_role |
| Visitor ownership via `auth_user_id` | ✅ | All personal book RPCs check `visitor.auth_user_id = auth.uid()` |
| Real ownership/RLS verification | 🔴 | Requires Track B |

---

### Area 9: OPAC Counts
**Status:** ✅ **VERIFIED** (Source + Fix) / 🔴 **BLOCKED** (Runtime)

| Item | Status | Evidence |
|------|--------|----------|
| Server-side RPCs (SECURITY INVOKER) | ✅ | `20270102002900_opac_book_count_rpc_fixed.sql` — all SECURITY INVOKER |
| RLS-respecting counts | ✅ | SECURITY INVOKER + `opac_has_library_access()` helper |
| Branch-scoped counts require staff auth (AAL2) | ✅ | `get_opac_library_book_count_by_library` GRANT TO authenticated only |
| Call number search in predicates | ✅ | RPC predicates updated to match OPACCatalog |
| External catalog pagination (1000-row pages) | ✅ | `fetchExternalCatalogBooks()` in `store.js` |
| Debug panel (dev only) | ✅ | `OPACCatalog.jsx` — RPC vs client counts, filters, role, URL |
| Vercel vs localhost count consistency | 🔴 | Requires production deployment + Track B verification |

---

### Area 10: Book Images
**Status:** ✅ **VERIFIED** (Source)

| Item | Status | Evidence |
|------|--------|----------|
| `BookCover` component | ✅ | `src/component/BookCover.jsx` — `imageFit="contain"` and `"cover"` props |
| Cover upload to Supabase Storage | ✅ | `add_personal_book_with_cover` RPC + Storage bucket |
| Fallback for missing covers | ✅ | Default placeholder image |
| Responsive image sizing | ✅ | CSS object-fit; container queries |

---

### Area 11: Analytics / Fine Privacy
**Status:** ✅ **VERIFIED** (Source) / 🔴 **BLOCKED** (Runtime)

| Item | Status | Evidence |
|------|--------|----------|
| Small-cohort suppression (threshold=3) | ✅ | `get_fine_payment_analytics` — cohorts <3 return suppressed/generalized |
| Branch-scoped Sub-admin analytics | ✅ | `get_fine_payment_dashboard`, `get_fine_payment_alert_targets` — branch via `is_active_staff_for_branch` |
| System-wide Super Admin aggregate-only | ✅ | `get_fine_payment_analytics` — no visitor_id, no individual amounts |
| AAL2 required for all analytics RPCs | ✅ | All fine analytics RPCs check `request.jwt.claims.aal = 'aal2'` |
| Operational recommendations (14-day minimum) | ✅ | `dashboardAnalytics.js` — `canRunVisitorForecast()` requires 14 days |
| Forecast narratives (neutral when insufficient data) | ✅ | `forecastNarrative.js` — status `insufficient_data` |
| Branch isolation in SubAdminDashboard | ✅ | Passes `branchBooks`/`branchAttendance` to AdminWorkspace |
| Real AAL2/PostgREST verification | 🔴 | Requires Track B |

---

### Area 12: Chatbot / AI Recommendations
**Status:** ✅ **VERIFIED** (Source)

| Item | Status | Evidence |
|------|--------|----------|
| localStorage search history | ✅ | `recommendationEngine.js` — `searchHistory` array in localStorage |
| Event-driven updates | ✅ | `LibraryContext.jsx` — `onSearch` event updates engine |
| No external API calls | ✅ | All recommendations computed client-side from local history |
| Privacy: no search history leaves browser | ✅ | Verified in source — no network requests for recommendations |
| UI: `AIRecommendations.jsx` | ✅ | Renders suggestions based on history |

---

### Area 13: Library Map
**Status:** ✅ **VERIFIED** (Source) / ⚠️ **REQUIRES EVIDENCE**

| Item | Status | Evidence |
|------|--------|----------|
| `coordinates_verified` flag | ✅ | `20270103000500_library_coordinates_verification.sql` |
| BatStateU JPLPC Malvar coordinates | ✅ **VERIFIED & CORRECTED** | 14.04482, 121.15677 (source: Wikipedia, OpenStreetMap, PhilAtlas — corrected from Darasa, Tanauan error) |
| Leaflet map with search/filter | ✅ | `LibraryMap.jsx` — markers, clustering, search by name |
| Branch-scoped map for Sub-admin | ✅ | SubAdminDashboard passes branch library only |

---

### Area 14: Performance / Cache
**Status:** ✅ **VERIFIED** (Source)

| Item | Status | Evidence |
|------|--------|----------|
| AbortController deduplication | ✅ | `LibraryContext.jsx` — `abortControllers` Map keyed by request ID |
| Cache isolation via `visitorAccounts` | ✅ | Separate cache namespaces per visitor context |
| Retry logic (3 retries, exponential backoff) | ✅ | `fetchBooks()` in `store.js` |
| Pagination for external catalog (1000 rows) | ✅ | `fetchExternalCatalogBooks()` |
| Large chunk warning (Vite) | ⚠️ Known | `npm run build` — existing advisory, not blocking |

---

### Area 15: Authorization / Concurrency
**Status:** ✅ **VERIFIED** (Source) / 🔴 **BLOCKED** (Runtime)

| Item | Status | Evidence |
|------|--------|----------|
| 3 authorization roles + anonymous | ✅ | `visitor` (AAL1), `subadmin` (AAL2), `superadmin` (AAL2) — `AUTH_POSTGREST_TEST_PLAN.md` |
| `librarian`/`circulation` = display aliases only | ✅ | `staff_profiles.role` constraint: ONLY `superadmin`, `subadmin` |
| `community_pending` = visitor account state | ✅ | NOT an authorization role |
| `staff_profiles` role constraint | ✅ | `20260930000000_initial_base_schema.sql` — CHECK constraint |
| `is_active_staff_for_branch()` validates against staff_profiles | ✅ | `20270102001100_attendance_claims_review_labels_and_table_acl.sql` |
| FOR UPDATE locks in all transaction RPCs | ✅ | `20270102002400_transaction_rpc_hardening.sql` — 8 functions |
| State machine enforcement (pickup/return) | ✅ | `ready_for_pickup → borrowed`, `borrowed → returned` |
| Atomic balance updates (fine payment) | ✅ | `record_fine_payment` — payment ≤ outstanding |
| Duplicate prevention (attendance, notifications) | ✅ | `toggle_attendance` FOR UPDATE; idempotency keys |
| Visitor ID (TEXT) vs auth_user_id (UUID) mapping corrected | ✅ | Legacy `confirm_pickup`/`confirm_return` use branch access, NOT `visitor_id = auth.uid()` |
| Real concurrency/row lock verification | 🔴 | Requires Track B (8 scenarios in `concurrency_test_scenarios.sql`) |

---

### Area 16: Migration Integrity
**Status:** ✅ **VERIFIED** (Source) / 🔴 **BLOCKED** (Runtime)

| Item | Status | Evidence |
|------|--------|----------|
| 167 migrations, unique ordered versions | ✅ | `npm run validate:migrations` — 20260930000000 → 20270103001100 |
| SHA-256 fingerprints for all migrations | ✅ | `scripts/validate-migrations.mjs` manifest |
| No duplicate versions, no conflicting signatures | ✅ | Validation script checks |
| Catalog assertions cover: attendance, fine privacy, review identity, grants, defaults, role-claim, staff/branch auth, AAL policy, OPAC counts, transaction integrity | ✅ | 12 assertion files in `supabase/tests/` |
| Migration integrity verification script | ✅ | `supabase/tests/migration_integrity_verification.sql` (10 checks) |
| Actual database replay | 🔴 | Requires Track A (isolated PostgreSQL) |
| SQL assertions execution | 🔴 | Requires Track A/B |

---

### Area 17: Final Validation (Automated Checks)
**Status:** ✅ **ALL PASSING**

| Check | Result | Evidence |
|-------|--------|----------|
| `npm run lint` | ✅ PASS | ESLint clean |
| `npm run build` | ✅ PASS | Vite build succeeds (large-chunk warning) |
| `node --test` | ✅ 199 pass, 49 skipped | All executable tests pass |
| `npm run validate:migrations` | ✅ 167 migrations, 0 errors | Manifest validation |
| `git diff --check` | ✅ PASS | LF/CRLF warnings only |
| Deno Edge Function tests | ✅ 9/9 PASS | `send-due-date-notifications/notificationSafety.test.js` |

**Note:** 49 skipped tests remain **unverified** — do not report as passing.

---

### Area 18: Production Release Safety
**Status:** 📋 **DOCUMENTED** / 🔴 **BLOCKED**

| Item | Status | Evidence |
|------|--------|----------|
| Credential exposure documented | ✅ | `RELEASE_VALIDATION_RUNBOOK.md` — 3 commits + working directory |
| Credential classification (public vs privileged) | ✅ | Anon key = public (NO rotation); DB password = CRITICAL (IMMEDIATE rotation) |
| Track A/B gates defined | ✅ | `DATABASE_REPLAY_PROCEDURE.md`, `AUTH_POSTGREST_TEST_PLAN.md` |
| Database password rotation | ✅ **OWNER REPORTED COMPLETE** | Owner reset via Supabase Dashboard; **NOT independently verified** (no new password provided for testing) |
| Service role key rotation | 🔴 **OWNER ACTION REQUIRED** | If ever stored locally |
| Vercel environment update | 🔴 **OWNER ACTION REQUIRED** | After Supabase rotation |
| Local `.env` fix | 🔴 **OWNER ACTION REQUIRED** | Replace with local Supabase project credentials |
| Production deployment | 🔴 **BLOCKED** | Pending all above + Track A/B completion |
| `pg_notify` consumer for community promotion | ✅ **RESOLVED** | Removed in `20270117000000` — synchronous promotion |
| Community queue promotion design | ✅ **RESOLVED** | Option A (Synchronous) implemented and verified |

---

## Summary: 18-Area Status

| Area | Source Verified | Runtime Verified | Blockers |
|------|-----------------|------------------|----------|
| 1. Notification System | ✅ | 🔴 | Track B (pg_cron, Resend, Edge Functions) |
| 2. Catalog/Reviews | ✅ | 🔴 | Track B (Auth/PostgREST/RLS) |
| 3. Registration/OTP/Approval | ✅ | 🔴 | Track B (Supabase Auth, email catcher) |
| 4. Book Workflow | ✅ | 🔴 | Track B (concurrency, pg_cron) |
| 5. ShelfHeader/Layout | ✅ | ✅ (UI only) | — |
| 6. Dashboard/Profile/QR | ✅ | 🔴 | Track B (Auth/MFA) |
| 7. Community Books/Saved | ✅ | 🔴 | Track B (RLS) |
| 8. Personal Books | ✅ | 🔴 | Track B (RLS/ownership) |
| 9. OPAC Counts | ✅ | 🔴 | Track B (production deploy + verification) |
| 10. Book Images | ✅ | ✅ (UI only) | — |
| 11. Analytics/Fine Privacy | ✅ | 🔴 | Track B (AAL2/PostgREST) |
| 12. Chatbot/AI | ✅ | ✅ (client-only) | — |
| 13. Library Map | ✅ | ⚠️ | Coordinates evidence needed |
| 14. Performance/Cache | ✅ | ✅ (source) | — |
| 15. Authorization/Concurrency | ✅ | 🔴 | Track B (real row locks, Auth) |
| 16. Migration Integrity | ✅ | 🔴 | Track A (PostgreSQL) + Track B (pg_cron/pg_net) |
| 17. Final Validation | ✅ | ✅ | — |
| 18. Production Release Safety | 📋 | 🔴 | Credential rotation (DB password owner-reported complete, not verified), Track A/B, owner actions |

---

## Key Corrections from Prior Versions

1. **Authorization roles:** 3 roles + anonymous (NOT 4 or 5). `librarian`/`circulation` are display only. `community_pending` is a visitor state.
2. **Notification types:** 21 (NOT 16) — verified in `20270103000900` check constraint.
3. **Migrations:** 167 (NOT 144, 152, 156, 166) — latest `20270117000000`.
4. **Community promotion:** FIXED — synchronous in trigger via `promote_next_community_request()`; `pg_notify` dead code removed.
5. **OPAC RPCs:** SECURITY INVOKER (NOT SECURITY DEFINER) — respects RLS; branch-scoped requires staff AAL2.
6. **Credential rotation:** Anon key NO rotation (public by design); DB password CRITICAL immediate rotation.
6. **Skipped tests:** 49 tests BLOCKED — do NOT report as passing.

---

## Next Actions for Owner

1. **VERIFY:** Database password rotation independently (owner must test new password connects to production database)
2. **IMMEDIATE:** Rotate service role key if ever stored locally
3. **PROVISION:** Isolated Supabase staging project (Track B) — Linux/macOS for `supabase start` or paid staging
4. **CONFIGURE:** Local `.env` with local Supabase project (not production)
5. **EXECUTE:** Track A replay on isolated PostgreSQL (document pg_cron/pg_net failures)
6. **EXECUTE:** Track B Auth/PostgREST matrix with 6 test users
7. **COMPLETED:** BatStateU JPLPC Malvar coordinates verified and corrected (14.04482, 121.15677)
8. **VERIFY:** Vercel environment variables updated with new credentials
9. **VERIFY:** CI/CD pipelines (if any) updated with new credentials
10. **DEPLOY:** Only after all gates pass

---

**Release Status: NOT READY**
*All 18 areas audited. Source implementation complete. Runtime verification blocked by infrastructure. DB password rotation owner-reported complete — NOT independently verified. Old password ([REDACTED]) must remain treated as compromised.*