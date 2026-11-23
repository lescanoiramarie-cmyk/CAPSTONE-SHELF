-- Expose existing subscription event details without changing records or access rules.
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

NOTIFY pgrst, 'reload schema';
COMMIT;
