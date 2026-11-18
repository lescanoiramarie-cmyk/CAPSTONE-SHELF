# Real Auth and PostgREST Test Plan

## Purpose
Verify authorization behavior using actual Supabase Auth-issued sessions across all **three authorization roles** and AAL levels.
This is **Track B** of the two-track validation design (see `DATABASE_REPLAY_PROCEDURE.md`).

> **TRACK DESIGNATION:** This plan requires **Track B (Genuine Supabase Runtime)** infrastructure.
> Track A (Local Structural Validation) cannot verify Auth/PostgREST behavior.

## Actual Authorization Model (Corrected)

The system has **3 authorization roles** (plus anonymous). `librarian`/`circulation` are display aliases only — not in `staff_profiles.role` constraint. `community_pending` is a **visitor account state**, not an authorization role.

| Authorization Role | Description | AAL | Scope | JWT `app_metadata.role` | `staff_profiles.role` |
|--------------------|-------------|-----|-------|------------------------|----------------------|
| `visitor` (approved) | Institutional or approved community visitor | AAL1 | Own data only | `visitor` | N/A |
| `subadmin` | Branch-scoped staff | AAL2 | Assigned library only | `subadmin` | `subadmin` |
| `superadmin` | System-wide staff | AAL2 | All libraries | `super_admin` | `superadmin` |

> **Note:** `librarian` and `circulation` appear in UI display formatting and some RPCs but are NOT valid `staff_profiles.role` values (constraint allows only `superadmin`, `subadmin`). The `is_active_staff_for_branch()` function validates against `staff_profiles.role` directly.

### Visitor Account States (Not Authorization Roles)

| Account State | `registration_type` | `approval_status` | `is_active` | `otp_verified` | Access |
|---------------|---------------------|-------------------|-------------|----------------|--------|
| Institutional approved | `institutional` | `approved` | `true` | `true` | Full visitor access |
| Community approved | `community` | `approved` | `true` | `true` | Full visitor access |
| Community pending | `community` | `pending` | `false` | `true`/`false` | Own status only (read) |
| Institutional pending | `institutional` | `pending` | `false` | `true`/`false` | Own status only (read) |
| Inactive visitor | any | any | `false` | any | Blocked |

> **Critical:** `community_pending` is a frontend/test persona label for a visitor with `registration_type='community' AND approval_status='pending' AND is_active=false`. It has NO distinct authorization role — it uses the `visitor` JWT role with restricted access via RLS and RPC guards.

## Test Matrix (3 Authorization Roles × 2 AAL Levels + Anonymous)

| Role | AAL1 (Password) | AAL2 (MFA/TOTP) |
|------|-----------------|-----------------|
| Anonymous | ✅ | N/A |
| Visitor (Approved) | ✅ | ✅ |
| Sub-admin | ❌ (staff requires AAL2) | ✅ |
| Super Admin | ❌ (staff requires AAL2) | ✅ |

> **Critical:** Staff roles (`subadmin`, `superadmin`) **require AAL2** for all privileged operations. AAL1 staff sessions are denied by RPC AAL2 guards.

## Prerequisites (Track B Only)

### Required Infrastructure
- **Isolated Supabase project** (local `supabase start` or dedicated staging)
- **Applied migrations** (all 167 from `DATABASE_REPLAY_PROCEDURE.md`)
- **Test users created** for each role
- **Auth configured** with MFA/TOTP support
- **PostgREST running** with correct JWT secret
- **Storage, Vault, Edge Functions, Realtime, pg_cron, pg_net** available

### Test Users to Create

| Email | Authorization Role | Account State | Password | MFA Enabled | Notes |
|-------|-------------------|---------------|----------|-------------|-------|
| `anon@test.local` | N/A (anon) | N/A | N/A | N/A | Anonymous access |
| `inst.visitor@test.local` | Visitor | Institutional approved | `TestPass123!` | Yes | Approved visitor |
| `comm.visitor.approved@test.local` | Visitor | Community approved | `TestPass123!` | Yes | Approved community |
| `comm.visitor.pending@test.local` | Visitor | Community pending | `TestPass123!` | Yes | Pending approval (restricted) |
| `subadmin@test.local` | Sub-admin | Active staff | `TestPass123!` | Yes | Staff — requires AAL2 |
| `superadmin@test.local` | Super Admin | Active staff | `TestPass123!` | Yes | Staff — requires AAL2 |

> **No `librarian@test.local`** — `librarian` is not a valid database role.

### Test Data Setup
- 2 libraries: Library A, Library B
- Staff assignments: Sub-admin at Library A, Super Admin (system-wide)
- Books: Library books at both libraries, personal books (public/private)
- Borrow requests: Various states (pending, borrowed, returned, overdue)
- Fine payments: Paid/unpaid, different visitors
- Attendance logs: Check-ins for both libraries
- Community book requests: Pending, approved, borrowed, cancelled

## Test Cases

### 1. Anonymous Access

| Test | Expected | Verification |
|------|----------|--------------|
| GET `/rest/v1/books?book_type=eq.library` | 200, library books only | Count matches `get_opac_library_book_count()` |
| GET `/rest/v1/books?book_type=eq.personal&is_public=eq.true` | 200, public personal books | Count matches RPC |
| GET `/rest/v1/external_catalog_books` | 200, all external | Count matches RPC |
| POST `/rest/v1/rpc/get_opac_library_book_count` | 200, count | Valid response |
| POST `/rest/v1/rpc/get_opac_library_book_count_by_library` | 401/403 | Branch enumeration blocked |
| Access visitor profiles | 401/403 | Denied |
| Access borrow requests | 401/403 | Denied |

### 2. Approved Visitor (Institutional or Community, AAL1)

| Test | Expected | Verification |
|------|----------|--------------|
| Login with password only | 200, AAL1 session | `aal` claim = `aal1` |
| GET own profile | 200, own data | `visitor_id` matches `auth.uid()` |
| GET other visitor profile | 403 | Cross-visitor denied |
| GET library books | 200 | Library + public personal + own personal |
| GET external catalog | 200 | All external books |
| Create borrow request | 201 | Own request created |
| GET own borrow requests | 200 | Only own requests |
| GET other visitor requests | 403 | Cross-visitor denied |
| Pay own fine | 200 | Own payment recorded |
| GET fine analytics | 403 | Super Admin only |
| GET fine dashboard | 403 | Sub-admin only |
| Toggle own attendance | 200 | Own attendance logged |
| OPAC filtered count RPC | 200 | Matches visible books |
| Create community book request | 200 | Approved visitors can request |

### 3. Approved Visitor (AAL2)

| Test | Expected | Verification |
|------|----------|--------------|
| Login with password + TOTP | 200, AAL2 session | `aal` claim = `aal2` |
| All AAL1 tests pass | ✅ | Same permissions |
| Staff-only RPCs | 403 | Still denied (not staff) |
| Manage staff | 403 | Super Admin only |

### 4. Community Visitor (Pending, AAL1) — **Restricted Access**

| Test | Expected | Verification |
|------|----------|--------------|
| Login | 200 | Session created |
| Access borrow workflows | 403 | Pending visitors blocked |
| Access OPAC | 200 | Read-only catalog access |
| Access own status | 200 | Can read own pending status |
| Create community book request | 403 | Pending visitors cannot create requests |

### 5. Sub-admin (AAL1) — **ALL DENIED**

| Test | Expected | Verification |
|------|----------|--------------|
| Login | 200, AAL1 | `role` = `subadmin` |
| Any staff RPC | 403 | AAL2 required for all mutations |
| GET branch borrow requests | 403 | AAL2 required |
| Fine dashboard | 403 | AAL2 required |
| OPAC branch count RPC | 403 | AAL2 required |

### 6. Sub-admin (AAL2)

| Test | Expected | Verification |
|------|----------|--------------|
| Login with MFA | 200, AAL2 | `aal` = `aal2`, `role` = `subadmin` |
| GET branch borrow requests | 200 | Branch-scoped only |
| GET other branch requests | 403 | Cross-library denied |
| Confirm pickup (own branch) | 200 | State: ready_for_pickup → borrowed |
| Confirm pickup (other branch) | 403 | Cross-library denied |
| Confirm return (own branch) | 200 | State: borrowed → returned |
| Fine dashboard (own branch) | 200 | Detailed payments |
| Fine dashboard (other branch) | 403 | Cross-library denied |
| Record fine payment (own branch) | 200 | AAL2 satisfied |
| OPAC branch count RPC | 200 | `get_opac_library_book_count_by_library()` |
| View branch analytics | 200 | Branch-scoped |
| Manage staff (own branch) | 200 | AAL2 satisfied |
| All AAL1 tests (read-only) | ✅ | Same branch-scoped access |

### 7. Super Admin (AAL1) — **ALL DENIED**

| Test | Expected | Verification |
|------|----------|--------------|
| Login | 200, AAL1 | `role` = `super_admin` |
| Any staff RPC mutation | 403 | AAL2 required |

### 8. Super Admin (AAL2)

| Test | Expected | Verification |
|------|----------|--------------|
| Login with MFA | 200, AAL2 | `aal` = `aal2`, `role` = `super_admin` |
| System-wide borrow requests | 200 | All libraries |
| Fine analytics (aggregate) | 200 | No visitor PII |
| Fine dashboard (any branch) | 403 | Sub-admin only |
| Manage all staff | 200 | System-wide |
| OPAC total count RPC | 200 | All libraries |
| System analytics | 200 | All branches |
| All AAL1 tests (read-only) | ✅ | System-wide read access |

### 9. Cross-Cutting Tests

| Test | Expected |
|------|----------|
| Session switching (AAL1 → AAL2) | Re-authentication required |
| Logout invalidates session | Subsequent requests 401 |
| Expired access token | Refresh token flow works |
| Invalid/expired JWT | 401 |
| Role claim tampering | 403 (DB profile verification) |
| Branch claim tampering | 403 (`is_active_staff_for_branch` check) |
| Rate limiting | 429 after threshold |
| Concurrent sessions | Per-role limits enforced |

## Execution Procedure (Track B Only)

### 1. Setup Test Environment
```bash
# Provision isolated Supabase project
# Apply all 167 migrations (per DATABASE_REPLAY_PROCEDURE.md)
# Create test users via Supabase Dashboard or API
# Assign roles via JWT custom claims or database profiles
# Enable MFA for test users requiring AAL2
```

### 2. Run Tests
```bash
# Use a test runner that can:
# 1. Authenticate as each user (password + TOTP for AAL2)
# 2. Extract access tokens
# 3. Make PostgREST requests with Authorization: Bearer <token>
# 4. Verify responses

# Example using curl:
# AAL1 login
curl -X POST "https://<project>.supabase.co/auth/v1/token?grant_type=password" \
  -H "apikey: <anon_key>" \
  -H "Content-Type: application/json" \
  -d '{"email":"subadmin@test.local","password":"TestPass123!"}'

# AAL2 login (requires TOTP)
curl -X POST "https://<project>.supabase.co/auth/v1/token?grant_type=password" \
  -H "apikey: <anon_key>" \
  -H "Content-Type: application/json" \
  -d '{"email":"subadmin@test.local","password":"TestPass123!","gotrue_meta_security":{"factors":[{"type":"totp","code":"123456"}]}}'

# Make authenticated request
curl -X GET "https://<project>.supabase.co/rest/v1/books?book_type=eq.library" \
  -H "apikey: <anon_key>" \
  -H "Authorization: Bearer <access_token>"
```

### 3. Automated Test Suite
Create a test script that:
- Iterates through all role/AAL combinations
- Runs each test case
- Reports pass/fail with evidence
- Does NOT use mocked JWTs — uses real Auth-issued tokens

## Current Status

| Component | Status | Track |
|-----------|--------|-------|
| Unit tests (mocked JWT) | ✅ 199 passing | A |
| Real Auth integration | ❌ NOT RUN | B |
| PostgREST authorization matrix | ❌ NOT RUN | B |
| AAL2/TOTP verification | ❌ NOT RUN | B |
| Cross-role access denial | ❌ NOT VERIFIED | B |
| Branch isolation | ❌ NOT VERIFIED | B |

## Missing Infrastructure (Track B)

**No isolated Supabase project with Auth configured.** Requires:
1. Local Supabase stack (`supabase start`) — **not available on Windows** (Docker required, pg_cron/pg_net limitations)
2. OR dedicated staging project (owner approval + paid resource)
3. Auth configured with MFA/TOTP
4. Test users provisioned
5. PostgREST running with correct JWT secret
6. Storage, Vault, Edge Functions, Realtime, pg_cron, pg_net

## Next Steps for Owner

1. Provision isolated Supabase environment (Linux/macOS for local, or dedicated staging)
2. Apply all 167 migrations
3. Create test users and assign roles per this matrix
4. Execute test matrix
5. Document any authorization gaps
6. Fix with forward-only migrations if needed

> **Reminder:** Track A (local PostgreSQL) cannot execute this test plan. It requires Track B (Supabase stack).