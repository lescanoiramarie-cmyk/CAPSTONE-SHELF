-- Prevent synthetic seed cleanup from creating a second audit trail and from
-- repeatedly updating derived copy counts for each deleted test row.
CREATE OR REPLACE FUNCTION public.capture_shelf_audit_event()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  branch_value text;
  event_action text;
  event_details jsonb;
  request_row public.borrow_requests%rowtype;
BEGIN
  IF TG_TABLE_NAME = 'borrow_requests' AND TG_OP = 'DELETE'
     AND OLD.confirmed_by = 'Test data seed'
     AND OLD.return_confirmed_by = 'Test data seed' THEN
    RETURN OLD;
  END IF;
  IF TG_TABLE_NAME = 'borrow_requests' THEN
    IF TG_OP = 'DELETE' THEN request_row := OLD; ELSE request_row := NEW; END IF;
    SELECT library_id::text INTO branch_value FROM public.books WHERE id::text = request_row.book_id::text;
    event_action := 'circulation.borrow_request.' || lower(TG_OP);
    event_details := jsonb_build_object('requestId', request_row.id, 'bookId', request_row.book_id, 'status', request_row.status, 'fineAmount', request_row.fine_amount);
  ELSIF TG_TABLE_NAME = 'attendance_logs' THEN
    IF TG_OP = 'DELETE' THEN branch_value := OLD.library_id::text; ELSE branch_value := NEW.library_id::text; END IF;
    event_action := CASE WHEN TG_OP = 'INSERT' THEN 'circulation.visitor.checked_in' ELSE 'circulation.visitor.checked_out' END;
    event_details := jsonb_build_object('attendanceId', CASE WHEN TG_OP = 'DELETE' THEN OLD.id ELSE NEW.id END, 'visitorId', CASE WHEN TG_OP = 'DELETE' THEN OLD.visitor_id ELSE NEW.visitor_id END);
  ELSIF TG_TABLE_NAME = 'books' THEN
    IF TG_OP = 'DELETE' THEN branch_value := OLD.library_id::text; ELSE branch_value := NEW.library_id::text; END IF;
    event_action := 'inventory.book.' || lower(TG_OP);
    event_details := jsonb_build_object('bookId', CASE WHEN TG_OP = 'DELETE' THEN OLD.id ELSE NEW.id END, 'title', CASE WHEN TG_OP = 'DELETE' THEN OLD.title ELSE NEW.title END, 'isbn', CASE WHEN TG_OP = 'DELETE' THEN OLD.isbn ELSE NEW.isbn END);
  ELSIF TG_TABLE_NAME = 'visitor_feedback' THEN
    IF TG_OP = 'DELETE' THEN branch_value := OLD.library_id::text; ELSE branch_value := NEW.library_id::text; END IF;
    event_action := 'visitor_feedback.' || lower(TG_OP);
    event_details := jsonb_build_object('feedbackId', CASE WHEN TG_OP = 'DELETE' THEN OLD.id ELSE NEW.id END, 'status', CASE WHEN TG_OP = 'DELETE' THEN OLD.status ELSE NEW.status END, 'category', CASE WHEN TG_OP = 'DELETE' THEN OLD.category ELSE NEW.category END);
  ELSIF TG_TABLE_NAME = 'announcements' THEN
    event_action := 'announcement.' || lower(TG_OP);
    event_details := jsonb_build_object('announcementId', CASE WHEN TG_OP = 'DELETE' THEN OLD.id ELSE NEW.id END, 'title', CASE WHEN TG_OP = 'DELETE' THEN OLD.title ELSE NEW.title END, 'published', CASE WHEN TG_OP = 'DELETE' THEN OLD.published ELSE NEW.published END);
  END IF;
  INSERT INTO public.audit_logs(actor_id, action, branch_id, details) VALUES (auth.uid(), event_action, branch_value, coalesce(event_details, '{}'::jsonb));
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.capture_shelf_audit_event() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.maintain_borrowed_book_counts()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $$
DECLARE
  old_book_id text;
  new_book_id text;
  old_qualifies boolean := false;
  new_qualifies boolean := false;
BEGIN
  IF TG_OP = 'DELETE' AND OLD.confirmed_by = 'Test data seed'
     AND OLD.return_confirmed_by = 'Test data seed' THEN
    RETURN OLD;
  END IF;
  IF TG_OP <> 'INSERT' THEN
    old_qualifies := OLD.book_id IS NOT NULL AND (OLD.status IN ('borrowed', 'returned') OR OLD.borrow_date IS NOT NULL);
    old_book_id := OLD.book_id::text;
  END IF;
  IF TG_OP <> 'DELETE' THEN
    new_qualifies := NEW.book_id IS NOT NULL AND (NEW.status IN ('borrowed', 'returned') OR NEW.borrow_date IS NOT NULL);
    new_book_id := NEW.book_id::text;
  END IF;
  IF old_qualifies AND (NOT new_qualifies OR old_book_id IS DISTINCT FROM new_book_id) THEN
    DELETE FROM public.borrowed_book_counts WHERE book_id = old_book_id AND borrow_count = 1;
    UPDATE public.borrowed_book_counts SET borrow_count = borrow_count - 1 WHERE book_id = old_book_id AND borrow_count > 1;
  END IF;
  IF new_qualifies AND (NOT old_qualifies OR old_book_id IS DISTINCT FROM new_book_id) THEN
    INSERT INTO public.borrowed_book_counts (book_id, borrow_count) VALUES (new_book_id, 1)
    ON CONFLICT (book_id) DO UPDATE SET borrow_count = public.borrowed_book_counts.borrow_count + 1;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
GRANT EXECUTE ON FUNCTION public.maintain_borrowed_book_counts() TO postgres, service_role;
REVOKE ALL ON FUNCTION public.maintain_borrowed_book_counts() FROM anon, authenticated, PUBLIC;
