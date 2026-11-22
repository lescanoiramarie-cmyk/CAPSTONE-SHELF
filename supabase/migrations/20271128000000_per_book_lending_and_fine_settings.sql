-- Make lending duration and fine rate book-specific across library and
-- community circulation. Keep the existing RPC authorization and workflow
-- bodies intact; only replace the targeted policy fragments.
BEGIN;

-- Existing catalog records with no duration retain the intended 7-day rule.
UPDATE public.books
SET lending_period_days = 7
WHERE lending_period_days IS NULL
  AND (book_type IS NULL OR book_type = 'library' OR lending_enabled IS TRUE);

ALTER TABLE public.books
  ALTER COLUMN lending_period_days SET DEFAULT 7;

DO $migration$
DECLARE
  has_constraint boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.books'::regclass
      AND conname = 'books_lending_period_days_range'
      AND contype = 'c'
  ) INTO has_constraint;

  IF NOT has_constraint THEN
    ALTER TABLE public.books
      ADD CONSTRAINT books_lending_period_days_range
      CHECK (lending_period_days IS NULL OR lending_period_days BETWEEN 1 AND 30)
      NOT VALID;
  END IF;
END;
$migration$;

-- Keep the library checkout RPC's staff, branch, request-state, and row-lock
-- checks. Replace only the fixed 14-day duration and capture the current book
-- fine rate at checkout so later catalog edits do not alter an active loan.
DO $migration$
DECLARE
  function_oid regprocedure :=
    pg_catalog.to_regprocedure('public.confirm_pickup(text,text)');
  function_definition text;
  old_due_expressions text[] := ARRAY[
    'due_date = pg_catalog.now() + pg_catalog.interval ''14 days''',
    'due_date = pg_catalog.now() + interval ''14 days'''
  ];
  old_due_expression text;
  new_due_expression text :=
    'due_date = pg_catalog.now() + pg_catalog.make_interval(days => COALESCE((SELECT b.lending_period_days FROM public.books AS b WHERE b.id::text = v_req.book_id::text), 7))';
  occurrence_count integer;
BEGIN
  IF function_oid IS NULL THEN
    RAISE EXCEPTION 'Required function public.confirm_pickup(text,text) is missing.';
  END IF;

  function_definition := pg_catalog.pg_get_functiondef(function_oid);
  occurrence_count := 0;
  FOREACH old_due_expression IN ARRAY old_due_expressions LOOP
    occurrence_count := occurrence_count + (
      pg_catalog.length(function_definition)
      - pg_catalog.length(pg_catalog.replace(function_definition, old_due_expression, ''))
    ) / pg_catalog.length(old_due_expression);
  END LOOP;
  IF occurrence_count < 1 THEN
    RAISE EXCEPTION 'Expected fixed 14-day confirm_pickup expression was not found; review the function before applying this migration.';
  END IF;

  FOREACH old_due_expression IN ARRAY old_due_expressions LOOP
    function_definition := pg_catalog.replace(
      function_definition,
      old_due_expression,
      new_due_expression
    );
  END LOOP;
  function_definition := pg_catalog.replace(
    function_definition,
    'borrow_date = pg_catalog.now(),',
    'borrow_date = pg_catalog.now(), fine_rate_snapshot = COALESCE((SELECT b.fine_rate FROM public.books AS b WHERE b.id::text = v_req.book_id::text), fine_rate_snapshot),'
  );
  EXECUTE function_definition;
END;
$migration$;

-- Community-book pickup already uses the book's lending-period field in the
-- data model. Restore that per-book behavior and snapshot its manually set
-- fine rate while retaining the owner's authentication/ownership checks and
-- notification work.
DO $migration$
DECLARE
  function_oid regprocedure :=
    pg_catalog.to_regprocedure('public.confirm_community_book_pickup(uuid,text)');
  function_definition text;
  selection_old text := $old$
    SELECT
        b.book_type,
        b.owner_visitor_id,
        b.lending_enabled,
        b.category
    INTO
        v_book_type,
        v_book_owner_id,
        v_lending_enabled,
        v_category
$old$;
  selection_new text := $new$
    SELECT
        b.book_type,
        b.owner_visitor_id,
        b.lending_enabled,
        b.lending_period_days,
        b.fine_rate
    INTO
        v_book_type,
        v_book_owner_id,
        v_lending_enabled,
        v_lending_period_days,
        v_fine_rate
$new$;
  rate_old text := $old$
    -- Derive the rate from the approved category mapping.
    v_fine_rate := public.get_category_fine_rate(v_category);

    IF v_fine_rate IS NULL THEN
        RAISE EXCEPTION
            'Pickup cannot proceed because this book has an unsupported or missing category.';
    END IF;
$old$;
  rate_new text := $new$
    IF v_fine_rate IS NULL OR v_fine_rate NOT BETWEEN 1 AND 100 THEN
        RAISE EXCEPTION
            'Pickup cannot proceed because this book has no valid manually assigned fine rate.';
    END IF;
$new$;
BEGIN
  IF function_oid IS NULL THEN
    RAISE EXCEPTION 'Required function public.confirm_community_book_pickup(uuid,text) is missing.';
  END IF;

  function_definition := pg_catalog.pg_get_functiondef(function_oid);
  IF pg_catalog.strpos(function_definition, selection_old) = 0
     OR pg_catalog.strpos(function_definition, rate_old) = 0
     OR pg_catalog.strpos(function_definition, 'due_date = now() + interval ''7 days''') = 0 THEN
    RAISE EXCEPTION 'Community pickup function has changed from the reviewed definition; review before applying per-book settings.';
  END IF;

  function_definition := pg_catalog.replace(function_definition, '    v_category text;' || pg_catalog.chr(10), '    v_lending_period_days integer;' || pg_catalog.chr(10));
  function_definition := pg_catalog.replace(function_definition, selection_old, selection_new);
  function_definition := pg_catalog.replace(function_definition, rate_old, rate_new);
  function_definition := pg_catalog.replace(
    function_definition,
    'due_date = now() + interval ''7 days'',',
    'due_date = now() + pg_catalog.make_interval(days => COALESCE(v_lending_period_days, 7)),'
  );
  EXECUTE function_definition;
END;
$migration$;

-- Personal-book wrappers keep their current visitor authentication and
-- ownership checks. Replace only the category-derived rate block with
-- per-book 1-100 peso validation and persistence.
DO $migration$
DECLARE
  function_signature text;
  function_oid regprocedure;
  function_definition text;
  block_start integer;
  return_start integer;
  replacement text := $replacement$
  IF COALESCE(p_lending_enabled, false) THEN
    IF p_fine_rate IS NULL OR p_fine_rate NOT BETWEEN 1 AND 100 THEN
      RAISE EXCEPTION 'Fine rate must be a whole number from 1 to 100 per overdue day.';
    END IF;

    UPDATE public.books AS b
    SET fine_rate = p_fine_rate
    WHERE b.id = book_row.id
      AND b.book_type = 'personal'
      AND b.owner_visitor_id::text = pg_catalog.btrim(p_visitor_id)
    RETURNING b.* INTO book_row;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'The personal book fine rate could not be saved.';
    END IF;
  END IF;

  RETURN book_row;
$replacement$;
  signatures text[] := ARRAY[
    'public.add_personal_book(text,text,text,text,text,text,text,integer,text,text,boolean,integer,boolean,integer)',
    'public.add_personal_book_with_cover(text,text,text,text,text,text,text,integer,text,text,boolean,integer,boolean,text,integer)',
    'public.update_personal_book(text,text,text,text,text,text,text,text,integer,text,text,boolean,integer,boolean,integer)',
    'public.update_personal_book_with_cover(text,text,text,text,text,text,text,text,integer,text,text,boolean,integer,boolean,text,integer)'
  ];
BEGIN
  FOREACH function_signature IN ARRAY signatures LOOP
    function_oid := pg_catalog.to_regprocedure(function_signature);
    IF function_oid IS NULL THEN
      RAISE EXCEPTION 'Required personal-book RPC % is missing.', function_signature;
    END IF;

    function_definition := pg_catalog.pg_get_functiondef(function_oid);
    block_start := pg_catalog.strpos(function_definition, '  -- Derive the rate from the category.');
    IF block_start = 0 THEN
      block_start := pg_catalog.strpos(function_definition, '  -- Derive the rate from the updated category.');
    END IF;
    IF block_start = 0 THEN
      block_start := pg_catalog.strpos(
        function_definition,
        '  v_category_rate := public.get_category_fine_rate(book_row.category);'
      );
    END IF;
    IF block_start = 0 THEN
      RAISE EXCEPTION 'Expected category-derived fine-rate block is missing from %.', function_signature;
    END IF;
    return_start := pg_catalog.strpos(
      pg_catalog.substr(function_definition, block_start),
      '  RETURN book_row;'
    );
    IF return_start > 0 THEN
      return_start := block_start - 1 + return_start;
    END IF;
    IF return_start = 0 THEN
      RAISE EXCEPTION 'Expected return statement is missing from %.', function_signature;
    END IF;

    function_definition :=
      pg_catalog.substr(function_definition, 1, block_start - 1)
      || replacement
      || pg_catalog.substr(function_definition, return_start + pg_catalog.length('  RETURN book_row;'));
    EXECUTE function_definition;
  END LOOP;
END;
$migration$;

COMMIT;
