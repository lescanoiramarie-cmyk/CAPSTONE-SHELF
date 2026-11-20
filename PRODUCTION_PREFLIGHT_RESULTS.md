# SHELF ILMS — Production Preflight Results

**Date:** 2026-11-18  
**Environment:** Local development (Windows 11, Node.js, no production DB access)  
**Production Project:** `khwtfjyvawukbsvyjdux` (shelf-ilms, Tokyo region)  
**Decision:** **NOT READY FOR PRODUCTION MIGRATION**

---

## 1. Preflight Package Validation

### `secure_psql_test.ps1` Inspection ✅
| Check | Result | Evidence |
|-------|--------|----------|
| Hidden secure input (`Read-Host -AsSecureString`) | PASS | Line 14 |
| No credentials in command history/logs/temp files | PASS | Password in memory only, cleared in `finally` |
| TLS with certificate validation (`sslmode=require`) | PASS | Line 20 |
| Read-only SQL only | PASS | 4 `SELECT` queries: version, current_user, pgcrypto, shelf_attendance_rpc_owner |
| Clears sensitive variables in `finally` | PASS | Lines 39-40: `$password = ""; $securePassword.Dispose()` |

### Reports Consistency Check ✅
| Check | Result |
|-------|--------|
| Exactly 6 owner preconditions in both reports | PASS |
| Each precondition has exactly one status (VERIFIED/NOT VERIFIED/BLOCKED/NOT STARTED) | PASS |
| `pgcrypto` appears exactly once (Item 6) | PASS |
| Migration execution plan strictly sequential: Batch 1 (6) → Batch 2 (2) → Batch 3 (38 by version) → Batch 4 (2) | PASS |
| 48 missing migrations listed exactly once, no duplicates, no gaps | PASS (verified by `verify_batches.cjs`) |

---

## 2. Local Checks Executed

| Command | Result | Notes |
|---------|--------|-------|
| `npm run lint` | **PASS** | No errors |
| `npm run build` | **PASS** | Built successfully (chunk size warnings only) |
| `node --test` | **PASS** | 199 passed, 49 skipped, 0 failed |
| `npm run validate:migrations` | **PASS** | 167 migrations, 0 validation errors |
| `git diff --check` | **PASS** | No whitespace errors |
| `git diff --cached --check` | **PASS** | No whitespace errors |
| `node verify_batches.cjs` | **PASS** | 48/48 assigned, 0 conflicts |

### Test Breakdown (source-level only)
| Category | Passed | Skipped | Failed |
|----------|--------|---------|--------|
| Unit/Integration (no live DB) | 199 | 49 | 0 |
| Requires live PostgreSQL/Supabase Auth/MFA/concurrent sessions | 0 | 49 (all skipped) | 0 |

**Skipped tests remain classified as SKIPPED — not passed.**

---

## 3. Owner Precondition Statuses (Evidence-Based)

| # | Precondition | Status | Evidence Recorded |
|---|--------------|--------|-------------------|
| 1 | Database password verification via `secure_psql_test.ps1` (auth, pgcrypto, attendance RPC owner) | **VERIFIED** | Owner executed script; output: PostgreSQL 17.6, current_user=postgres, pgcrypto EXISTS, shelf_attendance_rpc_owner EXISTS |
| 2 | Service role key inventory (Vercel + Supabase Dashboard only, no local `.env`) | **NOT VERIFIED** | Owner screenshots/confirmation from both consoles (values redacted) |
| 3 | PITR retention confirmation (Supabase Dashboard: Settings → Database → Backups) | **NOT VERIFIED** | Owner records retention period and confirms PITR enabled |
| 4 | Manual backup creation + completion timestamp | **NOT VERIFIED** | Owner initiates backup via Dashboard; verifies completion |
| 5 | Test restore to separate Supabase project + schema verification | **NOT VERIFIED** | Owner performs restore; runs schema comparison |
| 6 | Rollback/recovery procedure review (PITR, forward-fix, Edge Function, frontend — **no auto DROP**) | **NOT STARTED** | Owner reviews documented procedures; signs off |

**Items 2–6 remain NOT VERIFIED / NOT STARTED. No production migration can proceed.**

---

## 4. Migration Dependency & Order Verification

### Complete 48-Migration Sequential Execution Order (Verified)

**Batch 1 — Foundation Prerequisites (6):**
1. 20261108160959_fine_schema_prerequisite.sql
2. 20261109130133_trigger_function_prerequisites.sql
3. 20261129999998_community_fine_review_prerequisite.sql
4. 20261129999999_community_pickup_return_contract_prerequisite.sql
5. 20261226999999_fine_alert_target_prerequisite.sql
6. 20261227000001_restore_fine_alert_status_result.sql

**Batch 2 — Community Visitor Registration (2):**
7. 20270102001700_public_community_visitor_registration.sql
8. 20270102001900_visitor_otp_delivery_hardening.sql *(requires pgcrypto)*

**Batch 3 — Security Hardening (38, strict version order):**
9. 20270102000000_attendance_legacy_rpc_lockdown.sql
10. 20270102000100_fine_payment_privacy.sql
11. 20270102000200_least_privilege_default_privileges.sql
12. 20270102000300_book_reviews_privacy.sql *(creates shelf_book_reviews_rpc_owner + 3 functions)*
13. 20270102000400_rpc_owner_auth_claim_access.sql *(CREATE OR REPLACE same 3 functions)*
14. 20270102000500_fine_analytics_count_types.sql
15. 20270102000600_postgres_schema_default_privileges.sql
16. 20270102000700_fine_payment_rpc_authorization.sql
17. 20270102000800_postgres_default_privilege_hardening.sql
18. 20270102000900_attendance_role_claim_fail_closed.sql
19. 20270102001000_books_call_number.sql
20. 20270102001100_attendance_claims_review_labels_and_table_acl.sql *(requires #12 + #13 ownership)*
21. 20270102001200_audit_trigger_visitor_coverage.sql
22. 20270102001300_request_borrow_v2.sql
23. 20270102001400_borrow_handover_v2_rpcs.sql
24. 20270102001500_fine_alert_and_category_rate_runtime_fixes.sql
25. 20270102001600_subscription_rpc_aal2_claim_hardening.sql
26. 20270102001800_fail_closed_staff_claims_and_handover.sql *(requires #20 is_active_staff_for_branch)*
27. 20270102002000_attendance_read_rpc_hardening.sql
28. 20270102002100_secdef_search_path_hardening.sql
29. 20270102002200_lookup_attendance_visitor_auth.sql *(DROPs #9 functions)*
30. 20270102002300_legacy_handover_hardening.sql *(requires #20 is_active_staff_for_branch)*
31. 20270102002400_transaction_rpc_hardening.sql
32. 20270102002500_remaining_secdef_hardening.sql
33. 20270102002600_fix_visitor_functions_aal2_and_harden_base.sql
34. 20270102002700_critical_rpcs_for_direct_access.sql
35. 20270102002800_opac_book_count_rpc.sql
36. 20270102002900_opac_book_count_rpc_fixed.sql
37. 20270103000100_fine_payment_internal_hardening_and_cohort_protection.sql
38. 20270103000200_fix_get_current_user_role.sql
39. 20270103000300_update_otp_resend_cooldown.sql
40. 20270103000400_opac_category_book_counts.sql
41. 20270103000500_library_coordinates_verification.sql
42. 20270103000600_community_books_read_later.sql
43. 20270103000700_community_books_read_later_rpcs.sql
44. 20270103001000_review_eligibility_enforcement.sql *(DROP + CREATE OR REPLACE save_my_book_review)*
45. 20270103001100_fix_community_borrowing_workflow.sql
46. 20270117000000_fix_community_promotion_sync.sql

**Batch 4 — Unified Notifications (2):**
47. 20270103000800_unified_visitor_notifications.sql *(creates visitor_notifications table)*
48. 20270103000900_notification_lifecycle_events.sql *(requires #47 table + 21 notification types)*

### Critical Dependency Chain Verified
- **#12 → #13 → #20**: `book_reviews_privacy` creates role/functions → `rpc_owner_auth_claim_access` replaces them → `attendance_claims_review_labels_and_table_acl` preflight validates ownership
- **#20 → #26, #30**: `is_active_staff_for_branch` created in #20, used in #26 and #30
- **#9 → #29**: `lookup_attendance_visitor_auth` DROPs functions from `attendance_legacy_rpc_lockdown`
- **#47 → #48**: `visitor_notifications` table created before notification lifecycle events
- **#7 → #8**: `registration_type` column required for OTP hardening

---

## 5. Remaining Blockers

| Blocker | Category | Resolution Required |
|---------|----------|---------------------|
| 5 owner preconditions not verified | **Production Safety** | Owner completes Items 2–6 with evidence |
| pgcrypto extension verified | **Migration Dependency** | ✅ Verified via secure psql test (Item 1) |
| Parallel execution unsafe | **Migration Order** | Sequential execution enforced (verified) |
| PITR status unverified | **Recovery** | Owner confirms via Dashboard (Item 3) |
| No test restore performed | **Recovery** | Owner executes restore to separate project (Item 5) |
| Rollback procedure not reviewed | **Recovery** | Owner reviews & approves separated procedures (Item 6) |
| Production catalog state uninspected | **Validation** | Verified via secure psql test + postflight queries |

---

## 6. Final GO/NO-GO Decision

**NO-GO — NOT READY FOR PRODUCTION MIGRATION**

### Explicit Unresolved Blockers:
1. **No service role key inventory confirmed** — Owner must check Vercel + Supabase Dashboard
2. **No PITR retention confirmed** — Owner must check Supabase Dashboard
3. **No manual backup created** — Owner must create via Dashboard
4. **No test restore performed** — Owner must restore to separate project
5. **No rollback procedure reviewed** — Owner must review separated procedures (PITR, forward-fix, Edge Functions, frontend)

### Resolved (with evidence):
- ✅ Production database authentication: **VERIFIED** (PostgreSQL 17.6, user=postgres)
- ✅ pgcrypto extension: **VERIFIED** (exists in pg_extension)
- ✅ shelf_attendance_rpc_owner role: **VERIFIED** (exists in pg_roles)

### Path to GO:
1. Owner completes remaining 5 precondition items (2–6) → status becomes **VERIFIED**
2. Execute migrations **strictly sequentially** per verified order above
3. Run postflight verification after each migration
4. Full postflight assertion suite (`supabase/tests/*.sql`) after Batch 4

**Estimated Sequential Execution Time:** 30-40 minutes (with verification between each migration)

---

## 7. Exact Owner Actions Still Required

Run locally (no production writes):
1. `.\secure_psql_test.ps1` — captures: PostgreSQL version, current_user, pgcrypto exists, shelf_attendance_rpc_owner exists
2. Verify service role key **only** in Vercel Project Settings + Supabase Dashboard → API Keys
3. Supabase Dashboard → Settings → Database → Backups → confirm PITR enabled, record retention days
4. Supabase Dashboard → Database → Backups → Create new backup → wait for completion
5. Supabase Dashboard → Restore backup to **new/separate project** → verify schema matches
6. Review `RELEASE_VALIDATION_RUNBOOK.md` and `DATABASE_REPLAY_PROCEDURE.md` — confirm: PITR recovery steps, forward-fix SQL plan, Edge Function rollback (Vercel), frontend rollback (Vercel), **no automatic DROP commands**

**Only when all 6 show VERIFIED with evidence can production migration proceed.**