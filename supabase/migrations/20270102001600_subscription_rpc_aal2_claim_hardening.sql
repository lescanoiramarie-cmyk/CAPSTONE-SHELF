BEGIN;

DO $subscription_rpc_aal2_claim_hardening$
DECLARE
  v_item record;
  v_oid oid;
  v_owner oid;
  v_language oid;
  v_config text[];
  v_acl aclitem[];
  v_secdef boolean;
  v_before_definition text;
  v_after_definition text;
  v_occurrences integer;
  v_after_owner oid;
  v_after_language oid;
  v_after_config text[];
  v_after_acl aclitem[];
  v_after_secdef boolean;
BEGIN
  IF current_user <> 'postgres' THEN
    RAISE EXCEPTION
      'Subscription authorization hardening requires current_user=postgres; found %',
      current_user;
  END IF;

  FOR v_item IN
    SELECT * FROM (VALUES
      (
        'public.get_library_subscription_dashboard(text)',
        '  IF v_jwt_role IS NOT NULL AND v_jwt_role <> v_role THEN RAISE EXCEPTION ''Unauthorized staff role.''; END IF;',
        '  IF v_jwt_role IS NULL OR v_jwt_role <> v_role THEN RAISE EXCEPTION ''Unauthorized staff role.''; END IF;' || E'\n' ||
        '  IF auth.jwt() ->> ''aal'' IS DISTINCT FROM ''aal2'' THEN RAISE EXCEPTION ''AAL2 assurance is required.''; END IF;'
      ),
      (
        'public.update_library_subscription(uuid,text,text,text,date,date,integer,boolean,date,text)',
        '  IF auth.jwt() -> ''app_metadata'' ->> ''role'' IS NOT NULL' || E'\n' ||
        '     AND auth.jwt() -> ''app_metadata'' ->> ''role'' <> ''superadmin'' THEN RAISE EXCEPTION ''Unauthorized staff role.''; END IF;',
        '  IF auth.jwt() -> ''app_metadata'' ->> ''role'' IS DISTINCT FROM ''superadmin'' THEN RAISE EXCEPTION ''Unauthorized staff role.''; END IF;' || E'\n' ||
        '  IF auth.jwt() ->> ''aal'' IS DISTINCT FROM ''aal2'' THEN RAISE EXCEPTION ''AAL2 assurance is required.''; END IF;'
      ),
      (
        'public.request_subscription_upgrade(text,text)',
        '  IF auth.jwt() -> ''app_metadata'' ->> ''role'' IS NOT NULL' || E'\n' ||
        '     AND auth.jwt() -> ''app_metadata'' ->> ''role'' <> ''subadmin'' THEN RAISE EXCEPTION ''Unauthorized staff role.''; END IF;',
        '  IF auth.jwt() -> ''app_metadata'' ->> ''role'' IS DISTINCT FROM ''subadmin'' THEN RAISE EXCEPTION ''Unauthorized staff role.''; END IF;' || E'\n' ||
        '  IF auth.jwt() ->> ''aal'' IS DISTINCT FROM ''aal2'' THEN RAISE EXCEPTION ''AAL2 assurance is required.''; END IF;'
      ),
      (
        'public.decide_subscription_upgrade(uuid,text,text)',
        '  IF NOT FOUND OR lower(v_staff.role) <> ''superadmin'' THEN RAISE EXCEPTION ''Only a super-admin can decide upgrade requests.''; END IF;',
        '  IF NOT FOUND OR lower(v_staff.role) <> ''superadmin'' THEN RAISE EXCEPTION ''Only a super-admin can decide upgrade requests.''; END IF;' || E'\n' ||
        '  IF auth.jwt() -> ''app_metadata'' ->> ''role'' IS DISTINCT FROM ''superadmin'' THEN RAISE EXCEPTION ''Unauthorized staff role.''; END IF;' || E'\n' ||
        '  IF auth.jwt() ->> ''aal'' IS DISTINCT FROM ''aal2'' THEN RAISE EXCEPTION ''AAL2 assurance is required.''; END IF;'
      ),
      (
        'public.follow_library_subscription_renewal(uuid)',
        '  IF auth.jwt() -> ''app_metadata'' ->> ''role'' IS NOT NULL' || E'\n' ||
        '     AND auth.jwt() -> ''app_metadata'' ->> ''role'' <> ''superadmin'' THEN' || E'\n' ||
        '    RAISE EXCEPTION ''Unauthorized staff role.'';' || E'\n' ||
        '  END IF;',
        '  IF auth.jwt() -> ''app_metadata'' ->> ''role'' IS DISTINCT FROM ''superadmin'' THEN' || E'\n' ||
        '    RAISE EXCEPTION ''Unauthorized staff role.'';' || E'\n' ||
        '  END IF;' || E'\n' ||
        '  IF auth.jwt() ->> ''aal'' IS DISTINCT FROM ''aal2'' THEN RAISE EXCEPTION ''AAL2 assurance is required.''; END IF;'
      ),
      (
        'public.terminate_library_subscription(uuid,text)',
        '  IF auth.jwt() -> ''app_metadata'' ->> ''role'' IS NOT NULL' || E'\n' ||
        '     AND auth.jwt() -> ''app_metadata'' ->> ''role'' <> ''superadmin'' THEN' || E'\n' ||
        '    RAISE EXCEPTION ''Unauthorized staff role.'';' || E'\n' ||
        '  END IF;',
        '  IF auth.jwt() -> ''app_metadata'' ->> ''role'' IS DISTINCT FROM ''superadmin'' THEN' || E'\n' ||
        '    RAISE EXCEPTION ''Unauthorized staff role.'';' || E'\n' ||
        '  END IF;' || E'\n' ||
        '  IF auth.jwt() ->> ''aal'' IS DISTINCT FROM ''aal2'' THEN RAISE EXCEPTION ''AAL2 assurance is required.''; END IF;'
      ),
      (
        'public.mark_subscription_renewal_notification_read(uuid)',
        '  IF NOT FOUND THEN RAISE EXCEPTION ''Active Sub Admin account required.''; END IF;',
        '  IF NOT FOUND OR v_staff.library_id IS NULL THEN RAISE EXCEPTION ''Active assigned Sub Admin account required.''; END IF;' || E'\n' ||
        '  IF auth.jwt() -> ''app_metadata'' ->> ''role'' IS DISTINCT FROM ''subadmin'' THEN RAISE EXCEPTION ''Unauthorized staff role.''; END IF;' || E'\n' ||
        '  IF auth.jwt() ->> ''aal'' IS DISTINCT FROM ''aal2'' THEN RAISE EXCEPTION ''AAL2 assurance is required.''; END IF;'
      )
    ) AS edits(signature, old_fragment, new_fragment)
  LOOP
    v_oid := pg_catalog.to_regprocedure(v_item.signature)::oid;
    IF v_oid IS NULL THEN
      RAISE EXCEPTION 'Required subscription RPC % does not exist', v_item.signature;
    END IF;

    SELECT p.proowner, p.prolang, p.proconfig, p.proacl, p.prosecdef,
           pg_catalog.pg_get_functiondef(p.oid)
      INTO v_owner, v_language, v_config, v_acl, v_secdef, v_before_definition
    FROM pg_catalog.pg_proc AS p
    WHERE p.oid = v_oid;

    IF v_owner <> 'postgres'::regrole::oid
       OR v_language <> (SELECT l.oid FROM pg_catalog.pg_language AS l WHERE l.lanname = 'plpgsql')
       OR v_config IS DISTINCT FROM ARRAY['search_path=public, pg_temp']::text[]
       OR v_secdef IS DISTINCT FROM true THEN
      RAISE EXCEPTION
        'Subscription RPC % has unexpected owner, language, SECURITY DEFINER, or search_path',
        v_item.signature;
    END IF;

    IF v_acl IS NULL OR (
      SELECT count(*) <> 3
          OR count(*) FILTER (
               WHERE acl.grantee = v_owner
                 AND acl.privilege_type = 'EXECUTE'
                 AND acl.is_grantable IS FALSE
             ) <> 1
          OR count(*) FILTER (
               WHERE acl.grantee = 'authenticated'::regrole::oid
                 AND acl.privilege_type = 'EXECUTE'
                 AND acl.is_grantable IS FALSE
             ) <> 1
          OR count(*) FILTER (
               WHERE acl.grantee = 'service_role'::regrole::oid
                 AND acl.privilege_type = 'EXECUTE'
                 AND acl.is_grantable IS FALSE
             ) <> 1
      FROM pg_catalog.aclexplode(v_acl) AS acl
    ) THEN
      RAISE EXCEPTION
        'Subscription RPC % has unexpected direct EXECUTE ACL entries',
        v_item.signature;
    END IF;

    IF pg_catalog.has_function_privilege('anon', v_oid, 'EXECUTE')
       OR NOT pg_catalog.has_function_privilege('authenticated', v_oid, 'EXECUTE')
       OR NOT pg_catalog.has_function_privilege('service_role', v_oid, 'EXECUTE') THEN
      RAISE EXCEPTION
        'Subscription RPC % has unexpected effective EXECUTE privileges',
        v_item.signature;
    END IF;

    v_occurrences :=
      (pg_catalog.length(v_before_definition)
       - pg_catalog.length(pg_catalog.replace(v_before_definition, v_item.old_fragment, '')))
      / pg_catalog.length(v_item.old_fragment);
    IF v_occurrences <> 1 THEN
      RAISE EXCEPTION
        'Subscription RPC % expected exactly one reviewed authorization fragment; found %',
        v_item.signature, v_occurrences;
    END IF;

    v_after_definition := pg_catalog.replace(
      v_before_definition,
      v_item.old_fragment,
      v_item.new_fragment
    );
    EXECUTE v_after_definition;

    SELECT p.proowner, p.prolang, p.proconfig, p.proacl, p.prosecdef
      INTO v_after_owner, v_after_language, v_after_config, v_after_acl, v_after_secdef
    FROM pg_catalog.pg_proc AS p
    WHERE p.oid = v_oid;

    IF v_after_owner IS DISTINCT FROM v_owner
       OR v_after_language IS DISTINCT FROM v_language
       OR v_after_config IS DISTINCT FROM v_config
       OR v_after_acl IS DISTINCT FROM v_acl
       OR v_after_secdef IS DISTINCT FROM v_secdef THEN
      RAISE EXCEPTION
        'Subscription RPC % metadata or grants changed unexpectedly',
        v_item.signature;
    END IF;
  END LOOP;
END
$subscription_rpc_aal2_claim_hardening$;

COMMIT;