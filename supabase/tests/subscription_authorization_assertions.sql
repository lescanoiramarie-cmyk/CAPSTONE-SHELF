DO $subscription_authorization_assertions$
DECLARE
  v_signature text;
  v_oid oid;
  v_definition text;
  v_owner text;
  v_config text[];
  v_secdef boolean;
  v_acl aclitem[];
  v_acl_entries integer;
  v_owner_entries integer;
  v_authenticated_entries integer;
  v_service_entries integer;
  v_signatures text[] := ARRAY[
    'public.get_library_subscription_dashboard(text)',
    'public.update_library_subscription(uuid,text,text,text,date,date,integer,boolean,date,text)',
    'public.request_subscription_upgrade(text,text)',
    'public.decide_subscription_upgrade(uuid,text,text)',
    'public.follow_library_subscription_renewal(uuid)',
    'public.terminate_library_subscription(uuid,text)',
    'public.mark_subscription_renewal_notification_read(uuid)'
  ];
BEGIN
  FOREACH v_signature IN ARRAY v_signatures LOOP
    v_oid := pg_catalog.to_regprocedure(v_signature)::oid;
    IF v_oid IS NULL THEN
      RAISE EXCEPTION 'Expected subscription RPC % is missing', v_signature;
    END IF;

    SELECT pg_catalog.pg_get_userbyid(p.proowner), p.proconfig, p.prosecdef, p.proacl,
           pg_catalog.pg_get_functiondef(p.oid)
      INTO v_owner, v_config, v_secdef, v_acl, v_definition
    FROM pg_catalog.pg_proc AS p
    WHERE p.oid = v_oid;

    IF v_owner <> 'postgres'
       OR v_config IS DISTINCT FROM ARRAY['search_path=public, pg_temp']::text[]
       OR v_secdef IS DISTINCT FROM true THEN
      RAISE EXCEPTION 'Unexpected owner/security metadata for %', v_signature;
    END IF;
    IF v_definition NOT LIKE '%IS DISTINCT FROM ''aal2''%' THEN
      RAISE EXCEPTION 'AAL2 fail-closed check is missing from %', v_signature;
    END IF;
    IF v_definition NOT LIKE '%app_metadata%' OR v_definition NOT LIKE '%role%' THEN
      RAISE EXCEPTION 'JWT role claim validation is missing from %', v_signature;
    END IF;
    SELECT count(*) INTO v_acl_entries
    FROM pg_catalog.aclexplode(v_acl) AS acl
    WHERE NOT (
      (acl.grantee = 'postgres'::regrole::oid
        OR acl.grantee = 'authenticated'::regrole::oid
        OR acl.grantee = 'service_role'::regrole::oid)
      AND acl.privilege_type = 'EXECUTE'
      AND acl.is_grantable IS FALSE
    );
    SELECT count(*) FILTER (
             WHERE acl.grantee = 'postgres'::regrole::oid
               AND acl.privilege_type = 'EXECUTE' AND acl.is_grantable IS FALSE
           ),
           count(*) FILTER (
             WHERE acl.grantee = 'authenticated'::regrole::oid
               AND acl.privilege_type = 'EXECUTE' AND acl.is_grantable IS FALSE
           ),
           count(*) FILTER (
             WHERE acl.grantee = 'service_role'::regrole::oid
               AND acl.privilege_type = 'EXECUTE' AND acl.is_grantable IS FALSE
           )
      INTO v_owner_entries, v_authenticated_entries, v_service_entries
    FROM pg_catalog.aclexplode(v_acl) AS acl;
    IF v_acl IS NULL OR v_acl_entries <> 0 OR (
      SELECT count(*) FROM pg_catalog.aclexplode(v_acl)
    ) <> 3 OR v_owner_entries <> 1 OR v_authenticated_entries <> 1 OR v_service_entries <> 1 THEN
      RAISE EXCEPTION 'Unexpected direct EXECUTE ACL entries for %', v_signature;
    END IF;
    IF NOT pg_catalog.has_function_privilege('authenticated', v_oid, 'EXECUTE')
       OR pg_catalog.has_function_privilege('anon', v_oid, 'EXECUTE')
       OR NOT pg_catalog.has_function_privilege('service_role', v_oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'Unexpected effective EXECUTE privileges for %', v_signature;
    END IF;
  END LOOP;

  IF pg_catalog.pg_get_functiondef(
       'public.get_library_subscription_dashboard(text)'::regprocedure
     ) NOT LIKE '%p_library_id <> v_staff_library::text%' THEN
    RAISE EXCEPTION 'Sub-admin dashboard branch restriction is missing';
  END IF;
  IF pg_catalog.pg_get_functiondef(
       'public.mark_subscription_renewal_notification_read(uuid)'::regprocedure
     ) NOT LIKE '%library_id = v_staff.library_id%' THEN
    RAISE EXCEPTION 'Sub-admin notification branch restriction is missing';
  END IF;
END
$subscription_authorization_assertions$;