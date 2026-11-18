# SHELF ILMS Final Manual QA Checklist

**Version:** 1.0
**Date:** 2026-11-17
**Scope:** End-to-end verification for capstone demonstration and controlled release assessment
**Status:** NOT EXECUTED — All tests require actual performance in staging environment
**Local Fixes Applied (2026-11-17):**
- Migration `20270103000900`: Fixed version comment from "16" to "21" notification events (source-only doc fix)
- `src/data/store.js`: Removed hardcoded SUPER_ADMIN_CREDENTIALS and SUB_ADMIN_CREDENTIALS arrays
- Working directory: Deleted `.env` and `.env.local` files containing production credentials

---

## Instructions

- **Do not mark any test as PASS until it has been actually performed** with evidence recorded.
- Use designated disposable test accounts and data only. Never use production records.
- Record **Actual Result**, **Pass/Fail/Blocked**, and **Evidence/Screenshot Reference** for every test.
- Negative tests (unauthorized access, boundary violations) are mandatory — they verify security controls.
- Responsive UI checks must be performed at desktop (≥1024px), tablet (768px), and mobile (390px) breakpoints.
- The 49 skipped unit tests remain **unverified** — do not report them as passing.

---

## Test User Accounts Required

| Account | Email | Role | Account State | AAL | Branch |
|---------|-------|------|---------------|-----|--------|
| VIS-1 | inst.visitor@test.local | Visitor | Institutional approved | AAL1 | Library A |
| VIS-2 | comm.visitor.approved@test.local | Visitor | Community approved | AAL1 | Library A |
| VIS-3 | comm.visitor.pending@test.local | Visitor | Community pending | AAL1 | Library A |
| SUB-1 | subadmin@test.local | Sub-admin | Active staff | AAL2 | Library A |
| SUB-2 | subadmin-b@test.local | Sub-admin | Active staff | AAL2 | Library B |
| SUP-1 | superadmin@test.local | Super Admin | Active staff | AAL2 | System-wide |
| ANON | (anonymous) | Anonymous | N/A | N/A | N/A |

**Prerequisites:** Isolated Supabase project with all 167 migrations applied, MFA/TOTP enabled for AAL2 accounts, test data seeded per `AUTH_POSTGREST_TEST_PLAN.md`.

---

## Section 1: Visitor Workflows (Institutional Approved — VIS-1)

### 1.1 Authentication & Account Management

| Test ID | Preconditions | Steps | Expected Result | Actual Result | Pass/Fail/Blocked | Evidence |
|---------|---------------|-------|-----------------|---------------|-------------------|----------|
| VIS-AUTH-01 | VIS-1 credentials ready, MFA enrolled | 1. Navigate to `/visitor-login`<br>2. Enter email/password<br>3. Complete TOTP challenge | Successful login, AAL1 session created, redirect to `/visitor` dashboard | | | |
| VIS-AUTH-02 | VIS-1 logged in | 1. Click profile avatar → Sign Out<br>2. Attempt to access `/visitor` | Redirected to `/visitor-login`, session invalidated | | | |
| VIS-AUTH-03 | VIS-1 logged in | 1. Refresh browser<br>2. Verify session persists | Dashboard loads without re-login | | | |
| VIS-AUTH-04 | VIS-1 logged in | 1. Navigate to `/subadmin`<br>2. Navigate to `/superadmin` | Redirected to `/visitor` (role guard) | | | |
| VIS-AUTH-05 | VIS-1 logged in | 1. Request password reset via UI<br>2. Check email catcher<br>3. Complete reset | Reset email sent, new password works | | | |
| VIS-AUTH-06 | VIS-1 logged in | 1. Accept visitor terms checkbox<br>2. Save profile<br>3. Sign out/in | Terms acceptance persisted | | | |
| VIS-AUTH-07 | VIS-1 logged in | 1. Attempt to access VIS-2 profile via direct URL/API | 403 Forbidden — cross-visitor access denied | | | |

### 1.2 Catalog & Discovery

| Test ID | Preconditions | Steps | Expected Result | Actual Result | Pass/Fail/Blocked | Evidence |
|---------|---------------|-------|-----------------|---------------|-------------------|----------|
| VIS-CAT-01 | VIS-1 logged in | 1. Navigate to `/catalog`<br>2. Verify library books load | Library books + public personal books + own personal books displayed | | | |
| VIS-CAT-02 | VIS-1 logged in | 1. Search by title "Test Book"<br>2. Filter by category "Fiction"<br>3. Filter by availability "Available" | Results match filters; server-side RPC count matches displayed | | | |
| VIS-CAT-03 | VIS-1 logged in | 1. Search by ISBN "978-0123456789"<br>2. Search by author "Test Author" | Results returned; call number search works | | | |
| VIS-CAT-04 | VIS-1 logged in | 1. Click external catalog entry<br>2. Verify "Unavailable" badge shown | External books clearly marked non-borrowable | | | |
| VIS-CAT-05 | VIS-1 logged in | 1. Click book card → Book Details modal<br>2. Verify availability shows per selected branch | Copy counts accurate; branch-specific availability | | | |
| VIS-CAT-06 | VIS-1 logged in | 1. Submit review (rating 4, comment)<br>2. Verify display shows "Verified Reader"<br>3. Attempt to read VIS-2 review via API | Review submitted; anonymous display name; cross-visitor review read denied (403) | | | |
| VIS-CAT-07 | VIS-1 logged in | 1. Verify OPAC total count RPC matches UI<br>2. Verify filtered count RPC matches UI | RPC counts = client-side counts; debug panel consistent | | | |

### 1.3 Reading List & Personal Books

| Test ID | Preconditions | Steps | Expected Result | Actual Result | Pass/Fail/Blocked | Evidence |
|---------|---------------|-------|-----------------|---------------|-------------------|----------|
| VIS-RLB-01 | VIS-1 logged in | 1. Add 3 books to reading list<br>2. Sign out/in<br>3. Verify list persists | All 3 items present after reload | | | |
| VIS-RLB-02 | VIS-1 logged in | 1. Add personal book without cover<br>2. Add personal book with cover upload<br>3. Verify both in "My Books" | Books saved; cover loads; visibility/lending settings work | | | |
| VIS-RLB-03 | VIS-1 logged in | 1. Edit personal book: change category, fine rate, visibility<br>2. Verify validation rejects invalid category/fine rate | Changes saved; invalid inputs rejected with clear message | | | |
| VIS-RLB-04 | VIS-1 logged in | 1. Remove personal book with active borrow request<br>2. Verify dependent data handling | Removal blocked or cascades correctly per business rules | | | |
| VIS-RLB-05 | VIS-1 logged in | 1. Attempt to add personal book with malformed cover URL<br>2. Attempt invalid fine rate (negative) | Both rejected with validation errors | | | |

### 1.4 Community Book Requests

| Test ID | Preconditions | Steps | Expected Result | Actual Result | Pass/Fail/Blocked | Evidence |
|---------|---------------|-------|-----------------|---------------|-------------------|----------|
| VIS-CBR-01 | VIS-1 logged in, community book with available copies | 1. Request available community copy<br>2. Verify queue position = 1<br>3. Verify owner notification created | Request created; queue position 1; notification to owner | | | |
| VIS-CBR-02 | VIS-1 logged in, community book with 0 available copies | 1. Attempt to request | Rejected at UI and RPC — "no available copies" | | | |
| VIS-CBR-03 | VIS-1 logged in | 1. Create duplicate active request for same book<br>2. Request own community book | Both rejected — duplicate and self-owned ineligible | | | |
| VIS-CBR-04 | VIS-1 (owner) logged in, pending request from VIS-2 | 1. Approve request<br>2. Verify VIS-2 status → approved<br>3. Verify available_copies decremented | Request approved; copy count updated; VIS-2 notified | | | |
| VIS-CBR-05 | VIS-1 (owner) logged in, approved request from VIS-2 | 1. Cancel approved request<br>2. Verify status → rejected<br>3. Verify queue promotion to next requester | Request cancelled; availability restored; next in queue promoted (FIFO) | | | |
| VIS-CBR-06 | VIS-1 (requester) logged in, borrowed community book | 1. Return book via UI<br>2. Verify status → returned<br>3. Verify fine snapshot if overdue<br>4. Verify queue promotion | Return processed; fine calculated from snapshot; next requester promoted | | | |
| VIS-CBR-07 | VIS-1 logged in | 1. Verify 7-day auto-expiry for pending requests<br>2. Verify notifications sent to both parties | Expired requests auto-cancelled; notifications created | | | |

### 1.5 Library Book Borrowing & Returns

| Test ID | Preconditions | Steps | Expected Result | Actual Result | Pass/Fail/Blocked | Evidence |
|---------|---------------|-------|-----------------|---------------|-------------------|----------|
| VIS-LBR-01 | VIS-1 logged in, library book available at Library A | 1. Create library borrow request<br>2. Verify branch eligibility (Library A)<br>3. Verify inventory check | Request created; status = pending; copy reserved | | | |
| VIS-LBR-02 | VIS-1 logged in, request approved by SUB-1 | 1. Verify status → ready_for_pickup<br>2. Verify due date set<br>3. Verify pickup notification | Ready for pickup; due date = checkout + loan period; notification sent | | | |
| VIS-LBR-03 | VIS-1 logged in, book ready for pickup | 1. SUB-1 scans QR → confirm pickup<br>2. Verify status → borrowed<br>3. Verify available_copies decremented | Pickup confirmed; status borrowed; inventory updated | | | |
| VIS-LBR-04 | VIS-1 logged in, book borrowed | 1. SUB-1 scans QR → confirm return<br>2. Verify status → returned<br>3. Verify fine if overdue (rate snapshot)<br>4. Verify queue promotion | Return processed; fine from snapshot; next in queue promoted | | | |
| VIS-LBR-05 | VIS-1 logged in, hold expired | 1. Attempt pickup after hold expiry | Rejected — expired hold not ready for pickup | | | |
| VIS-LBR-06 | VIS-1 logged in, request not ready | 1. Attempt pickup while status = pending | Rejected — not ready for pickup | | | |

### 1.6 Visitor Services

| Test ID | Preconditions | Steps | Expected Result | Actual Result | Pass/Fail/Blocked | Evidence |
|---------|---------------|-------|-----------------|---------------|-------------------|----------|
| VIS-SVC-01 | VIS-1 logged in | 1. Generate QR pass<br>2. Display/refresh/save QR<br>3. Scan with SUB-1 device | QR generated; refresh works; scan successful | | | |
| VIS-SVC-02 | VIS-1 logged in | 1. Check in at Library A<br>2. Check out<br>3. Verify attendance log | Check-in/out recorded; branch-scoped to Library A | | | |
| VIS-SVC-03 | VIS-1 logged in | 1. Attempt check-in at Library B | Rejected — cross-branch attendance denied | | | |
| VIS-SVC-04 | VIS-1 logged in | 1. Submit feedback<br>2. Verify appears to VIS-1 and Library A staff | Feedback submitted; visible to visitor and branch staff | | | |
| VIS-SVC-05 | VIS-1 logged in | 1. View announcements (branch + system)<br>2. Verify audience filtering | Correct announcements displayed per audience | | | |
| VIS-SVC-06 | VIS-1 logged in | 1. Open notifications bell<br>2. Verify due-date reminders, fine alerts, request updates | Notifications accurate and timely | | | |
| VIS-SVC-07 | VIS-1 logged in | 1. View profile and request history<br>2. Verify no other visitor data visible | Only own data displayed | | | |

---

## Section 2: Visitor Workflows (Community Approved — VIS-2)

| Test ID | Preconditions | Steps | Expected Result | Actual Result | Pass/Fail/Blocked | Evidence |
|---------|---------------|-------|-----------------|---------------|-------------------|----------|
| VIS2-01 | VIS-2 logged in | 1. Repeat VIS-CBR-01 through VIS-CBR-07 | All community book workflows work identically to institutional | | | |
| VIS2-02 | VIS-2 logged in | 1. Repeat VIS-LBR-01 through VIS-LBR-06 | Library borrowing works identically | | | |
| VIS2-03 | VIS-2 logged in | 1. Verify community visitor can request community books<br>2. Verify community visitor can request library books | Both request types allowed for approved community | | | |

---

## Section 3: Visitor Workflows (Community Pending — VIS-3) — **Negative/Restricted Access Tests**

| Test ID | Preconditions | Steps | Expected Result | Actual Result | Pass/Fail/Blocked | Evidence |
|---------|---------------|-------|-----------------|---------------|-------------------|----------|
| VIS3-01 | VIS-3 logged in (pending) | 1. Attempt to create community book request | 403 Forbidden — pending visitors blocked from borrowing | | | |
| VIS3-02 | VIS-3 logged in | 1. Attempt library book request | 403 Forbidden | | | |
| VIS3-03 | VIS-3 logged in | 1. Access OPAC catalog | 200 OK — read-only catalog access allowed | | | |
| VIS3-04 | VIS-3 logged in | 1. Access own pending status page | 200 OK — can read own status | | | |
| VIS3-05 | VIS-3 logged in | 1. Attempt to access borrow workflows | 403 Forbidden | | | |

---

## Section 4: Sub-Admin Workflows (SUB-1 — Library A, AAL2)

### 4.1 Authentication & Authorization

| Test ID | Preconditions | Steps | Expected Result | Actual Result | Pass/Fail/Blocked | Evidence |
|---------|---------------|-------|-----------------|---------------|-------------------|----------|
| SUB-AUTH-01 | SUB-1 credentials, MFA enrolled | 1. Login with password only (AAL1)<br>2. Attempt any staff RPC | 403 Forbidden — AAL2 required for all staff operations | | | |
| SUB-AUTH-02 | SUB-1 credentials, MFA enrolled | 1. Login with password + TOTP (AAL2)<br>2. Access `/subadmin` dashboard | Dashboard loads with Library A context | | | |
| SUB-AUTH-03 | SUB-1 AAL2 session | 1. Attempt to access `/superadmin` | Redirected to `/subadmin` | | | |
| SUB-AUTH-04 | SUB-1 AAL2 session | 1. Switch to AAL1 (logout/login without MFA)<br>2. Attempt staff RPC | 403 — session downgraded, AAL2 required | | | |

### 4.2 Dashboard & Branch Operations

| Test ID | Preconditions | Steps | Expected Result | Actual Result | Pass/Fail/Blocked | Evidence |
|---------|---------------|-------|-----------------|---------------|-------------------|----------|
| SUB-DASH-01 | SUB-1 AAL2 | 1. Load Overview<br>2. Verify metrics match branch-scoped source data | All widgets show Library A data only | | | |
| SUB-DASH-02 | SUB-1 AAL2 | 1. Load Analytics<br>2. Verify 14-day minimum for forecasting | Forecast unavailable if <14 days history; explanation shown | | | |
| SUB-DASH-03 | SUB-1 AAL2 | 1. Search visitor accounts<br>2. Verify only Library A visitors visible | Cross-library visitors hidden | | | |
| SUB-DASH-04 | SUB-1 AAL2 | 1. Scan VIS-1 QR for attendance<br>2. Verify identity, branch, eligibility | Attendance check-in recorded for Library A | | | |
| SUB-DASH-05 | SUB-1 AAL2 | 1. Attempt attendance for VIS-3 (Library B visitor) | Rejected — cross-branch denied | | | |
| SUB-DASH-06 | SUB-1 AAL2 | 1. Check in/out duplicate attendance | Duplicate prevented — only one active check-in | | | |

### 4.3 Inventory Management

| Test ID | Preconditions | Steps | Expected Result | Actual Result | Pass/Fail/Blocked | Evidence |
|---------|---------------|-------|-----------------|---------------|-------------------|----------|
| SUB-INV-01 | SUB-1 AAL2 | 1. Add new library book<br>2. Verify total/available/reserved/borrowed counts | Counts consistent; available = total - reserved - borrowed | | | |
| SUB-INV-02 | SUB-1 AAL2 | 1. Edit inventory: change total copies<br>2. Verify available_copies constraint | available_copies ≤ total_copies enforced | | | |
| SUB-INV-03 | SUB-1 AAL2 | 1. Import inventory CSV<br>2. Export inventory CSV/Excel/PDF | Import/export works; data integrity maintained | | | |

### 4.4 Reservation Queue & Transactions

| Test ID | Preconditions | Steps | Expected Result | Actual Result | Pass/Fail/Blocked | Evidence |
|---------|---------------|-------|-----------------|---------------|-------------------|----------|
| SUB-QUE-01 | SUB-1 AAL2, pending library requests | 1. Approve/cancel/promote queue entries<br>2. Verify ordering and availability | FIFO ordering; availability updated correctly | | | |
| SUB-QUE-02 | SUB-1 AAL2, request ready_for_pickup | 1. Process pickup (confirm_pickup_v2)<br>2. Verify status → borrowed, fine_rate_snapshot | Pickup processed; rate snapshot captured | | | |
| SUB-QUE-03 | SUB-1 AAL2, request borrowed | 1. Process return (confirm_return_v2)<br>2. Verify fine calculation, overdue state<br>3. Verify queue promotion | Return processed; fine from snapshot; queue promoted | | | |
| SUB-QUE-04 | SUB-1 AAL2, other branch request | 1. Attempt pickup/return for Library B request | 403 Forbidden — cross-library denied | | | |

### 4.5 Fine Management

| Test ID | Preconditions | Steps | Expected Result | Actual Result | Pass/Fail/Blocked | Evidence |
|---------|---------------|-------|-----------------|---------------|-------------------|----------|
| SUB-FINE-01 | SUB-1 AAL2 | 1. Access fine dashboard<br>2. Verify detailed payments for Library A | Detailed payments visible (visitor_id, amounts) | | | |
| SUB-FINE-02 | SUB-1 AAL2 | 1. Attempt fine dashboard for Library B | 403 Forbidden — cross-library denied | | | |
| SUB-FINE-03 | SUB-1 AAL2 | 1. Record fine payment (partial)<br>2. Verify atomic balance, no overpayment | Partial payment accepted; balance updated atomically | | | |
| SUB-FINE-04 | SUB-1 AAL2 | 1. Access alert targets<br>2. Verify branch-scoped | Only Library A visitors with due fines | | | |

### 4.6 Branch Reports & Communications

| Test ID | Preconditions | Steps | Expected Result | Actual Result | Pass/Fail/Blocked | Evidence |
|---------|---------------|-------|-----------------|---------------|-------------------|----------|
| SUB-REP-01 | SUB-1 AAL2 | 1. Generate branch report with date filters<br>2. Export CSV/Excel/PDF | Reports accurate; exports valid | | | |
| SUB-REP-02 | SUB-1 AAL2 | 1. Reply to visitor feedback<br>2. Create branch-targeted announcement<br>3. Verify expiry and audience | Replies sent; announcements targeted correctly | | | |

---

## Section 5: Sub-Admin Workflows (SUB-2 — Library B) — **Cross-Branch Denial Tests**

| Test ID | Preconditions | Steps | Expected Result | Actual Result | Pass/Fail/Blocked | Evidence |
|---------|---------------|-------|-----------------|---------------|-------------------|----------|
| SUB2-01 | SUB-2 AAL2 (Library B) | 1. Attempt to read Library A borrow requests | 403 Forbidden | | | |
| SUB2-02 | SUB-2 AAL2 | 1. Attempt Library A fine dashboard | 403 Forbidden | | | |
| SUB2-03 | SUB-2 AAL2 | 1. Attempt Library A inventory edit | 403 Forbidden | | | |
| SUB2-04 | SUB-2 AAL2 | 1. Attempt Library A pickup/return | 403 Forbidden | | | |
| SUB2-05 | SUB-2 AAL2 | 1. Attempt OPAC branch count RPC for Library A | 403 Forbidden | | | |
| SUB2-06 | SUB-2 AAL2 | 1. Verify own Library B operations work | 200 OK — branch-scoped access confirmed | | | |

---

## Section 6: Super Admin Workflows (SUP-1 — System-wide, AAL2)

### 6.1 Authentication & Authorization

| Test ID | Preconditions | Steps | Expected Result | Actual Result | Pass/Fail/Blocked | Evidence |
|---------|---------------|-------|-----------------|---------------|-------------------|----------|
| SUP-AUTH-01 | SUP-1 credentials, MFA enrolled | 1. Login with password only (AAL1)<br>2. Attempt any staff RPC mutation | 403 Forbidden — AAL2 required | | | |
| SUP-AUTH-02 | SUP-1 credentials, MFA enrolled | 1. Login with password + TOTP (AAL2)<br>2. Access `/superadmin` dashboard | Dashboard loads with system-wide context | | | |

### 6.2 Library & Staff Management

| Test ID | Preconditions | Steps | Expected Result | Actual Result | Pass/Fail/Blocked | Evidence |
|---------|---------------|-------|-----------------|---------------|-------------------|----------|
| SUP-LIB-01 | SUP-1 AAL2 | 1. Add test library with valid email domain<br>2. Verify map details | Library created; domain validated | | | |
| SUP-LIB-02 | SUP-1 AAL2 | 1. Edit test library<br>2. Disable/enable library | Changes applied; status toggles | | | |
| SUP-STAFF-01 | SUP-1 AAL2 | 1. Create test sub-admin with temp password, Library A<br>2. Verify MFA enrollment prompt | Sub-admin created; can login with AAL2 | | | |
| SUP-STAFF-02 | SUP-1 AAL2 | 1. Search/filter staff by name, email, branch, role, active | All filters work; results accurate | | | |
| SUP-STAFF-03 | SUP-1 AAL2 | 1. Edit sub-admin branch assignment<br>2. Disable/re-enable sub-admin<br>3. Verify access changes | Assignment updated; access revoked/restored | | | |
| SUP-STAFF-04 | SUP-1 AAL2 | 1. Delete disposable test sub-admin<br>2. Verify safe cleanup | Account removed; no orphaned data | | | |
| SUP-STAFF-05 | SUP-1 AAL2 | 1. Attempt to disable super-admin account | Blocked — super-admin accounts cannot be disabled/deleted | | | |
| SUP-STAFF-06 | SUP-1 AAL2 | 1. Search/manage visitor accounts system-wide<br>2. Verify permission-controlled | System-scoped visitor management | | | |

### 6.3 Analytics & Reports

| Test ID | Preconditions | Steps | Expected Result | Actual Result | Pass/Fail/Blocked | Evidence |
|---------|---------------|-------|-----------------|---------------|-------------------|----------|
| SUP-ANL-01 | SUP-1 AAL2 | 1. Access fine analytics (aggregate)<br>2. Verify NO visitor PII (no visitor_id, no amounts per visitor) | Aggregate counts only; small-cohort suppression (threshold=3) | | | |
| SUP-ANL-02 | SUP-1 AAL2 | 1. Attempt fine dashboard (detailed) | 403 Forbidden — Sub-admin only | | | |
| SUP-ANL-03 | SUP-1 AAL2 | 1. View system-wide borrow requests<br>2. View system analytics<br>3. Verify branch aggregation | All libraries visible; metrics aggregate correctly | | | |
| SUP-ANL-04 | SUP-1 AAL2 | 1. Generate system-wide reports/exports<br>2. Validate totals, filters, output | Reports accurate; exports valid | | | |

### 6.4 Feedback & Announcements

| Test ID | Preconditions | Steps | Expected Result | Actual Result | Pass/Fail/Blocked | Evidence |
|---------|---------------|-------|-----------------|---------------|-------------------|----------|
| SUP-COM-01 | SUP-1 AAL2 | 1. Manage feedback (all branches)<br>2. Create/edit system-wide announcement<br>3. Verify audience, expiry | Full system communication access | | | |
| SUP-COM-02 | SUP-1 AAL2 | 1. View audit history for admin changes<br>2. Verify no unnecessary visitor data exposed | Audit trail complete; visitor PII protected | | | |

---

## Section 7: Anonymous Access — **Negative/Boundary Tests**

| Test ID | Preconditions | Steps | Expected Result | Actual Result | Pass/Fail/Blocked | Evidence |
|---------|---------------|-------|-----------------|---------------|-------------------|----------|
| ANON-01 | Not logged in | 1. Access `/catalog` | Redirected to `/visitor-login` | | | |
| ANON-02 | Not logged in | 1. GET `/rest/v1/books?book_type=eq.library` (anon key) | 200 OK — library books only | | | |
| ANON-03 | Not logged in | 1. GET `/rest/v1/books?book_type=eq.personal&is_public=eq.true` | 200 OK — public personal books only | | | |
| ANON-04 | Not logged in | 1. GET `/rest/v1/external_catalog_books` | 200 OK — all external | | | |
| ANON-05 | Not logged in | 1. POST `/rest/v1/rpc/get_opac_library_book_count` | 200 OK — valid count | | | |
| ANON-06 | Not logged in | 1. POST `/rest/v1/rpc/get_opac_library_book_count_by_library` | 401/403 — branch enumeration blocked | | | |
| ANON-07 | Not logged in | 1. Access visitor profiles API | 401/403 | | | |
| ANON-08 | Not logged in | 1. Access borrow requests API | 401/403 | | | |
| ANON-09 | Not logged in | 1. Access landing page | 200 OK — public data loads | | | |

---

## Section 8: Negative Tests — Security Boundaries

### 8.1 Cross-Visitor Violations

| Test ID | Role | Preconditions | Steps | Expected Result | Actual Result | Pass/Fail/Blocked | Evidence |
|---------|------|---------------|-------|-----------------|---------------|-------------------|----------|
| NEG-XV-01 | VIS-1 (AAL1) | VIS-1 logged in | 1. GET `/rest/v1/visitors?id=eq.<VIS-2-id>` | 403 Forbidden | | | |
| NEG-XV-02 | VIS-1 (AAL1) | VIS-1 logged in | 1. GET `/rest/v1/borrow_requests?visitor_id=eq.<VIS-2-id>` | 403 Forbidden | | | |
| NEG-XV-03 | VIS-1 (AAL1) | VIS-1 logged in | 1. POST `/rest/v1/rpc/get_visitor_borrowing_history` with VIS-2 ID | 403 Forbidden | | | |
| NEG-XV-04 | VIS-1 (AAL1) | VIS-1 logged in | 1. Attempt to read VIS-2 review via direct table access | 403 Forbidden (RLS) | | | |
| NEG-XV-05 | VIS-1 (AAL1) | VIS-1 logged in | 1. Attempt to modify VIS-2 personal book | 403 Forbidden | | | |

### 8.2 Cross-Branch Violations

| Test ID | Role | Preconditions | Steps | Expected Result | Actual Result | Pass/Fail/Blocked | Evidence |
|---------|------|---------------|-------|-----------------|---------------|-------------------|----------|
| NEG-XB-01 | SUB-1 (AAL2) | SUB-1 logged in | 1. GET borrow_requests for Library B | 403 Forbidden | | | |
| NEG-XB-02 | SUB-1 (AAL2) | SUB-1 logged in | 1. POST confirm_pickup for Library B request | 403 Forbidden | | | |
| NEG-XB-03 | SUB-1 (AAL2) | SUB-1 logged in | 1. GET fine dashboard for Library B | 403 Forbidden | | | |
| NEG-XB-04 | SUB-1 (AAL2) | SUB-1 logged in | 1. POST OPAC branch count RPC for Library B | 403 Forbidden | | | |
| NEG-XB-05 | SUB-1 (AAL2) | SUB-1 logged in | 1. GET visitor accounts for Library B | 403 Forbidden | | | |

### 8.3 Role Escalation Violations

| Test ID | Role | Preconditions | Steps | Expected Result | Actual Result | Pass/Fail/Blocked | Evidence |
|---------|------|---------------|-------|-----------------|---------------|-------------------|----------|
| NEG-RE-01 | VIS-1 (AAL1) | VIS-1 logged in | 1. POST `/rest/v1/rpc/confirm_pickup_v2` | 403 Forbidden — AAL2 required | | | |
| NEG-RE-02 | VIS-1 (AAL1) | VIS-1 logged in | 1. POST `/rest/v1/rpc/record_fine_payment` | 403 Forbidden | | | |
| NEG-RE-03 | VIS-1 (AAL1) | VIS-1 logged in | 1. POST `/rest/v1/rpc/get_fine_payment_analytics` | 403 Forbidden | | | |
| NEG-RE-04 | SUB-1 (AAL1) | SUB-1 logged in (no MFA) | 1. Any staff RPC mutation | 403 Forbidden — AAL2 required | | | |
| NEG-RE-05 | SUB-1 (AAL2) | SUB-1 logged in | 1. POST `/rest/v1/rpc/get_fine_payment_analytics` | 403 Forbidden — Super Admin only | | | |
| NEG-RE-06 | SUP-1 (AAL2) | SUP-1 logged in | 1. POST `/rest/v1/rpc/get_fine_payment_dashboard` | 403 Forbidden — Sub-admin only | | | |

### 8.4 Review Eligibility & Privacy

| Test ID | Role | Preconditions | Steps | Expected Result | Actual Result | Pass/Fail/Blocked | Evidence |
|---------|------|---------------|-------|-----------------|---------------|-------------------|----------|
| NEG-REV-01 | VIS-1 (AAL1) | VIS-1 never borrowed book X | 1. Attempt to review book X | 403 Forbidden — eligibility requires borrowed+returned | | | |
| NEG-REV-02 | VIS-1 (AAL1) | VIS-1 borrowed+returned book X | 1. Submit review for book X<br>2. Verify display shows "Verified Reader"<br>3. VIS-2 attempts to read review via API | 200 OK; anonymous display; VIS-2 sees "Verified Reader" not identity | | | |
| NEG-REV-03 | ANON | Not logged in | 1. GET public book reviews | 200 OK — "Verified Reader" only, no visitor_id | | | |
| NEG-REV-04 | VIS-1 (AAL1) | VIS-1 owns review | 1. Attempt to read own review via direct table | 403 Forbidden (RLS denies direct access) | | | |

### 8.5 Fine Payment Privacy

| Test ID | Role | Preconditions | Steps | Expected Result | Actual Result | Pass/Fail/Blocked | Evidence |
|---------|------|---------------|-------|-----------------|---------------|-------------------|----------|
| NEG-FINE-01 | SUP-1 (AAL2) | SUP-1 logged in | 1. GET `/rest/v1/rpc/get_fine_payment_analytics`<br>2. Inspect response | Aggregate only; no visitor_id; no individual amounts; small cohorts (n<3) suppressed | | | |
| NEG-FINE-02 | SUB-1 (AAL2) | SUB-1 logged in | 1. GET fine dashboard for own branch<br>2. Inspect response | Detailed payments visible (visitor_id, amounts) | | | |
| NEG-FINE-03 | SUB-1 (AAL2) | SUB-1 logged in | 1. GET fine dashboard for other branch | 403 Forbidden | | | |
| NEG-FINE-04 | VIS-1 (AAL1) | VIS-1 logged in | 1. GET fine analytics/dashboard | 403 Forbidden | | | |
| NEG-FINE-05 | ANY | Internal function test | 1. Attempt to call `*_internal` functions directly | 403 Forbidden — NO EXECUTE grants to any role | | | |

### 8.6 OTP Cooldown & Duplicate Prevention

| Test ID | Role | Preconditions | Steps | Expected Result | Actual Result | Pass/Fail/Blocked | Evidence |
|---------|------|---------------|-------|-----------------|---------------|-------------------|----------|
| NEG-OTP-01 | ANON | Registration form | 1. Request OTP<br>2. Immediately request again (<120s) | 429/400 — cooldown enforced | | | |
| NEG-OTP-02 | ANON | Registration form | 1. Request OTP<br>2. Wait 120s<br>3. Request again | 200 OK — cooldown expired | | | |
| NEG-OTP-03 | ANON | Registration form | 1. Submit invalid OTP 5x | Rate limited / lockout | | | |

### 8.7 Duplicate Transaction Prevention

| Test ID | Role | Preconditions | Steps | Expected Result | Actual Result | Pass/Fail/Blocked | Evidence |
|---------|------|---------------|-------|-----------------|---------------|-------------------|----------|
| NEG-DUP-01 | VIS-1 (AAL1) | Active borrow request for book X | 1. Create second request for same book | 409/400 — duplicate active request rejected | | | |
| NEG-DUP-02 | SUB-1 (AAL2) | Attendance check-in for VIS-1 | 1. Attempt second check-in without check-out | 409/400 — duplicate check-in prevented | | | |
| NEG-DUP-03 | SUB-1 (AAL2) | Fine payment for request X | 1. Attempt overpayment (> outstanding) | 400 — atomic balance prevents overpayment | | | |
| NEG-DUP-04 | VIS-1 (AAL1) | Community book request pending | 1. Attempt second request for same community book | 409/400 — duplicate rejected | | | |

---

## Section 9: Notification Lifecycle Tests

| Test ID | Role | Preconditions | Steps | Expected Result | Actual Result | Pass/Fail/Blocked | Evidence |
|---------|------|---------------|-------|-----------------|---------------|-------------------|----------|
| NOTIF-01 | VIS-1 (AAL1) | Borrow request created | 1. Check notifications bell<br>2. Verify "Request Submitted" notification | Notification created with correct type, idempotency key | | | |
| NOTIF-02 | VIS-1 (AAL1) | Request approved | 1. Verify "Request Approved" notification | Created; links to My Requests | | | |
| NOTIF-03 | VIS-1 (AAL1) | Book ready for pickup | 1. Verify "Ready for Pickup" notification | Created with due date | | | |
| NOTIF-04 | VIS-1 (AAL1) | Book borrowed, due date approaching | 1. Verify due-date reminder (Edge Function) | Created by send-due-date-notifications cron | | | |
| NOTIF-05 | VIS-1 (AAL1) | Fine assessed | 1. Verify fine reminder notification | Created by send-fine-reminder cron | | | |
| NOTIF-06 | VIS-1 (AAL1) | Book returned | 1. Verify "Return Confirmed" notification | Created with fine info if applicable | | | |
| NOTIF-07 | VIS-1 (AAL1) | Community request cancelled | 1. Verify cancellation notification | Created for both requester and owner | | | |
| NOTIF-08 | VIS-1 (AAL1) | Queue promotion | 1. Verify promotion notification | Created for next requester | | | |
| NOTIF-09 | VIS-1 (AAL1) | Inventory change (book added) | 1. Verify availability notification if waiting | Created if request was waiting | | | |
| NOTIF-10 | VIS-1 (AAL1) | All notifications | 1. Verify idempotency — duplicate events don't create duplicate notifications | Idempotency key constraint prevents duplicates | | | |
| NOTIF-11 | VIS-1 (AAL1) | Mark notifications read | 1. Click notification → mark read<br>2. Verify read status persists | Read state saved | | | |

**Authoritative Notification Types (21 total — verify against schema):**
1. `borrow_request_submitted`
2. `borrow_request_approved`
3. `borrow_request_rejected`
4. `borrow_request_cancelled`
5. `pickup_ready`
6. `pickup_confirmed`
7. `return_confirmed`
7. `return_overdue`
8. `fine_assessed`
9. `fine_reminder`
10. `fine_paid`
11. `community_request_created`
12. `community_request_approved`
13. `community_request_rejected`
14. `community_request_cancelled`
15. `community_pickup_ready`
16. `community_pickup_confirmed`
17. `community_return_confirmed`
18. `queue_promoted`
19. `availability_restored`
20. `request_expired`
21. `system_announcement`

---

## Section 10: Borrowing, Pickup, Return, Cancellation, Inventory, Fine Payment Workflows

### 10.1 Complete Visitor→Staff Borrowing Flow

| Test ID | Role | Preconditions | Steps | Expected Result | Actual Result | Pass/Fail/Blocked | Evidence |
|---------|------|---------------|-------|-----------------|---------------|-------------------|----------|
| FLOW-01 | VIS-1 → SUB-1 | Library book available at Library A | 1. VIS-1: Create borrow request<br>2. SUB-1: Approve → ready_for_pickup<br>3. VIS-1: Verify notification<br>4. SUB-1: Scan QR → confirm pickup<br>5. VIS-1: Verify status = borrowed<br>6. SUB-1: Scan QR → confirm return<br>7. VIS-1: Verify status = returned, fine if overdue | End-to-end flow complete; all status transitions correct; notifications at each step | | | |
| FLOW-02 | VIS-1 → SUB-1 | Community book available | 1. VIS-1: Request community book<br>2. VIS-2 (owner): Approve<br>3. VIS-1: Pickup (owner confirms)<br>4. VIS-1: Return (owner confirms)<br>5. Verify queue promotion if waiting | Community flow complete; owner actions work; queue promotion on return | | | |
| FLOW-03 | VIS-1 → SUB-1 | Request pending, not approved | 1. VIS-1: Cancel pending request<br>2. Verify status = cancelled<br>3. Verify inventory restored | Cancellation works; availability restored | | | |
| FLOW-04 | VIS-1 → SUB-1 | Request approved, not picked up | 1. VIS-1: Cancel approved request<br>2. Verify status = rejected<br>3. Verify queue promotion | Cancellation works; next requester promoted | | | |
| FLOW-05 | VIS-1 → SUB-1 | Request borrowed | 1. Attempt cancellation | Rejected — must use return flow | | | |

### 10.2 Inventory Consistency

| Test ID | Role | Preconditions | Steps | Expected Result | Actual Result | Pass/Fail/Blocked | Evidence |
|---------|------|---------------|-------|-----------------|---------------|-------------------|----------|
| INV-01 | SUB-1 (AAL2) | Library book: total=5, available=3, borrowed=2 | 1. Process pickup → available=2, borrowed=3<br>2. Process return → available=3, borrowed=2 | Counts consistent at each step | | | |
| INV-02 | SUB-1 (AAL2) | Community book: total=3, available=1 | 1. Approve request → available=0<br>2. Return → available=1, queue promoted | Community inventory tracked separately; promotion works | | | |
| INV-03 | SUB-1 (AAL2) | Mixed library + community | 1. Verify library allocations don't affect community availability | Separate validation per `enforce_book_copy_inventory` | | | |

### 10.3 Fine Payment Workflow

| Test ID | Role | Preconditions | Steps | Expected Result | Actual Result | Pass/Fail/Blocked | Evidence |
|---------|------|---------------|-------|-----------------|---------------|-------------------|----------|
| FINE-01 | VIS-1 → SUB-1 | Overdue return, fine assessed | 1. SUB-1: View fine dashboard → see VIS-1 payment due<br>2. VIS-1: Pay fine (full)<br>3. SUB-1: Verify payment recorded, balance=0 | Payment recorded; fine_paid_amount updated; review flag if needed | | | |
| FINE-02 | VIS-1 → SUB-1 | Overdue return, partial payment | 1. VIS-1: Pay partial amount<br>2. SUB-1: Verify balance = original - paid<br>3. VIS-1: Pay remaining<br>4. SUB-1: Verify balance=0 | Partial payments supported; atomic balance updates | | | |
| FINE-03 | SUB-1 (AAL2) | Fine review required | 1. SUB-1: Resolve fine review (waive/adjust)<br>2. Verify audit trail | Review resolved; note recorded | | | |

---

## Section 11: Super Admin Aggregate-Only Fine Analytics & Sub Admin Branch-Scoped Analytics

| Test ID | Role | Preconditions | Steps | Expected Result | Actual Result | Pass/Fail/Blocked | Evidence |
|---------|------|---------------|-------|-----------------|---------------|-------------------|----------|
| ANL-01 | SUP-1 (AAL2) | Fine payments exist across branches | 1. Call `get_fine_payment_analytics`<br>2. Inspect response | Aggregate counts only; no visitor_id; no individual amounts; cohorts <3 suppressed | | | |
| ANL-02 | SUP-1 (AAL2) | Small cohort (2 visitors with fines in Library A) | 1. Call analytics for Library A<br>2. Verify suppression | Count suppressed or generalized; no PII exposed | | | |
| ANL-03 | SUB-1 (AAL2) | Fine payments in Library A | 1. Call `get_fine_payment_dashboard`<br>2. Inspect response | Detailed: visitor_id, amounts, dates, methods for Library A only | | | |
| ANL-04 | SUB-1 (AAL2) | Fine payments in Library B | 1. Call dashboard for Library B | 403 Forbidden | | | |
| ANL-05 | SUB-1 (AAL2) | Alert targets | 1. Call `get_fine_payment_alert_targets`<br>2. Verify branch-scoped | Only Library A visitors with due fines | | | |
| ANL-06 | SUP-1 (AAL2) | Attempt detailed dashboard | 1. Call `get_fine_payment_dashboard` | 403 Forbidden — Sub-admin only | | | |

---

## Section 12: OPAC Count & Pagination Comparison (Localhost vs Vercel)

| Test ID | Environment | Preconditions | Steps | Expected Result | Actual Result | Pass/Fail/Blocked | Evidence |
|---------|-------------|---------------|-------|-----------------|---------------|-------------------|----------|
| OPAC-01 | Localhost (dev Supabase) | Dev project seeded | 1. Load LandingPage<br>2. Note library book count<br>3. Load OPACCatalog<br>3. Note total count, filtered counts | Counts match RPC results; debug panel shows consistency | | | |
| OPAC-02 | Vercel (production Supabase) | Production project, migrations 202800+202900 applied | 1. Load LandingPage<br>2. Note library book count<br>3. Load OPACCatalog<br>4. Note total count, filtered counts | Counts match RPC results; no 1000-row truncation | | | |
| OPAC-03 | Both | Same Supabase project | 1. Compare localhost vs Vercel counts | Counts identical (same data source) | | | |
| OPAC-04 | Both | External catalog books >1000 | 1. Verify pagination loads all pages<br>2. Verify total count RPC matches | No truncation; 1000-row pages loaded sequentially | | | |
| OPAC-05 | Both | Search/filter active | 1. Apply filters<br>2. Compare RPC filtered count vs client count | RPC count = client count; debug panel consistent | | | |
| OPAC-06 | Both | Call number search | 1. Search by call number<br>2. Verify RPC includes call_number predicate | Results match; RPC predicate updated | | | |

---

## Section 13: Responsive UI Checks (Desktop ≥1024px, Tablet 768px, Mobile 390px)

| Test ID | Page/Component | Breakpoint | Checks | Expected Result | Actual Result | Pass/Fail/Blocked | Evidence |
|---------|----------------|------------|--------|-----------------|---------------|-------------------|----------|
| RSP-01 | LandingPage | All | No horizontal overflow; loader covers viewport; data loads | Pass at all breakpoints | | | |
| RSP-02 | Visitor Dashboard | All | Tabs responsive; catalog cards stack; QR pass fits | Pass | | | |
| RSP-03 | OPACCatalog | All | Grid→list transition; filters accessible; debug panel readable | Pass | | | |
| RSP-04 | Book Details Modal | All | Image fits (contain/cover); text readable; actions accessible | Pass | | | |
| RSP-05 | Sub-Admin Dashboard | All | Sidebar collapsible; tables scroll; widgets stack | Pass | | | |
| RSP-06 | Super Admin Dashboard | All | Sidebar collapsible; tables scroll; staff management forms work | Pass | | | |
| RSP-07 | Community Book List | All | Left-aligned at mobile/desktop; queue position visible | Pass | | | |
| RSP-08 | QR Pass Display | All | QR code scannable; refresh/save buttons work | Pass | | | |
| RSP-09 | Attendance Check-in | All | Camera access; scan overlay fits | Pass | | | |
| RSP-10 | Notifications Bell | All | Dropdown fits; read/unread states clear | Pass | | | |
| RSP-11 | Forms (Registration, Book Add/Edit) | All | Fields stack; validation messages visible; submit accessible | Pass | | | |
| RSP-12 | Modal Dialogs | All | Centered; scrollable if tall; backdrop click dismiss | Pass | | | |
| RSP-13 | Navigation/Header | All | ShelfHeader responsive; role menus accessible; dark mode toggle | Pass | | | |

---

## Section 14: Edge Cases & Error States

| Test ID | Scenario | Steps | Expected Result | Actual Result | Pass/Fail/Blocked | Evidence |
|---------|----------|-------|-----------------|---------------|-------------------|----------|
| EDGE-01 | Network offline | 1. Disconnect network<br>2. Attempt actions | Graceful degradation; offline indicator; retry when online | | | |
| EDGE-02 | Supabase timeout | 1. Simulate slow query<br>2. Verify timeout handling | Retry logic (3 retries, exponential backoff); user feedback | | | |
| EDGE-03 | Empty states | 1. No books, no requests, no notifications | Empty state illustrations/messages shown | | | |
| EDGE-04 | Malformed data | 1. Corrupted book cover URL<br>2. Missing required fields | Fallback image; validation errors; no crashes | | | |
| EDGE-05 | Concurrent modifications | 1. Two tabs same user<br>2. Modify same record | Optimistic locking or last-write-wins with notification | | | |
| EDGE-06 | Expired JWT | 1. Wait for token expiry<br>2. Attempt action | Silent refresh or re-auth prompt | | | |
| EDGE-07 | Rate limiting | 1. Rapid API calls | 429 response; retry-after header | | | |

---

## Section 15: Migration Postflight Assertion Inventory

**12 Assertion Files (verify each executes without error on clean replay):**

| # | Assertion File | Coverage | Status |
|---|----------------|----------|--------|
| 1 | `audit_trigger_assertions.sql` | Audit function, columns, constraints, trigger coverage | ❌ NOT RUN |
| 2 | `fine_runtime_fix_assertions.sql` | Category-rate helper, internal alert implementation | ❌ NOT RUN |
| 3 | `public_community_visitor_registration.sql` | Community registration/approval catalog contracts | ❌ NOT RUN |
| 4 | `subscription_authorization_assertions.sql` | Subscription function metadata, ACLs, branch-check source | ❌ NOT RUN |
| 5 | `security_hardening_assertions.sql` | Catalog checks + synthetic request claims (ROLLS BACK) | ❌ NOT RUN |
| 6 | `security_release_assertions.sql` | Final release catalog contracts, announcement policy | ❌ NOT RUN |
| 7 | `transaction_integrity_assertions.sql` | FOR UPDATE locks, state machine, atomic balance, duplicate prevention | ❌ NOT RUN |
| 8 | `fine_payment_privacy_assertions.sql` | Super Admin aggregate-only, Sub-Admin branch-scoped, internal no grants | ❌ NOT RUN |
| 9 | `opac_count_rpc_assertions.sql` | SECURITY INVOKER, authorization helper, grants, predicates | ❌ NOT RUN |
| 10 | `aal2_policy_assertions.sql` | Visitor AAL1, Staff AAL2, function metadata/ACLs | ❌ NOT RUN |
| 11 | `migration_integrity_verification.sql` | Function ownership, search_path, grants, postflight coverage | ❌ NOT RUN |
| 12 | `community_borrowing_workflow_assertions.sql` | Community approval safeguards, cancellation, queue promotion, inventory | ❌ NOT RUN |

**Exceptions/Notes:**
- `security_hardening_assertions.sql` uses synthetic `request.jwt.*` GUCs and fixture inserts in a transaction that **must ROLLBACK** — verify temporary fixtures are absent after execution.
- `migration_integrity_verification.sql` was previously named `migration_integrity_assertions.sql` — same file.
- Four migrations require `pg_cron`/`pg_net` extensions (unavailable on Windows PostgreSQL 18): `20270103000800`, `20270103000900`, `20270103001100` (cron), `20261122000000` (pg_net). Track A cannot complete these; Track B required.

---

## Section 16: BatStateU JPLPC Malvar Coordinates Verification

| Item | Status | Notes |
|------|--------|-------|
| Migration `20270103000500_library_coordinates_verification.sql` | Source complete | Adds `coordinates_verified` boolean flag to `libraries` table |
| BatStateU JPLPC Malvar coordinates | ✅ **VERIFIED & CORRECTED** | 14.04482, 121.15677 (source: Wikipedia, OpenStreetMap, PhilAtlas — corrected from Darasa, Tanauan error in seed data) |
| Leaflet map integration | Source complete | Search/filter functional; coordinate display implemented |
| Verification method | Completed | Authoritative sources confirmed; `supabase/schema.sql` seed updated |

---

## Section 17: Skipped Tests — Unverified (49 Tests)

**DO NOT REPORT AS PASSING.** These remain unverified and require Track B infrastructure:

| Test Suite | Skipped Count | Reason |
|------------|---------------|--------|
| `concurrencyBlocked.test.js` | 8 | Requires isolated PostgreSQL with real row locks |
| `fiveRoleRegressionBlocked.test.js` | 25+ | Requires isolated Supabase with real Auth/MFA |
| `migrationIntegrityBlocked.test.js` | 13 | Requires database for catalog verification |
| Other regression suites | Remainder | Various runtime dependencies |

**Total: 49 skipped tests — all BLOCKED pending Track B execution.**

---

## Section 18: External Staging Requirements Summary

### Track A (Local Structural Validation) — Requires:
- [ ] Isolated PostgreSQL 15+ instance (local install or dedicated Docker container)
- [ ] No shared Docker daemon
- [ ] Empty database to start
- [ ] psql client, Node.js for validation script
- [ ] **Known limitation:** 4 migrations fail at `CREATE EXTENSION` for `pg_cron`/`pg_net`

### Track B (Genuine Supabase Runtime) — Requires:
- [ ] Isolated Supabase project (local `supabase start` on Linux/macOS, OR dedicated staging project)
- [ ] Auth configured with MFA/TOTP
- [ ] PostgREST running with correct JWT secret
- [ ] Storage, Vault, Edge Functions, Realtime, pg_cron, pg_net available
- [ ] Test users provisioned per `AUTH_POSTGREST_TEST_PLAN.md` (6 accounts)
- [ ] Test data seeded: 2 libraries, staff assignments, books, borrow requests, fines, attendance, community requests
- [ ] Email catcher (e.g., Mailpit) for OTP/approval flows
- [ ] Secure secret management for test credentials (never `.env`)

### Owner Actions Required Before Staging:
1. **Rotate database password** (CRITICAL — exposed in commit 5231b33)
2. **Rotate service role key** if ever stored locally
3. **Provision isolated Supabase staging project** (Track B)
4. **Configure local `.env` with local Supabase project credentials** (not production)
5. **Apply all 167 migrations to staging**
6. **Create test users and assign roles**
7. **Execute Track A replay (where possible) and Track B matrix**

---

## Sign-Off

| Role | Name | Date | Signature |
|------|------|------|-----------|
| QA Lead | | | |
| Developer | | | |
| Product Owner | | | |

---

**End of Checklist**
*All tests must be executed in isolated staging environment. No test is passed until evidence is recorded.*