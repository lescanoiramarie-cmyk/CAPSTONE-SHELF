-- Read-only catalog regression assertions for the forward security migrations.
-- Run after the complete migration chain in a disposable PostgreSQL database.
DO $security_release_assertions$
DECLARE
  v_signature text;
  v_oid oid;
  v_definition text;
  v_result text;
  v_acl_count integer;
  v_expected record;
  v_policy_count integer;
  v_policy_roles oid[];
  v_policy_command "char";
  v_policy_permissive boolean;
  v_policy_using text;
  v_policy_check text;
  v_privilege text;
BEGIN
  FOR v_expected IN
    SELECT * FROM (VALUES
      ('public.is_active_staff_for_branch(text)', 'postgres', 'sql', 's', true, ARRAY['search_path=public']::text[]),
      ('public.is_shelf_superadmin()', 'postgres', 'sql', 's', true, ARRAY['search_path=public, pg_temp']::text[]),
      ('public.find_visitor_by_qr(text,uuid)', 'shelf_attendance_rpc_owner', 'plpgsql', 's', true, ARRAY['search_path=""']::text[]),
      ('public.toggle_attendance(text,text)', 'shelf_attendance_rpc_owner', 'plpgsql', 'v', true, ARRAY['search_path=""']::text[]),
      ('public.lookup_attendance_visitor_v2(text,text)', 'shelf_attendance_rpc_owner', 'plpgsql', 'v', true, ARRAY['search_path=""']::text[]),
      ('public.confirm_pickup(text,text)', 'postgres', 'plpgsql', 'v', true, ARRAY['search_path=public']::text[]),
      ('public.confirm_return(text,text)', 'postgres', 'plpgsql', 'v', true, ARRAY['search_path=public']::text[]),
      ('public.confirm_pickup(uuid,text)', 'postgres', 'plpgsql', 'v', true, ARRAY['search_path=""']::text[]),
      ('public.confirm_return(uuid,text)', 'postgres', 'plpgsql', 'v', true, ARRAY['search_path=""']::text[]),
      ('public.get_fine_payment_analytics(text)', 'postgres', 'plpgsql', 'v', true, ARRAY['search_path=public, pg_temp']::text[]),
      ('public.get_fine_payment_dashboard(text)', 'postgres', 'plpgsql', 'v', true, ARRAY['search_path=public, pg_temp']::text[]),
      ('public.get_fine_payment_alert_targets(text)', 'postgres', 'plpgsql', 'v', true, ARRAY['search_path=public, pg_temp']::text[]),
      ('public.get_book_reviews(text,integer,integer)', 'shelf_book_reviews_rpc_owner', 'plpgsql', 's', true, ARRAY['search_path=""']::text[]),
      ('public.save_my_book_review(text,integer,text)', 'shelf_book_reviews_rpc_owner', 'plpgsql', 'v', true, ARRAY['search_path=""']::text[]),
      ('public.delete_my_book_review(text)', 'shelf_book_reviews_rpc_owner', 'plpgsql', 'v', true, ARRAY['search_path=""']::text[])
    ) AS expected(signature, owner_name, language_name, volatility, security_definer, config)
  LOOP
    v_oid := pg_catalog.to_regprocedure(v_expected.signature)::oid;
    IF v_oid IS NULL OR NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_proc AS procedure
      JOIN pg_catalog.pg_language AS language ON language.oid = procedure.prolang
      WHERE procedure.oid = v_oid
        AND pg_catalog.pg_get_userbyid(procedure.proowner) = v_expected.owner_name
        AND language.lanname = v_expected.language_name
        AND procedure.provolatile = v_expected.volatility::"char"
        AND procedure.prosecdef = v_expected.security_definer
        AND procedure.proconfig IS NOT DISTINCT FROM v_expected.config
    ) THEN
      RAISE EXCEPTION 'Function metadata mismatch for %.', v_expected.signature;
    END IF;
  END LOOP;

  -- Exact handover/terms function metadata and explicit/effective grants.
  FOR v_expected IN
    SELECT * FROM (VALUES
      ('public.confirm_pickup(text,text)', 'text, text', 'void', ARRAY['postgres','authenticated']::text[], false, ARRAY['search_path=public']::text[]),
      ('public.confirm_return(text,text)', 'text, text', 'void', ARRAY['postgres','authenticated']::text[], false, ARRAY['search_path=public']::text[]),
      ('public.confirm_pickup(uuid,text)', 'uuid, text', 'void', ARRAY['postgres','authenticated','service_role']::text[], true, ARRAY['search_path=""']::text[]),
      ('public.confirm_return(uuid,text)', 'uuid, text', 'void', ARRAY['postgres','authenticated','service_role']::text[], true, ARRAY['search_path=""']::text[]),
      ('public.accept_subadmin_terms()', '', 'timestamp with time zone', ARRAY['postgres','authenticated','service_role']::text[], true, ARRAY['search_path=public, pg_temp']::text[])
    ) AS expected(signature, argument_types, return_type, grantees, service_role_execute, config)
  LOOP
    v_oid := pg_catalog.to_regprocedure(v_expected.signature)::oid;
    IF v_oid IS NULL OR NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_proc AS procedure
      JOIN pg_catalog.pg_language AS language ON language.oid = procedure.prolang
      WHERE procedure.oid = v_oid
        AND procedure.proowner = 'postgres'::regrole::oid
        AND pg_catalog.oidvectortypes(procedure.proargtypes) = v_expected.argument_types
        AND pg_catalog.format_type(procedure.prorettype, NULL) = v_expected.return_type
        AND language.lanname = 'plpgsql'
        AND procedure.provolatile = 'v'::"char"
        AND procedure.prosecdef IS TRUE
        AND procedure.proconfig IS NOT DISTINCT FROM v_expected.config
        AND procedure.proacl IS NOT NULL
    ) THEN
      RAISE EXCEPTION 'Handover/terms metadata mismatch for %.', v_expected.signature;
    END IF;

    SELECT pg_catalog.count(*) INTO v_acl_count
    FROM pg_catalog.pg_proc AS procedure
    CROSS JOIN LATERAL pg_catalog.aclexplode(procedure.proacl) AS acl
    WHERE procedure.oid = v_oid;

    IF v_acl_count <> pg_catalog.cardinality(v_expected.grantees)
       OR EXISTS (
         SELECT 1 FROM pg_catalog.pg_proc AS procedure
         CROSS JOIN LATERAL pg_catalog.aclexplode(procedure.proacl) AS acl
         WHERE procedure.oid = v_oid
           AND (acl.privilege_type <> 'EXECUTE'
             OR acl.is_grantable IS TRUE
             OR acl.grantor <> 'postgres'::regrole::oid
             OR (CASE WHEN acl.grantee = 0::oid THEN 'PUBLIC'::text
                      ELSE pg_catalog.pg_get_userbyid(acl.grantee)::text END)
                  <> ALL (v_expected.grantees))
       )
       OR EXISTS (
         SELECT 1 FROM pg_catalog.unnest(v_expected.grantees) AS expected(grantee_name)
         WHERE NOT EXISTS (
           SELECT 1 FROM pg_catalog.pg_proc AS procedure
           CROSS JOIN LATERAL pg_catalog.aclexplode(procedure.proacl) AS acl
           WHERE procedure.oid = v_oid
             AND (CASE WHEN acl.grantee = 0::oid THEN 'PUBLIC'::text
                       ELSE pg_catalog.pg_get_userbyid(acl.grantee)::text END)
                   = expected.grantee_name
             AND acl.privilege_type = 'EXECUTE'
             AND acl.is_grantable IS FALSE
             AND acl.grantor = 'postgres'::regrole::oid
         )
       )
       OR pg_catalog.has_function_privilege('anon', v_oid, 'EXECUTE') IS TRUE
       OR pg_catalog.has_function_privilege('authenticated', v_oid, 'EXECUTE') IS NOT TRUE
       OR pg_catalog.has_function_privilege('service_role', v_oid, 'EXECUTE')
            IS DISTINCT FROM v_expected.service_role_execute THEN
      RAISE EXCEPTION 'Handover/terms exact ACL or effective grant mismatch for %.', v_expected.signature;
    END IF;
  END LOOP;

  FOREACH v_signature IN ARRAY ARRAY[
    'public.confirm_pickup(text,text)',
    'public.confirm_return(text,text)',
    'public.confirm_pickup(uuid,text)',
    'public.confirm_return(uuid,text)'
  ] LOOP
    v_definition := pg_catalog.pg_get_functiondef(
      pg_catalog.to_regprocedure(v_signature)
    );
    IF pg_catalog.strpos(v_definition, 'IS DISTINCT FROM ''aal2''') = 0 THEN
      RAISE EXCEPTION 'Handover function % lacks fail-closed AAL2 validation.', v_signature;
    END IF;
    IF v_signature IN (
         'public.confirm_pickup(text,text)',
         'public.confirm_return(text,text)'
       ) AND pg_catalog.strpos(v_definition, 'is_active_staff_for_branch') = 0 THEN
      RAISE EXCEPTION 'Legacy text handover function % lacks branch authorization.', v_signature;
    END IF;
    IF v_signature IN (
         'public.confirm_pickup(uuid,text)',
         'public.confirm_return(uuid,text)'
       ) AND (
         pg_catalog.strpos(v_definition, 'IS DISTINCT FROM v_staff_role') = 0
         OR pg_catalog.strpos(v_definition, 'COALESCE(v_jwt_role, v_staff_role)') > 0
       ) THEN
      RAISE EXCEPTION 'Legacy UUID handover function % lacks exact fail-closed role matching.', v_signature;
    END IF;
  END LOOP;

  -- Fail-closed attendance helpers, RPC authorization and branch-scoped RLS.
  FOREACH v_signature IN ARRAY ARRAY[
    'public.is_active_staff_for_branch(text)',
    'public.is_shelf_superadmin()',
    'public.find_visitor_by_qr(text,uuid)',
    'public.toggle_attendance(text,text)'
  ] LOOP
    v_oid := pg_catalog.to_regprocedure(v_signature)::oid;
    IF v_oid IS NULL THEN
      RAISE EXCEPTION 'Required attendance security function % is missing.', v_signature;
    END IF;
    SELECT pg_catalog.pg_get_functiondef(v_oid) INTO v_definition;
    IF pg_catalog.strpos(v_definition, 'app_metadata') = 0
       OR pg_catalog.strpos(v_definition, 'role') = 0
       OR pg_catalog.strpos(v_definition, 'COALESCE(auth.jwt() -> ''app_metadata'' ->> ''role'', staff.role)') > 0 THEN
      RAISE EXCEPTION 'Function % lacks fail-closed JWT role validation.', v_signature;
    END IF;
  END LOOP;

  FOREACH v_signature IN ARRAY ARRAY[
    'public.find_visitor_by_qr(text,uuid)',
    'public.toggle_attendance(text,text)'
  ] LOOP
    v_definition := pg_catalog.pg_get_functiondef(pg_catalog.to_regprocedure(v_signature));
    IF pg_catalog.strpos(v_definition, 'aal2') = 0
       OR pg_catalog.strpos(v_definition, 'is_active IS TRUE') = 0
       OR pg_catalog.strpos(v_definition, 'subadmin') = 0
       OR pg_catalog.strpos(v_definition, 'superadmin') = 0
       OR pg_catalog.strpos(v_definition, 'IS DISTINCT FROM v_role') = 0 THEN
      RAISE EXCEPTION 'Attendance RPC % lacks AAL2, active staff, supported-role, or claim-match checks.', v_signature;
    END IF;
  END LOOP;

  IF pg_catalog.has_table_privilege('anon', 'public.attendance_logs', 'SELECT')
     OR EXISTS (
       SELECT 1 FROM pg_catalog.pg_policy AS policy
       WHERE policy.polrelid = 'public.attendance_logs'::regclass
         AND policy.polcmd IN ('r', '*')
         AND (0::oid = ANY(policy.polroles) OR 'anon'::regrole::oid = ANY(policy.polroles))
         AND (policy.polqual IS NULL OR pg_catalog.pg_get_expr(policy.polqual, policy.polrelid) IN ('true', '(true)'))
     ) THEN
    RAISE EXCEPTION 'Anonymous or unconditional public attendance SELECT remains possible.';
  END IF;

  v_result := pg_catalog.pg_get_function_result('public.lookup_attendance_visitor_v2(text,text)'::regprocedure);
  IF v_result <> 'TABLE(id text, full_name character varying, contact_number character varying, email character varying, address text, qr_code character varying, profile_image_path text)' THEN
    RAISE EXCEPTION 'Attendance v2 response contract changed: %', v_result;
  END IF;
  IF pg_catalog.has_function_privilege('anon', 'public.lookup_attendance_visitor_v2(text,text)', 'EXECUTE')
     OR NOT pg_catalog.has_function_privilege('authenticated', 'public.lookup_attendance_visitor_v2(text,text)', 'EXECUTE')
     OR pg_catalog.has_function_privilege('service_role', 'public.lookup_attendance_visitor_v2(text,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Attendance v2 EXECUTE grants differ from the authenticated-only contract.';
  END IF;

  -- Fine responses: the staff dashboard is Sub-admin detail only; the
  -- Super Admin endpoint has aggregates, never payment/request identities.
  v_result := pg_catalog.pg_get_function_result('public.get_fine_payment_analytics(text)'::regprocedure);
  IF v_result LIKE '%visitor_id%'
     OR v_result LIKE '%visitor_name%'
     OR v_result LIKE '%request_id%'
     OR v_result LIKE '%payment_id%'
     OR v_result LIKE '%reference%'
     OR v_result LIKE '%note%' THEN
    RAISE EXCEPTION 'Aggregate fine analytics return shape contains an identifying field: %', v_result;
  END IF;
  v_definition := pg_catalog.pg_get_functiondef('public.get_fine_payment_analytics(text)'::regprocedure);
  IF pg_catalog.strpos(v_definition, 'IS DISTINCT FROM v_role') = 0
     OR pg_catalog.strpos(v_definition, 'aal2') = 0
     OR pg_catalog.strpos(v_definition, 'staff.is_active IS TRUE') = 0
     OR pg_catalog.strpos(v_definition, 'v_role = ''subadmin''') = 0
     OR pg_catalog.strpos(v_definition, 'v_role = ''superadmin''') = 0 THEN
    RAISE EXCEPTION 'Fine analytics lacks its AAL2, active-role, or role-claim guard.';
  END IF;
  FOREACH v_signature IN ARRAY ARRAY[
    'public.get_fine_payment_dashboard(text)',
    'public.get_fine_payment_alert_targets(text)',
    'public.record_fine_payment(text,numeric,text,text,text)',
    'public.resolve_fine_review(text,text,numeric,text)'
  ] LOOP
    v_oid := pg_catalog.to_regprocedure(v_signature)::oid;
    IF v_oid IS NULL THEN
      RAISE EXCEPTION 'Required fine RPC % is missing.', v_signature;
    END IF;
    v_definition := pg_catalog.pg_get_functiondef(v_oid);
    IF pg_catalog.strpos(v_definition, 'IS DISTINCT FROM v_role') = 0
       OR pg_catalog.strpos(v_definition, 'aal2') = 0
       OR pg_catalog.strpos(v_definition, 'staff.is_active IS TRUE') = 0 THEN
      RAISE EXCEPTION 'Fine RPC % lacks AAL2, active staff, or fail-closed role validation.', v_signature;
    END IF;
  END LOOP;
  IF pg_catalog.has_function_privilege('anon', 'public.get_fine_payment_analytics(text)', 'EXECUTE')
     OR NOT pg_catalog.has_function_privilege('authenticated', 'public.get_fine_payment_analytics(text)', 'EXECUTE')
     OR pg_catalog.has_function_privilege('service_role', 'public.get_fine_payment_analytics(text)', 'EXECUTE')
     OR pg_catalog.has_function_privilege('anon', 'public.get_fine_payment_dashboard(text)', 'EXECUTE')
     OR NOT pg_catalog.has_function_privilege('authenticated', 'public.get_fine_payment_dashboard(text)', 'EXECUTE')
     OR pg_catalog.has_function_privilege('service_role', 'public.get_fine_payment_dashboard(text)', 'EXECUTE')
     OR pg_catalog.has_function_privilege('anon', 'public.get_fine_payment_alert_targets(text)', 'EXECUTE')
     OR NOT pg_catalog.has_function_privilege('authenticated', 'public.get_fine_payment_alert_targets(text)', 'EXECUTE')
      OR pg_catalog.has_function_privilege('service_role', 'public.get_fine_payment_alert_targets(text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Fine analytics/table grants expose an unauthorized read path.';
  END IF;

  -- The ledger migrations explicitly deny direct anon/authenticated access.
  -- Do not assert or alter an existing service_role table ACL here: that
  -- object-level permission must be reconciled against its deployed baseline.
  FOR v_expected IN
    SELECT role_name FROM (VALUES ('anon'::text), ('authenticated')) AS roles(role_name)
  LOOP
    FOREACH v_privilege IN ARRAY ARRAY[
      'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'
    ] LOOP
      IF pg_catalog.has_table_privilege(
        v_expected.role_name,
        'public.fine_payments',
        v_privilege
      ) THEN
        RAISE EXCEPTION 'Role % has unexpected direct/inherited % on fine_payments.',
          v_expected.role_name, v_privilege;
      END IF;
    END LOOP;
  END LOOP;

  -- Review table is private; read responses contain only a generic label and
  -- writes derive the visitor from the verified session.
  IF NOT (SELECT relation.relrowsecurity FROM pg_catalog.pg_class AS relation
          WHERE relation.oid = 'public.book_reviews'::regclass)
     OR pg_catalog.has_table_privilege('anon', 'public.book_reviews', 'SELECT')
     OR pg_catalog.has_table_privilege('authenticated', 'public.book_reviews', 'SELECT')
     OR pg_catalog.has_table_privilege('anon', 'public.book_reviews', 'INSERT')
     OR pg_catalog.has_table_privilege('anon', 'public.book_reviews', 'UPDATE')
     OR pg_catalog.has_table_privilege('anon', 'public.book_reviews', 'DELETE')
     OR pg_catalog.has_table_privilege('anon', 'public.book_reviews', 'TRUNCATE')
     OR pg_catalog.has_table_privilege('anon', 'public.book_reviews', 'REFERENCES')
     OR pg_catalog.has_table_privilege('anon', 'public.book_reviews', 'TRIGGER')
     OR pg_catalog.has_table_privilege('authenticated', 'public.book_reviews', 'INSERT')
     OR pg_catalog.has_table_privilege('authenticated', 'public.book_reviews', 'UPDATE')
     OR pg_catalog.has_table_privilege('authenticated', 'public.book_reviews', 'DELETE')
     OR pg_catalog.has_table_privilege('authenticated', 'public.book_reviews', 'TRUNCATE')
     OR pg_catalog.has_table_privilege('authenticated', 'public.book_reviews', 'REFERENCES')
     OR pg_catalog.has_table_privilege('authenticated', 'public.book_reviews', 'TRIGGER') THEN
    RAISE EXCEPTION 'Book review direct access or RLS differs from the private-table contract.';
  END IF;
  FOREACH v_privilege IN ARRAY ARRAY[
    'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'
  ] LOOP
    IF pg_catalog.has_table_privilege('service_role', 'public.book_reviews', v_privilege) THEN
      RAISE EXCEPTION 'service_role has unexpected direct/inherited % on book_reviews.', v_privilege;
    END IF;
  END LOOP;

  -- The only named private-table policies installed by the review migration
  -- must remain scoped to the dedicated RPC owner. Direct table privileges
  -- are revoked above; these policies are not an application-facing read path.
  SELECT pg_catalog.count(*)::integer
    INTO v_policy_count
    FROM pg_catalog.pg_policy AS policy
   WHERE policy.polrelid = 'public.book_reviews'::regclass
     AND policy.polname = 'book review RPC owner reads reviews';
  IF v_policy_count = 1 THEN
    SELECT policy.polroles, policy.polcmd, policy.polpermissive,
           pg_catalog.pg_get_expr(policy.polqual, policy.polrelid),
           pg_catalog.pg_get_expr(policy.polwithcheck, policy.polrelid)
      INTO v_policy_roles, v_policy_command, v_policy_permissive,
           v_policy_using, v_policy_check
      FROM pg_catalog.pg_policy AS policy
     WHERE policy.polrelid = 'public.book_reviews'::regclass
       AND policy.polname = 'book review RPC owner reads reviews';
  END IF;
  IF v_policy_count <> 1
     OR v_policy_roles IS DISTINCT FROM ARRAY['shelf_book_reviews_rpc_owner'::regrole::oid]
     OR v_policy_command IS DISTINCT FROM '*'::"char"
     OR v_policy_permissive IS DISTINCT FROM TRUE
     OR v_policy_using IS DISTINCT FROM 'true'
     OR v_policy_check IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION 'Book review RPC-owner policy differs from the private-table contract.';
  END IF;

  SELECT pg_catalog.count(*)::integer
    INTO v_policy_count
    FROM pg_catalog.pg_policy AS policy
   WHERE policy.polrelid = 'public.visitors'::regclass
     AND policy.polname = 'book review RPC owner reads visitors';
  IF v_policy_count = 1 THEN
    SELECT policy.polroles, policy.polcmd, policy.polpermissive,
           pg_catalog.pg_get_expr(policy.polqual, policy.polrelid)
      INTO v_policy_roles, v_policy_command, v_policy_permissive,
           v_policy_using
      FROM pg_catalog.pg_policy AS policy
     WHERE policy.polrelid = 'public.visitors'::regclass
       AND policy.polname = 'book review RPC owner reads visitors';
  END IF;
  IF v_policy_count <> 1
     OR v_policy_roles IS DISTINCT FROM ARRAY['shelf_book_reviews_rpc_owner'::regrole::oid]
     OR v_policy_command IS DISTINCT FROM 'r'::"char"
     OR v_policy_permissive IS DISTINCT FROM TRUE
     OR v_policy_using IS NULL
     OR v_policy_using !~* 'auth_user_id[[:space:]]*=[[:space:]]*(public[.])?shelf_rpc_request_uid[[:space:]]*[(][[:space:]]*[)]'
     OR v_policy_using !~* 'otp_verified[[:space:]]+IS[[:space:]]+TRUE'
     OR v_policy_using !~* 'is_active[[:space:]]+IS[[:space:]]+TRUE'
     OR pg_catalog.regexp_count(v_policy_using, 'auth_user_id', 1, 'i') <> 1
     OR pg_catalog.regexp_count(v_policy_using, 'shelf_rpc_request_uid', 1, 'i') <> 1
     OR pg_catalog.regexp_count(v_policy_using, 'otp_verified', 1, 'i') <> 1
     OR pg_catalog.regexp_count(v_policy_using, 'is_active', 1, 'i') <> 1 THEN
    RAISE EXCEPTION 'Visitor identity policy for review RPC differs from the verified-active-owner contract.';
  END IF;
  v_result := pg_catalog.pg_get_function_result('public.get_book_reviews(text,integer,integer)'::regprocedure);
  IF v_result NOT LIKE 'TABLE(id text, visitor_name text, rating integer, comment text, created_at timestamp with time zone, is_own boolean)'
     OR v_result LIKE '%visitor_id%' THEN
    RAISE EXCEPTION 'Safe review RPC response contains an unexpected field: %', v_result;
  END IF;
  v_definition := pg_catalog.pg_get_functiondef('public.get_book_reviews(text,integer,integer)'::regprocedure);
  IF pg_catalog.strpos(v_definition, '''Verified Reader''::text') = 0
     OR pg_catalog.strpos(v_definition, 'review.visitor_name') > 0 THEN
    RAISE EXCEPTION 'Public review response can reveal a visitor name.';
  END IF;
  FOREACH v_signature IN ARRAY ARRAY[
    'public.save_my_book_review(text,integer,text)',
    'public.delete_my_book_review(text)'
  ] LOOP
    v_definition := pg_catalog.pg_get_functiondef(pg_catalog.to_regprocedure(v_signature));
    IF pg_catalog.strpos(v_definition, 'shelf_rpc_request_uid()') = 0
       OR pg_catalog.strpos(v_definition, 'visitor.auth_user_id') = 0
       OR pg_catalog.strpos(v_definition, 'visitor.otp_verified IS TRUE') = 0
       OR pg_catalog.strpos(v_definition, 'visitor.is_active IS TRUE') = 0 THEN
      RAISE EXCEPTION 'Review write RPC % lacks server-derived verified ownership.', v_signature;
    END IF;
  END LOOP;

  -- Books/staff_profiles: validate effective table privileges, including
  -- destructive/reference/trigger privileges and column UPDATE boundaries.
  IF NOT pg_catalog.has_table_privilege('anon', 'public.books', 'SELECT')
     OR pg_catalog.has_table_privilege('anon', 'public.books', 'INSERT')
     OR pg_catalog.has_table_privilege('anon', 'public.books', 'UPDATE')
     OR pg_catalog.has_table_privilege('anon', 'public.books', 'DELETE')
     OR pg_catalog.has_table_privilege('anon', 'public.books', 'TRUNCATE')
     OR pg_catalog.has_table_privilege('anon', 'public.books', 'REFERENCES')
     OR pg_catalog.has_table_privilege('anon', 'public.books', 'TRIGGER')
     OR pg_catalog.has_table_privilege('authenticated', 'public.books', 'TRUNCATE')
     OR pg_catalog.has_table_privilege('authenticated', 'public.books', 'REFERENCES')
     OR pg_catalog.has_table_privilege('authenticated', 'public.books', 'TRIGGER')
     OR pg_catalog.has_table_privilege('anon', 'public.staff_profiles', 'SELECT')
     OR pg_catalog.has_table_privilege('authenticated', 'public.staff_profiles', 'INSERT')
     OR pg_catalog.has_table_privilege('authenticated', 'public.staff_profiles', 'UPDATE')
     OR pg_catalog.has_table_privilege('authenticated', 'public.staff_profiles', 'DELETE')
     OR pg_catalog.has_table_privilege('authenticated', 'public.staff_profiles', 'TRUNCATE')
     OR pg_catalog.has_table_privilege('authenticated', 'public.staff_profiles', 'REFERENCES')
     OR pg_catalog.has_table_privilege('authenticated', 'public.staff_profiles', 'TRIGGER') THEN
    RAISE EXCEPTION 'Books or staff_profiles has an unexpected effective API privilege.';
  END IF;

  IF (SELECT pg_catalog.count(*)
      FROM pg_catalog.pg_policy AS policy
      WHERE policy.polrelid = 'public.announcements'::regclass
        AND policy.polname = 'staff manage announcements') <> 1
     OR NOT EXISTS (
       SELECT 1
       FROM pg_catalog.pg_policy AS policy
       WHERE policy.polrelid = 'public.announcements'::regclass
         AND policy.polname = 'staff manage announcements'
         AND policy.polcmd = '*'
         AND policy.polpermissive IS TRUE
         AND policy.polroles = ARRAY['authenticated'::regrole::oid]
         AND pg_catalog.pg_get_expr(policy.polqual, policy.polrelid) IS NOT NULL
         AND pg_catalog.pg_get_expr(policy.polwithcheck, policy.polrelid) IS NOT NULL
         AND pg_catalog.pg_get_expr(policy.polqual, policy.polrelid)
               IS NOT DISTINCT FROM pg_catalog.pg_get_expr(policy.polwithcheck, policy.polrelid)
         AND pg_catalog.regexp_replace(
               pg_catalog.lower(pg_catalog.pg_get_expr(policy.polqual, policy.polrelid)),
               '[[:space:]()]', '', 'g'
             ) ~ '^(public[.])?is_active_staff_for_branch([a-z_][a-z0-9_]*[.])?library_id::text$'
     ) THEN
    RAISE EXCEPTION 'Announcements policy identity, command, roles, permissiveness, USING, or WITH CHECK differs from the expected branch-scoped definition.';
  END IF;

  -- PostgreSQL-owner defaults must not grant API roles future table, sequence,
  -- or function privileges. Table/sequence ACLs that are absent retain the
  -- owner-only PostgreSQL baseline. Functions need an explicit global row to
  -- remove PostgreSQL's default PUBLIC EXECUTE. supabase_admin defaults remain
  -- platform-managed and are intentionally not asserted or changed here.
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_default_acl AS defaults
    WHERE defaults.defaclrole = 'postgres'::regrole::oid
      AND defaults.defaclnamespace = 0
      AND defaults.defaclobjtype = 'f'
  ) THEN
    RAISE EXCEPTION 'Postgres global function default ACL is missing; PUBLIC EXECUTE may be inherited by future functions.';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_default_acl AS defaults
    CROSS JOIN LATERAL pg_catalog.aclexplode(
      COALESCE(defaults.defaclacl,
        pg_catalog.acldefault(defaults.defaclobjtype, defaults.defaclrole))
    ) AS acl
    WHERE defaults.defaclrole = 'postgres'::regrole::oid
      AND defaults.defaclobjtype IN ('r', 'S', 'f')
      AND defaults.defaclnamespace IN (0::oid, 'public'::regnamespace::oid)
      AND acl.grantee IN (0::oid, 'anon'::regrole::oid, 'authenticated'::regrole::oid, 'service_role'::regrole::oid)
  ) THEN
    RAISE EXCEPTION 'Postgres global/public default ACL still grants an API role.';
  END IF;
  IF pg_catalog.pg_has_role('anon', 'postgres', 'MEMBER')
     OR pg_catalog.pg_has_role('authenticated', 'postgres', 'MEMBER')
     OR pg_catalog.pg_has_role('service_role', 'postgres', 'MEMBER') THEN
    RAISE EXCEPTION 'An API role can assume postgres and bypass least-privilege defaults.';
  END IF;
END;
$security_release_assertions$;
