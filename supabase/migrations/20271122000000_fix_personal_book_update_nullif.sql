-- NULLIF is PostgreSQL syntax, not a callable pg_catalog function. A prior
-- hardening migration incorrectly schema-qualified it in the update RPC.
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
    SELECT 1 FROM public.visitors AS visitor
    WHERE visitor.id = pg_catalog.btrim(p_visitor_id)
      AND visitor.auth_user_id = auth.uid()
      AND visitor.otp_verified
      AND visitor.is_active
  ) THEN
    RAISE EXCEPTION 'The authenticated, verified visitor account could not be found.';
  END IF;

  IF nullif(pg_catalog.btrim(p_title), '') IS NULL
     OR nullif(pg_catalog.btrim(p_author), '') IS NULL THEN
    RAISE EXCEPTION 'Book title and author are required.';
  END IF;
  IF p_total_copies IS NULL OR p_total_copies < 1 THEN
    RAISE EXCEPTION 'Copy count must be a whole number of at least 1.';
  END IF;
  IF p_lending_period_days IS NULL OR p_lending_period_days < 1 OR p_lending_period_days > 30 THEN
    RAISE EXCEPTION 'Lending period must be between 1 and 30 days.';
  END IF;
  IF p_condition IS NULL OR p_condition NOT IN ('New', 'Like New', 'Good', 'Fair', 'Poor') THEN
    RAISE EXCEPTION 'Invalid book condition.';
  END IF;
  IF p_handover_method IS NULL OR p_handover_method NOT IN (
    'meet_in_person', 'public_place', 'courier', 'arrange_with_owner'
  ) THEN
    RAISE EXCEPTION 'Invalid handover method.';
  END IF;
  IF pg_catalog.length(pg_catalog.coalesce(p_handover_details, '')) > 500 THEN
    RAISE EXCEPTION 'Handover details must not exceed 500 characters.';
  END IF;

  SELECT book.* INTO book_row
  FROM public.books AS book
  WHERE book.id::text = pg_catalog.btrim(p_book_id)
    AND book.book_type = 'personal'
    AND book.owner_visitor_id = pg_catalog.btrim(p_visitor_id)
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'This personal book could not be found.'; END IF;

  IF EXISTS (
    SELECT 1 FROM public.community_book_requests AS request
    WHERE request.book_id = book_row.id::text
      AND request.status IN ('pending', 'approved', 'borrowed')
  ) OR book_row.available_copies < book_row.total_copies THEN
    RAISE EXCEPTION 'This book cannot be edited while a community request or loan is active.';
  END IF;

  UPDATE public.books
  SET title = pg_catalog.btrim(p_title),
      author = pg_catalog.btrim(p_author),
      category = nullif(pg_catalog.btrim(p_category), ''),
      isbn = nullif(pg_catalog.btrim(p_isbn), ''),
      summary = nullif(pg_catalog.btrim(p_summary), ''),
      condition = nullif(pg_catalog.btrim(p_condition), ''),
      lending_period_days = p_lending_period_days,
      handover_method = nullif(pg_catalog.btrim(p_handover_method), ''),
      handover_details = nullif(pg_catalog.btrim(p_handover_details), ''),
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
  text, text, text, text, text, text, text, text, integer, text, text, boolean, integer, boolean
) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.update_personal_book_base(
  text, text, text, text, text, text, text, text, integer, text, text, boolean, integer, boolean
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_personal_book_base(
  text, text, text, text, text, text, text, text, integer, text, text, boolean, integer, boolean
) TO authenticated;

SELECT pg_notify('pgrst', 'reload schema');
