# SHELF ILMS — Remaining Owner Preflight Checklist (Items 2–6)

**Prerequisite:** Items 1 (DB auth) and pgcrypto are **VERIFIED**.
Run each item independently. Record evidence (screenshot/note with values redacted).
Do not change production settings or secrets.

---

## Item 2: Service-Role Key Inventory

**Where:**
- Vercel → Project Settings → Environment Variables
- Supabase Dashboard → Project `khwtfjyvawukbsvyjdux` → Settings → API Keys

**Inspect:**
- [ ] Service role key exists in Vercel (production preview/production envs)
- [ ] Service role key exists in Supabase Dashboard (no extra keys)
- [ ] No service role key in local `.env`, `.env.local`, `.env.production`, or any repo file
- [ ] No anon key confusion (anon key is public; service role is secret)

**Evidence to record:**
- Screenshot of Vercel env vars (value redacted to `sk-***`)
- Screenshot of Supabase API Keys page (value redacted)
- Confirmation: "No local service role key files found"

---

## Item 3: PITR Retention & Recovery Availability

**Where:** Supabase Dashboard → Project `khwtfjyvawukbsvyjdux` → Settings → Database → Backups

**Inspect:**
- [ ] Point-in-Time Recovery (PITR) shows **Enabled**
- [ ] Retention period: record exact days (default 7 on Pro)
- [ ] "Earliest recovery point" timestamp shown and recent
- [ ] Download/export of backup history available

**Evidence to record:**
- Screenshot of Backups page showing PITR: Enabled
- Retention period: `___` days
- Earliest recovery point: `___` (timestamp)

---

## Item 4: Manual Production Backup (Supabase Dashboard)

**Where:** Supabase Dashboard → Project `khwtfjyvawukbsvyjdux` → Database → Backups → **Create backup**

**Inspect:**
- [ ] Click "Create backup" → wait for completion (status: Completed)
- [ ] Backup timestamp recorded
- [ ] Backup size noted
- [ ] Backup appears in history list

**Evidence to record:**
- Screenshot of completed backup with timestamp
- Backup ID/timestamp: `___`

**Status:** FAILED; retry pending (previous attempt did not complete)

---

## Item 5: Test Restore to Separate Recovery Target

**Where:** Supabase Dashboard → New Project (separate org or same org, different name) → Restore from backup

**Steps:**
1. Create new Supabase project (e.g., `shelf-ilms-recovery-test`)
2. In new project: Settings → Database → Backups → Restore
3. Select backup from Item 4
4. Wait for restore completion
5. Run `production_catalog_reconciliation.sql` on restored project
6. Compare schema with production (tables, columns, functions, constraints, RLS, policies, grants)

**Inspect:**
- [ ] Restore completes without error
- [ ] Schema matches production (no missing tables/columns/functions)
- [ ] Migration history (`supabase_migrations.schema_migrations`) matches
- [ ] Critical objects present (see Section 15 of reconciliation SQL)

**Evidence to record:**
- Screenshot of restore completion
- Schema comparison result: PASS / FAIL (list discrepancies if any)

**Status:** PENDING (requires Item 4 completion first)

---

## Item 6: Rollback/Recovery Procedure Review

**Documents to review:**
- `RELEASE_VALIDATION_RUNBOOK.md` (Parts 0–5, rollback section)
- `DATABASE_REPLAY_PROCEDURE.md`

**Review each layer:**

| Layer | Procedure | Verified? |
|-------|-----------|-----------|
| **Database (PITR)** | Restore to timestamp before migration start | [ ] |
| **Database (Forward-fix)** | SQL scripts to reverse specific migration effects (no auto DROP) | [ ] |
| **Edge Functions** | Vercel → Deployments → Rollback to previous version | [ ] |
| **Frontend** | Vercel → Deployments → Rollback to previous version | [ ] |

**Confirm:**
- [ ] No procedure uses automatic `DROP` on production objects
- [ ] Forward-fix SQL reviewed for each batch (reverse order)
- [ ] Owner signs off: "Rollback procedures reviewed and approved"

**Evidence to record:**
- Signed confirmation (name/date)
- Any gaps noted

**Status:** PENDING

---

## Summary

| Item | Status | Evidence Recorded |
|------|--------|-------------------|
| 1. DB Authentication | ✅ VERIFIED | PostgreSQL 17.6, user=postgres, pgcrypto EXISTS, shelf_attendance_rpc_owner EXISTS |
| 2. Service-Role Key Inventory | ☐ NOT VERIFIED | |
| 3. PITR Retention | ☐ NOT VERIFIED | |
| 4. Manual Production Backup | ❌ FAILED; RETRY PENDING | |
| 5. Test Restore | ☐ PENDING (requires Item 4) | |
| 6. Rollback Review | ☐ NOT STARTED | |

**All Items 2–6 must reach VERIFIED before production migration.**

---

## Next Safe Action

After Items 2–6 are VERIFIED:
1. Run `production_catalog_reconciliation.sql` on production (read-only)
2. Confirm no unexpected discrepancies with 48 pending migrations
3. Execute migrations sequentially: Batch 1 → 2 → 3 (by version) → 4
4. Postflight verification after each migration
5. Full assertion suite after Batch 4