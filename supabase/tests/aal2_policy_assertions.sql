CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
BEGIN;
SELECT extensions.plan(1);

-- Read-only catalog assertions for AAL2 policy enforcement across staff RPCs.
-- Covers migrations: 20270102001800_fail_closed_staff_claims_and_handover.sql,
--                  20270102000900_attendance_role_claim_fail_closed.sql,
--                  20270102002400_transaction_rpc_hardening.sql,
--                  20270102002500_remaining_secdef_hardening.sql,
--                  20270102002600_fix_visitor_functions_aal2_and_harden_base.sql
SELECT extensions.lives_ok($tap$DO $tests$
DECLARE
  v_signature regprocedure;
  v_oid oid;
  v_definition text;
  v_acl_count integer;
  v_owner text;
  v_language text;
  v_volatility "char";
  v_secdef boolean;
  v_config text[];
  v_policy_count integer;
  v_policy_roles oid[];
  v_policy_command "char";
  v_policy_permissive boolean;
  v_policy_using text;
  v_policy_check text;
BEGIN
  -- ============================================================
  -- 1. Core staff RPCs: AAL2 fail-closed, exact role claim, branch scope
  -- ============================================================
  FOREACH v_signature IN ARRAY ARRAY[
    'public.accept_subadmin_terms()'
  ] LOOP
    v_oid := v_signature::oid;
    IF v_oid IS NULL THEN
      RAISE EXCEPTION 'Missing function: %', v_signature;
    END IF;

    v_definition := pg_catalog.pg_get_functiondef(v_oid);

    -- AAL2 fail-closed check
    IF pg_catalog.strpos(v_definition, 'IS DISTINCT FROM ''aal2''') = 0 THEN
      RAISE EXCEPTION 'Function % missing AAL2 fail-closed guard.', v_signature;
    END IF;

    -- Exact role claim validation (no COALESCE fallback)
    IF v_signature::text = 'public.accept_subadmin_terms()' THEN
      IF pg_catalog.strpos(v_definition, 'v_jwt_role IS DISTINCT FROM staff_row.role') = 0
         OR pg_catalog.strpos(v_definition, 'COALESCE') > 0 THEN
        RAISE EXCEPTION 'Sub-admin terms % has fail-open role claim fallback.', v_signature;
      END IF;
    END IF;

    -- Verify SECURITY DEFINER with empty search_path
    SELECT pg_catalog.pg_get_userbyid(p.proowner), l.lanname, p.provolatile, p.prosecdef, p.proconfig
      INTO v_owner, v_language, v_volatility, v_secdef, v_config
    FROM pg_catalog.pg_proc AS p
    JOIN pg_catalog.pg_language AS l ON l.oid = p.prolang
    WHERE p.oid = v_oid;

    IF v_owner <> 'postgres'
       OR v_language <> 'plpgsql'
       OR v_volatility IS DISTINCT FROM 'v'
       OR NOT v_secdef
       OR v_config IS DISTINCT FROM ARRAY['search_path=""']::text[] THEN
      RAISE EXCEPTION 'Function % metadata differs from contract.', v_signature;
    END IF;
  END LOOP;

  -- ============================================================
  -- 2. Legacy handover overloads are owner-only; authenticated callers use v2.
  -- ============================================================
  FOREACH v_signature IN ARRAY ARRAY[
    'public.confirm_pickup(text,text)',
    'public.confirm_return(text,text)'
  ] LOOP
    v_oid := v_signature::oid;

    IF pg_catalog.has_function_privilege('authenticated', v_oid, 'EXECUTE')
       OR pg_catalog.has_function_privilege('anon', v_oid, 'EXECUTE')
       OR pg_catalog.has_function_privilege('service_role', v_oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'Legacy overload % must be owner-only.', v_signature;
    END IF;

    SELECT pg_catalog.count(*) INTO v_acl_count
    FROM pg_catalog.pg_proc AS p
    CROSS JOIN LATERAL pg_catalog.aclexplode(p.proacl) AS acl
    WHERE p.oid = v_oid;

    IF v_acl_count <> 1 THEN
      RAISE EXCEPTION 'Legacy overload % ACL entry count mismatch (expected owner only).', v_signature;
    END IF;
  END LOOP;

  -- ============================================================
  -- 3. UUID compatibility overloads are owner-only and cannot be called by API roles.
  -- ============================================================
  FOREACH v_signature IN ARRAY ARRAY[
    'public.confirm_pickup(uuid,text)',
    'public.confirm_return(uuid,text)'
  ] LOOP
    v_oid := v_signature::oid;

    IF pg_catalog.has_function_privilege('authenticated', v_oid, 'EXECUTE')
       OR pg_catalog.has_function_privilege('anon', v_oid, 'EXECUTE')
       OR pg_catalog.has_function_privilege('service_role', v_oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'UUID overload % must be owner-only.', v_signature;
    END IF;

    SELECT pg_catalog.count(*) INTO v_acl_count
    FROM pg_catalog.pg_proc AS p
    CROSS JOIN LATERAL pg_catalog.aclexplode(p.proacl) AS acl
    WHERE p.oid = v_oid;

    IF v_acl_count <> 1 THEN
      RAISE EXCEPTION 'UUID overload % ACL entry count mismatch (expected owner only).', v_signature;
    END IF;
  END LOOP;

  -- v2 handover endpoints enforce AAL2, active branch scope, and exact role claims.
  FOREACH v_signature IN ARRAY ARRAY[
    'public.confirm_pickup_v2(text,text)',
    'public.confirm_return_v2(text,text)'
  ] LOOP
    v_definition := pg_catalog.pg_get_functiondef(v_signature::oid);
    IF pg_catalog.strpos(v_definition, 'IS DISTINCT FROM ''aal2''') = 0
       OR pg_catalog.strpos(v_definition, 'IS DISTINCT FROM v_staff.role') = 0
       OR pg_catalog.strpos(v_definition, 'staff_profiles') = 0
       OR pg_catalog.strpos(v_definition, 'is_active IS TRUE') = 0
       OR pg_catalog.strpos(v_definition, 'book.library_id = v_staff.library_id') = 0
       OR pg_catalog.has_function_privilege('authenticated', v_signature::oid, 'EXECUTE') IS FALSE
       OR pg_catalog.has_function_privilege('anon', v_signature::oid, 'EXECUTE')
       OR pg_catalog.has_function_privilege('service_role', v_signature::oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'v2 handover % lacks exact AAL2/role/branch enforcement or has wrong grants.', v_signature;
    END IF;
  END LOOP;

  -- ============================================================
  -- 4. Attendance RPCs: AAL2, active staff, exact role claim
  -- ============================================================
  FOREACH v_signature IN ARRAY ARRAY[
    'public.toggle_attendance(text,text)',
    'public.lookup_attendance_visitor_v2(text,text)'
  ] LOOP
    v_oid := v_signature::oid;
    IF v_oid IS NULL THEN
      RAISE EXCEPTION 'Missing attendance function: %', v_signature;
    END IF;

    v_definition := pg_catalog.pg_get_functiondef(v_oid);
    IF pg_catalog.strpos(v_definition, '->> ''aal''') = 0
       OR pg_catalog.strpos(v_definition, 'staff_profiles') = 0
       OR pg_catalog.strpos(v_definition, 'staff.is_active IS TRUE') = 0
       OR pg_catalog.strpos(v_definition, 'IS DISTINCT FROM v_role') = 0
       OR pg_catalog.strpos(v_definition, 'COALESCE(auth.jwt() -> ''app_metadata'' ->> ''role'',') > 0 THEN
      RAISE EXCEPTION 'Attendance function % missing AAL2, branch check, exact role, or has fallback.', v_signature;
    END IF;
  END LOOP;

  -- ============================================================
  -- 5. Attendance RLS: no anon SELECT, restrictive AAL2 policy
  -- ============================================================
  IF pg_catalog.has_table_privilege('anon', 'public.attendance_logs', 'SELECT') THEN
    RAISE EXCEPTION 'Anonymous SELECT on attendance_logs still possible.';
  END IF;

  SELECT pg_catalog.count(*)::integer
    INTO v_policy_count
  FROM pg_catalog.pg_policy AS p
  WHERE p.polrelid = 'public.attendance_logs'::regclass
    AND p.polname = 'SHELF admin MFA required';

  IF v_policy_count <> 1 THEN
    RAISE EXCEPTION 'Restrictive attendance AAL2 policy missing.';
  END IF;

  SELECT p.polroles, p.polcmd, p.polpermissive,
         pg_catalog.pg_get_expr(p.polqual, p.polrelid),
         pg_catalog.pg_get_expr(p.polwithcheck, p.polrelid)
    INTO v_policy_roles, v_policy_command, v_policy_permissive,
         v_policy_using, v_policy_check
  FROM pg_catalog.pg_policy AS p
  WHERE p.polrelid = 'public.attendance_logs'::regclass
    AND p.polname = 'SHELF admin MFA required';

  IF v_policy_roles IS DISTINCT FROM ARRAY['authenticated'::regrole::oid]
     OR v_policy_command IS DISTINCT FROM '*'::"char"
     OR v_policy_permissive IS DISTINCT FROM FALSE
     OR v_policy_using IS NULL
     OR v_policy_using !~* 'shelf_admin_mfa_access_allowed'
     OR v_policy_check IS NULL
     OR v_policy_check !~* 'shelf_admin_mfa_access_allowed' THEN
    RAISE EXCEPTION 'Attendance AAL2 policy definition differs from contract.';
  END IF;

  -- ============================================================
  -- 6. Attendance v2 RPC response contract
  -- ============================================================
  v_definition := pg_catalog.pg_get_function_result('public.lookup_attendance_visitor_v2(text,text)'::regprocedure);
  IF v_definition <> 'TABLE(id text, full_name character varying, contact_number character varying, email character varying, address text, qr_code character varying, profile_image_path text)' THEN
    RAISE EXCEPTION 'Attendance v2 response contract changed: %', v_definition;
  END IF;

  IF NOT pg_catalog.has_function_privilege('authenticated', 'public.lookup_attendance_visitor_v2(text,text)', 'EXECUTE')
     OR pg_catalog.has_function_privilege('anon', 'public.lookup_attendance_visitor_v2(text,text)', 'EXECUTE')
     OR NOT pg_catalog.has_function_privilege('service_role', 'public.lookup_attendance_visitor_v2(text,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Attendance v2 grants differ from authenticated/service-role contract.';
  END IF;

  -- ============================================================
  -- 7. is_active_staff_for_branch: fail-closed JWT role validation
  -- ============================================================
  v_signature := 'public.is_active_staff_for_branch(text)'::regprocedure;
  v_oid := v_signature::oid;
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'Missing is_active_staff_for_branch function.';
  END IF;

  v_definition := pg_catalog.pg_get_functiondef(v_oid);
  IF pg_catalog.strpos(v_definition, 'app_metadata') = 0
     OR pg_catalog.strpos(v_definition, 'role') = 0
     OR pg_catalog.strpos(v_definition, 'COALESCE(auth.jwt() -> ''app_metadata'' ->> ''role'', staff.role)') > 0 THEN
    RAISE EXCEPTION 'is_active_staff_for_branch missing fail-closed JWT role validation.';
  END IF;

  IF NOT pg_catalog.has_function_privilege('authenticated', v_oid, 'EXECUTE')
     OR pg_catalog.has_function_privilege('anon', v_oid, 'EXECUTE')
     OR NOT pg_catalog.has_function_privilege('service_role', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'is_active_staff_for_branch grants differ from contract.';
  END IF;

  -- ============================================================
  -- 8. is_shelf_superadmin: fail-closed, exact role claim
  -- ============================================================
  v_signature := 'public.is_shelf_superadmin()'::regprocedure;
  v_oid := v_signature::oid;
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'Missing is_shelf_superadmin function.';
  END IF;

  v_definition := pg_catalog.pg_get_functiondef(v_oid);
  IF pg_catalog.strpos(v_definition, 'app_metadata') = 0
     OR pg_catalog.strpos(v_definition, 'role') = 0
     OR pg_catalog.strpos(v_definition, 'COALESCE(auth.jwt() -> ''app_metadata'' ->> ''role'', staff.role)') > 0 THEN
    RAISE EXCEPTION 'is_shelf_superadmin missing fail-closed JWT role validation.';
  END IF;

  IF NOT pg_catalog.has_function_privilege('authenticated', v_oid, 'EXECUTE')
     OR pg_catalog.has_function_privilege('anon', v_oid, 'EXECUTE')
     OR NOT pg_catalog.has_function_privilege('service_role', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'is_shelf_superadmin grants differ from contract.';
  END IF;

  -- ============================================================
  -- 9. Announcements policy: branch-scoped, authenticated only
  -- ============================================================
  SELECT pg_catalog.count(*)::integer
    INTO v_policy_count
  FROM pg_catalog.pg_policy AS p
  WHERE p.polrelid = 'public.announcements'::regclass
    AND p.polname = 'staff manage announcements';

  IF v_policy_count <> 1 THEN
    RAISE EXCEPTION 'Announcements policy missing or duplicated.';
  END IF;

  SELECT p.polroles, p.polcmd, p.polpermissive,
         pg_catalog.pg_get_expr(p.polqual, p.polrelid),
         pg_catalog.pg_get_expr(p.polwithcheck, p.polrelid)
    INTO v_policy_roles, v_policy_command, v_policy_permissive,
         v_policy_using, v_policy_check
  FROM pg_catalog.pg_policy AS p
  WHERE p.polrelid = 'public.announcements'::regclass
    AND p.polname = 'staff manage announcements';

  IF v_policy_roles IS DISTINCT FROM ARRAY['authenticated'::regrole::oid]
     OR v_policy_command IS DISTINCT FROM '*'::"char"
     OR v_policy_permissive IS DISTINCT FROM TRUE
     OR v_policy_using IS NULL
     OR v_policy_check IS NULL
     OR v_policy_using IS DISTINCT FROM v_policy_check
     OR v_policy_using !~* 'is_active_staff_for_branch'
     OR v_policy_using !~* 'library_id.*::[[:space:]]*text' THEN
    RAISE EXCEPTION 'Announcements policy differs from branch-scoped contract.';
  END IF;

  -- ============================================================
  -- 10. Postgres default ACLs: no API role membership to postgres
  -- ============================================================
  IF pg_catalog.pg_has_role('anon', 'postgres', 'MEMBER')
     OR pg_catalog.pg_has_role('authenticated', 'postgres', 'MEMBER')
     OR pg_catalog.pg_has_role('service_role', 'postgres', 'MEMBER') THEN
    RAISE EXCEPTION 'API role has postgres membership - privilege escalation risk.';
  END IF;

  -- ============================================================
  -- 11. Function default ACL for postgres: explicit global row to remove PUBLIC EXECUTE
  -- ============================================================
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_default_acl AS d
    WHERE d.defaclrole = 'postgres'::regrole::oid
      AND d.defaclnamespace = 0
      AND d.defaclobjtype = 'f'
  ) THEN
    RAISE EXCEPTION 'Postgres global function default ACL missing; PUBLIC EXECUTE may be inherited.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_default_acl AS d
    CROSS JOIN LATERAL pg_catalog.aclexplode(
      COALESCE(d.defaclacl, pg_catalog.acldefault(d.defaclobjtype, d.defaclrole))
    ) AS acl
    WHERE d.defaclrole = 'postgres'::regrole::oid
      AND d.defaclobjtype IN ('r', 'S', 'f')
      AND d.defaclnamespace IN (0::oid, 'public'::regnamespace::oid)
      AND acl.grantee IN (0::oid, 'anon'::regrole::oid, 'authenticated'::regrole::oid, 'service_role'::regrole::oid)
  ) THEN
    RAISE EXCEPTION 'Postgres default ACL grants API role.';
  END IF;

END;
$tests$;$tap$, 'aal2 policy assertions contract block 1');

SELECT * FROM extensions.finish();
ROLLBACK;
