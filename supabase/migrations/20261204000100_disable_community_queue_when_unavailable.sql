BEGIN;

CREATE OR REPLACE FUNCTION public.request_community_book (
  p_requester_visitor_id text,
  p_book_id              text
)
RETURNS TABLE (
  id                   uuid,
  book_id              text,
  book_title           text,
  owner_visitor_id     text,
  owner_name           text,
  requester_visitor_id text,
  requester_name       text,
  status               text,
  request_date         timestamp with time zone,
  owner_response       text,
  queue_position       integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  requester public.visitors%ROWTYPE;
  book_row public.books%ROWTYPE;
  request_row public.community_book_requests%ROWTYPE;
  position_value integer;
BEGIN
  SELECT visitor.* INTO requester
  FROM public.visitors AS visitor
  WHERE visitor.auth_user_id = auth.uid()
    AND (
      visitor.id = trim(p_requester_visitor_id)
      OR visitor.auth_user_id::text = trim(p_requester_visitor_id)
    )
    AND visitor.otp_verified
    AND visitor.is_active;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'The authenticated, verified visitor account could not be found.';
  END IF;

  SELECT book.* INTO book_row
  FROM public.books AS book
  WHERE book.id = trim(p_book_id)
    AND book.book_type = 'personal'
    AND book.is_public
    AND book.lending_enabled
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'This is not available for community lending.';
  END IF;
  IF book_row.owner_visitor_id = requester.id THEN
    RAISE EXCEPTION 'You cannot request your own personal book.';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.community_book_requests AS request
    WHERE request.book_id = book_row.id
      AND request.requester_visitor_id = requester.id
      AND request.status IN ('pending', 'approved', 'borrowed')
  ) THEN
    RAISE EXCEPTION 'You already have an active request for this community book.';
  END IF;
  IF COALESCE(book_row.available_copies, 0) <= 0 THEN
    RAISE EXCEPTION 'This community book is currently unavailable.';
  END IF;

  SELECT count(*)::integer + 1 INTO position_value
  FROM public.community_book_requests AS request
  WHERE request.book_id = book_row.id
    AND request.status = 'pending';

  INSERT INTO public.community_book_requests (
    book_id,
    book_title,
    owner_visitor_id,
    owner_name,
    requester_visitor_id,
    requester_name,
    status,
    queue_position
  ) VALUES (
    book_row.id,
    book_row.title,
    book_row.owner_visitor_id,
    COALESCE(
      (
        SELECT owner.full_name
        FROM public.visitors AS owner
        WHERE owner.id = book_row.owner_visitor_id
      ),
      'Book owner'
    ),
    requester.id,
    requester.full_name,
    'pending',
    position_value
  )
  RETURNING * INTO request_row;

  RETURN QUERY
  SELECT
    request_row.id::uuid,
    request_row.book_id::text,
    request_row.book_title::text,
    request_row.owner_visitor_id::text,
    request_row.owner_name::text,
    request_row.requester_visitor_id::text,
    request_row.requester_name::text,
    request_row.status::text,
    request_row.request_date::timestamptz,
    request_row.owner_response::text,
    request_row.queue_position::integer;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.request_community_book(text, text)
  TO authenticated, postgres, service_role;
REVOKE ALL ON FUNCTION public.request_community_book(text, text)
  FROM PUBLIC, anon;

NOTIFY pgrst, 'reload schema';

COMMIT;
