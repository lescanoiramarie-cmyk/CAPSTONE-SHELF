# SHELF ILMS — Current Changes Handover & Commit Checklist

## 1. Current Project Status

**Repository:** https://github.com/lescanoiramarie-cmyk/CAPSTONE-SHELF
**Branch:** `main`
**Base commit:** `11b2280` — `Fix book inventory validation and harden borrowing RPCs`
**Remote alignment:** Local `main` is aligned with `origin/main`.
**Current changes:** Committed as `93e3b7e`. Not pushed.

### Current changes in the working tree

- Updated Super Admin and Sub Admin dashboards, including visitor attendance, borrowing activity, book ratings, feedback highlights, branch comparisons, and related overview/report layouts.
- Updated visitor account, announcement, feedback, and visitor-service interfaces/data handling.
- Connected landing-page feedback to the general feedback queue for Super Admin and replaced hardcoded landing announcements with published, non-expired global announcements managed through the Super Admin workspace.
- Added a reusable book ratings chart and database-backed rating summary support.
- Added announcement expiration support, a constrained anonymous insert policy for general landing feedback, and synthetic seed scripts for book ratings and visitor feedback.
- Renamed two local rating migration files so their version prefixes do not collide with the incoming inventory migrations.

### Changed and new files

**Application and analytics files**

- `analytics/main.py`
- `src/component/AdminWorkspace.jsx`
- `src/component/BookRatingsChart.jsx` (new)
- `src/component/DashboardWelcome.jsx`
- `src/component/VisitorAccountManagement.jsx`
- `src/component/VisitorServices.jsx`
- `src/data/visitorAccounts.js`
- `src/pages/subadmin/SubAdminDashboard.jsx`
- `src/pages/superadmin/SuperAdminDashboard.jsx`
- `src/pages/visitor/LandingPage.jsx`
- `src/pages/visitor/VisitorDashboard.jsx`

**Database schema, migrations, and seeds**

- `supabase/schema.sql`
- `supabase/schemas/public/tables/announcements.sql`
- `supabase/schemas/public/tables/book_reviews.sql`
- `supabase/schemas/public/tables/visitor_feedback.sql`
- `supabase/schemas/public/functions/get_book_rating_summaries.sql` (new)
- `supabase/migrations/20261027000000_announcement_expiration.sql` (new)
- `supabase/migrations/20261120100000_book_rating_summaries.sql` (new; unique version prefix)
- `supabase/migrations/20261121100000_book_reviews_book_id_index.sql` (new; unique version prefix)
- `supabase/migrations/20261122000000_book_rating_aggregates.sql` (new)
- `supabase/migrations/20261123000000_allow_landing_general_feedback.sql` (new)
- `supabase/seeds/seed_synthetic_book_reviews.sql` (new)
- `supabase/seeds/seed_synthetic_visitor_feedback.sql` (new)

---

## 2. Remaining Development Tasks

### Priority 1 — Review and verify database changes

- [x] Reviewed every pending migration in timestamp order, including dependencies on the inventory migrations from `11b2280`.
- [x] Reviewed rating-summary RPC grants, `SECURITY DEFINER` behavior, trigger behavior, and row-level security.
- [x] Compared `schema.sql`, per-object schema files, migrations, and the live objects touched by this update.
- [x] Applied the reviewed pending migrations to live Supabase after a schema-only backup and dry-run review; see the verification section below.
- [ ] Verify announcement create, edit, expiry, and public-read behavior against the local schema.
- [ ] Verify unauthenticated landing feedback submissions appear in Super Admin as `General` / `All libraries`, while anonymous users cannot read or modify feedback.
- [ ] Verify landing page shows only global (`library_id IS NULL`), published announcements before their expiration date.
- [ ] Verify rating summaries and aggregate updates on insert, update, and delete.
- [ ] Check synthetic seed counts and rerun behavior using disposable local data.

**Seed data warning:** `seed_synthetic_book_reviews.sql` assigns a random library to existing visitors whose `library_id` is null, then creates missing visitor/book reviews. This changes visitor records as well as adding test ratings. Run it only against disposable local/test data after review. The feedback seed is also intended for local/test use.

**Anonymous feedback policy:** `20261123000000_allow_landing_general_feedback.sql` grants anon only constrained inserts for general, unassigned feedback. It is now live; monitor abuse and add rate limiting if the public form attracts spam.

**Supabase safety:** Five reviewed migrations were applied to the authorized live Supabase project. No seed scripts or synthetic records were run there. Do not run migration repair or additional remote SQL without a separate review and explicit authorization.

**Schema prerequisite:** The live project now has announcement expiration, the constrained anonymous general-feedback insert policy, the rating-summary function and aggregate trigger, and RLS enabled for community-book requests. Confirmed through a read-only live catalog query after applying migrations.

### Priority 2 — Verify application and borrowing workflows

- [x] `npm run lint` passed.
- [x] `npm run build` passed with existing Vite large-chunk warnings.
- [ ] Check browser console and server logs for runtime errors.
- [ ] Verify visitor login, QR login, OTP, and session handling.
- [ ] Test library and community-book request, approval, pickup, borrow, return, cancellation, and queue flows with authorized test accounts.
- [ ] Verify role and branch access for Sub Admin and Super Admin.
- [ ] Confirm ratings and feedback shown on each dashboard are scoped to the correct books/branch.
- [ ] Check invalid inputs, duplicate submissions, expiry behavior, and relevant error states.

### Priority 3 — Review UI and responsive behavior

- [ ] Check dashboard charts and cards at mobile, tablet, and desktop sizes.
- [ ] Verify the monthly date ranges and chart totals against source records.
- [ ] Verify announcement and feedback forms, filters, pagination, and staff-account lists with larger datasets.
- [ ] Recheck visitor account columns/status and analytics labels/legends.
- [ ] Check OPAC catalog layout, pagination, covers, participating libraries, community-book details, and chatbot responsiveness.
- [ ] Confirm the existing sidebar, routes, database contracts, and authentication behavior remain intact.

### Priority 4 — Final handover and release review

- [ ] Review the complete diff, including all untracked files and migration content.
- [ ] Stage only reviewed files; do not use `git add .` blindly.
- [ ] Confirm no `.env`, secrets, tokens, local Supabase metadata, or production data are included.
- [ ] Run relevant checks after the final edits and record failures or limitations.
- [ ] Obtain team review before merging or pushing.

---

## 3. Verification Performed So Far

- [x] Confirmed local `main` is aligned with `origin/main` at `11b2280`.
- [x] Confirmed the migration dry run listed five pending migrations; applied them with `--include-all` because three versions precede the latest remote ledger version.
- [x] Rechecked the remote migration ledger after application; all local versions now match the remote ledger.
- [x] Took a schema-only backup before migration in the system Temp directory; it is not part of the repository.
- [x] Read-only live catalog checks confirmed `announcements.expires_at`, the anonymous feedback policy, community-request RLS, the rating summary RPC, and aggregate trigger.
- [x] `git diff --cached --check`, staged file list, and staged stat were reviewed after cleaning Markdown trailing whitespace.
- [x] `npm run lint` passed; `npm run build` passed with existing large-chunk warnings.
- [x] Disposable local migration/workflow checks passed as documented in the updated handover.
- [ ] Browser/manual UI checks and full authenticated lifecycle/concurrency tests remain unverified.
- [x] Commit `93e3b7e` created after staged-diff review. Push not requested and not done.

---

## 4. Git Safety Before Commit and Push

- Check `git status --short`, branch, and `git diff` immediately before staging.
- Keep the current changes backed up and avoid switching branches in a way that could overwrite them.
- Stage only reviewed files; include the new component, migration, schema, and seed files only after review.
- Review the staged diff with `git diff --cached --check`, `git diff --cached --stat`, and `git diff --cached --name-only`.
- Commit only after the final staged diff check. Push remains a separate action requiring explicit authorization.
- Never force-push to `main` or use destructive reset/clean commands to resolve conflicts.

---

## 5. Handover Notes for the Next Reviewer

1. **Task:** Review dashboard, account/announcement/feedback UI, rating summaries, announcement expiry, and synthetic test-data changes.
2. **Files changed:** See the changed-file inventory above; verify the current `git status` before committing.
3. **Tests performed:** Lint, build, clean local migration/workflow checks, live migration dry run/application, post-apply ledger/catalog checks, and staged diff review.
4. **Results:** Recorded checks passed. Browser/manual UI checks and full authenticated lifecycle/concurrency checks remain unverified.
5. **Risks:** Rating seed assigns libraries to currently unassigned visitors. Do not execute either seed script against live data.
6. **Git status:** Local `main` contains commit `93e3b7e` based on `11b2280`; it is not pushed.
7. **Review request:** Inspect migration ordering, schema consistency, rating aggregate permissions/triggers, seed effects, and dashboard branch scoping before approving commit/push.
