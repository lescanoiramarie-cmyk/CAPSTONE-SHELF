BEGIN;

-- Preserve whether an active request began as a reservation after pickup dates
-- are cleared by the existing circulation workflow.
ALTER TABLE public.borrow_requests ADD COLUMN IF NOT EXISTS request_kind text NOT NULL DEFAULT 'borrow';
UPDATE public.borrow_requests AS request SET request_kind='reservation'
WHERE request.status IN ('pending_reservation','scheduled','rejected') AND request.scheduled_pickup_date IS NOT NULL;
UPDATE public.borrow_requests AS request SET request_kind='reservation'
WHERE request.status IN ('ready_for_pickup','borrowed','overdue') AND EXISTS (
  SELECT 1 FROM public.visitor_notifications notification
  WHERE notification.reference_id=request.id::text AND notification.reference_type='borrow_request'
    AND notification.title IN ('Reservation awaiting review', 'Reservation approved')
);

CREATE OR REPLACE FUNCTION shelf_private.enforce_visitor_circulation_limit()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE v_visitor public.visitors%ROWTYPE; v_active integer;
BEGIN
  IF NEW.status NOT IN ('pending','approved','queued','pending_reservation','scheduled','ready_for_pickup','borrowed','overdue') THEN RETURN NEW; END IF;
  NEW.request_kind := CASE WHEN NEW.status IN ('pending_reservation','scheduled') AND NEW.scheduled_pickup_date IS NOT NULL THEN 'reservation' ELSE 'borrow' END;
  SELECT visitor.* INTO v_visitor FROM public.visitors visitor
  WHERE visitor.id=NEW.visitor_id OR visitor.auth_user_id::text=NEW.visitor_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Visitor account could not be found.'; END IF;
  SELECT count(*)::integer INTO v_active FROM public.borrow_requests request
  WHERE request.visitor_id IN (v_visitor.id, v_visitor.auth_user_id::text)
    AND request.request_kind=NEW.request_kind
    AND request.status IN ('pending','approved','queued','pending_reservation','scheduled','ready_for_pickup','borrowed','overdue')
    AND request.return_date IS NULL;
  IF v_active >= 3 THEN
    RAISE EXCEPTION 'You can have up to 3 active % at a time. Complete or cancel one before making another request.',
      CASE WHEN NEW.request_kind='reservation' THEN 'reservations' ELSE 'borrow requests' END;
  END IF;
  RETURN NEW;
END; $function$;
ALTER FUNCTION shelf_private.enforce_visitor_circulation_limit() OWNER TO postgres;
REVOKE ALL ON FUNCTION shelf_private.enforce_visitor_circulation_limit() FROM PUBLIC, anon, authenticated, service_role;
DROP TRIGGER IF EXISTS enforce_visitor_circulation_limit ON public.borrow_requests;
CREATE TRIGGER enforce_visitor_circulation_limit BEFORE INSERT ON public.borrow_requests
FOR EACH ROW EXECUTE FUNCTION shelf_private.enforce_visitor_circulation_limit();

CREATE OR REPLACE FUNCTION public.decide_library_reservation(p_request_id text, p_decision text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE
  v_staff public.staff_profiles%ROWTYPE;
  v_request public.borrow_requests%ROWTYPE;
  v_library_id uuid;
  v_visitor_id text;
  v_type text;
  v_title text;
  v_message text;
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
  v_type := CASE WHEN p_decision='approved' THEN 'borrow_request_created' ELSE 'borrow_cancelled' END;
  v_title := CASE WHEN p_decision='approved' THEN 'Reservation approved' ELSE 'Reservation rejected' END;
  v_message := CASE WHEN p_decision='approved' THEN 'Your reservation for "' || v_request.book_title || '" was approved. Your place remains in the reservation queue for ' || v_request.scheduled_pickup_date::text || '. Pickup depends on availability.' ELSE 'Your reservation for "' || v_request.book_title || '" was rejected by library staff.' END;
  SELECT visitor.id INTO v_visitor_id FROM public.visitors visitor
  WHERE visitor.id = v_request.visitor_id OR visitor.auth_user_id::text = v_request.visitor_id LIMIT 1;
  UPDATE public.visitor_notifications SET title=v_title, message=v_message, read_at=NULL,
    created_at=pg_catalog.now(), expires_at=pg_catalog.now() + pg_catalog.interval '30 days'
  WHERE visitor_id=v_visitor_id AND notification_type=v_type AND reference_id=v_request.id::text AND reference_type='borrow_request';
  IF NOT FOUND THEN
    PERFORM public.create_visitor_notification(v_request.visitor_id, v_type, v_title, v_message,
      v_request.id::text, 'borrow_request', pg_catalog.now() + pg_catalog.interval '30 days');
  END IF;
END; $function$;
ALTER FUNCTION public.decide_library_reservation(text,text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.decide_library_reservation(text,text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.decide_library_reservation(text,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_staff_rejected_reservations()
RETURNS TABLE(id text, book_title text, visitor_name text, scheduled_pickup_date date, request_date timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $function$
DECLARE v_staff public.staff_profiles%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR auth.jwt() ->> 'aal' IS DISTINCT FROM 'aal2' THEN RAISE EXCEPTION 'Authenticated staff with AAL2 required.'; END IF;
  SELECT staff.* INTO v_staff FROM public.staff_profiles staff WHERE staff.id=auth.uid() AND staff.is_active IS TRUE;
  IF NOT FOUND OR v_staff.role NOT IN ('subadmin','superadmin') OR auth.jwt() -> 'app_metadata' ->> 'role' IS DISTINCT FROM v_staff.role THEN RAISE EXCEPTION 'Active staff account required.'; END IF;
  IF v_staff.role='subadmin' AND v_staff.library_id IS NULL THEN RAISE EXCEPTION 'No assigned library.'; END IF;
  RETURN QUERY SELECT request.id::text, request.book_title::text, request.visitor_name::text,
    request.scheduled_pickup_date, request.request_date
  FROM public.borrow_requests request JOIN public.books book ON book.id=request.book_id
  WHERE request.status='rejected' AND request.scheduled_pickup_date IS NOT NULL
    AND (v_staff.role='superadmin' OR book.library_id=v_staff.library_id)
  ORDER BY request.request_date DESC, request.id DESC;
END; $function$;
ALTER FUNCTION public.get_staff_rejected_reservations() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_staff_rejected_reservations() FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.get_staff_rejected_reservations() TO authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
