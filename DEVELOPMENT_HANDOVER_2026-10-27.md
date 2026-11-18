# SHELF ILMS — Development Handover

**Updated:** October 27, 2026
**Repository:** https://github.com/lescanoiramarie-cmyk/CAPSTONE-SHELF
**Branch:** `main`
**HEAD:** `ff2de6d` — `Cache popular book transaction counts`
**Upstream:** Local `main` matches `origin/main` (`0` ahead, `0` behind).
**Working tree:** Only untracked local Supabase metadata, `supabase/.branches/`; do not stage it.
**Live Supabase:** Migration `20261129000000` is applied. The local and remote migration ledgers match.

> Recheck `git status` before starting new work; local Supabase metadata may change independently.

## 1. Changes included in the latest pushed work

### Landing page and popular borrowed books

- Replaced the popular-book count RPC’s repeated scan over borrowing history with a maintained `borrowed_book_counts` aggregate table.
- Added a trigger to keep per-book counts synchronized when eligible borrow records are inserted, deleted, or have their book/status/borrow date changed.
- Backfilled the aggregate table from qualifying historical transactions during migration.
- Kept the aggregate table inaccessible to `anon` and `authenticated`; the `SECURITY DEFINER` RPC remains executable by those roles and returns only ranked book IDs and counts.
- Added shared 60-second caching and request deduplication for popular counts in the client store.
- Removed a landing-page wheel handler that attempted `preventDefault()` in a passive listener.
- Removed expected signed-out request logging that was cluttering the browser console.

### Large borrowing-data refresh and indexes

- Updated data refresh logic so large borrowing-request datasets can be retrieved in pages without the earlier unstable/expensive request pattern.
- Added an index supporting deterministic borrowing-request ordering by `request_date` and `id`.
- Added an index supporting top borrowed-book ranking.
- Updated the popular-count RPC path to avoid fetching the full borrow history just to display popular books.

### Transaction test data and visitor display

- Added/expanded `supabase/seeds/seed_synthetic_book_transactions.sql` to create 1,000–1,500 generated transactions per library per month across the most recent 12 calendar months.
- The seed rotates existing visitors and assigns each transaction to a library-owned book; deterministic IDs and conflict handling make reruns idempotent.
- The seed refuses to run if there are no visitors, no libraries, or a library has no eligible library book.
- Updated the staff workspace/data handling to keep `[TEST]` markers out of visitor names shown in reports.
- **Seed execution status must be checked before rerunning.** Running it changes dashboard/report totals substantially; use local/disposable data unless live test-data insertion is explicitly intended.

### Announcement audience and visitor feedback flows

- Added announcement audience options for `General`, `Visitor`, and `Both`.
- General announcements are surfaced on the landing page; Visitor announcements are visitor-facing; Both are intended for both contexts.
- Earlier changes in the pushed history also included landing-page general feedback handling, editable database-backed landing announcements, expiration support, admin feedback/announcement UI, and visitor dashboard styling.

### Earlier admin dashboard and reporting changes in the pushed history

- Updated Super Admin and Sub Admin overview dashboards, attendance/borrowing charts, ratings, branch comparisons, feedback highlights, layouts, and chart labels.
- Added pagination/limits for activity history and adjusted visitor accounts to show identity, email, library, registration date, and active state.
- Updated analytics/report presentation, forecast/category chart layout, and staff-account management UI.
- Added rating summary/aggregate database support and associated schema snapshots.

## 2. Key commits already pushed

- `ff2de6d` — Cache popular book transaction counts
- `87d7c50` — Index popular borrowed book counts
- `a165012` — Improve large borrowing data refresh
- `d66463d` — Load all borrow requests and expand transaction seed
- `8cdafa6` — Hide test markers from visitor names
- `08f3cbf` — Add announcement audience targeting
- `93e3b7e` — Complete admin dashboards and landing feedback flows

These commits are on `main` and `origin/main`; this handover itself is a new untracked file until staged and committed separately.

## 3. Database changes and safety

- Migration `supabase/migrations/20261129000000_cache_popular_borrowed_book_counts.sql` is applied to live Supabase.
- `supabase migration list --linked` confirmed all listed local and remote migrations match through `20261129000000`.
- Live verification after applying the migration confirmed the RPC returned counts, the aggregate table was not directly readable by `anon` or `authenticated`, RPC execution remained granted, and the maintenance trigger existed.
- The migration backfills counts and installs the trigger under a table lock in the same transaction to prevent count drift during setup.
- Do not rerun remote SQL or migrations unless a new migration is reviewed and explicitly intended.
- Do not run the transaction seed against live data without confirming the intended test-data policy and current seeded-row counts.
- `supabase/.branches/` is local metadata, not a deliverable; keep it out of Git.

## 4. Verification recorded

- [x] `npm run lint` passed.
- [x] `npm run build` passed; Vite reported existing large-chunk warnings.
- [x] `git diff --check` passed before the latest commit.
- [x] Browser reload on localhost showed no browser errors or warnings; popular-count RPC completed successfully and the page loaded its catalog.
- [x] Signed-out landing page did not issue `borrow_requests` REST requests during the browser check.
- [x] Live RPC and aggregate table permissions/trigger were checked after migration.
- [x] Live migration ledger matches local through `20261129000000`.
- [x] Latest changes were committed and pushed; `main` is synchronized with `origin/main`.
- [ ] Local Supabase migration/workflow verification was not completed because the local Docker Supabase container was unavailable.
- [ ] Full authenticated borrowing lifecycle, authorization, queue, expiration, and concurrency checks remain outstanding.
- [ ] Manual visual/responsive checks for all dashboard and landing-page variants are not fully recorded.
- [ ] Verify whether the generated transaction seed has been run and whether it reached the requested per-library/per-month distribution before running it again.

## 5. Remaining considerations and recommended next checks

1. Check the transaction seed status read-only: count rows marked by the seed per library/month and verify every branch/month is between 1,000 and 1,500 before deciding whether any seed run is needed.
2. Review the aggregate-count trigger against all write paths for `borrow_requests`, including RPCs and administrative edits, and periodically compare cached counts with a source-table recomputation.
3. Test cache freshness after a new borrow/return and after the 60-second cache expires; confirm request deduplication behaves correctly during concurrent page loads.
4. Complete authenticated tests for borrowing, approval, pickup, return, cancellation, queue promotion, pickup expiration, permission boundaries, and concurrent requests using disposable accounts.
5. Start a disposable local Supabase instance and verify a fresh migration chain through `20261129000000`; do not reset any database containing important data.
6. Verify announcement audience filtering (`General`, `Visitor`, `Both`), edit/expiry behavior, and anonymous general-feedback submission in both landing and admin experiences.
7. Check visitor-facing dashboards and admin analytics at mobile/tablet/desktop widths, especially large result sets and empty/error states.
8. Re-run lint/build and inspect console/network errors after any subsequent changes.

## 6. Git and Supabase status at handover

- Latest pushed commit: `ff2de6d`.
- Branch: `main`; local and upstream are aligned.
- No product changes are currently uncommitted. `supabase/.branches/` remains untracked local metadata.
- The latest migration is already applied to live Supabase. No additional migration is pending according to the linked ledger check.
- No force-push, reset, or cleanup was performed.
