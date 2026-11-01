# SHELF ILMS System Flow Checklist

Use this checklist for release and end-to-end verification. Automated checks
confirm code and migration contracts; items marked for manual QA still need to
be exercised in the deployed application with test accounts.

## Release preflight

- [x] Production build completes.
- [x] Repository ESLint check passes.
- [x] Focused lending and registration regression tests pass.
- [x] Database migration dry-run targets only the three SHELF changes.
- [ ] Confirm the deployed frontend is serving the pushed release; only the
  local development preview was tested.
- [x] Confirm the linked database has all migrations through
  `20261206000000`.

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
