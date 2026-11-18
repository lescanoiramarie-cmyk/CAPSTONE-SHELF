-- Disposable/local PostgreSQL regression assertions only.
-- Run against a disposable database, or with the forward migration in the same
-- session; this test rolls back its synthetic auth/staff/library fixtures.
BEGIN;

DO $tests$
DECLARE
  v_subadmin_id uuid := '7b2ea72c-e0a0-4d9d-8c26-4d7107ac1081';
  v_superadmin_id uuid := '9e3f94e5-72bf-473b-8c3b-c816d6077a11';
  v_branch_a uuid;
  v_branch_b uuid;
  v_claims jsonb;
  v_definition text;
  v_result text;
  v_actual_error text;
  v_column record;
  v_expected_update boolean;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_policy AS policy
    WHERE policy.polrelid = 'public.attendance_logs'::regclass
      AND policy.polname = 'SHELF admin MFA required'
      AND policy.polpermissive IS FALSE
      AND policy.polcmd = '*'
      AND pg_catalog.pg_get_expr(policy.polqual, policy.polrelid)
        LIKE '%shelf_admin_mfa_access_allowed%'
  ) THEN
    RAISE EXCEPTION 'FAIL: restrictive attendance AAL2 policy is missing or changed.';
  END IF;

  INSERT INTO public.libraries (name)
  VALUES ('Security test branch A')
  RETURNING id INTO v_branch_a;

  INSERT INTO public.libraries (name)
  VALUES ('Security test branch B')
  RETURNING id INTO v_branch_b;

  INSERT INTO auth.users (id, email, raw_app_meta_data, raw_user_meta_data)
  VALUES
    (v_subadmin_id, NULL, '{}'::jsonb, '{}'::jsonb),
    (v_superadmin_id, NULL, '{}'::jsonb, '{}'::jsonb);

  INSERT INTO public.staff_profiles (id, email, full_name, role, library_id, is_active)
  VALUES
    (v_subadmin_id, 'security-subadmin-fixture@invalid.test', 'Security Test Subadmin', 'subadmin', v_branch_a, true),
    (v_superadmin_id, 'security-superadmin-fixture@invalid.test', 'Security Test Superadmin', 'superadmin', NULL, true);

  -- Missing app_metadata.role must be denied even though the profile role is valid.
  PERFORM pg_catalog.set_config('request.jwt.claim.sub', v_subadmin_id::text, true);
  v_claims := pg_catalog.jsonb_build_object('sub', v_subadmin_id::text, 'aal', 'aal2', 'app_metadata', '{}'::jsonb);
  PERFORM pg_catalog.set_config('request.jwt.claims', v_claims::text, true);
  IF public.is_active_staff_for_branch(v_branch_a::text) IS TRUE THEN
    RAISE EXCEPTION 'FAIL: missing app_metadata.role authorized a sub-admin.';
  END IF;

  -- Explicit JSON null is denied.
  v_claims := pg_catalog.jsonb_build_object('sub', v_subadmin_id::text, 'aal', 'aal2',
    'app_metadata', pg_catalog.jsonb_build_object('role', NULL));
  PERFORM pg_catalog.set_config('request.jwt.claims', v_claims::text, true);
  IF public.is_active_staff_for_branch(v_branch_a::text) IS TRUE THEN
    RAISE EXCEPTION 'FAIL: null app_metadata.role authorized a sub-admin.';
  END IF;

  -- Empty and unsupported values are denied.
  FOREACH v_result IN ARRAY ARRAY['', 'visitor'] LOOP
    v_claims := pg_catalog.jsonb_build_object('sub', v_subadmin_id::text, 'aal', 'aal2',
      'app_metadata', pg_catalog.jsonb_build_object('role', v_result));
    PERFORM pg_catalog.set_config('request.jwt.claims', v_claims::text, true);
    IF public.is_active_staff_for_branch(v_branch_a::text) IS TRUE THEN
      RAISE EXCEPTION 'FAIL: empty/unsupported app_metadata.role authorized a sub-admin.';
    END IF;
  END LOOP;

  -- A valid exact role claim authorizes only the assigned branch.
  v_claims := pg_catalog.jsonb_build_object('sub', v_subadmin_id::text, 'aal', 'aal2',
    'app_metadata', pg_catalog.jsonb_build_object('role', 'subadmin'));
  PERFORM pg_catalog.set_config('request.jwt.claims', v_claims::text, true);
  IF public.is_active_staff_for_branch(v_branch_a::text) IS NOT TRUE
     OR public.is_active_staff_for_branch(v_branch_b::text) IS TRUE
     OR public.is_shelf_superadmin() IS TRUE THEN
    RAISE EXCEPTION 'FAIL: valid sub-admin branch/role authorization is incorrect.';
  END IF;

  -- Mismatched and case/whitespace-altered claims fail closed.
  FOREACH v_result IN ARRAY ARRAY['superadmin', 'SubAdmin', ' subadmin '] LOOP
    v_claims := pg_catalog.jsonb_build_object('sub', v_subadmin_id::text, 'aal', 'aal2',
      'app_metadata', pg_catalog.jsonb_build_object('role', v_result));
    PERFORM pg_catalog.set_config('request.jwt.claims', v_claims::text, true);
    IF public.is_active_staff_for_branch(v_branch_a::text) IS TRUE THEN
      RAISE EXCEPTION 'FAIL: mismatched app_metadata.role authorized a sub-admin.';
    END IF;
  END LOOP;

  -- Inactive staff stays denied even with the correct role claim.
  UPDATE public.staff_profiles SET is_active = false WHERE id = v_subadmin_id;
  v_claims := pg_catalog.jsonb_build_object('sub', v_subadmin_id::text, 'aal', 'aal2',
    'app_metadata', pg_catalog.jsonb_build_object('role', 'subadmin'));
  PERFORM pg_catalog.set_config('request.jwt.claims', v_claims::text, true);
  IF public.is_active_staff_for_branch(v_branch_a::text) IS TRUE THEN
    RAISE EXCEPTION 'FAIL: inactive staff was authorized.';
  END IF;
  v_claims := pg_catalog.jsonb_build_object('sub', v_subadmin_id::text, 'aal', 'aal2',
    'app_metadata', pg_catalog.jsonb_build_object('role', 'subadmin'));
  PERFORM pg_catalog.set_config('request.jwt.claims', v_claims::text, true);
  BEGIN
    PERFORM public.confirm_pickup('00000000-0000-0000-0000-000000000018'::uuid, 'Synthetic Test');
    RAISE EXCEPTION 'TEST_UNEXPECTED_HANDOVER_SUCCESS';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_actual_error = MESSAGE_TEXT;
    IF v_actual_error IS DISTINCT FROM 'Active staff profile required.' THEN
      RAISE EXCEPTION 'FAIL: inactive pickup RPC did not deny active-staff failure (%).', v_actual_error;
    END IF;
  END;
  UPDATE public.staff_profiles SET is_active = true WHERE id = v_subadmin_id;

  -- Exercise the four legacy overload entry guards with synthetic JWT GUCs.
  -- This is a local SQL assertion, not an Auth-issued/PostgREST session test.
  v_claims := pg_catalog.jsonb_build_object('sub', v_subadmin_id::text, 'aal', 'aal1',
    'app_metadata', pg_catalog.jsonb_build_object('role', 'subadmin'));
  PERFORM pg_catalog.set_config('request.jwt.claim.sub', v_subadmin_id::text, true);
  PERFORM pg_catalog.set_config('request.jwt.claims', v_claims::text, true);
  BEGIN
    PERFORM public.confirm_pickup('00000000-0000-0000-0000-000000000018'::uuid, 'Synthetic Test');
    RAISE EXCEPTION 'TEST_UNEXPECTED_AAL1_PICKUP_SUCCESS';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_actual_error = MESSAGE_TEXT;
    IF v_actual_error IS DISTINCT FROM 'AAL2 authentication is required.' THEN
      RAISE EXCEPTION 'FAIL: UUID pickup did not reject AAL1 before processing (%).', v_actual_error;
    END IF;
  END;
  BEGIN
    PERFORM public.confirm_return('00000000-0000-0000-0000-000000000018'::uuid, 'Synthetic Test');
    RAISE EXCEPTION 'TEST_UNEXPECTED_AAL1_RETURN_SUCCESS';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_actual_error = MESSAGE_TEXT;
    IF v_actual_error IS DISTINCT FROM 'AAL2 authentication is required.' THEN
      RAISE EXCEPTION 'FAIL: UUID return did not reject AAL1 before processing (%).', v_actual_error;
    END IF;
  END;
  BEGIN
    PERFORM public.confirm_pickup('SYNTHETIC-MISSING-REQUEST', 'Synthetic Test');
    RAISE EXCEPTION 'TEST_UNEXPECTED_AAL1_LEGACY_PICKUP_SUCCESS';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_actual_error = MESSAGE_TEXT;
    IF v_actual_error IS DISTINCT FROM 'AAL2 authentication is required.' THEN
      RAISE EXCEPTION 'FAIL: text pickup did not reject AAL1 before processing (%).', v_actual_error;
    END IF;
  END;
  BEGIN
    PERFORM public.confirm_return('SYNTHETIC-MISSING-REQUEST', 'Synthetic Test');
    RAISE EXCEPTION 'TEST_UNEXPECTED_AAL1_LEGACY_RETURN_SUCCESS';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_actual_error = MESSAGE_TEXT;
    IF v_actual_error IS DISTINCT FROM 'AAL2 authentication is required.' THEN
      RAISE EXCEPTION 'FAIL: text return did not reject AAL1 before processing (%).', v_actual_error;
    END IF;
  END;

  v_claims := pg_catalog.jsonb_build_object('sub', v_subadmin_id::text, 'aal', 'aal2',
    'app_metadata', pg_catalog.jsonb_build_object('role', 'subadmin'));
  PERFORM pg_catalog.set_config('request.jwt.claims', v_claims::text, true);
  BEGIN
    PERFORM public.confirm_pickup('00000000-0000-0000-0000-000000000018'::uuid, 'Synthetic Test');
    RAISE EXCEPTION 'TEST_UNEXPECTED_UNKNOWN_PICKUP_SUCCESS';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_actual_error = MESSAGE_TEXT;
    IF v_actual_error IS DISTINCT FROM 'Request not found.' THEN
      RAISE EXCEPTION 'FAIL: valid AAL2 pickup role was rejected before request lookup (%).', v_actual_error;
    END IF;
  END;
  BEGIN
    PERFORM public.confirm_return('00000000-0000-0000-0000-000000000018'::uuid, 'Synthetic Test');
    RAISE EXCEPTION 'TEST_UNEXPECTED_UNKNOWN_RETURN_SUCCESS';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_actual_error = MESSAGE_TEXT;
    IF v_actual_error IS DISTINCT FROM 'Request not found.' THEN
      RAISE EXCEPTION 'FAIL: valid AAL2 return role was rejected before request lookup (%).', v_actual_error;
    END IF;
  END;

  FOREACH v_result IN ARRAY ARRAY['__missing__', '__json_null__', '', 'superadmin'] LOOP
    IF v_result = '__missing__' THEN
      v_claims := pg_catalog.jsonb_build_object('sub', v_subadmin_id::text, 'aal', 'aal2', 'app_metadata', '{}'::jsonb);
    ELSIF v_result = '__json_null__' THEN
      v_claims := pg_catalog.jsonb_build_object('sub', v_subadmin_id::text, 'aal', 'aal2',
        'app_metadata', pg_catalog.jsonb_build_object('role', NULL));
    ELSE
      v_claims := pg_catalog.jsonb_build_object('sub', v_subadmin_id::text, 'aal', 'aal2',
        'app_metadata', pg_catalog.jsonb_build_object('role', v_result));
    END IF;
    PERFORM pg_catalog.set_config('request.jwt.claims', v_claims::text, true);
    BEGIN
      PERFORM public.confirm_pickup('00000000-0000-0000-0000-000000000018'::uuid, 'Synthetic Test');
      RAISE EXCEPTION 'TEST_UNEXPECTED_INVALID_CLAIM_SUCCESS';
    EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_actual_error = MESSAGE_TEXT;
      IF v_actual_error IS DISTINCT FROM 'Unauthorized staff role.' THEN
        RAISE EXCEPTION 'FAIL: invalid role claim % was not rejected (%).', v_result, v_actual_error;
      END IF;
    END;
  END LOOP;

  -- Super-admin requires the exact active profile role claim and remains
  -- branch-global; the restrictive attendance MFA policy remains AAL2-only.
  v_claims := pg_catalog.jsonb_build_object('sub', v_superadmin_id::text, 'aal', 'aal2',
    'app_metadata', '{}'::jsonb);
  PERFORM pg_catalog.set_config('request.jwt.claim.sub', v_superadmin_id::text, true);
  PERFORM pg_catalog.set_config('request.jwt.claims', v_claims::text, true);
  IF public.is_shelf_superadmin() IS TRUE
     OR public.is_active_staff_for_branch(v_branch_b::text) IS TRUE THEN
    RAISE EXCEPTION 'FAIL: missing super-admin role claim authorized staff.';
  END IF;

  v_claims := pg_catalog.jsonb_build_object('sub', v_superadmin_id::text, 'aal', 'aal2',
    'app_metadata', pg_catalog.jsonb_build_object('role', NULL));
  PERFORM pg_catalog.set_config('request.jwt.claims', v_claims::text, true);
  IF public.is_shelf_superadmin() IS TRUE
     OR public.is_active_staff_for_branch(v_branch_b::text) IS TRUE THEN
    RAISE EXCEPTION 'FAIL: null super-admin role claim authorized staff.';
  END IF;

  FOREACH v_result IN ARRAY ARRAY['superadmin', '', 'subadmin'] LOOP
    v_claims := pg_catalog.jsonb_build_object('sub', v_superadmin_id::text, 'aal', 'aal2',
      'app_metadata', pg_catalog.jsonb_build_object('role', v_result));
    PERFORM pg_catalog.set_config('request.jwt.claim.sub', v_superadmin_id::text, true);
    PERFORM pg_catalog.set_config('request.jwt.claims', v_claims::text, true);
    IF (v_result = 'superadmin') IS DISTINCT FROM public.is_shelf_superadmin()
       OR (v_result = 'superadmin') IS DISTINCT FROM public.is_active_staff_for_branch(v_branch_b::text) THEN
      RAISE EXCEPTION 'FAIL: super-admin exact-claim authorization is incorrect.';
    END IF;
  END LOOP;

  v_claims := pg_catalog.jsonb_build_object('sub', v_superadmin_id::text, 'aal', 'aal1',
    'app_metadata', pg_catalog.jsonb_build_object('role', 'superadmin'));
  PERFORM pg_catalog.set_config('request.jwt.claims', v_claims::text, true);
  IF public.shelf_admin_mfa_access_allowed() IS TRUE THEN
    RAISE EXCEPTION 'FAIL: AAL1 super-admin passed attendance MFA policy helper.';
  END IF;
  v_claims := pg_catalog.jsonb_build_object('sub', v_superadmin_id::text, 'aal', 'aal2',
    'app_metadata', pg_catalog.jsonb_build_object('role', 'superadmin'));
  PERFORM pg_catalog.set_config('request.jwt.claims', v_claims::text, true);
  IF public.shelf_admin_mfa_access_allowed() IS NOT TRUE THEN
    RAISE EXCEPTION 'FAIL: AAL2 super-admin was rejected by attendance MFA policy helper.';
  END IF;

  -- ACL assertions include effective table grants and the limited column
  -- UPDATE contract needed by duplicate inventory import.
  IF has_table_privilege('anon', 'public.books', 'INSERT')
     OR has_table_privilege('anon', 'public.books', 'UPDATE')
     OR has_table_privilege('anon', 'public.books', 'DELETE')
     OR has_table_privilege('anon', 'public.books', 'TRUNCATE')
     OR has_table_privilege('anon', 'public.books', 'REFERENCES')
     OR has_table_privilege('anon', 'public.books', 'TRIGGER')
     OR has_table_privilege('anon', 'public.books', 'MAINTAIN')
     OR has_table_privilege('authenticated', 'public.books', 'TRUNCATE')
     OR has_table_privilege('authenticated', 'public.books', 'REFERENCES')
     OR has_table_privilege('authenticated', 'public.books', 'TRIGGER')
     OR has_table_privilege('authenticated', 'public.books', 'MAINTAIN')
     OR has_column_privilege('authenticated', 'public.books', 'title', 'UPDATE')
     OR has_column_privilege('authenticated', 'public.books', 'total_copies', 'UPDATE') IS NOT TRUE
     OR has_column_privilege('authenticated', 'public.books', 'available_copies', 'UPDATE') IS NOT TRUE
     OR has_column_privilege('authenticated', 'public.books', 'call_number', 'UPDATE') IS NOT TRUE THEN
    RAISE EXCEPTION 'FAIL: effective books privileges do not match the least-privilege contract.';
  END IF;
  IF has_table_privilege('anon', 'public.staff_profiles', 'SELECT')
     OR has_table_privilege('anon', 'public.staff_profiles', 'INSERT')
     OR has_table_privilege('anon', 'public.staff_profiles', 'UPDATE')
     OR has_table_privilege('anon', 'public.staff_profiles', 'DELETE')
     OR has_table_privilege('anon', 'public.staff_profiles', 'TRUNCATE')
     OR has_table_privilege('anon', 'public.staff_profiles', 'REFERENCES')
     OR has_table_privilege('anon', 'public.staff_profiles', 'TRIGGER')
     OR has_table_privilege('anon', 'public.staff_profiles', 'MAINTAIN')
     OR has_table_privilege('authenticated', 'public.staff_profiles', 'SELECT') IS NOT TRUE
     OR has_table_privilege('authenticated', 'public.staff_profiles', 'INSERT')
     OR has_table_privilege('authenticated', 'public.staff_profiles', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.staff_profiles', 'DELETE')
     OR has_table_privilege('authenticated', 'public.staff_profiles', 'TRUNCATE')
     OR has_table_privilege('authenticated', 'public.staff_profiles', 'REFERENCES')
     OR has_table_privilege('authenticated', 'public.staff_profiles', 'TRIGGER')
     OR has_table_privilege('authenticated', 'public.staff_profiles', 'MAINTAIN') THEN
    RAISE EXCEPTION 'FAIL: effective staff_profiles privileges do not match the least-privilege contract.';
  END IF;

  -- Effective column checks catch per-column ACLs and inherited membership
  -- grants that table-level privilege assertions would miss.
  FOR v_column IN
    SELECT relation.relname AS table_name, attribute.attname AS column_name
    FROM pg_catalog.pg_class AS relation
    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
    JOIN pg_catalog.pg_attribute AS attribute ON attribute.attrelid = relation.oid
    WHERE namespace.nspname = 'public'
      AND relation.relname IN ('books', 'staff_profiles')
      AND attribute.attnum > 0
      AND NOT attribute.attisdropped
  LOOP
    IF v_column.table_name = 'books' THEN
      v_expected_update := v_column.column_name IN ('total_copies', 'available_copies', 'call_number');
      IF has_column_privilege('anon', 'public.books', v_column.column_name, 'INSERT')
         OR has_column_privilege('anon', 'public.books', v_column.column_name, 'UPDATE')
         OR has_column_privilege('anon', 'public.books', v_column.column_name, 'REFERENCES')
         OR has_column_privilege('authenticated', 'public.books', v_column.column_name, 'UPDATE')
              IS DISTINCT FROM v_expected_update
         OR has_column_privilege('authenticated', 'public.books', v_column.column_name, 'REFERENCES') THEN
        RAISE EXCEPTION 'FAIL: unexpected effective column privilege on public.books.%;', v_column.column_name;
      END IF;
    ELSE
      IF has_column_privilege('anon', 'public.staff_profiles', v_column.column_name, 'INSERT')
         OR has_column_privilege('anon', 'public.staff_profiles', v_column.column_name, 'UPDATE')
         OR has_column_privilege('anon', 'public.staff_profiles', v_column.column_name, 'REFERENCES')
         OR has_column_privilege('authenticated', 'public.staff_profiles', v_column.column_name, 'INSERT')
         OR has_column_privilege('authenticated', 'public.staff_profiles', v_column.column_name, 'UPDATE')
         OR has_column_privilege('authenticated', 'public.staff_profiles', v_column.column_name, 'REFERENCES') THEN
        RAISE EXCEPTION 'FAIL: unexpected effective column privilege on public.staff_profiles.%;', v_column.column_name;
      END IF;
    END IF;
  END LOOP;

  IF has_table_privilege('anon', 'public.book_reviews', 'SELECT')
     OR has_table_privilege('anon', 'public.book_reviews', 'INSERT')
     OR has_table_privilege('anon', 'public.book_reviews', 'UPDATE')
     OR has_table_privilege('anon', 'public.book_reviews', 'DELETE')
     OR has_table_privilege('anon', 'public.book_reviews', 'TRUNCATE')
     OR has_table_privilege('anon', 'public.book_reviews', 'REFERENCES')
     OR has_table_privilege('anon', 'public.book_reviews', 'TRIGGER')
     OR has_table_privilege('anon', 'public.book_reviews', 'MAINTAIN')
     OR has_table_privilege('authenticated', 'public.book_reviews', 'SELECT')
     OR has_table_privilege('authenticated', 'public.book_reviews', 'INSERT')
     OR has_table_privilege('authenticated', 'public.book_reviews', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.book_reviews', 'DELETE')
     OR has_table_privilege('authenticated', 'public.book_reviews', 'TRUNCATE')
     OR has_table_privilege('authenticated', 'public.book_reviews', 'REFERENCES')
     OR has_table_privilege('authenticated', 'public.book_reviews', 'TRIGGER')
     OR has_table_privilege('authenticated', 'public.book_reviews', 'MAINTAIN') THEN
    RAISE EXCEPTION 'FAIL: direct application access to raw book_reviews remains.';
  END IF;

  -- Review RPC response contracts retain visitor_name as a generic label but
  -- return no visitor identifier or raw identity field.
  IF pg_catalog.pg_get_function_result('public.get_book_reviews(text,integer,integer)'::regprocedure)
       NOT LIKE 'TABLE(id uuid, visitor_name text, rating smallint, comment text, created_at timestamp with time zone, is_own boolean)'
     OR pg_catalog.pg_get_function_result('public.save_my_book_review(text,integer,text)'::regprocedure)
       NOT LIKE 'TABLE(id uuid, visitor_name text, rating smallint, comment text, created_at timestamp with time zone, is_own boolean)' THEN
    RAISE EXCEPTION 'FAIL: book review RPC response columns changed unexpectedly.';
  END IF;
  v_definition := pg_catalog.pg_get_functiondef('public.get_book_reviews(text,integer,integer)'::regprocedure);
  IF pg_catalog.strpos(v_definition, '''Verified Reader''::text') = 0
     OR pg_catalog.strpos(v_definition, 'review.visitor_name') > 0
     OR pg_catalog.strpos(pg_catalog.pg_get_function_result('public.get_book_reviews(text,integer,integer)'::regprocedure), 'visitor_id') > 0 THEN
    RAISE EXCEPTION 'FAIL: public review responses may expose identity.';
  END IF;
  v_definition := pg_catalog.pg_get_functiondef('public.save_my_book_review(text,integer,text)'::regprocedure);
  IF pg_catalog.strpos(v_definition, '''Verified Reader''::text') = 0
     OR pg_catalog.strpos(v_definition, 'saved.visitor_name') > 0
     OR pg_catalog.strpos(v_definition, 'visitor.auth_user_id = public.shelf_rpc_request_uid()') = 0 THEN
    RAISE EXCEPTION 'FAIL: save review response or server-side ownership contract is incorrect.';
  END IF;

  IF pg_catalog.has_function_privilege('anon', 'public.is_active_staff_for_branch(text)', 'EXECUTE')
     OR pg_catalog.has_function_privilege('anon', 'public.is_shelf_superadmin()', 'EXECUTE')
     OR pg_catalog.has_function_privilege('authenticated', 'public.is_active_staff_for_branch(text)', 'EXECUTE') IS NOT TRUE
     OR pg_catalog.has_function_privilege('authenticated', 'public.is_shelf_superadmin()', 'EXECUTE') IS NOT TRUE
     OR pg_catalog.has_function_privilege('service_role', 'public.is_active_staff_for_branch(text)', 'EXECUTE') IS NOT TRUE
     OR pg_catalog.has_function_privilege('service_role', 'public.is_shelf_superadmin()', 'EXECUTE') IS NOT TRUE
     OR pg_catalog.has_function_privilege('anon', 'public.get_book_reviews(text,integer,integer)', 'EXECUTE') IS NOT TRUE
     OR pg_catalog.has_function_privilege('authenticated', 'public.get_book_reviews(text,integer,integer)', 'EXECUTE') IS NOT TRUE
     OR pg_catalog.has_function_privilege('authenticated', 'public.save_my_book_review(text,integer,text)', 'EXECUTE') IS NOT TRUE
     OR pg_catalog.has_function_privilege('service_role', 'public.get_book_reviews(text,integer,integer)', 'EXECUTE') IS NOT TRUE
     OR pg_catalog.has_function_privilege('service_role', 'public.save_my_book_review(text,integer,text)', 'EXECUTE')
     OR pg_catalog.has_function_privilege('anon', 'public.save_my_book_review(text,integer,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'FAIL: helper/review RPC EXECUTE grants changed unexpectedly.';
  END IF;
END;
$tests$;

-- A service-role credential without a signed-in user/AAL2 context must not
-- bypass the legacy UUID RPC guard. This impersonates a database role with
-- synthetic empty request claims; it is not a real Supabase Auth session.
DO $service_role_test_preflight$
BEGIN
  IF NOT pg_catalog.pg_has_role(current_user, 'service_role', 'SET') THEN
    RAISE EXCEPTION 'Cannot run the service_role RPC assertion as %; use the disposable database postgres administrator.', current_user;
  END IF;
END;
$service_role_test_preflight$;
SET LOCAL ROLE service_role;
DO $service_role_handover$
DECLARE
  v_actual_error text;
BEGIN
  PERFORM pg_catalog.set_config('request.jwt.claim.sub', '', true);
  PERFORM pg_catalog.set_config('request.jwt.claims', '{}'::text, true);
  BEGIN
    PERFORM public.confirm_pickup('00000000-0000-0000-0000-000000000018'::uuid, 'Synthetic Service Role');
    RAISE EXCEPTION 'TEST_UNEXPECTED_SERVICE_ROLE_SUCCESS';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_actual_error = MESSAGE_TEXT;
    IF v_actual_error IS DISTINCT FROM 'Authenticated staff account required.' THEN
      RAISE EXCEPTION 'FAIL: service_role unexpectedly bypassed the UUID handover guard (%).', v_actual_error;
    END IF;
  END;
END;
$service_role_handover$;
RESET ROLE;

ROLLBACK;