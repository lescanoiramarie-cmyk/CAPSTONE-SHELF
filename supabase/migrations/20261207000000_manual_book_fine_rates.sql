BEGIN;

-- Replace legacy category-only book-rate checks without changing existing rows.
DO $migration$
DECLARE
  constraint_row record;
  trigger_row record;
  trigger_definition text;
  function_definition text;
  patched_definition text;
  function_signature text;
  preflight_signature text;
  constraint_definition text;
  normalized_constraint_definition text;
  expected_fragment text;
  replacement_fragment text;
  validation_block text;
  rewritten_validation_block text;
  validation_block_pattern text;
  fragment_count integer;
  legacy_snapshot_check_count integer;
  updated_snapshot_check_count integer;
  expected_snapshot_check_count integer;
  has_rate_validation boolean;
  has_rate_assignment boolean;
  function_signatures text[] := ARRAY[
    'public.update_inventory_book(text,timestamp with time zone,jsonb)',
    'public.confirm_pickup(uuid,text)',
    'public.confirm_return(uuid,text)',
    'public.confirm_community_book_pickup(uuid,text)',
    'public.confirm_community_book_return(uuid,text)',
    'shelf_private.get_visitor_borrow_requests_unchecked(uuid)',
    'public.fetch_my_community_book_requests(text)',
    'public.fetch_owner_community_book_requests(text)'
  ];
  update_function_signature constant text :=
    'public.update_inventory_book(text,timestamp with time zone,jsonb)';
BEGIN
  FOREACH preflight_signature IN ARRAY function_signatures
  LOOP
    IF to_regprocedure(preflight_signature) IS NULL THEN
      RAISE EXCEPTION
        'Required function % is missing; no migration changes have been applied.',
        preflight_signature;
    END IF;
  END LOOP;

  SELECT pg_get_constraintdef(oid)
  INTO constraint_definition
  FROM pg_constraint
  WHERE conrelid = 'public.books'::regclass
    AND conname = 'books_fine_rate_allowed'
    AND contype = 'c';
  IF FOUND THEN
    normalized_constraint_definition := regexp_replace(
      lower(constraint_definition),
      '[[:space:]()"]',
      '',
      'g'
    );
    normalized_constraint_definition := replace(
      normalized_constraint_definition,
      'check',
      ''
    );
    IF normalized_constraint_definition NOT IN (
      'fine_rateisnullorfine_ratein10,15,20',
      'fine_rateisnullorfine_rate=anyarray[10,15,20]'
    ) THEN
      RAISE EXCEPTION
        'Constraint public.books.books_fine_rate_allowed has an unexpected definition: %',
        constraint_definition;
    END IF;
    ALTER TABLE public.books
      DROP CONSTRAINT books_fine_rate_allowed;
  END IF;

  SELECT pg_get_constraintdef(oid)
  INTO constraint_definition
  FROM pg_constraint
  WHERE conrelid = 'public.borrow_requests'::regclass
    AND conname = 'borrow_requests_fine_rate_snapshot_allowed'
    AND contype = 'c';
  IF FOUND THEN
    normalized_constraint_definition := regexp_replace(
      lower(constraint_definition),
      '[[:space:]()"]',
      '',
      'g'
    );
    normalized_constraint_definition := replace(
      normalized_constraint_definition,
      'check',
      ''
    );
    IF normalized_constraint_definition NOT IN (
      'fine_rate_snapshotisnullorfine_rate_snapshotin10,15,20',
      'fine_rate_snapshotisnullorfine_rate_snapshot=anyarray[10,15,20]'
    ) THEN
      RAISE EXCEPTION
        'Constraint public.borrow_requests.borrow_requests_fine_rate_snapshot_allowed has an unexpected definition: %',
        constraint_definition;
    END IF;
    ALTER TABLE public.borrow_requests
      DROP CONSTRAINT borrow_requests_fine_rate_snapshot_allowed;
  END IF;

  SELECT pg_get_constraintdef(oid)
  INTO constraint_definition
  FROM pg_constraint
  WHERE conrelid = 'public.community_book_requests'::regclass
    AND conname = 'community_book_requests_fine_rate_snapshot_allowed'
    AND contype = 'c';
  IF FOUND THEN
    normalized_constraint_definition := regexp_replace(
      lower(constraint_definition),
      '[[:space:]()"]',
      '',
      'g'
    );
    normalized_constraint_definition := replace(
      normalized_constraint_definition,
      'check',
      ''
    );
    IF normalized_constraint_definition NOT IN (
      'fine_rate_snapshotisnullorfine_rate_snapshotin10,15,20',
      'fine_rate_snapshotisnullorfine_rate_snapshot=anyarray[10,15,20]'
    ) THEN
      RAISE EXCEPTION
        'Constraint public.community_book_requests.community_book_requests_fine_rate_snapshot_allowed has an unexpected definition: %',
        constraint_definition;
    END IF;
    ALTER TABLE public.community_book_requests
      DROP CONSTRAINT community_book_requests_fine_rate_snapshot_allowed;
  END IF;

  SELECT pg_get_constraintdef(oid)
  INTO constraint_definition
  FROM pg_constraint
  WHERE conrelid = 'public.books'::regclass
    AND conname = 'books_fine_rate_range'
    AND contype = 'c';
  IF FOUND THEN
    normalized_constraint_definition := regexp_replace(
      lower(constraint_definition),
      '[[:space:]()"]',
      '',
      'g'
    );
    normalized_constraint_definition := replace(
      normalized_constraint_definition,
      'check',
      ''
    );
    IF normalized_constraint_definition NOT IN (
      'fine_rateisnullorfine_ratebetween1and100',
      'fine_rateisnullorfine_rate>=1andfine_rate<=100'
    ) THEN
      RAISE EXCEPTION
        'Constraint public.books.books_fine_rate_range has an unexpected definition: %',
        constraint_definition;
    END IF;
  ELSE
    ALTER TABLE public.books
      ADD CONSTRAINT books_fine_rate_range
      CHECK (fine_rate IS NULL OR fine_rate BETWEEN 1 AND 100)
      NOT VALID;
  END IF;

  -- Unknown fine-rate checks must be reviewed rather than silently retained
  -- or removed.
  FOR constraint_row IN
    SELECT conrelid::regclass AS table_name, conname
    FROM pg_constraint
    WHERE conrelid IN (
        'public.books'::regclass,
        'public.borrow_requests'::regclass,
        'public.community_book_requests'::regclass
      )
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%fine_rate%'
      AND conname NOT IN (
        'books_fine_rate_range',
        'books_fine_rate_allowed',
        'borrow_requests_fine_rate_snapshot_allowed',
        'community_book_requests_fine_rate_snapshot_allowed'
      )
  LOOP
    RAISE EXCEPTION
      'Unreviewed fine-rate CHECK constraint %.% exists; review it before applying this migration.',
      constraint_row.table_name,
      constraint_row.conname;
  END LOOP;

  -- Remove only a single-purpose category-rate trigger. Stop safely if a
  -- matching trigger also mutates other book fields.
  FOR trigger_row IN
    SELECT tgname, tgfoid
    FROM pg_trigger
    WHERE tgrelid = 'public.books'::regclass
      AND NOT tgisinternal
      AND replace(pg_get_functiondef(tgfoid), E'\r\n', E'\n') ILIKE '%fine_rate%'
      AND replace(pg_get_functiondef(tgfoid), E'\r\n', E'\n') ILIKE '%category%'
      AND replace(pg_get_functiondef(tgfoid), E'\r\n', E'\n') ~* 'NEW\.fine_rate\s*(:=|=)'
  LOOP
    trigger_definition := pg_get_functiondef(trigger_row.tgfoid);
    trigger_definition := replace(trigger_definition, E'\r\n', E'\n');
    IF regexp_replace(
      trigger_definition,
      'NEW\.(fine_rate|category)',
      '',
      'gi'
    ) ~* 'NEW\.[A-Za-z_][A-Za-z_0-9]*\s*(:=|=)'
    THEN
      RAISE EXCEPTION
        'The category fine-rate trigger % also updates other book fields; review it before applying this migration.',
        trigger_row.tgname;
    END IF;

    EXECUTE format(
      'DROP TRIGGER %I ON public.books',
      trigger_row.tgname
    );
  END LOOP;

  function_definition := pg_get_functiondef(
    update_function_signature::regprocedure
  );
  function_definition := replace(function_definition, E'\r\n', E'\n');
  has_rate_validation :=
    position('Fine rate must be a whole number from 1 to 100.' IN function_definition) > 0;
  has_rate_assignment :=
    position('fine_rate = CASE' IN function_definition) > 0;

  IF has_rate_validation OR has_rate_assignment THEN
    expected_fragment := 'Fine rate must be a whole number from 1 to 100.';
    fragment_count :=
      (length(function_definition) - length(replace(function_definition, expected_fragment, '')))
      / length(expected_fragment);
    IF fragment_count <> 2 THEN
      RAISE EXCEPTION
        'update_inventory_book has an unexpected fine-rate validation count (%); review its definition.',
        fragment_count;
    END IF;

    expected_fragment := 'fine_rate = CASE';
    fragment_count :=
      (length(function_definition) - length(replace(function_definition, expected_fragment, '')))
      / length(expected_fragment);
    IF fragment_count <> 1 THEN
      RAISE EXCEPTION
        'update_inventory_book has an unexpected fine-rate assignment count (%); review its definition.',
        fragment_count;
    END IF;
    IF position('p_patch ? ''fine_rate''' IN function_definition) = 0
       OR position('p_patch ->> ''fine_rate''' IN function_definition) = 0
       OR position('NOT BETWEEN 1 AND 100' IN function_definition) = 0
       OR position('IF p_patch ? ''fine_rate'' THEN' IN function_definition) = 0
       OR position('    -- Update only fields explicitly supported by the original RPC.' IN function_definition) = 0
       OR position('        library_id = new_library_id::uuid,' IN function_definition) = 0
    THEN
      RAISE EXCEPTION
        'update_inventory_book has a partial or unexpected fine-rate change; review its definition.';
    END IF;
  ELSE
    expected_fragment :=
      '    -- Update only fields explicitly supported by the original RPC.';
    fragment_count :=
      (length(function_definition) - length(replace(function_definition, expected_fragment, '')))
      / length(expected_fragment);
    IF fragment_count <> 1 THEN
      RAISE EXCEPTION
        'The reviewed update_inventory_book insertion point is missing or duplicated.';
    END IF;
    expected_fragment := '        library_id = new_library_id::uuid,';
    fragment_count :=
      (length(function_definition) - length(replace(function_definition, expected_fragment, '')))
      / length(expected_fragment);
    IF fragment_count <> 1 OR position('fine_rate = CASE' IN function_definition) > 0 THEN
      RAISE EXCEPTION
        'The reviewed update_inventory_book assignment point is missing, duplicated, or partially modified.';
    END IF;

    function_definition := replace(
      function_definition,
      '    -- Update only fields explicitly supported by the original RPC.',
      $validation$        IF p_patch ? 'fine_rate' THEN
        IF jsonb_typeof(p_patch -> 'fine_rate') IS DISTINCT FROM 'number'
           OR (p_patch ->> 'fine_rate') !~ '^[0-9]+$'
        THEN
            RAISE EXCEPTION
                'Fine rate must be a whole number from 1 to 100.';
        END IF;

        IF (p_patch ->> 'fine_rate')::numeric NOT BETWEEN 1 AND 100 THEN
            RAISE EXCEPTION
                'Fine rate must be a whole number from 1 to 100.';
        END IF;
    END IF;

    -- Update only fields explicitly supported by the original RPC.$validation$
    );
    function_definition := replace(
      function_definition,
      '        library_id = new_library_id::uuid,',
      $update$fine_rate = CASE
            WHEN p_patch ? 'fine_rate'
                THEN (p_patch ->> 'fine_rate')::integer
            ELSE fine_rate
        END,
        library_id = new_library_id::uuid,$update$
    );
    expected_fragment := 'Fine rate must be a whole number from 1 to 100.';
    fragment_count :=
      (length(function_definition) - length(replace(function_definition, expected_fragment, '')))
      / length(expected_fragment);
    IF fragment_count <> 2 THEN
      RAISE EXCEPTION
        'Fine-rate validation was not added exactly twice to update_inventory_book.';
    END IF;
    expected_fragment := 'fine_rate = CASE';
    fragment_count :=
      (length(function_definition) - length(replace(function_definition, expected_fragment, '')))
      / length(expected_fragment);
    IF fragment_count <> 1
       OR position('    -- Update only fields explicitly supported by the original RPC.' IN function_definition) = 0
       OR position('        library_id = new_library_id::uuid,' IN function_definition) = 0
    THEN
      RAISE EXCEPTION
        'Fine-rate validation or persistence was not added correctly to update_inventory_book.';
    END IF;
    EXECUTE function_definition;
  END IF;

  -- Rates are snapshotted at checkout; returns continue to preserve any
  -- previously assessed amount while accepting the new 1-100 range.
  FOREACH function_signature IN ARRAY function_signatures[2:array_length(function_signatures, 1)]
  LOOP
    function_definition := pg_get_functiondef(
      function_signature::regprocedure
    );
    function_definition := replace(function_definition, E'\r\n', E'\n');

    IF function_signature = 'public.confirm_return(uuid,text)'
       OR function_signature = 'public.confirm_community_book_return(uuid,text)'
    THEN
      expected_snapshot_check_count := 1;
    ELSIF function_signature = 'shelf_private.get_visitor_borrow_requests_unchecked(uuid)'
       OR function_signature = 'public.fetch_my_community_book_requests(text)'
       OR function_signature = 'public.fetch_owner_community_book_requests(text)'
    THEN
      expected_snapshot_check_count := 2;
    ELSE
      expected_snapshot_check_count := 0;
    END IF;

    SELECT count(*) INTO legacy_snapshot_check_count
    FROM regexp_matches(
      function_definition,
      'fine_rate_snapshot\s+(NOT IN|IN)\s*\(\s*10\s*,\s*15\s*,\s*20\s*\)',
      'gi'
    );
    SELECT count(*) INTO updated_snapshot_check_count
    FROM regexp_matches(
      function_definition,
      'fine_rate_snapshot\s+(NOT BETWEEN|BETWEEN)\s+1\s+AND\s+100',
      'gi'
    );
    IF NOT (
      (legacy_snapshot_check_count = expected_snapshot_check_count
        AND updated_snapshot_check_count = 0)
      OR
      (legacy_snapshot_check_count = 0
        AND updated_snapshot_check_count = expected_snapshot_check_count)
    ) THEN
      RAISE EXCEPTION
        'Function % has partial or unexpected fine-rate snapshot checks (legacy %, updated %, expected %).',
        function_signature,
        legacy_snapshot_check_count,
        updated_snapshot_check_count,
        expected_snapshot_check_count;
    END IF;

    patched_definition := regexp_replace(
      function_definition,
      'fine_rate_snapshot\s+NOT IN\s*\(\s*10\s*,\s*15\s*,\s*20\s*\)',
      'fine_rate_snapshot NOT BETWEEN 1 AND 100',
      'gi'
    );
    patched_definition := regexp_replace(
      patched_definition,
      'fine_rate_snapshot\s+IN\s*\(\s*10\s*,\s*15\s*,\s*20\s*\)',
      'fine_rate_snapshot BETWEEN 1 AND 100',
      'gi'
    );

    IF function_signature = 'public.confirm_pickup(uuid,text)' THEN
      SELECT count(*) INTO fragment_count
      FROM regexp_matches(
        patched_definition,
        'v_fine_rate\s+NOT IN\s*\(\s*10\s*,\s*15\s*,\s*20\s*\)',
        'gi'
      );
      IF fragment_count = 1
         AND position('v_fine_rate NOT BETWEEN 1 AND 100' IN patched_definition) = 0
      THEN
        SELECT count(*) INTO fragment_count
        FROM regexp_matches(
          patched_definition,
          '\s+OR\s+v_fine_rate\s+IS\s+DISTINCT\s+FROM\s+public\.get_category_fine_rate\(v_category\)',
          'gi'
        );
        IF fragment_count <> 1 THEN
          RAISE EXCEPTION
            'confirm_pickup has an unexpected category-rate validation; review its definition.';
        END IF;
        patched_definition := regexp_replace(
          patched_definition,
          '\s+OR v_fine_rate IS DISTINCT FROM public\.get_category_fine_rate\(v_category\)',
          '',
          'gi'
        );
        patched_definition := regexp_replace(
          patched_definition,
          'v_fine_rate\s+NOT IN\s*\(\s*10\s*,\s*15\s*,\s*20\s*\)',
          'v_fine_rate NOT BETWEEN 1 AND 100',
          'gi'
        );
      ELSIF fragment_count <> 0 THEN
        RAISE EXCEPTION
          'confirm_pickup has a partial or unexpected fine-rate validation.';
      END IF;
      SELECT count(*) INTO fragment_count
      FROM regexp_matches(
        patched_definition,
        'v_fine_rate\s+NOT BETWEEN\s+1\s+AND\s+100',
        'gi'
      );
      IF fragment_count <> 1
         OR position('get_category_fine_rate' IN patched_definition) > 0
      THEN
        RAISE EXCEPTION
          'The library checkout rate validation was not updated safely.';
      END IF;
    ELSIF function_signature = 'public.confirm_community_book_pickup(uuid,text)' THEN
      IF position('b.fine_rate' IN function_definition) = 0 THEN
        expected_fragment := '  v_category text;' || chr(10);
        fragment_count :=
          (length(function_definition) - length(replace(function_definition, expected_fragment, '')))
          / length(expected_fragment);
        IF fragment_count <> 1 THEN
          RAISE EXCEPTION
            'The community-book checkout category declaration is missing or duplicated.';
        END IF;

        expected_fragment :=
          '    b.category' || chr(10) || '  INTO' || chr(10) ||
          '    v_book_type,' || chr(10) || '    v_book_owner_id,' ||
          chr(10) || '    v_lending_enabled,' || chr(10) || '    v_category';
        fragment_count :=
          (length(function_definition) - length(replace(function_definition, expected_fragment, '')))
          / length(expected_fragment);
        IF fragment_count <> 1 THEN
          RAISE EXCEPTION
            'The community-book checkout category SELECT fragment is missing or duplicated.';
        END IF;

        SELECT count(*) INTO fragment_count
        FROM regexp_matches(
          function_definition,
          'v_fine_rate[ \t]*:=[ \t]*public\.get_category_fine_rate[ \t]*\([ \t]*v_category[ \t]*\)[ \t]*;',
          'gi'
        );
        IF fragment_count <> 1 THEN
          RAISE EXCEPTION
            'The community-book checkout category assignment is missing or duplicated.';
        END IF;

        validation_block_pattern := $pattern$(IF[[:space:]]+v_fine_rate[[:space:]]+IS[[:space:]]+NULL[[:space:]]+THEN[[:space:]]+RAISE[[:space:]]+EXCEPTION[[:space:]]+'Pickup cannot proceed because this book has an unsupported or missing category\.'[[:space:]]*;[[:space:]]+END[[:space:]]+IF[[:space:]]*;)$pattern$;
        SELECT count(*) INTO fragment_count
        FROM regexp_matches(
          function_definition,
          validation_block_pattern,
          'gi'
        );
        IF fragment_count <> 1 THEN
          RAISE EXCEPTION
            'The community-book checkout validation fragment is missing or duplicated.';
        END IF;
        SELECT matched_fragment[1] INTO validation_block
        FROM regexp_matches(
          function_definition,
          validation_block_pattern,
          'gi'
        ) AS matches(matched_fragment);
        expected_fragment :=
          'Pickup cannot proceed because this book has an unsupported or missing category.';
        fragment_count :=
          (length(validation_block) - length(replace(validation_block, expected_fragment, '')))
          / length(expected_fragment);
        IF fragment_count <> 1 THEN
          RAISE EXCEPTION
            'The community-book checkout validation message is missing or duplicated.';
        END IF;
        SELECT count(*) INTO fragment_count
        FROM regexp_matches(
          validation_block,
          'IF[[:space:]]+v_fine_rate[[:space:]]+IS[[:space:]]+NULL[[:space:]]+THEN',
          'gi'
        );
        IF fragment_count <> 1 THEN
          RAISE EXCEPTION
            'The community-book checkout validation condition is missing or duplicated.';
        END IF;

        patched_definition := replace(
          function_definition,
          '  v_category text;' || chr(10),
          ''
        );
        expected_fragment :=
          '    b.category' || chr(10) || '  INTO' || chr(10) ||
          '    v_book_type,' || chr(10) || '    v_book_owner_id,' ||
          chr(10) || '    v_lending_enabled,' || chr(10) || '    v_category';
        replacement_fragment :=
          '    b.fine_rate' || chr(10) || '  INTO' || chr(10) ||
          '    v_book_type,' || chr(10) || '    v_book_owner_id,' ||
          chr(10) || '    v_lending_enabled,' || chr(10) || '    v_fine_rate';
        patched_definition := replace(
          patched_definition,
          expected_fragment,
          replacement_fragment
        );
        rewritten_validation_block := regexp_replace(
          validation_block,
          'IF[[:space:]]+v_fine_rate[[:space:]]+IS[[:space:]]+NULL[[:space:]]+THEN',
          'IF v_fine_rate IS NULL OR v_fine_rate NOT BETWEEN 1 AND 100 THEN',
          'i'
        );
        rewritten_validation_block := replace(
          rewritten_validation_block,
          'Pickup cannot proceed because this book has an unsupported or missing category.',
          'Pickup cannot proceed because this book has no valid fine rate.'
        );
        SELECT count(*) INTO fragment_count
        FROM regexp_matches(
          rewritten_validation_block,
          'IF[[:space:]]+v_fine_rate[[:space:]]+IS[[:space:]]+NULL[[:space:]]+OR[[:space:]]+v_fine_rate[[:space:]]+NOT[[:space:]]+BETWEEN[[:space:]]+1[[:space:]]+AND[[:space:]]+100[[:space:]]+THEN',
          'gi'
        );
        IF fragment_count <> 1 THEN
          RAISE EXCEPTION
            'The community-book checkout 1-100 validation condition was not added exactly once.';
        END IF;
        patched_definition := replace(
          patched_definition,
          validation_block,
          rewritten_validation_block
        );
        patched_definition := regexp_replace(
          patched_definition,
          'v_fine_rate[ \t]*:=[ \t]*public\.get_category_fine_rate[ \t]*\([ \t]*v_category[ \t]*\)[ \t]*;',
          '-- Use the rate stored on the book when the request is checked out.',
          'gi'
        );
        patched_definition := regexp_replace(
          patched_definition,
          '[ \t]*-- Derive the rate from the approved category mapping\.' || chr(10),
          '',
          'g'
        );
      END IF;

      SELECT count(*) INTO fragment_count
      FROM regexp_matches(
        patched_definition,
        'v_fine_rate\s+NOT BETWEEN\s+1\s+AND\s+100',
        'gi'
      );
      IF fragment_count <> 1
         OR position('b.fine_rate' IN patched_definition) = 0
         OR position('b.category' IN patched_definition) > 0
         OR position('v_category' IN patched_definition) > 0
         OR position('get_category_fine_rate' IN patched_definition) > 0
         OR position('fine_rate_snapshot = v_fine_rate' IN patched_definition) = 0
      THEN
        RAISE EXCEPTION
          'The community-book checkout fine-rate rewrite is partial or invalid.';
      END IF;
      expected_fragment := '  v_fine_rate integer;' || chr(10);
      fragment_count :=
        (length(patched_definition) - length(replace(patched_definition, expected_fragment, '')))
        / length(expected_fragment);
      IF fragment_count <> 1 THEN
        RAISE EXCEPTION
          'The community-book checkout rate declaration is missing or duplicated.';
      END IF;
      expected_fragment :=
        '    b.fine_rate' || chr(10) || '  INTO' || chr(10) ||
        '    v_book_type,' || chr(10) || '    v_book_owner_id,' ||
        chr(10) || '    v_lending_enabled,' || chr(10) || '    v_fine_rate';
      fragment_count :=
        (length(patched_definition) - length(replace(patched_definition, expected_fragment, '')))
        / length(expected_fragment);
      IF fragment_count <> 1 THEN
        RAISE EXCEPTION
          'The community-book checkout SELECT replacement did not occur exactly once.';
      END IF;
      expected_fragment := $saved_rate$  -- Use the rate stored on the book when the request is checked out.$saved_rate$;
      fragment_count :=
        (length(patched_definition) - length(replace(patched_definition, expected_fragment, '')))
        / length(expected_fragment);
      IF fragment_count <> 1 THEN
        RAISE EXCEPTION
          'The community-book checkout saved-rate assignment replacement is missing or duplicated.';
      END IF;
      validation_block_pattern := $validation_pattern$(IF[[:space:]]+v_fine_rate[[:space:]]+IS[[:space:]]+NULL[[:space:]]+OR[[:space:]]+v_fine_rate[[:space:]]+NOT[[:space:]]+BETWEEN[[:space:]]+1[[:space:]]+AND[[:space:]]+100[[:space:]]+THEN[[:space:]]+RAISE[[:space:]]+EXCEPTION[[:space:]]+'Pickup cannot proceed because this book has no valid fine rate\.'[[:space:]]*;[[:space:]]*END[[:space:]]+IF[[:space:]]*;)$validation_pattern$;
      SELECT count(*) INTO fragment_count
      FROM regexp_matches(
        patched_definition,
        validation_block_pattern,
        'gi'
      );
      IF fragment_count <> 1 THEN
        RAISE EXCEPTION
          'The community-book checkout 1-100 validation replacement is missing or duplicated.';
      END IF;
      expected_fragment := 'fine_rate_snapshot = v_fine_rate';
      fragment_count :=
        (length(patched_definition) - length(replace(patched_definition, expected_fragment, '')))
        / length(expected_fragment);
      IF fragment_count <> 1 THEN
        RAISE EXCEPTION
          'The community-book checkout rate snapshot assignment is missing or duplicated.';
      END IF;
    END IF;

    SELECT count(*) INTO legacy_snapshot_check_count
    FROM regexp_matches(
      patched_definition,
      'fine_rate_snapshot\s+(NOT IN|IN)\s*\(\s*10\s*,\s*15\s*,\s*20\s*\)',
      'gi'
    );
    SELECT count(*) INTO updated_snapshot_check_count
    FROM regexp_matches(
      patched_definition,
      'fine_rate_snapshot\s+(NOT BETWEEN|BETWEEN)\s+1\s+AND\s+100',
      'gi'
    );
    IF legacy_snapshot_check_count <> 0
       OR updated_snapshot_check_count <> expected_snapshot_check_count
    THEN
      RAISE EXCEPTION
        'Function % has incomplete snapshot-rate validation after rewriting.',
        function_signature;
    END IF;

    IF patched_definition <> function_definition THEN
      EXECUTE patched_definition;
    END IF;
  END LOOP;
END;
$migration$;

NOTIFY pgrst, 'reload schema';

COMMIT;
