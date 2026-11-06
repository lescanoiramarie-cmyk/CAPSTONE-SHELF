BEGIN;

-- Personal book fine rates are entered by the owner and are independent of category.
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
    rewritten_definition := regexp_replace(
      function_definition,
      E'  v_category_rate integer;\\n',
      '',
      'g'
    );
    rewritten_definition := regexp_replace(
      rewritten_definition,
      E'  -- Derive the rate from the (updated )?category\\.\\n.*?  RETURN book_row;',
      E'  IF p_fine_rate IS NOT NULL AND p_fine_rate NOT BETWEEN 1 AND 100 THEN\n' ||
      E'    RAISE EXCEPTION ''Fine rate must be a whole number from 1 to 100.'';\n' ||
      E'  END IF;\n\n' ||
      E'  IF COALESCE(p_lending_enabled, false) AND p_fine_rate IS NULL THEN\n' ||
      E'    RAISE EXCEPTION ''Enter a fine rate to enable community lending.'';\n' ||
      E'  END IF;\n\n' ||
      E'  UPDATE public.books\n' ||
      E'  SET fine_rate = p_fine_rate\n' ||
      E'  WHERE id = book_row.id\n' ||
      E'  RETURNING * INTO book_row;\n\n' ||
      E'  RETURN book_row;',
      'g'
    );

    IF rewritten_definition = function_definition
       OR position('v_category_rate' IN rewritten_definition) > 0
       OR position('get_category_fine_rate' IN rewritten_definition) > 0
       OR position('Enter a fine rate to enable community lending.' IN rewritten_definition) = 0
    THEN
      RAISE EXCEPTION 'Could not safely rewrite personal-book RPC %.', function_signature;
    END IF;

    EXECUTE rewritten_definition;
  END LOOP;
END;
$migration$;

NOTIFY pgrst, 'reload schema';

COMMIT;
