BEGIN;

-- Keep legacy fine anomalies reviewable, then retain the decision and actor.
ALTER TABLE public.borrow_requests
  ADD COLUMN IF NOT EXISTS fine_review_resolved_at timestamptz,
  ADD COLUMN IF NOT EXISTS fine_review_note text;

CREATE TABLE IF NOT EXISTS public.fine_review_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  borrow_request_id text NOT NULL,
  decision text NOT NULL CHECK (decision IN ('confirmed', 'adjusted', 'waived')),
  previous_amount numeric NOT NULL DEFAULT 0,
  approved_amount numeric NOT NULL CHECK (approved_amount >= 0),
  note text NOT NULL,
  reviewed_by uuid NOT NULL REFERENCES public.staff_profiles(id) ON DELETE RESTRICT,
  reviewed_by_name text NOT NULL,
  reviewed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS fine_review_events_request_time_idx
  ON public.fine_review_events (borrow_request_id, reviewed_at DESC);
ALTER TABLE public.fine_review_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.fine_review_events FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.resolve_fine_review(
  p_request_id text,
  p_decision text,
  p_approved_amount numeric,
  p_note text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_staff public.staff_profiles%ROWTYPE;
  v_request public.borrow_requests%ROWTYPE;
  v_library_id uuid;
  v_previous_amount numeric;
  v_approved_amount numeric;
  v_event_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authenticated staff account required.'; END IF;
  SELECT * INTO v_staff FROM public.staff_profiles WHERE id = auth.uid() AND is_active IS TRUE;
  IF NOT FOUND OR lower(v_staff.role) NOT IN ('superadmin', 'subadmin') THEN
    RAISE EXCEPTION 'Active staff profile required.';
  END IF;
  IF auth.jwt() -> 'app_metadata' ->> 'role' IS NOT NULL
     AND auth.jwt() -> 'app_metadata' ->> 'role' <> lower(v_staff.role) THEN
    RAISE EXCEPTION 'Unauthorized staff role.';
  END IF;
  IF p_decision NOT IN ('confirmed', 'adjusted', 'waived') THEN
    RAISE EXCEPTION 'Choose confirm, adjust, or waive.';
  END IF;
  IF NULLIF(btrim(p_note), '') IS NULL THEN RAISE EXCEPTION 'A review note is required.'; END IF;
  IF p_decision = 'waived' AND lower(v_staff.role) <> 'superadmin' THEN
    RAISE EXCEPTION 'Only a super-admin can waive a fine.';
  END IF;

  SELECT br.* INTO v_request
  FROM public.borrow_requests br
  WHERE br.id::text = btrim(p_request_id)
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Borrow request not found.'; END IF;
  SELECT b.library_id INTO v_library_id FROM public.books b WHERE b.id::text = v_request.book_id::text;
  IF lower(v_staff.role) = 'subadmin'
     AND (v_library_id IS NULL OR v_library_id <> v_staff.library_id) THEN
    RAISE EXCEPTION 'You can only review fines for your assigned library.';
  END IF;
  IF NOT COALESCE(v_request.fine_review_required, false)
     AND v_request.fine_review_resolved_at IS NOT NULL THEN
    RAISE EXCEPTION 'This fine has already been reviewed.';
  END IF;

  v_previous_amount := greatest(COALESCE(v_request.fine_amount, 0), 0);
  IF p_decision = 'waived' THEN
    v_approved_amount := 0;
  ELSIF p_decision = 'confirmed' THEN
    v_approved_amount := COALESCE(p_approved_amount, v_previous_amount);
  ELSE
    v_approved_amount := p_approved_amount;
  END IF;
  IF v_approved_amount IS NULL OR v_approved_amount < 0 THEN
    RAISE EXCEPTION 'Enter a valid approved fine amount.';
  END IF;

  UPDATE public.borrow_requests
  SET fine_amount = v_approved_amount,
      fine_review_required = false,
      fine_review_resolved_at = now(),
      fine_review_note = btrim(p_note),
      fine_rate_snapshot = NULL
  WHERE id::text = v_request.id::text;

  INSERT INTO public.fine_review_events (
    borrow_request_id, decision, previous_amount, approved_amount, note,
    reviewed_by, reviewed_by_name
  ) VALUES (
    v_request.id::text, p_decision, v_previous_amount, v_approved_amount,
    btrim(p_note), v_staff.id,
    COALESCE(NULLIF(btrim(v_staff.full_name), ''), v_staff.email)
  ) RETURNING id INTO v_event_id;

  RETURN jsonb_build_object('reviewId', v_event_id, 'approvedAmount', v_approved_amount);
END;
$function$;

ALTER FUNCTION public.resolve_fine_review(text, text, numeric, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.resolve_fine_review(text, text, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolve_fine_review(text, text, numeric, text) TO authenticated, service_role;

-- Existing dashboard RPC returns the same shape; calculate review state from
-- the explicit review marker as well as the legacy flag.
CREATE OR REPLACE FUNCTION public.get_fine_payment_dashboard(p_library_id text DEFAULT NULL)
RETURNS TABLE (
  request_id text,
  visitor_name text,
  book_title text,
  library_id text,
  library_name text,
  borrow_date timestamptz,
  due_date timestamptz,
  request_status text,
  fine_amount numeric,
  fine_paid_amount numeric,
  outstanding_amount numeric,
  fine_review_required boolean,
  payments jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_role text;
  v_library_id uuid;
  v_jwt_role text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authenticated staff account required.'; END IF;
  SELECT lower(sp.role), sp.library_id INTO v_role, v_library_id
  FROM public.staff_profiles sp
  WHERE sp.id = auth.uid() AND sp.is_active IS TRUE;
  IF NOT FOUND OR v_role NOT IN ('superadmin', 'subadmin') THEN RAISE EXCEPTION 'Active staff profile required.'; END IF;
  v_jwt_role := auth.jwt() -> 'app_metadata' ->> 'role';
  IF v_jwt_role IS NOT NULL AND v_jwt_role <> v_role THEN RAISE EXCEPTION 'Unauthorized staff role.'; END IF;
  IF v_role = 'subadmin' AND p_library_id IS NOT NULL AND p_library_id <> v_library_id::text THEN
    RAISE EXCEPTION 'You can only view fines for your assigned library.';
  END IF;

  RETURN QUERY
  WITH requests AS (
    SELECT br.id::text AS request_id,
      COALESCE(br.visitor_name, 'Visitor')::text AS visitor_name,
      COALESCE(br.book_title, b.title, 'Book')::text AS book_title,
      b.library_id::text AS library_id,
      COALESCE(l.name, 'Unassigned library')::text AS library_name,
      br.borrow_date, br.due_date, br.status::text AS request_status,
      CASE WHEN br.status = 'borrowed' AND br.due_date < now()
                 AND br.fine_rate_snapshot BETWEEN 1 AND 100
        THEN ceil(extract(epoch FROM (now() - br.due_date)) / 86400) * br.fine_rate_snapshot
        ELSE greatest(COALESCE(br.fine_amount, 0), 0) END::numeric AS fine_amount,
      greatest(COALESCE(br.fine_paid_amount, 0), 0)::numeric AS fine_paid_amount,
      CASE WHEN br.fine_review_resolved_at IS NOT NULL THEN false
        ELSE (COALESCE(br.fine_review_required, false)
          OR (br.status IN ('borrowed', 'returned')
            AND (br.fine_rate_snapshot IS NULL OR br.fine_rate_snapshot NOT BETWEEN 1 AND 100)))
        END AS fine_review_required
    FROM public.borrow_requests br
    LEFT JOIN public.books b ON b.id::text = br.book_id::text
    LEFT JOIN public.libraries l ON l.id = b.library_id
    WHERE br.status IN ('borrowed', 'returned')
      AND (br.due_date IS NOT NULL OR COALESCE(br.fine_amount, 0) > 0)
      AND (v_role = 'superadmin' OR b.library_id = v_library_id)
      AND (p_library_id IS NULL OR b.library_id::text = p_library_id)
  )
  SELECT r.request_id, r.visitor_name, r.book_title, r.library_id, r.library_name,
    r.borrow_date, r.due_date, r.request_status, r.fine_amount, r.fine_paid_amount,
    greatest(r.fine_amount - r.fine_paid_amount, 0)::numeric,
    r.fine_review_required,
    COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'id', fp.id, 'amount', fp.amount, 'paymentMethod', fp.payment_method,
      'referenceNumber', fp.reference_number, 'note', fp.note,
      'receivedBy', fp.received_by_name, 'receivedAt', fp.received_at
    ) ORDER BY fp.received_at DESC) FROM public.fine_payments fp
      WHERE fp.borrow_request_id = r.request_id), '[]'::jsonb)
  FROM requests r
  WHERE r.fine_amount > 0 OR r.fine_review_required
  ORDER BY (r.fine_amount - r.fine_paid_amount) DESC, r.due_date ASC NULLS LAST;
END;
$function$;
ALTER FUNCTION public.get_fine_payment_dashboard(text) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION public.get_fine_payment_dashboard(text) TO authenticated, service_role;

-- One subscription belongs to a library; its assigned sub-admins share the
-- same plan and renewal. Payment method, reference, and amount are not stored.
CREATE TABLE IF NOT EXISTS public.library_subscriptions (
  library_id uuid PRIMARY KEY REFERENCES public.libraries(id) ON DELETE CASCADE,
  plan_key text NOT NULL CHECK (plan_key IN ('basic', 'premium')),
  plan_mode text NOT NULL DEFAULT 'active' CHECK (plan_mode IN ('trial', 'active', 'suspended')),
  billing_period text NOT NULL DEFAULT 'monthly' CHECK (billing_period IN ('monthly', 'annual')),
  starts_on date NOT NULL DEFAULT current_date,
  renews_on date NOT NULL,
  grace_period_days integer NOT NULL DEFAULT 7 CHECK (grace_period_days BETWEEN 0 AND 60),
  is_paid boolean NOT NULL DEFAULT false,
  paid_at date,
  updated_by uuid REFERENCES public.staff_profiles(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.library_subscription_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  library_id uuid NOT NULL REFERENCES public.libraries(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  changed_by uuid REFERENCES public.staff_profiles(id) ON DELETE SET NULL,
  changed_by_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS library_subscription_events_history_idx
  ON public.library_subscription_events (library_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.subscription_upgrade_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  library_id uuid NOT NULL REFERENCES public.libraries(id) ON DELETE CASCADE,
  requested_by uuid NOT NULL REFERENCES public.staff_profiles(id) ON DELETE RESTRICT,
  requested_by_name text NOT NULL,
  requested_plan text NOT NULL CHECK (requested_plan IN ('basic', 'premium')),
  note text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  decision_by uuid REFERENCES public.staff_profiles(id) ON DELETE SET NULL,
  decision_by_name text,
  decision_note text,
  requested_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS subscription_one_pending_upgrade_per_library_idx
  ON public.subscription_upgrade_requests (library_id) WHERE status = 'pending';

ALTER TABLE public.library_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.library_subscription_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscription_upgrade_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.library_subscriptions, public.library_subscription_events,
  public.subscription_upgrade_requests FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_library_subscription_dashboard(p_library_id text DEFAULT NULL)
RETURNS TABLE (
  library_id text, library_name text, sub_admin_names text[], plan_key text,
  plan_mode text, billing_period text, starts_on date, renews_on date,
  grace_period_days integer, is_paid boolean, paid_at date, effective_status text,
  subscription_history jsonb, upgrade_requests jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_role text; v_staff_library uuid; v_jwt_role text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authenticated staff account required.'; END IF;
  SELECT lower(sp.role), sp.library_id INTO v_role, v_staff_library
  FROM public.staff_profiles sp WHERE sp.id = auth.uid() AND sp.is_active IS TRUE;
  IF NOT FOUND OR v_role NOT IN ('superadmin', 'subadmin') THEN RAISE EXCEPTION 'Active staff profile required.'; END IF;
  v_jwt_role := auth.jwt() -> 'app_metadata' ->> 'role';
  IF v_jwt_role IS NOT NULL AND v_jwt_role <> v_role THEN RAISE EXCEPTION 'Unauthorized staff role.'; END IF;
  IF v_role = 'subadmin' AND p_library_id IS NOT NULL AND p_library_id <> v_staff_library::text THEN
    RAISE EXCEPTION 'You can only view your assigned library subscription.';
  END IF;

  RETURN QUERY
  SELECT l.id::text, l.name::text,
    COALESCE((SELECT array_agg(DISTINCT sp.full_name ORDER BY sp.full_name)
      FROM public.staff_profiles sp WHERE sp.library_id = l.id AND lower(sp.role) = 'subadmin' AND sp.is_active), ARRAY[]::text[]),
    s.plan_key, s.plan_mode, s.billing_period, s.starts_on, s.renews_on,
    s.grace_period_days, COALESCE(s.is_paid, false), s.paid_at,
    CASE
      WHEN s.library_id IS NULL THEN 'not_configured'
      WHEN s.plan_mode = 'suspended' THEN 'suspended'
      WHEN s.plan_mode = 'trial' AND s.renews_on >= current_date THEN 'trial'
      WHEN current_date > s.renews_on + s.grace_period_days THEN 'suspended'
      WHEN current_date > s.renews_on THEN 'past_due'
      WHEN NOT s.is_paid AND s.plan_mode <> 'trial' THEN 'past_due'
      WHEN s.renews_on <= current_date + 30 THEN 'expiring'
      ELSE 'active'
    END::text,
    COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'eventType', ev.event_type, 'details', ev.details,
      'changedBy', ev.changed_by_name, 'createdAt', ev.created_at
    ) ORDER BY ev.created_at DESC) FROM (
      SELECT * FROM public.library_subscription_events e
      WHERE e.library_id = l.id ORDER BY e.created_at DESC LIMIT 20
    ) ev), '[]'::jsonb),
    COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'id', ur.id, 'requestedBy', ur.requested_by_name,
      'requestedPlan', ur.requested_plan, 'note', ur.note,
      'status', ur.status, 'decisionBy', ur.decision_by_name,
      'decisionNote', ur.decision_note, 'requestedAt', ur.requested_at,
      'decidedAt', ur.decided_at
    ) ORDER BY ur.requested_at DESC) FROM (
      SELECT * FROM public.subscription_upgrade_requests u
      WHERE u.library_id = l.id ORDER BY u.requested_at DESC LIMIT 20
    ) ur), '[]'::jsonb)
  FROM public.libraries l
  LEFT JOIN public.library_subscriptions s ON s.library_id = l.id
  WHERE (v_role = 'superadmin' OR l.id = v_staff_library)
    AND (p_library_id IS NULL OR l.id::text = p_library_id)
  ORDER BY l.name;
END;
$function$;

CREATE OR REPLACE FUNCTION public.update_library_subscription(
  p_library_id uuid, p_plan_key text, p_plan_mode text,
  p_billing_period text, p_starts_on date, p_renews_on date,
  p_grace_period_days integer, p_is_paid boolean, p_paid_at date,
  p_note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_staff public.staff_profiles%ROWTYPE; v_before jsonb; v_after jsonb; v_event text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authenticated super-admin account required.'; END IF;
  SELECT * INTO v_staff FROM public.staff_profiles WHERE id = auth.uid() AND is_active IS TRUE;
  IF NOT FOUND OR lower(v_staff.role) <> 'superadmin' THEN RAISE EXCEPTION 'Only a super-admin can manage subscriptions.'; END IF;
  IF auth.jwt() -> 'app_metadata' ->> 'role' IS NOT NULL
     AND auth.jwt() -> 'app_metadata' ->> 'role' <> 'superadmin' THEN RAISE EXCEPTION 'Unauthorized staff role.'; END IF;
  IF p_plan_key NOT IN ('basic', 'premium') OR p_plan_mode NOT IN ('trial', 'active', 'suspended')
     OR p_billing_period NOT IN ('monthly', 'annual') THEN RAISE EXCEPTION 'Invalid subscription settings.'; END IF;
  IF p_starts_on IS NULL OR p_renews_on IS NULL OR p_renews_on < p_starts_on THEN
    RAISE EXCEPTION 'Choose valid subscription start and renewal dates.';
  END IF;
  IF p_grace_period_days NOT BETWEEN 0 AND 60 THEN RAISE EXCEPTION 'Grace period must be between 0 and 60 days.'; END IF;
  IF p_is_paid AND p_paid_at IS NULL THEN RAISE EXCEPTION 'Enter the date payment was received.'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.libraries WHERE id = p_library_id) THEN RAISE EXCEPTION 'Library not found.'; END IF;

  SELECT to_jsonb(s) INTO v_before FROM public.library_subscriptions s WHERE s.library_id = p_library_id;
  INSERT INTO public.library_subscriptions (
    library_id, plan_key, plan_mode, billing_period, starts_on, renews_on,
    grace_period_days, is_paid, paid_at, updated_by, updated_at
  ) VALUES (
    p_library_id, p_plan_key, p_plan_mode, p_billing_period, p_starts_on,
    p_renews_on, p_grace_period_days, p_is_paid, p_paid_at, v_staff.id, now()
  ) ON CONFLICT (library_id) DO UPDATE SET
    plan_key = EXCLUDED.plan_key,
    plan_mode = EXCLUDED.plan_mode,
    billing_period = EXCLUDED.billing_period,
    starts_on = EXCLUDED.starts_on,
    renews_on = EXCLUDED.renews_on,
    grace_period_days = EXCLUDED.grace_period_days,
    is_paid = EXCLUDED.is_paid,
    paid_at = CASE WHEN EXCLUDED.is_paid THEN EXCLUDED.paid_at ELSE public.library_subscriptions.paid_at END,
    updated_by = EXCLUDED.updated_by,
    updated_at = now();
  SELECT to_jsonb(s) INTO v_after FROM public.library_subscriptions s WHERE s.library_id = p_library_id;
  v_event := CASE WHEN p_is_paid THEN 'payment_recorded' ELSE 'subscription_updated' END;
  INSERT INTO public.library_subscription_events (library_id, event_type, details, changed_by, changed_by_name)
  VALUES (p_library_id, v_event,
    jsonb_build_object('before', COALESCE(v_before, '{}'::jsonb), 'after', v_after, 'note', NULLIF(btrim(p_note), '')),
    v_staff.id, COALESCE(NULLIF(btrim(v_staff.full_name), ''), v_staff.email));
  RETURN v_after;
END;
$function$;

CREATE OR REPLACE FUNCTION public.request_subscription_upgrade(p_requested_plan text, p_note text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_staff public.staff_profiles%ROWTYPE; v_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authenticated sub-admin account required.'; END IF;
  SELECT * INTO v_staff FROM public.staff_profiles WHERE id = auth.uid() AND is_active IS TRUE;
  IF NOT FOUND OR lower(v_staff.role) <> 'subadmin' OR v_staff.library_id IS NULL THEN RAISE EXCEPTION 'Active assigned sub-admin account required.'; END IF;
  IF auth.jwt() -> 'app_metadata' ->> 'role' IS NOT NULL
     AND auth.jwt() -> 'app_metadata' ->> 'role' <> 'subadmin' THEN RAISE EXCEPTION 'Unauthorized staff role.'; END IF;
  IF p_requested_plan NOT IN ('basic', 'premium') THEN RAISE EXCEPTION 'Choose a valid plan.'; END IF;
  IF EXISTS (SELECT 1 FROM public.subscription_upgrade_requests WHERE library_id = v_staff.library_id AND status = 'pending') THEN
    RAISE EXCEPTION 'Your library already has a pending upgrade request.';
  END IF;
  INSERT INTO public.subscription_upgrade_requests (library_id, requested_by, requested_by_name, requested_plan, note)
  VALUES (v_staff.library_id, v_staff.id, COALESCE(NULLIF(btrim(v_staff.full_name), ''), v_staff.email), p_requested_plan, NULLIF(btrim(p_note), ''))
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.decide_subscription_upgrade(p_request_id uuid, p_decision text, p_note text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_staff public.staff_profiles%ROWTYPE; v_library_id uuid; v_requested_plan text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authenticated super-admin account required.'; END IF;
  SELECT * INTO v_staff FROM public.staff_profiles WHERE id = auth.uid() AND is_active IS TRUE;
  IF NOT FOUND OR lower(v_staff.role) <> 'superadmin' THEN RAISE EXCEPTION 'Only a super-admin can decide upgrade requests.'; END IF;
  IF p_decision NOT IN ('approved', 'rejected') THEN RAISE EXCEPTION 'Choose approve or reject.'; END IF;
  SELECT library_id, requested_plan INTO v_library_id, v_requested_plan
  FROM public.subscription_upgrade_requests WHERE id = p_request_id AND status = 'pending' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Pending upgrade request not found.'; END IF;
  UPDATE public.subscription_upgrade_requests SET status = p_decision,
    decision_by = v_staff.id,
    decision_by_name = COALESCE(NULLIF(btrim(v_staff.full_name), ''), v_staff.email),
    decision_note = NULLIF(btrim(p_note), ''), decided_at = now()
  WHERE id = p_request_id;
  INSERT INTO public.library_subscription_events (library_id, event_type, details, changed_by, changed_by_name)
  VALUES (v_library_id, 'upgrade_' || p_decision,
    jsonb_build_object('requestId', p_request_id, 'requestedPlan', v_requested_plan, 'note', NULLIF(btrim(p_note), '')),
    v_staff.id, COALESCE(NULLIF(btrim(v_staff.full_name), ''), v_staff.email));
END;
$function$;

ALTER FUNCTION public.get_library_subscription_dashboard(text) OWNER TO postgres;
ALTER FUNCTION public.update_library_subscription(uuid, text, text, text, date, date, integer, boolean, date, text) OWNER TO postgres;
ALTER FUNCTION public.request_subscription_upgrade(text, text) OWNER TO postgres;
ALTER FUNCTION public.decide_subscription_upgrade(uuid, text, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_library_subscription_dashboard(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.update_library_subscription(uuid, text, text, text, date, date, integer, boolean, date, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.request_subscription_upgrade(text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.decide_subscription_upgrade(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_library_subscription_dashboard(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.update_library_subscription(uuid, text, text, text, date, date, integer, boolean, date, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.request_subscription_upgrade(text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.decide_subscription_upgrade(uuid, text, text) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
