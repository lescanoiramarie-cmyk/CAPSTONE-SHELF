BEGIN;

ALTER TABLE public.borrow_requests
  ADD COLUMN IF NOT EXISTS scheduled_pickup_date date;

CREATE INDEX IF NOT EXISTS borrow_requests_scheduled_pickup_idx
  ON public.borrow_requests (book_id, scheduled_pickup_date, request_date)
  WHERE status = 'scheduled';

-- Future reservations are separate from today's pickup holds and waitlist.
-- Reserve a copy only when projected stock for the selected date can support it.
CREATE OR REPLACE FUNCTION public.reserve_book_for_date_v1(
  p_book_id text,
  p_pickup_date date
)
RETURNS public.borrow_requests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_visitor public.visitors%ROWTYPE;
  v_book public.books%ROWTYPE;
  v_request public.borrow_requests%ROWTYPE;
  v_committed integer := 0;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Sign in with a verified visitor account to reserve a book.';
  END IF;
  SELECT visitor.* INTO v_visitor
  FROM public.visitors AS visitor
  WHERE visitor.auth_user_id = v_uid
    AND visitor.otp_verified IS TRUE
    AND visitor.is_active IS TRUE
  LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'An active, verified visitor account is required.';
  END IF;
  IF p_pickup_date IS NULL OR p_pickup_date <= CURRENT_DATE THEN
    RAISE EXCEPTION 'Choose a pickup date starting tomorrow.';
  END IF;
  IF p_pickup_date > CURRENT_DATE + 180 THEN
    RAISE EXCEPTION 'Reservations can be scheduled up to 180 days ahead.';
  END IF;

  SELECT book.* INTO v_book
  FROM public.books AS book
  WHERE book.id = pg_catalog.btrim(p_book_id)
    AND book.library_id IS NOT NULL
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'This library book is unavailable for reservation.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.borrow_requests AS request
    WHERE request.book_id = v_book.id
      AND request.visitor_id = v_visitor.id
      AND request.status IN ('queued', 'scheduled', 'ready_for_pickup', 'borrowed')
  ) THEN
    RAISE EXCEPTION 'You already have an active request or reservation for this book.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.borrow_requests AS request
    WHERE request.book_id = v_book.id AND request.status = 'queued'
  ) THEN
    RAISE EXCEPTION 'This book already has a waitlist. Join the waitlist to keep your place in line.';
  END IF;

  -- Count loans that are expected to overlap this date and other scheduled
  -- loans whose seven-day lending windows overlap the selected pickup date.
  SELECT
    (SELECT count(*)::integer
     FROM public.borrow_requests AS request
     WHERE request.book_id = v_book.id
       AND request.return_date IS NULL
       AND (
         request.status = 'borrowed'
         AND (request.due_date IS NULL OR request.due_date::date >= p_pickup_date)
         OR request.status = 'ready_for_pickup'
           AND p_pickup_date <= CURRENT_DATE + 8
       ))
    +
    (SELECT count(*)::integer
     FROM public.community_book_requests AS request
     WHERE request.book_id = v_book.id
       AND request.return_date IS NULL
       AND request.status IN ('approved', 'borrowed'))
    +
    (SELECT count(*)::integer
     FROM public.borrow_requests AS request
     WHERE request.book_id = v_book.id
       AND request.status = 'scheduled'
       AND request.scheduled_pickup_date BETWEEN p_pickup_date - 7 AND p_pickup_date + 7)
  INTO v_committed;

  IF v_committed >= COALESCE(v_book.total_copies, 0) THEN
    RAISE EXCEPTION 'No copy is currently expected to be free on that date. Choose another date or join the waitlist.';
  END IF;

  INSERT INTO public.borrow_requests (
    book_id, book_title, visitor_id, visitor_name, status,
    scheduled_pickup_date, queue_position
  ) VALUES (
    v_book.id, v_book.title, v_visitor.id, v_visitor.full_name,
    'scheduled', p_pickup_date, NULL
  ) RETURNING * INTO v_request;

  PERFORM public.create_visitor_notification(
    v_visitor.id,
    'borrow_request_created',
    'Book reservation scheduled',
    'Your reservation for "' || v_book.title || '" is scheduled for ' || p_pickup_date::text || '. Availability depends on the book being returned on time.',
    v_request.id::text,
    'borrow_request',
    pg_catalog.now() + pg_catalog.interval '30 days'
  );
  RETURN v_request;
END;
$function$;

ALTER FUNCTION public.reserve_book_for_date_v1(text, date) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.reserve_book_for_date_v1(text, date)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.reserve_book_for_date_v1(text, date)
  TO authenticated;

-- Keep future reservations from being consumed by a new seven-day loan.
CREATE OR REPLACE FUNCTION shelf_private.request_borrow_unchecked(
  p_visitor_id uuid,
  p_book_id text
)
RETURNS public.borrow_requests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_book public.books%ROWTYPE;
  v_visitor public.visitors%ROWTYPE;
  v_req public.borrow_requests%ROWTYPE;
  v_queue_count integer;
  v_active_allocations integer := 0;
  v_near_term_reservations integer := 0;
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Authenticated visitor account required.'; END IF;
  SELECT visitor.* INTO v_visitor FROM public.visitors AS visitor
  WHERE visitor.auth_user_id = p_visitor_id OR visitor.id = p_visitor_id::text LIMIT 1;
  SELECT book.* INTO v_book FROM public.books AS book
  WHERE book.id = pg_catalog.btrim(p_book_id) FOR UPDATE;
  IF v_visitor.id IS NULL THEN RAISE EXCEPTION 'Visitor account could not be found.'; END IF;
  IF v_book.id IS NULL THEN RAISE EXCEPTION 'The selected book could not be found.'; END IF;
  IF NOT COALESCE(v_visitor.otp_verified, false) THEN RAISE EXCEPTION 'Please verify your visitor account before requesting a book.'; END IF;
  IF NOT COALESCE(v_visitor.is_active, true) THEN RAISE EXCEPTION 'This visitor account is currently inactive.'; END IF;
  IF EXISTS (
    SELECT 1 FROM public.borrow_requests AS request
    WHERE request.visitor_id = v_visitor.id AND request.book_id = pg_catalog.btrim(p_book_id)
      AND request.status IN ('queued', 'scheduled', 'ready_for_pickup', 'borrowed')
  ) THEN RAISE EXCEPTION 'You already have an active request or loan for this title.'; END IF;

  SELECT count(*)::integer INTO v_active_allocations
  FROM public.borrow_requests AS request
  WHERE request.book_id = v_book.id AND request.status IN ('ready_for_pickup', 'borrowed')
    AND request.return_date IS NULL;
  SELECT v_active_allocations + count(*)::integer INTO v_active_allocations
  FROM public.community_book_requests AS request
  WHERE request.book_id = v_book.id AND request.status IN ('approved', 'borrowed')
    AND request.return_date IS NULL;
  SELECT count(*)::integer INTO v_near_term_reservations
  FROM public.borrow_requests AS request
  WHERE request.book_id = v_book.id AND request.status = 'scheduled'
    AND request.scheduled_pickup_date BETWEEN CURRENT_DATE AND CURRENT_DATE + 8;

  IF COALESCE(v_book.available_copies, 0) > v_near_term_reservations
     AND v_book.total_copies > v_active_allocations
     AND v_book.available_copies <= v_book.total_copies - v_active_allocations
  THEN
    UPDATE public.books AS book SET available_copies = book.available_copies - 1
    WHERE book.id = pg_catalog.btrim(p_book_id);
    INSERT INTO public.borrow_requests (
      book_id, book_title, visitor_id, visitor_name, status, pickup_deadline
    ) VALUES (
      v_book.id, v_book.title, v_visitor.id, v_visitor.full_name,
      'ready_for_pickup', pg_catalog.now() + pg_catalog.interval '24 hours'
    ) RETURNING * INTO v_req;
    PERFORM public.create_visitor_notification(
      v_visitor.id, 'borrow_request_created', 'Borrow request created',
      'Your borrow request for "' || v_book.title || '" has been created and is ready for pickup.',
      v_req.id::text, 'borrow_request', pg_catalog.now() + pg_catalog.interval '7 days'
    );
    PERFORM public.create_visitor_notification(
      v_visitor.id, 'borrow_ready_for_pickup', 'Book ready for pickup',
      '"' || v_book.title || '" is ready for pickup at the library. Please collect within 24 hours.',
      v_req.id::text, 'borrow_request', v_req.pickup_deadline
    );
  ELSE
    SELECT count(*)::integer INTO v_queue_count
    FROM public.borrow_requests AS request
    WHERE request.book_id = pg_catalog.btrim(p_book_id) AND request.status = 'queued';
    INSERT INTO public.borrow_requests (
      book_id, book_title, visitor_id, visitor_name, status, queue_position
    ) VALUES (
      v_book.id, v_book.title, v_visitor.id, v_visitor.full_name,
      'queued', v_queue_count + 1
    ) RETURNING * INTO v_req;
    PERFORM public.create_visitor_notification(
      v_visitor.id, 'borrow_request_created', 'Borrow request created',
      'Your borrow request for "' || v_book.title || '" has been created.',
      v_req.id::text, 'borrow_request', pg_catalog.now() + pg_catalog.interval '30 days'
    );
    PERFORM public.create_visitor_notification(
      v_visitor.id, 'borrow_request_queued', 'Added to waitlist',
      'You are #' || (v_queue_count + 1) || ' in line for "' || v_book.title || '". We will notify you when it becomes available.',
      v_req.id::text, 'borrow_request', pg_catalog.now() + pg_catalog.interval '30 days'
    );
  END IF;
  RETURN v_req;
END;
$function$;

ALTER FUNCTION shelf_private.request_borrow_unchecked(uuid, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION shelf_private.request_borrow_unchecked(uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION shelf_private.request_borrow_unchecked(uuid, text)
  TO authenticated, service_role;

-- Scheduled requests take a copy only on/after the selected day. Due scheduled
-- pickups are preferred when a return releases stock; later dates stay queued.
CREATE OR REPLACE FUNCTION public.release_copy_and_promote(p_book_id text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $function$
DECLARE
  v_next public.borrow_requests%ROWTYPE;
  v_total integer;
  v_available integer;
  v_allocations integer := 0;
  v_after_release integer := 0;
BEGIN
  SELECT book.total_copies, book.available_copies INTO v_total, v_available
  FROM public.books AS book WHERE book.id::text = p_book_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Book not found: %', p_book_id; END IF;
  SELECT
    (SELECT count(*)::integer FROM public.borrow_requests AS request
     WHERE request.book_id = p_book_id AND request.status IN ('ready_for_pickup', 'borrowed') AND request.return_date IS NULL)
    + (SELECT count(*)::integer FROM public.community_book_requests AS request
       WHERE request.book_id = p_book_id AND request.status IN ('approved', 'borrowed') AND request.return_date IS NULL)
  INTO v_allocations;
  v_after_release := LEAST(GREATEST(v_total - v_allocations, 0), COALESCE(v_available, 0) + 1);
  IF v_available IS DISTINCT FROM v_after_release THEN
    UPDATE public.books SET available_copies = v_after_release WHERE id::text = p_book_id;
  END IF;
  IF v_after_release < 1 THEN RETURN; END IF;

  SELECT request.* INTO v_next
  FROM public.borrow_requests AS request
  WHERE request.book_id::text = p_book_id
    AND request.status = 'scheduled'
    AND request.scheduled_pickup_date <= CURRENT_DATE
  ORDER BY request.scheduled_pickup_date, request.request_date, request.id
  LIMIT 1 FOR UPDATE;
  IF v_next.id IS NULL THEN
    SELECT request.* INTO v_next
    FROM public.borrow_requests AS request
    WHERE request.book_id::text = p_book_id AND request.status = 'queued'
    ORDER BY request.queue_position ASC NULLS LAST, request.id ASC
    LIMIT 1 FOR UPDATE;
  END IF;
  IF v_next.id IS NOT NULL THEN
    UPDATE public.borrow_requests SET status = 'ready_for_pickup',
      pickup_deadline = pg_catalog.now() + pg_catalog.interval '24 hours',
      scheduled_pickup_date = NULL, queue_position = NULL
    WHERE id = v_next.id;
    UPDATE public.books SET available_copies = available_copies - 1
    WHERE id::text = p_book_id;
    UPDATE public.borrow_requests AS request
    SET queue_position = queued.row_number
    FROM (
      SELECT id, pg_catalog.row_number() OVER (ORDER BY queue_position ASC NULLS LAST, id ASC) AS row_number
      FROM public.borrow_requests WHERE book_id::text = p_book_id AND status = 'queued'
    ) AS queued
    WHERE request.id = queued.id;
  END IF;
END;
$function$;
ALTER FUNCTION public.release_copy_and_promote(text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.release_copy_and_promote(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.release_copy_and_promote(text) TO postgres, service_role;

-- Existing minute cron also activates reservations when their day arrives and
-- expires pickup holds that were not collected within 24 hours.
CREATE OR REPLACE FUNCTION public.auto_expire_pickups()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $function$
DECLARE
  v_request record;
  v_book record;
  v_count integer := 0;
BEGIN
  FOR v_request IN
    SELECT request.id, request.book_id
    FROM public.borrow_requests AS request
    WHERE request.status = 'ready_for_pickup' AND request.pickup_deadline <= pg_catalog.now()
    FOR UPDATE SKIP LOCKED
  LOOP
    UPDATE public.borrow_requests SET status = 'expired'
    WHERE id = v_request.id;
    PERFORM public.release_copy_and_promote(v_request.book_id::text);
    v_count := v_count + 1;
  END LOOP;

  FOR v_request IN
    SELECT request.id, request.book_id
    FROM public.borrow_requests AS request
    WHERE request.status = 'scheduled'
      AND request.scheduled_pickup_date <= CURRENT_DATE
    ORDER BY request.scheduled_pickup_date, request.request_date, request.id
    FOR UPDATE SKIP LOCKED
  LOOP
    SELECT book.total_copies, book.available_copies INTO v_book
    FROM public.books AS book WHERE book.id::text = v_request.book_id::text FOR UPDATE SKIP LOCKED;
    IF FOUND AND COALESCE(v_book.available_copies, 0) > 0 THEN
      UPDATE public.borrow_requests SET status = 'ready_for_pickup',
        pickup_deadline = pg_catalog.now() + pg_catalog.interval '24 hours',
        scheduled_pickup_date = NULL
      WHERE id = v_request.id AND status = 'scheduled';
      IF FOUND THEN
        UPDATE public.books SET available_copies = available_copies - 1
        WHERE id::text = v_request.book_id::text;
        v_count := v_count + 1;
      END IF;
    END IF;
  END LOOP;
  RETURN v_count;
END;
$function$;
ALTER FUNCTION public.auto_expire_pickups() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.auto_expire_pickups() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.auto_expire_pickups() TO service_role;

-- Add the planned date to the secure visitor request-history response.
DROP FUNCTION public.get_visitor_borrowing_history();
CREATE FUNCTION public.get_visitor_borrowing_history()
RETURNS TABLE (
  id text, book_id text, book_title text, visitor_id text, visitor_name text,
  library_id uuid, status text, request_date timestamptz,
  pickup_deadline timestamptz, queue_position integer, borrow_date timestamptz,
  due_date timestamptz, return_date timestamptz, fine_amount numeric,
  fine_paid_amount numeric, confirmed_by text, return_confirmed_by text,
  fine_rate_snapshot integer, fine_review_required boolean,
  fine_review_resolved_at timestamptz, scheduled_pickup_date date
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_visitor public.visitors%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Authenticated visitor session required.'; END IF;
  SELECT visitor.* INTO v_visitor FROM public.visitors AS visitor
  WHERE (visitor.auth_user_id = v_uid OR visitor.id = v_uid::text)
    AND visitor.otp_verified IS TRUE AND visitor.is_active IS TRUE LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'Active, verified visitor account required.'; END IF;
  RETURN QUERY
  SELECT request.id::text, request.book_id::text, request.book_title::text,
    request.visitor_id::text, request.visitor_name::text, request.library_id,
    request.status::text, request.request_date, request.pickup_deadline,
    request.queue_position, request.borrow_date, request.due_date,
    request.return_date, request.fine_amount::numeric,
    request.fine_paid_amount::numeric, request.confirmed_by::text,
    request.return_confirmed_by::text, request.fine_rate_snapshot,
    (COALESCE(request.fine_review_required, false)
      OR (COALESCE(request.fine_amount, 0) <> 0 AND
        (request.status <> 'returned' OR request.fine_rate_snapshot IS NULL OR request.fine_rate_snapshot NOT IN (10, 15, 20)))
      OR (request.status IN ('borrowed', 'returned') AND
        (request.fine_rate_snapshot IS NULL OR request.fine_rate_snapshot NOT IN (10, 15, 20)))),
    request.fine_review_resolved_at, request.scheduled_pickup_date
  FROM public.borrow_requests AS request
  WHERE request.visitor_id = v_visitor.id OR request.visitor_id = v_visitor.auth_user_id::text
  ORDER BY request.request_date DESC, request.id ASC;
END;
$function$;
ALTER FUNCTION public.get_visitor_borrowing_history() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_visitor_borrowing_history() FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.get_visitor_borrowing_history() TO authenticated;

CREATE OR REPLACE FUNCTION public.cancel_borrow_request(
  p_request_id text,
  p_visitor_id text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_request public.borrow_requests%ROWTYPE;
  v_visitor public.visitors%ROWTYPE;
  v_request_id text := pg_catalog.btrim(COALESCE(p_request_id, ''));
  v_visitor_id text := pg_catalog.btrim(COALESCE(p_visitor_id, ''));
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required.'; END IF;
  SELECT visitor.* INTO v_visitor FROM public.visitors AS visitor
  WHERE visitor.auth_user_id = auth.uid() OR visitor.id = auth.uid()::text LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'Visitor account not found.'; END IF;
  IF v_visitor.id <> v_visitor_id AND v_visitor.auth_user_id::text <> v_visitor_id THEN
    RAISE EXCEPTION 'You can only cancel your own requests.';
  END IF;
  SELECT request.* INTO v_request FROM public.borrow_requests AS request
  WHERE request.id::text = v_request_id
    AND (request.visitor_id = v_visitor.id OR request.visitor_id = v_visitor.auth_user_id::text)
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Request not found.'; END IF;
  IF v_request.status NOT IN ('pending', 'queued', 'scheduled', 'ready_for_pickup') THEN
    RAISE EXCEPTION 'Only pending, queued, scheduled, or ready-for-pickup requests can be cancelled.';
  END IF;
  IF v_request.status = 'ready_for_pickup' THEN
    PERFORM public.release_copy_and_promote(v_request.book_id::text);
  END IF;
  UPDATE public.borrow_requests SET status = 'cancelled',
    cancel_reason = 'Cancelled by visitor', scheduled_pickup_date = NULL
  WHERE id::text = v_request_id;
  PERFORM public.create_visitor_notification(
    v_visitor.id, 'borrow_cancelled', 'Request cancelled',
    'Your borrow request for "' || v_request.book_title || '" has been cancelled.',
    v_request.id::text, 'borrow_request', pg_catalog.now() + pg_catalog.interval '7 days'
  );
END;
$function$;
ALTER FUNCTION public.cancel_borrow_request(text, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.cancel_borrow_request(text, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.cancel_borrow_request(text, text) TO authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
