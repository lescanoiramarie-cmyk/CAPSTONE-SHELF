CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
BEGIN;
SELECT extensions.plan(1);

-- Catalog assertions for the public/community visitor registration migration.
-- Auth/PostgREST behavior still requires synthetic users through the Supabase APIs.
SELECT extensions.lives_ok($tap$DO $test$
DECLARE
  v_proc record;
  v_definition text;
  v_helper_definition text;
  v_policy_count integer;
  v_policy_roles oid[];
  v_policy_command "char";
  v_policy_permissive boolean;
  v_policy_using text;
  v_policy_check text;
  v_acl_count integer;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_attribute
    WHERE attrelid = 'public.visitors'::pg_catalog.regclass
      AND attname = 'registration_type' AND atttypid = 'text'::pg_catalog.regtype
      AND attnotnull AND NOT attisdropped
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_attribute
    WHERE attrelid = 'public.visitors'::pg_catalog.regclass
      AND attname = 'approval_status' AND atttypid = 'text'::pg_catalog.regtype
      AND attnotnull AND NOT attisdropped
  ) THEN
    RAISE EXCEPTION 'Registration type and approval status columns must be non-null text.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_trigger trigger_row
    WHERE trigger_row.tgrelid = 'auth.users'::pg_catalog.regclass
      AND trigger_row.tgname = 'on_auth_user_visitor_domain_validate'
      AND NOT trigger_row.tgisinternal
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_trigger trigger_row
    WHERE trigger_row.tgrelid = 'auth.users'::pg_catalog.regclass
      AND trigger_row.tgname = 'on_auth_user_visitor_link_insert'
      AND NOT trigger_row.tgisinternal
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_trigger trigger_row
    WHERE trigger_row.tgrelid = 'auth.users'::pg_catalog.regclass
      AND trigger_row.tgname = 'on_auth_user_visitor_confirm'
      AND NOT trigger_row.tgisinternal
  ) THEN
    RAISE EXCEPTION 'Auth signup validation, insert-link, and confirmation-link triggers must remain attached.';
  END IF;

  SELECT pg_catalog.pg_get_functiondef('public.register_visitor_v2(uuid,text,text,text,text,text,uuid,text)'::pg_catalog.regprocedure)
    INTO v_definition;
  SELECT procedure_row.proowner, language_row.lanname, procedure_row.prorettype,
         procedure_row.proretset, procedure_row.prosecdef, procedure_row.provolatile,
         procedure_row.proconfig
    INTO v_proc
    FROM pg_catalog.pg_proc procedure_row
    JOIN pg_catalog.pg_language language_row ON language_row.oid = procedure_row.prolang
   WHERE procedure_row.oid = 'public.register_visitor_v2(uuid,text,text,text,text,text,uuid,text)'::pg_catalog.regprocedure;
  IF v_proc.proowner IS DISTINCT FROM 'postgres'::pg_catalog.regrole::oid
     OR v_proc.lanname IS DISTINCT FROM 'plpgsql'
     OR v_proc.prorettype IS DISTINCT FROM 'text'::pg_catalog.regtype::oid
     OR v_proc.proretset IS NOT TRUE
     OR v_proc.prosecdef IS NOT TRUE
     OR v_proc.provolatile IS DISTINCT FROM 'v'::"char"
     OR v_proc.proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[]
     OR pg_catalog.pg_get_function_result('public.register_visitor_v2(uuid,text,text,text,text,text,uuid,text)'::pg_catalog.regprocedure)
          IS DISTINCT FROM 'TABLE(visitor_id text)' THEN
    RAISE EXCEPTION 'Registration RPC owner, signature result, language, security, volatility, or search_path changed.';
  END IF;
  IF v_definition NOT ILIKE '%registration_nonce%'
     OR v_definition NOT ILIKE '%registration_type%'
     OR v_definition NOT ILIKE '%p_library_id%'
     OR v_definition NOT ILIKE '%Institutional visitor registration requires an email domain%'
     OR v_definition NOT ILIKE '%v_profile_library_id IS DISTINCT FROM p_library_id%'
     OR v_definition NOT ILIKE '%original registration request%'
     OR v_definition ILIKE '%UPDATE public.visitors AS visitor SET library_id = p_library_id%' THEN
    RAISE EXCEPTION 'Registration RPC must bind the verified signup details, selected library, and institutional-domain rule.';
  END IF;
  SELECT pg_catalog.count(*)::integer INTO v_acl_count
  FROM pg_catalog.pg_proc procedure_row
  CROSS JOIN LATERAL pg_catalog.aclexplode(procedure_row.proacl) acl
  WHERE procedure_row.oid = 'public.register_visitor_v2(uuid,text,text,text,text,text,uuid,text)'::pg_catalog.regprocedure;
  IF v_acl_count <> 3
     OR EXISTS (
       SELECT 1
       FROM pg_catalog.pg_proc procedure_row
       CROSS JOIN LATERAL pg_catalog.aclexplode(procedure_row.proacl) acl
       WHERE procedure_row.oid = 'public.register_visitor_v2(uuid,text,text,text,text,text,uuid,text)'::pg_catalog.regprocedure
         AND (acl.privilege_type <> 'EXECUTE'
           OR acl.is_grantable IS TRUE
           OR acl.grantor <> 'postgres'::pg_catalog.regrole::oid
           OR acl.grantee NOT IN (
             'postgres'::pg_catalog.regrole::oid,
             'anon'::pg_catalog.regrole::oid,
             'authenticated'::pg_catalog.regrole::oid
           ))
     )
     OR NOT pg_catalog.has_function_privilege('anon', 'public.register_visitor_v2(uuid,text,text,text,text,text,uuid,text)', 'EXECUTE')
     OR NOT pg_catalog.has_function_privilege('authenticated', 'public.register_visitor_v2(uuid,text,text,text,text,text,uuid,text)', 'EXECUTE')
     OR pg_catalog.has_function_privilege('service_role', 'public.register_visitor_v2(uuid,text,text,text,text,text,uuid,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Signup RPC must have exactly the reviewed owner/anon/authenticated EXECUTE grants.';
  END IF;

  SELECT pg_catalog.pg_get_functiondef('public.shelf_approve_pending_visitor(text,text)'::pg_catalog.regprocedure)
    INTO v_helper_definition;
  IF v_helper_definition NOT ILIKE '%aal2%'
     OR v_helper_definition NOT ILIKE '%is_active_staff_for_branch%'
     OR v_helper_definition NOT ILIKE '%Visitors cannot approve their own accounts%'
     OR v_helper_definition NOT ILIKE '%otp_verified%'
     OR v_helper_definition NOT ILIKE '%approval_status%'
     OR v_helper_definition NOT ILIKE '%generate_visitor_qr_code%'
     OR v_helper_definition NOT ILIKE '%FOR UPDATE%' THEN
    RAISE EXCEPTION 'Shared approval must enforce AAL2, branch staff, verified email, self-approval rejection, pending state, locking, and QR generation.';
  END IF;
  SELECT pg_catalog.pg_get_functiondef('public.approve_community_visitor(text)'::pg_catalog.regprocedure)
    INTO v_definition;
  IF v_definition NOT ILIKE '%shelf_approve_pending_visitor%'
     OR v_definition NOT ILIKE '%community%' THEN
    RAISE EXCEPTION 'Community approval must remain a compatibility wrapper restricted to community registrations.';
  END IF;
  SELECT procedure_row.prosecdef, procedure_row.proconfig
    INTO v_proc
  FROM pg_catalog.pg_proc procedure_row
  WHERE procedure_row.oid = 'public.approve_community_visitor(text)'::pg_catalog.regprocedure;
  IF NOT v_proc.prosecdef OR NOT ('search_path=""' = ANY(COALESCE(v_proc.proconfig, ARRAY[]::text[]))) THEN
    RAISE EXCEPTION 'Community approval RPC must remain SECURITY DEFINER with an empty fixed search_path.';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc procedure_row
    JOIN pg_catalog.pg_language language_row ON language_row.oid = procedure_row.prolang
    WHERE procedure_row.oid = 'public.approve_community_visitor(text)'::pg_catalog.regprocedure
      AND procedure_row.proowner = 'postgres'::pg_catalog.regrole::oid
      AND language_row.lanname = 'sql'
      AND procedure_row.prorettype = 'boolean'::pg_catalog.regtype::oid
      AND procedure_row.proretset IS FALSE
      AND procedure_row.provolatile = 'v'::"char"
      AND procedure_row.prosecdef IS TRUE
      AND procedure_row.proconfig IS NOT DISTINCT FROM ARRAY['search_path=""']::text[]
  ) THEN
    RAISE EXCEPTION 'Community approval compatibility wrapper metadata differs from its reviewed security contract.';
  END IF;
  SELECT pg_catalog.count(*)::integer INTO v_acl_count
  FROM pg_catalog.pg_proc procedure_row
  CROSS JOIN LATERAL pg_catalog.aclexplode(procedure_row.proacl) acl
  WHERE procedure_row.oid = 'public.approve_community_visitor(text)'::pg_catalog.regprocedure;
  IF v_acl_count <> 2
     OR EXISTS (
       SELECT 1
       FROM pg_catalog.pg_proc procedure_row
       CROSS JOIN LATERAL pg_catalog.aclexplode(procedure_row.proacl) acl
       WHERE procedure_row.oid = 'public.approve_community_visitor(text)'::pg_catalog.regprocedure
         AND (acl.privilege_type <> 'EXECUTE'
           OR acl.is_grantable IS TRUE
           OR acl.grantor <> 'postgres'::pg_catalog.regrole::oid
           OR acl.grantee NOT IN (
             'postgres'::pg_catalog.regrole::oid,
             'authenticated'::pg_catalog.regrole::oid
           ))
     )
     OR pg_catalog.has_function_privilege('anon', 'public.approve_community_visitor(text)', 'EXECUTE')
     OR NOT pg_catalog.has_function_privilege('authenticated', 'public.approve_community_visitor(text)', 'EXECUTE')
     OR pg_catalog.has_function_privilege('service_role', 'public.approve_community_visitor(text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Community approval RPC must have exactly the reviewed owner/authenticated EXECUTE grants.';
  END IF;
  SELECT pg_catalog.pg_get_functiondef('public.approve_visitor(text)'::pg_catalog.regprocedure)
    INTO v_definition;
  IF v_definition NOT ILIKE '%shelf_approve_pending_visitor%'
     OR NOT EXISTS (
       SELECT 1
       FROM pg_catalog.pg_proc procedure_row
       JOIN pg_catalog.pg_language language_row ON language_row.oid = procedure_row.prolang
       WHERE procedure_row.oid = 'public.approve_visitor(text)'::pg_catalog.regprocedure
         AND procedure_row.proowner = 'postgres'::pg_catalog.regrole::oid
         AND language_row.lanname = 'sql'
         AND procedure_row.prorettype = 'boolean'::pg_catalog.regtype::oid
         AND procedure_row.proretset IS FALSE
         AND procedure_row.prosecdef IS TRUE
         AND procedure_row.proconfig IS NOT DISTINCT FROM ARRAY['search_path=""']::text[]
     )
     OR NOT pg_catalog.has_function_privilege('authenticated', 'public.approve_visitor(text)', 'EXECUTE')
     OR pg_catalog.has_function_privilege('anon', 'public.approve_visitor(text)', 'EXECUTE')
     OR pg_catalog.has_function_privilege('service_role', 'public.approve_visitor(text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Generic approval RPC must have the reviewed SECURITY DEFINER contract and authenticated-only access.';
  END IF;

  SELECT pg_catalog.count(*)::integer INTO v_policy_count
  FROM pg_catalog.pg_policy policy_row
  WHERE policy_row.polrelid = 'public.visitors'::pg_catalog.regclass
    AND policy_row.polname = 'visitor and staff read scoped visitor profiles';
  IF v_policy_count = 1 THEN
    SELECT policy_row.polroles, policy_row.polcmd, policy_row.polpermissive,
           pg_catalog.pg_get_expr(policy_row.polqual, policy_row.polrelid),
           pg_catalog.pg_get_expr(policy_row.polwithcheck, policy_row.polrelid)
      INTO v_policy_roles, v_policy_command, v_policy_permissive,
           v_policy_using, v_policy_check
      FROM pg_catalog.pg_policy policy_row
     WHERE policy_row.polrelid = 'public.visitors'::pg_catalog.regclass
       AND policy_row.polname = 'visitor and staff read scoped visitor profiles';
  END IF;
  IF NOT (SELECT relation.relrowsecurity FROM pg_catalog.pg_class relation
          WHERE relation.oid = 'public.visitors'::pg_catalog.regclass)
     OR v_policy_count <> 1
     OR v_policy_roles IS DISTINCT FROM ARRAY['authenticated'::pg_catalog.regrole::oid]
     OR v_policy_command IS DISTINCT FROM 'r'::"char"
     OR v_policy_permissive IS DISTINCT FROM TRUE
     OR v_policy_using IS NULL
     OR v_policy_check IS NOT NULL
     OR v_policy_using !~* 'auth_user_id[[:space:]]*=[[:space:]]*(auth[.])?uid[[:space:]]*[(][[:space:]]*[)]'
     OR v_policy_using !~* 'otp_verified([[:space:]]+IS[[:space:]]+TRUE)?'
     OR v_policy_using !~* 'is_active'
     OR v_policy_using !~* 'approval_status[[:space:]]*=[[:space:]]*''approved'''
     OR v_policy_using ~* 'approval_status[[:space:]]*=[[:space:]]*''pending'''
     OR v_policy_using !~* 'is_active_staff_for_branch[[:space:]]*[(][[:space:]]*[(]?library_id[)]?[[:space:]]*::[[:space:]]*text[)]'
     OR pg_catalog.regexp_count(v_policy_using, 'auth_user_id', 1, 'i') <> 1
     OR pg_catalog.regexp_count(v_policy_using, 'otp_verified', 1, 'i') <> 1
     OR pg_catalog.regexp_count(v_policy_using, 'approval_status', 1, 'i') <> 1
     OR pg_catalog.regexp_count(v_policy_using, 'is_active_staff_for_branch', 1, 'i') <> 1 THEN
    RAISE EXCEPTION 'Visitor policy must allow only verified, approved, active self-reads and authorized staff reads.';
  END IF;

  SELECT pg_catalog.pg_get_functiondef('public.verify_visitor_otp(text,text)'::pg_catalog.regprocedure)
    INTO v_definition;
  IF v_definition NOT ILIKE '%otp_attempts%'
     OR v_definition NOT ILIKE '%approval_status%'
     OR v_definition NOT ILIKE '%generate_visitor_qr_code%' THEN
    RAISE EXCEPTION 'OTP verification must retain attempt lockout and defer pending visitor QR issuance.';
  END IF;
END;
$test$;$tap$, 'public community visitor registration contract block 1');
SELECT * FROM extensions.finish();
ROLLBACK;
