-- ----------------------------------------------------------------------------
-- MIGRATION: 20270124000000_reconcile_saved_community_books_and_notifications.sql
-- Purpose:
-- 1. Whitelist 'feedback_reply' in create_visitor_notification and fix expires_at
-- 2. Expand visitor_notifications table CHECK constraints for notification_type and reference_type
-- 3. Correct get_saved_community_books to query public.visitor_saved_community_books and public.books
-- 4. Fix fn_notify_visitor_on_feedback_reply and respond_to_visitor_feedback expiration
-- ----------------------------------------------------------------------------

-- 1. Update table CHECK constraints on public.visitor_notifications
ALTER TABLE public.visitor_notifications
    DROP CONSTRAINT IF EXISTS visitor_notifications_notification_type_check;

ALTER TABLE public.visitor_notifications
    ADD CONSTRAINT visitor_notifications_notification_type_check
    CHECK (notification_type IN (
        -- Borrowing lifecycle
        'borrow_request_created', 'borrow_request_queued', 'borrow_ready_for_pickup',
        'borrow_pickup_confirmed', 'borrow_due_soon', 'borrow_due_today', 'borrow_overdue',
        'borrow_return_confirmed', 'borrow_auto_cancelled', 'borrow_cancelled',
        -- Community book lifecycle
        'community_request_pending', 'community_request_approved', 'community_request_rejected',
        'community_pickup_confirmed', 'community_return_confirmed', 'community_due_soon',
        'community_due_today', 'community_overdue', 'community_cancelled',
        -- Announcements, fines, feedback
        'announcement', 'fine_reminder', 'feedback_reply'
    ));

ALTER TABLE public.visitor_notifications
    DROP CONSTRAINT IF EXISTS visitor_notifications_reference_type_check;

ALTER TABLE public.visitor_notifications
    ADD CONSTRAINT visitor_notifications_reference_type_check
    CHECK (
        reference_type IS NULL OR reference_type IN (
            'borrow_request',
            'community_book_request',
            'announcement',
            'visitor_feedback',
            'feedback'
        )
    );

-- 2. Update create_visitor_notification to include 'feedback_reply'
CREATE OR REPLACE FUNCTION public.create_visitor_notification(
    p_visitor_id text,
    p_notification_type text,
    p_title text,
    p_message text,
    p_reference_id text DEFAULT NULL,
    p_reference_type text DEFAULT NULL,
    p_expires_at timestamptz DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_notification_id uuid;
    v_caller text;
BEGIN
    v_caller := current_user;
    IF v_caller NOT IN ('service_role', 'postgres') THEN
        RAISE EXCEPTION 'Insufficient privilege: create_visitor_notification can only be called by internal functions or service_role.';
    END IF;

    IF p_notification_type NOT IN (
        'borrow_request_created', 'borrow_request_queued', 'borrow_ready_for_pickup',
        'borrow_pickup_confirmed', 'borrow_due_soon', 'borrow_due_today', 'borrow_overdue',
        'borrow_return_confirmed', 'borrow_auto_cancelled', 'borrow_cancelled',
        'community_request_pending', 'community_request_approved', 'community_request_rejected',
        'community_pickup_confirmed', 'community_return_confirmed', 'community_due_soon',
        'community_due_today', 'community_overdue', 'community_cancelled',
        'announcement', 'fine_reminder', 'feedback_reply'
    ) THEN
        RAISE EXCEPTION 'Invalid notification_type: %', p_notification_type;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM public.visitors WHERE id = p_visitor_id) THEN
        RAISE EXCEPTION 'Visitor not found: %', p_visitor_id;
    END IF;

    INSERT INTO public.visitor_notifications (
        visitor_id,
        notification_type,
        title,
        message,
        reference_id,
        reference_type,
        expires_at
    ) VALUES (
        p_visitor_id,
        p_notification_type,
        p_title,
        COALESCE(p_message, p_title, 'Notification'),
        p_reference_id,
        p_reference_type,
        p_expires_at
    )
    ON CONFLICT (visitor_id, notification_type, reference_id, reference_type) DO NOTHING
    RETURNING id INTO v_notification_id;

    RETURN v_notification_id;
END;
$function$;

ALTER FUNCTION public.create_visitor_notification(text, text, text, text, text, text, timestamptz) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.create_visitor_notification(text, text, text, text, text, text, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_visitor_notification(text, text, text, text, text, text, timestamptz) TO authenticated, service_role;

-- 3. Fix get_saved_community_books to query the actual tables: public.visitor_saved_community_books and public.books
DROP FUNCTION IF EXISTS public.get_saved_community_books();

CREATE OR REPLACE FUNCTION public.get_saved_community_books()
RETURNS TABLE (
  book_id text,
  owner_visitor_id text,
  title text,
  author text,
  category text,
  isbn text,
  summary text,
  condition text,
  total_copies integer,
  available_copies integer,
  lending_period_days integer,
  handover_method text,
  handover_details text,
  fine_rate integer,
  cover_url text,
  cover_image_path text,
  owner_name text,
  saved_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_visitor_id text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  SELECT v.id INTO v_visitor_id
  FROM public.visitors v
  WHERE v.auth_user_id = auth.uid()
    AND v.is_active IS TRUE
    AND v.otp_verified IS TRUE
  LIMIT 1;

  IF v_visitor_id IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    b.id::text AS book_id,
    b.owner_visitor_id::text AS owner_visitor_id,
    b.title::text AS title,
    b.author::text AS author,
    b.category::text AS category,
    b.isbn::text AS isbn,
    b.summary::text AS summary,
    b.condition::text AS condition,
    COALESCE(b.total_copies, 1)::integer AS total_copies,
    COALESCE(b.available_copies, 1)::integer AS available_copies,
    COALESCE(b.lending_period_days, 7)::integer AS lending_period_days,
    b.handover_method::text AS handover_method,
    b.handover_details::text AS handover_details,
    b.fine_rate::integer AS fine_rate,
    b.cover_url::text AS cover_url,
    b.cover_image_path::text AS cover_image_path,
    v.full_name::text AS owner_name,
    sb.saved_at AS saved_at
  FROM public.visitor_saved_community_books sb
  JOIN public.books b ON b.id = sb.community_book_id
  JOIN public.visitors v ON v.id = b.owner_visitor_id
  WHERE sb.visitor_id = v_visitor_id
    AND b.is_public IS TRUE
    AND b.book_type = 'personal'
  ORDER BY sb.saved_at DESC;
END;
$function$;

ALTER FUNCTION public.get_saved_community_books() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_saved_community_books() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_saved_community_books() TO authenticated, service_role;

-- 4. Fix fn_notify_visitor_on_feedback_reply and respond_to_visitor_feedback
CREATE OR REPLACE FUNCTION public.fn_notify_visitor_on_feedback_reply()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF NEW.admin_reply IS NOT NULL
     AND (OLD.admin_reply IS NULL OR OLD.admin_reply IS DISTINCT FROM NEW.admin_reply)
     AND NEW.visitor_id IS NOT NULL THEN
    PERFORM public.create_visitor_notification(
      NEW.visitor_id::text,
      'feedback_reply',
      'Library Replied to Your Feedback',
      'The library has replied to your feedback regarding "' || pg_catalog.substr(COALESCE(NEW.subject, 'General Feedback'), 1, 40) || '".',
      NEW.id::text,
      'visitor_feedback',
      pg_catalog.now() + interval '30 days'
    );
  END IF;
  RETURN NEW;
END;
$function$;

ALTER FUNCTION public.fn_notify_visitor_on_feedback_reply() OWNER TO postgres;

DROP TRIGGER IF EXISTS trg_notify_visitor_on_feedback_reply ON public.visitor_feedback;
CREATE TRIGGER trg_notify_visitor_on_feedback_reply
  AFTER UPDATE OF admin_reply ON public.visitor_feedback
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_notify_visitor_on_feedback_reply();

CREATE OR REPLACE FUNCTION public.respond_to_visitor_feedback(
  p_feedback_id uuid,
  p_reply text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_role text;
  v_library_id uuid;
  v_feedback RECORD;
  v_now timestamptz := pg_catalog.now();
  v_reply text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authenticated staff session required.';
  END IF;

  SELECT pg_catalog.lower(pg_catalog.btrim(role)), library_id
    INTO v_role, v_library_id
  FROM public.staff_profiles
  WHERE id = v_uid AND is_active IS TRUE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Active staff profile required.';
  END IF;

  IF v_role NOT IN ('subadmin', 'superadmin') THEN
    RAISE EXCEPTION 'Unsupported staff role.';
  END IF;

  v_reply := pg_catalog.btrim(COALESCE(p_reply, ''));
  IF pg_catalog.length(v_reply) < 3 THEN
    RAISE EXCEPTION 'Reply must be at least 3 characters long.';
  END IF;

  SELECT * INTO v_feedback
  FROM public.visitor_feedback
  WHERE id = p_feedback_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Feedback record not found.';
  END IF;

  IF v_role = 'subadmin' AND v_feedback.library_id IS NOT NULL AND v_feedback.library_id <> v_library_id THEN
    RAISE EXCEPTION 'You can only respond to feedback submitted to your assigned library.';
  END IF;

  UPDATE public.visitor_feedback
  SET admin_reply = v_reply,
      replied_by = (SELECT email FROM public.staff_profiles WHERE id = v_uid),
      replied_at = v_now,
      status = 'answered',
      updated_at = v_now
  WHERE id = p_feedback_id;

  IF v_feedback.visitor_id IS NOT NULL THEN
    PERFORM public.create_visitor_notification(
      v_feedback.visitor_id::text,
      'feedback_reply',
      'Library Replied to Your Feedback',
      'The library has replied to your feedback regarding "' || pg_catalog.substr(COALESCE(v_feedback.subject, 'General Feedback'), 1, 40) || '".',
      v_feedback.id::text,
      'visitor_feedback',
      v_now + interval '30 days'
    );
  END IF;

  RETURN pg_catalog.json_build_object(
    'success', true,
    'feedback_id', p_feedback_id,
    'status', 'answered',
    'replied_at', v_now
  );
END;
$function$;

ALTER FUNCTION public.respond_to_visitor_feedback(uuid, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.respond_to_visitor_feedback(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.respond_to_visitor_feedback(uuid, text) TO authenticated, service_role;
