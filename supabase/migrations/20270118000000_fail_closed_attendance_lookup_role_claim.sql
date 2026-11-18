-- Require present, matching app_metadata role claims in sensitive staff RPCs.
-- This guarded CREATE OR REPLACE rewrite preserves each signature, owner, and ACL.

BEGIN;

DO $migration$
DECLARE
  function_signatures regprocedure[] := ARRAY[
    'public.lookup_attendance_visitor_v2(text,text)'::regprocedure,
    'public.get_current_user_role()'::regprocedure,
    'public.confirm_pickup(text,text)'::regprocedure,
    'public.confirm_return(text,text)'::regprocedure,
    'public.confirm_return(uuid,text)'::regprocedure
  ];
  function_signature regprocedure;
  function_definition text;
  old_pattern text;
  replacement text;
  new_pattern text;
  old_count integer;
  new_count integer;
BEGIN
  FOREACH function_signature IN ARRAY function_signatures LOOP
    function_definition := pg_catalog.pg_get_functiondef(function_signature);

    IF function_signature IN (
      'public.lookup_attendance_visitor_v2(text,text)'::regprocedure,
      'public.confirm_pickup(text,text)'::regprocedure,
      'public.confirm_return(text,text)'::regprocedure
    ) THEN
      old_pattern := $pattern$IF v_jwt_role IS NOT NULL[[:space:]]+AND pg_catalog\.lower\(pg_catalog\.btrim\(v_jwt_role\)\) <> v_role THEN$pattern$;
      replacement := 'IF pg_catalog.lower(pg_catalog.btrim(v_jwt_role)) IS DISTINCT FROM v_role THEN';
      new_pattern := $pattern$IF pg_catalog\.lower\(pg_catalog\.btrim\(v_jwt_role\)\) IS DISTINCT FROM v_role THEN$pattern$;
    ELSIF function_signature = 'public.get_current_user_role()'::regprocedure THEN
      old_pattern := $pattern$COALESCE\(v_jwt_role, v_staff\.role\) <> v_staff\.role$pattern$;
      replacement := 'v_jwt_role IS DISTINCT FROM v_staff.role';
      new_pattern := $pattern$v_jwt_role IS DISTINCT FROM v_staff\.role$pattern$;
    ELSE
      old_pattern := $pattern$COALESCE\(v_jwt_role, v_staff_role\) <> v_staff_role$pattern$;
      replacement := 'pg_catalog.lower(pg_catalog.btrim(v_jwt_role)) IS DISTINCT FROM v_staff_role';
      new_pattern := $pattern$pg_catalog\.lower\(pg_catalog\.btrim\(v_jwt_role\)\) IS DISTINCT FROM v_staff_role$pattern$;
    END IF;

    old_count := pg_catalog.regexp_count(function_definition, old_pattern);
    new_count := pg_catalog.regexp_count(function_definition, new_pattern);
    IF old_count = 1 AND new_count = 0 THEN
      function_definition := pg_catalog.regexp_replace(function_definition, old_pattern, replacement, 'g');
      IF pg_catalog.regexp_count(function_definition, new_pattern) <> 1 THEN
        RAISE EXCEPTION 'Could not install fail-closed role validation on %.', function_signature;
      END IF;
      EXECUTE function_definition;
    ELSIF old_count = 0 AND new_count = 1 THEN
      -- Allow a previously hardened exact definition without rewriting it.
      NULL;
    ELSE
      RAISE EXCEPTION
        'Unexpected role-claim guard in % (old matches %, hardened matches %); refusing to rewrite it.',
        function_signature, old_count, new_count;
    END IF;
  END LOOP;
END;
$migration$;

DO $postflight$
DECLARE
  function_signatures regprocedure[] := ARRAY[
    'public.lookup_attendance_visitor_v2(text,text)'::regprocedure,
    'public.get_current_user_role()'::regprocedure,
    'public.confirm_pickup(text,text)'::regprocedure,
    'public.confirm_return(text,text)'::regprocedure,
    'public.confirm_return(uuid,text)'::regprocedure
  ];
  function_signature regprocedure;
  function_definition text;
  expected_pattern text;
BEGIN
  FOREACH function_signature IN ARRAY function_signatures LOOP
    function_definition := pg_catalog.pg_get_functiondef(function_signature);
    IF function_signature = 'public.confirm_return(uuid,text)'::regprocedure THEN
      expected_pattern := $pattern$pg_catalog\.lower\(pg_catalog\.btrim\(v_jwt_role\)\) IS DISTINCT FROM v_staff_role$pattern$;
    ELSIF function_signature = 'public.get_current_user_role()'::regprocedure THEN
      expected_pattern := $pattern$v_jwt_role IS DISTINCT FROM v_staff\.role$pattern$;
    ELSE
      expected_pattern := $pattern$IF pg_catalog\.lower\(pg_catalog\.btrim\(v_jwt_role\)\) IS DISTINCT FROM v_role THEN$pattern$;
    END IF;
    IF pg_catalog.regexp_count(function_definition, expected_pattern) <> 1
       OR NOT EXISTS (
         SELECT 1
         FROM pg_catalog.pg_proc AS procedure
         WHERE procedure.oid = function_signature
           AND procedure.proowner = 'postgres'::regrole
           AND procedure.prosecdef
           AND procedure.proconfig = ARRAY['search_path=""']::text[]
       )
       OR pg_catalog.has_function_privilege('anon', function_signature, 'EXECUTE')
       OR NOT pg_catalog.has_function_privilege('authenticated', function_signature, 'EXECUTE') THEN
      RAISE EXCEPTION 'Sensitive staff function role guard or security metadata is not canonical: %', function_signature;
    END IF;
  END LOOP;

  IF pg_catalog.has_function_privilege('anon', 'public.lookup_attendance_visitor_v2(text,text)'::regprocedure, 'EXECUTE')
     OR NOT pg_catalog.has_function_privilege('service_role', 'public.lookup_attendance_visitor_v2(text,text)'::regprocedure, 'EXECUTE')
     OR pg_catalog.has_function_privilege('anon', 'public.get_current_user_role()'::regprocedure, 'EXECUTE')
     OR NOT pg_catalog.has_function_privilege('service_role', 'public.get_current_user_role()'::regprocedure, 'EXECUTE')
     OR pg_catalog.has_function_privilege('anon', 'public.confirm_return(uuid,text)'::regprocedure, 'EXECUTE')
     OR NOT pg_catalog.has_function_privilege('service_role', 'public.confirm_return(uuid,text)'::regprocedure, 'EXECUTE')
     OR pg_catalog.has_function_privilege('service_role', 'public.confirm_pickup(text,text)'::regprocedure, 'EXECUTE')
     OR pg_catalog.has_function_privilege('service_role', 'public.confirm_return(text,text)'::regprocedure, 'EXECUTE') THEN
    RAISE EXCEPTION 'Sensitive staff function EXECUTE privileges differ from the reviewed contract';
  END IF;
END;
$postflight$;

NOTIFY pgrst, 'reload schema';

COMMIT;
