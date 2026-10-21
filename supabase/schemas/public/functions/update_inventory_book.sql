CREATE OR REPLACE FUNCTION public.update_inventory_book (
  p_book_id             text,
  p_expected_updated_at timestamp with time zone,
  p_patch               jsonb
)
  RETURNS public.books
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
DECLARE
    book_row public.books%rowtype;
    new_total integer;
    borrowed_count integer := 0;
    community_borrowed_count integer := 0;
    allocated_count integer := 0;
    new_library_id text;
BEGIN
    -- Validate the request payload.
    IF p_expected_updated_at IS NULL
       OR p_patch IS NULL
       OR jsonb_typeof(p_patch) IS DISTINCT FROM 'object'
    THEN
        RAISE EXCEPTION
            'INVENTORY_CONFLICT: reload this book before saving.';
    END IF;

    -- Lock the target book and verify its version.
    SELECT *
    INTO book_row
    FROM public.books
    WHERE id = p_book_id
    FOR UPDATE;

    IF NOT FOUND
       OR book_row.updated_at IS DISTINCT FROM p_expected_updated_at
    THEN
        RAISE EXCEPTION USING
            ERRCODE = '40001',
            MESSAGE =
                'INVENTORY_CONFLICT: this book changed or was removed. Reload it before saving.';
    END IF;

    -- Only active staff authorized for this branch may edit it.
    IF NOT public.is_active_staff_for_branch(
        book_row.library_id::text
    ) THEN
        RAISE EXCEPTION USING
            ERRCODE = '42501',
            MESSAGE = 'You cannot edit this branch inventory.';
    END IF;

    -- Validate the destination branch.
    new_library_id := CASE
        WHEN p_patch ? 'library_id'
            THEN NULLIF(p_patch ->> 'library_id', '')
        ELSE book_row.library_id::text
    END;

    IF new_library_id IS NOT NULL
       AND NOT public.is_active_staff_for_branch(new_library_id)
    THEN
        RAISE EXCEPTION USING
            ERRCODE = '42501',
            MESSAGE = 'You cannot move this book to that branch.';
    END IF;

    -- A sub-admin cannot unassign a book from its branch.
    IF new_library_id IS NULL
       AND NOT public.is_active_staff_for_branch(NULL::text)
    THEN
        RAISE EXCEPTION USING
            ERRCODE = '42501',
            MESSAGE = 'Only a superadmin may unassign inventory from a branch.';
    END IF;

    -- Validate the requested total copy count.
    new_total := CASE
        WHEN p_patch ? 'total_copies'
            THEN (p_patch ->> 'total_copies')::integer
        ELSE book_row.total_copies
    END;

    IF new_total IS NULL OR new_total < 1 THEN
        RAISE EXCEPTION
            'Total copies must be a positive whole number.';
    END IF;

    -- Count active library-book loans.
    SELECT count(*)::integer
    INTO borrowed_count
    FROM public.borrow_requests request
    WHERE request.book_id = p_book_id
      AND request.status = 'borrowed'
      AND request.return_date IS NULL;

    -- Count active community-book loans.
    SELECT count(*)::integer
    INTO community_borrowed_count
    FROM public.community_book_requests request
    WHERE request.book_id = p_book_id
      AND request.status = 'borrowed'
      AND request.return_date IS NULL;

    borrowed_count :=
        borrowed_count + community_borrowed_count;

    -- Preserve all outstanding or otherwise allocated copies.
    allocated_count := greatest(
        borrowed_count,
        book_row.total_copies - book_row.available_copies
    );

    IF new_total < borrowed_count
       OR new_total < allocated_count
    THEN
        RAISE EXCEPTION USING
            ERRCODE = '23514',
            MESSAGE = format(
                'INVENTORY_CONFLICT: total copies cannot be less than the %s outstanding copies.',
                allocated_count
            );
    END IF;

    -- Update only fields explicitly supported by the original RPC.
    UPDATE public.books
    SET
        title = coalesce(
            nullif(trim(p_patch ->> 'title'), ''),
            title
        ),
        author = coalesce(
            nullif(trim(p_patch ->> 'author'), ''),
            author
        ),
        category = CASE
            WHEN p_patch ? 'category'
                THEN nullif(trim(p_patch ->> 'category'), '')
            ELSE category
        END,
        isbn = CASE
            WHEN p_patch ? 'isbn'
                THEN nullif(trim(p_patch ->> 'isbn'), '')
            ELSE isbn
        END,
        shelf_location = CASE
            WHEN p_patch ? 'shelf_location'
                THEN nullif(trim(p_patch ->> 'shelf_location'), '')
            ELSE shelf_location
        END,
        library_id = new_library_id::uuid,
        total_copies = new_total,
        available_copies = new_total - allocated_count,
        summary = CASE
            WHEN p_patch ? 'summary'
                THEN nullif(trim(p_patch ->> 'summary'), '')
            ELSE summary
        END,
        cover_url = CASE
            WHEN p_patch ? 'cover_url'
                THEN coalesce(
                    nullif(trim(p_patch ->> 'cover_url'), ''),
                    cover_url
                )
            ELSE cover_url
        END,
        lending_enabled = CASE
            WHEN p_patch ? 'lending_enabled'
                THEN (p_patch ->> 'lending_enabled')::boolean
            ELSE lending_enabled
        END,
        condition = CASE
            WHEN p_patch ? 'condition'
                THEN nullif(trim(p_patch ->> 'condition'), '')
            ELSE condition
        END,
        lending_period_days = CASE
            WHEN p_patch ? 'lending_period_days'
                THEN (p_patch ->> 'lending_period_days')::integer
            ELSE lending_period_days
        END,
        handover_location = CASE
            WHEN p_patch ? 'handover_location'
                THEN nullif(trim(p_patch ->> 'handover_location'), '')
            ELSE handover_location
        END,
        handover_method = CASE
            WHEN p_patch ? 'handover_method'
                THEN nullif(trim(p_patch ->> 'handover_method'), '')
            ELSE handover_method
        END,
        handover_details = CASE
            WHEN p_patch ? 'handover_details'
                THEN nullif(trim(p_patch ->> 'handover_details'), '')
            ELSE handover_details
        END
    WHERE id = p_book_id
    RETURNING * INTO book_row;

    RETURN book_row;
END;
$function$;

GRANT EXECUTE ON FUNCTION "public"."update_inventory_book"(text, timestamp WITH time zone, jsonb) TO "authenticated", "postgres", "service_role";

REVOKE ALL ON FUNCTION "public"."update_inventory_book"(text, timestamp WITH time zone, jsonb) FROM PUBLIC;
