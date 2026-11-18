# SHELF ILMS Capstone Demonstration Sequence

**Version:** 1.0
**Date:** 2026-11-17
**Audience:** Capstone Panel, Stakeholders
**Duration:** 20-30 minutes
**Environment:** Local development with local Supabase project (recommended) OR staging Vercel preview

---

## Demonstration Goals

1. **Showcase implemented features** — UI/UX, role-based workflows, security model
2. **Demonstrate technical depth** — RPC architecture, RLS, AAL2, transaction integrity
3. **Acknowledge verification gaps honestly** — Distinguish demo (UI) from production verification (Track B)
4. **Present release readiness status** — Clear NOT READY with documented path to READY

---

## Pre-Demo Setup (30 minutes before)

### Required Infrastructure
- [ ] Local Supabase project running (`supabase start` on Linux/macOS) OR staging Supabase project
- [ ] Local `.env` configured for local/staging Supabase (NOT production)
- [ ] All 167 migrations applied to local/staging DB
- [ ] Test users created (6 accounts per `AUTH_POSTGREST_TEST_PLAN.md`)
- [ ] Test data seeded (2 libraries, books, requests, etc.)
- [ ] Mailpit running for email capture (port 8025)
- [ ] Frontend dev server running (`npm run dev`)
- [ ] Browser: Chrome/Edge with devtools open (Network tab for RPC visibility)
- [ ] Screen recording ready (OBS or built-in)

### Demo Accounts to Have Ready
| Role | Email | Password | Notes |
|------|-------|----------|-------|
| Visitor (Institutional) | `inst.visitor@test.local` | `TestPass123!` | MFA enrolled |
| Visitor (Community) | `comm.visitor.approved@test.local` | `TestPass123!` | MFA enrolled |
| Sub-admin (Library A) | `subadmin@test.local` | `TestPass123!` | MFA enrolled |
| Super Admin | `superadmin@test.local` | `TestPass123!` | MFA enrolled |

### Browser Profiles
- **Profile 1:** Visitor (incognito window)
- **Profile 2:** Sub-admin (separate incognito)
- **Profile 3:** Super Admin (separate incognito)
- **Profile 4:** Anonymous (regular window)

---

## Demonstration Sequence (20-30 minutes)

### Segment 1: Public Landing & Discovery (3 minutes)

**Narrative:** *"SHELF ILMS is a multi-library management system serving institutional and community visitors across partner libraries. Let's start with the public experience."*

| Step | Action | Talking Points |
|------|--------|----------------|
| 1.1 | Open `http://localhost:5173` (LandingPage) | Responsive design; 390px mobile viewport tested; no horizontal overflow |
| 1.2 | Show participating libraries (14 configured) | Domain-restricted registration; no "Outside Visitor" option |
| 1.3 | Show public catalog summary (book counts) | Server-side RPC counts via `get_opac_library_book_count()` |
| 1.4 | Click "View Catalog" → redirects to `/visitor-login` | Auth guard on protected routes |
| 1.5 | Show announcements & feedback form | Public read access; submission requires auth |

**Demo Evidence:** Network tab shows `get_opac_library_book_count` RPC call.

---

### Segment 2: Visitor Registration & Authentication (4 minutes)

**Narrative:** *"Visitors register with their institutional email. The system enforces domain validation at both UI and database layers."*

| Step | Action | Talking Points |
|------|--------|----------------|
| 2.1 | Click "Register" → select Library A (`test-a.edu`) | Only configured partner domains shown |
| 2.2 | Enter `inst.visitor@test.local` → submit | Domain validation at UI |
| 2.3 | Show OTP sent (check Mailpit at `localhost:8025`) | 120s cooldown enforced; HMAC-signed OTP |
| 2.4 | Enter OTP → verify account created | `approval_status='approved'`, `is_active=true`, `otp_verified=true` |
| 2.5 | Sign in with password → AAL1 session | `aal` claim = `aal1` in JWT |
| 2.6 | Show role-based redirect to `/visitor` dashboard | ShelfHeader shows notification bell, dark mode toggle |

**Key Technical Point:** Registration uses `send-visitor-otp` Edge Function with delivery intents, CAS state machine, and HMAC verification.

---

### Segment 3: Visitor Dashboard & Catalog (5 minutes)

**Narrative:** *"Approved visitors access the catalog with role-appropriate visibility: library books, public personal books, and their own personal books."*

| Step | Action | Talking Points |
|------|--------|----------------|
| 3.1 | Navigate Catalog tab | Library books + public personal + own personal |
| 3.2 | Search by title/author/ISBN/call number | Server-side filtering; `get_opac_filtered_book_count` RPC |
| 3.3 | Filter by category, availability, library | Debug panel shows RPC vs client counts matching |
| 3.4 | Click book → Book Details modal | `BookCover` component with `imageFit="contain"`/`"cover"` |
| 3.5 | Show external catalog entries marked "Unavailable" | Clear non-borrowable distinction |
| 3.6 | Submit review (rating + comment) | Eligibility: must have borrowed + returned |
| 3.7 | Show review displays as "Verified Reader" | Anonymous display; no visitor_id exposed |

**Demo Evidence:** Network tab shows SECURITY INVOKER RPCs respecting RLS.

---

### Segment 4: Community Book Workflow (4 minutes)

**Narrative:** *"Community books enable peer-to-peer lending with owner approval, FIFO queue promotion, and synchronous inventory management."*

| Step | Action | Talking Points |
|------|--------|----------------|
| 4.1 | Switch to Community Books tab | Community book list with availability |
| 4.2 | Request available community copy (Visitor 1) | Queue position = 1; owner notified |
| 4.3 | Switch to Owner (Visitor 2) → Approve request | `approve_community_book_request`: FOR UPDATE lock, availability check, queue ordering |
| 4.4 | Show available_copies decremented | Inventory trigger `update_community_book_copy_availability` |
| 4.5 | Owner cancels approved request → queue promotion | `cancel_community_book_request` calls `promote_next_community_request()` synchronously |
| 4.6 | Show FIFO promotion: next requester notified | `promote_next_community_request()` uses `ORDER BY request_date ASC, id ASC` with FOR UPDATE |
| 4.7 | Mention: 7-day auto-expiry via `auto_expire_community_requests()` cron | `pg_cron` required (Track B verification) |

**Key Technical Point:** **Synchronous promotion** (Option A) — trigger calls `promote_next_community_request()` directly within transaction. No `pg_notify` dead code. Atomic, no external dependency.

---

### Segment 5: Library Borrowing & Staff Operations (5 minutes)

**Narrative:** *"Library books use staff-mediated pickup/return with QR identification, rate snapshots, and branch-scoped authorization."*

| Step | Action | Talking Points |
|------|--------|----------------|
| 5.1 | Visitor: Create library book request at Library A | `request_borrow_v2` → `shelf_private.request_borrow_unchecked` with FOR UPDATE on books |
| 5.2 | Switch to Sub-admin (Library A, AAL2) | MFA required for ALL staff operations |
| 5.3 | Sub-admin: Book Transactions → Approve pickup | `confirm_pickup_v2` → `confirm_pickup`: state machine `ready_for_pickup → borrowed`, `fine_rate_snapshot` |
| 5.4 | Show QR scan simulation (Visitor QR) | `lookup_attendance_visitor_v2` for attendance; QR for borrowing |
| 5.5 | Sub-admin: Confirm return → fine calculation | `confirm_return_v2` → `confirm_return`: `borrowed → returned`, fine from snapshot, queue promotion |
| 5.6 | Attempt Sub-admin Library B access → 403 | `is_active_staff_for_branch()` enforces branch scoping at DB level |

**Key Technical Point:** AAL2 required for staff; legacy `confirm_pickup`/`confirm_return` corrected to use branch access (NOT `visitor_id = auth.uid()`).

---

### Segment 6: Fine Payment Privacy (3 minutes)

**Narrative:** *"Financial privacy is enforced at the database layer: Super Admin sees only aggregates; Sub-admin sees branch-scoped details; visitors see only their own."*

| Step | Action | Talking Points |
|------|--------|----------------|
| 6.1 | Switch to Super Admin (AAL2) | System-wide access |
| 6.2 | Open Analytics → Fine Payments | `get_fine_payment_analytics`: aggregate only, no visitor_id, no individual amounts |
| 6.3 | Show small-cohort suppression (threshold=3) | Cohorts <3 return suppressed/generalized |
| 6.4 | Switch to Sub-admin (Library A) | `get_fine_payment_dashboard`: detailed payments for Library A only |
| 6.5 | Attempt Library B dashboard → 403 | Branch isolation at RPC level |
| 6.6 | Show internal functions have NO grants | `*_internal` functions: owner `postgres`, empty search_path, NO EXECUTE grants |

**Key Technical Point:** Privacy by design — not UI filtering, but database-enforced via RPC grants and cohort suppression.

---

### Segment 7: Super Admin System Management (3 minutes)

**Narrative:** *"Super Admin manages libraries, staff, and system-wide analytics with AAL2 protection."*

| Step | Action | Talking Points |
|------|--------|----------------|
| 7.1 | Super Admin: Libraries & Map → Add test library | Email domain validation; map coordinates |
| 7.2 | Staff Accounts → Create Sub-admin | Temporary password; branch assignment; MFA enrollment |
| 7.3 | Search/filter staff by role, branch, status | System-scoped visibility |
| 7.4 | Disable/Enable Sub-admin → verify access revoked | `is_active` flag respected by `is_active_staff_for_branch()` |
| 7.5 | Attempt to disable Super Admin → blocked | Super Admin accounts protected from UI/endpoint deletion |
| 7.6 | System Analytics → Visitor forecasts (14-day minimum) | `canRunVisitorForecast()` requires 14 days history, 7 observed days, 14 total visits |

---

### Segment 8: Responsive UI & Notifications (2 minutes)

**Narrative:** *"Full responsive design across desktop, tablet, mobile with dark mode and real-time notifications."*

| Step | Action | Talking Points |
|------|--------|----------------|
| 8.1 | Resize browser: 1024px → 768px → 390px | No horizontal overflow; components stack appropriately |
| 8.2 | Toggle dark mode (ShelfHeader) | Persists in localStorage |
| 8.3 | Click notification bell | Due-date reminders, fine alerts, request updates |
| 8.4 | Show QR pass generation/save/refresh | Attendance check-in/out with branch scoping |
| 8.5 | Show Library Map with BatStateU JPLPC Malvar | Leaflet map; `coordinates_verified` flag ✅ **VERIFIED** (14.04482, 121.15677 — corrected from Darasa, Tanauan) |

---

### Segment 9: Security Architecture Summary (2 minutes)

**Narrative:** *"Let me summarize the security architecture that underpins all workflows."*

**Show this slide/notes:**

| Layer | Implementation |
|-------|----------------|
| **Authorization** | 3 roles + anonymous: `visitor` (AAL1), `subadmin` (AAL2), `superadmin` (AAL2) |
| **Database** | RLS on all tables; SECURITY INVOKER RPCs for counts; SECURITY DEFINER only where needed |
| **Function Hardening** | Empty `search_path`; schema-qualified refs; least-privilege grants; AAL checks |
| **Transaction Integrity** | FOR UPDATE locks on books/requests/attendance; state machines; atomic balance updates |
| **Fine Privacy** | Super Admin aggregate-only; Sub-admin branch-scoped; internal functions no grants; cohort suppression (n<3) |
| **Direct Access Eliminated** | 76+ `.from()` calls replaced by 4 Critical RPCs (`get_current_user_role`, `get_visitor_profile`, `get_staff_borrowing_history`, `get_visitor_borrowing_history`) |
| **Migration Integrity** | 167 migrations, SHA-256 manifest, 12 catalog assertions, no signature conflicts |
| **Credential Hygiene** | Anon key = public (no rotation); DB password = CRITICAL (rotation required) |

---

### Segment 10: Release Readiness & Next Steps (2 minutes)

**Narrative:** *"Here is our honest assessment of release readiness."*

**Show this table:**

| Stage | Status | Evidence |
|-------|--------|----------|
| **1. Implementation Complete** | ✅ **DONE** | All 18 areas audited; 167 migrations; all automated checks pass |
| **2. Manual QA Complete** | ❌ **NOT STARTED** | Requires Track B staging; `SHELF_FINAL_MANUAL_QA_CHECKLIST.md` ready |
| **3. DB/Supabase Runtime Verified** | ❌ **BLOCKED** | Track A (PostgreSQL): pg_cron/pg_net gap; Track B (Supabase): no isolated project |
| **4. Production Release Ready** | ❌ **NOT READY** | Credential rotation required; Track A/B incomplete; production config unverified |

**Critical Path to READY:**
1. Owner rotates database password (CRITICAL)
2. Owner provisions isolated Supabase staging
3. Execute Track A (PostgreSQL replay) + Track B (Auth/PostgREST matrix)
4. Complete Manual QA checklist in staging
5. Verify fine-payment privacy Phase 1B/C
6. **COMPLETED:** BatStateU coordinates verified and corrected (14.04482, 121.15677)
7. Production schema reconciliation

---

## Demo Script Notes

### Do Say
- "This demonstrates the implemented UI and workflow logic."
- "The backend security (RLS, RPC grants, AAL checks) is implemented in migrations but requires Track B runtime verification."
- "We have 167 migrations with full catalog assertions — ready for independent replay."
- "The 49 skipped unit tests are blocked by infrastructure, not failures."
- "Credential exposure is documented; rotation is an owner action item."

### Do NOT Say
- "The system is production-ready." (It is NOT)
- "All security controls are verified." (They are source-verified; runtime needs Track B)
- "The database has been tested." (Migration replay not executed)
- "Fine privacy works in production." (Source complete; runtime Phase 1B/C pending)
- "We have 21 notification types working." (Source verified; Edge Function delivery needs Track B)

### If Asked About Gaps
- **pg_cron/pg_net:** "Windows PostgreSQL 18 doesn't support these. Track B (Supabase stack) required."
- **Track B not run:** "Requires isolated Supabase project with Auth/MFA/Edge Functions. Owner must provision."
- **Credentials:** "Anon key is public by design. DB password exposed in git — owner must rotate via Supabase Dashboard."
- **Skipped tests:** "49 tests blocked by infrastructure. They are not passing — they are explicitly BLOCKED."

---

## Post-Demo Deliverables to Share

1. `SHELF_FINAL_MANUAL_QA_CHECKLIST.md` — Complete test cases
2. `SHELF_18_AREA_MASTER_CHECKLIST.md` — Area-by-area status
3. `SHELF_FINAL_RELEASE_READINESS.md` — This readiness report
4. `SHELF_STAGING_TEST_INSTRUCTIONS.md` — Exact Track A/B procedures
5. `AUTH_POSTGREST_TEST_PLAN.md` — 3-role × 2-AAL matrix
6. `DATABASE_REPLAY_PROCEDURE.md` — Track A/B procedures
7. `RELEASE_VALIDATION_RUNBOOK.md` — Credential rotation, gates

---

## Recording Checklist

- [ ] Screen recording starts at Segment 1
- [ ] Network tab visible for RPC calls
- [ ] Console tab visible for errors
- [ ] Browser responsive mode shown (Segments 3, 8)
- [ ] Mailpit shown for OTP (Segment 2)
- [ ] Multiple incognito windows for role switching
- [ ] DevTools Application tab for localStorage (dark mode, search history)
- [ ] Recording saved as `shelf-capstone-demo-<date>.mp4`

---

**End of Demonstration Sequence**
*Honest demonstration of implemented capabilities with clear acknowledgment of verification gaps.*