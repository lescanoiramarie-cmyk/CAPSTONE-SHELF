BEGIN;

-- Preserve manually assigned rates while allowing older personal books to use
-- their established category rate when no per-book rate was saved.
DO $migration$
DECLARE
  function_definition text;
  patched_definition text;
  replacement_count integer;
BEGIN
  SELECT pg_get_functiondef(
    'public.confirm_community_book_pickup(uuid, text)'::regprocedure
  )
  INTO function_definition;

  IF function_definition IS NULL THEN
    RAISE EXCEPTION
      'Required function public.confirm_community_book_pickup(uuid, text) is missing.';
  END IF;

  IF position(
    'COALESCE(b.fine_rate, public.get_category_fine_rate(b.category))'
    IN function_definition
  ) > 0 THEN
    RETURN;
  END IF;

  SELECT count(*) INTO replacement_count
  FROM regexp_matches(function_definition, 'b\.fine_rate', 'g');

  IF replacement_count <> 1
     OR position('b.category' IN function_definition) <> 0
     OR position('fine_rate_snapshot = v_fine_rate' IN function_definition) = 0
     OR position('v_fine_rate NOT BETWEEN 1 AND 100' IN function_definition) = 0
  THEN
    RAISE EXCEPTION
      'Community-book pickup function does not match the reviewed fine-rate contract; no changes were applied.';
  END IF;

  patched_definition := replace(
    function_definition,
    'b.fine_rate',
    'COALESCE(b.fine_rate, public.get_category_fine_rate(b.category))'
  );

  IF position(
       'COALESCE(b.fine_rate, public.get_category_fine_rate(b.category))'
       IN patched_definition
     ) = 0
     OR position('fine_rate_snapshot = v_fine_rate' IN patched_definition) = 0
     OR position('v_fine_rate NOT BETWEEN 1 AND 100' IN patched_definition) = 0
  THEN
    RAISE EXCEPTION
      'Community-book pickup fine-rate fallback could not be verified.';
  END IF;

  EXECUTE patched_definition;
END;
$migration$;

NOTIFY pgrst, 'reload schema';

COMMIT;
