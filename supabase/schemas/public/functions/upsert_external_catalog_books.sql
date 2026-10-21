CREATE OR REPLACE FUNCTION public.upsert_external_catalog_books (
  p_library_id uuid,
  p_books      jsonb
)
  RETURNS integer
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
DECLARE
    v_count INTEGER := 0;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Authentication required';
    END IF;

    IF p_library_id IS NULL
       OR NOT public.is_active_staff_for_branch(p_library_id::TEXT) THEN
        RAISE EXCEPTION 'Active staff access to this library is required';
    END IF;

    IF p_books IS NULL OR jsonb_typeof(p_books) <> 'array' THEN
        RAISE EXCEPTION 'p_books must be a JSON array';
    END IF;

    INSERT INTO public.external_catalog_books (
        openlibrary_key,
        title,
        author,
        category,
        isbn,
        summary,
        cover_url,
        source_url,
        last_synced_at,
        updated_at
    )
    SELECT
        LEFT(TRIM(item->>'openlibrary_key'), 200),
        LEFT(TRIM(item->>'title'), 1000),
        NULLIF(TRIM(item->>'author'), ''),
        NULLIF(TRIM(item->>'category'), ''),
        NULLIF(TRIM(item->>'isbn'), ''),
        NULLIF(TRIM(item->>'summary'), ''),
        NULLIF(TRIM(item->>'cover_url'), ''),
        NULLIF(TRIM(item->>'source_url'), ''),
        NOW(),
        NOW()
    FROM jsonb_array_elements(p_books) AS item
    WHERE NULLIF(TRIM(item->>'openlibrary_key'), '') IS NOT NULL
      AND NULLIF(TRIM(item->>'title'), '') IS NOT NULL
    ON CONFLICT (openlibrary_key) DO UPDATE
    SET
        title = EXCLUDED.title,
        author = EXCLUDED.author,
        category = EXCLUDED.category,
        isbn = EXCLUDED.isbn,
        summary = EXCLUDED.summary,
        cover_url = EXCLUDED.cover_url,
        source_url = EXCLUDED.source_url,
        last_synced_at = NOW(),
        updated_at = NOW();

    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN v_count;
END;
$function$;

GRANT EXECUTE ON FUNCTION "public"."upsert_external_catalog_books"(uuid, jsonb) TO "authenticated", "postgres", "service_role";

REVOKE ALL ON FUNCTION "public"."upsert_external_catalog_books"(uuid, jsonb) FROM PUBLIC;
