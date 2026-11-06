BEGIN;

-- Expand the personal-book presets while keeping rates category-independent.
DO $migration$
DECLARE
  function_signature text;
  function_definition text;
  rewritten_definition text;
  signatures text[] := ARRAY[
    'public.add_personal_book(text,text,text,text,text,text,text,integer,text,text,boolean,integer,boolean,integer)',
    'public.add_personal_book_with_cover(text,text,text,text,text,text,text,integer,text,text,boolean,integer,boolean,text,integer)',
    'public.update_personal_book(text,text,text,text,text,text,text,text,integer,text,text,boolean,integer,boolean,integer)',
    'public.update_personal_book_with_cover(text,text,text,text,text,text,text,text,integer,text,text,boolean,integer,boolean,text,integer)'
  ];
  old_validation constant text := 'p_fine_rate NOT IN (10, 15, 50)';
  new_validation constant text := 'p_fine_rate NOT IN (10, 15, 20, 30, 50)';
  old_message constant text := 'Personal book fine rate must be 10, 15, or 50.';
  new_message constant text := 'Personal book fine rate must be 10, 15, 20, 30, or 50.';
BEGIN
  FOREACH function_signature IN ARRAY signatures LOOP
    IF to_regprocedure(function_signature) IS NULL THEN
      RAISE EXCEPTION 'Required personal-book RPC % is missing.', function_signature;
    END IF;

    function_definition := replace(
      pg_get_functiondef(function_signature::regprocedure),
      E'\r\n',
      E'\n'
    );
    IF position(old_validation IN function_definition) = 0
       OR position(old_message IN function_definition) = 0
    THEN
      RAISE EXCEPTION 'Expected fine-rate preset validation was not found in %.', function_signature;
    END IF;

    rewritten_definition := replace(function_definition, old_validation, new_validation);
    rewritten_definition := replace(rewritten_definition, old_message, new_message);
    IF rewritten_definition = function_definition
       OR position(old_validation IN rewritten_definition) > 0
       OR position(new_validation IN rewritten_definition) = 0
    THEN
      RAISE EXCEPTION 'Could not safely update fine-rate presets in %.', function_signature;
    END IF;

    EXECUTE rewritten_definition;
  END LOOP;
END;
$migration$;

NOTIFY pgrst, 'reload schema';

COMMIT;
