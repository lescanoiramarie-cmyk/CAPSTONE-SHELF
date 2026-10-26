CREATE OR REPLACE FUNCTION public.approve_community_book_request (
  p_request_id       uuid,
  p_owner_visitor_id text,
  p_response         text DEFAULT NULL::text
)
  RETURNS TABLE (
    id                   uuid,
    book_id              text,
    book_title           text,
    requester_visitor_id text,
    requester_name       text,
    status               text,
    approved_at          timestamp with time zone,
    owner_response       text
  )
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
DECLARE
  request_row public.community_book_requests%ROWTYPE;
  available_count integer;
  total_count integer;
  active_allocations integer := 0;
BEGIN
  -- Verify the authenticated, active, OTP-verified visitor.
  IF auth.uid() IS NULL OR NOT EXISTS (
    SELECT 1
    FROM public.visitors AS visitor
    WHERE visitor.id = trim(p_owner_visitor_id)
      AND visitor.auth_user_id = auth.uid()
      AND visitor.otp_verified
      AND visitor.is_active
  ) THEN
    RAISE EXCEPTION
      'The authenticated, verified visitor account could not be found.';
  END IF;

  -- Lock the request.
  SELECT request.*
  INTO request_row
  FROM public.community_book_requests AS request
  WHERE request.id = p_request_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Community book request could not be found.';
  END IF;

  IF request_row.owner_visitor_id <> trim(p_owner_visitor_id) THEN
    RAISE EXCEPTION
      'Only the owner of this community book can approve the request.';
  END IF;

  IF request_row.status <> 'pending' THEN
    RAISE EXCEPTION 'This request is no longer pending.';
  END IF;

  -- Verify that the community book has an available copy.
  SELECT book.available_copies, book.total_copies
  INTO available_count, total_count
  FROM public.books AS book
  WHERE book.id = request_row.book_id
    AND book.book_type = 'personal'
    AND book.lending_enabled
    AND book.is_public
  FOR UPDATE;

  IF NOT FOUND OR COALESCE(available_count, 0) < 1 THEN
    RAISE EXCEPTION
      'No copies of this community book are currently available.';
  END IF;

  SELECT count(*)::integer
  INTO active_allocations
  FROM public.borrow_requests AS request
  WHERE request.book_id = request_row.book_id
    AND request.status IN ('ready_for_pickup', 'borrowed')
    AND request.return_date IS NULL;

  SELECT active_allocations + count(*)::integer
  INTO active_allocations
  FROM public.community_book_requests AS request
  WHERE request.book_id = request_row.book_id
    AND request.status IN ('approved', 'borrowed')
    AND request.return_date IS NULL;

  IF total_count IS NULL
     OR total_count <= active_allocations
     OR available_count > total_count - active_allocations
  THEN
    RAISE EXCEPTION
      'No unallocated copy is available for this community request.';
  END IF;

  -- Preserve the request queue order.
  IF EXISTS (
    SELECT 1
    FROM public.community_book_requests AS earlier
    WHERE earlier.book_id = request_row.book_id
      AND earlier.status = 'pending'
      AND (earlier.request_date, earlier.id)
          < (request_row.request_date, request_row.id)
  ) THEN
    RAISE EXCEPTION
      'Please approve the next request in the community book queue first.';
  END IF;

  -- Approve the request.
  UPDATE public.community_book_requests AS request
  SET
    status = 'approved',
    approved_at = now(),
    rejected_at = NULL,
    owner_response = NULLIF(trim(p_response), '')
  WHERE request.id = p_request_id
  RETURNING request.* INTO request_row;

  -- Explicitly cast status to the declared return type: text.
  RETURN QUERY
  SELECT
    request_row.id,
    request_row.book_id,
    request_row.book_title,
    request_row.requester_visitor_id,
    request_row.requester_name,
    request_row.status::text,
    request_row.approved_at,
    request_row.owner_response;
END;
$function$;

GRANT EXECUTE ON FUNCTION "public"."approve_community_book_request"(uuid, text, text) TO "authenticated", "postgres", "service_role";

REVOKE ALL ON FUNCTION "public"."approve_community_book_request"(uuid, text, text) FROM PUBLIC;
