-- Seeded analytics rows are not real visitor actions. Avoid polluting the
-- audit history when the scripts replace their clearly marked test records.
CREATE OR REPLACE FUNCTION public.capture_shelf_audit_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $function$
DECLARE
  branch_value text;
  event_action text;
  event_details jsonb;
  request_row public.borrow_requests%ROWTYPE;
BEGIN
  IF TG_TABLE_NAME = 'borrow_requests' AND TG_OP = 'INSERT'
     AND NEW.confirmed_by = 'Test data seed'
     AND NEW.return_confirmed_by = 'Test data seed' THEN
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME = 'attendance_logs'
     AND TG_OP = 'DELETE'
     AND OLD.visitor_name LIKE '[TEST] %'
     AND OLD.visitor_id::text LIKE 'SYN-%' THEN
    RETURN OLD;
  END IF;

  IF TG_TABLE_NAME = 'borrow_requests' THEN
    IF TG_OP = 'DELETE'
       AND OLD.confirmed_by = 'Test data seed'
       AND OLD.return_confirmed_by = 'Test data seed' THEN
      RETURN OLD;
    END IF;

    IF TG_OP = 'DELETE' THEN
      request_row := OLD;
    ELSIF TG_OP IN ('INSERT', 'UPDATE') THEN
      request_row := NEW;
    ELSE
      RAISE EXCEPTION 'Unsupported audit operation % on %.', TG_OP, TG_TABLE_NAME;
    END IF;

    SELECT book.library_id::text INTO branch_value
    FROM public.books AS book
    WHERE book.id::text = request_row.book_id::text;
    event_action := 'circulation.borrow_request.' || pg_catalog.lower(TG_OP);
    event_details := pg_catalog.jsonb_build_object(
      'requestId', request_row.id,
      'bookId', request_row.book_id,
      'status', request_row.status,
      'fineAmount', request_row.fine_amount
    );
  ELSIF TG_TABLE_NAME = 'attendance_logs' THEN
    IF TG_OP = 'DELETE' THEN
      branch_value := OLD.library_id::text;
      event_details := pg_catalog.jsonb_build_object('attendanceId', OLD.id, 'visitorId', OLD.visitor_id);
    ELSIF TG_OP IN ('INSERT', 'UPDATE') THEN
      branch_value := NEW.library_id::text;
      event_details := pg_catalog.jsonb_build_object('attendanceId', NEW.id, 'visitorId', NEW.visitor_id);
    ELSE
      RAISE EXCEPTION 'Unsupported audit operation % on %.', TG_OP, TG_TABLE_NAME;
    END IF;
    event_action := CASE
      WHEN TG_OP = 'INSERT' THEN 'circulation.visitor.checked_in'
      ELSE 'circulation.visitor.checked_out'
    END;
  ELSIF TG_TABLE_NAME = 'books' THEN
    IF TG_OP = 'DELETE' THEN
      branch_value := OLD.library_id::text;
      event_details := pg_catalog.jsonb_build_object('bookId', OLD.id, 'title', OLD.title, 'isbn', OLD.isbn);
    ELSIF TG_OP IN ('INSERT', 'UPDATE') THEN
      branch_value := NEW.library_id::text;
      event_details := pg_catalog.jsonb_build_object('bookId', NEW.id, 'title', NEW.title, 'isbn', NEW.isbn);
    ELSE
      RAISE EXCEPTION 'Unsupported audit operation % on %.', TG_OP, TG_TABLE_NAME;
    END IF;
    event_action := 'inventory.book.' || pg_catalog.lower(TG_OP);
  ELSIF TG_TABLE_NAME = 'visitor_feedback' THEN
    IF TG_OP = 'DELETE' THEN
      branch_value := OLD.library_id::text;
      event_details := pg_catalog.jsonb_build_object('feedbackId', OLD.id, 'status', OLD.status, 'category', OLD.category);
    ELSIF TG_OP IN ('INSERT', 'UPDATE') THEN
      branch_value := NEW.library_id::text;
      event_details := pg_catalog.jsonb_build_object('feedbackId', NEW.id, 'status', NEW.status, 'category', NEW.category);
    ELSE
      RAISE EXCEPTION 'Unsupported audit operation % on %.', TG_OP, TG_TABLE_NAME;
    END IF;
    event_action := 'visitor_feedback.' || pg_catalog.lower(TG_OP);
  ELSIF TG_TABLE_NAME = 'announcements' THEN
    IF TG_OP = 'DELETE' THEN
      event_details := pg_catalog.jsonb_build_object('announcementId', OLD.id, 'title', OLD.title, 'published', OLD.published);
    ELSIF TG_OP IN ('INSERT', 'UPDATE') THEN
      event_details := pg_catalog.jsonb_build_object('announcementId', NEW.id, 'title', NEW.title, 'published', NEW.published);
    ELSE
      RAISE EXCEPTION 'Unsupported audit operation % on %.', TG_OP, TG_TABLE_NAME;
    END IF;
    event_action := 'announcement.' || pg_catalog.lower(TG_OP);
  ELSIF TG_TABLE_NAME = 'visitors' THEN
    branch_value := NULL;
    IF TG_OP = 'INSERT' THEN
      event_action := 'visitor.registration.created';
      event_details := pg_catalog.jsonb_build_object(
        'visitorId', NEW.id,
        'fullName', NEW.full_name,
        'email', NEW.email,
        'otpVerified', coalesce(NEW.otp_verified, false)
      );
    ELSIF TG_OP = 'UPDATE' AND TG_NAME = 'audit_visitor_verification' THEN
      IF coalesce(OLD.otp_verified, false) IS NOT DISTINCT FROM coalesce(NEW.otp_verified, false) THEN
        RAISE EXCEPTION 'Visitor verification audit trigger fired without a state change.';
      END IF;
      event_action := CASE
        WHEN coalesce(NEW.otp_verified, false) THEN 'visitor.registration.verified'
        ELSE 'visitor.registration.verification_revoked'
      END;
      event_details := pg_catalog.jsonb_build_object('visitorId', NEW.id, 'fullName', NEW.full_name, 'email', NEW.email);
    ELSIF TG_OP = 'UPDATE' AND TG_NAME = 'audit_visitor_active' THEN
      IF coalesce(OLD.is_active, true) IS NOT DISTINCT FROM coalesce(NEW.is_active, true) THEN
        RAISE EXCEPTION 'Visitor active-state audit trigger fired without a state change.';
      END IF;
      event_action := CASE
        WHEN coalesce(NEW.is_active, true) THEN 'visitor.account.enabled'
        ELSE 'visitor.account.disabled'
      END;
      event_details := pg_catalog.jsonb_build_object('visitorId', NEW.id, 'fullName', NEW.full_name, 'email', NEW.email);
    ELSIF TG_OP = 'DELETE' THEN
      event_action := 'visitor.registration.deleted';
      event_details := pg_catalog.jsonb_build_object('visitorId', OLD.id, 'fullName', OLD.full_name, 'email', OLD.email);
    ELSE
      RAISE EXCEPTION 'Unsupported visitor audit trigger operation % (%).', TG_OP, TG_NAME;
    END IF;
  ELSE
    RAISE EXCEPTION 'No audit mapping exists for table % and operation %.', TG_TABLE_NAME, TG_OP;
  END IF;

  IF event_action IS NULL OR pg_catalog.btrim(event_action) = ''
     OR event_details IS NULL
     OR pg_catalog.jsonb_typeof(event_details) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'Audit mapping produced an incomplete event for table % operation %.', TG_TABLE_NAME, TG_OP;
  END IF;

  IF event_action NOT IN (
    'visitor.registration.created', 'visitor.registration.verified',
    'visitor.registration.verification_revoked', 'visitor.account.enabled',
    'visitor.account.disabled', 'visitor.registration.deleted',
    'circulation.borrow_request.insert', 'circulation.borrow_request.update',
    'circulation.borrow_request.delete', 'circulation.visitor.checked_in',
    'circulation.visitor.checked_out', 'inventory.book.insert', 'inventory.book.update',
    'inventory.book.delete', 'visitor_feedback.insert', 'visitor_feedback.update',
    'visitor_feedback.delete', 'announcement.insert', 'announcement.update',
    'announcement.delete'
  ) THEN
    RAISE EXCEPTION 'Audit mapping produced an unsupported action for table % operation %.', TG_TABLE_NAME, TG_OP;
  END IF;

  INSERT INTO public.audit_logs(actor_id, action, branch_id, details)
  VALUES (auth.uid(), event_action, branch_value, event_details);

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.capture_shelf_audit_event() FROM PUBLIC, anon, authenticated;
