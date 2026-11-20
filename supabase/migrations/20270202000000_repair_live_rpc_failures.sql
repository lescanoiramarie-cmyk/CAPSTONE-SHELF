-- Repair live RPC bodies while preserving existing authorization and signatures.
BEGIN;

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
    WHERE visitor.id = pg_catalog.btrim(p_visitor_id)
      AND visitor.auth_user_id = auth.uid() AND visitor.otp_verified AND visitor.is_active
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
    'personal', pg_catalog.btrim(p_visitor_id), pg_catalog.coalesce(p_is_public, false),
    pg_catalog.coalesce(p_lending_enabled, false), NULLIF(pg_catalog.btrim(p_condition), ''),
    p_lending_period_days, NULLIF(pg_catalog.btrim(p_handover_method), ''),
    NULLIF(pg_catalog.btrim(p_handover_details), ''), p_total_copies, p_total_copies
  ) RETURNING * INTO book_row;
  RETURN book_row;
END;
$function$;
ALTER FUNCTION public.add_personal_book_base(text,text,text,text,text,text,text,integer,text,text,boolean,integer,boolean) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.add_personal_book_base(text,text,text,text,text,text,text,integer,text,text,boolean,integer,boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.add_personal_book_base(text,text,text,text,text,text,text,integer,text,text,boolean,integer,boolean) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.add_personal_book_with_cover_base(
  p_visitor_id text, p_title text, p_author text, p_category text, p_isbn text,
  p_summary text, p_condition text, p_lending_period_days integer,
  p_handover_method text, p_handover_details text, p_lending_enabled boolean,
  p_total_copies integer, p_is_public boolean, p_cover_url text
)
RETURNS public.books
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE book_row public.books%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.visitors AS visitor
    WHERE visitor.id::text = pg_catalog.btrim(p_visitor_id)
      AND visitor.auth_user_id = auth.uid() AND visitor.otp_verified AND visitor.is_active
  ) THEN RAISE EXCEPTION 'The authenticated, verified visitor account could not be found.'; END IF;
  book_row := public.add_personal_book_base(
    p_visitor_id,p_title,p_author,p_category,p_isbn,p_summary,p_condition,p_lending_period_days,
    p_handover_method,p_handover_details,p_lending_enabled,p_total_copies,p_is_public
  );
  UPDATE public.books SET cover_url = NULLIF(pg_catalog.btrim(p_cover_url), '')
  WHERE id = book_row.id AND book_type = 'personal'
    AND owner_visitor_id::text = pg_catalog.btrim(p_visitor_id)
  RETURNING * INTO book_row;
  IF NOT FOUND THEN RAISE EXCEPTION 'The personal book cover could not be saved.'; END IF;
  RETURN book_row;
END;
$function$;
ALTER FUNCTION public.add_personal_book_with_cover_base(text,text,text,text,text,text,text,integer,text,text,boolean,integer,boolean,text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.add_personal_book_with_cover_base(text,text,text,text,text,text,text,integer,text,text,boolean,integer,boolean,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.add_personal_book_with_cover_base(text,text,text,text,text,text,text,integer,text,text,boolean,integer,boolean,text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_library_subscription_dashboard(p_library_id text DEFAULT NULL::text)
RETURNS TABLE (
  library_id uuid, library_name text, assigned_subadmins text[], plan_key text, plan_mode text,
  billing_period text, starts_on date, renews_on date, grace_period_days integer,
  is_paid boolean, paid_at timestamptz, effective_status text, history jsonb, upgrade_requests jsonb
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_staff_role text;
  v_staff_library uuid;
  v_target_library uuid;
  v_jwt_role text := auth.jwt() -> 'app_metadata' ->> 'role';
  v_library_id text := NULLIF(pg_catalog.btrim(p_library_id), '');
  v_current_date date := (pg_catalog.now())::date;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Authentication required.'; END IF;
  IF auth.jwt() ->> 'aal' IS DISTINCT FROM 'aal2' THEN RAISE EXCEPTION 'AAL2 authentication is required.'; END IF;
  SELECT pg_catalog.lower(pg_catalog.btrim(sp.role)), sp.library_id INTO v_staff_role, v_staff_library
  FROM public.staff_profiles AS sp WHERE sp.id = v_uid AND sp.is_active IS TRUE;
  IF NOT FOUND OR v_staff_role NOT IN ('superadmin', 'subadmin') THEN RAISE EXCEPTION 'Active staff profile required.'; END IF;
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
    CASE WHEN s.library_id IS NULL THEN 'not_configured'
      WHEN s.plan_mode = 'suspended' THEN 'suspended'
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
      'id', u.id, 'requested_plan', u.requested_plan, 'requested_period', u.requested_period,
      'status', u.status, 'requested_by', u.requested_by, 'requested_at', u.created_at,
      'reviewed_by', u.reviewed_by, 'reviewed_at', u.reviewed_at, 'notes', u.notes
    ) ORDER BY u.created_at DESC) FROM public.subscription_upgrade_requests AS u WHERE u.library_id = l.id), '[]'::jsonb)
  FROM public.libraries AS l LEFT JOIN public.library_subscriptions AS s ON s.library_id = l.id
  WHERE v_target_library IS NULL OR l.id = v_target_library ORDER BY l.name ASC;
END;
$function$;
ALTER FUNCTION public.get_library_subscription_dashboard(text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_library_subscription_dashboard(text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.get_library_subscription_dashboard(text) TO authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
