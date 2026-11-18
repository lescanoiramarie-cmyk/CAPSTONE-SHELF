-- Server-side category book counts for OPAC
-- Provides exact counts without client-side pagination limitations

CREATE OR REPLACE FUNCTION public.get_opac_category_book_counts(
  p_library_id uuid DEFAULT NULL
)
RETURNS TABLE (category text, book_count bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  -- Return category counts for books visible in OPAC
  -- If p_library_id is provided, scope to that library; otherwise all libraries
  RETURN QUERY
  SELECT
    COALESCE(b.category, 'Uncategorized') AS category,
    COUNT(DISTINCT b.id)::bigint AS book_count
  FROM public.books AS b
  WHERE b.is_active = true
    AND b.book_type = 'library'
    AND (p_library_id IS NULL OR b.library_id = p_library_id)
  GROUP BY COALESCE(b.category, 'Uncategorized')
  ORDER BY COALESCE(b.category, 'Uncategorized');
END;
$function$;

REVOKE ALL ON FUNCTION public.get_opac_category_book_counts(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_opac_category_book_counts(uuid) TO anon, authenticated;

-- Postflight assertion
DO $$
DECLARE
  v_count integer;
BEGIN
  SELECT COUNT(*) INTO v_count
  FROM pg_proc
  WHERE proname = 'get_opac_category_book_counts'
    AND pronamespace = 'public'::regnamespace
    AND proargtypes[0] = 'uuid'::regtype;

  IF v_count = 0 THEN
    RAISE EXCEPTION 'Postflight failed: get_opac_category_book_counts function not found';
  END IF;
END $$;