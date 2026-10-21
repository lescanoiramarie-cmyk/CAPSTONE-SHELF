CREATE OR REPLACE FUNCTION public.set_personal_book_visibility (
  p_visitor_id text,
  p_book_id    text,
  p_is_public  boolean
)
  RETURNS boolean
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
DECLARE
  v_book public.books%ROWTYPE;
  v_visitor_id text;
BEGIN
  -- ------------------------------------------------------------
  -- Validate inputs
  -- ------------------------------------------------------------
  IF NULLIF(trim(p_visitor_id), '') IS NULL THEN
    RAISE EXCEPTION 'Visitor ID is required.';
  END IF;

  IF NULLIF(trim(p_book_id), '') IS NULL THEN
    RAISE EXCEPTION 'Book ID is required.';
  END IF;

  -- ------------------------------------------------------------
  -- Resolve the visitor ID.
  --
  -- The frontend may provide:
  --   1. visitors.id
  --   2. visitors.auth_user_id
  --
  -- Keep the actual stored owner_visitor_id format unchanged.
  -- ------------------------------------------------------------
  SELECT v.id::text
  INTO v_visitor_id
  FROM public.visitors v
  WHERE v.id::text = trim(p_visitor_id)
     OR v.auth_user_id::text = trim(p_visitor_id)
  LIMIT 1;

  IF v_visitor_id IS NULL THEN
    RAISE EXCEPTION 'Visitor account could not be found.';
  END IF;

  -- ------------------------------------------------------------
  -- Find the requested personal/community book.
  -- ------------------------------------------------------------
  SELECT b.*
  INTO v_book
  FROM public.books b
  WHERE b.id = trim(p_book_id)
    AND b.book_type = 'personal'
  LIMIT 1;

  IF v_book.id IS NULL THEN
    RAISE EXCEPTION 'Personal book could not be found.';
  END IF;

  -- ------------------------------------------------------------
  -- Make sure only the owner can change visibility.
  -- ------------------------------------------------------------
  IF COALESCE(v_book.owner_visitor_id, '') <> v_visitor_id THEN
    RAISE EXCEPTION 'You can only change the visibility of your own personal book.';
  END IF;

  -- ------------------------------------------------------------
  -- Update ONLY the visibility flag.
  -- No other book data is changed.
  -- ------------------------------------------------------------
  UPDATE public.books
  SET is_public = COALESCE(p_is_public, false)
  WHERE id = v_book.id;

  RETURN COALESCE(p_is_public, false);
END;
$function$;

GRANT EXECUTE ON FUNCTION "public"."set_personal_book_visibility"(text, text, boolean) TO PUBLIC, "anon", "authenticated", "postgres", "service_role";
