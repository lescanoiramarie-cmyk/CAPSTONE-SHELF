-- These are intentionally reported as skipped TAP cases until the isolated
-- multi-session fixture is provisioned. The Node concurrency harness contains
-- the eight executable scenarios and must be run against a disposable database.
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
BEGIN;
SELECT extensions.plan(8);
SELECT extensions.skip(1, 'Requires isolated multi-session fixture: two visitors borrow the final copy');
SELECT extensions.skip(1, 'Requires isolated multi-session fixture: simultaneous pickup confirmations');
SELECT extensions.skip(1, 'Requires isolated multi-session fixture: simultaneous return confirmations');
SELECT extensions.skip(1, 'Requires isolated multi-session fixture: concurrent partial fine payments');
SELECT extensions.skip(1, 'Requires isolated multi-session fixture: simultaneous attendance check-ins');
SELECT extensions.skip(1, 'Requires isolated multi-session fixture: duplicate notification retries');
SELECT extensions.skip(1, 'Requires isolated multi-session fixture: cross-visitor borrowing isolation');
SELECT extensions.skip(1, 'Requires isolated multi-session fixture: cross-library staff access isolation');
SELECT * FROM extensions.finish();
ROLLBACK;
