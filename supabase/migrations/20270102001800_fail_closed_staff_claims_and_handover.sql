-- Close remaining role-claim fallback paths in staff authorization and keep
-- direct legacy pickup/return overloads behind the same AAL2 gate as their v2
-- PostgREST endpoints. No business records are changed.
BEGIN;

DO $hardening$
DECLARE
  v_signature text;
  v_oid oid;
  v_definition text;
  v_updated_definition text;
  v_owner oid;
  v_language oid;
  v_volatility "char";
  v_return_type oid;
  v_config text[];
  v_acl aclitem[];
  v_secdef boolean;
  v_after_owner oid;
  v_after_language oid;
  v_after_volatility "char";
  v_after_return_type oid;
  v_after_config text[];
  v_after_acl aclitem[];
  v_after_secdef boolean;
  v_expected_arguments text;
  v_expected_return_type oid;
  v_expected_config text[];
  v_expected_grantees text[];
  v_acl_count integer;
  v_expected_service_role boolean;
  v_old_count integer;
  v_new_count integer;
  v_signatures text[] := ARRAY[
    'public.confirm_pickup(text,text)',
    'public.confirm_return(text,text)',
    'public.confirm_pickup(uuid,text)',
    'public.confirm_return(uuid,text)',
    'public.accept_subadmin_terms()'
  ];
BEGIN
  IF current_user <> 'postgres' THEN
    RAISE EXCEPTION 'Staff claim hardening requires current_user=postgres; found %', current_user;
  END IF;

  FOREACH v_signature IN ARRAY v_signatures LOOP
    v_oid := pg_catalog.to_regprocedure(v_signature)::oid;
    IF v_oid IS NULL THEN
      RAISE EXCEPTION 'Required staff function % is missing; refusing a partial hardening.', v_signature;
    END IF;

    SELECT p.proowner, p.prolang, p.provolatile, p.prorettype,
           p.proconfig, p.proacl, p.prosecdef,
           pg_catalog.pg_get_functiondef(p.oid)
      INTO v_owner, v_language, v_volatility, v_return_type,
           v_config, v_acl, v_secdef, v_definition
    FROM pg_catalog.pg_proc AS p
    WHERE p.oid = v_oid;

    -- These expectations come from the final historical definitions and ACL
    -- statements: security_features.sql (text overloads), the November
    -- checkout/return migrations (UUID overloads), and the December terms
    -- migration. Refuse to harden an environment with a different baseline.
    CASE v_signature
      WHEN 'public.confirm_pickup(text,text)' THEN
        v_expected_arguments := 'text, text';
        v_expected_return_type := 'void'::regtype::oid;
        v_expected_config := ARRAY['search_path=public']::text[];
        v_expected_grantees := ARRAY['postgres', 'authenticated']::text[];
        v_expected_service_role := false;
      WHEN 'public.confirm_return(text,text)' THEN
        v_expected_arguments := 'text, text';
        v_expected_return_type := 'void'::regtype::oid;
        v_expected_config := ARRAY['search_path=public']::text[];
        v_expected_grantees := ARRAY['postgres', 'authenticated']::text[];
        v_expected_service_role := false;
      WHEN 'public.confirm_pickup(uuid,text)' THEN
        v_expected_arguments := 'uuid, text';
        v_expected_return_type := 'void'::regtype::oid;
        v_expected_config := ARRAY['search_path=""']::text[];
        v_expected_grantees := ARRAY['postgres', 'authenticated', 'service_role']::text[];
        v_expected_service_role := true;
      WHEN 'public.confirm_return(uuid,text)' THEN
        v_expected_arguments := 'uuid, text';
        v_expected_return_type := 'void'::regtype::oid;
        v_expected_config := ARRAY['search_path=""']::text[];
        v_expected_grantees := ARRAY['postgres', 'authenticated', 'service_role']::text[];
        v_expected_service_role := true;
      WHEN 'public.accept_subadmin_terms()' THEN
        v_expected_arguments := '';
        v_expected_return_type := 'timestamp with time zone'::regtype::oid;
        v_expected_config := ARRAY['search_path=public, pg_temp']::text[];
        v_expected_grantees := ARRAY['postgres', 'authenticated', 'service_role']::text[];
        v_expected_service_role := true;
      ELSE
        RAISE EXCEPTION 'No reviewed metadata baseline exists for %.', v_signature;
    END CASE;

    IF v_owner <> 'postgres'::regrole::oid
       OR v_language <> (SELECT l.oid FROM pg_catalog.pg_language AS l WHERE l.lanname = 'plpgsql')
       OR v_secdef IS DISTINCT FROM true
       OR v_volatility IS DISTINCT FROM 'v'::"char"
       OR v_return_type IS DISTINCT FROM v_expected_return_type
       OR pg_catalog.oidvectortypes(
            (SELECT p.proargtypes FROM pg_catalog.pg_proc AS p WHERE p.oid = v_oid)
          ) IS DISTINCT FROM v_expected_arguments
       OR v_config IS DISTINCT FROM v_expected_config
       OR v_acl IS NULL THEN
      RAISE EXCEPTION 'Function % metadata differs from its reviewed historical baseline.', v_signature;
    END IF;

    -- Validate the complete explicit ACL, including grantor and grant-option
    -- state. Ownership does not require an explicit grant-option bit.
    SELECT pg_catalog.count(*) INTO v_acl_count
    FROM pg_catalog.aclexplode(v_acl) AS acl;
    IF v_acl_count <> pg_catalog.cardinality(v_expected_grantees)
       OR EXISTS (
         SELECT 1
         FROM pg_catalog.aclexplode(v_acl) AS acl
         WHERE acl.privilege_type <> 'EXECUTE'
            OR acl.is_grantable IS TRUE
            OR acl.grantor <> v_owner
            OR (CASE WHEN acl.grantee = 0::oid THEN 'PUBLIC'::text
                     ELSE pg_catalog.pg_get_userbyid(acl.grantee)::text END)
                 <> ALL (v_expected_grantees)
       )
       OR EXISTS (
         SELECT 1
         FROM pg_catalog.unnest(v_expected_grantees) AS expected(grantee_name)
         WHERE NOT EXISTS (
           SELECT 1 FROM pg_catalog.aclexplode(v_acl) AS acl
           WHERE (CASE WHEN acl.grantee = 0::oid THEN 'PUBLIC'::text
                       ELSE pg_catalog.pg_get_userbyid(acl.grantee)::text END)
                   = expected.grantee_name
             AND acl.privilege_type = 'EXECUTE'
             AND acl.is_grantable IS FALSE
             AND acl.grantor = v_owner
         )
       )
       OR pg_catalog.has_function_privilege('anon', v_oid, 'EXECUTE') IS TRUE
       OR pg_catalog.has_function_privilege('authenticated', v_oid, 'EXECUTE') IS NOT TRUE
       OR pg_catalog.has_function_privilege('service_role', v_oid, 'EXECUTE')
            IS DISTINCT FROM v_expected_service_role THEN
      RAISE EXCEPTION 'Function % direct or effective EXECUTE grants differ from the reviewed historical baseline.', v_signature;
    END IF;

    v_updated_definition := v_definition;

    IF v_signature IN (
      'public.confirm_pickup(uuid,text)',
      'public.confirm_return(uuid,text)'
    ) THEN
      v_old_count := pg_catalog.regexp_count(
        v_updated_definition,
        'COALESCE[[:space:]]*\([[:space:]]*v_jwt_role[[:space:]]*,[[:space:]]*v_staff_role[[:space:]]*\)[[:space:]]*<>[[:space:]]*v_staff_role',
        1,
        'i'
      );
      v_new_count := pg_catalog.regexp_count(
        v_updated_definition,
        'v_jwt_role[[:space:]]+IS[[:space:]]+DISTINCT[[:space:]]+FROM[[:space:]]+v_staff_role',
        1,
        'i'
      );
      IF v_old_count = 1 AND v_new_count = 0 THEN
        v_updated_definition := pg_catalog.regexp_replace(
          v_updated_definition,
          'COALESCE[[:space:]]*\([[:space:]]*v_jwt_role[[:space:]]*,[[:space:]]*v_staff_role[[:space:]]*\)[[:space:]]*<>[[:space:]]*v_staff_role',
          'v_jwt_role IS DISTINCT FROM v_staff_role',
          'i'
        );
      ELSIF v_old_count <> 0 OR v_new_count <> 1 THEN
        RAISE EXCEPTION 'Unexpected JWT role guard in % (fallback %, fail-closed %).',
          v_signature, v_old_count, v_new_count;
      END IF;
    ELSIF v_signature = 'public.accept_subadmin_terms()' THEN
      v_old_count := pg_catalog.regexp_count(
        v_updated_definition,
        'COALESCE[[:space:]]*\([[:space:]]*auth\.jwt\(\)[[:space:]]*->[[:space:]]*''app_metadata''[[:space:]]*->>[[:space:]]*''role''[[:space:]]*,[[:space:]]*staff\.role[[:space:]]*\)[[:space:]]*=[[:space:]]*staff\.role',
        1,
        'i'
      );
      v_new_count := pg_catalog.regexp_count(
        v_updated_definition,
        'auth\.jwt\(\)[[:space:]]*->[[:space:]]*''app_metadata''[[:space:]]*->>[[:space:]]*''role''[[:space:]]+IS[[:space:]]+NOT[[:space:]]+NULL[[:space:]]+AND[[:space:]]+auth\.jwt\(\)[[:space:]]*->[[:space:]]*''app_metadata''[[:space:]]*->>[[:space:]]*''role''[[:space:]]*=[[:space:]]*staff\.role',
        1,
        'i'
      );
      IF v_old_count = 1 AND v_new_count = 0 THEN
        v_updated_definition := pg_catalog.regexp_replace(
          v_updated_definition,
          'COALESCE[[:space:]]*\([[:space:]]*auth\.jwt\(\)[[:space:]]*->[[:space:]]*''app_metadata''[[:space:]]*->>[[:space:]]*''role''[[:space:]]*,[[:space:]]*staff\.role[[:space:]]*\)[[:space:]]*=[[:space:]]*staff\.role',
          'auth.jwt() -> ''app_metadata'' ->> ''role'' IS NOT NULL AND auth.jwt() -> ''app_metadata'' ->> ''role'' = staff.role',
          'i'
        );
      ELSIF v_old_count <> 0 OR v_new_count <> 1 THEN
        RAISE EXCEPTION 'Unexpected Sub-admin terms claim guard (fallback %, fail-closed %).',
          v_old_count, v_new_count;
      END IF;
    END IF;

    IF v_signature IN (
      'public.confirm_pickup(text,text)',
      'public.confirm_return(text,text)'
    ) THEN
      v_old_count := pg_catalog.regexp_count(
        v_updated_definition,
        'BEGIN[[:space:]]+SELECT request\.\*[[:space:]]+INTO v_req',
        1,
        'i'
      );
      v_new_count := pg_catalog.regexp_count(
        v_updated_definition,
        'auth\.jwt\(\)[[:space:]]*->[[:space:]]*>[[:space:]]*''aal''[[:space:]]+IS[[:space:]]+DISTINCT[[:space:]]+FROM[[:space:]]+''aal2''',
        1,
        'i'
      );
      IF v_old_count = 1 AND v_new_count = 0 THEN
        v_updated_definition := pg_catalog.regexp_replace(
          v_updated_definition,
          'BEGIN[[:space:]]+SELECT request\.\*[[:space:]]+INTO v_req',
          'BEGIN' || E'\n  IF auth.uid() IS NULL OR auth.jwt() ->> ''aal'' IS DISTINCT FROM ''aal2'' THEN\n    RAISE EXCEPTION ''AAL2 authentication is required.'';\n  END IF;\n  SELECT request.* INTO v_req',
          'i'
        );
      ELSIF v_old_count <> 0 OR v_new_count <> 1 THEN
        RAISE EXCEPTION 'Unexpected AAL2 insertion point or guard in % (insertion point %, AAL2 %).',
          v_signature, v_old_count, v_new_count;
      END IF;
    ELSIF v_signature IN (
      'public.confirm_pickup(uuid,text)',
      'public.confirm_return(uuid,text)'
    ) THEN
      v_old_count := pg_catalog.regexp_count(
        v_updated_definition,
        'IF auth\.uid\(\) IS NULL THEN[[:space:]]+RAISE EXCEPTION ''Authenticated staff account required\.'';[[:space:]]+END IF;',
        1,
        'i'
      );
      v_new_count := pg_catalog.regexp_count(
        v_updated_definition,
        'auth\.jwt\(\)[[:space:]]*->[[:space:]]*>[[:space:]]*''aal''[[:space:]]+IS[[:space:]]+DISTINCT[[:space:]]+FROM[[:space:]]+''aal2''',
        1,
        'i'
      );
      IF v_old_count = 1 AND v_new_count = 0 THEN
        v_updated_definition := pg_catalog.regexp_replace(
          v_updated_definition,
          'IF auth\.uid\(\) IS NULL THEN[[:space:]]+RAISE EXCEPTION ''Authenticated staff account required\.'';[[:space:]]+END IF;',
          E'IF auth.uid() IS NULL THEN\n    RAISE EXCEPTION ''Authenticated staff account required.'';\n  END IF;\n  IF auth.jwt() ->> ''aal'' IS DISTINCT FROM ''aal2'' THEN\n    RAISE EXCEPTION ''AAL2 authentication is required.'';\n  END IF;',
          'i'
        );
      ELSIF v_old_count <> 0 OR v_new_count <> 1 THEN
        RAISE EXCEPTION 'Unexpected AAL2 guard in % (auth guard %, AAL2 %).',
          v_signature, v_old_count, v_new_count;
      END IF;
    END IF;

    IF v_updated_definition IS DISTINCT FROM v_definition THEN
      EXECUTE v_updated_definition;
    END IF;

    SELECT p.proowner, p.prolang, p.provolatile, p.prorettype,
           p.proconfig, p.proacl, p.prosecdef
      INTO v_after_owner, v_after_language, v_after_volatility, v_after_return_type,
           v_after_config, v_after_acl, v_after_secdef
    FROM pg_catalog.pg_proc AS p
    WHERE p.oid = v_oid;

    IF v_after_owner IS DISTINCT FROM v_owner
       OR v_after_language IS DISTINCT FROM v_language
       OR v_after_volatility IS DISTINCT FROM v_volatility
       OR v_after_return_type IS DISTINCT FROM v_return_type
       OR v_after_config IS DISTINCT FROM v_config
       OR v_after_acl IS DISTINCT FROM v_acl
       OR v_after_secdef IS DISTINCT FROM v_secdef THEN
      RAISE EXCEPTION 'Function % metadata or grants changed during hardening.', v_signature;
    END IF;

    IF v_after_owner <> 'postgres'::regrole::oid
       OR v_after_language <> (SELECT l.oid FROM pg_catalog.pg_language AS l WHERE l.lanname = 'plpgsql')
       OR v_after_secdef IS DISTINCT FROM true
       OR v_after_volatility IS DISTINCT FROM 'v'::"char"
       OR v_after_return_type IS DISTINCT FROM v_expected_return_type
       OR pg_catalog.oidvectortypes(
            (SELECT p.proargtypes FROM pg_catalog.pg_proc AS p WHERE p.oid = v_oid)
          ) IS DISTINCT FROM v_expected_arguments
       OR v_after_config IS DISTINCT FROM v_expected_config
       OR v_after_acl IS NULL
       OR pg_catalog.has_function_privilege('anon', v_oid, 'EXECUTE') IS TRUE
       OR pg_catalog.has_function_privilege('authenticated', v_oid, 'EXECUTE') IS NOT TRUE
       OR pg_catalog.has_function_privilege('service_role', v_oid, 'EXECUTE')
            IS DISTINCT FROM v_expected_service_role THEN
      RAISE EXCEPTION 'Function % postflight metadata or effective grants differ from the reviewed contract.', v_signature;
    END IF;

    SELECT pg_catalog.count(*) INTO v_acl_count
    FROM pg_catalog.aclexplode(v_after_acl) AS acl;
    IF v_acl_count <> pg_catalog.cardinality(v_expected_grantees)
       OR EXISTS (
         SELECT 1 FROM pg_catalog.aclexplode(v_after_acl) AS acl
         WHERE acl.privilege_type <> 'EXECUTE'
            OR acl.is_grantable IS TRUE
            OR acl.grantor <> v_after_owner
            OR (CASE WHEN acl.grantee = 0::oid THEN 'PUBLIC'::text
                     ELSE pg_catalog.pg_get_userbyid(acl.grantee)::text END)
                 <> ALL (v_expected_grantees)
       )
       OR EXISTS (
         SELECT 1 FROM pg_catalog.unnest(v_expected_grantees) AS expected(grantee_name)
         WHERE NOT EXISTS (
           SELECT 1 FROM pg_catalog.aclexplode(v_after_acl) AS acl
           WHERE (CASE WHEN acl.grantee = 0::oid THEN 'PUBLIC'::text
                       ELSE pg_catalog.pg_get_userbyid(acl.grantee)::text END)
                   = expected.grantee_name
             AND acl.privilege_type = 'EXECUTE'
             AND acl.is_grantable IS FALSE
             AND acl.grantor = v_after_owner
         )
       ) THEN
      RAISE EXCEPTION 'Function % postflight direct ACL differs from the reviewed historical baseline.', v_signature;
    END IF;
  END LOOP;
END;
$hardening$;

DO $announcement_policy$
DECLARE
  v_policy_count integer;
  v_using text;
  v_check text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_class AS relation
    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'public' AND relation.relname = 'announcements'
      AND relation.relrowsecurity IS TRUE
  ) OR pg_catalog.to_regprocedure('public.is_active_staff_for_branch(text)') IS NULL THEN
    RAISE EXCEPTION 'Announcements RLS or the fail-closed branch helper is missing.';
  END IF;

  SELECT pg_catalog.count(*)::integer,
         pg_catalog.max(pg_catalog.pg_get_expr(policy.polqual, policy.polrelid)),
         pg_catalog.max(pg_catalog.pg_get_expr(policy.polwithcheck, policy.polrelid))
    INTO v_policy_count, v_using, v_check
    FROM pg_catalog.pg_policy AS policy
   WHERE policy.polrelid = 'public.announcements'::regclass
     AND policy.polname = 'staff manage announcements';

  IF v_policy_count <> 1
     OR NOT EXISTS (
       SELECT 1
         FROM pg_catalog.pg_policy AS policy
        WHERE policy.polrelid = 'public.announcements'::regclass
          AND policy.polname = 'staff manage announcements'
          AND policy.polcmd = '*'
          AND policy.polpermissive IS TRUE
          AND policy.polroles = ARRAY['authenticated'::regrole::oid]
     )
     OR v_using IS NULL
     OR v_check IS NULL
     OR v_using IS DISTINCT FROM v_check
     OR v_using !~* 'staff_profiles'
     OR v_using !~* 'auth[.]uid[[:space:]]*[(][[:space:]]*[)]'
     OR v_using !~* 'superadmin'
     OR v_using !~* 'coalesce'
     OR v_using !~* 'is_active_staff_for_branch'
     OR v_using !~* '[[:space:]]or[[:space:]]'
     OR v_using !~* 'library_id.*::[[:space:]]*text'
     OR pg_catalog.regexp_count(v_using, 'staff_profiles', 1, 'i') <> 1
     OR pg_catalog.regexp_count(v_using, 'auth[.]uid[[:space:]]*[(][[:space:]]*[)]', 1, 'i') <> 1
     OR pg_catalog.regexp_count(v_using, 'superadmin', 1, 'i') <> 1
     OR pg_catalog.regexp_count(v_using, 'coalesce', 1, 'i') <> 1
     OR pg_catalog.regexp_count(v_using, 'is_active_staff_for_branch', 1, 'i') <> 1
     OR pg_catalog.regexp_count(v_using, '[[:space:]]and[[:space:]]', 1, 'i') <> 3
     OR pg_catalog.regexp_count(v_using, '[[:space:]]or[[:space:]]', 1, 'i') <> 1
     OR pg_catalog.regexp_count(v_using, '=', 1, 'i') <> 3 THEN
    RAISE EXCEPTION 'Announcements policy baseline differs from the reviewed 20261106000000 policy; refusing to replace an unexpected policy.';
  END IF;
END;
$announcement_policy$;

DROP POLICY IF EXISTS "staff manage announcements" ON public.announcements;
CREATE POLICY "staff manage announcements" ON public.announcements
  FOR ALL TO authenticated
  USING (public.is_active_staff_for_branch(library_id::text))
  WITH CHECK (public.is_active_staff_for_branch(library_id::text));

DO $postflight$
DECLARE
  v_signature text;
  v_definition text;
  v_policy_count integer;
  v_policy_roles oid[];
  v_policy_command "char";
  v_policy_permissive boolean;
  v_policy_using text;
  v_policy_check text;
BEGIN
  FOREACH v_signature IN ARRAY ARRAY[
    'public.confirm_pickup(text,text)',
    'public.confirm_return(text,text)',
    'public.confirm_pickup(uuid,text)',
    'public.confirm_return(uuid,text)'
  ] LOOP
    v_definition := pg_catalog.pg_get_functiondef(pg_catalog.to_regprocedure(v_signature));
    IF pg_catalog.strpos(v_definition, 'IS DISTINCT FROM ''aal2''') = 0 THEN
      RAISE EXCEPTION 'AAL2 fail-closed authorization is missing from %.', v_signature;
    END IF;
  END LOOP;

  v_definition := pg_catalog.pg_get_functiondef('public.confirm_pickup(uuid,text)'::regprocedure);
  IF pg_catalog.strpos(v_definition, 'IS DISTINCT FROM v_staff_role') = 0
     OR v_definition ~* 'coalesce[[:space:]]*\([[:space:]]*v_jwt_role[[:space:]]*,[[:space:]]*v_staff_role[[:space:]]*\)' THEN
    RAISE EXCEPTION 'Pickup role-claim validation remains fail-open.';
  END IF;

  v_definition := pg_catalog.pg_get_functiondef('public.confirm_return(uuid,text)'::regprocedure);
  IF pg_catalog.strpos(v_definition, 'IS DISTINCT FROM v_staff_role') = 0
     OR v_definition ~* 'coalesce[[:space:]]*\([[:space:]]*v_jwt_role[[:space:]]*,[[:space:]]*v_staff_role[[:space:]]*\)' THEN
    RAISE EXCEPTION 'Return role-claim validation remains fail-open.';
  END IF;

  v_definition := pg_catalog.pg_get_functiondef('public.accept_subadmin_terms()'::regprocedure);
  IF pg_catalog.strpos(v_definition, 'app_metadata') = 0
     OR pg_catalog.strpos(v_definition, 'IS NOT NULL') = 0
     OR pg_catalog.strpos(v_definition, 'staff.role') = 0
     OR v_definition ~* 'coalesce[[:space:]]*\([[:space:]]*auth\.jwt\(\)' THEN
    RAISE EXCEPTION 'Sub-admin terms acceptance does not fail closed on its signed role claim.';
  END IF;

  SELECT pg_catalog.count(*)::integer
    INTO v_policy_count
    FROM pg_catalog.pg_policy AS policy
   WHERE policy.polrelid = 'public.announcements'::regclass
     AND policy.polname = 'staff manage announcements';

  IF v_policy_count = 1 THEN
    SELECT policy.polroles, policy.polcmd, policy.polpermissive,
           pg_catalog.pg_get_expr(policy.polqual, policy.polrelid),
           pg_catalog.pg_get_expr(policy.polwithcheck, policy.polrelid)
      INTO v_policy_roles, v_policy_command, v_policy_permissive,
           v_policy_using, v_policy_check
      FROM pg_catalog.pg_policy AS policy
     WHERE policy.polrelid = 'public.announcements'::regclass
       AND policy.polname = 'staff manage announcements';
  END IF;

  IF v_policy_count <> 1
     OR v_policy_roles IS DISTINCT FROM ARRAY['authenticated'::regrole::oid]
     OR v_policy_command IS DISTINCT FROM '*'::"char"
     OR v_policy_permissive IS DISTINCT FROM TRUE
     OR v_policy_using IS NULL
     OR v_policy_check IS NULL
     OR v_policy_using IS DISTINCT FROM v_policy_check
     OR pg_catalog.regexp_replace(
          pg_catalog.lower(v_policy_using), '[[:space:]()]', '', 'g'
        ) !~ '^(public[.])?is_active_staff_for_branchlibrary_id::text$' THEN
    RAISE EXCEPTION 'Announcements policy postflight differs from the exact branch-scoped FOR ALL authenticated policy definition.';
  END IF;
END;
$postflight$;

NOTIFY pgrst, 'reload schema';
COMMIT;