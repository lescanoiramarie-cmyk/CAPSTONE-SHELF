-- Migration: 20270127000000_reconcile_transactions_subscription_and_notifications.sql
-- Description:
--   1. Reconcile get_library_subscription_dashboard with its existing text argument and return contract; use CURRENT_DATE.
--   2. Reconcile handover IDs by validating text input before converting it to borrow_requests.id UUID.
--   3. Reconcile mask_reviewer_name and get_book_reviews: strip [TEST] prefixes, fallback to review.visitor_name, return masked names (e.g. K*** M.).
--   4. Reconcile create_visitor_notification and visitor_notifications: cast text reference_id to uuid safely, support feedback_reply.
--   5. Reconcile save_community_book_for_later and get_saved_community_books: ensure consistent visitor auth_user_id and id resolution.

BEGIN;

-- The unchecked borrow implementation is an internal SECURITY DEFINER helper.
-- Authenticated visitors must enter through request_borrow_v2, which verifies
-- ownership and verification against auth.uid() before delegating as postgres.
ALTER FUNCTION shelf_private.request_borrow_unchecked(uuid, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION shelf_private.request_borrow_unchecked(uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;

-- ============================================================================
-- 1. FIX get_library_subscription_dashboard (CURRENT_DATE FIX & LEFT JOIN)
-- ============================================================================
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
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_staff_role text;
  v_staff_library uuid;
  v_target_library uuid;
  v_jwt_role text := auth.jwt() -> 'app_metadata' ->> 'role';
  v_library_id text := NULLIF(pg_catalog.btrim(p_library_id), '');
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  IF auth.jwt() ->> 'aal' IS DISTINCT FROM 'aal2' THEN
    RAISE EXCEPTION 'AAL2 authentication is required.';
  END IF;
  SELECT pg_catalog.lower(pg_catalog.btrim(sp.role)), sp.library_id
    INTO v_staff_role, v_staff_library
  FROM public.staff_profiles AS sp
  WHERE sp.id = v_uid AND sp.is_active IS TRUE;
  IF NOT FOUND OR v_staff_role NOT IN ('superadmin', 'subadmin') THEN
    RAISE EXCEPTION 'Active staff profile required.';
  END IF;
  IF v_jwt_role IS DISTINCT FROM v_staff_role THEN
    RAISE EXCEPTION 'Staff role claim does not match the active staff profile.';
  END IF;
  IF v_staff_role = 'subadmin' THEN
    IF v_staff_library IS NULL THEN
      RAISE EXCEPTION 'Sub-admin is not assigned to a library.';
    END IF;
    IF v_library_id IS NOT NULL AND v_library_id <> v_staff_library::text THEN
      RAISE EXCEPTION 'Access denied for requested library.';
    END IF;
    v_target_library := v_staff_library;
  ELSIF v_library_id IS NOT NULL THEN
    IF v_library_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      RAISE EXCEPTION 'Invalid library ID format.';
    END IF;
    v_target_library := v_library_id::uuid;
  END IF;

  RETURN QUERY
  SELECT
    l.id AS library_id,
    l.name::text AS library_name,
    COALESCE(
      (SELECT pg_catalog.array_agg(DISTINCT sp.full_name::text ORDER BY sp.full_name::text)
       FROM public.staff_profiles AS sp
       WHERE sp.library_id = l.id AND pg_catalog.lower(sp.role) = 'subadmin' AND sp.is_active IS TRUE),
      ARRAY[]::text[]
    ) AS assigned_subadmins,
    s.plan_key::text,
    s.plan_mode::text,
    s.billing_period::text,
    s.starts_on,
    s.renews_on,
    s.grace_period_days,
    COALESCE(s.is_paid, false),
    s.paid_at,
    CASE
      WHEN s.library_id IS NULL THEN 'not_configured'
      WHEN s.plan_mode = 'suspended' THEN 'suspended'
      WHEN s.plan_mode = 'trial' AND s.renews_on >= CURRENT_DATE THEN 'trial'
      WHEN CURRENT_DATE > s.renews_on + s.grace_period_days THEN 'suspended'
      WHEN CURRENT_DATE > s.renews_on THEN 'past_due'
      ELSE 'active'
    END::text AS effective_status,
    COALESCE(
      (SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
          'id', h.id, 'plan_key', h.plan_key, 'plan_mode', h.plan_mode,
          'billing_period', h.billing_period, 'status', h.status,
          'changed_by', h.changed_by, 'created_at', h.created_at, 'notes', h.notes
        ) ORDER BY h.created_at DESC)
       FROM public.library_subscription_events AS h WHERE h.library_id = l.id),
      '[]'::jsonb
    ) AS history,
    COALESCE(
      (SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
          'id', u.id, 'requested_plan', u.requested_plan,
          'requested_period', u.requested_period, 'status', u.status,
          'requested_by', u.requested_by, 'requested_at', u.created_at,
          'reviewed_by', u.reviewed_by, 'reviewed_at', u.reviewed_at, 'notes', u.notes
        ) ORDER BY u.created_at DESC)
       FROM public.subscription_upgrade_requests AS u WHERE u.library_id = l.id),
      '[]'::jsonb
    ) AS upgrade_requests
  FROM public.libraries AS l
  LEFT JOIN public.library_subscriptions AS s ON s.library_id = l.id
  WHERE v_target_library IS NULL OR l.id = v_target_library
  ORDER BY l.name ASC;
END;
$function$;

ALTER FUNCTION public.get_library_subscription_dashboard(text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_library_subscription_dashboard(text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.get_library_subscription_dashboard(text) TO authenticated;

-- ============================================================================
-- 2. FIX confirm_pickup AND confirm_return (TEXT AND UUID COMPATIBILITY)
-- ============================================================================
-- Internal compatibility implementation: text input is validated, then matched
-- to the UUID primary key. Authenticated RPC callers use the unambiguous v2 API.
CREATE OR REPLACE FUNCTION public.confirm_pickup(
    p_request_id text,
    p_staff_name text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_staff_role text;
  v_staff_library_id uuid;
  v_book_library_id uuid;
  v_req public.borrow_requests%rowtype;
  v_request_uuid uuid;
  v_request_id_is_uuid boolean;
  v_staff_name text := pg_catalog.btrim(COALESCE(p_staff_name, ''));
  v_req_id text := pg_catalog.btrim(COALESCE(p_request_id, ''));
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Staff authentication required.';
  END IF;

  SELECT sp.role, sp.library_id
  INTO v_staff_role, v_staff_library_id
  FROM public.staff_profiles sp
  WHERE sp.id = auth.uid()
    AND sp.is_active IS TRUE;

  IF v_staff_role IS NULL
     OR v_staff_role NOT IN ('superadmin', 'subadmin')
     OR auth.jwt() ->> 'aal' IS DISTINCT FROM 'aal2'
     OR auth.jwt() -> 'app_metadata' ->> 'role' IS DISTINCT FROM v_staff_role THEN
    RAISE EXCEPTION 'Unauthorized staff role.';
  END IF;

  IF v_req_id = '' THEN
    RAISE EXCEPTION 'Request ID is required.';
  END IF;
  IF v_req_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RAISE EXCEPTION 'Invalid request ID format.';
  END IF;
  v_request_uuid := v_req_id::uuid;

  SELECT attribute.atttypid = 'uuid'::pg_catalog.regtype
    INTO v_request_id_is_uuid
  FROM pg_catalog.pg_attribute AS attribute
  WHERE attribute.attrelid = 'public.borrow_requests'::pg_catalog.regclass
    AND attribute.attname = 'id'
    AND attribute.attnum > 0
    AND NOT attribute.attisdropped;
  IF v_request_id_is_uuid IS NULL THEN
    RAISE EXCEPTION 'Could not verify borrow_requests.id type.';
  END IF;

  IF v_request_id_is_uuid THEN
    SELECT br.* INTO v_req FROM public.borrow_requests AS br
    WHERE br.id = v_request_uuid FOR UPDATE;
  ELSE
    SELECT br.* INTO v_req FROM public.borrow_requests AS br
    WHERE br.id = v_req_id FOR UPDATE;
  END IF;
  IF NOT FOUND THEN RAISE EXCEPTION 'Request not found.'; END IF;

  SELECT b.library_id
  INTO v_book_library_id
  FROM public.books b WHERE b.id = v_req.book_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Book not found.'; END IF;

  IF v_staff_role <> 'superadmin'
     AND v_staff_library_id IS DISTINCT FROM v_book_library_id THEN
    RAISE EXCEPTION 'You are not authorized to process this branch.';
  END IF;

  IF v_req.status NOT IN ('pending', 'approved', 'ready_for_pickup') THEN
    RAISE EXCEPTION 'This request is not ready for pickup confirmation.';
  END IF;

  IF v_request_id_is_uuid THEN
    UPDATE public.borrow_requests
       SET status = 'borrowed',
           borrow_date = pg_catalog.now(),
           due_date = pg_catalog.now() + interval '14 days',
           pickup_confirmed_by = v_staff_name,
           updated_at = pg_catalog.now()
     WHERE id = v_request_uuid;
  ELSE
    UPDATE public.borrow_requests
       SET status = 'borrowed',
           borrow_date = pg_catalog.now(),
           due_date = pg_catalog.now() + interval '14 days',
           pickup_confirmed_by = v_staff_name,
           updated_at = pg_catalog.now()
     WHERE id = v_req_id;
  END IF;
END;
$function$;

ALTER FUNCTION public.confirm_pickup(text, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.confirm_pickup(text, text) FROM PUBLIC, anon, authenticated, service_role;

-- Backward compatibility overload for legacy UUID callers
CREATE OR REPLACE FUNCTION public.confirm_pickup(
    p_request_id uuid,
    p_staff_name text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  PERFORM public.confirm_pickup(p_request_id::text, p_staff_name);
END;
$function$;

ALTER FUNCTION public.confirm_pickup(uuid, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.confirm_pickup(uuid, text) FROM PUBLIC, anon, authenticated, service_role;

-- Internal compatibility implementation: text input is validated, then matched
-- to the UUID primary key. Authenticated RPC callers use the unambiguous v2 API.
CREATE OR REPLACE FUNCTION public.confirm_return(
    p_request_id text,
    p_staff_name text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_staff_role text;
  v_staff_library_id uuid;
  v_book_library_id uuid;
  v_book_fine_rate integer;
  v_effective_fine_rate integer;
  v_req public.borrow_requests%rowtype;
  v_request_uuid uuid;
  v_request_id_is_uuid boolean;
  v_staff_name text := pg_catalog.btrim(COALESCE(p_staff_name, ''));
  v_overdue_days integer := 0;
  v_fine numeric(10, 2) := 0;
  v_req_id text := pg_catalog.btrim(COALESCE(p_request_id, ''));
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Staff authentication required.';
  END IF;

  SELECT sp.role, sp.library_id
  INTO v_staff_role, v_staff_library_id
  FROM public.staff_profiles sp
  WHERE sp.id = auth.uid()
    AND sp.is_active IS TRUE;

  IF v_staff_role IS NULL
     OR v_staff_role NOT IN ('superadmin', 'subadmin')
     OR auth.jwt() ->> 'aal' IS DISTINCT FROM 'aal2'
     OR auth.jwt() -> 'app_metadata' ->> 'role' IS DISTINCT FROM v_staff_role THEN
    RAISE EXCEPTION 'Unauthorized staff role.';
  END IF;

  IF v_req_id = '' THEN
    RAISE EXCEPTION 'Request ID is required.';
  END IF;
  IF v_req_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RAISE EXCEPTION 'Invalid request ID format.';
  END IF;
  v_request_uuid := v_req_id::uuid;

  SELECT attribute.atttypid = 'uuid'::pg_catalog.regtype
    INTO v_request_id_is_uuid
  FROM pg_catalog.pg_attribute AS attribute
  WHERE attribute.attrelid = 'public.borrow_requests'::pg_catalog.regclass
    AND attribute.attname = 'id'
    AND attribute.attnum > 0
    AND NOT attribute.attisdropped;
  IF v_request_id_is_uuid IS NULL THEN
    RAISE EXCEPTION 'Could not verify borrow_requests.id type.';
  END IF;

  IF v_request_id_is_uuid THEN
    SELECT br.* INTO v_req FROM public.borrow_requests AS br
    WHERE br.id = v_request_uuid FOR UPDATE;
  ELSE
    SELECT br.* INTO v_req FROM public.borrow_requests AS br
    WHERE br.id = v_req_id FOR UPDATE;
  END IF;
  IF NOT FOUND THEN RAISE EXCEPTION 'Request not found.'; END IF;

  SELECT b.library_id, b.fine_rate
  INTO v_book_library_id, v_book_fine_rate
  FROM public.books b WHERE b.id = v_req.book_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Book not found.'; END IF;

  IF v_staff_role <> 'superadmin'
     AND v_staff_library_id IS DISTINCT FROM v_book_library_id THEN
    RAISE EXCEPTION 'You are not authorized to process this branch.';
  END IF;

  IF v_req.status NOT IN ('borrowed', 'overdue') THEN
    RAISE EXCEPTION 'This item is not currently on loan.';
  END IF;

  v_effective_fine_rate := CASE
    WHEN v_req.fine_rate_snapshot BETWEEN 1 AND 100 THEN v_req.fine_rate_snapshot
    WHEN v_book_fine_rate BETWEEN 1 AND 100 THEN v_book_fine_rate
    ELSE NULL
  END;

  IF v_effective_fine_rate IS NOT NULL THEN
    v_overdue_days := CASE
      WHEN v_req.due_date IS NULL OR pg_catalog.now() <= v_req.due_date THEN 0
      ELSE CEIL(EXTRACT(EPOCH FROM (pg_catalog.now() - v_req.due_date)) / 86400)::integer
    END;
    -- Keep any previously assessed amount; rate/configuration changes must not
    -- erase a historical fine or make a recorded payment exceed its assessment.
    v_fine := GREATEST(COALESCE(v_req.fine_amount, 0), v_overdue_days * v_effective_fine_rate);
    IF v_request_id_is_uuid THEN
      UPDATE public.borrow_requests
         SET status = 'returned',
             return_date = pg_catalog.now(),
             fine_amount = v_fine,
             fine_rate_snapshot = v_effective_fine_rate,
             fine_review_required = false,
             return_confirmed_by = v_staff_name,
             updated_at = pg_catalog.now()
       WHERE id = v_request_uuid;
    ELSE
      UPDATE public.borrow_requests
         SET status = 'returned',
             return_date = pg_catalog.now(),
             fine_amount = v_fine,
             fine_rate_snapshot = v_effective_fine_rate,
             fine_review_required = false,
             return_confirmed_by = v_staff_name,
             updated_at = pg_catalog.now()
       WHERE id = v_req_id;
    END IF;
  ELSE
    IF v_request_id_is_uuid THEN
      UPDATE public.borrow_requests
         SET status = 'returned',
             return_date = pg_catalog.now(),
             fine_amount = GREATEST(COALESCE(v_req.fine_amount, 0), 0),
             fine_review_required = false,
             return_confirmed_by = v_staff_name,
             updated_at = pg_catalog.now()
       WHERE id = v_request_uuid;
    ELSE
      UPDATE public.borrow_requests
         SET status = 'returned',
             return_date = pg_catalog.now(),
             fine_amount = GREATEST(COALESCE(v_req.fine_amount, 0), 0),
             fine_review_required = false,
             return_confirmed_by = v_staff_name,
             updated_at = pg_catalog.now()
       WHERE id = v_req_id;
    END IF;
  END IF;
END;
$function$;

ALTER FUNCTION public.confirm_return(text, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.confirm_return(text, text) FROM PUBLIC, anon, authenticated, service_role;

-- Backward compatibility overload for legacy UUID callers
CREATE OR REPLACE FUNCTION public.confirm_return(
    p_request_id uuid,
    p_staff_name text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  PERFORM public.confirm_return(p_request_id::text, p_staff_name);
END;
$function$;

ALTER FUNCTION public.confirm_return(uuid, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.confirm_return(uuid, text) FROM PUBLIC, anon, authenticated, service_role;

-- Also update confirm_pickup_v2 and confirm_return_v2 for absolute safety
CREATE OR REPLACE FUNCTION public.confirm_pickup_v2(p_request_id text, p_staff_name text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_role text;
  v_trimmed_id text;
  v_uuid uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authenticated staff account required.';
  END IF;
  IF auth.jwt() ->> 'aal' IS DISTINCT FROM 'aal2' THEN
    RAISE EXCEPTION 'AAL2 authentication is required.';
  END IF;
  v_trimmed_id := pg_catalog.btrim(COALESCE(p_request_id, ''));
  IF v_trimmed_id = '' OR NULLIF(pg_catalog.btrim(p_staff_name), '') IS NULL THEN
    RAISE EXCEPTION 'A request ID and staff name are required.';
  END IF;
  IF v_trimmed_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RAISE EXCEPTION 'Invalid request ID format.';
  END IF;
  v_uuid := v_trimmed_id::uuid;

  SELECT staff.role INTO v_role
  FROM public.staff_profiles AS staff
  WHERE staff.id = auth.uid()
    AND staff.is_active IS TRUE;
  IF NOT FOUND OR v_role NOT IN ('superadmin', 'subadmin') THEN
    RAISE EXCEPTION 'Active staff account with a supported role required.';
  END IF;
  IF auth.jwt() -> 'app_metadata' ->> 'role' IS DISTINCT FROM v_role THEN
    RAISE EXCEPTION 'Staff role claim does not match the active staff profile.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.borrow_requests AS request
    JOIN public.books AS book ON book.id = request.book_id
    WHERE request.id = v_uuid
      AND public.is_active_staff_for_branch(book.library_id::text)
  ) THEN
    RAISE EXCEPTION 'Request not found or branch access denied.';
  END IF;

  PERFORM public.confirm_pickup(v_uuid, p_staff_name);
END;
$function$;

CREATE OR REPLACE FUNCTION public.confirm_return_v2(p_request_id text, p_staff_name text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_role text;
  v_trimmed_id text;
  v_uuid uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authenticated staff account required.';
  END IF;
  IF auth.jwt() ->> 'aal' IS DISTINCT FROM 'aal2' THEN
    RAISE EXCEPTION 'AAL2 authentication is required.';
  END IF;
  v_trimmed_id := pg_catalog.btrim(COALESCE(p_request_id, ''));
  IF v_trimmed_id = '' OR NULLIF(pg_catalog.btrim(p_staff_name), '') IS NULL THEN
    RAISE EXCEPTION 'A request ID and staff name are required.';
  END IF;
  IF v_trimmed_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RAISE EXCEPTION 'Invalid request ID format.';
  END IF;
  v_uuid := v_trimmed_id::uuid;

  SELECT staff.role INTO v_role
  FROM public.staff_profiles AS staff
  WHERE staff.id = auth.uid()
    AND staff.is_active IS TRUE;
  IF NOT FOUND OR v_role NOT IN ('superadmin', 'subadmin') THEN
    RAISE EXCEPTION 'Active staff account with a supported role required.';
  END IF;
  IF auth.jwt() -> 'app_metadata' ->> 'role' IS DISTINCT FROM v_role THEN
    RAISE EXCEPTION 'Staff role claim does not match the active staff profile.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.borrow_requests AS request
    JOIN public.books AS book ON book.id = request.book_id
    WHERE request.id = v_uuid
      AND public.is_active_staff_for_branch(book.library_id::text)
  ) THEN
    RAISE EXCEPTION 'Loan not found or branch access denied.';
  END IF;

  PERFORM public.confirm_return(v_uuid, p_staff_name);
END;
$function$;

ALTER FUNCTION public.confirm_pickup_v2(text, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.confirm_pickup_v2(text, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.confirm_pickup_v2(text, text) TO authenticated;

ALTER FUNCTION public.confirm_return_v2(text, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.confirm_return_v2(text, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.confirm_return_v2(text, text) TO authenticated;

-- ============================================================================
-- 2.4 FAIL-CLOSED SUBADMIN TERMS CLAIM
-- ============================================================================
-- The schema snapshot's older implementation fell back to staff_profiles.role
-- when app_metadata.role was absent. Preserve the caller/result contract while
-- requiring a verified AAL2 session and exact active-profile role claim.
CREATE OR REPLACE FUNCTION public.accept_subadmin_terms()
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  staff_row public.staff_profiles%ROWTYPE;
  accepted_at timestamptz;
  v_jwt_role text := auth.jwt() -> 'app_metadata' ->> 'role';
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'A signed-in sub-admin session is required.';
  END IF;
  IF auth.jwt() ->> 'aal' IS DISTINCT FROM 'aal2' THEN
    RAISE EXCEPTION 'AAL2 authentication is required.';
  END IF;

  SELECT staff.*
    INTO staff_row
  FROM public.staff_profiles AS staff
  WHERE staff.id = auth.uid()
    AND staff.role = 'subadmin'
    AND staff.is_active IS TRUE;

  IF NOT FOUND OR v_jwt_role IS DISTINCT FROM staff_row.role THEN
    RAISE EXCEPTION 'The active sub-admin role claim is missing or does not match.';
  END IF;

  INSERT INTO public.staff_terms_acceptances (
    staff_user_id, staff_name, staff_email, staff_role, library_id, terms_version
  ) VALUES (
    staff_row.id, staff_row.full_name, staff_row.email, staff_row.role,
    staff_row.library_id, '2026-11-04-v1'
  ) ON CONFLICT (staff_user_id, terms_version) DO NOTHING;

  SELECT acceptance.accepted_at
    INTO accepted_at
  FROM public.staff_terms_acceptances AS acceptance
  WHERE acceptance.staff_user_id = auth.uid()
    AND acceptance.terms_version = '2026-11-04-v1';

  RETURN accepted_at;
END;
$function$;

ALTER FUNCTION public.accept_subadmin_terms() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.accept_subadmin_terms() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.accept_subadmin_terms() TO authenticated, service_role;

-- ============================================================================
-- 2.5 RECONCILE record_fine_payment_subadmin_internal (PERSIST ASSESSED FINE)
-- ============================================================================
-- A later alert reconciliation regranted this detail helper directly to
-- authenticated and service_role. It returns visitor-target rows and is only
-- called from the authorization-checking wrapper, so keep it owner-only.
REVOKE ALL ON FUNCTION public.get_fine_payment_alert_targets_detail_internal(text)
  FROM PUBLIC, anon, authenticated, service_role;

-- A request row lock serializes payments for the same loan. This private receipt
-- table makes client retries idempotent without changing the historical ledger.
CREATE TABLE public.fine_payment_idempotency (
  received_by uuid NOT NULL REFERENCES public.staff_profiles(id) ON DELETE RESTRICT,
  idempotency_key uuid NOT NULL,
  request_id uuid NOT NULL,
  amount numeric(10, 2) NOT NULL CHECK (amount > 0),
  payment_method text NOT NULL CHECK (payment_method IN ('cash', 'bank_transfer', 'other')),
  reference_number text,
  note text,
  payment_id uuid NOT NULL REFERENCES public.fine_payments(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  CONSTRAINT fine_payment_idempotency_pkey PRIMARY KEY (received_by, idempotency_key)
);
ALTER TABLE public.fine_payment_idempotency OWNER TO postgres;
ALTER TABLE public.fine_payment_idempotency ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.fine_payment_idempotency FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.record_fine_payment_subadmin_internal(
  p_request_id text,
  p_amount numeric,
  p_payment_method text,
  p_reference_number text,
  p_note text,
  p_idempotency_key uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_staff public.staff_profiles%ROWTYPE;
  v_request public.borrow_requests%ROWTYPE;
  v_library_id uuid;
  v_book_fine_rate integer;
  v_effective_rate integer;
  v_fine_amount numeric;
  v_remaining numeric;
  v_payment_id uuid;
  v_request_uuid uuid;
  v_request_id_is_uuid boolean;
  v_existing_request_id uuid;
  v_existing_amount numeric(10, 2);
  v_existing_method text;
  v_existing_reference text;
  v_existing_note text;
  v_amount numeric := pg_catalog.round(p_amount, 2);
  v_trimmed_id text := pg_catalog.btrim(COALESCE(p_request_id, ''));
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authenticated staff account required.'; END IF;
  IF auth.jwt() ->> 'aal' IS DISTINCT FROM 'aal2' THEN
    RAISE EXCEPTION 'AAL2 authentication is required.';
  END IF;
  SELECT * INTO v_staff FROM public.staff_profiles
  WHERE id = auth.uid() AND is_active IS TRUE;
  IF NOT FOUND OR pg_catalog.lower(v_staff.role) NOT IN ('superadmin', 'subadmin') THEN
    RAISE EXCEPTION 'Active staff profile required.';
  END IF;
  IF auth.jwt() -> 'app_metadata' ->> 'role' IS DISTINCT FROM pg_catalog.lower(v_staff.role) THEN
    RAISE EXCEPTION 'Unauthorized staff role.';
  END IF;
  IF v_amount IS NULL OR v_amount <= 0 THEN RAISE EXCEPTION 'Enter a payment amount greater than zero.'; END IF;
  IF p_payment_method IS NULL OR p_payment_method NOT IN ('cash', 'bank_transfer', 'other') THEN
    RAISE EXCEPTION 'Choose a valid payment method.';
  END IF;
  IF p_idempotency_key IS NULL THEN RAISE EXCEPTION 'An idempotency key is required.'; END IF;
  IF v_trimmed_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RAISE EXCEPTION 'Invalid borrow request ID format.';
  END IF;
  v_request_uuid := v_trimmed_id::uuid;

  SELECT attribute.atttypid = 'uuid'::pg_catalog.regtype
    INTO v_request_id_is_uuid
  FROM pg_catalog.pg_attribute AS attribute
  WHERE attribute.attrelid = 'public.borrow_requests'::pg_catalog.regclass
    AND attribute.attname = 'id'
    AND attribute.attnum > 0
    AND NOT attribute.attisdropped;
  IF v_request_id_is_uuid IS NULL THEN
    RAISE EXCEPTION 'Could not verify borrow_requests.id type.';
  END IF;
  IF v_request_id_is_uuid THEN
    SELECT br.* INTO v_request FROM public.borrow_requests AS br
    WHERE br.id = v_request_uuid FOR UPDATE;
  ELSE
    SELECT br.* INTO v_request FROM public.borrow_requests AS br
    WHERE br.id = v_trimmed_id FOR UPDATE;
  END IF;
  IF NOT FOUND THEN RAISE EXCEPTION 'Borrow request not found.'; END IF;
  SELECT b.library_id, b.fine_rate INTO v_library_id, v_book_fine_rate
  FROM public.books b WHERE b.id::text = v_request.book_id::text;
  IF pg_catalog.lower(v_staff.role) = 'subadmin'
     AND (v_library_id IS NULL OR v_library_id <> v_staff.library_id) THEN
    RAISE EXCEPTION 'You can only record payments for your assigned library.';
  END IF;
  IF v_request.status NOT IN ('borrowed', 'returned') THEN
    RAISE EXCEPTION 'Payments can only be recorded for borrowed or returned books.';
  END IF;

  v_effective_rate := CASE
    WHEN v_request.fine_rate_snapshot BETWEEN 1 AND 100 THEN v_request.fine_rate_snapshot
    WHEN v_book_fine_rate BETWEEN 1 AND 100 THEN v_book_fine_rate
    ELSE NULL
  END;
  IF v_effective_rate IS NULL AND (COALESCE(v_request.fine_review_required, false)
      OR COALESCE(v_request.fine_amount, 0) > 0
      OR (v_request.status = 'borrowed' AND v_request.due_date < pg_catalog.now())) THEN
    RAISE EXCEPTION 'This fine needs review because the book has no valid fine rate.';
  END IF;

  IF v_effective_rate IS NOT NULL AND v_request.status = 'borrowed'
     AND v_request.due_date < pg_catalog.now() THEN
    v_fine_amount := CEIL(EXTRACT(EPOCH FROM (pg_catalog.now() - v_request.due_date)) / 86400)
                       * v_effective_rate;
  ELSIF v_effective_rate IS NOT NULL AND v_request.status = 'returned'
     AND v_request.due_date IS NOT NULL AND v_request.return_date IS NOT NULL THEN
    v_fine_amount := GREATEST(
      CEIL(EXTRACT(EPOCH FROM (v_request.return_date - v_request.due_date)) / 86400), 0
    ) * v_effective_rate;
  ELSE
    v_fine_amount := GREATEST(COALESCE(v_request.fine_amount, 0), 0);
  END IF;

  v_remaining := GREATEST(v_fine_amount - COALESCE(v_request.fine_paid_amount, 0), 0);
  SELECT receipt.request_id, receipt.amount, receipt.payment_method,
         receipt.reference_number, receipt.note, receipt.payment_id
    INTO v_existing_request_id, v_existing_amount, v_existing_method,
         v_existing_reference, v_existing_note, v_payment_id
  FROM public.fine_payment_idempotency AS receipt
  WHERE receipt.received_by = v_staff.id
    AND receipt.idempotency_key = p_idempotency_key;
  IF FOUND THEN
    IF v_existing_request_id IS DISTINCT FROM v_request_uuid
       OR v_existing_amount IS DISTINCT FROM v_amount
       OR v_existing_method IS DISTINCT FROM p_payment_method
       OR v_existing_reference IS DISTINCT FROM NULLIF(pg_catalog.btrim(p_reference_number), '')
       OR v_existing_note IS DISTINCT FROM NULLIF(pg_catalog.btrim(p_note), '') THEN
      RAISE EXCEPTION 'Idempotency key was already used for a different payment.';
    END IF;
    RETURN jsonb_build_object(
      'paymentId', v_payment_id, 'requestId', v_request_uuid,
      'amount', v_amount, 'remainingBalance', v_remaining
    );
  END IF;
  IF v_remaining <= 0 THEN RAISE EXCEPTION 'This fine has already been paid in full.'; END IF;
  IF v_amount > v_remaining THEN
    RAISE EXCEPTION 'Payment cannot exceed the outstanding balance of %.', to_char(v_remaining, 'FM999999990.00');
  END IF;

  INSERT INTO public.fine_payments (
    borrow_request_id, amount, payment_method, reference_number,
    note, received_by, received_by_name
  ) VALUES (
    v_request.id::text, v_amount, p_payment_method,
    NULLIF(pg_catalog.btrim(p_reference_number), ''), NULLIF(pg_catalog.btrim(p_note), ''),
    v_staff.id, COALESCE(NULLIF(pg_catalog.btrim(v_staff.full_name), ''), v_staff.email)
  ) RETURNING id INTO v_payment_id;

  INSERT INTO public.fine_payment_idempotency (
    received_by, idempotency_key, request_id, amount, payment_method,
    reference_number, note, payment_id
  ) VALUES (
    v_staff.id, p_idempotency_key, v_request_uuid, v_amount, p_payment_method,
    NULLIF(pg_catalog.btrim(p_reference_number), ''), NULLIF(pg_catalog.btrim(p_note), ''), v_payment_id
  );

  IF v_request_id_is_uuid THEN
    UPDATE public.borrow_requests
       SET fine_paid_amount = COALESCE(fine_paid_amount, 0) + v_amount,
           fine_amount = GREATEST(COALESCE(fine_amount, 0), v_fine_amount),
           updated_at = pg_catalog.now()
     WHERE id = v_request_uuid;
  ELSE
    UPDATE public.borrow_requests
       SET fine_paid_amount = COALESCE(fine_paid_amount, 0) + v_amount,
           fine_amount = GREATEST(COALESCE(fine_amount, 0), v_fine_amount),
           updated_at = pg_catalog.now()
     WHERE id = v_trimmed_id;
  END IF;

  RETURN jsonb_build_object(
    'paymentId', v_payment_id, 'requestId', v_request.id,
    'amount', v_amount, 'remainingBalance', GREATEST(v_remaining - v_amount, 0)
  );
END;
$function$;

ALTER FUNCTION public.record_fine_payment_subadmin_internal(text, numeric, text, text, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.record_fine_payment_subadmin_internal(text, numeric, text, text, text) FROM PUBLIC, anon, authenticated, service_role;
ALTER FUNCTION public.record_fine_payment_subadmin_internal(text, numeric, text, text, text, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.record_fine_payment_subadmin_internal(text, numeric, text, text, text, uuid) FROM PUBLIC, anon, authenticated, service_role;

-- The old five-argument API cannot guarantee retry safety. Disable it and
-- expose only the explicit idempotency-key endpoint to authenticated staff.
REVOKE ALL ON FUNCTION public.record_fine_payment(text, numeric, text, text, text)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.record_fine_payment_v2(
  p_request_id text,
  p_amount numeric,
  p_payment_method text,
  p_reference_number text,
  p_note text,
  p_idempotency_key uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_staff public.staff_profiles%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authenticated staff account required.';
  END IF;
  IF auth.jwt() ->> 'aal' IS DISTINCT FROM 'aal2' THEN
    RAISE EXCEPTION 'AAL2 authentication is required.';
  END IF;
  SELECT * INTO v_staff
  FROM public.staff_profiles
  WHERE id = auth.uid() AND is_active IS TRUE;
  IF NOT FOUND OR pg_catalog.lower(pg_catalog.btrim(v_staff.role)) <> 'subadmin' THEN
    RAISE EXCEPTION 'Active Sub-Admin account required to record individual payments.';
  END IF;
  IF auth.jwt() -> 'app_metadata' ->> 'role' IS DISTINCT FROM 'subadmin' THEN
    RAISE EXCEPTION 'Staff role claim does not match the active staff profile.';
  END IF;
  RETURN public.record_fine_payment_subadmin_internal(
    p_request_id, p_amount, p_payment_method, p_reference_number, p_note, p_idempotency_key
  );
END;
$function$;
ALTER FUNCTION public.record_fine_payment_v2(text, numeric, text, text, text, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.record_fine_payment_v2(text, numeric, text, text, text, uuid)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.record_fine_payment_v2(text, numeric, text, text, text, uuid)
  TO authenticated;

-- ============================================================================
-- 3. REVIEWER NAME MASKING AND get_book_reviews RECONCILIATION
-- ============================================================================
CREATE OR REPLACE FUNCTION public.mask_reviewer_name(p_name text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
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
  -- Strip [TEST] or [test] prefixes from synthetic testing data
  v_trimmed := pg_catalog.btrim(pg_catalog.regexp_replace(v_trimmed, '^\[test\]\s*', '', 'i'));
  IF v_trimmed = '' OR pg_catalog.lower(v_trimmed) = 'verified reader' THEN
    RETURN 'Verified Reader';
  END IF;
  -- If already masked (e.g. 'K*** M.' or 'J***') return as-is
  IF v_trimmed ~* '^[A-Z]\*{3}(\s[A-Z]\.)?$' THEN
    RETURN v_trimmed;
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

ALTER FUNCTION public.mask_reviewer_name(text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.mask_reviewer_name(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mask_reviewer_name(text) TO anon, authenticated, service_role;

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
        public.mask_reviewer_name(
          COALESCE(
            NULLIF(v.full_name, ''),
            NULLIF(review.visitor_name, ''),
            'Verified Reader'
          )
        )::text AS visitor_name,
        review.rating::integer,
        review.comment,
        review.created_at,
        (v_caller_visitor_id IS NOT NULL AND (review.visitor_id = v_caller_visitor_id OR review.visitor_id = v_caller_auth_uid::text)) AS is_own
    FROM public.book_reviews AS review
    LEFT JOIN public.visitors AS v ON (v.id = review.visitor_id OR v.auth_user_id::text = review.visitor_id)
    WHERE review.book_id = p_book_id
    ORDER BY review.created_at DESC
    LIMIT LEAST(GREATEST(p_limit, 1), 50)
    OFFSET GREATEST(p_offset, 0);
END;
$function$;

ALTER FUNCTION public.get_book_reviews(text, integer, integer) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_book_reviews(text, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_book_reviews(text, integer, integer) TO anon, authenticated, service_role;

-- ============================================================================
-- 4. RECONCILE create_visitor_notification AND visitor_notifications CONSTRAINTS
-- ============================================================================
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
    v_resolved_visitor_id text;
    v_ref_uuid uuid;
BEGIN
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

    IF p_reference_id IS NOT NULL AND p_reference_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
        v_ref_uuid := p_reference_id::uuid;
    ELSE
        v_ref_uuid := NULL;
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
        v_ref_uuid,
        p_reference_type,
        p_expires_at
    )
    RETURNING id INTO v_notification_id;

    RETURN v_notification_id;
END;
$function$;

ALTER FUNCTION public.create_visitor_notification(text, text, text, text, text, text, timestamptz) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.create_visitor_notification(text, text, text, text, text, text, timestamptz)
  FROM PUBLIC, anon, authenticated, service_role;

-- ============================================================================
-- 5. RECONCILE trg_notify_visitor_on_feedback_reply
-- ============================================================================
CREATE OR REPLACE FUNCTION public.fn_notify_visitor_on_feedback_reply()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_visitor_target text;
BEGIN
  IF NEW.admin_reply IS NOT NULL
     AND (OLD.admin_reply IS NULL OR OLD.admin_reply IS DISTINCT FROM NEW.admin_reply) THEN

    IF NEW.visitor_id IS NOT NULL THEN
      SELECT id INTO v_visitor_target
      FROM public.visitors
      WHERE id = NEW.visitor_id::text OR auth_user_id::text = NEW.visitor_id::text
      LIMIT 1;
    END IF;

    IF v_visitor_target IS NULL AND NEW.visitor_email IS NOT NULL THEN
      SELECT id INTO v_visitor_target
      FROM public.visitors
      WHERE email = NEW.visitor_email
      LIMIT 1;
    END IF;

    IF v_visitor_target IS NOT NULL THEN
      PERFORM public.create_visitor_notification(
        v_visitor_target,
        'feedback_reply',
        'Library Replied to Your Feedback',
        'The library has replied to your feedback regarding "' || pg_catalog.substr(COALESCE(NEW.subject, 'General Feedback'), 1, 40) || '".',
        NEW.id::text,
        'visitor_feedback',
        pg_catalog.now() + interval '30 days'
      );
    END IF;
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

-- ============================================================================
-- 6. RECONCILE COMMUNITY BOOKS READ LATER RPCS
-- ============================================================================
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
    AND (is_public IS TRUE OR lending_enabled IS TRUE);

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
    v_visitor_id := auth.uid()::text;
  END IF;

  DELETE FROM public.visitor_saved_community_books
  WHERE (visitor_id = v_visitor_id OR visitor_id = auth.uid()::text)
    AND (community_book_id = p_community_book_id OR community_book_id = pg_catalog.btrim(p_community_book_id));

  RETURN QUERY SELECT true::boolean, 'Book removed from saved list.'::text;
END;
$function$;

ALTER FUNCTION public.unsave_community_book_for_later(text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.unsave_community_book_for_later(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.unsave_community_book_for_later(text) TO authenticated, service_role;

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
    v_visitor_id := auth.uid()::text;
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
  WHERE (sb.visitor_id = v_visitor_id OR sb.visitor_id = auth.uid()::text)
    AND (b.is_public IS TRUE OR b.lending_enabled IS TRUE)
    AND b.book_type = 'personal'
  ORDER BY sb.saved_at DESC;
END;
$function$;

ALTER FUNCTION public.get_saved_community_books() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_saved_community_books() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_saved_community_books() TO authenticated, service_role;

-- Fine alert targets contain request and visitor identifiers. Require a real
-- active staff profile, AAL2, and an exact signed role claim before returning
-- those records. The internal detail function remains owner-only.
CREATE OR REPLACE FUNCTION public.get_fine_payment_alert_targets(p_library_id text DEFAULT NULL)
RETURNS TABLE(request_id text, visitor_id text, alerted_today boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_role text;
  v_jwt_role text;
  v_library_id uuid;
  v_target_library_id text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authenticated staff account required.';
  END IF;
  IF auth.jwt() ->> 'aal' IS DISTINCT FROM 'aal2' THEN
    RAISE EXCEPTION 'AAL2 authentication is required.';
  END IF;

  SELECT pg_catalog.lower(pg_catalog.btrim(staff.role)), staff.library_id
    INTO v_role, v_library_id
  FROM public.staff_profiles AS staff
  WHERE staff.id = v_uid AND staff.is_active IS TRUE;
  IF NOT FOUND OR v_role NOT IN ('subadmin', 'superadmin') THEN
    RAISE EXCEPTION 'Active library staff account required.';
  END IF;
  v_jwt_role := auth.jwt() -> 'app_metadata' ->> 'role';
  IF v_jwt_role IS DISTINCT FROM v_role THEN
    RAISE EXCEPTION 'Unauthorized staff role.';
  END IF;

  IF v_role = 'subadmin' THEN
    IF v_library_id IS NULL THEN
      RAISE EXCEPTION 'Active Sub-Admin account with an assigned library required.';
    END IF;
    IF p_library_id IS NOT NULL
       AND pg_catalog.btrim(p_library_id) <> ''
       AND p_library_id <> v_library_id::text THEN
      RAISE EXCEPTION 'You can only view fine alerts for your assigned library.';
    END IF;
    v_target_library_id := v_library_id::text;
  ELSE
    v_target_library_id := NULLIF(pg_catalog.btrim(p_library_id), '');
  END IF;

  RETURN QUERY
  SELECT * FROM public.get_fine_payment_alert_targets_detail_internal(v_target_library_id);
END;
$function$;

ALTER FUNCTION public.get_fine_payment_alert_targets(text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_fine_payment_alert_targets(text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.get_fine_payment_alert_targets(text) TO authenticated;

-- Restore the subscription workflows used by SubscriptionManagement with
-- explicit AAL2 and exact role-claim checks. These routines were left owner-only
-- by earlier hardening despite having authenticated frontend callers.
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
  IF p_requested_plan IS NULL OR p_requested_plan NOT IN ('basic', 'premium') THEN
    RAISE EXCEPTION 'Choose a valid plan.';
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
      'requestedPlan', v_requested_plan, 'note', NULLIF(pg_catalog.btrim(p_note), '')),
    v_staff.id, COALESCE(NULLIF(pg_catalog.btrim(v_staff.full_name), ''), v_staff.email)
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.follow_library_subscription_renewal(p_library_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_staff public.staff_profiles%ROWTYPE;
  v_renewal_date date;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authenticated super-admin account required.';
  END IF;
  IF auth.jwt() ->> 'aal' IS DISTINCT FROM 'aal2' THEN
    RAISE EXCEPTION 'AAL2 authentication is required.';
  END IF;
  SELECT * INTO v_staff FROM public.staff_profiles
  WHERE id = auth.uid() AND is_active IS TRUE
    AND pg_catalog.lower(role) = 'superadmin';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Only an active super-admin can schedule renewal reminders.';
  END IF;
  IF auth.jwt() -> 'app_metadata' ->> 'role' IS DISTINCT FROM 'superadmin' THEN
    RAISE EXCEPTION 'Unauthorized staff role.';
  END IF;
  SELECT subscription.renews_on INTO v_renewal_date
  FROM public.library_subscriptions AS subscription
  WHERE subscription.library_id = p_library_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Library subscription not found.';
  END IF;
  INSERT INTO public.subscription_renewal_follows (library_id, renewal_date, notification_sent_at)
  VALUES (p_library_id, v_renewal_date, NULL)
  ON CONFLICT (library_id, renewal_date)
  DO UPDATE SET notification_sent_at = NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION public.mark_subscription_renewal_notification_read(p_notification_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_staff public.staff_profiles%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authenticated sub-admin account required.';
  END IF;
  IF auth.jwt() ->> 'aal' IS DISTINCT FROM 'aal2' THEN
    RAISE EXCEPTION 'AAL2 authentication is required.';
  END IF;
  SELECT * INTO v_staff FROM public.staff_profiles
  WHERE id = auth.uid() AND is_active IS TRUE
    AND pg_catalog.lower(role) = 'subadmin';
  IF NOT FOUND OR v_staff.library_id IS NULL THEN
    RAISE EXCEPTION 'Active assigned sub-admin account required.';
  END IF;
  IF auth.jwt() -> 'app_metadata' ->> 'role' IS DISTINCT FROM 'subadmin' THEN
    RAISE EXCEPTION 'Unauthorized staff role.';
  END IF;
  UPDATE public.staff_notifications
  SET read_at = COALESCE(read_at, pg_catalog.now())
  WHERE id = p_notification_id
    AND recipient_staff_id = v_staff.id
    AND library_id = v_staff.library_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Subscription notification not found.';
  END IF;
END;
$function$;

ALTER FUNCTION public.request_subscription_upgrade(text,text) OWNER TO postgres;
ALTER FUNCTION public.decide_subscription_upgrade(uuid,text,text) OWNER TO postgres;
ALTER FUNCTION public.follow_library_subscription_renewal(uuid) OWNER TO postgres;
ALTER FUNCTION public.mark_subscription_renewal_notification_read(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.request_subscription_upgrade(text,text) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.decide_subscription_upgrade(uuid,text,text) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.follow_library_subscription_renewal(uuid) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.mark_subscription_renewal_notification_read(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.request_subscription_upgrade(text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.decide_subscription_upgrade(uuid,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.follow_library_subscription_renewal(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_subscription_renewal_notification_read(uuid) TO authenticated;

-- ============================================================================
-- 7. POSTFLIGHT INTEGRITY CHECKS
-- ============================================================================
DO $postflight$
BEGIN
  IF NOT EXISTS (
       SELECT 1 FROM pg_catalog.pg_proc AS procedure
       WHERE procedure.oid = 'public.get_fine_payment_alert_targets(text)'::pg_catalog.regprocedure
         AND pg_catalog.strpos(pg_catalog.pg_get_functiondef(procedure.oid),
           'auth.jwt() ->> ''aal'' IS DISTINCT FROM ''aal2''') > 0
         AND pg_catalog.strpos(pg_catalog.pg_get_functiondef(procedure.oid),
           'v_jwt_role IS DISTINCT FROM v_role') > 0
     )
     OR pg_catalog.has_function_privilege('anon', 'public.get_fine_payment_alert_targets(text)', 'EXECUTE')
     OR NOT pg_catalog.has_function_privilege('authenticated', 'public.get_fine_payment_alert_targets(text)', 'EXECUTE')
     OR pg_catalog.has_function_privilege('service_role', 'public.get_fine_payment_alert_targets(text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Fine alert targets must require AAL2 and the exact active staff role claim, with authenticated-only EXECUTE.';
  END IF;

  IF pg_catalog.has_function_privilege('anon', 'shelf_private.request_borrow_unchecked(uuid,text)'::regprocedure, 'EXECUTE')
     OR pg_catalog.has_function_privilege('authenticated', 'shelf_private.request_borrow_unchecked(uuid,text)'::regprocedure, 'EXECUTE')
     OR pg_catalog.has_function_privilege('service_role', 'shelf_private.request_borrow_unchecked(uuid,text)'::regprocedure, 'EXECUTE') THEN
    RAISE EXCEPTION 'Unchecked borrow implementation must remain owner-only';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'get_library_subscription_dashboard'
  ) THEN
    RAISE EXCEPTION 'Postflight Failed: get_library_subscription_dashboard not found';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'mask_reviewer_name'
  ) THEN
    RAISE EXCEPTION 'Postflight Failed: mask_reviewer_name not found';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'get_saved_community_books'
  ) THEN
    RAISE EXCEPTION 'Postflight Failed: get_saved_community_books not found';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'confirm_pickup'
      AND pg_get_function_identity_arguments(p.oid) = 'p_request_id text, p_staff_name text'
  ) THEN
    RAISE EXCEPTION 'Postflight Failed: confirm_pickup(text, text) not found';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'confirm_pickup'
      AND pg_get_function_identity_arguments(p.oid) = 'p_request_id uuid, p_staff_name text'
  ) THEN
    RAISE EXCEPTION 'Postflight Failed: confirm_pickup(uuid, text) not found';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'confirm_return'
      AND pg_get_function_identity_arguments(p.oid) = 'p_request_id text, p_staff_name text'
  ) THEN
    RAISE EXCEPTION 'Postflight Failed: confirm_return(text, text) not found';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'confirm_return'
      AND pg_get_function_identity_arguments(p.oid) = 'p_request_id uuid, p_staff_name text'
  ) THEN
    RAISE EXCEPTION 'Postflight Failed: confirm_return(uuid, text) not found';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'record_fine_payment_subadmin_internal'
      AND pg_get_function_identity_arguments(p.oid) =
          'p_request_id text, p_amount numeric, p_payment_method text, p_reference_number text, p_note text, p_idempotency_key uuid'
  ) THEN
    RAISE EXCEPTION 'Postflight Failed: idempotent internal fine-payment function not found';
  END IF;
END;
$postflight$;

DO $security_postflight$
DECLARE
  v_signature regprocedure;
  v_privileged_signatures regprocedure[] := ARRAY[
    'public.confirm_pickup(text,text)'::regprocedure,
    'public.confirm_pickup(uuid,text)'::regprocedure,
    'public.confirm_return(text,text)'::regprocedure,
    'public.confirm_return(uuid,text)'::regprocedure
  ];
BEGIN
  IF NOT EXISTS (
       SELECT 1 FROM pg_catalog.pg_proc AS p
       WHERE p.oid = 'public.accept_subadmin_terms()'::regprocedure
         AND p.proowner = 'postgres'::regrole
         AND p.prosecdef IS TRUE
         AND p.proconfig = ARRAY['search_path=""']::text[]
     )
     OR pg_catalog.has_function_privilege('anon', 'public.accept_subadmin_terms()'::regprocedure, 'EXECUTE')
     OR pg_catalog.strpos(pg_catalog.pg_get_functiondef('public.accept_subadmin_terms()'::regprocedure), 'IS DISTINCT FROM ''aal2''') = 0
     OR pg_catalog.strpos(pg_catalog.pg_get_functiondef('public.accept_subadmin_terms()'::regprocedure), 'v_jwt_role IS DISTINCT FROM staff_row.role') = 0
     OR pg_catalog.pg_get_functiondef('public.accept_subadmin_terms()'::regprocedure) ~* 'coalesce[[:space:]]*\([[:space:]]*auth\.jwt\(\)' THEN
    RAISE EXCEPTION 'Subadmin terms function is not fail-closed on AAL2 and exact role claims';
  END IF;

  IF pg_catalog.has_function_privilege('anon', 'public.get_fine_payment_alert_targets_detail_internal(text)'::regprocedure, 'EXECUTE')
     OR pg_catalog.has_function_privilege('authenticated', 'public.get_fine_payment_alert_targets_detail_internal(text)'::regprocedure, 'EXECUTE')
     OR pg_catalog.has_function_privilege('service_role', 'public.get_fine_payment_alert_targets_detail_internal(text)'::regprocedure, 'EXECUTE') THEN
    RAISE EXCEPTION 'Fine alert detail helper must remain owner-only';
  END IF;

  FOREACH v_signature IN ARRAY v_privileged_signatures LOOP
    IF EXISTS (
         SELECT 1 FROM pg_catalog.pg_proc AS p
         CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(p.proacl, pg_catalog.acldefault('f', p.proowner))) AS acl
         WHERE p.oid = v_signature AND acl.grantee = 0::oid AND acl.privilege_type = 'EXECUTE'
       )
       OR pg_catalog.has_function_privilege('anon', v_signature, 'EXECUTE')
       OR pg_catalog.has_function_privilege('authenticated', v_signature, 'EXECUTE')
       OR pg_catalog.has_function_privilege('service_role', v_signature, 'EXECUTE')
       OR NOT EXISTS (
         SELECT 1 FROM pg_catalog.pg_proc AS p
         WHERE p.oid = v_signature
           AND p.proowner = 'postgres'::regrole
           AND p.prosecdef IS TRUE
           AND p.proconfig = ARRAY['search_path=""']::text[]
       ) THEN
      RAISE EXCEPTION 'Legacy handover overload must be owner-only with canonical SECURITY DEFINER metadata: %', v_signature;
    END IF;
  END LOOP;

  IF pg_catalog.has_function_privilege('anon', 'public.get_library_subscription_dashboard(text)'::regprocedure, 'EXECUTE')
     OR pg_catalog.has_function_privilege('service_role', 'public.get_library_subscription_dashboard(text)'::regprocedure, 'EXECUTE')
     OR NOT pg_catalog.has_function_privilege('authenticated', 'public.get_library_subscription_dashboard(text)'::regprocedure, 'EXECUTE')
     OR EXISTS (
       SELECT 1 FROM pg_catalog.pg_proc AS p
       CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(p.proacl, pg_catalog.acldefault('f', p.proowner))) AS acl
       WHERE p.oid = 'public.get_library_subscription_dashboard(text)'::regprocedure
         AND acl.grantee = 0::oid AND acl.privilege_type = 'EXECUTE'
     )
     OR NOT EXISTS (
       SELECT 1 FROM pg_catalog.pg_proc AS p
       WHERE p.oid = 'public.get_library_subscription_dashboard(text)'::regprocedure
         AND p.proowner = 'postgres'::regrole
         AND p.prosecdef IS TRUE
         AND p.proconfig = ARRAY['search_path=""']::text[]
     ) THEN
    RAISE EXCEPTION 'Subscription dashboard signature, grants, or security metadata are not canonical';
  END IF;

  FOREACH v_signature IN ARRAY ARRAY[
    'public.confirm_pickup_v2(text,text)'::regprocedure,
    'public.confirm_return_v2(text,text)'::regprocedure
  ] LOOP
    IF EXISTS (
         SELECT 1 FROM pg_catalog.pg_proc AS p
         CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(p.proacl, pg_catalog.acldefault('f', p.proowner))) AS acl
         WHERE p.oid = v_signature AND acl.grantee = 0::oid AND acl.privilege_type = 'EXECUTE'
       )
       OR pg_catalog.has_function_privilege('anon', v_signature, 'EXECUTE')
       OR NOT pg_catalog.has_function_privilege('authenticated', v_signature, 'EXECUTE')
       OR pg_catalog.has_function_privilege('service_role', v_signature, 'EXECUTE')
       OR NOT EXISTS (
         SELECT 1 FROM pg_catalog.pg_proc AS p
         WHERE p.oid = v_signature
           AND p.proowner = 'postgres'::regrole
           AND p.prosecdef IS TRUE
           AND p.proconfig = ARRAY['search_path=""']::text[]
       ) THEN
      RAISE EXCEPTION 'Handover v2 RPC grants or SECURITY DEFINER metadata are not canonical: %', v_signature;
    END IF;
  END LOOP;

  IF EXISTS (
       SELECT 1 FROM pg_catalog.pg_proc AS p
       CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(p.proacl, pg_catalog.acldefault('f', p.proowner))) AS acl
       WHERE p.oid = 'public.create_visitor_notification(text,text,text,text,text,text,timestamptz)'::regprocedure
         AND acl.grantee = 0::oid AND acl.privilege_type = 'EXECUTE'
     )
     OR pg_catalog.has_function_privilege('anon', 'public.create_visitor_notification(text,text,text,text,text,text,timestamptz)'::regprocedure, 'EXECUTE')
     OR pg_catalog.has_function_privilege('authenticated', 'public.create_visitor_notification(text,text,text,text,text,text,timestamptz)'::regprocedure, 'EXECUTE')
     OR pg_catalog.has_function_privilege('service_role', 'public.create_visitor_notification(text,text,text,text,text,text,timestamptz)'::regprocedure, 'EXECUTE') THEN
    RAISE EXCEPTION 'create_visitor_notification must remain owner-only';
  END IF;

  IF pg_catalog.has_function_privilege('authenticated', 'public.record_fine_payment(text,numeric,text,text,text)'::regprocedure, 'EXECUTE')
     OR pg_catalog.has_function_privilege('authenticated', 'public.record_fine_payment_subadmin_internal(text,numeric,text,text,text)'::regprocedure, 'EXECUTE')
     OR EXISTS (
       SELECT 1 FROM pg_catalog.pg_proc AS p
       CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(p.proacl, pg_catalog.acldefault('f', p.proowner))) AS acl
       WHERE p.oid = 'public.record_fine_payment_v2(text,numeric,text,text,text,uuid)'::regprocedure
         AND acl.grantee = 0::oid AND acl.privilege_type = 'EXECUTE'
     )
     OR pg_catalog.has_function_privilege('anon', 'public.record_fine_payment_v2(text,numeric,text,text,text,uuid)'::regprocedure, 'EXECUTE')
     OR pg_catalog.has_function_privilege('service_role', 'public.record_fine_payment_v2(text,numeric,text,text,text,uuid)'::regprocedure, 'EXECUTE')
     OR NOT pg_catalog.has_function_privilege('authenticated', 'public.record_fine_payment_v2(text,numeric,text,text,text,uuid)'::regprocedure, 'EXECUTE') THEN
    RAISE EXCEPTION 'Fine-payment endpoint grants are not canonical';
  END IF;

  IF NOT EXISTS (
       SELECT 1 FROM pg_catalog.pg_class AS c
       WHERE c.oid = 'public.fine_payment_idempotency'::regclass
         AND c.relowner = 'postgres'::regrole
         AND c.relrowsecurity IS TRUE
     )
     OR EXISTS (
       SELECT 1 FROM pg_catalog.pg_class AS relation
       CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(relation.relacl, pg_catalog.acldefault('r', relation.relowner))) AS acl
       WHERE relation.oid = 'public.fine_payment_idempotency'::regclass
         AND acl.grantee = 0::oid
     )
     OR pg_catalog.has_table_privilege('anon', 'public.fine_payment_idempotency', 'SELECT')
     OR pg_catalog.has_table_privilege('anon', 'public.fine_payment_idempotency', 'INSERT')
     OR pg_catalog.has_table_privilege('anon', 'public.fine_payment_idempotency', 'UPDATE')
     OR pg_catalog.has_table_privilege('anon', 'public.fine_payment_idempotency', 'DELETE')
     OR pg_catalog.has_table_privilege('authenticated', 'public.fine_payment_idempotency', 'SELECT')
     OR pg_catalog.has_table_privilege('authenticated', 'public.fine_payment_idempotency', 'INSERT')
     OR pg_catalog.has_table_privilege('authenticated', 'public.fine_payment_idempotency', 'UPDATE')
     OR pg_catalog.has_table_privilege('authenticated', 'public.fine_payment_idempotency', 'DELETE')
     OR pg_catalog.has_table_privilege('service_role', 'public.fine_payment_idempotency', 'SELECT')
     OR pg_catalog.has_table_privilege('service_role', 'public.fine_payment_idempotency', 'INSERT')
     OR pg_catalog.has_table_privilege('service_role', 'public.fine_payment_idempotency', 'UPDATE')
     OR pg_catalog.has_table_privilege('service_role', 'public.fine_payment_idempotency', 'DELETE')
     OR NOT EXISTS (
       SELECT 1 FROM pg_catalog.pg_constraint AS c
       WHERE c.conrelid = 'public.fine_payment_idempotency'::regclass
         AND c.conname = 'fine_payment_idempotency_pkey'
         AND c.contype = 'p'
         AND c.convalidated IS TRUE
     ) THEN
    RAISE EXCEPTION 'Fine-payment idempotency receipt table is not private and constrained';
  END IF;
END;
$security_postflight$;

NOTIFY pgrst, 'reload schema';

COMMIT;
