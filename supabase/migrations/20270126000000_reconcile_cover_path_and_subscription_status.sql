-- ============================================================================
-- MIGRATION: 20270126000000_reconcile_cover_path_and_subscription_status.sql
-- PURPOSE:
--   1. Fix get_saved_community_books: select NULL::text AS cover_image_path
--      (column b.cover_image_path does not exist on public.books; cover is b.cover_url).
--   2. Fix get_library_subscription_dashboard: compute effective_status using CASE expression
--      (column s.effective_status does not exist on table public.library_subscriptions)
--      and query public.library_subscription_events h (not library_subscription_history).
--   3. Reconcile get_fine_payment_alert_targets: support both subadmin and superadmin,
--      delegating to get_fine_payment_alert_targets_detail_internal.
--   4. Implement mask_reviewer_name and update get_book_reviews to mask visitor names (e.g. Kyle Morcilla -> K*** M.).
--   5. Implement alert_visitor_fine_payment RPC for in-app fine reminders with once-per-day enforcement.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. RECONCILE get_saved_community_books
-- ----------------------------------------------------------------------------
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
    NULL::text AS cover_image_path,
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

-- ----------------------------------------------------------------------------
-- 2. RECONCILE get_library_subscription_dashboard
-- ----------------------------------------------------------------------------
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
    IF p_library_id IS NOT NULL AND pg_catalog.btrim(p_library_id) <> '' AND p_library_id <> v_staff_library::text THEN
      RAISE EXCEPTION 'Access denied for requested library.';
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
    CASE
      WHEN s.library_id IS NULL THEN 'not_configured'
      WHEN s.plan_mode = 'suspended' THEN 'suspended'
      WHEN s.plan_mode = 'trial' AND s.renews_on >= pg_catalog.current_date THEN 'trial'
      WHEN pg_catalog.current_date > s.renews_on + s.grace_period_days THEN 'suspended'
      WHEN pg_catalog.current_date > s.renews_on THEN 'past_due'
      ELSE 'active'
    END::text AS effective_status,
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
       FROM public.library_subscription_events h
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
                  'requested_at', u.created_at,
                  'reviewed_by', u.reviewed_by,
                  'reviewed_at', u.reviewed_at,
                  'notes', u.notes
                )
                ORDER BY u.created_at DESC
              )
       FROM public.subscription_upgrade_requests u
       WHERE u.library_id = l.id),
      '[]'::jsonb
    ) AS upgrade_requests
  FROM public.libraries l
  LEFT JOIN public.library_subscriptions s ON s.library_id = l.id
  WHERE v_target_library IS NULL OR l.id = v_target_library
  ORDER BY l.name ASC;
END;
$function$;

ALTER FUNCTION public.get_library_subscription_dashboard(text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_library_subscription_dashboard(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_library_subscription_dashboard(text) TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 3. RECONCILE get_fine_payment_alert_targets
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_fine_payment_alert_targets(p_library_id text DEFAULT NULL)
RETURNS TABLE (request_id text, visitor_id text, alerted_today boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_role text;
  v_library_id uuid;
  v_target_library_id text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authenticated staff account required.';
  END IF;

  SELECT pg_catalog.lower(pg_catalog.btrim(staff.role)), staff.library_id
    INTO v_role, v_library_id
  FROM public.staff_profiles AS staff
  WHERE staff.id = v_uid AND staff.is_active IS TRUE;

  IF NOT FOUND OR v_role NOT IN ('subadmin', 'superadmin') THEN
    RAISE EXCEPTION 'Active library staff account required.';
  END IF;

  IF v_role = 'subadmin' THEN
    IF v_library_id IS NULL THEN
      RAISE EXCEPTION 'Active Sub-Admin account with an assigned library required.';
    END IF;
    IF p_library_id IS NOT NULL AND pg_catalog.btrim(p_library_id) <> '' AND p_library_id <> v_library_id::text THEN
      RAISE EXCEPTION 'You can only view fine alerts for your assigned library.';
    END IF;
    v_target_library_id := v_library_id::text;
  ELSE
    v_target_library_id := NULLIF(pg_catalog.btrim(p_library_id), '');
  END IF;

  RETURN QUERY
  SELECT *
  FROM public.get_fine_payment_alert_targets_detail_internal(v_target_library_id);
END;
$function$;

ALTER FUNCTION public.get_fine_payment_alert_targets(text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_fine_payment_alert_targets(text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.get_fine_payment_alert_targets(text) TO authenticated;

-- ----------------------------------------------------------------------------
-- 4. REVIEWER NAME MASKING AND get_book_reviews
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mask_reviewer_name(p_name text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $function$
DECLARE
  v_trimmed text;
  v_parts text[];
  v_first text;
  v_last text;
  v_first_char text;
  v_last_char text;
BEGIN
  IF p_name IS NULL OR pg_catalog.btrim(p_name) = '' THEN
    RETURN 'Verified Reader';
  END IF;
  v_trimmed := pg_catalog.btrim(p_name);
  IF pg_catalog.lower(v_trimmed) = 'verified reader' THEN
    RETURN 'Verified Reader';
  END IF;
  v_parts := pg_catalog.regexp_split_to_array(v_trimmed, '\s+');
  IF pg_catalog.array_length(v_parts, 1) <= 1 THEN
    v_first := v_parts[1];
    v_first_char := pg_catalog.upper(pg_catalog.substr(v_first, 1, 1));
    RETURN v_first_char || '***';
  ELSE
    v_first := v_parts[1];
    v_last := v_parts[pg_catalog.array_length(v_parts, 1)];
    v_first_char := pg_catalog.upper(pg_catalog.substr(v_first, 1, 1));
    v_last_char := pg_catalog.upper(pg_catalog.substr(v_last, 1, 1));
    RETURN v_first_char || '*** ' || v_last_char || '.';
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_book_reviews(
    p_book_id text,
    p_limit integer DEFAULT 10,
    p_offset integer DEFAULT 0
)
RETURNS TABLE (
    id text,
    visitor_name text,
    rating integer,
    comment text,
    created_at timestamptz,
    is_own boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_caller_auth_uid uuid := public.shelf_rpc_request_uid();
    v_caller_visitor_id text;
BEGIN
    IF NULLIF(pg_catalog.btrim(p_book_id), '') IS NULL THEN
        RAISE EXCEPTION 'A valid book_id is required.';
    END IF;

    IF v_caller_auth_uid IS NOT NULL THEN
        SELECT visitor.id
          INTO v_caller_visitor_id
          FROM public.visitors AS visitor
         WHERE (visitor.auth_user_id = v_caller_auth_uid OR visitor.id = v_caller_auth_uid::text)
           AND visitor.otp_verified IS TRUE
           AND visitor.is_active IS TRUE
         LIMIT 1;
    END IF;

    RETURN QUERY
    SELECT review.id::text,
        public.mask_reviewer_name(COALESCE(v.full_name, 'Verified Reader'))::text AS visitor_name,
        review.rating::integer,
        review.comment,
        review.created_at,
        (v_caller_visitor_id IS NOT NULL AND review.visitor_id = v_caller_visitor_id) AS is_own
    FROM public.book_reviews AS review
    LEFT JOIN public.visitors AS v ON v.id = review.visitor_id
    WHERE review.book_id = p_book_id
    ORDER BY review.created_at DESC
    LIMIT LEAST(GREATEST(p_limit, 1), 50)
    OFFSET GREATEST(p_offset, 0);
END;
$function$;

ALTER FUNCTION public.get_book_reviews(text, integer, integer) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_book_reviews(text, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_book_reviews(text, integer, integer) TO anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 5. RPC: alert_visitor_fine_payment
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.alert_visitor_fine_payment(
  p_borrow_request_id text
)
RETURNS TABLE (success boolean, message text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_role text;
  v_library_id uuid;
  v_loan RECORD;
  v_book_library uuid;
  v_today_manila date;
  v_already_alerted boolean;
  v_now timestamptz := pg_catalog.now();
  v_fine_balance numeric;
BEGIN
  IF v_uid IS NULL THEN
    RETURN QUERY SELECT false, 'Authentication required.'::text;
    RETURN;
  END IF;

  SELECT pg_catalog.lower(pg_catalog.btrim(staff.role)), staff.library_id
    INTO v_role, v_library_id
  FROM public.staff_profiles AS staff
  WHERE staff.id = v_uid AND staff.is_active IS TRUE;

  IF NOT FOUND OR v_role NOT IN ('subadmin', 'superadmin') THEN
    RETURN QUERY SELECT false, 'Active staff permissions required.'::text;
    RETURN;
  END IF;

  SELECT br.id, br.visitor_id, br.book_id, br.status, br.due_date, br.fine_amount, br.fine_paid_amount
    INTO v_loan
  FROM public.borrow_requests br
  WHERE br.id::text = p_borrow_request_id
  LIMIT 1;

  IF v_loan.id IS NULL THEN
    RETURN QUERY SELECT false, 'Fine record not found.'::text;
    RETURN;
  END IF;

  SELECT b.library_id INTO v_book_library
  FROM public.books b
  WHERE b.id = v_loan.book_id
  LIMIT 1;

  IF v_role = 'subadmin' AND (v_library_id IS NULL OR v_book_library <> v_library_id) THEN
    RETURN QUERY SELECT false, 'You can only alert visitors with fines from your assigned library.'::text;
    RETURN;
  END IF;

  v_today_manila := (pg_catalog.timezone('Asia/Manila', v_now))::date;

  SELECT EXISTS (
    SELECT 1
    FROM public.due_date_notifications ddn
    WHERE (ddn.visitor_id = v_loan.visitor_id::text OR ddn.borrow_request_id = v_loan.id::text)
      AND ddn.notification_type = 'fine_reminder'
      AND (pg_catalog.timezone('Asia/Manila', ddn.sent_at))::date = v_today_manila
  ) INTO v_already_alerted;

  IF v_already_alerted THEN
    RETURN QUERY SELECT false, 'A fine alert was already sent for this loan today.'::text;
    RETURN;
  END IF;

  -- Record claim in due_date_notifications
  INSERT INTO public.due_date_notifications (
    borrow_request_id,
    visitor_id,
    notification_type,
    sent_at
  ) VALUES (
    v_loan.id::text,
    v_loan.visitor_id::text,
    'fine_reminder',
    v_now
  );

  v_fine_balance := GREATEST(0, COALESCE(v_loan.fine_amount, 0) - COALESCE(v_loan.fine_paid_amount, 0));

  -- Insert in-app visitor notification
  PERFORM public.create_visitor_notification(
    v_loan.visitor_id::text,
    'fine_reminder',
    'Outstanding Library Fine Reminder',
    'You have an outstanding fine balance' || CASE WHEN v_fine_balance > 0 THEN ' of ₱' || v_fine_balance::text ELSE '' END || ' for overdue library items. Please settle this with library staff.',
    v_loan.id::text,
    'borrow_request',
    v_now + interval '30 days'
  );

  RETURN QUERY SELECT true, 'Fine reminder sent to visitor.'::text;
END;
$function$;

ALTER FUNCTION public.alert_visitor_fine_payment(text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.alert_visitor_fine_payment(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.alert_visitor_fine_payment(text) TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- POSTFLIGHT ASSERTIONS
-- ----------------------------------------------------------------------------
DO $$
BEGIN
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
    WHERE n.nspname = 'public' AND p.proname = 'get_library_subscription_dashboard'
  ) THEN
    RAISE EXCEPTION 'Postflight Failed: get_library_subscription_dashboard not found';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'get_fine_payment_alert_targets'
  ) THEN
    RAISE EXCEPTION 'Postflight Failed: get_fine_payment_alert_targets not found';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'mask_reviewer_name'
  ) THEN
    RAISE EXCEPTION 'Postflight Failed: mask_reviewer_name not found';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'alert_visitor_fine_payment'
  ) THEN
    RAISE EXCEPTION 'Postflight Failed: alert_visitor_fine_payment not found';
  END IF;
END $$;
