# SHELF ILMS Release Validation Runbook

**State: NOT READY.** This runbook prepares repeatable checks; it does not claim a migration replay, SQL assertion run, production comparison, or real Auth/PostgREST test has occurred. Never run database steps against production.

## Two-Track Validation Design

| Track | Name | Scope | Infrastructure | Status |
|-------|------|-------|----------------|--------|
| **Track A** | Local Structural Validation | Migration ordering, manifest integrity, catalog assertions (SECURITY DEFINER, search_path, grants, RLS policies, function metadata) | Isolated PostgreSQL 15+ | ✅ Structurally complete; execution BLOCKED |
| **Track B** | Genuine Supabase Runtime | Real Auth-issued tokens, PostgREST authorization matrix, AAL2/TOTP, Edge Functions, Storage, Vault, Realtime, pg_cron, pg_net | Isolated Supabase project | ❌ NOT RUN — requires Supabase stack |

> **CRITICAL:** Track A cannot verify `pg_cron`/`pg_net` extensions (unavailable on Windows PostgreSQL 18). Four migrations fail at `CREATE EXTENSION`. Track B is the ONLY path for full Supabase feature verification.

## Local Repository Checks (Track A — Source Only)

From the repository root:

```powershell
npm run validate:migrations
node --test
npm run lint
npm run build
git diff --check
```

`npm run validate:migrations` emits every migration's SHA-256 over exact file bytes, verifies 14-digit unique versions and ascending order, and reports the first and last version. To compare to a history export supplied by the project owner (JSON array or `migrations` array, CSV with `version[,name]` header, or one version per line):

```powershell
npm run validate:migrations -- --history C:\secure-work\production-history.csv --out C:\secure-work\local-migration-manifest.json
```

Use a new output path. The script uses create-new semantics and refuses to overwrite an existing file. A version/name comparison only identifies history differences; it does not prove that a migration's SQL effects are present. Production schema equivalence still requires object-by-object catalog evidence.

## SQL Assertion Order (Track A — Requires Isolated PostgreSQL)

After a complete clean migration replay in the approved disposable environment, execute each file once, in this order, using `psql -v ON_ERROR_STOP=1` (or an equivalent client that exits on SQL error):

1. `supabase/tests/audit_trigger_assertions.sql` — audit function, required columns/constraints, and trigger coverage.
2. `supabase/tests/fine_runtime_fix_assertions.sql` — category-rate helper and internal alert implementation.
3. `supabase/tests/public_community_visitor_registration.sql` — community registration/approval catalog contracts.
4. `supabase/tests/subscription_authorization_assertions.sql` — subscription function metadata, ACLs, and branch-check source.
5. `supabase/tests/security_hardening_assertions.sql` — catalog checks plus **synthetic** request claims/fixtures in one transaction that ends in `ROLLBACK`.
6. `supabase/tests/security_release_assertions.sql` — final release catalog contracts, including the announcement policy.
7. `supabase/tests/transaction_integrity_assertions.sql` — FOR UPDATE locks, state machine, atomic balance, duplicate prevention.
8. `supabase/tests/fine_payment_privacy_assertions.sql` — Super Admin aggregate-only, Sub-Admin branch-scoped, internal functions no grants.
9. `supabase/tests/opac_count_rpc_assertions.sql` — SECURITY INVOKER, authorization helper, grants, predicates match OPACCatalog.
10. `supabase/tests/aal2_policy_assertions.sql` — Visitor AAL1, Staff AAL2, function metadata/ACLs.
11. `supabase/tests/migration_integrity_verification.sql` — Function ownership, search_path, grants, postflight coverage.
12. `supabase/tests/community_borrowing_workflow_assertions.sql` — Community approval safeguards, cancellation states, queue promotion, inventory triggers.

**Total: 12 assertion files** (6 original + 5 new from Phase 3B + 1 renamed `migration_integrity_verification.sql` vs documented `migration_integrity_assertions.sql`).

The catalog-oriented files are assertions, not proof of real Auth behavior. The hardening file simulates PostgREST claim GUCs; it is not signed-token testing. Record exit code and complete output for each file. Run on a fresh disposable DB because the synthetic assertion requires setup privileges and should not share business data. Its transaction must reach `ROLLBACK`; verify its temporary fixture identifiers are absent afterward.

## Independent Database and Authenticated Test Prerequisites (Track B)

Do not use the existing shared Docker daemon or any existing SHELF project. Obtain either (a) a newly provisioned VM with a dedicated Docker daemon and disposable disk, or (b) an owner-approved, distinct Supabase staging project. Required services: PostgreSQL 17.6, Auth, PostgREST, TOTP MFA, local email catcher (for example Mailpit), and the application RPC/schema. Confirm project ref, API/database endpoints, Docker daemon identity, new network/volumes, and no production credentials before replay. Use a unique project ID and unused ports. No paid resource is to be provisioned without owner approval.

Create only synthetic users/branches/visitors/requests/payments/reviews. Use actual Supabase Auth sign-up/sign-in and MFA enroll/challenge/verify APIs to obtain real AAL1/AAL2 sessions; do not fabricate JWTs. Required identities: visitor A/B; active Super Admin; active Sub-admin for Branch A; active Sub-admin for Branch B; inactive staff; unsupported-role staff. A test harness must use supplied environment variables (never `.env`) for the staging URL and public anon/publishable key and receive test credentials through a secure secret store. Do not pass service-role credentials to browser tests.

Required matrix: AAL1 deny/AAL2 allow for privileged RPCs; missing/null/empty/mismatched app-metadata role; active/inactive and unsupported staff; Sub-admin same/different branch; Super Admin aggregate-only fine response; alert target branch scope; review anonymous public response has generic `Verified Reader`, no identity; visitor A cannot read/write visitor B review; direct raw review table access denied; community email OTP, approval/replay/self-approval/branch restrictions; attendance lookup/toggle, pickup/return, announcement branch scope, and visitor QR identification for attendance/borrowing/pickup/return. Assert QR Login remains absent. Save only redacted response shapes and status codes.

The opt-in `scripts/run-auth-postgrest-matrix.mjs` runner accepts a protected JSON case fixture outside the repo. It uses only Supabase Auth password sessions plus Auth MFA enrollment/challenge/verify; it does not accept caller-supplied JWTs or service-role keys. It refuses the known production project ref and requires `SHELF_TEST_ENVIRONMENT=isolated-staging`, an explicit project ref, and the matching local or staging API hostname. It emits only case names and HTTP status, never tokens or response bodies. For an AAL2 fixture, set `allowTotpEnrollment: true` only for disposable synthetic accounts; that case enrolls a real TOTP factor and leaves it enrolled. For already-enrolled synthetic accounts, provide the TOTP seed through an environment variable named by `totpSecretEnv`. The fixture must contain cases tagged with every required coverage tag in the runner. Each request is a real `/rest/v1/...` PostgREST request, and expectations can include status, required/forbidden keys, array bounds, and exact JSON path values.

Example protected-fixture shape (values below are placeholders, not executable account credentials):

```json
{
  "accounts": {
    "subadmin_a": {
      "alias": "subadmin-a",
      "emailEnv": "SHELF_TEST_SUBADMIN_A_EMAIL",
      "passwordEnv": "SHELF_TEST_SUBADMIN_A_PASSWORD",
      "allowTotpEnrollment": true
    }
  },
  "cases": [
    {
      "name": "Sub-admin AAL1 attendance lookup denied",
      "account": "subadmin_a",
      "aal": "aal1",
      "tags": ["aal1-denial", "subadmin"],
      "request": {"method": "POST", "path": "/rest/v1/rpc/lookup_attendance_visitor_v2", "body": {"p_qr_code": "SYNTHETIC-QR", "p_library_id": "SYNTHETIC-LIBRARY"}},
      "expected": {"status": [400, 401, 403]}
    }
  ]
}
```

Run only on the verified isolated target with credentials supplied by a secret manager or ephemeral process environment (never `.env`):

```powershell
$env:SHELF_TEST_ENVIRONMENT = 'isolated-staging'
$env:SHELF_TEST_PROJECT_REF = '<unique-staging-project-ref-or-local-project-id>'
$env:SHELF_TEST_SUPABASE_URL = '<matching-staging-or-local-api-url>'
$env:SHELF_TEST_SUPABASE_ANON_KEY = '<public-anon-or-publishable-key>'
$env:SHELF_AUTH_TEST_FIXTURE = 'C:\secure-work\shelf-auth-cases.json'
npm run test:auth-postgrest
```

The example is intentionally only one case; the runner refuses a fixture that omits any required tag. The fixture author must provide all matrix scenarios and synthetic object identifiers. Test sign-up/email-OTP and librarian approval cases must use the isolated email catcher and actual test APIs; do not simulate email verification in SQL.

## Eight Backdated Prerequisites: Object-Level Review Worksheet

All entries below describe local SQL intent, not production status. For each version compare its complete SQL effects and dependencies with both the supplied history export and production catalog evidence. If history says applied but catalog effects differ, stop and investigate; do not repair or mark applied based on version alone.

| Version / local file | Intended effect and dependencies | Production evidence required / principal risk |
|---|---|---|
| `20261001000001_shelf_admin_mfa_access_allowed_prerequisite.sql` | Defines/validates `public.shelf_admin_mfa_access_allowed()` (zero-arg boolean SQL/STABLE SECURITY DEFINER, owner `postgres`, fixed `public, pg_temp` path); explicit ACL is owner, authenticated, service_role EXECUTE only. No table or policy DDL. | Depends on Supabase roles, `auth.uid()`, `auth.jwt()`, and `public.staff_profiles`. It must precede `20261107082403`. Compare exact body, metadata, ACL and inherited execute path. Existing mismatch aborts; it never replaces the existing helper. |
| `20261001000002_is_shelf_superadmin_prerequisite.sql` | Defines/validates `public.is_shelf_superadmin()` with canonical December body, SQL/STABLE SECURITY DEFINER metadata and explicit owner/authenticated/service_role EXECUTE ACL. No table or policy DDL. | Depends on `staff_profiles`, Auth helpers and Supabase roles. Earlier references precede the canonical December definition. Existing same-name overloads, noncanonical body or unexpected effective privilege abort. Later claim-hardening migrations change the authorization contract; compare each version's effects separately. |
| `20261108160959_fine_schema_prerequisite.sql` | Validates/creates `public.fine_payments` (nine canonical columns, PK, positive amount/payment-method checks, `received_by` FK to staff with RESTRICT, RLS on, PUBLIC/anon/authenticated table ACL revoked); adds four `borrow_requests` columns (`fine_paid_amount` with nonnegative check, `fine_review_required`, `fine_review_resolved_at`, `fine_review_note`); validates the dashboard, books-library, and fine-ledger indexes structurally. No payment aggregate rewrite. | Depends on `borrow_requests`, `staff_profiles`, `books`, Supabase roles and canonical fine schema. Later November index/function and Dec. 24 ledger migrations can silently skip same-named indexes/objects; compare exact catalog shapes, service_role callers/ACL, ledger row count and whether populated ledger data needs separately approved reconciliation. Never infer aggregates or rewrite payments. |
| `20261109130133_trigger_function_prerequisites.sql` | Defines/validates `public.set_borrow_request_library_id()` and `public.maintain_book_rating_aggregates()` as postgres-owned PL/pgSQL SECURITY DEFINER trigger functions with fixed paths; revokes direct PUBLIC/anon/authenticated EXECUTE. It does not attach triggers or backfill aggregates. | Depends on `books`, `book_rating_aggregates`, `book_reviews`, trigger language and Supabase roles. Later trigger grants/attachments and the Nov. 22 aggregate backfill are separate effects. Compare function source, owner/config/ACL and trigger wiring; a preexisting differently shaped helper aborts. |
| `20261129999998_community_fine_review_prerequisite.sql` | Adds/validates `community_book_requests.fine_review_required boolean NOT NULL DEFAULT false`; no policies, functions, grants or records are rewritten. | Depends on `community_book_requests`. The later Nov. 30 community fine workflow updates this field. Constant default backfills existing rows to false, so compare historical business meaning and validate the exact column default/nullability before later `IF NOT EXISTS`/function operations. |
| `20261129999999_community_pickup_return_contract_prerequisite.sql` | Handles `public.confirm_community_book_pickup(uuid,text)`: on a clean chain it replaces the earlier table-returning contract with canonical `RETURNS void`, owner postgres, PL/pgSQL SECURITY DEFINER, empty fixed path, and authenticated/service_role execution; on databases recording Nov. 30, it validates the later final contract and leaves the function intact. | Depends on `community_book_requests`, books, visitor/auth ownership, fine-rate helper, Supabase roles, and `supabase_migrations.schema_migrations`. Its clean-path DROP/CREATE is history-sensitive and can disrupt consumers of the earlier result shape. Verify the `20261130000000` history row against the complete final function body/ACL and check internal plus external PostgREST clients before rollout. |
| `20261226999999_fine_alert_target_prerequisite.sql` | Prepares/validates `public.get_fine_payment_alert_targets(text)` with intermediate `TABLE(request_id text, visitor_id text)` result, postgres owner, PL/pgSQL SECURITY DEFINER, fixed `public, pg_temp` path and authenticated/service_role EXECUTE (no anon/PUBLIC). It may drop/recreate when needed. | Depends on fine schema, borrow requests, books, staff profiles, notification objects, and migration-history state. The later Dec. 27 migration restores `alerted_today`; check callers during the intermediate contract and verify exact body/ACL before accepting any existing version. |
| `20261227000001_restore_fine_alert_status_result.sql` | Replaces the same alert RPC contract with `TABLE(request_id text, visitor_id text, alerted_today boolean)`; `alerted_today` is computed from matching `due_date_notifications` rows for today's fine reminder. Restores postgres owner, security metadata, fixed path and authenticated/service_role EXECUTE. Does not change payment rows. | Depends on the intermediate Dec. 26 function, `due_date_notifications`, borrow requests, books, staff profiles, and the deployed PostgREST contract. DROP/CREATE changes OUT shape; verify current function body/ACL, alert table and all client expectations, then reload schema cache only after deployment is approved. |

### Read-only Production Evidence Export and Reconciliation

The SQL at `scripts/export-production-catalog-readonly.sql` is a single `BEGIN TRANSACTION READ ONLY` JSON catalog export. It selects Supabase migration history; PostgreSQL version; selected table/column definitions; constraints/FKs/indexes; RLS policies including `USING` and `WITH CHECK`; triggers; public function signatures/definitions/owners/security/search paths/ACLs; selected effective privileges; default ACLs; and relevant role memberships. It selects no business rows or secret values. Execute it only after the project owner independently verifies the read-only connection target. The script assumes the Supabase migration ledger exists; a missing ledger is an export failure that must be reported, not worked around.

`scripts/reconcile-migration-evidence.mjs` takes three owner-provided JSON files: migration history, the catalog export, and a manually reviewed expected-effects manifest. The expected-effects manifest pins exact catalog object snapshots by migration version and key. A missing mapping, missing object, unexpected history version/name, or changed snapshot is reported as ambiguous/conflicting. Even exact version plus snapshot matches are labeled `*_REVIEW_REQUIRED`; the tool never concludes "applied" or issues SQL. The catalog JSON alone cannot map effects to their originating migration, and the standard Supabase migration ledger does not contain SQL checksums. Do not supply an unreviewed effects manifest.

Example after the owner creates a protected libpq service entry named `shelf-readonly-production` and verifies it points to a read-only connection:

```powershell
psql -X -v ON_ERROR_STOP=1 -d service=shelf-readonly-production `
  -f scripts/export-production-catalog-readonly.sql `
  -o C:\secure-work\shelf-production-catalog.json
node scripts/reconcile-migration-evidence.mjs `
  --history C:\secure-work\shelf-production-catalog.json `
  --catalog C:\secure-work\shelf-production-catalog.json `
  --effects C:\secure-work\reviewed-expected-effects.json `
  --out C:\secure-work\migration-reconciliation.json
```

The read-only service configuration and result files stay outside the repository. The migration effect mapping still needs a human reviewer to derive canonical expected object snapshots from local SQL and approved history; this checkout does not contain verified production evidence.

The local ledger migrations explicitly revoke direct privileges from `PUBLIC`, `anon`, and `authenticated`; they do not establish one consistent service-role table ACL across all possible Supabase baselines. The release assertion therefore checks all table operations for anon/authenticated and the service-role EXECUTE grants on privileged RPCs, but deliberately does not change or assume the existing `fine_payments` service-role table ACL. Capture and review that ACL and inherited role path in the staging/production catalog before rollout; do not revoke an existing grant until actual Edge/server callers are verified.

Separate data-derived cache migrations require their own data review: `20261122000000_book_rating_aggregates.sql` backfills/upserts aggregate rows from `book_reviews`; `20261129000000_cache_popular_borrowed_book_counts.sql` locks `borrow_requests`, backfills/upserts the popular-borrow count cache, and installs its trigger. Compare source-derived expected aggregates with existing cache state and record row counts before/after in a disposable replay and production change review. `20261230000000_terminate_library_subscriptions.sql` contains deletion inside a callable RPC, not as an immediate migration-time delete; inspect callers and business retention needs before granting/invoking it.

The safe reconciliation package from the owner must include: exact remote migration versions/names; catalog exports for each relevant function (`pg_get_functiondef`, `pg_proc` metadata, ACL/effective privileges), table/column definitions, constraints/FKs/indexes, RLS/policies, triggers, default privileges, and relevant role memberships. Redact data rows and secrets. Review data-affecting SQL (notably rating aggregate rebuilds) with before/after counts and recovery plan. There is no verified production migration export in this checkout.

## Vercel/Supabase Deployment Checklist (Not Executed)

- Confirm Vercel project, production branch, deployment commit, build command/output directory, and redirect/preview configuration with the owner.
- Required frontend names visible in checked-in templates: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`; analytics names: `VITE_ANALYTICS_API_URL`, `GEMINI_API_KEY`, `GEMINI_MODEL`, `ANALYTICS_ALLOWED_ORIGINS` (confirm which are build-time versus server-only before configuring). Do not put service-role/database credentials in `VITE_*` variables.
- Edge Function code requires Supabase URL/anon/service-role settings and notification integrations including `RESEND_API_KEY`; CORS allowlists use `APP_ORIGINS` or `APP_ORIGIN`. Configure through Supabase/Vercel secret managers, not repository files. Confirm redirect URLs, email OTP templates, TOTP settings, Storage policies, and allowed origins in staging first.
- Deploy compatible database migrations before frontend code that calls new RPC contracts. Keep the legacy visitor lookup interface until external consumers are inventoried; QR Login remains retired, QR identification remains supported.
- Before production: export a recoverable backup and test restoration; verify target project ref and history; execute an approved migration plan in order with monitoring; verify PostgREST schema reload and smoke tests; then deploy frontend/Edge Functions. Roll back by disabling incompatible frontend release or deploying previous frontend while keeping additive schema; use a tested database restore only when data-loss impact is explicitly accepted. Do not assume DDL rollback restores changed records or external email effects.

## Credential Follow-Up

`.env` and `env` are staged for deletion from Git but local copies remain. Their contents were not read. Historical path metadata alone cannot establish which values were committed or whether any remain valid. Run a local, approved scanner against Git history only if it can guarantee no secret output or network upload. Then rotate applicable Supabase database/service-role/API credentials, Resend API key, Gemini/API provider key, and any other provider secrets identified by the owner; update Vercel, Supabase function secrets, and analytics hosting atomically and validate consumers. Do not rewrite Git history without separate authorization.

## Release Gates Still Required

- Fresh independent replay of all **167** migrations, then all **12** SQL assertions on isolated PostgreSQL: **NOT RUN** (Track A).
- Real Auth-issued AAL/TOTP and PostgREST authorization matrix: **NOT RUN** (Track B).
- Production migration/schema reconciliation, backup/restore verification, Vercel project/configuration inspection: **BLOCKED** pending owner-provided environment evidence and access.
- Credential exposure determination/rotation: **NEEDS REVIEW** by repository owner and credential providers.
- OPAC count consistency between environments: **SOURCE FIXED** — server-side RPCs added (security-hardened in 20270102002900); requires production deployment and verification.
- Fine-payment privacy runtime verification: **NOT RUN** — source complete (Phase 1A), Phase 1B/C pending.
- Three-role regression with real Auth/MFA: **NOT RUN** — matrix documented (3 authorization roles + anonymous), tests BLOCKED (Track B).
- Migration integrity runtime catalog verification: **NOT RUN** — 10 checks documented, tests BLOCKED (Track A/B).
- Concurrency/transaction integrity with real row locks: **NOT RUN** — 8 scenarios documented, tests BLOCKED (Track B).
- Community borrowing workflow runtime verification: **NOT RUN** — source complete (Group 16), promotion fix in 20270117000000, tests BLOCKED (Track B).
- **pg_notify consumer for community promotion:** **FIXED** — `pg_notify` calls removed in 20270117000000; synchronous promotion via `promote_next_community_request()` now invoked directly in trigger.
- **Community queue promotion design:** **RESOLVED — Option A (Synchronous Promotion)** — The trigger `update_community_book_copy_availability` now calls `promote_next_community_request()` directly within the transaction (FIFO, `FOR UPDATE` locks). No external consumer needed. The `pg_notify` calls were dead code.
- Therefore release recommendation remains **NOT READY** until those gates pass.

## Credential Exposure Findings (2026-11-17)

### Confirmed Exposed Credentials in Git History

| Commit | File | Exposed Values |
|--------|------|----------------|
| f859b6b (2026-09-02) | `.env` | `VITE_SUPABASE_URL=https://khwtfjyvawukbsvyjdux.supabase.co`, `VITE_SUPABASE_ANON_KEY=sb_publishable_60HNBPw65Q49Fyi_y-BfTQ_I2OVam53` |
| 3777811 (2026-10-24) | `.env` | Same production URL and anon key |
| 5231b33 (2026-10-24) | `.env` | Same production URL and anon key, **plus** `SUPABASE_DB_PASSWORD=[REDACTED]` |

### Currently in Working Directory (Staged for Deletion)
- `.env` — contains production URL, anon key, analytics URL, and database password
- `.env.local` — contains production URL and anon key
- `env` — contains production URL and anon key

### Credential Classification: Public vs Privileged

| Credential | Classification | Exposure Risk | Rotation Required |
|------------|----------------|---------------|-------------------|
| `VITE_SUPABASE_URL` (production) | **Public** — client-facing API endpoint | Low (designed for client exposure) | **NO** — but should point to correct project after rotation |
| `VITE_SUPABASE_ANON_KEY` (`sb_publishable_...`) | **Public** — publishable/anon key for client SDKs | Low (designed for browser exposure) | **NO** — anon key is by design public; rotation not required for git history exposure alone |
| `SUPABASE_DB_PASSWORD` (`[REDACTED]`) | **Privileged Secret** — full database access | **CRITICAL** — committed in 5231b33 | **YES — IMMEDIATE** — Supabase Dashboard → Settings → Database → "Reset database password" |
| Supabase Service Role Key | **Privileged Secret** — bypasses RLS, admin API | **CRITICAL** — not in history but may exist locally | **YES** — if ever stored locally; Supabase Dashboard → Settings → API → Regenerate |
| Vercel Environment Variables (if same values) | Mixed — URL/anon public, DB password/service role privileged | **CRITICAL** for privileged values | **YES** — update after Supabase rotation; remove any privileged secrets |
| Resend API Key | **Privileged Secret** — email sending | Medium — if used in Edge Functions | **CHECK** — rotate if exposed; Resend Dashboard → API Keys |
| Render Analytics API Key | **Privileged Secret** — analytics access | Medium | **CHECK** — rotate if configured; Render Dashboard → Environment Variables |
| Gemini/API Provider Key | **Privileged Secret** — AI provider access | Medium | **CHECK** — rotate if exposed |

> **Key Distinction:** The Supabase URL and anon/publishable key are **by design** public credentials meant for client-side use. Their exposure in git history is a hygiene issue, not a critical breach. The **database password** and **service role key** are privileged secrets that must never be committed. Rotation priority: Database password → Service role key → Other provider keys. Anon key rotation is NOT required solely due to git history exposure.

### Affected Credentials Requiring Rotation

| Credential | Provider | Rotation Required | Dashboard |
|------------|----------|-------------------|-----------|
| Supabase Anon Key (`sb_publishable_60HNBPw65Q49Fyi_y-BfTQ_I2OVam53`) | Supabase | **NO** — anon key is by design public; no rotation required for git history alone | Supabase Dashboard → Project → Settings → API |
| Supabase Service Role Key | Supabase | **YES** — if ever stored locally (not in history) | Supabase Dashboard → Project → Settings → API |
| Database Password (`[REDACTED]`) | Supabase (PostgreSQL) | **YES — IMMEDIATE** — committed in 5231b33 | Supabase Dashboard → Project → Settings → Database |
| Vercel Environment Variables | Vercel | **YES** — update URL/anon key after Supabase rotation; remove any DB password/service role keys | Vercel Dashboard → Project → Settings → Environment Variables |
| Resend API Key | Resend | **CHECK** — used by Edge Functions for email | Resend Dashboard → API Keys |
| Render Analytics API Key | Render | **CHECK** — if configured | Render Dashboard → Environment Variables |
| Gemini/API Provider Key | Provider | **CHECK** — if configured | Provider Dashboard |

### Credential Rotation Checklist for Owner

- [ ] **Supabase**: Rotate **database password** (CRITICAL) in Supabase Dashboard → Settings → Database → "Reset database password"
- [ ] **Supabase**: Rotate **service role key** (if ever stored locally) in Settings → API → "Reveal service_role key" → Regenerate
- [ ] **Vercel**: Update `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in Vercel Dashboard → Project → Settings → Environment Variables after Supabase rotation
- [ ] **Vercel**: Remove any `SUPABASE_DB_PASSWORD` or service role keys from Vercel environment variables
- [ ] **Resend**: Rotate API key if used in Edge Functions (check `supabase/functions/*/index.ts` for Resend usage)
- [ ] **Render**: Rotate analytics API credentials if configured
- [ ] **Gemini/Other Providers**: Rotate API keys if configured in analytics
- [ ] **Git History**: Consider using `git filter-repo` or BFG Repo-Cleaner to purge secrets from history (requires force-push coordination)
- [ ] **Local**: Delete `.env`, `.env.local`, `env` files from working directory; create new `.env` with local Supabase project credentials
- [ ] **Local**: Run `supabase init` and `supabase start` for local development; configure `.env` with local project values

### Important Notes
- The **Supabase URL and anon key are by design public credentials** (client-facing). Their git exposure is a hygiene issue; rotation is NOT required for the anon key solely due to git history exposure.
- The **database password (`[REDACTED]`) is a CRITICAL PRIVILEGED SECRET** — must be rotated immediately via Supabase Dashboard → Settings → Database.
- **Service role keys** were not found in git history but may exist in untracked local files — rotate if ever stored locally.
- After rotation, update all deployment environments (Vercel, local, CI/CD) with new values.
- Never commit `.env`, `.env.local`, `env`, or any `*.env` files — they are in `.gitignore`.

## Production Database Password Verification Procedure (Owner Only)

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

## Service Role Key Inventory (Source-Only)

**Purpose:** Document all consumers of `SUPABASE_SERVICE_ROLE_KEY` in the repository to guide owner verification of external secret stores.

### Edge Functions Using `SUPABASE_SERVICE_ROLE_KEY` (7/7)

| Edge Function | Usage Pattern | Purpose |
|---------------|---------------|---------|
| `send-due-date-notifications` | `Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")` | Create admin client for scheduled/manual notifications; staff AAL2 verification |
| `send-fine-reminder` | `Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")` | Admin client for fine payment reminders; staff AAL2 + branch verification |
| `send-visitor-otp` | Obfuscated: `"SUPABASE_SERVICE_ROLE_" + "KEY"` → `Deno.env.get()` | Admin client for email/QR OTP delivery; HMAC-signed OTP protection |
| `manage-staff` | `Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") \|\| ""` | Admin client for staff CRUD; superadmin AAL2 + MFA verification |
| `request-password-reset` | `Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") \|\| ""` | Admin client for password reset code generation; enumeration-resistant |
| `login-with-lockout` | `Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''` | Admin client for lockout recording/checking; fail-closed on errors |
| `visitor-qr-login` | `Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") \|\| ""` | Admin client for QR login flow; origin/rate-limit/state checks |

**All 7 Edge Functions read `SUPABASE_SERVICE_ROLE_KEY` from environment variables only. No hardcoded values found in source.**

### Repository Configuration & Documentation References

| File | Reference Type | Context |
|------|----------------|---------|
| `RELEASE_VALIDATION_RUNBOOK.md` | Rotation checklist, credential classification | Owner action items; privileged secret classification |
| `SHELF_REMAINING_BLOCKERS_OWNER_ACTIONS.md` | Blocker #2, Vercel env var cleanup | Owner verification steps |
| `SHELF_FINAL_RELEASE_READINESS.md` | Credential exposure summary, final recommendation | Status tracking |
| `SHELF_18_AREA_MASTER_CHECKLIST.md` | Next actions, Area 18 table | Owner action required |
| `SHELF_FINAL_MANUAL_QA_CHECKLIST.md` | Step 2 of owner actions | Rotation if stored locally |

**No tracked files contain a literal service role key value.** All references are to the variable name `SUPABASE_SERVICE_ROLE_KEY` or the PostgreSQL role `service_role` (which is a role identifier, not a secret).

### External Secret Stores — Owner Verification Required

| Store | Variable Name | Status | Owner Action |
|-------|---------------|--------|--------------|
| **Supabase Dashboard** (Edge Function secrets) | `SUPABASE_SERVICE_ROLE_KEY` | **REQUIRED** — 7 functions depend on it | Verify configured in each function's secrets; regenerate if ever exposed |
| **Vercel Environment Variables** | `SUPABASE_SERVICE_ROLE_KEY` | **UNKNOWN** — not in repo | Check Vercel Dashboard → Project → Settings → Environment Variables; remove if present (should not be in frontend build) |
| **CI/CD Systems** (GitHub Actions, GitLab, etc.) | `SUPABASE_SERVICE_ROLE_KEY` | **UNKNOWN** — no CI config in repo | Audit all external pipelines; rotate if stored |
| **Local Developer Machines** | `SUPABASE_SERVICE_ROLE_KEY` in `.env`, shell config, password managers | **POSSIBLE** — not in repo | Owner must audit local files, notes, password managers |
| **Team Password Managers** (1Password, Bitwarden, etc.) | `SUPABASE_SERVICE_ROLE_KEY` | **POSSIBLE** — not in repo | Owner must audit shared vaults |

### Classification Summary

| Category | Status | Evidence |
|----------|--------|----------|
| **Confirmed exposure in git history** | ✅ NONE | No literal key values in `git log -p --all` |
| **Confirmed exposure in working directory** | ✅ NONE | `.env`, `.env.local`, `env` deleted and staged; no other files contain values |
| **Possible local presence** | ⚠️ YES | Not tracked in repo; owner must verify |
| **Unknown external configuration** | ❓ YES | Vercel, CI/CD, password managers — owner must verify |

### Owner-Only Checks (Do Not Automate)

1. **Supabase Dashboard** → Settings → API → "Reveal service_role key" → Note last rotation date
2. **Supabase Dashboard** → Edge Functions → Each of 7 functions → Secrets → Verify `SUPABASE_SERVICE_ROLE_KEY` is set
3. **Vercel Dashboard** → Project → Settings → Environment Variables → Search for `SUPABASE_SERVICE_ROLE_KEY` or `service_role` → Remove if found (frontend should never have it)
4. **Local audit**: `grep -r "SUPABASE_SERVICE_ROLE_KEY" ~/` (check shell config, `.env` files, notes)
5. **Password manager audit**: Search for "Supabase", "service_role", "shelf-ilms"
6. **CI/CD audit**: Check all pipeline secrets in GitHub/GitLab/Azure/other

**Do NOT rotate the service role key automatically.** Rotation requires updating all 7 Edge Function secrets in Supabase Dashboard simultaneously. Only rotate if exposure is confirmed or owner authorizes.

---

### Credential Rotation Status: **OWNER REPORTED — VERIFICATION PENDING**
Owner reports database password reset via Supabase Dashboard. Fresh `psql` authentication test (above) **not yet performed**. All other items remain pending owner action.

## Group 12 — OPAC Count Discrepancy Verification Checklist (2026-11-17)

The following steps must be performed on the production Vercel deployment after the fix is deployed:

### Pre-deployment
- [ ] Verify Vercel environment variables `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` point to the intended production Supabase project
- [ ] Confirm migrations `20270102002800_opac_book_count_rpc.sql` AND `20270102002900_opac_book_count_rpc_fixed.sql` are applied to production Supabase project (202900 supersedes 202800)
- [ ] Verify RPC grants: `anon` and `authenticated` have EXECUTE on `get_opac_library_book_count()`, `get_opac_total_book_count()`, `get_opac_filtered_book_count()`; `authenticated` ONLY has EXECUTE on `get_opac_library_book_count_by_library(uuid)`
- [ ] Verify functions are SECURITY INVOKER (not SECURITY DEFINER) — they must respect RLS
- [ ] Verify `opac_has_library_access()` helper exists and is granted to `authenticated` only

### Post-deployment verification (on Vercel production URL)
- [ ] LandingPage displays library book count matching `SELECT count(*) FROM books WHERE book_type = 'library'` (run as anon role)
- [ ] OPACCatalog total count matches `get_opac_total_book_count()` RPC result
- [ ] OPACCatalog search/filter counts match `get_opac_filtered_book_count()` with corresponding parameters
- [ ] Anonymous user sees only library books + public personal books (per RLS)
- [ ] Authenticated visitor sees library books + public personal books + own personal books
- [ ] Sub-admin sees branch-scoped counts via `get_opac_library_book_count_by_library()` — unauthorized library queries return 42501 error
- [ ] Pagination totals in OPACCatalog are accurate (no missing/duplicate pages)
- [ ] External catalog books are fully paginated (no 1000-row truncation)
- [ ] Call number search works in OPACCatalog and matches RPC results
- [ ] Debug panel (development only) shows consistent RPC vs client-side counts

### Local development verification
- [ ] `.env` points to development Supabase project (not production)
- [ ] `.env.local` (if used) points to development Supabase project
- [ ] `supabase/config.toml` project_id matches local development project
- [ ] Local OPAC counts match local database state

## Batch 2 Source-Level Checks — 2026-11-16

- `node --test` 127/127 PASS (includes edgeFunctionSecurityContracts.test.js, finePaymentPrivacyBoundary.test.js, auth/community/security-forward regression tests).
- `deno test --allow-read supabase/functions/send-due-date-notifications/notificationSafety.test.js` 9/9 PASS.
- `npm run lint` PASS, `npm run build` PASS (existing large-chunk warning), `npm run validate:migrations` PASS.
- **Not runtime evidence:** no deployed edge-function invocation tests, no Resend/provider tests, no SQL assertion execution, no migration replay, no real Auth/TOTP/AAL2/PostgREST role-matrix, no catalog/effective-grant inspection. Treat Batch 2 edge-function changes as source-hardened only until runtime gates pass.

## Final Validation Summary (2026-11-17)

| Check | Result | Track |
|-------|--------|-------|
| Migration validation (167) | ✅ PASS (0 errors) | A |
| Node tests (199 pass, 49 skipped) | ✅ PASS | A |
| Lint | ✅ PASS | A |
| Build | ✅ PASS | A |
| Git diff --check | ✅ PASS | A |
| Environment separation guard | ✅ IMPLEMENTED | A |
| Credential exposure documented | ✅ COMPLETE | A |
| OPAC RPCs SECURITY INVOKER | ✅ VERIFIED (20270102002900) | A |
| Fine payment privacy | ✅ SOURCE COMPLETE (Phase 1A) | A |
| Transaction integrity | ✅ SOURCE COMPLETE | A |
| Three-role authorization matrix | ✅ MATRIX DOCUMENTED (tests BLOCKED) | B |
| Predictive/prescriptive analytics | ✅ SOURCE COMPLETE | A |
| Migration integrity | ✅ 167 VALIDATED | A |
| Regression tests | ✅ 199 PASSING | A |
| AAL2 policy correction | ✅ COMPLETED (Group 7) | A |
| Critical RPCs for direct access | ✅ COMPLETED (Group 8) | A |
| Concurrency test scenarios | ✅ DOCUMENTED (tests BLOCKED) | B |
| OPAC debug display | ✅ IMPLEMENTED | A |
| Community borrowing workflow | ✅ SOURCE COMPLETE (Group 16 + fix 20270117000000) | A |
| Community promotion sync fix | ✅ IMPLEMENTED (20270117000000) | A |

## Release Status: **NOT READY**

### External Verification Required
1. **Database replay (Track A)** — 167 migrations + 12 SQL assertions on isolated PostgreSQL
2. **Auth/PostgREST matrix (Track B)** — 3 authorization roles × 2 AAL levels + anonymous with real Auth tokens
3. **Production config** — Vercel/Supabase reconciliation
4. **Credential rotation** — Owner must rotate per checklist above (DB password CRITICAL, service role if stored locally)
5. **Local env fix** — Owner must configure local Supabase project credentials
6. **Fine-payment privacy runtime** — Phase 1B/C verification
7. **Three-role regression** — Real Auth/MFA test execution (Track B)
8. **Migration integrity catalog** — Runtime verification of 10 checks (Track A/B)
9. **Concurrency/transaction** — Real row lock test execution (Track B)
10. **Community borrowing workflow** — Real promotion/cancellation/expiration test execution (Track B)

See `DATABASE_REPLAY_PROCEDURE.md` and `AUTH_POSTGREST_TEST_PLAN.md` for detailed procedures.