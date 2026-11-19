-- Migration 20270125000000_subscription_rpc_and_fine_alert_reconciliation.sql
-- Fixes:
-- 1. get_library_subscription_dashboard variable name conflict and qualified references.
-- 2. get_saved_community_books LEFT JOIN to public.visitors (matching id and auth_user_id).
-- 3. save_community_book_for_later and unsave_community_book_for_later visitor resolution.
-- 4. create_visitor_notification and respond_to_visitor_feedback visitor resolution.
-- 5. get_fine_payment_alert_targets_detail_internal Manila timezone visitor alert tracking.

-- 1. RECONCILE get_library_subscription_dashboard
CREATE OR REPLACE FUNCTION public.get_library_subscription_dashboard(
  p_library_id text DEFAULT NULL::text
)
RETURNS TABLE (
  library_id uuid,
  library_name text,
  assigned_subadmins text[],
  plan_key text,
  plan_mode text,
  billing_period text,
  starts_on date,
  renews_on date,
  grace_period_days integer,
  is_paid boolean,
  paid_at timestamptz,
  effective_status text,
  history jsonb,
  upgrade_requests jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
#variable_conflict use_column
DECLARE
  v_staff_role text;
  v_staff_library uuid;
  v_target_library uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  SELECT pg_catalog.lower(sp.role), sp.library_id
  INTO v_staff_role, v_staff_library
  FROM public.staff_profiles sp
  WHERE sp.id = auth.uid() AND sp.is_active IS TRUE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Active staff profile required.';
  END IF;

  IF v_staff_role NOT IN ('superadmin', 'subadmin') THEN
    RAISE EXCEPTION 'Insufficient permissions.';
  END IF;

  IF v_staff_role = 'subadmin' THEN
    IF v_staff_library IS NULL THEN
      RAISE EXCEPTION 'Sub-admin is not assigned to a library.';
    END IF;
    v_target_library := v_staff_library;
  ELSE
    IF p_library_id IS NOT NULL AND pg_catalog.btrim(p_library_id) <> '' THEN
      BEGIN
        v_target_library := p_library_id::uuid;
      EXCEPTION WHEN OTHERS THEN
        v_target_library := NULL;
      END;
    ELSE
      v_target_library := NULL;
    END IF;
  END IF;

  RETURN QUERY
  SELECT
    l.id AS library_id,
    l.name::text AS library_name,
    COALESCE(
      (SELECT array_agg(DISTINCT sp.full_name::text ORDER BY sp.full_name::text)
       FROM public.staff_profiles sp
       WHERE sp.library_id = l.id AND pg_catalog.lower(sp.role) = 'subadmin' AND sp.is_active IS TRUE),
      ARRAY[]::text[]
    ) AS assigned_subadmins,
    s.plan_key::text,
    s.plan_mode::text,
    s.billing_period::text,
    s.starts_on,
    s.renews_on,
    s.grace_period_days,
    COALESCE(s.is_paid, false) AS is_paid,
    s.paid_at,
    COALESCE(s.effective_status, 'trial')::text AS effective_status,
    COALESCE(
      (SELECT jsonb_agg(
                jsonb_build_object(
                  'id', h.id,
                  'plan_key', h.plan_key,
                  'plan_mode', h.plan_mode,
                  'billing_period', h.billing_period,
                  'status', h.status,
                  'changed_by', h.changed_by,
                  'created_at', h.created_at,
                  'notes', h.notes
                )
                ORDER BY h.created_at DESC
              )
       FROM public.library_subscription_history h
       WHERE h.library_id = l.id),
      '[]'::jsonb
    ) AS history,
    COALESCE(
      (SELECT jsonb_agg(
                jsonb_build_object(
                  'id', u.id,
                  'requested_plan', u.requested_plan,
                  'requested_period', u.requested_period,
                  'status', u.status,
                  'requested_by', u.requested_by,
                  'requested_at', u.requested_at,
                  'reviewed_by', u.reviewed_by,
                  'reviewed_at', u.reviewed_at,
                  'admin_notes', u.admin_notes
                )
                ORDER BY u.requested_at DESC
              )
       FROM public.subscription_upgrade_requests u
       WHERE u.library_id = l.id),
      '[]'::jsonb
    ) AS upgrade_requests
  FROM public.libraries l
  LEFT JOIN public.library_subscriptions s ON s.library_id = l.id
  WHERE (v_target_library IS NULL OR l.id = v_target_library)
  ORDER BY l.name ASC;
END;
$function$;

ALTER FUNCTION public.get_library_subscription_dashboard(text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_library_subscription_dashboard(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_library_subscription_dashboard(text) TO authenticated, service_role;

-- 2. RECONCILE get_saved_community_books
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
#variable_conflict use_column
DECLARE
  v_visitor_id text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  SELECT v.id INTO v_visitor_id
  FROM public.visitors v
  WHERE (v.auth_user_id = auth.uid() OR v.id = auth.uid()::text)
    AND v.is_active IS TRUE
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
    COALESCE(v.full_name, 'Community Member')::text AS owner_name,
    sb.saved_at AS saved_at
  FROM public.visitor_saved_community_books sb
  JOIN public.books b ON b.id = sb.community_book_id
  LEFT JOIN public.visitors v ON (v.id = b.owner_visitor_id OR v.auth_user_id::text = b.owner_visitor_id::text)
  WHERE sb.visitor_id = v_visitor_id
    AND b.is_public IS TRUE
    AND b.book_type = 'personal'
  ORDER BY sb.saved_at DESC;
END;
$function$;

ALTER FUNCTION public.get_saved_community_books() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_saved_community_books() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_saved_community_books() TO authenticated, service_role;

-- 3. RECONCILE save_community_book_for_later and unsave_community_book_for_later
CREATE OR REPLACE FUNCTION public.save_community_book_for_later(
  p_community_book_id text
)
RETURNS TABLE (success boolean, message text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_visitor_id text;
  v_book public.books%rowtype;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN QUERY SELECT false::boolean, 'Please sign in to save books.'::text;
    RETURN;
  END IF;

  SELECT id INTO v_visitor_id
  FROM public.visitors
  WHERE (auth_user_id = auth.uid() OR id = auth.uid()::text)
    AND is_active IS TRUE
  LIMIT 1;

  IF v_visitor_id IS NULL THEN
    RETURN QUERY SELECT false::boolean, 'Please sign in to save books.'::text;
    RETURN;
  END IF;

  SELECT * INTO v_book
  FROM public.books
  WHERE id = p_community_book_id
    AND book_type = 'personal'
    AND is_public IS TRUE;

  IF v_book IS NULL THEN
    RETURN QUERY SELECT false::boolean, 'Community book not found or not available for saving.'::text;
    RETURN;
  END IF;

  INSERT INTO public.visitor_saved_community_books (visitor_id, community_book_id)
  VALUES (v_visitor_id, p_community_book_id)
  ON CONFLICT (visitor_id, community_book_id) DO NOTHING;

  RETURN QUERY SELECT true::boolean, 'Book saved for later.'::text;
END;
$function$;

ALTER FUNCTION public.save_community_book_for_later(text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.save_community_book_for_later(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_community_book_for_later(text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.unsave_community_book_for_later(
  p_community_book_id text
)
RETURNS TABLE (success boolean, message text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_visitor_id text;
  v_deleted integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN QUERY SELECT false::boolean, 'Please sign in to unsave books.'::text;
    RETURN;
  END IF;

  SELECT id INTO v_visitor_id
  FROM public.visitors
  WHERE (auth_user_id = auth.uid() OR id = auth.uid()::text)
    AND is_active IS TRUE
  LIMIT 1;

  IF v_visitor_id IS NULL THEN
    RETURN QUERY SELECT false::boolean, 'Please sign in to unsave books.'::text;
    RETURN;
  END IF;

  DELETE FROM public.visitor_saved_community_books
  WHERE visitor_id = v_visitor_id
    AND community_book_id = p_community_book_id;

  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  IF v_deleted = 0 THEN
    RETURN QUERY SELECT false::boolean, 'Book was not in your saved list.'::text;
  ELSE
    RETURN QUERY SELECT true::boolean, 'Book removed from saved list.'::text;
  END IF;
END;
$function$;

ALTER FUNCTION public.unsave_community_book_for_later(text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.unsave_community_book_for_later(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.unsave_community_book_for_later(text) TO authenticated, service_role;

-- 4. RECONCILE create_visitor_notification and respond_to_visitor_feedback
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
    v_resolved_visitor_id text;
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

    SELECT id INTO v_resolved_visitor_id
    FROM public.visitors
    WHERE id = p_visitor_id OR auth_user_id::text = p_visitor_id
    LIMIT 1;

    IF v_resolved_visitor_id IS NULL THEN
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
        v_resolved_visitor_id,
        p_notification_type,
        p_title,
        p_message,
        p_reference_id,
        p_reference_type,
        p_expires_at
    )
    RETURNING id INTO v_notification_id;

    RETURN v_notification_id;
END;
$function$;

ALTER FUNCTION public.create_visitor_notification(text, text, text, text, text, text, timestamptz) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.create_visitor_notification(text, text, text, text, text, text, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_visitor_notification(text, text, text, text, text, text, timestamptz) TO service_role;

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
  v_resolved_visitor_id text;
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
    SELECT id INTO v_resolved_visitor_id
    FROM public.visitors
    WHERE id = v_feedback.visitor_id::text OR auth_user_id::text = v_feedback.visitor_id::text
    LIMIT 1;
  END IF;

  IF v_resolved_visitor_id IS NULL AND v_feedback.visitor_email IS NOT NULL THEN
    SELECT id INTO v_resolved_visitor_id
    FROM public.visitors
    WHERE email = v_feedback.visitor_email
    LIMIT 1;
  END IF;

  IF v_resolved_visitor_id IS NOT NULL THEN
    PERFORM public.create_visitor_notification(
      v_resolved_visitor_id,
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

-- 5. RECONCILE get_fine_payment_alert_targets (Visitor-scoped once-per-day alert tracking)
CREATE OR REPLACE FUNCTION public.get_fine_payment_alert_targets_detail_internal(p_library_id text DEFAULT NULL::text)
RETURNS TABLE (
  request_id text,
  visitor_id text,
  alerted_today boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
#variable_conflict use_column
DECLARE
  v_today_manila date;
BEGIN
  v_today_manila := (pg_catalog.timezone('Asia/Manila', pg_catalog.now()))::date;

  RETURN QUERY
  SELECT
    br.id::text AS request_id,
    br.visitor_id::text AS visitor_id,
    EXISTS (
      SELECT 1
      FROM public.due_date_notifications ddn
      WHERE (ddn.visitor_id = br.visitor_id OR ddn.borrow_request_id = br.id::text)
        AND ddn.notification_type = 'fine_reminder'
        AND (pg_catalog.timezone('Asia/Manila', ddn.sent_at))::date = v_today_manila
    ) AS alerted_today
  FROM public.borrow_requests br
  JOIN public.books b ON b.id = br.book_id
  WHERE br.status IN ('borrowed', 'returned')
    AND (p_library_id IS NULL OR b.library_id::text = p_library_id);
END;
$function$;

ALTER FUNCTION public.get_fine_payment_alert_targets_detail_internal(text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_fine_payment_alert_targets_detail_internal(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_fine_payment_alert_targets_detail_internal(text) TO authenticated, service_role;

-- Postflight assertions
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'get_library_subscription_dashboard'
  ) THEN
    RAISE EXCEPTION 'Postflight Failed: get_library_subscription_dashboard not found';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'get_saved_community_books'
  ) THEN
    RAISE EXCEPTION 'Postflight Failed: get_saved_community_books not found';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'save_community_book_for_later'
  ) THEN
    RAISE EXCEPTION 'Postflight Failed: save_community_book_for_later not found';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'unsave_community_book_for_later'
  ) THEN
    RAISE EXCEPTION 'Postflight Failed: unsave_community_book_for_later not found';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'create_visitor_notification'
  ) THEN
    RAISE EXCEPTION 'Postflight Failed: create_visitor_notification not found';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'respond_to_visitor_feedback'
  ) THEN
    RAISE EXCEPTION 'Postflight Failed: respond_to_visitor_feedback not found';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'get_fine_payment_alert_targets_detail_internal'
  ) THEN
    RAISE EXCEPTION 'Postflight Failed: get_fine_payment_alert_targets_detail_internal not found';
  END IF;
END $$;
