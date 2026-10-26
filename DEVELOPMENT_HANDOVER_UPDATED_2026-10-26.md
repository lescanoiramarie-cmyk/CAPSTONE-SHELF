# SHELF ILMS — Updated Development Handover

**Updated:** October 27, 2026
**Repository:** https://github.com/lescanoiramarie-cmyk/CAPSTONE-SHELF
**Branch:** `main`
**HEAD:** `11b2280d2db2867350aeaca38a34c4c8f1d9109e` — `Fix book inventory validation and harden borrowing RPCs`
**Upstream status:** Local `main` and `origin/main` point to the same commit.
**Git status:** Commit `93e3b7e` was created after reviewing the staged diff; not pushed.
**Remote Supabase:** Five reviewed migrations were applied on October 27, 2026. No seed scripts or synthetic records were run. A schema-only backup was saved outside the repository before migration.

> This handover describes the current working tree as of the date above. Recheck `git status` before staging because files may have changed after this handover was written.

## 1. Current changes

### Admin dashboards and analytics

- Updated the Super Admin and Sub Admin overview layouts, chart sizing, spacing, labels, and date periods.
- The Super Admin overview includes the branch comparison chart for visitor check-ins and book transactions, visitor ratings, and updated analytics/report sections.
- The Sub Admin overview includes monthly visitor attendance, borrowing activity trend, book-rating rankings, and a branch-scoped feedback highlight. The previous recent-activity block was removed.
- Book ratings are displayed as whole-number averages and rankings, with book/branch scoping intended to keep Sub Admin data limited to its assigned library.
- Updated analytics forecast/category chart presentation and report/activity-history pagination and labels in the related work.
- `analytics/main.py` contains supporting analytics changes; review it alongside the dashboard changes.

### Staff, visitor accounts, feedback, and announcements

- Updated the Admin Workspace, including feedback and announcement management, staff-account presentation, and related filters/forms.
- Updated visitor account presentation to show visitor identity, email, library, registration date, and active status.
- Landing-page feedback now submits as general, unassigned feedback for Super Admin review.
- Landing-page announcement cards now load published, global announcements from the database rather than hardcoded announcement text. The card design and icon remain part of the frontend.
- Announcement forms support permanent or temporary duration/expiration and editing through the admin workspace.
- These announcement and feedback flows depend on the database schema and policies described below.

### Visitor-facing changes

- Updated landing-page feedback and announcements.
- Updated visitor dashboard/services presentation in `VisitorDashboard.jsx` and `VisitorServices.jsx`.
- `DashboardWelcome.jsx` and visitor-account data were also adjusted.

### Ratings, feedback, schema, and test data

- Added `BookRatingsChart.jsx` as a reusable ratings display.
- Added database support for book-rating summaries/aggregates and an index on `book_reviews.book_id`.
- Added the aggregate table and trigger/function to the per-object schema snapshots so they reflect the rating migrations.
- Added a constrained anonymous insert policy for landing-page general feedback; anonymous submission should not grant anonymous read or update access.
- Added synthetic book-review and visitor-feedback seed scripts. These are test data and should only be used in disposable/local data after reviewing their effects.
- The book-review seed can assign a library to visitors whose library is currently unassigned, in addition to creating missing ratings. Review its SQL before running it.
- Reconciled the inventory RPC migration against current live definitions, retaining deterministic queue ordering, missing-book failure behavior, and the post-promotion capacity check while adding cross-table allocation guards.
- Added an idempotent migration to enable RLS on `community_book_requests`, aligning the clean local migration chain with live and the table snapshot.

## 2. Changed and new files

### Modified tracked files

- `analytics/main.py`
- `src/component/AdminWorkspace.jsx`
- `src/component/DashboardWelcome.jsx`
- `src/component/VisitorAccountManagement.jsx`
- `src/component/VisitorServices.jsx`
- `src/data/visitorAccounts.js`
- `src/pages/subadmin/SubAdminDashboard.jsx`
- `src/pages/superadmin/SuperAdminDashboard.jsx`
- `src/pages/visitor/LandingPage.jsx`
- `src/pages/visitor/VisitorDashboard.jsx`
- `supabase/schema.sql`
- `supabase/migrations/20261121000000_include_reserved_copies_in_inventory_validation.sql`
- `supabase/schemas/public/functions/release_copy_and_promote.sql`
- `supabase/schemas/public/tables/announcements.sql`
- `supabase/schemas/public/tables/book_reviews.sql`
- `supabase/schemas/public/tables/visitor_feedback.sql`

### New untracked files

- `DEVELOPMENT_HANDOVER_CURRENT_CHANGES.md` — previous handover; retained.
- `DEVELOPMENT_HANDOVER_UPDATED_2026-10-26.md` — this updated handover.
- `src/component/BookRatingsChart.jsx`
- `supabase/schemas/public/functions/get_book_rating_summaries.sql`
- `supabase/schemas/public/functions/maintain_book_rating_aggregates.sql`
- `supabase/schemas/public/tables/book_rating_aggregates.sql`
- `supabase/migrations/20261027000000_announcement_expiration.sql`
- `supabase/migrations/20261120100000_book_rating_summaries.sql`
- `supabase/migrations/20261121100000_book_reviews_book_id_index.sql`
- `supabase/migrations/20261122000000_book_rating_aggregates.sql`
- `supabase/migrations/20261123000000_allow_landing_general_feedback.sql`
- `supabase/migrations/20261124000000_enable_community_request_rls.sql`
- `supabase/seeds/seed_synthetic_book_reviews.sql`
- `supabase/seeds/seed_synthetic_visitor_feedback.sql`

The current `git diff --stat` for tracked modifications reports **16 files changed, 1,695 insertions, and 440 deletions**. That stat excludes untracked files and may change as this handover is updated.

## 3. Database and migration status

- The complete chain was applied in a disposable local Supabase project through `20261124000000`.
- The five previously pending migrations (announcement expiration, inventory validation on insert, inventory allocation reconciliation, anonymous general feedback, and community-request RLS alignment) were applied to live Supabase after reviewing the `--include-all` dry run and taking a schema-only backup.
- The inventory migrations had timestamps older than the latest remote migration, so the CLI required `--include-all`. The dry run listed exactly those five migrations; the post-apply migration ledger now matches local files.
- Live `community_book_requests` already has RLS enabled and the authenticated participant-read policy. The new migration is idempotent and aligns the clean local migration chain with that state.
- Landing announcements select `expires_at`; the expiration column and public policy are now present in live Supabase.
- Anonymous landing feedback now uses the constrained insert policy in live Supabase.
- Rating summaries now use the deployed RPC and aggregate trigger in live Supabase.
- Five reviewed migrations have been applied to live; check the migration ledger before any future push. No seed scripts were applied.
- A read-only post-migration query confirmed `announcements.expires_at`, the constrained anonymous feedback policy, community-request RLS, the rating summary RPC, and the rating aggregate trigger.
- The book-review and feedback seed scripts remain test-only and have not been run against live data.

## 4. Verification status

- [x] Checked branch and working-tree status.
- [x] Confirmed `HEAD` and `origin/main` are both `11b2280d2db2867350aeaca38a34c4c8f1d9109e`.
- [x] `git diff --check` passed for the staged changes after cleaning Markdown hard-break trailing spaces.
- [x] `npm run lint` passed after fixing React hook and purity lint errors.
- [x] `npm run build` passed; Vite reports existing large-chunk size warnings.
- [x] Clean local migration chain applied through `20261124000000`; community-request RLS is enabled.
- [x] Disposable transaction checks passed for rating aggregate insert/update/delete, anonymous general-feedback insert, inventory allocation rejection, and deterministic queue promotion; all test records were rolled back.
- [x] Compared all eight function definitions targeted by the inventory migration against live. Reconciled the live queue ordering, missing-book error, and post-promotion capacity check in the migration and function snapshot.
- [x] Live migration dry run completed with `--include-all`, followed by application of exactly five migrations.
- [x] Post-migration ledger and catalog checks confirmed the migrations were recorded and required objects exist.
- [ ] Browser/manual checks of landing feedback, announcement editing/expiry, dashboards, and responsive layouts — not recorded as completed.
- [ ] Full authenticated community-book lifecycle, authorization, and concurrent-request checks — not run.
- [x] Live migrations — applied as listed above; seed scripts were not run.
- [x] Commit `93e3b7e` — created after final staged diff review.
- [ ] Push — not requested and not done.

## 5. Before committing or pushing

1. Recheck `git status --short`, branch, `HEAD`, and upstream status.
2. Review tracked and untracked diffs, especially all SQL migrations and seed scripts.
3. Run appropriate build/lint checks and test the affected UI and local database workflows; record results and known failures.
4. Verify `.env`, `.env.local`, keys, tokens, local Supabase metadata, and production data are not staged. The repository contains environment files; never include them.
5. Stage only reviewed files. Inspect `git diff --cached --check`, `git diff --cached --stat`, and `git diff --cached --name-only` before committing.
6. Obtain team review before pushing. Do not force-push or alter the live Supabase project as part of this handover.

## 6. Suggested review order

1. Inspect migrations and schema snapshots for ordering, permissions, RLS, compatibility, and non-destructive behavior.
2. Inspect the ratings RPC/trigger and branch-scoping queries for correctness and data visibility.
3. Review synthetic seeds and run them only against disposable local/test data.
4. Verify announcement publishing, editing, expiration, and public landing-page loading against a local schema with the required column.
5. Verify anonymous landing feedback reaches the Super Admin general-feedback queue under the intended policy.
6. Verify Super Admin and Sub Admin dashboards, branch boundaries, dates, chart totals, and responsive layouts.
7. Run the project checks, record outcomes, then prepare a reviewed staged diff.
