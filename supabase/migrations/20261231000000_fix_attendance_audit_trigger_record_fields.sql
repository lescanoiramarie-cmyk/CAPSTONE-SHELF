-- Keep borrow-request-only fields behind a table-specific branch. PostgreSQL
-- may evaluate boolean expressions in a different order, so a combined
-- TG_TABLE_NAME/TG_OP check can try to read OLD.confirmed_by from attendance.
CREATE OR REPLACE FUNCTION public.capture_shelf_audit_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  branch_value text;
  event_action text;
  event_details jsonb;
  request_row public.borrow_requests%ROWTYPE;
BEGIN
  IF TG_TABLE_NAME = 'borrow_requests' THEN
    IF TG_OP = 'DELETE'
       AND OLD.confirmed_by = 'Test data seed'
       AND OLD.return_confirmed_by = 'Test data seed' THEN
      RETURN OLD;
    END IF;

    IF TG_OP = 'DELETE' THEN
      request_row := OLD;
    ELSE
      request_row := NEW;
    END IF;
    SELECT library_id::text INTO branch_value
    FROM public.books
    WHERE id::text = request_row.book_id::text;
    event_action := 'circulation.borrow_request.' || lower(TG_OP);
    event_details := jsonb_build_object(
      'requestId', request_row.id,
      'bookId', request_row.book_id,
      'status', request_row.status,
      'fineAmount', request_row.fine_amount
    );
  ELSIF TG_TABLE_NAME = 'attendance_logs' THEN
    IF TG_OP = 'DELETE' THEN
      branch_value := OLD.library_id::text;
      event_details := jsonb_build_object('attendanceId', OLD.id, 'visitorId', OLD.visitor_id);
    ELSE
      branch_value := NEW.library_id::text;
      event_details := jsonb_build_object('attendanceId', NEW.id, 'visitorId', NEW.visitor_id);
    END IF;
    event_action := CASE
      WHEN TG_OP = 'INSERT' THEN 'circulation.visitor.checked_in'
      ELSE 'circulation.visitor.checked_out'
    END;
  ELSIF TG_TABLE_NAME = 'books' THEN
    IF TG_OP = 'DELETE' THEN
      branch_value := OLD.library_id::text;
      event_details := jsonb_build_object('bookId', OLD.id, 'title', OLD.title, 'isbn', OLD.isbn);
    ELSE
      branch_value := NEW.library_id::text;
      event_details := jsonb_build_object('bookId', NEW.id, 'title', NEW.title, 'isbn', NEW.isbn);
    END IF;
    event_action := 'inventory.book.' || lower(TG_OP);
  ELSIF TG_TABLE_NAME = 'visitor_feedback' THEN
    IF TG_OP = 'DELETE' THEN
      branch_value := OLD.library_id::text;
      event_details := jsonb_build_object('feedbackId', OLD.id, 'status', OLD.status, 'category', OLD.category);
    ELSE
      branch_value := NEW.library_id::text;
      event_details := jsonb_build_object('feedbackId', NEW.id, 'status', NEW.status, 'category', NEW.category);
    END IF;
    event_action := 'visitor_feedback.' || lower(TG_OP);
  ELSIF TG_TABLE_NAME = 'announcements' THEN
    IF TG_OP = 'DELETE' THEN
      event_details := jsonb_build_object('announcementId', OLD.id, 'title', OLD.title, 'published', OLD.published);
    ELSE
      event_details := jsonb_build_object('announcementId', NEW.id, 'title', NEW.title, 'published', NEW.published);
    END IF;
    event_action := 'announcement.' || lower(TG_OP);
  END IF;

  INSERT INTO public.audit_logs(actor_id, action, branch_id, details)
  VALUES (auth.uid(), event_action, branch_value, coalesce(event_details, '{}'::jsonb));

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.capture_shelf_audit_event()
  FROM PUBLIC, anon, authenticated;
