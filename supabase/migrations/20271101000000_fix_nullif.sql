-- Fix nullif usage by casting empty string to text
DROP FUNCTION IF EXISTS public.add_personal_book_with_cover(text, text, text, text, text, text, text, integer, text, text, boolean, integer, boolean, text);
DROP FUNCTION IF EXISTS public.add_personal_book(text, text, text, text, text, text, text, integer, text, text, boolean, integer, boolean);

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
  p_is_public boolean
) RETURNS public.books
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  book_row public.books%rowtype;
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.visitors visitor
    WHERE visitor.id = trim(p_visitor_id)
      AND visitor.auth_user_id = auth.uid()
      AND visitor.otp_verified
      AND visitor.is_active
  ) THEN
    RAISE EXCEPTION 'The authenticated, verified visitor account could not be found.';
  END IF;

  IF nullif(trim(p_title), ''::text) IS NULL
    OR nullif(trim(p_author), ''::text) IS NULL THEN
    RAISE EXCEPTION 'Book title and author are required.';
  END IF;

  IF p_total_copies IS NULL OR p_total_copies < 1 THEN
    RAISE EXCEPTION 'Copy count must be a whole number of at least 1.';
  END IF;

  INSERT INTO public.books (
    title, author, category, isbn, summary, book_type, owner_visitor_id,
    is_public, lending_enabled, "condition", lending_period_days,
    handover_method, handover_details, total_copies, available_copies
  ) VALUES (
    trim(p_title), trim(p_author), nullif(trim(p_category), ''::text),
    nullif(trim(p_isbn), ''::text), nullif(trim(p_summary), ''::text),
    'personal', trim(p_visitor_id), coalesce(p_is_public, false),
    coalesce(p_lending_enabled, false), nullif(trim(p_condition), ''::text),
    p_lending_period_days, nullif(trim(p_handover_method), ''::text),
    nullif(trim(p_handover_details), ''::text), p_total_copies, p_total_copies
  ) RETURNING * INTO book_row;

  RETURN book_row;
END;
$$;

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
  p_cover_url text
) RETURNS public.books
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  book_row public.books%rowtype;
BEGIN
  -- Reuse core insertion
  book_row := public.add_personal_book(
    p_visitor_id, p_title, p_author, p_category, p_isbn, p_summary,
    p_condition, p_lending_period_days, p_handover_method, p_handover_details,
    p_lending_enabled, p_total_copies, p_is_public
  );

  UPDATE public.books
  SET cover_url = nullif(trim(p_cover_url), ''::text)
  WHERE id = book_row.id
    AND book_type = 'personal'
    AND owner_visitor_id::text = trim(p_visitor_id)
  RETURNING * INTO book_row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'The personal book cover could not be saved.';
  END IF;

  RETURN book_row;
END;
$$;

-- Reapply privileges
REVOKE ALL ON FUNCTION public.add_personal_book(text, text, text, text, text, text, text, integer, text, text, boolean, integer, boolean) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.add_personal_book(text, text, text, text, text, text, text, integer, text, text, boolean, integer, boolean) TO authenticated;

REVOKE ALL ON FUNCTION public.add_personal_book_with_cover(text, text, text, text, text, text, text, integer, text, text, boolean, integer, boolean, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.add_personal_book_with_cover(text, text, text, text, text, text, text, integer, text, text, boolean, integer, boolean, text) TO authenticated;

SELECT pg_notify('pgrst', 'reload schema');
