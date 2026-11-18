# SHELF ILMS Exact Staging Test Instructions

**Version:** 1.0
**Date:** 2026-11-17
**Purpose:** Step-by-step procedures to provision staging infrastructure and execute Track A/B verification
**Prerequisites:** Owner approval for paid resources; no production credentials in staging

---

## Part 0: Production Database Password Verification (Owner Only — Prerequisite)

**Purpose:** Independently verify that the new database password (set via Supabase Dashboard → Settings → Database → "Reset database password") successfully authenticates to the production PostgreSQL database.

**Prerequisites:**
- Owner has the new password (not stored in this repository, not shared in chat)
- `psql` client installed locally (PostgreSQL 15+ recommended)
- Network access to Supabase (port 5432 outbound)

**Connection Details (Public Information):**
- Host: `db.khwtfjyvawukbsvyjdux.supabase.co` (Supabase direct database endpoint for project `khwtfjyvawukbsvyjdux`)
- Port: `5432`
- Database: `postgres`
- User: `postgres`
- SSL Mode: `require` (mandatory for Supabase)

**Procedure — Secure Interactive Password Prompt:**

```powershell
# Run in a clean PowerShell session. The password is prompted interactively and never appears in command history.
psql "postgresql://postgres@db.khwtfjyvawukbsvyjdux.supabase.co:5432/postgres?sslmode=require" -c "SELECT 1;"
```

**Expected Success Output:**
```
 ?column?
----------
        1
(1 row)
```

**Failure Diagnosis:**

| Error Pattern | Likely Cause | Action |
|---------------|--------------|--------|
| `password authentication failed for user "postgres"` | Incorrect new password | Re-enter password; verify reset completed in Dashboard |
| `could not translate host name` / `connection timed out` | Network/DNS/IPv6 issue | Check firewall, VPN, IPv6; try IPv4 explicitly with `-h` |
| `SSL error` / `certificate verify failed` | TLS/SSL configuration | Ensure `sslmode=require`; try `sslmode=verify-full` with CA |
| `database "postgres" does not exist` | Wrong database name | Use `postgres` (default Supabase database) |

**Critical Distinction:**
- `supabase projects list` (or `supabase status`) succeeding **only proves Management API access** via your personal access token or logged-in session. It does **not** verify the database password.
- The database password is a separate credential used exclusively for direct PostgreSQL connections (psql, application connection pools, migration tools). It must be tested independently as shown above.

**Do NOT:**
- Embed the password in the connection string (exposes to shell history)
- Use `PGPASSWORD="..."` inline (exposes to process table and history)
- Save the password in `.env`, scripts, or any file tracked by Git
- Share the password in chat, tickets, or documentation

**Verification Record:**
After successful `SELECT 1`, record the date, method, and that the test passed. Update the credential rotation status in `SHELF_REMAINING_BLOCKERS_OWNER_ACTIONS.md` and `SHELF_FINAL_RELEASE_READINESS.md`.

---

## Part 1: Infrastructure Provisioning

### Option A: Local Supabase Stack (Linux/macOS Only) — Preferred for Track B

**Windows is NOT supported for `supabase start`** due to Docker requirements and pg_cron/pg_net limitations.

```bash
# 1. Install Supabase CLI
npm install -g supabase

# 2. Initialize project (if not already)
cd /path/to/CAPSTONE-SHELF-main/CAPSTONE-SHELF-main
supabase init

# 3. Start Supabase stack (requires Docker daemon)
supabase start
# Wait for all services: PostgreSQL, Auth, PostgREST, Storage, Vault, Edge Functions, Realtime, pg_cron, pg_net

# 4. Note the output URLs and keys:
#    API URL: http://127.0.0.1:54321
#    DB URL: postgresql://postgres:postgres@127.0.0.1:54322/postgres
#    Studio URL: http://127.0.0.1:54323
#    Anon key: (displayed)
#    Service role key: (displayed)
```

**Verify services:**
```bash
# Check pg_cron and pg_net extensions
psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -c "SELECT * FROM pg_extension WHERE extname IN ('pg_cron', 'pg_net');"

# Check Auth MFA support
curl -X GET http://127.0.0.1:54321/auth/v1/health
```

### Option B: Dedicated Supabase Staging Project (Cloud) — Cross-Platform

1. **Owner creates new Supabase project** at https://supabase.com/dashboard
   - Project name: `shelf-staging-<unique>`
   - Region: Closest to testers
   - **Free tier acceptable** for testing
   - **Do NOT use production project**

2. **Configure project settings:**
   - Auth → Providers → Email: Enable
   - Auth → MFA: Enable TOTP
   - Auth → URL Configuration: Set redirect URLs for staging frontend
   - Database → Extensions: Enable `pg_cron`, `pg_net`
   - Edge Functions: Deploy all functions from `supabase/functions/`
   - Storage: Create buckets per `supabase/storage/` config
   - Vault: Enable for secrets

3. **Record staging credentials (store in password manager, NOT .env):**
   - Project Ref: `xxxxx`
   - API URL: `https://xxxxx.supabase.co`
   - Anon key: `eyJ...`
   - Service role key: `eyJ...` (for Edge Functions only)
   - DB password: (from Settings → Database)

---

## Part 2: Database Migration Replay (Track A)

### 2.1 Provision Isolated PostgreSQL (Track A Only)

```bash
# Option A1: Local PostgreSQL 15+ (recommended)
# Install PostgreSQL 15+, create empty database
createdb shelf_replay_test
export PGHOST=localhost
export PGPORT=5432
export PGUSER=postgres
export PGDATABASE=shelf_replay_test

# Option A2: Isolated Docker container (no shared daemon)
docker run --name shelf-replay-db -e POSTGRES_PASSWORD=test -d postgres:15
# Wait 10s for startup
export PGHOST=localhost
export PGPORT=5432
export PGUSER=postgres
export PGPASSWORD=test
export PGDATABASE=postgres
```

### 2.2 Apply All 167 Migrations

```bash
cd /path/to/CAPSTONE-SHELF-main/CAPSTONE-SHELF-main

# Apply sequentially — stop on first error
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

**Expected Failures on Windows PostgreSQL 18 (Track A limitation):**
- `20270103000800_unified_visitor_notifications.sql` — `CREATE EXTENSION pg_net`
- `20270103000900_notification_lifecycle_events.sql` — `CREATE EXTENSION pg_cron`
- `20270103001100_fix_community_borrowing_workflow.sql` — `CREATE EXTENSION pg_cron`
- `20261122000000_cache_popular_borrowed_book_counts.sql` — `CREATE EXTENSION pg_net`

**Document these failures.** Track B required for full verification.

### 2.3 Run Migration Validation

```bash
node scripts/validate-migrations.mjs
# Must output: "validationErrors": [] and count: 167
```

### 2.4 Verify Critical Schema Objects

```sql
-- 1. Check SECURITY DEFINER functions (should be minimal)
SELECT p.proname, p.prosecdef, p.proconfig
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE n.nspname = 'public'
  AND p.prosecdef = true;

-- 2. Verify OPAC functions are SECURITY INVOKER
SELECT p.proname, p.prosecdef
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE n.nspname = 'public'
  AND p.proname LIKE 'get_opac%';

-- 3. Verify grants on OPAC functions
SELECT routine_name, grantee, privilege_type
FROM information_schema.routine_privileges
WHERE routine_schema = 'public'
  AND routine_name LIKE 'get_opac%'
ORDER BY routine_name, grantee;

-- 4. RLS enabled on all public tables
SELECT schemaname, tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY tablename;

-- 5. Policies exist
SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, policyname;
```

### 2.5 Run All 12 SQL Assertions

```bash
# Execute in order — each must pass (exit code 0)
for f in \
  supabase/tests/audit_trigger_assertions.sql \
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
  if [ $? -ne 0 ]; then
    echo "ASSERTION FAILED: $f"
    exit 1
  fi
done
echo "All 12 assertions passed"
```

**Note:** `security_hardening_assertions.sql` uses synthetic GUCs and fixtures in a transaction that **must ROLLBACK**. Verify temporary fixtures are absent after execution.

### 2.6 Verify Migration History Table

```sql
SELECT * FROM supabase_migrations.schema_migrations ORDER BY version;
-- Should have 167 entries matching manifest
```

---

## Part 3: Track B — Auth/PostgREST Matrix Execution

### 3.1 Provision Isolated Supabase (see Part 1, Option A or B)

**Must have:** Auth with MFA/TOTP, PostgREST, Storage, Vault, Edge Functions, Realtime, pg_cron, pg_net.

### 3.2 Apply Migrations to Staging Supabase

```bash
# Link to staging project
supabase link --project-ref <staging-project-ref>

# Push migrations
supabase db push
# OR apply manually via psql to staging DB URL
```

### 3.3 Create Test Users

Use Supabase Dashboard → Authentication → Users → "Invite User" OR API:

| Email | Role | Account State | Password | MFA |
|-------|------|---------------|----------|-----|
| `inst.visitor@test.local` | Visitor | Institutional approved | `TestPass123!` | Enroll TOTP |
| `comm.visitor.approved@test.local` | Visitor | Community approved | `TestPass123!` | Enroll TOTP |
| `comm.visitor.pending@test.local` | Visitor | Community pending | `TestPass123!` | Enroll TOTP |
| `subadmin@test.local` | Sub-admin | Active staff (Library A) | `TestPass123!` | Enroll TOTP |
| `subadmin-b@test.local` | Sub-admin | Active staff (Library B) | `TestPass123!` | Enroll TOTP |
| `superadmin@test.local` | Super Admin | Active staff (system) | `TestPass123!` | Enroll TOTP |

**For each user:**
1. Create via Dashboard or `supabase auth signup`
2. Set password
3. **Enroll TOTP:** Auth → Users → [user] → MFA → Enroll TOTP → Save seed
4. Assign role via JWT custom claims OR database profile:
   - Visitors: `visitors` table with `registration_type`, `approval_status`, `is_active=true`, `otp_verified=true`
   - Staff: `staff_profiles` table with `role` = `subadmin`/`superadmin`, `library_id`, `is_active=true`

### 3.4 Seed Test Data

```sql
-- Run via psql to staging DB
-- 1. Libraries
INSERT INTO libraries (id, name, email_domain, latitude, longitude, coordinates_verified)
VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Library A', 'test-a.edu', 14.123, 121.456, true),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Library B', 'test-b.edu', 14.234, 121.567, true);

-- 2. Staff profiles
INSERT INTO staff_profiles (auth_user_id, library_id, role, is_active)
VALUES
  ('<subadmin-auth-uid>', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'subadmin', true),
  ('<subadmin-b-auth-uid>', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'subadmin', true),
  ('<superadmin-auth-uid>', NULL, 'superadmin', true);

-- 3. Books (library, personal, external)
-- 4. Borrow requests (various states)
-- 5. Community book requests
-- 6. Fine payments
-- 7. Attendance logs
-- See AUTH_POSTGREST_TEST_PLAN.md for detailed seed requirements
```

### 3.5 Configure Email Catcher (Mailpit)

```bash
# Run Mailpit for OTP/approval emails
docker run -d -p 1025:1025 -p 8025:8025 axllent/mailpit
# Configure Supabase Auth SMTP to localhost:1025
```

### 3.6 Execute Test Matrix

**Use the automated runner:** `scripts/run-auth-postgrest-matrix.mjs`

```bash
# Prepare fixture file (outside repo, e.g., /secure-work/shelf-auth-cases.json)
# See AUTH_POSTGREST_TEST_PLAN.md for fixture format

export SHELF_TEST_ENVIRONMENT=isolated-staging
export SHELF_TEST_PROJECT_REF=<staging-project-ref>
export SHELF_TEST_SUPABASE_URL=<staging-api-url>
export SHELF_TEST_SUPABASE_ANON_KEY=<staging-anon-key>
export SHELF_AUTH_TEST_FIXTURE=/secure-work/shelf-auth-cases.json

npm run test:auth-postgrest
```

**Runner requirements:**
- Real Supabase Auth password + TOTP sessions (no mocked JWTs)
- Uses `Authorization: Bearer <token>` for PostgREST requests
- Refuses production project ref
- Emits only case names and HTTP status codes
- Fixture must contain all required coverage tags

### 3.7 Manual Test Cases (Supplement to Matrix)

For each role/AAL combination, execute key flows from `SHELF_FINAL_MANUAL_QA_CHECKLIST.md`:

| Priority | Test IDs | Description |
|----------|----------|-------------|
| P0 | VIS-AUTH-01, VIS-AUTH-04, VIS-CBR-01, VIS-LBR-01 | Visitor auth, role guards, community borrow, library borrow |
| P0 | SUB-AUTH-01, SUB-AUTH-02, SUB-QUE-02, SUB-QUE-03 | Sub-admin AAL1 denial, AAL2 pickup/return |
| P0 | SUP-AUTH-01, SUP-AUTH-02, SUP-ANL-01 | Super Admin AAL1 denial, AAL2 aggregate analytics |
| P0 | NEG-XV-01, NEG-XB-01, NEG-RE-01, NEG-FINE-01 | Cross-visitor, cross-branch, role escalation, fine privacy |
| P1 | NOTIF-01 through NOTIF-11 | Notification lifecycle |
| P1 | FLOW-01, FLOW-02 | Complete borrow/return flows |
| P1 | ANL-01 through ANL-06 | Analytics privacy boundaries |
| P1 | OPAC-01 through OPAC-06 | OPAC count verification |
| P2 | RSP-01 through RSP-13 | Responsive UI at 3 breakpoints |

---

## Part 4: Concurrent Concurrency Tests (Track B)

```bash
# Run concurrency scenarios from supabase/tests/concurrency_test_scenarios.sql
# Requires 2+ simultaneous psql sessions
# 8 scenarios:
# 1. Concurrent borrow requests for same copy
# 2. Concurrent pickup confirmations
# 3. Concurrent return confirmations
# 4. Concurrent fine payments
# 5. Concurrent attendance check-ins
# 6. Concurrent community request approvals
# 7. Concurrent queue promotions
# 8. Concurrent notification claims

# Each scenario: verify FOR UPDATE locks prevent race conditions
# Document: deadlocks, serialization failures, correct final state
```

---

## Part 5: OPAC Count Verification (Localhost vs Vercel)

### 5.1 Localhost Verification

```bash
# 1. Configure local .env for staging Supabase (NOT production)
VITE_SUPABASE_URL=https://<staging-project>.supabase.co
VITE_SUPABASE_ANON_KEY=<staging-anon-key>

# 2. Start dev server
npm run dev

# 3. Open localhost:5173 (or configured port)
# 4. Navigate to LandingPage → note library book count
# 5. Navigate to OPACCatalog → note total count, filtered counts
# 6. Open debug panel (development only) → verify RPC vs client counts match
# 7. Test pagination: external catalog >1000 books → verify all pages load
# 8. Test search/filter → verify RPC filtered count matches
```

### 5.2 Vercel Verification (Post-Deployment)

```bash
# 1. Deploy to Vercel preview (NOT production)
# 2. Configure Vercel env vars for STAGING Supabase:
#    VITE_SUPABASE_URL=https://<staging-project>.supabase.co
#    VITE_SUPABASE_ANON_KEY=<staging-anon-key>
# 3. Wait for deployment
# 4. Open Vercel preview URL
# 5. Repeat steps 4-8 from localhost verification
# 6. Compare counts: MUST BE IDENTICAL (same data source)
```

### 5.3 RPC Direct Verification

```sql
-- As anon role
SET ROLE anon;
SELECT get_opac_library_book_count();
SELECT get_opac_total_book_count();
SELECT get_opac_filtered_book_count('', 'All', null, 'All');
-- Should succeed

-- Branch-scoped as anon (should fail)
SELECT get_opac_library_book_count_by_library('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
-- Should raise 42501

-- As authenticated (no staff)
SET ROLE authenticated;
SELECT get_opac_library_book_count_by_library('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
-- Should raise 42501

-- As staff with access (requires auth.uid() + is_active_staff_for_branch)
-- This requires test data setup with JWT
```

---

## Part 6: Edge Function Verification

```bash
# 1. Deploy all Edge Functions to staging
supabase functions deploy send-due-date-notifications
supabase functions deploy send-fine-reminder
supabase functions deploy send-visitor-otp
# ... all functions in supabase/functions/

# 2. Configure secrets in Supabase Dashboard:
#    RESEND_API_KEY, APP_ORIGIN, etc.

# 3. Test send-visitor-otp:
curl -X POST https://<project>.supabase.co/functions/v1/send-visitor-otp \
  -H "Authorization: Bearer <anon-key>" \
  -H "Content-Type: application/json" \
  -d '{"email": "inst.visitor@test.local", "library_id": "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"}'
# Verify: 200, OTP sent to Mailpit, 120s cooldown enforced

# 4. Test send-due-date-notifications (requires pg_cron):
#    Trigger manually or wait for cron
#    Verify notifications created in visitor_notifications table

# 5. Test send-fine-reminder:
#    Create fine payment due today
#    Trigger function
#    Verify fine_reminder notifications created
```

---

## Part 7: Evidence Collection Checklist

For each test executed, record:

| Field | Required |
|-------|----------|
| Test ID | Yes |
| Date/Time | Yes |
| Executor | Yes |
| Environment (Track A/B, localhost/Vercel) | Yes |
| Test User | Yes |
| Steps Performed | Yes |
| Expected Result | Yes |
| Actual Result | Yes |
| Pass/Fail/Blocked | Yes |
| Screenshot/Log Reference | Yes (for UI tests) |
| API Response (status, body) | Yes (for RPC/API tests) |
| SQL Query Output | Yes (for database tests) |

**Storage:** Save all evidence in `/secure-work/staging-evidence/<date>/` with subdirectories per test category.

---

## Part 8: Sign-Off Requirements

Track A complete when:
- [ ] All 167 migrations applied (document pg_cron/pg_net failures)
- [ ] Migration validation passes (167, 0 errors)
- [ ] All 12 SQL assertions pass
- [ ] Critical schema objects verified
- [ ] Migration history table has 167 entries

Track B complete when:
- [ ] All 6 test users created with MFA
- [ ] Test data seeded
- [ ] Auth/PostgREST matrix executes with 0 failures
- [ ] 8 concurrency scenarios verified
- [ ] All P0/P1 manual QA tests pass with evidence
- [ ] OPAC counts match localhost ↔ Vercel
- [ ] Edge Functions verified
- [ ] Fine-payment privacy boundaries verified at runtime

**Both tracks must complete before release readiness can be reassessed.**

---

## Part 4: Local Development Configuration Guide

### 4.1 Purpose & Safety Guard

This section documents the **local development environment only**. It does not provision staging or production infrastructure.

**Critical Safety Rule:**
Frontend code includes a production-connection guard in `src/lib/supabaseClient.js` that **throws an error** if the Supabase URL matches the production project (`khwtfjyvawukbsvyjdux.supabase.co`). This prevents accidental production writes during `npm run dev`.

```javascript
// src/lib/supabaseClient.js — Production guard (DO NOT REMOVE)
const PRODUCTION_URL = "https://khwtfjyvawukbsvyjdux.supabase.co";
if (supabaseUrl === PRODUCTION_URL && import.meta.env.DEV) {
  throw new Error("Production Supabase URL detected in development mode. Use local/staging credentials only.");
}
```

### 4.2 Prerequisites

- Node.js 18+ and npm
- Git (for repository access)
- **Local PostgreSQL 15+** (for Track A replay) OR **Supabase CLI** (for local Supabase stack on Linux/macOS/WSL2)
- **Windows Note:** `supabase start` requires Docker Desktop + WSL2. On native Windows, use Option B (cloud staging project) for Track B.

### 4.3 Repository Setup (One-Time)

```bash
# Clone repository
git clone <repository-url>
cd CAPSTONE-SHELF-main

# Install dependencies
npm install

# Verify validation baseline
npm run lint        # Must pass
npm run build       # Must pass
node --test         # 199 pass / 49 skipped expected
npm run validate:migrations  # 167 migrations, 0 errors expected
```

### 4.4 Environment Configuration

#### 4.4.1 Preserve `.gitignore` and `.env.example` — Do Not Modify

The following files are committed and **must remain unchanged**:

**`.gitignore` (covers all credential file patterns):**
```
.env
.env.*
env
*.env
*.local
```

**`.env.example` (placeholders only — no real values):**
```bash
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
VITE_ANALYTICS_API_URL=
```

**`analytics/.env.example` (placeholders only):**
```bash
GEMINI_API_KEY=
GEMINI_MODEL=
ANALYTICS_ALLOWED_ORIGINS=
```

#### 4.4.2 Create Local `.env` (Not Tracked — In `.gitignore`)

```bash
# Copy template
cp .env.example .env

# Edit with YOUR local/staging credentials only
# NEVER use production credentials here
```

**Required variables for local development:**
```bash
# Supabase local OR staging project (NOT production)
VITE_SUPABASE_URL=https://<your-local-or-staging-project>.supabase.co
VITE_SUPABASE_ANON_KEY=<your-local-or-staging-anon-key>

# Optional: Analytics (only if testing analytics features)
# VITE_ANALYTICS_API_URL=https://<analytics-endpoint>
```

**Required variables for analytics service (separate folder):**
```bash
# analytics/.env (create from analytics/.env.example)
GEMINI_API_KEY=<your-gemini-key>
GEMINI_MODEL=gemini-1.5-flash
ANALYTICS_ALLOWED_ORIGINS=http://localhost:5173
```

### 4.5 Local Database Options

#### Option A: Local Supabase Stack (Linux/macOS/WSL2 only)
```bash
# Install Supabase CLI
npm install -g supabase

# Initialize local project (creates .supabase folder)
supabase init

# Start local stack (requires Docker + WSL2 on Windows)
supabase start

# Apply all 167 migrations
supabase db reset --linked  # OR manually: psql -f supabase/migrations/*.sql

# Verify local project_id in supabase/config.toml matches
# project_id = "shelf-ilms-local"  (or your local project ID)
```

#### Option B: Cloud Staging Project (Windows native, cross-platform)
1. Create new Supabase project at supabase.com (e.g., "shelf-staging")
2. Enable extensions: **pg_cron**, **pg_net** (Database → Extensions)
3. Configure Auth: Email provider enabled, MFA/TOTP enabled
4. Deploy Edge Functions: `supabase functions deploy` (after linking)
5. Use staging credentials in `.env`

#### Option C: Isolated PostgreSQL (Track A only)
```bash
# For Track A migration replay only
createdb shelf_replay_test
# Apply migrations manually via psql
# Document 4 known failures: pg_cron/pg_net CREATE EXTENSION
```

### 4.6 Supabase CLI Configuration

**`supabase/config.toml` (committed — verify `project_id` matches your local/staging project):**
```toml
project_id = "shelf-ilms-local"  # Change to your staging project ref if using cloud

[functions]
  # 7 Edge Functions deployed via `supabase functions deploy`
  # send-due-date-notifications
  # send-fine-reminder
  # send-visitor-otp
  # manage-staff
  # request-password-reset
  # login-with-lockout
  # visitor-qr-login

[auth]
  # MFA/TOTP enabled for Track B
  enabled = true
```

### 4.7 Running the Application

```bash
# Development server (uses .env via Vite)
npm run dev

# Production build verification
npm run build

# Run tests
node --test

# Validate migrations locally
npm run validate:migrations
```

### 4.8 Production-Project Safety Checklist

Before starting `npm run dev`, verify:

- [ ] `.env` exists and contains **local/staging** URL (not `khwtfjyvawukbsvyjdux.supabase.co`)
- [ ] `VITE_SUPABASE_ANON_KEY` is for local/staging project
- [ ] No `SUPABASE_DB_PASSWORD` or `SUPABASE_SERVICE_ROLE_KEY` in `.env` (frontend never needs these)
- [ ] `supabase/config.toml` `project_id` matches your local/staging project
- [ ] Production guard in `src/lib/supabaseClient.js` is present and unmodified

### 4.9 Common Issues

| Issue | Resolution |
|-------|------------|
| `Error: Production Supabase URL detected in development mode` | Update `.env` with local/staging URL |
| `supabase start` fails on Windows | Use WSL2 + Docker Desktop, or Option B (cloud staging) |
| `pg_cron`/`pg_net` not available locally | Track A: document as known gap; Track B: enable in cloud staging Dashboard |
| Auth MFA not working locally | Verify `supabase start` includes Auth; check Dashboard → Auth → Settings |
| Edge Functions not deploying | Run `supabase link --project-ref <your-project>` then `supabase functions deploy` |

---

## Quick Reference: Environment Variables for Staging

```bash
# Track B test runner
export SHELF_TEST_ENVIRONMENT=isolated-staging
export SHELF_TEST_PROJECT_REF=<staging-project-ref>
export SHELF_TEST_SUPABASE_URL=https://<staging-project>.supabase.co
export SHELF_TEST_SUPABASE_ANON_KEY=<staging-anon-key>
export SHELF_AUTH_TEST_FIXTURE=/secure-work/shelf-auth-cases.json

# Local development (npm run dev)
VITE_SUPABASE_URL=https://<staging-project>.supabase.co
VITE_SUPABASE_ANON_KEY=<staging-anon-key>
# VITE_ANALYTICS_API_URL=https://shelf-analytics-q24u.onrender.com
# GEMINI_API_KEY=<if needed>
# GEMINI_MODEL=<if needed>
# ANALYTICS_ALLOWED_ORIGINS=https://<staging-frontend>.vercel.app

# NEVER use production credentials in staging
# NEVER commit .env files
```

---

## Troubleshooting Common Issues

| Issue | Resolution |
|-------|------------|
| `supabase start` fails on Windows | Use Option B (cloud staging) or WSL2 with Docker |
| pg_cron/pg_net not available | Track A: document as known gap; Track B: enable in Supabase Dashboard → Database → Extensions |
| Auth MFA not working | Verify TOTP enrolled; check Auth → Settings → MFA enabled |
| PostgREST 401/403 on valid tokens | Verify JWT secret matches; check `auth.jwt()` claims |
| Edge Function CORS errors | Configure `APP_ORIGIN` / `APP_ORIGINS` in function secrets |
| Migration fails on `CREATE EXTENSION` | Track A: expected on Windows; Track B: enable extensions first |
| OPAC counts still differ | Verify both environments use SAME Supabase project; check RPC grants; check RLS policies |
| Fine analytics shows PII | Verify `get_fine_payment_analytics` returns only aggregates; check small-cohort suppression |

---

**End of Staging Test Instructions**
*Execute in order. Do not skip steps. Document all evidence.*