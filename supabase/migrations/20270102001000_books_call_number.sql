-- Optional library classification code. Existing books remain unchanged and
-- receive NULL until staff supply a call number.
ALTER TABLE public.books
  ADD COLUMN call_number text;

ALTER TABLE public.books
  ADD CONSTRAINT books_call_number_length_check
  CHECK (
    call_number IS NULL
    OR (
      call_number = pg_catalog.btrim(call_number)
      AND pg_catalog.char_length(call_number) <= 100
    )
  );

-- Extend the existing authorization-aware, optimistic-concurrency RPC rather
-- than creating a direct frontend update path around its branch checks.
DO $migration$
DECLARE
  function_signature constant regprocedure :=
    'public.update_inventory_book(text,timestamptz,jsonb)'::regprocedure;
  function_definition text;
  update_pattern constant text := $pattern$UPDATE public\.books[[:space:]]+SET$pattern$;
  fine_rate_pattern constant text := $pattern$fine_rate[[:space:]]*=[[:space:]]*CASE$pattern$;
  validation_block constant text := $validation$IF p_patch ? 'call_number' THEN
        IF pg_catalog.jsonb_typeof(p_patch -> 'call_number') NOT IN ('string', 'null')
           OR pg_catalog.char_length(COALESCE(p_patch ->> 'call_number', '')) > 100
        THEN
            RAISE EXCEPTION 'Call Number must be text of at most 100 characters.';
        END IF;
    END IF;$validation$;
BEGIN
  function_definition := pg_catalog.pg_get_functiondef(function_signature);

  IF pg_catalog.regexp_count(function_definition, update_pattern) <> 1
     OR pg_catalog.regexp_count(function_definition, fine_rate_pattern) <> 1
     OR pg_catalog.strpos(function_definition, 'call_number = CASE') <> 0 THEN
    RAISE EXCEPTION
      'update_inventory_book has an unexpected definition; refusing to add Call Number support.';
  END IF;

  function_definition := pg_catalog.regexp_replace(
    function_definition,
    update_pattern,
    validation_block || E'\n\n    UPDATE public.books SET',
    'g'
  );
  function_definition := pg_catalog.regexp_replace(
    function_definition,
    fine_rate_pattern,
    $assignment$call_number = CASE
            WHEN p_patch ? 'call_number'
                THEN NULLIF(pg_catalog.btrim(p_patch ->> 'call_number'), '')
            ELSE call_number
        END,
        fine_rate = CASE$assignment$,
    'g'
  );

  IF pg_catalog.strpos(function_definition, 'Call Number must be text of at most 100 characters.') = 0
     OR pg_catalog.strpos(function_definition, 'call_number = CASE') = 0 THEN
    RAISE EXCEPTION 'Call Number validation or persistence could not be added safely.';
  END IF;

  EXECUTE function_definition;
END;
$migration$;