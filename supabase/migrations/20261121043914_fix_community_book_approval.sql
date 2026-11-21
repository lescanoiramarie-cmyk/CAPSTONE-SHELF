-- Fix community-book approval failures and preserve copy inventory.
-- The request-status trigger owns inventory allocation, so this RPC must not
-- decrement books.available_copies a second time.

CREATE OR REPLACE FUNCTION public.approve_community_book_request(
    p_request_id uuid,
    p_owner_visitor_id text,
    p_response text DEFAULT NULL
)
RETURNS TABLE (
    id uuid,
    book_id text,
    book_title text,
    requester_visitor_id text,
    requester_name text,
    status text,
    approved_at timestamptz,
    owner_response text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    request_row public.community_book_requests%ROWTYPE;
    available_count integer;
    total_count integer;
    active_allocations integer := 0;
BEGIN
    IF auth.uid() IS NULL OR NOT EXISTS (
        SELECT 1
        FROM public.visitors AS visitor
        WHERE visitor.id::text = pg_catalog.btrim(p_owner_visitor_id)
          AND visitor.auth_user_id = auth.uid()
          AND visitor.otp_verified IS TRUE
          AND visitor.is_active IS TRUE
    ) THEN
        RAISE EXCEPTION 'The authenticated, verified visitor account could not be found.';
    END IF;

    SELECT request.*
    INTO request_row
    FROM public.community_book_requests AS request
    WHERE request.id = p_request_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Community book request could not be found.';
    END IF;
    IF request_row.owner_visitor_id <> pg_catalog.btrim(p_owner_visitor_id) THEN
        RAISE EXCEPTION 'Only the owner of this community book can approve the request.';
    END IF;
    IF request_row.status <> 'pending' THEN
        RAISE EXCEPTION 'This request is no longer pending.';
    END IF;

    SELECT book.available_copies, book.total_copies
    INTO available_count, total_count
    FROM public.books AS book
    WHERE book.id::text = request_row.book_id
      AND book.book_type = 'personal'
      AND book.lending_enabled IS TRUE
      AND book.is_public IS TRUE
    FOR UPDATE;

    IF NOT FOUND OR COALESCE(available_count, 0) < 1 THEN
        RAISE EXCEPTION 'No copies of this community book are currently available.';
    END IF;

    SELECT count(*)::integer
    INTO active_allocations
    FROM public.borrow_requests AS borrow_request
    WHERE borrow_request.book_id::text = request_row.book_id
      AND borrow_request.status IN ('ready_for_pickup', 'borrowed')
      AND borrow_request.return_date IS NULL;

    SELECT active_allocations + count(*)::integer
    INTO active_allocations
    FROM public.community_book_requests AS community_request
    WHERE community_request.book_id::text = request_row.book_id
      AND community_request.status IN ('approved', 'borrowed')
      AND community_request.return_date IS NULL;

    IF total_count IS NULL
       OR total_count <= active_allocations
       OR available_count > total_count - active_allocations
    THEN
        RAISE EXCEPTION 'No unallocated copy is available for this community request.';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM public.community_book_requests AS earlier
        WHERE earlier.book_id::text = request_row.book_id
          AND earlier.status = 'pending'
          AND (earlier.request_date, earlier.id) < (request_row.request_date, request_row.id)
    ) THEN
        RAISE EXCEPTION 'Please approve the next request in the community book queue first.';
    END IF;

    UPDATE public.community_book_requests AS community_request
    SET status = 'approved',
        approved_at = pg_catalog.now(),
        rejected_at = NULL,
        owner_response = NULLIF(pg_catalog.btrim(p_response), ''),
        updated_at = pg_catalog.now()
    WHERE community_request.id = p_request_id
    RETURNING community_request.* INTO request_row;

    -- community_book_copy_availability trigger decrements the book copy here.
    PERFORM public.create_visitor_notification(
        request_row.requester_visitor_id,
        'community_request_approved',
        'Request approved',
        'Your request for "' || request_row.book_title || '" has been approved by the owner. You can now arrange pickup.',
        request_row.id::uuid,
        'community_book_request',
        pg_catalog.now() + pg_catalog.interval '30 days'
    );
    PERFORM public.create_visitor_notification(
        request_row.owner_visitor_id,
        'community_request_approved',
        'Request approved',
        'You approved the request for "' || request_row.book_title || '" from ' || request_row.requester_name || '.',
        request_row.id::uuid,
        'community_book_request',
        pg_catalog.now() + pg_catalog.interval '30 days'
    );

    RETURN QUERY
    SELECT request_row.id,
           request_row.book_id,
           request_row.book_title,
           request_row.requester_visitor_id,
           request_row.requester_name,
           request_row.status::text,
           request_row.approved_at,
           request_row.owner_response;
END;
$function$;

ALTER FUNCTION public.approve_community_book_request(uuid, text, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.approve_community_book_request(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.approve_community_book_request(uuid, text, text) TO authenticated;

DO $postflight$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_catalog.pg_proc AS procedure
        JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = procedure.pronamespace
        WHERE namespace.nspname = 'public'
          AND procedure.proname = 'approve_community_book_request'
          AND pg_catalog.pg_get_function_identity_arguments(procedure.oid) =
              'p_request_id uuid, p_owner_visitor_id text, p_response text'
    ) THEN
        RAISE EXCEPTION 'Postflight failed: approve_community_book_request was not installed.';
    END IF;
END;
$postflight$;
