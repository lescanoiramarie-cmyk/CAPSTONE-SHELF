CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
BEGIN;
SELECT extensions.plan(1);

SELECT extensions.lives_ok($tap$DO $test$
DECLARE
  v_status_proc record;
  v_status_definition text;
  v_profile_definition text;
  v_list_definition text;
  v_policy text;
BEGIN
  IF pg_catalog.has_column_privilege('authenticated', 'public.visitors', 'email', 'SELECT')
     OR pg_catalog.has_column_privilege('authenticated', 'public.visitors', 'full_name', 'SELECT')
     OR pg_catalog.has_column_privilege('authenticated', 'public.visitors', 'contact_number', 'SELECT')
     OR pg_catalog.has_column_privilege('authenticated', 'public.visitors', 'address', 'SELECT')
     OR pg_catalog.has_column_privilege('authenticated', 'public.visitors', 'profile_image_path', 'SELECT')
     OR pg_catalog.has_column_privilege('authenticated', 'public.visitors', 'qr_code', 'SELECT')
     OR pg_catalog.has_column_privilege('authenticated', 'public.visitors', 'registration_type', 'SELECT') THEN
    RAISE EXCEPTION 'Authenticated users retain direct SELECT access to private visitor-profile columns.';
  END IF;

  IF NOT pg_catalog.has_column_privilege('authenticated', 'public.visitors', 'id', 'SELECT')
     OR NOT pg_catalog.has_column_privilege('authenticated', 'public.visitors', 'auth_user_id', 'SELECT')
     OR NOT pg_catalog.has_column_privilege('authenticated', 'public.visitors', 'otp_verified', 'SELECT')
     OR NOT pg_catalog.has_column_privilege('authenticated', 'public.visitors', 'is_active', 'SELECT')
     OR NOT pg_catalog.has_column_privilege('authenticated', 'public.visitors', 'library_id', 'SELECT')
     OR NOT pg_catalog.has_column_privilege('authenticated', 'public.visitors', 'approval_status', 'SELECT') THEN
    RAISE EXCEPTION 'Existing visitor RLS predicates lack the minimum linkage/eligibility column grants.';
  END IF;

  SELECT procedure_row.proowner, procedure_row.prosecdef, procedure_row.proconfig,
         procedure_row.pronargs, language_row.lanname
    INTO v_status_proc
  FROM pg_catalog.pg_proc AS procedure_row
  JOIN pg_catalog.pg_language AS language_row ON language_row.oid = procedure_row.prolang
  WHERE procedure_row.oid = 'public.get_my_visitor_approval_status()'::pg_catalog.regprocedure;
  IF v_status_proc.proowner IS DISTINCT FROM 'postgres'::pg_catalog.regrole::oid
     OR v_status_proc.prosecdef IS NOT TRUE
     OR v_status_proc.proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[]
     OR v_status_proc.pronargs <> 0
     OR v_status_proc.lanname IS DISTINCT FROM 'plpgsql'
     OR NOT pg_catalog.has_function_privilege('authenticated', 'public.get_my_visitor_approval_status()', 'EXECUTE')
     OR pg_catalog.has_function_privilege('anon', 'public.get_my_visitor_approval_status()', 'EXECUTE')
     OR pg_catalog.has_function_privilege('service_role', 'public.get_my_visitor_approval_status()', 'EXECUTE') THEN
    RAISE EXCEPTION 'Approval status RPC must have an authenticated-only, identity-scoped SECURITY DEFINER contract.';
  END IF;
  v_status_definition := pg_catalog.pg_get_functiondef('public.get_my_visitor_approval_status()'::pg_catalog.regprocedure);
  IF v_status_definition NOT ILIKE '%auth.uid()%'
     OR v_status_definition ILIKE '%p_visitor_id%'
     OR v_status_definition NOT ILIKE '%otp_verified IS TRUE%'
     OR v_status_definition ILIKE '%visitor.email%'
     OR v_status_definition ILIKE '%visitor.full_name%'
     OR v_status_definition ILIKE '%visitor.qr_code%' THEN
    RAISE EXCEPTION 'Approval status RPC must use the authenticated identity and return only approval-status data.';
  END IF;

  v_profile_definition := pg_catalog.pg_get_functiondef('public.get_my_visitor_profile_v2()'::pg_catalog.regprocedure);
  IF v_profile_definition NOT ILIKE '%approval_status%'
     OR v_profile_definition NOT ILIKE '%is_active%'
     OR v_profile_definition NOT ILIKE '%otp_verified%' THEN
    RAISE EXCEPTION 'Own-profile RPC must enforce approval, activation, and email verification.';
  END IF;
  IF v_profile_definition ILIKE '%visitor.profile_image_url%'
     OR v_profile_definition ILIKE '%visitor.created_at%'
     OR v_profile_definition ILIKE '%visitor.updated_at%'
     OR v_profile_definition ILIKE '%visitor.status%'
     OR v_profile_definition ILIKE '%visitor.visitor_type%' THEN
    RAISE EXCEPTION 'Visitor profile RPC must not depend on columns absent from the checked-in visitor schema.';
  END IF;

  v_list_definition := pg_catalog.pg_get_functiondef(
    'public.list_visitor_accounts_v2(boolean,uuid,text,text,integer,integer)'::pg_catalog.regprocedure
  );
  IF v_list_definition NOT ILIKE '%aal2%'
     OR v_list_definition NOT ILIKE '%is_active_staff_for_branch%'
     OR v_list_definition NOT ILIKE '%staff.library_id%' THEN
    RAISE EXCEPTION 'Staff visitor-list RPC must retain AAL2 and branch-scoped authorization.';
  END IF;

  SELECT policy_row.qual INTO v_policy
  FROM pg_catalog.pg_policies AS policy_row
  WHERE policy_row.schemaname = 'public'
    AND policy_row.tablename = 'visitors'
    AND policy_row.policyname = 'visitor and staff read scoped visitor profiles';
  IF v_policy IS NULL
     OR v_policy ILIKE '%approval_status = ''pending''%' THEN
    RAISE EXCEPTION 'Pending visitors must not read visitor rows directly.';
  END IF;
END;
$test$$tap$,
'Pending visitor profile reads are restricted to the identity-bound status RPC and authorized profile/staff RPCs.');

SELECT * FROM extensions.finish();
ROLLBACK;
