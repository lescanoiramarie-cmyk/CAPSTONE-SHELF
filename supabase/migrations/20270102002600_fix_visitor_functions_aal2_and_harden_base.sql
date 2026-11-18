-- Fix visitor-facing functions: remove inappropriate AAL2, harden base functions
-- Visitor operations should use AAL1 (regular auth), not AAL2 (MFA)
-- Staff operations correctly require AAL2
-- Also harden base personal book functions with empty search_path and proper grants

BEGIN;

-- ============================================================
-- 1. Fix add_personal_book (14-arg overload with fine_rate) - remove AAL2
-- ============================================================

DROP FUNCTION IF EXISTS public.add_personal_book(
  text, text, text, text, text, text, text, integer, text, text, boolean,
  integer, boolean, integer
);

CREATE OR REPLACE FUNCTION public.add_personal_book(
  p_visitor_id text,
  p_title text,
  p_author text,
  p_category text,
  p_isbn text,
  p_summary text,
  p_condition text,
  p_lending_period_days integer,
  p_handover_method text,
  p_handover_details text,
  p_lending_enabled boolean,
  p_total_copies integer,
  p_is_public boolean,
  p_fine_rate integer
)
RETURNS public.books
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  book_row public.books%ROWTYPE;
  v_category_rate integer;
  v_visitor public.visitors%ROWTYPE;
BEGIN
  -- Require authenticated visitor session (AAL1 - regular auth, not AAL2)
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authenticated visitor account required.';
  END IF;

  -- Verify visitor ownership
  SELECT v.* INTO v_visitor
  FROM public.visitors AS v
  WHERE v.id = pg_catalog.btrim(p_visitor_id)
    AND v.auth_user_id = auth.uid()
    AND v.otp_verified = true
    AND v.is_active = true
  LIMIT 1;

  IF v_visitor.id IS NULL THEN
    RAISE EXCEPTION 'Visitor account could not be verified.';
  END IF;

  -- Call the base function (will be hardened below)
  book_row := public.add_personal_book_base(
    p_visitor_id,
    p_title,
    p_author,
    p_category,
    p_isbn,
    p_summary,
    p_condition,
    p_lending_period_days,
    p_handover_method,
    p_handover_details,
    p_lending_enabled,
    p_total_copies,
    p_is_public
  );

  -- Derive the rate from the category.
  v_category_rate := public.get_category_fine_rate(book_row.category);

  IF COALESCE(p_lending_enabled, false) THEN
    IF v_category_rate IS NULL THEN
      RAISE EXCEPTION
        'This category does not have an approved fine rate. Choose a supported category.';
    END IF;

    IF p_fine_rate IS DISTINCT FROM v_category_rate THEN
      RAISE EXCEPTION
        'The selected fine rate does not match the book category. Expected rate: % PHP per overdue day.',
        v_category_rate;
    END IF;

    IF book_row.fine_rate IS DISTINCT FROM v_category_rate THEN
      RAISE EXCEPTION
        'The book fine rate does not match its category. Please review the book category.';
    END IF;
  END IF;

  RETURN book_row;
END;
$function$;

ALTER FUNCTION public.add_personal_book(
  text, text, text, text, text, text, text, integer, text, text, boolean,
  integer, boolean, integer
) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.add_personal_book(
  text, text, text, text, text, text, text, integer, text, text, boolean,
  integer, boolean, integer
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.add_personal_book(
  text, text, text, text, text, text, text, integer, text, text, boolean,
  integer, boolean, integer
) TO authenticated, service_role;

-- ============================================================
-- 2. Fix add_personal_book_with_cover (15-arg overload with fine_rate) - remove AAL2
-- ============================================================

DROP FUNCTION IF EXISTS public.add_personal_book_with_cover(
  text, text, text, text, text, text, text, integer, text, text, boolean,
  integer, boolean, text, integer
);

CREATE OR REPLACE FUNCTION public.add_personal_book_with_cover(
  p_visitor_id text,
  p_title text,
  p_author text,
  p_category text,
  p_isbn text,
  p_summary text,
  p_condition text,
  p_lending_period_days integer,
  p_handover_method text,
  p_handover_details text,
  p_lending_enabled boolean,
  p_total_copies integer,
  p_is_public boolean,
  p_cover_url text,
  p_fine_rate integer
)
RETURNS public.books
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  book_row public.books%ROWTYPE;
  v_category_rate integer;
  v_visitor public.visitors%ROWTYPE;
BEGIN
  -- Require authenticated visitor session (AAL1 - regular auth, not AAL2)
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authenticated visitor account required.';
  END IF;

  -- Verify visitor ownership
  SELECT v.* INTO v_visitor
  FROM public.visitors AS v
  WHERE v.id = pg_catalog.btrim(p_visitor_id)
    AND v.auth_user_id = auth.uid()
    AND v.otp_verified = true
    AND v.is_active = true
  LIMIT 1;

  IF v_visitor.id IS NULL THEN
    RAISE EXCEPTION 'Visitor account could not be verified.';
  END IF;

  -- Call the base function (will be hardened below)
  book_row := public.add_personal_book_with_cover_base(
    p_visitor_id,
    p_title,
    p_author,
    p_category,
    p_isbn,
    p_summary,
    p_condition,
    p_lending_period_days,
    p_handover_method,
    p_handover_details,
    p_lending_enabled,
    p_total_copies,
    p_is_public,
    p_cover_url
  );

  -- Derive the rate from the category.
  v_category_rate := public.get_category_fine_rate(book_row.category);

  IF COALESCE(p_lending_enabled, false) THEN
    IF v_category_rate IS NULL THEN
      RAISE EXCEPTION
        'This category does not have an approved fine rate. Choose a supported category.';
    END IF;

    IF p_fine_rate IS DISTINCT FROM v_category_rate THEN
      RAISE EXCEPTION
        'The selected fine rate does not match the book category. Expected rate: % PHP per overdue day.',
        v_category_rate;
    END IF;

    IF book_row.fine_rate IS DISTINCT FROM v_category_rate THEN
      RAISE EXCEPTION
        'The book fine rate does not match its category. Please review the book category.';
    END IF;
  END IF;

  RETURN book_row;
END;
$function$;

ALTER FUNCTION public.add_personal_book_with_cover(
  text, text, text, text, text, text, text, integer, text, text, boolean,
  integer, boolean, text, integer
) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.add_personal_book_with_cover(
  text, text, text, text, text, text, text, integer, text, text, boolean,
  integer, boolean, text, integer
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.add_personal_book_with_cover(
  text, text, text, text, text, text, text, integer, text, text, boolean,
  integer, boolean, text, integer
) TO authenticated, service_role;

-- ============================================================
-- 3. Fix update_personal_book (15-arg overload with fine_rate) - remove AAL2
-- ============================================================

DROP FUNCTION IF EXISTS public.update_personal_book(
  text, text, text, text, text, text, text, text, integer, text, text,
  boolean, integer, boolean, integer
);

CREATE OR REPLACE FUNCTION public.update_personal_book(
  p_visitor_id text,
  p_book_id text,
  p_title text,
  p_author text,
  p_category text,
  p_isbn text,
  p_summary text,
  p_condition text,
  p_lending_period_days integer,
  p_handover_method text,
  p_handover_details text,
  p_lending_enabled boolean,
  p_total_copies integer,
  p_is_public boolean,
  p_fine_rate integer
)
RETURNS public.books
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  book_row public.books%ROWTYPE;
  v_category_rate integer;
  v_visitor public.visitors%ROWTYPE;
BEGIN
  -- Require authenticated visitor session (AAL1 - regular auth, not AAL2)
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authenticated visitor account required.';
  END IF;

  -- Verify visitor ownership
  SELECT v.* INTO v_visitor
  FROM public.visitors AS v
  WHERE v.id = pg_catalog.btrim(p_visitor_id)
    AND v.auth_user_id = auth.uid()
    AND v.otp_verified = true
    AND v.is_active = true
  LIMIT 1;

  IF v_visitor.id IS NULL THEN
    RAISE EXCEPTION 'Visitor account could not be verified.';
  END IF;

  -- Call the base function (will be hardened below)
  book_row := public.update_personal_book_base(
    p_visitor_id,
    p_book_id,
    p_title,
    p_author,
    p_category,
    p_isbn,
    p_summary,
    p_condition,
    p_lending_period_days,
    p_handover_method,
    p_handover_details,
    p_lending_enabled,
    p_total_copies,
    p_is_public
  );

  -- Derive the rate from the updated category.
  v_category_rate := public.get_category_fine_rate(book_row.category);

  IF COALESCE(p_lending_enabled, false) THEN
    IF v_category_rate IS NULL THEN
      RAISE EXCEPTION
        'This category does not have an approved fine rate. Choose a supported category.';
    END IF;

    IF p_fine_rate IS DISTINCT FROM v_category_rate THEN
      RAISE EXCEPTION
        'The selected fine rate does not match the book category. Expected rate: % PHP per overdue day.',
        v_category_rate;
    END IF;

    IF book_row.fine_rate IS DISTINCT FROM v_category_rate THEN
      RAISE EXCEPTION
        'The book fine rate does not match its category. Please review the book category.';
    END IF;
  END IF;

  RETURN book_row;
END;
$function$;

ALTER FUNCTION public.update_personal_book(
  text, text, text, text, text, text, text, text, integer, text, text,
  boolean, integer, boolean, integer
) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.update_personal_book(
  text, text, text, text, text, text, text, text, integer, text, text,
  boolean, integer, boolean, integer
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_personal_book(
  text, text, text, text, text, text, text, text, integer, text, text,
  boolean, integer, boolean, integer
) TO authenticated, service_role;

-- ============================================================
-- 4. Fix update_personal_book_with_cover (16-arg overload with fine_rate) - remove AAL2
-- ============================================================

DROP FUNCTION IF EXISTS public.update_personal_book_with_cover(
  text, text, text, text, text, text, text, text, integer, text, text,
  boolean, integer, boolean, text, integer
);

CREATE OR REPLACE FUNCTION public.update_personal_book_with_cover(
  p_visitor_id text,
  p_book_id text,
  p_title text,
  p_author text,
  p_category text,
  p_isbn text,
  p_summary text,
  p_condition text,
  p_lending_period_days integer,
  p_handover_method text,
  p_handover_details text,
  p_lending_enabled boolean,
  p_total_copies integer,
  p_is_public boolean,
  p_cover_url text,
  p_fine_rate integer
)
RETURNS public.books
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  book_row public.books%ROWTYPE;
  v_category_rate integer;
  v_visitor public.visitors%ROWTYPE;
BEGIN
  -- Require authenticated visitor session (AAL1 - regular auth, not AAL2)
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authenticated visitor account required.';
  END IF;

  -- Verify visitor ownership
  SELECT v.* INTO v_visitor
  FROM public.visitors AS v
  WHERE v.id = pg_catalog.btrim(p_visitor_id)
    AND v.auth_user_id = auth.uid()
    AND v.otp_verified = true
    AND v.is_active = true
  LIMIT 1;

  IF v_visitor.id IS NULL THEN
    RAISE EXCEPTION 'Visitor account could not be verified.';
  END IF;

  -- Call the base function (will be hardened below)
  book_row := public.update_personal_book_with_cover_base(
    p_visitor_id,
    p_book_id,
    p_title,
    p_author,
    p_category,
    p_isbn,
    p_summary,
    p_condition,
    p_lending_period_days,
    p_handover_method,
    p_handover_details,
    p_lending_enabled,
    p_total_copies,
    p_is_public,
    p_cover_url
  );

  -- Derive the rate from the updated category.
  v_category_rate := public.get_category_fine_rate(book_row.category);

  IF COALESCE(p_lending_enabled, false) THEN
    IF v_category_rate IS NULL THEN
      RAISE EXCEPTION
        'This category does not have an approved fine rate. Choose a supported category.';
    END IF;

    IF p_fine_rate IS DISTINCT FROM v_category_rate THEN
      RAISE EXCEPTION
        'The selected fine rate does not match the book category. Expected rate: % PHP per overdue day.',
        v_category_rate;
    END IF;

    IF book_row.fine_rate IS DISTINCT FROM v_category_rate THEN
      RAISE EXCEPTION
        'The book fine rate does not match its category. Please review the book category.';
    END IF;
  END IF;

  RETURN book_row;
END;
$function$;

ALTER FUNCTION public.update_personal_book_with_cover(
  text, text, text, text, text, text, text, text, integer, text, text,
  boolean, integer, boolean, text, integer
) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.update_personal_book_with_cover(
  text, text, text, text, text, text, text, text, integer, text, text,
  boolean, integer, boolean, text, integer
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_personal_book_with_cover(
  text, text, text, text, text, text, text, text, integer, text, text,
  boolean, integer, boolean, text, integer
) TO authenticated, service_role;

-- ============================================================
-- 5. Harden base add_personal_book (13-arg) - rename to _base, empty search_path, proper grants
-- ============================================================

-- Rename existing function to _base suffix
ALTER FUNCTION public.add_personal_book(
  text, text, text, text, text, text, text, integer, text, text, boolean,
  integer, boolean
) RENAME TO add_personal_book_base;

-- Update the renamed function
ALTER FUNCTION public.add_personal_book_base(
  text, text, text, text, text, text, text, integer, text, text, boolean,
  integer, boolean
) SET search_path = '';

-- Fix the function body to use schema-qualified references
DROP FUNCTION IF EXISTS public.add_personal_book_base(
  text, text, text, text, text, text, text, integer, text, text, boolean,
  integer, boolean
);

CREATE OR REPLACE FUNCTION public.add_personal_book_base(
  p_visitor_id text,
  p_title text,
  p_author text,
  p_category text,
  p_isbn text,
  p_summary text,
  p_condition text,
  p_lending_period_days integer,
  p_handover_method text,
  p_handover_details text,
  p_lending_enabled boolean,
  p_total_copies integer,
  p_is_public boolean
)
RETURNS public.books
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  book_row public.books%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (
    SELECT 1
    FROM public.visitors AS visitor
    WHERE visitor.id = pg_catalog.trim(p_visitor_id)
      AND visitor.auth_user_id = auth.uid()
      AND visitor.otp_verified
      AND visitor.is_active
  ) THEN
    RAISE EXCEPTION 'The authenticated, verified visitor account could not be found.';
  END IF;

  IF pg_catalog.nullif(pg_catalog.trim(p_title), '') IS NULL
     OR pg_catalog.nullif(pg_catalog.trim(p_author), '') IS NULL THEN
    RAISE EXCEPTION 'Book title and author are required.';
  END IF;

  IF p_total_copies IS NULL OR p_total_copies < 1 THEN
    RAISE EXCEPTION 'Copy count must be a whole number of at least 1.';
  END IF;

  INSERT INTO public.books (
    title,
    author,
    category,
    isbn,
    summary,
    book_type,
    owner_visitor_id,
    is_public,
    lending_enabled,
    condition,
    lending_period_days,
    handover_method,
    handover_details,
    total_copies,
    available_copies
  )
  VALUES (
    pg_catalog.trim(p_title),
    pg_catalog.trim(p_author),
    pg_catalog.nullif(pg_catalog.trim(p_category), ''),
    pg_catalog.nullif(pg_catalog.trim(p_isbn), ''),
    pg_catalog.nullif(pg_catalog.trim(p_summary), ''),
    'personal',
    pg_catalog.trim(p_visitor_id),
    pg_catalog.coalesce(p_is_public, false),
    pg_catalog.coalesce(p_lending_enabled, false),
    pg_catalog.nullif(pg_catalog.trim(p_condition), ''),
    p_lending_period_days,
    pg_catalog.nullif(pg_catalog.trim(p_handover_method), ''),
    pg_catalog.nullif(pg_catalog.trim(p_handover_details), ''),
    p_total_copies,
    p_total_copies
  )
  RETURNING * INTO book_row;

  RETURN book_row;
END;
$function$;

ALTER FUNCTION public.add_personal_book_base(
  text, text, text, text, text, text, text, integer, text, text, boolean,
  integer, boolean
) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.add_personal_book_base(
  text, text, text, text, text, text, text, integer, text, text, boolean,
  integer, boolean
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.add_personal_book_base(
  text, text, text, text, text, text, text, integer, text, text, boolean,
  integer, boolean
) TO authenticated, service_role;

-- ============================================================
-- 6. Harden base add_personal_book_with_cover (14-arg) - rename to _base
-- ============================================================

ALTER FUNCTION public.add_personal_book_with_cover(
  text, text, text, text, text, text, text, integer, text, text, boolean,
  integer, boolean, text
) RENAME TO add_personal_book_with_cover_base;

DROP FUNCTION IF EXISTS public.add_personal_book_with_cover_base(
  text, text, text, text, text, text, text, integer, text, text, boolean,
  integer, boolean, text
);

CREATE OR REPLACE FUNCTION public.add_personal_book_with_cover_base(
  p_visitor_id text,
  p_title text,
  p_author text,
  p_category text,
  p_isbn text,
  p_summary text,
  p_condition text,
  p_lending_period_days integer,
  p_handover_method text,
  p_handover_details text,
  p_lending_enabled boolean,
  p_total_copies integer,
  p_is_public boolean,
  p_cover_url text
)
RETURNS public.books
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  book_row public.books%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (
    SELECT 1
    FROM public.visitors AS visitor
    WHERE visitor.id::text = pg_catalog.trim(p_visitor_id)
      AND visitor.auth_user_id = auth.uid()
      AND visitor.otp_verified
      AND visitor.is_active
  ) THEN
    RAISE EXCEPTION 'The authenticated, verified visitor account could not be found.';
  END IF;

  book_row := public.add_personal_book_base(
    p_visitor_id,
    p_title,
    p_author,
    p_category,
    p_isbn,
    p_summary,
    p_condition,
    p_lending_period_days,
    p_handover_method,
    p_handover_details,
    p_lending_enabled,
    p_total_copies,
    p_is_public
  );

  UPDATE public.books
  SET cover_url = pg_catalog.nullif(pg_catalog.trim(p_cover_url), '')
  WHERE id = book_row.id
    AND book_type = 'personal'
    AND owner_visitor_id::text = pg_catalog.trim(p_visitor_id)
  RETURNING * INTO book_row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'The personal book cover could not be saved.';
  END IF;

  RETURN book_row;
END;
$function$;

ALTER FUNCTION public.add_personal_book_with_cover_base(
  text, text, text, text, text, text, text, integer, text, text, boolean,
  integer, boolean, text
) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.add_personal_book_with_cover_base(
  text, text, text, text, text, text, text, integer, text, text, boolean,
  integer, boolean, text
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.add_personal_book_with_cover_base(
  text, text, text, text, text, text, text, integer, text, text, boolean,
  integer, boolean, text
) TO authenticated, service_role;

-- ============================================================
-- 7. Harden base update_personal_book (14-arg) - rename to _base
-- ============================================================

ALTER FUNCTION public.update_personal_book(
  text, text, text, text, text, text, text, text, integer, text, text,
  boolean, integer, boolean
) RENAME TO update_personal_book_base;

DROP FUNCTION IF EXISTS public.update_personal_book_base(
  text, text, text, text, text, text, text, text, integer, text, text,
  boolean, integer, boolean
);

CREATE OR REPLACE FUNCTION public.update_personal_book_base(
  p_visitor_id text,
  p_book_id text,
  p_title text,
  p_author text,
  p_category text,
  p_isbn text,
  p_summary text,
  p_condition text,
  p_lending_period_days integer,
  p_handover_method text,
  p_handover_details text,
  p_lending_enabled boolean,
  p_total_copies integer,
  p_is_public boolean
)
RETURNS public.books
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  book_row public.books%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (
    SELECT 1
    FROM public.visitors AS visitor
    WHERE visitor.id = pg_catalog.trim(p_visitor_id)
      AND visitor.auth_user_id = auth.uid()
      AND visitor.otp_verified
      AND visitor.is_active
  ) THEN
    RAISE EXCEPTION 'The authenticated, verified visitor account could not be found.';
  END IF;

  IF pg_catalog.nullif(pg_catalog.trim(p_title), '') IS NULL
     OR pg_catalog.nullif(pg_catalog.trim(p_author), '') IS NULL THEN
    RAISE EXCEPTION 'Book title and author are required.';
  END IF;

  IF p_total_copies IS NULL OR p_total_copies < 1 THEN
    RAISE EXCEPTION 'Copy count must be a whole number of at least 1.';
  END IF;

  IF p_lending_period_days IS NULL
     OR p_lending_period_days < 1
     OR p_lending_period_days > 30 THEN
    RAISE EXCEPTION 'Lending period must be between 1 and 30 days.';
  END IF;

  IF p_condition IS NULL
     OR p_condition NOT IN ('New', 'Like New', 'Good', 'Fair', 'Poor') THEN
    RAISE EXCEPTION 'Invalid book condition.';
  END IF;

  IF p_handover_method IS NULL
     OR p_handover_method NOT IN (
     'meet_in_person',
     'public_place',
     'courier',
     'arrange_with_owner'
   ) THEN
    RAISE EXCEPTION 'Invalid handover method.';
  END IF;

  IF pg_catalog.length(pg_catalog.coalesce(p_handover_details, '')) > 500 THEN
    RAISE EXCEPTION 'Handover details must not exceed 500 characters.';
  END IF;

  SELECT book.* INTO book_row
  FROM public.books AS book
  WHERE book.id::text = pg_catalog.trim(p_book_id)
    AND book.book_type = 'personal'
    AND book.owner_visitor_id = pg_catalog.trim(p_visitor_id)
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'This personal book could not be found.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.community_book_requests AS request
    WHERE request.book_id = book_row.id::text
      AND request.status IN ('pending', 'approved', 'borrowed')
  ) OR book_row.available_copies < book_row.total_copies THEN
    RAISE EXCEPTION 'This book cannot be edited while a community request or loan is active.';
  END IF;

  UPDATE public.books
  SET title = pg_catalog.trim(p_title),
      author = pg_catalog.trim(p_author),
      category = pg_catalog.nullif(pg_catalog.trim(p_category), ''),
      isbn = pg_catalog.nullif(pg_catalog.trim(p_isbn), ''),
      summary = pg_catalog.nullif(pg_catalog.trim(p_summary), ''),
      condition = pg_catalog.nullif(pg_catalog.trim(p_condition), ''),
      lending_period_days = p_lending_period_days,
      handover_method = pg_catalog.nullif(pg_catalog.trim(p_handover_method), ''),
      handover_details = pg_catalog.nullif(pg_catalog.trim(p_handover_details), ''),
      lending_enabled = pg_catalog.coalesce(p_lending_enabled, false),
      is_public = pg_catalog.coalesce(p_is_public, false),
      total_copies = p_total_copies,
      available_copies = p_total_copies
  WHERE id = book_row.id
  RETURNING * INTO book_row;

  RETURN book_row;
END;
$function$;

ALTER FUNCTION public.update_personal_book_base(
  text, text, text, text, text, text, text, text, integer, text, text,
  boolean, integer, boolean
) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.update_personal_book_base(
  text, text, text, text, text, text, text, text, integer, text, text,
  boolean, integer, boolean
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_personal_book_base(
  text, text, text, text, text, text, text, text, integer, text, text,
  boolean, integer, boolean
) TO authenticated, service_role;

-- ============================================================
-- 8. Harden base update_personal_book_with_cover (15-arg) - rename to _base
-- ============================================================

ALTER FUNCTION public.update_personal_book_with_cover(
  text, text, text, text, text, text, text, text, integer, text, text,
  boolean, integer, boolean, text
) RENAME TO update_personal_book_with_cover_base;

DROP FUNCTION IF EXISTS public.update_personal_book_with_cover_base(
  text, text, text, text, text, text, text, text, integer, text, text,
  boolean, integer, boolean, text
);

CREATE OR REPLACE FUNCTION public.update_personal_book_with_cover_base(
  p_visitor_id text,
  p_book_id text,
  p_title text,
  p_author text,
  p_category text,
  p_isbn text,
  p_summary text,
  p_condition text,
  p_lending_period_days integer,
  p_handover_method text,
  p_handover_details text,
  p_lending_enabled boolean,
  p_total_copies integer,
  p_is_public boolean,
  p_cover_url text
)
RETURNS public.books
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  book_row public.books%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (
    SELECT 1
    FROM public.visitors AS visitor
    WHERE visitor.id = pg_catalog.trim(p_visitor_id)
      AND visitor.auth_user_id = auth.uid()
      AND visitor.otp_verified
      AND visitor.is_active
  ) THEN
    RAISE EXCEPTION 'The authenticated, verified visitor account could not be found.';
  END IF;

  book_row := public.update_personal_book_base(
    p_visitor_id,
    p_book_id,
    p_title,
    p_author,
    p_category,
    p_isbn,
    p_summary,
    p_condition,
    p_lending_period_days,
    p_handover_method,
    p_handover_details,
    p_lending_enabled,
    p_total_copies,
    p_is_public
  );

  UPDATE public.books
  SET cover_url = pg_catalog.nullif(pg_catalog.trim(p_cover_url), '')
  WHERE id = book_row.id
    AND book_type = 'personal'
    AND owner_visitor_id::text = pg_catalog.trim(p_visitor_id)
  RETURNING * INTO book_row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'The personal book cover could not be saved.';
  END IF;

  RETURN book_row;
END;
$function$;

ALTER FUNCTION public.update_personal_book_with_cover_base(
  text, text, text, text, text, text, text, text, integer, text, text,
  boolean, integer, boolean, text
) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.update_personal_book_with_cover_base(
  text, text, text, text, text, text, text, text, integer, text, text,
  boolean, integer, boolean, text
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_personal_book_with_cover_base(
  text, text, text, text, text, text, text, text, integer, text, text,
  boolean, integer, boolean, text
) TO authenticated, service_role;

-- ============================================================
-- 9. Harden delete_personal_book - empty search_path, schema qualification, proper grants
-- ============================================================

DROP FUNCTION IF EXISTS public.delete_personal_book(text, text);

CREATE OR REPLACE FUNCTION public.delete_personal_book(
  p_visitor_id text,
  p_book_id text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  book_row public.books%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (
    SELECT 1
    FROM public.visitors AS visitor
    WHERE visitor.id = pg_catalog.trim(p_visitor_id)
      AND visitor.auth_user_id = auth.uid()
      AND visitor.otp_verified
      AND visitor.is_active
  ) THEN
    RAISE EXCEPTION 'The authenticated, verified visitor account could not be found.';
  END IF;

  SELECT book.* INTO book_row
  FROM public.books AS book
  WHERE book.id::text = pg_catalog.trim(p_book_id)
    AND book.book_type = 'personal'
    AND book.owner_visitor_id = pg_catalog.trim(p_visitor_id)
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'This personal book could not be found.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.community_book_requests AS request
    WHERE request.book_id = book_row.id::text
  ) THEN
    RAISE EXCEPTION 'This book has community request history and cannot be removed. You can make it private and disable lending instead.';
  END IF;

  IF book_row.available_copies < book_row.total_copies THEN
    RAISE EXCEPTION 'This book cannot be removed while copies are on loan.';
  END IF;

  DELETE FROM public.books
  WHERE id = book_row.id
    AND book_type = 'personal'
    AND owner_visitor_id = pg_catalog.trim(p_visitor_id);

  RETURN true;
END;
$function$;

ALTER FUNCTION public.delete_personal_book(text, text) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.delete_personal_book(text, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_personal_book(text, text)
  TO authenticated, service_role;

-- ============================================================
-- 10. Fix get_visitor_borrow_requests - remove AAL2 (visitor read operation)
-- ============================================================

DROP FUNCTION IF EXISTS public.get_visitor_borrow_requests(uuid);

CREATE FUNCTION public.get_visitor_borrow_requests (
  p_visitor_id uuid
)
RETURNS TABLE (
  id uuid,
  book_id text,
  book_title text,
  visitor_id text,
  visitor_name text,
  status text,
  request_date timestamp with time zone,
  pickup_deadline timestamp with time zone,
  queue_position integer,
  borrow_date timestamp with time zone,
  due_date timestamp with time zone,
  return_date timestamp with time zone,
  fine_amount numeric,
  confirmed_by text,
  return_confirmed_by text,
  fine_rate_snapshot integer,
  fine_review_required boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF auth.uid() IS NULL OR auth.uid() IS DISTINCT FROM p_visitor_id THEN
    RAISE EXCEPTION 'The authenticated visitor account could not be verified.';
  END IF;
  -- AAL1 is sufficient for visitor read operations (consistent with request_borrow_v2)

  RETURN QUERY
  SELECT *
  FROM shelf_private.get_visitor_borrow_requests_unchecked(p_visitor_id);
END;
$function$;

ALTER FUNCTION public.get_visitor_borrow_requests(uuid) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.get_visitor_borrow_requests(uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_visitor_borrow_requests(uuid)
  TO authenticated, service_role;

-- ============================================================
-- 11. Fix fetch_my_community_book_requests - remove AAL2 (visitor read operation)
-- ============================================================

DROP FUNCTION IF EXISTS public.fetch_my_community_book_requests(text);

CREATE FUNCTION public.fetch_my_community_book_requests (
  p_requester_visitor_id text
)
RETURNS TABLE (
  id uuid,
  book_id text,
  book_title text,
  owner_visitor_id text,
  owner_name text,
  requester_visitor_id text,
  requester_name text,
  status text,
  request_date timestamp with time zone,
  approved_at timestamp with time zone,
  rejected_at timestamp with time zone,
  owner_response text,
  pickup_deadline timestamp with time zone,
  borrow_date timestamp with time zone,
  due_date timestamp with time zone,
  return_date timestamp with time zone,
  fine_amount numeric,
  confirmed_by text,
  return_confirmed_by text,
  queue_position integer,
  owner_contact_email text,
  owner_contact_number text,
  owner_contact_details text,
  fine_rate_snapshot integer,
  fine_review_required boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (
    SELECT 1
    FROM public.visitors AS visitor
    WHERE visitor.id = pg_catalog.trim(p_requester_visitor_id)
      AND visitor.auth_user_id = auth.uid()
      AND visitor.otp_verified
      AND visitor.is_active
  ) THEN
    RAISE EXCEPTION
      'The authenticated, verified visitor account could not be found.';
  END IF;
  -- AAL1 is sufficient for visitor read operations (consistent with request_borrow_v2)

  RETURN QUERY
  SELECT
    request.id,
    request.book_id::text,
    request.book_title::text,
    request.owner_visitor_id::text,
    request.owner_name::text,
    request.requester_visitor_id::text,
    request.requester_name::text,
    request.status::text,
    request.request_date,
    request.approved_at,
    request.rejected_at,
    request.owner_response::text,
    request.pickup_deadline,
    request.borrow_date,
    request.due_date,
    request.return_date,
    request.fine_amount::numeric,
    request.confirmed_by::text,
    request.return_confirmed_by::text,
    CASE
      WHEN request.status = 'pending' THEN (
        SELECT count(*)::integer
        FROM public.community_book_requests AS earlier
        WHERE earlier.book_id = request.book_id
          AND earlier.status = 'pending'
          AND (earlier.request_date, earlier.id)
            <= (request.request_date, request.id)
      )
      ELSE NULL::integer
    END,
    CASE
      WHEN request.status IN ('approved', 'borrowed')
        THEN owner.email::text
      ELSE NULL::text
    END,
    CASE
      WHEN request.status IN ('approved', 'borrowed')
        THEN owner.contact_number::text
      ELSE NULL::text
    END,
    CASE
      WHEN request.status IN ('approved', 'borrowed')
        THEN book.handover_details::text
      ELSE NULL::text
    END,
    request.fine_rate_snapshot,
    (
      COALESCE(request.fine_review_required, false)
      OR (
        COALESCE(request.fine_amount, 0) <> 0
        AND (
          request.status <> 'returned'
          OR request.fine_rate_snapshot IS NULL
          OR request.fine_rate_snapshot NOT IN (10, 15, 20)
        )
      )
      OR (
        request.status IN ('borrowed', 'returned')
        AND (
          request.fine_rate_snapshot IS NULL
          OR request.fine_rate_snapshot NOT IN (10, 15, 20)
        )
      )
    ) AS fine_review_required
  FROM public.community_book_requests AS request
  LEFT JOIN public.visitors AS owner
    ON owner.id = request.owner_visitor_id
  LEFT JOIN public.books AS book
    ON book.id = request.book_id
  WHERE request.requester_visitor_id = pg_catalog.trim(p_requester_visitor_id)
  ORDER BY request.request_date DESC;
END;
$function$;

ALTER FUNCTION public.fetch_my_community_book_requests(text) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.fetch_my_community_book_requests(text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fetch_my_community_book_requests(text)
  TO authenticated, service_role;

-- ============================================================
-- Postflight validation
-- ============================================================
DO $postflight$
DECLARE
  v_signature regprocedure;
  v_acl_count integer;
BEGIN
  -- Validate add_personal_book (14 args with fine_rate)
  v_signature := 'public.add_personal_book(text,text,text,text,text,text,text,integer,text,text,boolean,integer,boolean,integer)'::regprocedure;
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS procedure
    JOIN pg_catalog.pg_language AS language ON language.oid = procedure.prolang
    WHERE procedure.oid = v_signature
      AND procedure.proowner = 'postgres'::regrole
      AND language.lanname = 'plpgsql'
      AND procedure.prorettype = 'public.books'::regtype
      AND procedure.pronargs = 14
      AND procedure.prosecdef
      AND procedure.proconfig = ARRAY['search_path=""']::text[]
  ) THEN
    RAISE EXCEPTION 'add_personal_book(14 args) metadata differs from the reviewed contract.';
  END IF;

  SELECT pg_catalog.count(*) INTO v_acl_count
  FROM pg_catalog.pg_proc AS procedure
  CROSS JOIN LATERAL pg_catalog.aclexplode(procedure.proacl) AS acl
  WHERE procedure.oid = v_signature;

  IF v_acl_count <> 2
     OR NOT pg_catalog.has_function_privilege('authenticated', v_signature, 'EXECUTE')
     OR NOT pg_catalog.has_function_privilege('service_role', v_signature, 'EXECUTE')
     OR pg_catalog.has_function_privilege('anon', v_signature, 'EXECUTE') THEN
    RAISE EXCEPTION 'add_personal_book(14 args) EXECUTE privileges differ from the least-privilege contract.';
  END IF;

  -- Validate add_personal_book_base (13 args)
  v_signature := 'public.add_personal_book_base(text,text,text,text,text,text,text,integer,text,text,boolean,integer,boolean)'::regprocedure;
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS procedure
    JOIN pg_catalog.pg_language AS language ON language.oid = procedure.prolang
    WHERE procedure.oid = v_signature
      AND procedure.proowner = 'postgres'::regrole
      AND language.lanname = 'plpgsql'
      AND procedure.prorettype = 'public.books'::regtype
      AND procedure.pronargs = 13
      AND procedure.prosecdef
      AND procedure.proconfig = ARRAY['search_path=""']::text[]
  ) THEN
    RAISE EXCEPTION 'add_personal_book_base(13 args) metadata differs from the reviewed contract.';
  END IF;

  -- Validate add_personal_book_with_cover (15 args with fine_rate)
  v_signature := 'public.add_personal_book_with_cover(text,text,text,text,text,text,text,integer,text,text,boolean,integer,boolean,text,integer)'::regprocedure;
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS procedure
    JOIN pg_catalog.pg_language AS language ON language.oid = procedure.prolang
    WHERE procedure.oid = v_signature
      AND procedure.proowner = 'postgres'::regrole
      AND language.lanname = 'plpgsql'
      AND procedure.prorettype = 'public.books'::regtype
      AND procedure.pronargs = 15
      AND procedure.prosecdef
      AND procedure.proconfig = ARRAY['search_path=""']::text[]
  ) THEN
    RAISE EXCEPTION 'add_personal_book_with_cover(15 args) metadata differs from the reviewed contract.';
  END IF;

  -- Validate add_personal_book_with_cover_base (14 args)
  v_signature := 'public.add_personal_book_with_cover_base(text,text,text,text,text,text,text,integer,text,text,boolean,integer,boolean,text)'::regprocedure;
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS procedure
    JOIN pg_catalog.pg_language AS language ON language.oid = procedure.prolang
    WHERE procedure.oid = v_signature
      AND procedure.proowner = 'postgres'::regrole
      AND language.lanname = 'plpgsql'
      AND procedure.prorettype = 'public.books'::regtype
      AND procedure.pronargs = 14
      AND procedure.prosecdef
      AND procedure.proconfig = ARRAY['search_path=""']::text[]
  ) THEN
    RAISE EXCEPTION 'add_personal_book_with_cover_base(14 args) metadata differs from the reviewed contract.';
  END IF;

  -- Validate update_personal_book (15 args with fine_rate)
  v_signature := 'public.update_personal_book(text,text,text,text,text,text,text,text,integer,text,text,boolean,integer,boolean,integer)'::regprocedure;
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS procedure
    JOIN pg_catalog.pg_language AS language ON language.oid = procedure.prolang
    WHERE procedure.oid = v_signature
      AND procedure.proowner = 'postgres'::regrole
      AND language.lanname = 'plpgsql'
      AND procedure.prorettype = 'public.books'::regtype
      AND procedure.pronargs = 15
      AND procedure.prosecdef
      AND procedure.proconfig = ARRAY['search_path=""']::text[]
  ) THEN
    RAISE EXCEPTION 'update_personal_book(15 args) metadata differs from the reviewed contract.';
  END IF;

  -- Validate update_personal_book_base (14 args)
  v_signature := 'public.update_personal_book_base(text,text,text,text,text,text,text,text,integer,text,text,boolean,integer,boolean)'::regprocedure;
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS procedure
    JOIN pg_catalog.pg_language AS language ON language.oid = procedure.prolang
    WHERE procedure.oid = v_signature
      AND procedure.proowner = 'postgres'::regrole
      AND language.lanname = 'plpgsql'
      AND procedure.prorettype = 'public.books'::regtype
      AND procedure.pronargs = 14
      AND procedure.prosecdef
      AND procedure.proconfig = ARRAY['search_path=""']::text[]
  ) THEN
    RAISE EXCEPTION 'update_personal_book_base(14 args) metadata differs from the reviewed contract.';
  END IF;

  -- Validate update_personal_book_with_cover (16 args with fine_rate)
  v_signature := 'public.update_personal_book_with_cover(text,text,text,text,text,text,text,text,integer,text,text,boolean,integer,boolean,text,integer)'::regprocedure;
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS procedure
    JOIN pg_catalog.pg_language AS language ON language.oid = procedure.prolang
    WHERE procedure.oid = v_signature
      AND procedure.proowner = 'postgres'::regrole
      AND language.lanname = 'plpgsql'
      AND procedure.prorettype = 'public.books'::regtype
      AND procedure.pronargs = 16
      AND procedure.prosecdef
      AND procedure.proconfig = ARRAY['search_path=""']::text[]
  ) THEN
    RAISE EXCEPTION 'update_personal_book_with_cover(16 args) metadata differs from the reviewed contract.';
  END IF;

  -- Validate update_personal_book_with_cover_base (15 args)
  v_signature := 'public.update_personal_book_with_cover_base(text,text,text,text,text,text,text,text,integer,text,text,boolean,integer,boolean,text)'::regprocedure;
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS procedure
    JOIN pg_catalog.pg_language AS language ON language.oid = procedure.prolang
    WHERE procedure.oid = v_signature
      AND procedure.proowner = 'postgres'::regrole
      AND language.lanname = 'plpgsql'
      AND procedure.prorettype = 'public.books'::regtype
      AND procedure.pronargs = 15
      AND procedure.prosecdef
      AND procedure.proconfig = ARRAY['search_path=""']::text[]
  ) THEN
    RAISE EXCEPTION 'update_personal_book_with_cover_base(15 args) metadata differs from the reviewed contract.';
  END IF;

  -- Validate delete_personal_book
  v_signature := 'public.delete_personal_book(text,text)'::regprocedure;
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS procedure
    JOIN pg_catalog.pg_language AS language ON language.oid = procedure.prolang
    WHERE procedure.oid = v_signature
      AND procedure.proowner = 'postgres'::regrole
      AND language.lanname = 'plpgsql'
      AND procedure.prorettype = 'boolean'::regtype
      AND procedure.pronargs = 2
      AND procedure.prosecdef
      AND procedure.proconfig = ARRAY['search_path=""']::text[]
  ) THEN
    RAISE EXCEPTION 'delete_personal_book metadata differs from the reviewed contract.';
  END IF;

  SELECT pg_catalog.count(*) INTO v_acl_count
  FROM pg_catalog.pg_proc AS procedure
  CROSS JOIN LATERAL pg_catalog.aclexplode(procedure.proacl) AS acl
  WHERE procedure.oid = v_signature;

  IF v_acl_count <> 2
     OR NOT pg_catalog.has_function_privilege('authenticated', v_signature, 'EXECUTE')
     OR NOT pg_catalog.has_function_privilege('service_role', v_signature, 'EXECUTE')
     OR pg_catalog.has_function_privilege('anon', v_signature, 'EXECUTE') THEN
    RAISE EXCEPTION 'delete_personal_book EXECUTE privileges differ from the least-privilege contract.';
  END IF;

  -- Validate get_visitor_borrow_requests
  v_signature := 'public.get_visitor_borrow_requests(uuid)'::regprocedure;
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS procedure
    JOIN pg_catalog.pg_language AS language ON language.oid = procedure.prolang
    WHERE procedure.oid = v_signature
      AND procedure.proowner = 'postgres'::regrole
      AND language.lanname = 'plpgsql'
      AND procedure.pronargs = 1
      AND procedure.prosecdef
      AND procedure.proconfig = ARRAY['search_path=""']::text[]
  ) THEN
    RAISE EXCEPTION 'get_visitor_borrow_requests metadata differs from the reviewed contract.';
  END IF;

  SELECT pg_catalog.count(*) INTO v_acl_count
  FROM pg_catalog.pg_proc AS procedure
  CROSS JOIN LATERAL pg_catalog.aclexplode(procedure.proacl) AS acl
  WHERE procedure.oid = v_signature;

  IF v_acl_count <> 2
     OR NOT pg_catalog.has_function_privilege('authenticated', v_signature, 'EXECUTE')
     OR NOT pg_catalog.has_function_privilege('service_role', v_signature, 'EXECUTE')
     OR pg_catalog.has_function_privilege('anon', v_signature, 'EXECUTE') THEN
    RAISE EXCEPTION 'get_visitor_borrow_requests EXECUTE privileges differ from the least-privilege contract.';
  END IF;

  -- Validate fetch_my_community_book_requests
  v_signature := 'public.fetch_my_community_book_requests(text)'::regprocedure;
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS procedure
    JOIN pg_catalog.pg_language AS language ON language.oid = procedure.prolang
    WHERE procedure.oid = v_signature
      AND procedure.proowner = 'postgres'::regrole
      AND language.lanname = 'plpgsql'
      AND procedure.pronargs = 1
      AND procedure.prosecdef
      AND procedure.proconfig = ARRAY['search_path=""']::text[]
  ) THEN
    RAISE EXCEPTION 'fetch_my_community_book_requests metadata differs from the reviewed contract.';
  END IF;

  SELECT pg_catalog.count(*) INTO v_acl_count
  FROM pg_catalog.pg_proc AS procedure
  CROSS JOIN LATERAL pg_catalog.aclexplode(procedure.proacl) AS acl
  WHERE procedure.oid = v_signature;

  IF v_acl_count <> 2
     OR NOT pg_catalog.has_function_privilege('authenticated', v_signature, 'EXECUTE')
     OR NOT pg_catalog.has_function_privilege('service_role', v_signature, 'EXECUTE')
     OR pg_catalog.has_function_privilege('anon', v_signature, 'EXECUTE') THEN
    RAISE EXCEPTION 'fetch_my_community_book_requests EXECUTE privileges differ from the least-privilege contract.';
  END IF;
END;
$postflight$;

NOTIFY pgrst, 'reload schema';
COMMIT;