-- NULLIF and COALESCE are SQL expressions, not pg_catalog functions.
-- Repair already-installed personal book RPC definitions without changing
-- their ownership, grants, argument signatures, or security checks.
DO $migration$
DECLARE
  target_function record;
  function_definition text;
BEGIN
  FOR target_function IN
    SELECT routine.oid
    FROM pg_catalog.pg_proc AS routine
    JOIN pg_catalog.pg_namespace AS schema_name
      ON schema_name.oid = routine.pronamespace
    WHERE schema_name.nspname = 'public'
      AND routine.proname IN (
        'add_personal_book_base',
        'add_personal_book_with_cover_base',
        'update_personal_book_base',
        'update_personal_book_with_cover_base'
      )
      AND routine.prokind = 'f'
  LOOP
    function_definition := pg_catalog.pg_get_functiondef(target_function.oid);
    function_definition := pg_catalog.replace(function_definition, 'pg_catalog.nullif(', 'nullif(');
    function_definition := pg_catalog.replace(function_definition, 'pg_catalog.coalesce(', 'coalesce(');
    EXECUTE function_definition;
  END LOOP;
END;
$migration$;

SELECT pg_catalog.pg_notify('pgrst', 'reload schema');
