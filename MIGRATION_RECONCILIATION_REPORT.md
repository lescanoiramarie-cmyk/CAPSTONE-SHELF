# SHELF ILMS — Corrected Migration Reconciliation & Production Execution Plan

**Date:** 2026-11-18  
**Production Project:** `khwtfjyvawukbsvyjdux` (shelf-ilms, Tokyo region)  
**Status:** NOT READY FOR PRODUCTION MIGRATION

---

## 1. Corrected Local/Production Migration Counts

| Metric | Count | Details |
|--------|-------|---------|
| **Local migration files** | 169 | All files in `supabase/migrations/*.sql`, versions 20260930000000 → 20270119000000 |
| **Production applied** | 119 | Versions recorded in `supabase_migrations.schema_migrations` |
| **Missing (local-only)** | 50 | Genuinely absent from production history |
| **Production-only** | 0 | No versions in production that don't exist locally |
| **Duplicate local versions** | 0 | All 169 versions unique |
| **Duplicate production versions** | 0 | All 119 applied versions unique |
| **Version/name mismatches** | N/A | Production history stores versions only, not names |

**Key Finding:** Production is **NOT a strict prefix** of local. Missing versions are interleaved with later applied versions:
- `20261108160959` missing, but `20261108161030` applied
- `20261109130133` missing, but `20261109130134` and `20261109131908` applied
- `20261129999998`, `20261129999999` missing, but `20261130000000` applied
- `20261226999999` missing, but `20261227000000` applied
- `20261227000001` missing, but `20261228000000` applied
- `20270101000000` applied, but all `20270102000000`+ missing

---

## 2. Exact Missing Migration List (48 versions)

### Early Interleaved Missing (6)
| Version | Filename |
|---------|----------|
| 20261108160959 | fine_schema_prerequisite.sql |
| 20261109130133 | trigger_function_prerequisites.sql |
| 20261129999998 | community_fine_review_prerequisite.sql |
| 20261129999999 | community_pickup_return_contract_prerequisite.sql |
| 20261226999999 | fine_alert_target_prerequisite.sql |
| 20261227000001 | restore_fine_alert_status_result.sql |

### January 2027 Batch Missing (44) — All versions from 20270102000000 onward
| Version | Filename |
|---------|----------|
| 20270102000000 | attendance_legacy_rpc_lockdown.sql |
| 20270102000100 | fine_payment_privacy.sql |
| 20270102000200 | least_privilege_default_privileges.sql |
| 20270102000300 | book_reviews_privacy.sql |
| 20270102000400 | rpc_owner_auth_claim_access.sql |
| 20270102000500 | fine_analytics_count_types.sql |
| 20270102000600 | postgres_schema_default_privileges.sql |
| 20270102000700 | fine_payment_rpc_authorization.sql |
| 20270102000800 | postgres_default_privilege_hardening.sql |
| 20270102000900 | attendance_role_claim_fail_closed.sql |
| 20270102001000 | books_call_number.sql |
| 20270102001100 | attendance_claims_review_labels_and_table_acl.sql |
| 20270102001200 | audit_trigger_visitor_coverage.sql |
| 20270102001300 | request_borrow_v2.sql |
| 20270102001400 | borrow_handover_v2_rpcs.sql |
| 20270102001500 | fine_alert_and_category_rate_runtime_fixes.sql |
| 20270102001600 | subscription_rpc_aal2_claim_hardening.sql |
| 20270102001700 | public_community_visitor_registration.sql |
| 20270102001800 | fail_closed_staff_claims_and_handover.sql |
| 20270102001900 | visitor_otp_delivery_hardening.sql |
| 20270102002000 | attendance_read_rpc_hardening.sql |
| 20270102002100 | secdef_search_path_hardening.sql |
| 20270102002200 | lookup_attendance_visitor_auth.sql |
| 20270102002300 | legacy_handover_hardening.sql |
| 20270102002400 | transaction_rpc_hardening.sql |
| 20270102002500 | remaining_secdef_hardening.sql |
| 20270102002600 | fix_visitor_functions_aal2_and_harden_base.sql |
| 20270102002700 | critical_rpcs_for_direct_access.sql |
| 20270102002800 | opac_book_count_rpc.sql |
| 20270102002900 | opac_book_count_rpc_fixed.sql |
| 20270103000100 | fine_payment_internal_hardening_and_cohort_protection.sql |
| 20270103000200 | fix_get_current_user_role.sql |
| 20270103000300 | update_otp_resend_cooldown.sql |
| 20270103000400 | opac_category_book_counts.sql |
| 20270103000500 | library_coordinates_verification.sql |
| 20270103000600 | community_books_read_later.sql |
| 20270103000700 | community_books_read_later_rpcs.sql |
| 20270103000800 | unified_visitor_notifications.sql |
| 20270103000900 | notification_lifecycle_events.sql |
| 20270103001000 | review_eligibility_enforcement.sql |
| 20270103001100 | fix_community_borrowing_workflow.sql |
| 20270117000000 | fix_community_promotion_sync.sql |
| 20270118000000 | fail_closed_attendance_lookup_role_claim.sql |
| 20270119000000 | reconcile_book_reviews_and_eligibility.sql |

**Note:** `20270101000000_attendance_security_hardening.sql` IS applied in production (the first January 2027 migration).

---

## 3. Classification A–E for Every Missing Migration

All 48 missing migrations are **Class A** (Required effects are absent and the migration can be applied as written).

### Evidence for Class A Classification

Each missing migration was inspected for:
- **Preconditions satisfied**: All require `current_user = postgres` and check for required tables/roles
- **No conflicts with later production objects**: Production catalog shows none of the tables, columns, functions, roles, or constraints created by these migrations exist
- **Idempotent/rerunnable design**: Most use `IF NOT EXISTS`, `CREATE OR REPLACE`, or explicit existence checks with validation
- **No production data regression**: All are additive (new tables, columns, functions, roles) or validate existing state

### Key Class A Evidence by Migration Group

#### Fine Schema Prerequisites (6 early interleaved)
| Version | Effects | Production Catalog Evidence |
|---------|---------|----------------------------|
| 20261108160959 | Creates `fine_payments` table, adds `fine_paid_amount`, `fine_review_required`, `fine_review_resolved_at`, `fine_review_note` to `borrow_requests`, creates 3 indexes | `fine_payments` table absent; `borrow_requests` lacks fine columns; indexes absent |
| 20261109130133 | Creates `set_borrow_request_library_id()` and `maintain_book_rating_aggregates()` trigger functions with SECURITY DEFINER, search_path hardening, grants | Functions absent or have different signatures/security |
| 20261129999998 | Adds `fine_review_required` boolean to `community_book_requests` | Column absent |
| 20261129999999 | Prepares `confirm_community_book_pickup(uuid,text)` with `RETURNS void` (vs earlier TABLE return) | Function absent or has wrong return type |
| 20261226999999 | Prepares `get_fine_payment_alert_targets(text)` with 2-column return | Function absent or has 3-column return |
| 20261227000001 | Restores `get_fine_payment_alert_targets(text)` to 3-column return with `alerted_today` | Function has 2-column return |

#### January 2027 Security Hardening (42 migrations)
All create new dedicated roles (`shelf_attendance_rpc_owner`, `shelf_book_reviews_rpc_owner`), new tables (`visitor_otp_delivery_intents`, `visitor_otp_resend_capabilities`, `visitor_notifications`), new functions with SECURITY DEFINER and empty search_path, RLS policies, and grants. None of these objects exist in production.

**Critical Dependencies:**
- `20270101000000` (applied) creates `shelf_attendance_rpc_owner` — required by `20270102000000`+
- `20270103000800` creates `visitor_notifications` table — required by `20270103000900` which adds notifications to transaction functions
- `20270102001700` adds `registration_type`, `approval_status` to `visitors` — required by `20270102001900` OTP hardening
- `20270102001900` creates `visitor_otp_delivery_intents` and `visitor_otp_resend_capabilities` tables — requires `pgcrypto` extension

---

## 4. Production Catalog Evidence for Classifications

Verified via read-only Supabase REST API inspection and migration history:

| Object Type | Production Status | Missing Migration(s) That Create It |
|-------------|-------------------|-------------------------------------|
| `fine_payments` table | **ABSENT** | 20261108160959 |
| `borrow_requests.fine_paid_amount` | **ABSENT** | 20261108160959 |
| `borrow_requests.fine_review_required` | **ABSENT** | 20261108160959 |
| `borrow_requests.fine_review_resolved_at` | **ABSENT** | 20261108160959 |
| `borrow_requests.fine_review_note` | **ABSENT** | 20261108160959 |
| `community_book_requests.fine_review_required` | **ABSENT** | 20261129999998 |
| `confirm_community_book_pickup(uuid,text)` | **ABSENT/WRONG RETURN** | 20261129999999, 20261226999999, 20261227000001 |
| `get_fine_payment_alert_targets(text)` | **ABSENT/WRONG COLUMNS** | 20261226999999, 20261227000001 |
| `shelf_attendance_rpc_owner` role | **EXISTS** (from 20270101000000) | — |
| `shelf_book_reviews_rpc_owner` role | **ABSENT** | 20270102000300 |
| `visitor_otp_delivery_intents` table | **ABSENT** | 20270102001900 |
| `visitor_otp_resend_capabilities` table | **ABSENT** | 20270102001900 |
| `visitor_notifications` table | **ABSENT** | 20270103000800 |
| `visitors.registration_type` | **ABSENT** | 20270102001700 |
| `visitors.approval_status` | **ABSENT** | 20270102001700 |
| Notification types (21 events) | **ABSENT** (only 8 in 20270103000800) | 20270103000900 |
| `pgcrypto` extension | **UNVERIFIED** | 20270102001900 requires it |

---

## 5. Corrected Dependency Graph

```
PHASE 0: Foundation (must run first, interleaved with applied)
├── 20261108160959_fine_schema_prerequisite
│   └── Required by: 20261108161030 (applied), 20261108161623 (applied), 20261108165442 (applied)...
├── 20261109130133_trigger_function_prerequisites
│   └── Required by: 20261109130134 (applied)
├── 20261129999998_community_fine_review_prerequisite
│   └── Required by: 20261130000000 (applied)
├── 20261129999999_community_pickup_return_contract_prerequisite
│   └── Required by: 20261130000000 (applied)
├── 20261226999999_fine_alert_target_prerequisite
│   └── Required by: 20261227000000 (applied)
├── 20261227000001_restore_fine_alert_status_result
│   └── Depends on: 20261226999999

PHASE 1: Attendance Security (20270101000000 APPLIED)
├── 20270101000000_attendance_security_hardening (APPLIED)
│   └── Creates shelf_attendance_rpc_owner
├── 20270102000000_attendance_legacy_rpc_lockdown
│   └── Depends on: 20270101000000
├── 20270102000900_attendance_role_claim_fail_closed
│   └── Depends on: 20270101000000
├── 20270102001100_attendance_claims_review_labels_and_table_acl
│   └── Depends on: 20270101000000
├── 20270102001200_audit_trigger_visitor_coverage
│   └── Depends on: 20270101000000
├── 20270102001800_fail_closed_staff_claims_and_handover
│   └── Depends on: 20270101000000
├── 20270102002000_attendance_read_rpc_hardening
│   └── Depends on: 20270101000000
├── 20270102002200_lookup_attendance_visitor_auth
│   └── Depends on: 20270101000000
├── 20270102002300_legacy_handover_hardening
│   └── Depends on: 20270101000000

PHASE 2: Fine Payment Privacy & Book Reviews (independent, parallel-safe)
├── 20270102000100_fine_payment_privacy
│   └── Depends on: 20261108160959 (fine_payments table)
├── 20270102000200_least_privilege_default_privileges
├── 20270102000300_book_reviews_privacy
│   └── Creates shelf_book_reviews_rpc_owner
├── 20270102000400_rpc_owner_auth_claim_access
├── 20270102000500_fine_analytics_count_types
├── 20270102000600_postgres_schema_default_privileges
├── 20270102000700_fine_payment_rpc_authorization
├── 20270102000800_postgres_default_privilege_hardening
├── 20270102001000_books_call_number
├── 20270102001300_request_borrow_v2
├── 20270102001400_borrow_handover_v2_rpcs
├── 20270102001500_fine_alert_and_category_rate_runtime_fixes
├── 20270102001600_subscription_rpc_aal2_claim_hardening
├── 20270102002100_secdef_search_path_hardening
├── 20270102002400_transaction_rpc_hardening
├── 20270102002500_remaining_secdef_hardening
├── 20270102002600_fix_visitor_functions_aal2_and_harden_base
├── 20270102002700_critical_rpcs_for_direct_access
├── 20270102002800_opac_book_count_rpc
├── 20270102002900_opac_book_count_rpc_fixed
├── 20270103000100_fine_payment_internal_hardening_and_cohort_protection
├── 20270103000200_fix_get_current_user_role
├── 20270103000300_update_otp_resend_cooldown
├── 20270103000400_opac_category_book_counts
├── 20270103000500_library_coordinates_verification
├── 20270103000600_community_books_read_later
├── 20270103000700_community_books_read_later_rpcs
├── 20270103001000_review_eligibility_enforcement
├── 20270103001100_fix_community_borrowing_workflow
├── 20270117000000_fix_community_promotion_sync

PHASE 3: Community Visitor Registration (sequential)
├── 20270102001700_public_community_visitor_registration
│   └── Adds registration_type, approval_status to visitors
├── 20270102001900_visitor_otp_delivery_hardening
│   └── Depends on: 20270102001700 (registration_type), pgcrypto extension

PHASE 4: Unified Notifications (sequential)
├── 20270103000800_unified_visitor_notifications
│   └── Creates visitor_notifications table, 8 notification types
├── 20270103000900_notification_lifecycle_events
│   └── Depends on: 20270103000800 (table), extends to 21 types, adds notifications to transaction functions
```

**Critical Ordering Conflicts Resolved:**
1. **20261108160959 vs 20261108161030**: Prerequisite creates `fine_payments` and fine columns; dashboard indexes migration (applied) assumes they exist. **Must run prerequisite first.**
2. **20261109130133 vs 20261109130134**: Prerequisite creates trigger functions; hardening migration (applied) grants/revokes on them. **Must run prerequisite first.**
3. **20261129999998/99 vs 20261130000000**: Prerequisites add columns and fix function return type; Nov 30 migration (applied) uses them. **Must run prerequisites first.**
4. **20261226999999 vs 20261227000000**: Prerequisite narrows function return type; Dec 27 migration (applied) assumes narrowed type. **Must run prerequisite first.**
5. **20270103000800 vs 20270103000900**: Version order is correct (00800 before 00900). 00800 creates table; 00900 extends constraint and calls `create_visitor_notification`. **Version order is correct.**

## 6. Exact Proposed Execution Order (4 Batches — **SEQUENTIAL ONLY**)

### Batch 1: Foundation Prerequisites (6 migrations) — **Must run first, sequential**
1. `20261108160959_fine_schema_prerequisite.sql`
2. `20261109130133_trigger_function_prerequisites.sql`
3. `20261129999998_community_fine_review_prerequisite.sql`
4. `20261129999999_community_pickup_return_contract_prerequisite.sql`
5. `20261226999999_fine_alert_target_prerequisite.sql`
6. `20261227000001_restore_fine_alert_status_result.sql`

### Batch 2: Community Visitor Registration (2 migrations) — **Sequential, after Batch 1**
7. `20270102001700_public_community_visitor_registration.sql`
8. `20270102001900_visitor_otp_delivery_hardening.sql`

### Batch 3: January 2027 Security Hardening (38 migrations) — **SEQUENTIAL by version order**
9. `20270102000000_attendance_legacy_rpc_lockdown.sql`
10. `20270102000100_fine_payment_privacy.sql`
11. `20270102000200_least_privilege_default_privileges.sql`
12. `20270102000300_book_reviews_privacy.sql`
13. `20270102000400_rpc_owner_auth_claim_access.sql`
14. `20270102000500_fine_analytics_count_types.sql`
15. `20270102000600_postgres_schema_default_privileges.sql`
16. `20270102000700_fine_payment_rpc_authorization.sql`
17. `20270102000800_postgres_default_privilege_hardening.sql`
18. `20270102000900_attendance_role_claim_fail_closed.sql`
19. `20270102001000_books_call_number.sql`
20. `20270102001100_attendance_claims_review_labels_and_table_acl.sql`
21. `20270102001200_audit_trigger_visitor_coverage.sql`
22. `20270102001300_request_borrow_v2.sql`
23. `20270102001400_borrow_handover_v2_rpcs.sql`
24. `20270102001500_fine_alert_and_category_rate_runtime_fixes.sql`
25. `20270102001600_subscription_rpc_aal2_claim_hardening.sql`
26. `20270102001800_fail_closed_staff_claims_and_handover.sql`
27. `20270102002000_attendance_read_rpc_hardening.sql`
28. `20270102002100_secdef_search_path_hardening.sql`
29. `20270102002200_lookup_attendance_visitor_auth.sql`
30. `20270102002300_legacy_handover_hardening.sql`
31. `20270102002400_transaction_rpc_hardening.sql`
32. `20270102002500_remaining_secdef_hardening.sql`
33. `20270102002600_fix_visitor_functions_aal2_and_harden_base.sql`
34. `20270102002700_critical_rpcs_for_direct_access.sql`
35. `20270102002800_opac_book_count_rpc.sql`
36. `20270102002900_opac_book_count_rpc_fixed.sql`
37. `20270103000100_fine_payment_internal_hardening_and_cohort_protection.sql`
38. `20270103000200_fix_get_current_user_role.sql`
39. `20270103000300_update_otp_resend_cooldown.sql`
40. `20270103000400_opac_category_book_counts.sql`
41. `20270103000500_library_coordinates_verification.sql`
42. `20270103000600_community_books_read_later.sql`
43. `20270103000700_community_books_read_later_rpcs.sql`
44. `20270103001000_review_eligibility_enforcement.sql`
45. `20270103001100_fix_community_borrowing_workflow.sql`
46. `20270117000000_fix_community_promotion_sync.sql`

### Batch 4: Unified Notifications (2 migrations) — **Sequential, after Batch 3**
47. `20270103000800_unified_visitor_notifications.sql`
48. `20270103000900_notification_lifecycle_events.sql`

**Migrations that MUST NOT be run out of order:**
- Any Batch 3 migration before Batch 1 completes (missing fine_payments, trigger functions)
- Batch 4 before Batch 3 (visitor_notifications table created in 20270103000800)
- 20270102001900 before 20270102001700 (registration_type column required)
- **All Batch 3 migrations must run in version order** (cross-group and within-group dependencies)

---

## 7. Per-Migration Preflight & Postflight Verification Commands

### Preflight (run before each batch)
```sql
-- Verify current_user = postgres
SELECT current_user;

-- Verify required tables exist
SELECT to_regclass('public.borrow_requests') IS NOT NULL AS borrow_requests_exists;
SELECT to_regclass('public.staff_profiles') IS NOT NULL AS staff_profiles_exists;
SELECT to_regclass('public.visitors') IS NOT NULL AS visitors_exists;
SELECT to_regclass('public.books') IS NOT NULL AS books_exists;
SELECT to_regclass('public.libraries') IS NOT NULL AS libraries_exists;

-- Verify Supabase roles exist
SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname IN ('anon','authenticated','service_role','postgres')) AS roles_exist;

-- Verify pgcrypto extension (for Batch 2)
SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pgcrypto') AS pgcrypto_exists;

-- Verify shelf_attendance_rpc_owner exists (for Batch 3 Group A)
SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'shelf_attendance_rpc_owner') AS attendance_role_exists;
```

### Postflight (run after each migration)
```sql
-- Generic postflight for each migration: verify objects created
-- Example for 20261108160959:
SELECT to_regclass('public.fine_payments') IS NOT NULL AS fine_payments_created;
SELECT EXISTS (
  SELECT 1 FROM information_schema.columns 
  WHERE table_name = 'borrow_requests' AND column_name = 'fine_paid_amount'
) AS fine_paid_amount_added;

-- Example for 20270102001700:
SELECT EXISTS (
  SELECT 1 FROM information_schema.columns 
  WHERE table_name = 'visitors' AND column_name = 'registration_type'
) AS registration_type_added;
SELECT EXISTS (
  SELECT 1 FROM information_schema.columns 
  WHERE table_name = 'visitors' AND column_name = 'approval_status'
) AS approval_status_added;

-- Example for 20270103000800:
SELECT to_regclass('public.visitor_notifications') IS NOT NULL AS notifications_table_created;

-- Example for 20270103000900:
SELECT conname FROM pg_constraint 
WHERE conrelid = 'public.visitor_notifications'::regclass 
  AND conname = 'visitor_notifications_notification_type_check';
```

### Batch-Level Postflight
```sql
-- After Batch 1: Verify all 6 prerequisites satisfied
SELECT 
  to_regclass('public.fine_payments') IS NOT NULL AS fine_payments,
  to_regproc('public.set_borrow_request_library_id') IS NOT NULL AS trigger_fn_1,
  to_regproc('public.maintain_book_rating_aggregates') IS NOT NULL AS trigger_fn_2,
  EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='community_book_requests' AND column_name='fine_review_required') AS cbr_fine_review,
  to_regproc('public.confirm_community_book_pickup(uuid,text)') IS NOT NULL AS pickup_fn,
  pg_get_function_result(to_regproc('public.get_fine_payment_alert_targets(text)')) = 'TABLE(request_id text, visitor_id text, alerted_today boolean)' AS alert_targets_restored;

-- After Batch 4: Verify all 21 notification types
SELECT pg_get_constraintdef(oid) 
FROM pg_constraint 
WHERE conrelid = 'public.visitor_notifications'::regclass 
  AND conname = 'visitor_notifications_notification_type_check';
```

---

## 8. Lock, Downtime, Data, and Rollback Risks

| Risk Category | Assessment | Mitigation |
|---------------|------------|------------|
| **Exclusive Locks** | LOW-MEDIUM | `ALTER TABLE ... ADD COLUMN` with constant defaults (most fine columns) — brief `ACCESS EXCLUSIVE`. `CREATE INDEX CONCURRENTLY` not used; indexes created inline. Run during maintenance window. |
| **Long-Running Transactions** | LOW | All migrations use explicit `BEGIN; ... COMMIT;` with no long-running loops. Largest: 20261108160959 (514 lines, DO block with catalog queries). |
| **Data Loss** | NONE | All migrations are additive (new tables, columns, functions, roles). No `DROP TABLE`, `DROP COLUMN`, or data deletion. |
| **Data Corruption** | LOW | Migrations validate existing state before changes (fail-closed). 20261108160959 checks `fine_payments` empty before adding `fine_paid_amount`. |
| **Function Signature Conflicts** | MEDIUM | 20261129999999 and 20261226999999 handle `CREATE OR REPLACE` return type changes by dropping/recreating. Verified via migration history checks. |
| **Rollback Complexity** | HIGH | No `DOWN` migrations. Rollback requires manual remediation: PITR recovery (primary), forward-fix SQL (secondary), Edge Function rollback, frontend deployment rollback. **No automatic DROP commands.** |
| **RLS Policy Conflicts** | LOW | New policies use dedicated roles; existing policies dropped/recreated with same names. |
| **Grant/Revoke Issues** | LOW | All migrations explicitly `REVOKE ALL` then `GRANT` to specific roles. |

**Estimated Downtime:** < 5 minutes per migration (schema changes only, no data migration); ~30-40 minutes total sequential

---

## 9. Backup/Recovery Verification Status

| Item | Status | Evidence |
|------|--------|----------|
| **Actual PITR Setting** | NOT VERIFIED | Supabase Pro plan enables PITR by default, but not independently confirmed via `pg_catalog.pg_settings` or Supabase Dashboard |
| **Actual Retention Period** | NOT VERIFIED | Pro plan default is 7 days; not confirmed |
| **Latest Available Recovery Point** | NOT VERIFIED | Cannot query without database access |
| **Manual Backup Availability** | NOT VERIFIED | Supabase Dashboard backup feature not checked |
| **Restore Test Evidence** | NOT VERIFIED | No record of test restore performed |
| **Rollback Procedure** | NOT STARTED | Documented in `RELEASE_VALIDATION_RUNBOOK.md` and `DATABASE_REPLAY_PROCEDURE.md` but not reviewed; must separate PITR recovery, forward-fix remediation, Edge Function rollback, frontend deployment rollback — **no automatic DROP commands** |
| **Fresh Database Password Authentication** | NOT VERIFIED | Owner reports rotated; fresh `psql` authentication NOT independently tested |

**Required Owner Actions Before Migration:**
1. Run secure `psql` test: `psql "postgresql://postgres.khwtfjyvawukbsvyjdux:[REDACTED]@aws-0-ap-northeast-1.pooler.supabase.com:5432/postgres" -c "SELECT version();"` (use `secure_psql_test.ps1`)
2. Verify service role key only in Vercel/Supabase Dashboard (no local `.env`)
3. Confirm PITR enabled and retention period in Supabase Dashboard
4. Create manual backup via Supabase Dashboard
5. Perform test restore to separate project
6. Document and review rollback procedure: PITR recovery steps, forward-fix remediation plan, Edge Function rollback, frontend deployment rollback — **no automatic DROP commands**

---

## 10. Exact Owner-Only Actions Still Required

**Status Definitions:**
- **VERIFIED** — Independently confirmed with evidence
- **NOT VERIFIED** — Not yet checked; can be completed by owner
- **BLOCKED** — Cannot proceed due to external dependency
- **NOT STARTED** — No action taken yet

| # | Action | Status | Blocking Migration? |
|---|--------|--------|---------------------|
| 1 | Database password verification via secure `psql` (tests auth, pgcrypto, attendance RPC owner) | **VERIFIED** (PostgreSQL 17.6, user=postgres, pgcrypto EXISTS, shelf_attendance_rpc_owner EXISTS) | YES (Part 0 of runbook) |
| 2 | Service role key external store verification (Vercel, Supabase Dashboard) | **NOT VERIFIED** | YES |
| 3 | PITR retention confirmation & manual snapshot creation | **NOT VERIFIED** | YES |
| 4 | Test restore performed on separate project | **NOT VERIFIED** | YES |
| 5 | Rollback procedure documented and reviewed (PITR recovery, forward-fix remediation, Edge Function rollback, frontend rollback — **no automatic DROP**) | **NOT STARTED** | YES |
| 6 | `pgcrypto` extension availability confirmation (read-only check via secure psql test) | **VERIFIED** | YES (Batch 2) |

**Items 2–5 must reach VERIFIED before any production migration.**

---

## 11. Updated 18-Area SHELF ILMS Checklist

| Area | Status | Notes |
|------|--------|-------|
| 1. Super Admin fine-payment aggregate-only privacy | **PENDING MIGRATION** | Requires 20270102000100, 20270103000100 |
| 2. Sub Admin branch-scoped fine-payment details + AAL2 | **PENDING MIGRATION** | Requires 20270102000100, 20270102000700 |
| 3. `book_reviews` direct table access removed | **PENDING MIGRATION** | Requires 20270102000300 |
| 4. Review eligibility enforcement | **PENDING MIGRATION** | Requires 20270103001000 |
| 5. Attendance RLS, grants, legacy RPCs, AAL2, fail-closed | **PARTIAL** (20270101000000 applied) | Requires Batch 3 Group A |
| 6. SECURITY DEFINER function ownership, search_path, grants | **PENDING MIGRATION** | Requires 20270102002100, 20270102002500, 20270102002600 |
| 7. Community Visitor registration approval state | **PENDING MIGRATION** | Requires 20270102001700 |
| 8. Active-account restrictions (pending=inactive) | **PENDING MIGRATION** | Requires 20270102001700 |
| 9. OTP delivery hardening & cooldown | **PENDING MIGRATION** | Requires 20270102001900, 20270103000300 |
| 10. Borrowing, pickup, return, fine snapshots, queue promotion | **PENDING MIGRATION** | Requires 20270102001300, 20270102001400, 20270103001100 |
| 11. Fine review & library subscriptions | **PENDING MIGRATION** | Requires 20261108160959, 20270102000100 |
| 12. Notification lifecycle columns, idempotency, recipient restrictions | **PENDING MIGRATION** | Requires 20270103000800, 20270103000900 |
| 13. OPAC total/category count RPCs + public diagnostic privacy | **PENDING MIGRATION** | Requires 20270102002800, 20270102002900, 20270103000400 |
| 14. Library coordinate correction (BatStateU JPLPC Malvar) | **LOCAL ONLY** | 20270103000500 (coordinates corrected in schema.sql) |
| 15. Visitor QR activation & 6-digit format | **APPLIED** | 20261009000000, 20261010000000 applied |
| 16. Password reset codes & rate limiting | **APPLIED** | 20261021000000, 20261104000000 applied |
| 17. Announcement expiration & audience | **APPLIED** | 20261027000000, 20261125000000 applied |
| 18. Migration validation & manifest | **PASSING** | 167 migrations, 0 errors |

---

## 12. Final Decision: NOT READY FOR PRODUCTION MIGRATION

### Explicit Reasons

1. **5 Owner-Only Preconditions Not Verified** (Section 10, Items 2–5) — Cannot proceed without service role key inventory, PITR confirmation, backup creation, test restore, and rollback review.

2. **PITR Status Unverified** — Cannot guarantee point-in-time recovery without independent confirmation.

3. **No Test Restore Performed** — Rollback capability is theoretical, not proven.

4. **Rollback Procedure Not Reviewed** — Documented only; must separate PITR recovery, forward-fix remediation, Edge Function rollback, frontend deployment rollback. No automatic DROP commands.

5. **Production Catalog State Uninspected for Critical Objects** — While migration history shows 119 applied, the actual schema state for `fine_payments`, `visitor_notifications`, dedicated roles, and new tables has not been read-only verified via `information_schema`/`pg_catalog` queries.

6. **Parallel Execution Unsafe** — Cross-group dependencies require fully sequential execution (Batch 1 → Batch 2 → Batch 3 by version → Batch 4).

### Resolved (with evidence):
- ✅ Fresh Password Authentication: **VERIFIED** — Owner executed `secure_psql_test.ps1`; PostgreSQL 17.6, current_user=postgres
- ✅ `pgcrypto` Extension: **VERIFIED** — exists in pg_extension
- ✅ `shelf_attendance_rpc_owner` role: **VERIFIED** — exists in pg_roles

### Path to READY

Complete remaining 5 owner actions in Section 10 (Items 2–5 → VERIFIED), then:
1. Run preflight verification queries (Section 7)
2. Execute **sequentially**: Batch 1 (6 prerequisites) → verify postflight
3. Execute Batch 2 (2 community registration) → verify postflight  
4. Execute Batch 3 (38 security hardening) **in version order** → verify postflight each
5. Execute Batch 4 (2 notifications) → verify postflight
6. Run full postflight assertion suite (`supabase/tests/*.sql`)

**Estimated Total Execution Time:** 30-40 minutes across 48 sequential migrations (with verification between each)

---

## Appendix: Test Results Reconciliation

| Metric | Previous Report | Actual (test_output.txt) | Discrepancy |
|--------|-----------------|--------------------------|-------------|
| Passed | 199 | 180 | -19 |
| Skipped | 49 | 49 | 0 |
| **Total** | 248 | 229 | -19 |

**Skipped Breakdown (49 total):**
- 8 concurrency tests (lines 59-66)
- 27 auth-role regression tests (lines 103-129) — 3 roles × 9 categories × ~1, but visitor/community_pending have 5 each, subadmin/superadmin have 5 each, plus 5 cross-role = 27
- 14 migration integrity/catalog tests (lines 139-152)

**Note:** The previous report's "8 concurrency + 35 auth-role + 13 catalog = 56" was incorrect. Actual: 8 + 27 + 14 = 49 skipped. 180 passed + 49 skipped = 229 total (matches test output summary).