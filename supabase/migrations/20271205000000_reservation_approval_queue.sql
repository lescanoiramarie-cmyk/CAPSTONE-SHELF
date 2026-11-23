BEGIN;
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
      AND request.status IN ('queued', 'pending_reservation', 'scheduled', 'ready_for_pickup', 'borrowed')
  ) THEN
    RAISE EXCEPTION 'You already have an active request or reservation for this book.';
  END IF;
  -- New dated requests enter the review queue; stock is not guaranteed.
  INSERT INTO public.borrow_requests (
    book_id, book_title, visitor_id, visitor_name, status,
    scheduled_pickup_date, queue_position
  ) VALUES (
    v_book.id, v_book.title, v_visitor.id, v_visitor.full_name,
    'pending_reservation', p_pickup_date, NULL
  ) RETURNING * INTO v_request;

  PERFORM public.create_visitor_notification(
    v_visitor.id,
    'borrow_request_created',
    'Reservation awaiting review',
    'Your reservation request for "' || v_book.title || '" on ' || p_pickup_date::text || ' is awaiting library staff approval.',
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
      AND request.status IN ('queued', 'pending_reservation', 'scheduled', 'ready_for_pickup', 'borrowed')
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
      AND NOT EXISTS (
        SELECT 1 FROM public.borrow_requests AS earlier
        WHERE earlier.book_id = request.book_id AND earlier.status = 'pending_reservation'
          AND (earlier.scheduled_pickup_date, earlier.request_date, earlier.id) < (request.scheduled_pickup_date, request.request_date, request.id)
      )
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
    IF v_next.status = 'scheduled' THEN
      PERFORM public.create_visitor_notification(v_next.visitor_id, 'borrow_ready_for_pickup', 'Book ready for pickup',
        'Your reserved book "' || v_next.book_title || '" is ready for pickup.',
        v_next.id::text, 'borrow_request', pg_catalog.now() + pg_catalog.interval '7 days');
    END IF;
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
    SELECT request.id, request.book_id, request.visitor_id, request.book_title
    FROM public.borrow_requests AS request
    WHERE request.status = 'scheduled'
      AND request.scheduled_pickup_date <= CURRENT_DATE
      AND NOT EXISTS (
        SELECT 1 FROM public.borrow_requests AS earlier
        WHERE earlier.book_id = request.book_id AND earlier.status = 'pending_reservation'
          AND (earlier.scheduled_pickup_date, earlier.request_date, earlier.id) < (request.scheduled_pickup_date, request.request_date, request.id)
      )
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
        PERFORM public.create_visitor_notification(v_request.visitor_id, 'borrow_ready_for_pickup', 'Book ready for pickup',
          'Your reserved book "' || v_request.book_title || '" is ready for pickup.',
          v_request.id::text, 'borrow_request', pg_catalog.now() + pg_catalog.interval '7 days');
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
  IF v_request.status NOT IN ('pending', 'queued', 'pending_reservation', 'scheduled', 'ready_for_pickup') THEN
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

CREATE OR REPLACE FUNCTION public.get_visitor_borrowing_history()
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
    CASE WHEN request.status IN ('pending_reservation','scheduled') AND request.scheduled_pickup_date IS NOT NULL THEN (
      SELECT pg_catalog.count(*)::integer FROM public.borrow_requests queued
      WHERE queued.book_id=request.book_id AND queued.status IN ('pending_reservation','scheduled')
      AND (queued.scheduled_pickup_date, queued.request_date, queued.id) <= (request.scheduled_pickup_date, request.request_date, request.id)
    ) ELSE request.queue_position END, request.borrow_date, request.due_date,
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


NOTIFY pgrst, 'reload schema';

CREATE OR REPLACE FUNCTION public.get_staff_scheduled_reservations()
RETURNS TABLE(id text, book_id text, book_title text, visitor_name text, scheduled_pickup_date date, status text, reservation_position bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $function$
DECLARE v_staff public.staff_profiles%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR auth.jwt() ->> 'aal' IS DISTINCT FROM 'aal2' THEN RAISE EXCEPTION 'Authenticated staff with AAL2 required.'; END IF;
  SELECT staff.* INTO v_staff FROM public.staff_profiles AS staff WHERE staff.id = auth.uid() AND staff.is_active IS TRUE;
  IF NOT FOUND OR v_staff.role NOT IN ('subadmin','superadmin') OR auth.jwt() -> 'app_metadata' ->> 'role' IS DISTINCT FROM v_staff.role THEN RAISE EXCEPTION 'Active staff account required.'; END IF;
  IF v_staff.role = 'subadmin' AND v_staff.library_id IS NULL THEN RAISE EXCEPTION 'No assigned library.'; END IF;
  RETURN QUERY SELECT request.id::text, request.book_id::text, request.book_title::text, request.visitor_name::text,
    request.scheduled_pickup_date, request.status::text,
    pg_catalog.row_number() OVER (PARTITION BY request.book_id ORDER BY request.scheduled_pickup_date, request.request_date, request.id)
  FROM public.borrow_requests request JOIN public.books book ON book.id = request.book_id
  WHERE request.status IN ('pending_reservation','scheduled') AND request.scheduled_pickup_date IS NOT NULL
    AND (v_staff.role = 'superadmin' OR book.library_id = v_staff.library_id)
  ORDER BY request.scheduled_pickup_date, request.request_date, request.id;
END; $function$;
ALTER FUNCTION public.get_staff_scheduled_reservations() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_staff_scheduled_reservations() FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.get_staff_scheduled_reservations() TO authenticated;

CREATE OR REPLACE FUNCTION public.decide_library_reservation(p_request_id text, p_decision text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE v_staff public.staff_profiles%ROWTYPE; v_request public.borrow_requests%ROWTYPE; v_library_id uuid;
BEGIN
  IF auth.uid() IS NULL OR auth.jwt() ->> 'aal' IS DISTINCT FROM 'aal2' THEN RAISE EXCEPTION 'Authenticated staff with AAL2 required.'; END IF;
  SELECT * INTO v_staff FROM public.staff_profiles WHERE id=auth.uid() AND is_active IS TRUE;
  IF NOT FOUND OR v_staff.role NOT IN ('subadmin','superadmin') OR auth.jwt() -> 'app_metadata' ->> 'role' IS DISTINCT FROM v_staff.role THEN RAISE EXCEPTION 'Active staff account required.'; END IF;
  IF p_decision IS NULL OR p_decision NOT IN ('approved','rejected') THEN RAISE EXCEPTION 'Choose approve or reject.'; END IF;
  SELECT request.* INTO v_request FROM public.borrow_requests request WHERE request.id::text = pg_catalog.btrim(p_request_id) FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Reservation not found.'; END IF;
  SELECT book.library_id INTO v_library_id FROM public.books book WHERE book.id = v_request.book_id;
  IF v_staff.role = 'subadmin' AND (v_staff.library_id IS NULL OR v_library_id IS DISTINCT FROM v_staff.library_id) THEN RAISE EXCEPTION 'Reservation belongs to another library.'; END IF;
  IF v_request.status <> 'pending_reservation' OR v_request.scheduled_pickup_date IS NULL THEN RAISE EXCEPTION 'This reservation is no longer awaiting review.'; END IF;
  UPDATE public.borrow_requests SET status = CASE WHEN p_decision='approved' THEN 'scheduled' ELSE 'rejected' END WHERE id = v_request.id;
  PERFORM public.create_visitor_notification(v_request.visitor_id,
    CASE WHEN p_decision='approved' THEN 'borrow_request_created' ELSE 'borrow_cancelled' END,
    CASE WHEN p_decision='approved' THEN 'Reservation approved' ELSE 'Reservation rejected' END,
    CASE WHEN p_decision='approved' THEN 'Your reservation for "' || v_request.book_title || '" was approved. Your place remains in the reservation queue for ' || v_request.scheduled_pickup_date::text || '. Pickup depends on availability.' ELSE 'Your reservation for "' || v_request.book_title || '" was rejected by library staff.' END,
    v_request.id::text,'borrow_request', pg_catalog.now() + pg_catalog.interval '30 days');
END; $function$;
ALTER FUNCTION public.decide_library_reservation(text,text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.decide_library_reservation(text,text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.decide_library_reservation(text,text) TO authenticated;
NOTIFY pgrst, 'reload schema';
COMMIT;
