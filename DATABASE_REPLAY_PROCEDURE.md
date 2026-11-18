# Independent Database Replay Procedure

## Purpose
Verify all **167** migrations apply cleanly from an empty database, and all **12** SQL assertion files pass.

**Two-Track Validation Design:**

| Track | Name | Scope | Infrastructure Required | Status |
|-------|------|-------|------------------------|--------|
| **Track A** | Local Structural Validation | Migration ordering, manifest integrity, catalog assertions (SECURITY DEFINER, search_path, grants, RLS policies, function metadata) | Isolated PostgreSQL 15+ (no Supabase extensions) | ✅ Structurally complete; execution BLOCKED |
| **Track B** | Genuine Supabase Runtime | Real Auth-issued tokens, PostgREST authorization matrix, AAL2/TOTP, Edge Functions, Storage, Vault, Realtime, pg_cron, pg_net | Isolated Supabase project (local `supabase start` or dedicated staging) | ❌ NOT RUN — requires Supabase stack |

> **CRITICAL:** Track A cannot verify `pg_cron`/`pg_net` extensions (unavailable on Windows PostgreSQL 18). Four migrations (`20270103000800`, `20270103000900`, `20270103001100` cron functions, `20261122000000` cache trigger) fail at `CREATE EXTENSION`. Track B is the ONLY path for full Supabase feature verification.

## Prerequisites

### Required Infrastructure (Track A — Local PostgreSQL)
- **Isolated PostgreSQL 15+ instance** (not shared Supabase Docker, not production)
- **No existing schema/data** — must start from empty `public` schema
- **psql** client available
- **Node.js** for validation script

### Required Infrastructure (Track B — Supabase Stack)
- **Isolated Supabase project** (local `supabase start` or dedicated staging)
- **Auth** configured with MFA/TOTP
- **PostgREST** running with correct JWT secret
- **Storage**, **Vault**, **Edge Functions**, **Realtime**, **pg_cron**, **pg_net**
- **Test users** created for each role (see AUTH_POSTGREST_TEST_PLAN.md)

### Files Required
- `supabase/migrations/` — all **167** `.sql` files
- `scripts/validate-migrations.mjs` — migration manifest validator
- **12 SQL assertion files** in `supabase/tests/`:
  1. `audit_trigger_assertions.sql`
  2. `fine_runtime_fix_assertions.sql`
  3. `public_community_visitor_registration.sql`
  4. `subscription_authorization_assertions.sql`
  5. `security_hardening_assertions.sql` (synthetic claims, rolls back)
  6. `security_release_assertions.sql`
  7. `transaction_integrity_assertions.sql`
  8. `fine_payment_privacy_assertions.sql`
  9. `opac_count_rpc_assertions.sql`
  10. `aal2_policy_assertions.sql`
  11. `migration_integrity_verification.sql` (previously `migration_integrity_assertions.sql`)
  12. `community_borrowing_workflow_assertions.sql`

> **Note:** The runbook references `migration_integrity_assertions.sql`; the actual file is `migration_integrity_verification.sql`. Both names refer to the same catalog verification file.

## Step-by-Step Procedure

### 1. Provision Isolated PostgreSQL (Track A)
```bash
# Option A: Local PostgreSQL (recommended)
# Install PostgreSQL 15+ locally, create empty database
createdb shelf_replay_test
export PGHOST=localhost
export PGPORT=5432
export PGUSER=postgres
export PGDATABASE=shelf_replay_test

# Option B: Docker (isolated, no shared daemon)
docker run --name shelf-replay-db -e POSTGRES_PASSWORD=test -d postgres:15
# Wait for startup, then:
export PGHOST=localhost
export PGPORT=5432
export PGUSER=postgres
export PGPASSWORD=test
export PGDATABASE=postgres
```

### 2. Apply All Migrations in Order (Track A)
```bash
# From repository root
cd C:\Users\Yesha May M. Cordero\Downloads\CAPSTONE-SHELF-main\CAPSTONE-SHELF-main

# Apply migrations sequentially
for f in supabase/migrations/*.sql; do
  echo "Applying $f..."
  psql -v ON_ERROR_STOP=1 -f "$f"
  if [ $? -ne 0 ]; then
    echo "FAILED: $f"
    exit 1
  fi
done
echo "All 167 migrations applied successfully"
```

> **Known failures on Windows PostgreSQL 18:** Migrations requiring `pg_cron` or `pg_net` extensions will fail at `CREATE EXTENSION`. These are: `20270103000800_unified_visitor_notifications.sql`, `20270103000900_notification_lifecycle_events.sql`, `20270103001100_fix_community_borrowing_workflow.sql` (cron), `20261122000000_cache_popular_borrowed_book_counts.sql` (pg_net). Track A cannot complete these; Track B is required.

### 3. Run Migration Validation (Track A)
```bash
node scripts/validate-migrations.mjs
# Must output: "validationErrors": [] and count: 167
```

### 4. Verify Critical Schema Objects (Track A)

#### Functions (verify SECURITY INVOKER, search_path, grants)
```sql
-- Check all SECURITY DEFINER functions are intentional
SELECT p.proname, p.prosecdef, p.proconfig
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE n.nspname = 'public'
  AND p.prosecdef = true;

-- Verify OPAC functions are SECURITY INVOKER
SELECT p.proname, p.prosecdef
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE n.nspname = 'public'
  AND p.proname LIKE 'get_opac%';

-- Verify grants
SELECT routine_name, grantee, privilege_type
FROM information_schema.routine_privileges
WHERE routine_schema = 'public'
  AND routine_name LIKE 'get_opac%'
ORDER BY routine_name, grantee;
```

#### RLS Policies (verify all tables have RLS enabled)
```sql
SELECT schemaname, tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY tablename;

-- Verify policies exist
SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, policyname;
```

#### Table Grants (verify least privilege)
```sql
SELECT table_name, grantee, privilege_type
FROM information_schema.table_privileges
WHERE table_schema = 'public'
ORDER BY table_name, grantee;
```

### 5. Run SQL Assertions (Track A)
```bash
# Run all 12 assertion files in order
for f in supabase/tests/audit_trigger_assertions.sql \
         supabase/tests/fine_runtime_fix_assertions.sql \
         supabase/tests/public_community_visitor_registration.sql \
         supabase/tests/subscription_authorization_assertions.sql \
         supabase/tests/security_hardening_assertions.sql \
         supabase/tests/security_release_assertions.sql \
         supabase/tests/transaction_integrity_assertions.sql \
         supabase/tests/fine_payment_privacy_assertions.sql \
         supabase/tests/opac_count_rpc_assertions.sql \
         supabase/tests/aal2_policy_assertions.sql \
         supabase/tests/migration_integrity_verification.sql \
         supabase/tests/community_borrowing_workflow_assertions.sql; do
  echo "Running assertion $f..."
  psql -v ON_ERROR_STOP=1 -f "$f"
done
```

### 6. Verify Key Function Behaviors (Track A — limited; Track B — full)

#### OPAC Count Functions
```sql
-- Test as anon role
SET ROLE anon;
SELECT get_opac_library_book_count();
SELECT get_opac_total_book_count();
SELECT get_opac_filtered_book_count('', 'All', null, 'All');
-- Should succeed

-- Test branch-scoped as anon (should fail)
SELECT get_opac_library_book_count_by_library('00000000-0000-0000-0000-000000000000');
-- Should raise 42501

-- Test as authenticated (no staff)
SET ROLE authenticated;
SELECT get_opac_library_book_count_by_library('00000000-0000-0000-0000-000000000000');
-- Should raise 42501

-- Test as staff with access (requires auth.uid() and is_active_staff_for_branch)
-- This requires test data setup
```

#### Fine Payment Privacy
```sql
-- Verify Super Admin gets aggregate only
SET ROLE authenticated; -- with superadmin JWT claim
SELECT * FROM get_fine_payment_analytics(...);
-- Should return aggregate counts only, no visitor_id, no amounts

-- Verify Sub-admin gets branch-scoped detail
-- Requires AAL2 and branch assignment
```

#### Transaction RPCs (check FOR UPDATE, state machines)
```sql
-- Verify request_borrow_unchecked uses FOR UPDATE
-- Verify confirm_pickup/confirm_return enforce state transitions
-- Verify record_fine_payment uses atomic balance update
-- Verify toggle_attendance prevents duplicates
```

### 7. Verify Migration History Table (Track A)
```sql
SELECT * FROM supabase_migrations.schema_migrations ORDER BY version;
-- Should have 167 entries matching manifest
```

### 8. Run Auth/PostgREST Authorization Matrix (Track B ONLY)
See `AUTH_POSTGREST_TEST_PLAN.md` for the complete matrix and execution procedure. Track B requires:
- Real Supabase Auth sessions (password + TOTP for AAL2)
- Actual PostgREST requests with `Authorization: Bearer <token>`
- No mocked JWTs — uses real Auth-issued tokens

## Expected Results

| Check | Expected | Track |
|-------|----------|-------|
| Migration count | 167 | A |
| Validation errors | 0 | A |
| SECURITY DEFINER functions | Only intentional ones (audit triggers, category counts) | A |
| OPAC functions | All SECURITY INVOKER | A |
| Branch-scoped OPAC | Requires staff authorization (AAL2) | A+B |
| RLS enabled | All public tables | A |
| Fine privacy | Super Admin aggregate only, Sub-admin branch-scoped | A+B |
| Transaction RPCs | FOR UPDATE, state machine, atomic updates | A+B |
| Auth/PostgREST matrix | 3 auth roles × 2 AAL levels + anonymous verified | B |
| Concurrency/row locks | 8 scenarios with real concurrent sessions | B |

## Current Status

| Check | Status | Track |
|-------|--------|-------|
| Migration validation | ✅ 167 migrations, 0 errors | A (local) |
| Source-level security checks | ✅ Passed | A (local) |
| **Actual database replay** | ❌ NOT RUN — requires isolated PostgreSQL | A |
| **SQL assertions execution** | ❌ NOT RUN — requires database | A |
| **Runtime function behavior** | ❌ NOT VERIFIED — requires database + test data | A |
| **Real Auth/PostgREST matrix** | ❌ NOT RUN — requires Supabase stack | B |
| **AAL2/TOTP verification** | ❌ NOT RUN — requires Supabase Auth + MFA | B |
| **Cross-role access denial** | ❌ NOT VERIFIED — requires real tokens | B |
| **Branch isolation** | ❌ NOT VERIFIED — requires real tokens + data | B |
| **Concurrency/row locks** | ❌ NOT RUN — requires real concurrent sessions | B |
| **Community workflow runtime** | ❌ NOT RUN — requires pg_cron + pg_notify listener | B |

## Missing Infrastructure

**Track A (Local PostgreSQL):**
- No isolated PostgreSQL 15+ environment available. The shared Docker daemon cannot be used per safety rules. A local PostgreSQL 15+ instance or isolated Docker container is required to complete this verification.

**Track B (Supabase Stack):**
- **No isolated Supabase project available.** Requires:
  1. Local Supabase stack (`supabase start`) — **not available on Windows** (Docker required, pg_cron/pg_net limitations)
  2. OR dedicated staging Supabase project (owner approval + paid resource)
  3. Auth configured with MFA/TOTP
  4. Test users provisioned for all 3 authorization roles + anonymous
  5. PostgREST running with correct JWT secret
  6. Storage, Vault, Edge Functions, Realtime, pg_cron, pg_net

## Next Steps for Owner

### Track A (Local PostgreSQL)
1. Provision isolated PostgreSQL (local install or Docker container)
2. Run steps 1-7 above
3. Document any failures (especially pg_cron/pg_net extension failures)
4. For pg_cron/pg_net migrations: either skip on Windows or use Track B

### Track B (Supabase Stack)
1. Provision isolated Supabase environment (local `supabase start` on Linux/macOS, or dedicated staging project)
2. Apply all 167 migrations
3. Create test users and assign roles per `AUTH_POSTGREST_TEST_PLAN.md`
4. Execute test matrix
5. Document any authorization gaps
6. Fix with forward-only migrations if needed

### Credential Rotation (Both Tracks)
See `RELEASE_VALIDATION_RUNBOOK.md` for credential exposure findings and rotation checklist. **OWNER ACTION REQUIRED** before any deployment.