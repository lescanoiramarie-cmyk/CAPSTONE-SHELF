-- RPCs for Community Books Read Later functionality

-- Save a community book for later reading
CREATE OR REPLACE FUNCTION public.save_community_book_for_later(
  p_community_book_id uuid
)
RETURNS TABLE (success boolean, message text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_visitor_id text;
  v_book public.books%rowtype;
BEGIN
  -- Get current visitor
  SELECT id INTO v_visitor_id
  FROM public.visitors
  WHERE auth_user_id = auth.uid()
    AND otp_verified = true
    AND is_active = true;

  IF v_visitor_id IS NULL THEN
    RETURN QUERY SELECT false::boolean, 'Please sign in to save books.'::text;
    RETURN;
  END IF;

  -- Verify the book exists and is a public community book
  SELECT * INTO v_book
  FROM public.books
  WHERE id = p_community_book_id
    AND book_type = 'personal'
    AND is_public = true
    AND is_active = true;

  IF v_book IS NULL THEN
    RETURN QUERY SELECT false::boolean, 'Community book not found or not available for saving.'::text;
    RETURN;
  END IF;

  -- Insert or ignore if already saved
  INSERT INTO public.visitor_saved_community_books (visitor_id, community_book_id)
  VALUES (v_visitor_id, p_community_book_id)
  ON CONFLICT (visitor_id, community_book_id) DO NOTHING;

  RETURN QUERY SELECT true::boolean, 'Book saved for later.'::text;
END;
$function$;

REVOKE ALL ON FUNCTION public.save_community_book_for_later(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_community_book_for_later(uuid) TO authenticated;

-- Unsave a community book
CREATE OR REPLACE FUNCTION public.unsave_community_book_for_later(
  p_community_book_id uuid
)
RETURNS TABLE (success boolean, message text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_visitor_id text;
  v_deleted integer;
BEGIN
  -- Get current visitor
  SELECT id INTO v_visitor_id
  FROM public.visitors
  WHERE auth_user_id = auth.uid()
    AND otp_verified = true
    AND is_active = true;

  IF v_visitor_id IS NULL THEN
    RETURN QUERY SELECT false::boolean, 'Please sign in to unsave books.'::text;
    RETURN;
  END IF;

  DELETE FROM public.visitor_saved_community_books
  WHERE visitor_id = v_visitor_id
    AND community_book_id = p_community_book_id;

  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  IF v_deleted = 0 THEN
    RETURN QUERY SELECT false::boolean, 'Book was not in your saved list.'::text;
  ELSE
    RETURN QUERY SELECT true::boolean, 'Book removed from saved list.'::text;
  END IF;
END;
$function$;

REVOKE ALL ON FUNCTION public.unsave_community_book_for_later(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.unsave_community_book_for_later(uuid) TO authenticated;

-- Fetch saved community books for current visitor
CREATE OR REPLACE FUNCTION public.get_saved_community_books()
RETURNS TABLE (
  book_id uuid,
  title text,
  author text,
  category text,
  isbn text,
  cover_url text,
  owner_visitor_id text,
  owner_name text,
  saved_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_visitor_id text;
BEGIN
  -- Get current visitor
  SELECT id INTO v_visitor_id
  FROM public.visitors
  WHERE auth_user_id = auth.uid()
    AND otp_verified = true
    AND is_active = true;

  IF v_visitor_id IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    b.id AS book_id,
    b.title,
    b.author,
    b.category,
    b.isbn,
    b.cover_url,
    b.owner_visitor_id,
    v.full_name AS owner_name,
    sb.saved_at
  FROM public.visitor_saved_community_books sb
  JOIN public.books b ON b.id = sb.community_book_id
  JOIN public.visitors v ON v.id = b.owner_visitor_id
  WHERE sb.visitor_id = v_visitor_id
    AND b.is_active = true
    AND b.is_public = true
    AND b.book_type = 'personal'
  ORDER BY sb.saved_at DESC;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_saved_community_books() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_saved_community_books() TO authenticated;

-- Postflight assertions
DO $$
DECLARE
  v_save_exists boolean;
  v_unsave_exists boolean;
  v_get_exists boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM pg_proc
    WHERE proname = 'save_community_book_for_later'
      AND pronamespace = 'public'::regnamespace
      AND proargtypes[0] = 'uuid'::regtype
  ) INTO v_save_exists;

  SELECT EXISTS (
    SELECT 1 FROM pg_proc
    WHERE proname = 'unsave_community_book_for_later'
      AND pronamespace = 'public'::regnamespace
      AND proargtypes[0] = 'uuid'::regtype
  ) INTO v_unsave_exists;

  SELECT EXISTS (
    SELECT 1 FROM pg_proc
    WHERE proname = 'get_saved_community_books'
      AND pronamespace = 'public'::regnamespace
      AND proargtypes[0] IS NULL
  ) INTO v_get_exists;

  IF NOT v_save_exists THEN
    RAISE EXCEPTION 'Postflight failed: save_community_book_for_later function not found';
  END IF;
  IF NOT v_unsave_exists THEN
    RAISE EXCEPTION 'Postflight failed: unsave_community_book_for_later function not found';
  END IF;
  IF NOT v_get_exists THEN
    RAISE EXCEPTION 'Postflight failed: get_saved_community_books function not found';
  END IF;
END $$;