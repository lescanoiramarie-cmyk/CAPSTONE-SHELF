-- ============================================================================
-- MIGRATION: 20270123000000_subscription_events_and_community_rpc_reconciliation.sql
-- PURPOSE:
--   1. Fix get_library_subscription_dashboard: change ORDER BY h.changed_at to ORDER BY h.created_at
--      on public.library_subscription_events (column changed_at does not exist).
--   2. Fix get_saved_community_books: cast all return fields explicitly to prevent
--      "structure of query does not match function result type" PL/pgSQL strict mismatch.
--   3. Create visitor notification trigger and RPC for feedback replies.
--   4. Allow active staff to read visitor profile images in storage for attendance kiosk.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. FIX get_library_subscription_dashboard
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.get_library_subscription_dashboard(text);

CREATE OR REPLACE FUNCTION public.get_library_subscription_dashboard(p_library_id text DEFAULT NULL::text)
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
DECLARE
  v_uid uuid := auth.uid();
  v_role text;
  v_staff_library uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authenticated staff session required.';
  END IF;

  SELECT pg_catalog.lower(pg_catalog.btrim(role)), library_id
    INTO v_role, v_staff_library
  FROM public.staff_profiles
  WHERE id = v_uid AND is_active IS TRUE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Active staff profile required.';
  END IF;

  IF v_role NOT IN ('superadmin', 'subadmin') THEN
    RAISE EXCEPTION 'Unsupported staff role.';
  END IF;

  IF v_role = 'subadmin' AND (p_library_id IS NOT NULL AND p_library_id <> v_staff_library::text) THEN
    RAISE EXCEPTION 'Access denied for requested library.';
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
    CASE
      WHEN s.library_id IS NULL THEN 'not_configured'
      WHEN s.plan_mode = 'suspended' THEN 'suspended'
      WHEN s.plan_mode = 'trial' AND s.renews_on >= pg_catalog.current_date THEN 'trial'
      WHEN pg_catalog.current_date > s.renews_on + s.grace_period_days THEN 'suspended'
      WHEN pg_catalog.current_date > s.renews_on THEN 'past_due'
      ELSE 'active'
    END::text AS effective_status,
    COALESCE(
      (SELECT jsonb_agg(row_to_json(h) ORDER BY h.created_at)
       FROM public.library_subscription_events h
       WHERE h.library_id = l.id),
      '[]'::jsonb
    ) AS history,
    COALESCE(
      (SELECT jsonb_agg(row_to_json(u) ORDER BY u.created_at)
       FROM public.subscription_upgrade_requests u
       WHERE u.library_id = l.id),
      '[]'::jsonb
    ) AS upgrade_requests
  FROM public.libraries l
  LEFT JOIN public.library_subscriptions s ON s.library_id = l.id
  WHERE (v_role = 'superadmin' OR l.id = v_staff_library)
    AND (p_library_id IS NULL OR l.id::text = p_library_id);
END;
$function$;

ALTER FUNCTION public.get_library_subscription_dashboard(text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_library_subscription_dashboard(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_library_subscription_dashboard(text) TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 2. FIX get_saved_community_books (EXPLICIT CASTS)
-- ----------------------------------------------------------------------------
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
  lending_period_days integer,
  handover_method text,
  handover_details text,
  fine_rate integer,
  cover_image_path text,
  owner_name text,
  saved_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_visitor_id uuid;
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
    b.total_copies::integer AS total_copies,
    b.lending_period_days::integer AS lending_period_days,
    b.handover_method::text AS handover_method,
    b.handover_details::text AS handover_details,
    b.fine_rate::integer AS fine_rate,
    b.cover_image_path::text AS cover_image_path,
    v.full_name::text AS owner_name,
    s.created_at AS saved_at
  FROM public.community_book_saves s
  JOIN public.community_books b ON b.id = s.community_book_id
  JOIN public.visitors v ON v.id = b.owner_visitor_id
  WHERE s.visitor_id = v_visitor_id
    AND b.is_public IS TRUE
  ORDER BY s.created_at DESC;
END;
$function$;

ALTER FUNCTION public.get_saved_community_books() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_saved_community_books() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_saved_community_books() TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 3. FEEDBACK REPLY NOTIFICATION TRIGGER & RPC
-- ----------------------------------------------------------------------------
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
      pg_catalog.json_build_object('feedback_id', NEW.id, 'category', NEW.category)::text,
      pg_catalog.now()
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
      pg_catalog.json_build_object('feedback_id', v_feedback.id, 'category', v_feedback.category, 'reply', v_reply)::text,
      v_now
    );
  END IF;

  RETURN pg_catalog.json_build_object(
    'success', true,
    'feedback_id', p_feedback_id,
    'status', 'answered',
    'replied_at', v_now
  )::jsonb;
END;
$function$;

ALTER FUNCTION public.respond_to_visitor_feedback(uuid, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.respond_to_visitor_feedback(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.respond_to_visitor_feedback(uuid, text) TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 4. STORAGE POLICY: ACTIVE STAFF CAN READ VISITOR PROFILE PHOTOS
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Active staff can read visitor profile images" ON storage.objects;
CREATE POLICY "Active staff can read visitor profile images"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'visitor-profile-images'
  AND EXISTS (
    SELECT 1
    FROM public.staff_profiles AS staff
    WHERE staff.id = auth.uid()
      AND staff.is_active IS TRUE
  )
);
