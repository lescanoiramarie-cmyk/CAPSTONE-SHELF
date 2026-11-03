# SHELF Module Functionality Checklist

**Review date:** 2026-11-03
**Scope:** Visitor, Sub-admin, Super-admin, and shared system flows

## How to use this checklist

- `[x]` means the UI or behavior was observed in a recorded check. It does not automatically mean every backend, permission, or mutation path passed.
- `[ ]` means the flow still needs end-to-end verification with authorized test accounts and data.
- Do not use real borrowing, attendance, inventory, or staff records as test fixtures. Prefer staging or explicitly designated disposable records.

## Coverage Summary

| Module | Read-only/UI coverage | Write and authorization coverage |
| --- | --- | --- |
| Visitor | Dashboard tabs, catalog/category filtering, book details, map, announcements, and feedback form rendered. One reading-list add/remove was verified and absent after reload. | Borrowing, personal/community book CRUD, QR attendance, feedback submission, account recovery, and privacy boundaries remain incomplete. |
| Sub-admin | Overview, transaction workspace, and analytics rendered; analytics correctly requires 14 days for forecasting. Other dashboard views were included in prior read-only smoke checks. | Pickup/return, attendance mutations, inventory/queue changes, and branch-denial tests remain incomplete. |
| Super-admin | Local dashboard bootstrap rendered after the visitor-resolution guard. Prior production smoke checks covered the main section views. | Library/staff CRUD, account status changes, exports, and admin permission boundaries remain incomplete. |

## Public and Visitor Module

### Landing and account access

- [x] Landing page loads participating-library and book data.
- [x] Public announcements render.
- [x] Feedback form renders; no inquiry was submitted during the recorded check.
- [x] Unauthenticated protected-catalog navigation redirects to visitor sign-in.
- [ ] Register with a valid participating-school/library email domain.
- [ ] Reject an unsupported email domain, missing branch, and branch/domain mismatch at both UI and database boundaries.
- [ ] Complete OTP verification and confirm account-to-branch assignment.
- [ ] Sign in, sign out, session restoration, and role-based redirects.
- [ ] Password reset and login-attempt lockout.
- [ ] Accept visitor terms and confirm persistence.
- [ ] Confirm one visitor cannot read or modify another visitor's private data.

### Catalog and discovery

- [x] Catalog cards and book details render.
- [x] Category filtering was exercised; catalog returned category-matched results.
- [ ] Verify title, author, ISBN, and category search; library, availability, and sort filters.
- [ ] Verify external catalog entries are clearly non-borrowable.
- [ ] Verify book availability and copy counts against the selected branch.
- [ ] Verify book reviews: rating, submission, display, and ownership/privacy rules.

### Reading list and personal books

- [x] A temporary reading-list item was added, removed, and confirmed absent after reload.
- [ ] Add/remove multiple items and verify list state across sign-out/sign-in.
- [ ] Add a personal book with and without a cover; verify storage and display.
- [ ] Edit personal-book details, visibility, lending settings, and fine rate.
- [ ] Remove a designated test personal book and verify dependent data handling.
- [ ] Reject invalid categories, fine rates, and malformed cover URLs.
- [ ] Confirm only eligible public/lending-enabled personal books can be requested.

### Requests, borrowing, and community books

- [x] Community book list and detail view render, including availability and owner-approval information.
- [ ] Request an available community copy; verify queue position and owner notification.
- [ ] Reject unavailable, duplicate-active, self-owned, or otherwise ineligible requests.
- [ ] Owner approves, declines, or cancels a request; verify requester status and copy counts.
- [ ] Verify community pickup, return, queue promotion, fine snapshot, and history.
- [ ] Submit a library-book request; verify branch and inventory eligibility.
- [ ] Staff confirms pickup and return; verify status, due date, fine, and availability.
- [ ] Verify expired holds and requests not ready for pickup are rejected.
- [ ] Verify queue promotion and fine calculations, including legacy manual-review cases.
- [ ] Verify request history, due-date reminders, and notification content.

### Visitor services

- [x] Library map rendered; map tiles loaded in the recorded browser check.
- [x] Announcements and feedback form rendered; replies section was available.
- [ ] Generate, display, refresh, save, and scan the visitor QR pass.
- [ ] Check in/out for attendance and verify branch scoping and history.
- [ ] Submit feedback and verify it appears to the visitor and intended staff branch.
- [ ] Verify FAQ responses, announcement audience filtering, and visitor notifications.
- [ ] Verify profile and request-history data remain scoped to the signed-in visitor.

## Sub-admin Module

### Dashboard and branch operations

- [x] Overview loads with branch context and summary widgets in the local fixed build.
- [x] Book Transactions workspace renders in the local fixed build; no QR or loan mutation was performed.
- [x] Analytics view renders and explains the 14-day minimum for forecasting; the current branch history was below that threshold.
- [x] Visitor Accounts, Attendance, Inventory, Reservation Queue, Branch Map, Reports, Feedback, and Announcements were included in prior read-only dashboard smoke checks.
- [ ] Verify all dashboard metrics match branch-scoped source data and handle empty/error/loading states.
- [ ] Search/filter visitor accounts and verify only permitted branch data is visible.
- [ ] Scan a visitor QR and verify identity, branch, and attendance eligibility.
- [ ] Check in/out attendance and verify duplicate and cross-branch cases are rejected.
- [ ] Add/edit/import/export branch inventory; verify total, available, reserved, and borrowed copies.
- [ ] Approve/cancel/promote reservation-queue entries and verify ordering and availability.
- [ ] Process an eligible pickup and return; verify fines, overdue state, and audit history.
- [ ] Verify another branch's sub-admin cannot read or mutate this branch's protected data.
- [ ] Generate branch reports, apply date filters, and validate CSV/Excel/PDF exports.
- [ ] Verify feedback replies and branch-targeted announcements, including expiry and audience.

## Super-admin Module

### System administration

- [x] Local dashboard bootstrap completed after staff sessions were excluded from visitor-profile lookup.
- [x] Overview, Inventory, Libraries & Map, Staff Accounts, Visitor Accounts, Reports, Analytics, Feedback, and Announcements were included in prior read-only dashboard smoke checks.
- [ ] Verify system-wide metrics aggregate branches correctly and report loading/error states.
- [ ] Add/edit/disable a designated test library; validate email-domain configuration and map details.
- [ ] Create a designated test sub-admin with a temporary password and assigned branch.
- [ ] Search/filter staff by name, email, branch, role, and active status.
- [ ] Edit branch assignment; disable/re-enable a test sub-admin and verify access changes.
- [ ] Delete only a disposable test sub-admin and verify safe account cleanup.
- [ ] Confirm super-admin accounts cannot be disabled or deleted through UI or endpoint.
- [ ] Verify visitor-account search and management is system-scoped and permission-controlled.
- [ ] Generate system-wide reports/exports and validate totals, filters, and output contents.
- [ ] Verify feedback management and announcement create/edit/audience/expiry flows.
- [ ] Verify audit history for administrative changes without exposing unnecessary visitor data.

## Shared Security and Operations

- [x] Unauthenticated protected routes redirect; a visitor session was redirected away from staff routes.
- [x] Local lint, production build, and 51 Node regression tests passed after the staff-resolution fix.
- [ ] Verify production RLS policies and RPC grants for visitor, sub-admin, and super-admin roles.
- [ ] Verify cross-branch and cross-visitor denials at the database/API boundary, not only in the UI.
- [ ] Verify Edge Function authorization, deployed versions, secrets, and notification delivery.
- [ ] Verify storage bucket policies and ensure private files cannot be accessed by another account.
- [ ] Check production browser console/network for failed RPCs, CORS errors, and sensitive responses.
- [ ] Run responsive and keyboard/accessibility checks for every role dashboard and modal.

## Known Testing Blockers

- Production borrowing-history and library-data loads have returned statement-timeout/HTTP 500 errors. Avoid repeated production retries until the scoped query path is deployed and benchmarked.
- Commit `1fd6160` containing the staff visitor-resolution guard and scoped staff borrowing query is pushed, and the live Vercel frontend serves a new bundle. A live sub-admin dashboard load cleared without a timeout, but no `borrow_requests` request was observed in the browser/log capture; keep query-level verification pending.
- The local `.env` points to the current Supabase project. Local UI testing can therefore mutate live data; do not use it for additional write tests without designated disposable records.
- The linked Supabase migration ledger was rechecked on 2026-11-03 and matches through `20261210000000`; no migration is pending. Keep the untracked migration source in Git history, but do not apply it again.
- A local visitor reading-list add/remove was exercised and the temporary item was absent after reload. No borrowing, attendance, inventory, or staff records were changed in that check.
- The latest local check again passed lint, production build, and all 51 Node tests. A signed-in visitor was redirected from both `/subadmin` and `/superadmin` to `/visitor`.
- The local registration form rendered, but the `Loading SHELF` overlay left `Send verification code` non-interactable. No OTP request was sent; blank-form validation remains unverified.
- Full visitor-to-staff borrowing, staff CRUD, account recovery, direct RLS denials, and real notification delivery still require a safe test environment and role-matched test accounts.