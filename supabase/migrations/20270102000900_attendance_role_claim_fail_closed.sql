-- A missing app_metadata.role is not evidence that the database staff role is
-- authorized. Fail closed for both privileged attendance RPCs.
-- CREATE OR REPLACE preserves each function's existing owner and ACL.
DO $migration$
DECLARE
  function_signature regprocedure;
  function_definition text;
  old_pattern constant text := $pattern$IF v_jwt_role IS NOT NULL[[:space:]]+AND pg_catalog\.lower\(pg_catalog\.btrim\(v_jwt_role\)\) <> v_role THEN$pattern$;
  new_pattern constant text := $pattern$IF pg_catalog\.lower\(pg_catalog\.btrim\(v_jwt_role\)\) IS DISTINCT FROM v_role THEN$pattern$;
  old_count integer;
  new_count integer;
BEGIN
  FOREACH function_signature IN ARRAY ARRAY[
    'public.find_visitor_by_qr(text,uuid)'::regprocedure,
    'public.toggle_attendance(text,text)'::regprocedure
  ] LOOP
    function_definition := pg_catalog.pg_get_functiondef(function_signature);
    old_count := pg_catalog.regexp_count(function_definition, old_pattern);
    new_count := pg_catalog.regexp_count(function_definition, new_pattern);

    IF old_count = 1 AND new_count = 0 THEN
      function_definition := pg_catalog.regexp_replace(
        function_definition,
        old_pattern,
        'IF pg_catalog.lower(pg_catalog.btrim(v_jwt_role)) IS DISTINCT FROM v_role THEN',
        'g'
      );
      IF pg_catalog.regexp_count(function_definition, new_pattern) <> 1 THEN
        RAISE EXCEPTION 'Could not harden the role-claim check in %.', function_signature;
      END IF;
      EXECUTE function_definition;
    ELSIF old_count = 0 AND new_count = 1 THEN
      -- A prior compatible application already contains the hardened guard.
      NULL;
    ELSE
      RAISE EXCEPTION
        'Unexpected role-claim guard in % (old matches %, hardened matches %); refusing to rewrite it.',
        function_signature, old_count, new_count;
    END IF;
  END LOOP;
END;
$migration$;

NOTIFY pgrst, 'reload schema';