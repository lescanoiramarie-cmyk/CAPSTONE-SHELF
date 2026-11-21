-- Repair visitor RPCs and align subscription request JSON to the live schema.
BEGIN;

CREATE OR REPLACE FUNCTION public.get_library_subscription_dashboard(p_library_id text DEFAULT NULL::text)
RETURNS TABLE (
  library_id uuid, library_name text, assigned_subadmins text[], plan_key text, plan_mode text,
  billing_period text, starts_on date, renews_on date, grace_period_days integer,
  is_paid boolean, paid_at timestamptz, effective_status text, history jsonb, upgrade_requests jsonb
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE
  v_uid uuid := auth.uid(); v_staff_role text; v_staff_library uuid;
  v_target_library uuid; v_jwt_role text := auth.jwt() -> 'app_metadata' ->> 'role';
  v_library_id text := NULLIF(pg_catalog.btrim(p_library_id), '');
  v_current_date date := (pg_catalog.now())::date;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Authentication required.'; END IF;
  IF auth.jwt() ->> 'aal' IS DISTINCT FROM 'aal2' THEN RAISE EXCEPTION 'AAL2 authentication is required.'; END IF;
  SELECT pg_catalog.lower(pg_catalog.btrim(sp.role)), sp.library_id INTO v_staff_role, v_staff_library
  FROM public.staff_profiles AS sp WHERE sp.id = v_uid AND sp.is_active IS TRUE;
  IF NOT FOUND OR v_staff_role NOT IN ('superadmin','subadmin') THEN RAISE EXCEPTION 'Active staff profile required.'; END IF;
  IF v_jwt_role IS DISTINCT FROM v_staff_role THEN RAISE EXCEPTION 'Staff role claim does not match the active staff profile.'; END IF;
  IF v_staff_role = 'subadmin' THEN
    IF v_staff_library IS NULL THEN RAISE EXCEPTION 'Sub-admin is not assigned to a library.'; END IF;
    IF v_library_id IS NOT NULL AND v_library_id <> v_staff_library::text THEN RAISE EXCEPTION 'Access denied for requested library.'; END IF;
    v_target_library := v_staff_library;
  ELSIF v_library_id IS NOT NULL THEN
    IF v_library_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN RAISE EXCEPTION 'Invalid library ID format.'; END IF;
    v_target_library := v_library_id::uuid;
  END IF;
  RETURN QUERY
  SELECT l.id, l.name::text,
    COALESCE((SELECT pg_catalog.array_agg(DISTINCT sp.full_name::text ORDER BY sp.full_name::text)
      FROM public.staff_profiles AS sp WHERE sp.library_id = l.id AND pg_catalog.lower(sp.role) = 'subadmin' AND sp.is_active IS TRUE), ARRAY[]::text[]),
    s.plan_key::text, s.plan_mode::text, s.billing_period::text, s.starts_on, s.renews_on,
    s.grace_period_days, COALESCE(s.is_paid,false), s.paid_at,
    CASE WHEN s.library_id IS NULL THEN 'not_configured' WHEN s.plan_mode = 'suspended' THEN 'suspended'
      WHEN s.plan_mode = 'trial' AND s.renews_on >= v_current_date THEN 'trial'
      WHEN v_current_date > s.renews_on + s.grace_period_days THEN 'suspended'
      WHEN v_current_date > s.renews_on THEN 'past_due' ELSE 'active' END::text,
    COALESCE((SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'id', h.id,
      'plan_key', COALESCE(h.details #>> '{after,plan_key}', h.details ->> 'plan_key'),
      'plan_mode', COALESCE(h.details #>> '{after,plan_mode}', h.details ->> 'plan_mode'),
      'billing_period', COALESCE(h.details #>> '{after,billing_period}', h.details ->> 'billing_period'),
      'status', COALESCE(h.details #>> '{after,plan_mode}', h.details ->> 'status', h.event_type),
      'changed_by', h.changed_by_name, 'created_at', h.created_at,
      'notes', COALESCE(h.details ->> 'note', h.details #>> '{after,note}')
    ) ORDER BY h.created_at DESC) FROM public.library_subscription_events AS h WHERE h.library_id = l.id), '[]'::jsonb),
    COALESCE((SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'id', u.id, 'requested_plan', u.requested_plan,
      'requested_period', pg_catalog.to_jsonb(u) ->> 'requested_period',
      'status', u.status, 'requested_by', u.requested_by,
      'requested_at', COALESCE(pg_catalog.to_jsonb(u) ->> 'requested_at', pg_catalog.to_jsonb(u) ->> 'created_at'),
      'reviewed_by', COALESCE(pg_catalog.to_jsonb(u) ->> 'reviewed_by', pg_catalog.to_jsonb(u) ->> 'decision_by'),
      'reviewed_at', COALESCE(pg_catalog.to_jsonb(u) ->> 'reviewed_at', pg_catalog.to_jsonb(u) ->> 'decided_at'),
      'notes', COALESCE(pg_catalog.to_jsonb(u) ->> 'notes', pg_catalog.to_jsonb(u) ->> 'note', pg_catalog.to_jsonb(u) ->> 'decision_note')
    ) ORDER BY COALESCE(pg_catalog.to_jsonb(u) ->> 'requested_at', pg_catalog.to_jsonb(u) ->> 'created_at') DESC NULLS LAST)
      FROM public.subscription_upgrade_requests AS u WHERE u.library_id = l.id), '[]'::jsonb)
  FROM public.libraries AS l LEFT JOIN public.library_subscriptions AS s ON s.library_id = l.id
  WHERE v_target_library IS NULL OR l.id = v_target_library ORDER BY l.name ASC;
END;
$function$;
ALTER FUNCTION public.get_library_subscription_dashboard(text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_library_subscription_dashboard(text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.get_library_subscription_dashboard(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.add_personal_book_base(
  p_visitor_id text, p_title text, p_author text, p_category text, p_isbn text,
  p_summary text, p_condition text, p_lending_period_days integer,
  p_handover_method text, p_handover_details text, p_lending_enabled boolean,
  p_total_copies integer, p_is_public boolean
)
RETURNS public.books
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE book_row public.books%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.visitors AS visitor
    WHERE visitor.id::text = pg_catalog.btrim(p_visitor_id)
      AND visitor.auth_user_id = auth.uid()
      AND visitor.otp_verified IS TRUE AND visitor.is_active IS TRUE
  ) THEN RAISE EXCEPTION 'The authenticated, verified visitor account could not be found.'; END IF;
  IF NULLIF(pg_catalog.btrim(p_title), '') IS NULL OR NULLIF(pg_catalog.btrim(p_author), '') IS NULL THEN
    RAISE EXCEPTION 'Book title and author are required.';
  END IF;
  IF p_total_copies IS NULL OR p_total_copies < 1 THEN
    RAISE EXCEPTION 'Copy count must be a whole number of at least 1.';
  END IF;
  INSERT INTO public.books (
    title, author, category, isbn, summary, book_type, owner_visitor_id, is_public,
    lending_enabled, condition, lending_period_days, handover_method, handover_details,
    total_copies, available_copies
  ) VALUES (
    pg_catalog.btrim(p_title), pg_catalog.btrim(p_author), NULLIF(pg_catalog.btrim(p_category), ''),
    NULLIF(pg_catalog.btrim(p_isbn), ''), NULLIF(pg_catalog.btrim(p_summary), ''),
    'personal', pg_catalog.btrim(p_visitor_id), COALESCE(p_is_public, false),
    COALESCE(p_lending_enabled, false), NULLIF(pg_catalog.btrim(p_condition), ''),
    p_lending_period_days, NULLIF(pg_catalog.btrim(p_handover_method), ''),
    NULLIF(pg_catalog.btrim(p_handover_details), ''), p_total_copies, p_total_copies
  ) RETURNING * INTO book_row;
  RETURN book_row;
END;
$function$;
ALTER FUNCTION public.add_personal_book_base(text,text,text,text,text,text,text,integer,text,text,boolean,integer,boolean) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.add_personal_book_base(text,text,text,text,text,text,text,integer,text,text,boolean,integer,boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.add_personal_book_base(text,text,text,text,text,text,text,integer,text,text,boolean,integer,boolean) TO authenticated, service_role;

-- Existing review owners may edit their review even if historical loan data
-- no longer satisfies the current borrowed-and-returned eligibility query.
CREATE OR REPLACE FUNCTION public.save_my_book_review(
  p_book_id text, p_rating integer, p_comment text DEFAULT ''
)
RETURNS TABLE (id text, visitor_name text, rating integer, comment text, created_at timestamptz, is_own boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE
  v_visitor_count bigint;
  v_visitor_id text;
  v_visitor_name text;
  v_review_id text;
  v_eligible boolean := false;
BEGIN
  IF public.shelf_rpc_request_uid() IS NULL THEN RAISE EXCEPTION 'A signed-in visitor account is required.'; END IF;
  IF p_rating IS NULL OR p_rating < 1 OR p_rating > 5 THEN RAISE EXCEPTION 'Rating must be between 1 and 5.'; END IF;
  IF NULLIF(pg_catalog.btrim(p_book_id), '') IS NULL OR pg_catalog.length(COALESCE(p_comment, '')) > 4000 THEN
    RAISE EXCEPTION 'A valid book and review comment are required.';
  END IF;
  SELECT pg_catalog.count(*), pg_catalog.min(visitor.id::text), pg_catalog.min(visitor.full_name::text)
    INTO v_visitor_count, v_visitor_id, v_visitor_name
  FROM public.visitors AS visitor
  WHERE visitor.auth_user_id = public.shelf_rpc_request_uid()
    AND visitor.otp_verified IS TRUE AND visitor.is_active IS TRUE;
  IF v_visitor_count <> 1 THEN RAISE EXCEPTION 'An active, verified visitor profile linked to this session is required.'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.books AS book WHERE book.id::text = pg_catalog.btrim(p_book_id)) THEN
    RAISE EXCEPTION 'Book not found.';
  END IF;
  v_eligible := EXISTS (
    SELECT 1 FROM public.borrow_requests AS br
    WHERE br.visitor_id::text = v_visitor_id AND br.book_id::text = pg_catalog.btrim(p_book_id)
      AND br.status = 'returned' AND br.return_date IS NOT NULL
  ) OR EXISTS (
    SELECT 1 FROM public.community_book_requests AS cbr
    WHERE cbr.requester_visitor_id::text = v_visitor_id AND cbr.book_id::text = pg_catalog.btrim(p_book_id)
      AND cbr.status = 'returned' AND cbr.return_date IS NOT NULL
  ) OR EXISTS (
    SELECT 1 FROM public.book_reviews AS prior
    WHERE prior.visitor_id::text = v_visitor_id AND prior.book_id::text = pg_catalog.btrim(p_book_id)
  );
  IF NOT v_eligible THEN RAISE EXCEPTION 'You can only review books you have borrowed and returned.'; END IF;
  INSERT INTO public.book_reviews (book_id, visitor_id, visitor_name, rating, comment)
  VALUES (pg_catalog.btrim(p_book_id), v_visitor_id, v_visitor_name, p_rating, COALESCE(p_comment, ''))
  ON CONFLICT (book_id, visitor_id) DO UPDATE SET rating = EXCLUDED.rating, comment = EXCLUDED.comment
  RETURNING book_reviews.id::text INTO v_review_id;
  RETURN QUERY SELECT saved.id::text, 'Verified Reader'::text, saved.rating::integer, saved.comment, saved.created_at, true
  FROM public.book_reviews AS saved WHERE saved.id::text = v_review_id;
END;
$function$;
ALTER FUNCTION public.save_my_book_review(text,integer,text) OWNER TO shelf_book_reviews_rpc_owner;
REVOKE ALL ON FUNCTION public.save_my_book_review(text,integer,text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.save_my_book_review(text,integer,text) TO authenticated;

-- Serialize per visitor/day so simultaneous clicks cannot send two alerts.
CREATE OR REPLACE FUNCTION public.alert_visitor_fine_payment(p_borrow_request_id text)
RETURNS TABLE (success boolean, message text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE
  v_uid uuid := auth.uid(); v_role text; v_library_id uuid; v_loan record;
  v_book_library uuid; v_today_manila date; v_already_alerted boolean;
  v_now timestamptz := pg_catalog.now(); v_fine_balance numeric;
BEGIN
  IF v_uid IS NULL THEN RETURN QUERY SELECT false, 'Authentication required.'::text; RETURN; END IF;
  SELECT pg_catalog.lower(pg_catalog.btrim(staff.role)), staff.library_id INTO v_role, v_library_id
  FROM public.staff_profiles AS staff WHERE staff.id = v_uid AND staff.is_active IS TRUE;
  IF NOT FOUND OR v_role NOT IN ('subadmin','superadmin') THEN
    RETURN QUERY SELECT false, 'Active staff permissions required.'::text; RETURN;
  END IF;
  SELECT br.id, br.visitor_id, br.book_id, br.status, br.due_date, br.fine_amount, br.fine_paid_amount
    INTO v_loan FROM public.borrow_requests AS br WHERE br.id::text = p_borrow_request_id LIMIT 1;
  IF v_loan.id IS NULL THEN RETURN QUERY SELECT false, 'Fine record not found.'::text; RETURN; END IF;
  SELECT book.library_id INTO v_book_library FROM public.books AS book WHERE book.id = v_loan.book_id LIMIT 1;
  IF v_role = 'subadmin' AND (v_library_id IS NULL OR v_book_library <> v_library_id) THEN
    RETURN QUERY SELECT false, 'You can only alert visitors with fines from your assigned library.'::text; RETURN;
  END IF;
  v_today_manila := (pg_catalog.timezone('Asia/Manila', v_now))::date;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(v_loan.visitor_id::text), pg_catalog.hashtext(v_today_manila::text));
  SELECT EXISTS (
    SELECT 1 FROM public.due_date_notifications AS ddn
    WHERE ddn.visitor_id = v_loan.visitor_id::text
      AND ddn.notification_type = 'fine_reminder'
      AND (pg_catalog.timezone('Asia/Manila', ddn.sent_at))::date = v_today_manila
  ) INTO v_already_alerted;
  IF v_already_alerted THEN RETURN QUERY SELECT false, 'A fine alert was already sent to this visitor today.'::text; RETURN; END IF;
  INSERT INTO public.due_date_notifications (borrow_request_id, visitor_id, notification_type, sent_at)
  VALUES (v_loan.id::text, v_loan.visitor_id::text, 'fine_reminder', v_now);
  v_fine_balance := GREATEST(0, COALESCE(v_loan.fine_amount, 0) - COALESCE(v_loan.fine_paid_amount, 0));
  PERFORM public.create_visitor_notification(
    v_loan.visitor_id::text, 'fine_reminder', 'Outstanding Library Fine Reminder',
    'You have an outstanding fine balance' || CASE WHEN v_fine_balance > 0 THEN ' of ₱' || v_fine_balance::text ELSE '' END || ' for overdue library items. Please settle this with library staff.',
    v_loan.id::text, 'borrow_request', v_now + interval '30 days'
  );
  RETURN QUERY SELECT true, 'Fine reminder sent to visitor.'::text;
END;
$function$;
ALTER FUNCTION public.alert_visitor_fine_payment(text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.alert_visitor_fine_payment(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.alert_visitor_fine_payment(text) TO authenticated, service_role;

-- Ask PostgREST to refresh the exposed function signatures after this migration.
NOTIFY pgrst, 'reload schema';
COMMIT;
