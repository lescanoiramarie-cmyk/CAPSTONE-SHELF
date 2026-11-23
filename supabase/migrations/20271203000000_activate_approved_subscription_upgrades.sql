BEGIN;
CREATE OR REPLACE FUNCTION public.request_subscription_upgrade(
  p_requested_plan text,
  p_note text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_staff public.staff_profiles%ROWTYPE;
  v_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authenticated sub-admin account required.';
  END IF;
  IF auth.jwt() ->> 'aal' IS DISTINCT FROM 'aal2' THEN
    RAISE EXCEPTION 'AAL2 authentication is required.';
  END IF;
  SELECT * INTO v_staff
  FROM public.staff_profiles
  WHERE id = auth.uid() AND is_active IS TRUE;
  IF NOT FOUND OR pg_catalog.lower(v_staff.role) <> 'subadmin' OR v_staff.library_id IS NULL THEN
    RAISE EXCEPTION 'Active assigned sub-admin account required.';
  END IF;
  IF auth.jwt() -> 'app_metadata' ->> 'role' IS DISTINCT FROM 'subadmin' THEN
    RAISE EXCEPTION 'Unauthorized staff role.';
  END IF;
  IF p_requested_plan IS NULL OR p_requested_plan <> 'premium' THEN
    RAISE EXCEPTION 'Only Premium upgrade requests are supported.';
  END IF;

  PERFORM 1 FROM public.libraries AS library
  WHERE library.id = v_staff.library_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Assigned library not found.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.subscription_upgrade_requests AS request
    WHERE request.library_id = v_staff.library_id AND request.status = 'pending'
  ) THEN
    RAISE EXCEPTION 'Your library already has a pending upgrade request.';
  END IF;
  INSERT INTO public.subscription_upgrade_requests (
    library_id, requested_by, requested_by_name, requested_plan, note
  ) VALUES (
    v_staff.library_id, v_staff.id,
    COALESCE(NULLIF(pg_catalog.btrim(v_staff.full_name), ''), v_staff.email),
    p_requested_plan, NULLIF(pg_catalog.btrim(p_note), '')
  ) RETURNING id INTO v_id;
  RETURN v_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.decide_subscription_upgrade(
  p_request_id uuid,
  p_decision text,
  p_note text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_staff public.staff_profiles%ROWTYPE;
  v_library_id uuid;
  v_requested_plan text;
  v_before jsonb;
  v_after jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authenticated super-admin account required.';
  END IF;
  IF auth.jwt() ->> 'aal' IS DISTINCT FROM 'aal2' THEN
    RAISE EXCEPTION 'AAL2 authentication is required.';
  END IF;
  SELECT * INTO v_staff FROM public.staff_profiles
  WHERE id = auth.uid() AND is_active IS TRUE;
  IF NOT FOUND OR pg_catalog.lower(v_staff.role) <> 'superadmin' THEN
    RAISE EXCEPTION 'Only a super-admin can decide upgrade requests.';
  END IF;
  IF auth.jwt() -> 'app_metadata' ->> 'role' IS DISTINCT FROM 'superadmin' THEN
    RAISE EXCEPTION 'Unauthorized staff role.';
  END IF;
  IF p_decision IS NULL OR p_decision NOT IN ('approved', 'rejected') THEN
    RAISE EXCEPTION 'Choose approve or reject.';
  END IF;
  SELECT request.library_id, request.requested_plan
    INTO v_library_id, v_requested_plan
  FROM public.subscription_upgrade_requests AS request
  WHERE request.id = p_request_id AND request.status = 'pending'
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pending upgrade request not found.';
  END IF;
  IF p_decision = 'approved' THEN
    IF v_requested_plan IS DISTINCT FROM 'premium' THEN
      RAISE EXCEPTION 'Only Premium upgrade requests can be approved; reject this request instead.';
    END IF;
    SELECT pg_catalog.to_jsonb(subscription) INTO v_before
      FROM public.library_subscriptions AS subscription
      WHERE subscription.library_id = v_library_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Set up a subscription for this library before approving the request.';
    END IF;
    IF v_before ->> 'plan_key' = 'premium' THEN
      RAISE EXCEPTION 'This library already has a Premium plan; reject the request instead.';
    END IF;
    IF v_before ->> 'plan_mode' = 'suspended'
      OR (v_before ->> 'renews_on')::date + (v_before ->> 'grace_period_days')::integer < CURRENT_DATE THEN
      RAISE EXCEPTION 'The subscription is suspended or expired. Resolve its status before approving the upgrade.';
    END IF;
    UPDATE public.library_subscriptions
    SET plan_key = 'premium', is_paid = false, paid_at = NULL,
        updated_by = v_staff.id, updated_at = pg_catalog.now()
    WHERE library_id = v_library_id
    RETURNING pg_catalog.to_jsonb(library_subscriptions) INTO v_after;
  END IF;

  UPDATE public.subscription_upgrade_requests
  SET status = p_decision,
      decision_by = v_staff.id,
      decision_by_name = COALESCE(NULLIF(pg_catalog.btrim(v_staff.full_name), ''), v_staff.email),
      decision_note = NULLIF(pg_catalog.btrim(p_note), ''),
      decided_at = pg_catalog.now()
  WHERE id = p_request_id;
  INSERT INTO public.library_subscription_events (
    library_id, event_type, details, changed_by, changed_by_name
  ) VALUES (
    v_library_id, 'upgrade_' || p_decision,
    pg_catalog.jsonb_build_object('requestId', p_request_id,
      'requestedPlan', v_requested_plan, 'note', NULLIF(pg_catalog.btrim(p_note), ''),
      'before', v_before, 'after', v_after),
    v_staff.id, COALESCE(NULLIF(pg_catalog.btrim(v_staff.full_name), ''), v_staff.email)
  );
END;
$function$;

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
    s.grace_period_days, COALESCE(s.is_paid,false), s.paid_at::timestamptz,
    CASE WHEN s.library_id IS NULL THEN 'not_configured' WHEN s.plan_mode = 'suspended' THEN 'suspended'
      WHEN s.plan_mode = 'trial' AND s.renews_on >= v_current_date THEN 'trial'
      WHEN v_current_date > s.renews_on + s.grace_period_days THEN 'suspended'
      WHEN v_current_date > s.renews_on THEN 'past_due' ELSE 'active' END::text,
    COALESCE((SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'id', h.id, 'event_type', h.event_type,
      'paid_at', h.details #>> '{after,paid_at}',
      'starts_on', h.details #>> '{after,starts_on}',
      'renews_on', h.details #>> '{after,renews_on}',
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
      'status', u.status, 'requested_by', u.requested_by, 'requested_by_name', u.requested_by_name,
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

NOTIFY pgrst, 'reload schema';
COMMIT;
