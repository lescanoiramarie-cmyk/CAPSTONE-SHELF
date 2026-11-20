-- Reconcile system defects across library subscriptions, transaction handovers,
-- auto-return upon fine payment, and visitor borrow cancellations.
BEGIN;

-- ============================================================================
-- 1. FIX get_library_subscription_dashboard (Fix missing FROM-clause error)
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
SET search_path = public, pg_catalog, pg_temp
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
      WHEN s.plan_mode = 'trial' AND s.renews_on >= v_current_date THEN 'trial'
      WHEN v_current_date > s.renews_on + s.grace_period_days THEN 'suspended'
      WHEN v_current_date > s.renews_on THEN 'past_due'
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
-- 2. FIX confirm_pickup and confirm_return (Cast UUID = TEXT properly)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.confirm_pickup(p_request_id text, p_staff_name text)
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
  v_id_is_uuid boolean;
  v_req_id text := pg_catalog.btrim(COALESCE(p_request_id, ''));
  v_staff_name text := pg_catalog.btrim(COALESCE(p_staff_name, ''));
BEGIN
  IF auth.uid() IS NULL OR auth.jwt() ->> 'aal' IS DISTINCT FROM 'aal2' THEN
    RAISE EXCEPTION 'Authenticated AAL2 staff session required.';
  END IF;
  SELECT sp.role, sp.library_id INTO v_staff_role, v_staff_library_id
  FROM public.staff_profiles AS sp
  WHERE sp.id = auth.uid() AND sp.is_active IS TRUE;
  IF v_staff_role NOT IN ('superadmin', 'subadmin')
     OR auth.jwt() -> 'app_metadata' ->> 'role' IS DISTINCT FROM v_staff_role THEN
    RAISE EXCEPTION 'Unauthorized staff role.';
  END IF;
  IF v_req_id = '' OR v_staff_name = '' THEN
    RAISE EXCEPTION 'A request ID and staff name are required.';
  END IF;
  SELECT a.atttypid = 'uuid'::pg_catalog.regtype INTO v_id_is_uuid
  FROM pg_catalog.pg_attribute AS a
  WHERE a.attrelid = 'public.borrow_requests'::pg_catalog.regclass
    AND a.attname = 'id' AND a.attnum > 0 AND NOT a.attisdropped;
  IF v_id_is_uuid IS NULL THEN RAISE EXCEPTION 'Could not verify borrow_requests.id type.'; END IF;
  IF v_id_is_uuid AND v_req_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RAISE EXCEPTION 'Invalid UUID request ID format.';
  END IF;
  SELECT br.* INTO v_req FROM public.borrow_requests AS br
  WHERE br.id::text = v_req_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Request not found.'; END IF;
  SELECT b.library_id INTO v_book_library_id FROM public.books AS b WHERE b.id::text = v_req.book_id::text;
  IF NOT FOUND THEN RAISE EXCEPTION 'Book not found.'; END IF;
  IF v_staff_role = 'subadmin' AND v_staff_library_id IS DISTINCT FROM v_book_library_id THEN
    RAISE EXCEPTION 'You are not authorized to process this branch.';
  END IF;
  IF v_req.status NOT IN ('pending', 'approved', 'ready_for_pickup') THEN
    RAISE EXCEPTION 'This request is not ready for pickup confirmation.';
  END IF;
  UPDATE public.borrow_requests
     SET status = 'borrowed', borrow_date = pg_catalog.now(),
         due_date = pg_catalog.now() + pg_catalog.interval '14 days', confirmed_by = v_staff_name
   WHERE id::text = v_req_id;
END;
$function$;
ALTER FUNCTION public.confirm_pickup(text, text) OWNER TO postgres;
ALTER FUNCTION public.confirm_pickup(text, text) SET search_path = '';
REVOKE ALL ON FUNCTION public.confirm_pickup(text, text) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.confirm_return(p_request_id text, p_staff_name text)
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
  v_id_is_uuid boolean;
  v_req_id text := pg_catalog.btrim(COALESCE(p_request_id, ''));
  v_staff_name text := pg_catalog.btrim(COALESCE(p_staff_name, ''));
  v_overdue_days integer := 0;
  v_fine numeric(10, 2) := 0;
BEGIN
  IF auth.uid() IS NULL OR auth.jwt() ->> 'aal' IS DISTINCT FROM 'aal2' THEN
    RAISE EXCEPTION 'Authenticated AAL2 staff session required.';
  END IF;
  SELECT sp.role, sp.library_id INTO v_staff_role, v_staff_library_id
  FROM public.staff_profiles AS sp
  WHERE sp.id = auth.uid() AND sp.is_active IS TRUE;
  IF v_staff_role NOT IN ('superadmin', 'subadmin')
     OR auth.jwt() -> 'app_metadata' ->> 'role' IS DISTINCT FROM v_staff_role THEN
    RAISE EXCEPTION 'Unauthorized staff role.';
  END IF;
  IF v_req_id = '' OR v_staff_name = '' THEN
    RAISE EXCEPTION 'A request ID and staff name are required.';
  END IF;
  SELECT a.atttypid = 'uuid'::pg_catalog.regtype INTO v_id_is_uuid
  FROM pg_catalog.pg_attribute AS a
  WHERE a.attrelid = 'public.borrow_requests'::pg_catalog.regclass
    AND a.attname = 'id' AND a.attnum > 0 AND NOT a.attisdropped;
  IF v_id_is_uuid IS NULL THEN RAISE EXCEPTION 'Could not verify borrow_requests.id type.'; END IF;
  IF v_id_is_uuid AND v_req_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RAISE EXCEPTION 'Invalid UUID request ID format.';
  END IF;
  SELECT br.* INTO v_req FROM public.borrow_requests AS br
  WHERE br.id::text = v_req_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Request not found.'; END IF;
  SELECT b.library_id, b.fine_rate INTO v_book_library_id, v_book_fine_rate
  FROM public.books AS b WHERE b.id::text = v_req.book_id::text;
  IF NOT FOUND THEN RAISE EXCEPTION 'Book not found.'; END IF;
  IF v_staff_role = 'subadmin' AND v_staff_library_id IS DISTINCT FROM v_book_library_id THEN
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
    v_fine := GREATEST(COALESCE(v_req.fine_amount, 0), v_overdue_days * v_effective_fine_rate);
    UPDATE public.borrow_requests
       SET status = 'returned', return_date = pg_catalog.now(), fine_amount = v_fine,
           fine_rate_snapshot = v_effective_fine_rate, fine_review_required = false,
           return_confirmed_by = v_staff_name
     WHERE id::text = v_req_id;
  ELSE
    UPDATE public.borrow_requests
       SET status = 'returned', return_date = pg_catalog.now(),
           fine_amount = GREATEST(COALESCE(v_req.fine_amount, 0), 0),
           fine_review_required = false, return_confirmed_by = v_staff_name
     WHERE id::text = v_req_id;
  END IF;

  PERFORM public.release_copy_and_promote(v_req.book_id::text);
END;
$function$;
ALTER FUNCTION public.confirm_return(text, text) OWNER TO postgres;
ALTER FUNCTION public.confirm_return(text, text) SET search_path = '';
REVOKE ALL ON FUNCTION public.confirm_return(text, text) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.confirm_pickup_v2(p_request_id text, p_staff_name text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_staff public.staff_profiles%rowtype;
  v_req_id text := pg_catalog.btrim(COALESCE(p_request_id, ''));
  v_staff_name text := pg_catalog.btrim(COALESCE(p_staff_name, ''));
  v_request_exists boolean;
BEGIN
  IF auth.uid() IS NULL OR auth.jwt() ->> 'aal' IS DISTINCT FROM 'aal2' THEN
    RAISE EXCEPTION 'Authenticated AAL2 staff session required.';
  END IF;
  SELECT * INTO v_staff FROM public.staff_profiles
  WHERE id = auth.uid() AND is_active IS TRUE;
  IF NOT FOUND OR v_staff.role NOT IN ('superadmin', 'subadmin')
     OR auth.jwt() -> 'app_metadata' ->> 'role' IS DISTINCT FROM v_staff.role THEN
    RAISE EXCEPTION 'Unauthorized staff role.';
  END IF;
  IF v_req_id = '' OR v_staff_name = '' THEN RAISE EXCEPTION 'A request ID and staff name are required.'; END IF;
  SELECT EXISTS (
    SELECT 1 FROM public.borrow_requests AS request
    JOIN public.books AS book ON book.id::text = request.book_id::text
    WHERE request.id::text = v_req_id
      AND (v_staff.role = 'superadmin' OR book.library_id = v_staff.library_id)
  ) INTO v_request_exists;
  IF NOT v_request_exists THEN RAISE EXCEPTION 'Request not found or branch access denied.'; END IF;
  PERFORM public.confirm_pickup(v_req_id, v_staff_name);
END;
$function$;
ALTER FUNCTION public.confirm_pickup_v2(text, text) OWNER TO postgres;
ALTER FUNCTION public.confirm_pickup_v2(text, text) SET search_path = '';
REVOKE ALL ON FUNCTION public.confirm_pickup_v2(text, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.confirm_pickup_v2(text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.confirm_return_v2(p_request_id text, p_staff_name text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_staff public.staff_profiles%rowtype;
  v_req_id text := pg_catalog.btrim(COALESCE(p_request_id, ''));
  v_staff_name text := pg_catalog.btrim(COALESCE(p_staff_name, ''));
  v_request_exists boolean;
BEGIN
  IF auth.uid() IS NULL OR auth.jwt() ->> 'aal' IS DISTINCT FROM 'aal2' THEN
    RAISE EXCEPTION 'Authenticated AAL2 staff session required.';
  END IF;
  SELECT * INTO v_staff FROM public.staff_profiles
  WHERE id = auth.uid() AND is_active IS TRUE;
  IF NOT FOUND OR v_staff.role NOT IN ('superadmin', 'subadmin')
     OR auth.jwt() -> 'app_metadata' ->> 'role' IS DISTINCT FROM v_staff.role THEN
    RAISE EXCEPTION 'Unauthorized staff role.';
  END IF;
  IF v_req_id = '' OR v_staff_name = '' THEN RAISE EXCEPTION 'A request ID and staff name are required.'; END IF;
  SELECT EXISTS (
    SELECT 1 FROM public.borrow_requests AS request
    JOIN public.books AS book ON book.id::text = request.book_id::text
    WHERE request.id::text = v_req_id
      AND (v_staff.role = 'superadmin' OR book.library_id = v_staff.library_id)
  ) INTO v_request_exists;
  IF NOT v_request_exists THEN RAISE EXCEPTION 'Request not found or branch access denied.'; END IF;
  PERFORM public.confirm_return(v_req_id, v_staff_name);
END;
$function$;
ALTER FUNCTION public.confirm_return_v2(text, text) OWNER TO postgres;
ALTER FUNCTION public.confirm_return_v2(text, text) SET search_path = '';
REVOKE ALL ON FUNCTION public.confirm_return_v2(text, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.confirm_return_v2(text, text) TO authenticated;

-- ============================================================================
-- 3. FIX record_fine_payment_subadmin_internal (Auto-confirm return when paid)
-- ============================================================================
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
  v_request_id_is_uuid boolean;
  v_request_identity text;
  v_existing_request_id text;
  v_existing_amount numeric(10, 2);
  v_existing_method text;
  v_existing_reference text;
  v_existing_note text;
  v_staff_name text;
  v_amount numeric := pg_catalog.round(p_amount, 2);
  v_trimmed_id text := pg_catalog.btrim(COALESCE(p_request_id, ''));
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authenticated staff account required.'; END IF;
  IF auth.jwt() ->> 'aal' IS DISTINCT FROM 'aal2' THEN
    RAISE EXCEPTION 'AAL2 authentication is required.';
  END IF;
  SELECT * INTO v_staff FROM public.staff_profiles
  WHERE id = auth.uid() AND is_active IS TRUE;
  IF NOT FOUND OR pg_catalog.lower(pg_catalog.btrim(v_staff.role)) NOT IN ('superadmin', 'subadmin') THEN
    RAISE EXCEPTION 'Active staff profile required.';
  END IF;
  IF auth.jwt() -> 'app_metadata' ->> 'role' IS DISTINCT FROM pg_catalog.lower(pg_catalog.btrim(v_staff.role)) THEN
    RAISE EXCEPTION 'Unauthorized staff role.';
  END IF;
  IF v_amount IS NULL OR v_amount <= 0 THEN RAISE EXCEPTION 'Enter a payment amount greater than zero.'; END IF;
  IF p_payment_method IS NULL OR p_payment_method NOT IN ('cash', 'bank_transfer', 'other') THEN
    RAISE EXCEPTION 'Choose a valid payment method.';
  END IF;
  IF p_idempotency_key IS NULL THEN RAISE EXCEPTION 'An idempotency key is required.'; END IF;
  IF v_trimmed_id = '' THEN RAISE EXCEPTION 'Borrow request ID is required.'; END IF;

  SELECT a.atttypid = 'uuid'::pg_catalog.regtype INTO v_request_id_is_uuid
  FROM pg_catalog.pg_attribute AS a
  WHERE a.attrelid = 'public.borrow_requests'::pg_catalog.regclass
    AND a.attname = 'id' AND a.attnum > 0 AND NOT a.attisdropped;
  IF v_request_id_is_uuid IS NULL THEN RAISE EXCEPTION 'Could not verify borrow_requests.id type.'; END IF;
  IF v_request_id_is_uuid THEN
    IF v_trimmed_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      RAISE EXCEPTION 'Invalid UUID borrow request ID format.';
    END IF;
    v_request_identity := v_trimmed_id::uuid::text;
  ELSE
    v_request_identity := v_trimmed_id;
  END IF;

  SELECT br.* INTO v_request FROM public.borrow_requests AS br
  WHERE br.id::text = v_request_identity FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Borrow request not found.'; END IF;
  SELECT b.library_id, b.fine_rate INTO v_library_id, v_book_fine_rate
  FROM public.books AS b WHERE b.id::text = v_request.book_id::text;
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
  WHERE receipt.received_by = v_staff.id AND receipt.idempotency_key = p_idempotency_key;
  IF FOUND THEN
    IF v_existing_request_id IS DISTINCT FROM v_request_identity
       OR v_existing_amount IS DISTINCT FROM v_amount
       OR v_existing_method IS DISTINCT FROM p_payment_method
       OR v_existing_reference IS DISTINCT FROM NULLIF(pg_catalog.btrim(p_reference_number), '')
       OR v_existing_note IS DISTINCT FROM NULLIF(pg_catalog.btrim(p_note), '') THEN
      RAISE EXCEPTION 'Idempotency key was already used for a different payment.';
    END IF;
    RETURN jsonb_build_object(
      'paymentId', v_payment_id, 'requestId', v_request_identity,
      'amount', v_amount, 'remainingBalance', v_remaining
    );
  END IF;
  IF v_remaining <= 0 THEN RAISE EXCEPTION 'This fine has already been paid in full.'; END IF;
  IF v_amount > v_remaining THEN
    RAISE EXCEPTION 'Payment cannot exceed the outstanding balance of %.', to_char(v_remaining, 'FM999999990.00');
  END IF;

  v_staff_name := COALESCE(NULLIF(pg_catalog.btrim(v_staff.full_name), ''), v_staff.email);

  INSERT INTO public.fine_payments (
    borrow_request_id, amount, payment_method, reference_number,
    note, received_by, received_by_name
  ) VALUES (
    v_request.id::text, v_amount, p_payment_method,
    NULLIF(pg_catalog.btrim(p_reference_number), ''), NULLIF(pg_catalog.btrim(p_note), ''),
    v_staff.id, v_staff_name
  ) RETURNING id INTO v_payment_id;

  INSERT INTO public.fine_payment_idempotency (
    received_by, idempotency_key, request_id, amount, payment_method,
    reference_number, note, payment_id
  ) VALUES (
    v_staff.id, p_idempotency_key, v_request_identity, v_amount, p_payment_method,
    NULLIF(pg_catalog.btrim(p_reference_number), ''), NULLIF(pg_catalog.btrim(p_note), ''), v_payment_id
  );

  -- If payment covers the full remaining fine and the book is currently borrowed, auto-confirm return
  IF v_remaining - v_amount <= 0 AND v_request.status = 'borrowed' THEN
    UPDATE public.borrow_requests
       SET status = 'returned',
           return_date = pg_catalog.now(),
           return_confirmed_by = v_staff_name,
           fine_paid_amount = COALESCE(fine_paid_amount, 0) + v_amount,
           fine_amount = GREATEST(COALESCE(fine_amount, 0), v_fine_amount),
           fine_review_required = false
     WHERE id::text = v_request_identity;

    PERFORM public.release_copy_and_promote(v_request.book_id::text);
  ELSE
    UPDATE public.borrow_requests
       SET fine_paid_amount = COALESCE(fine_paid_amount, 0) + v_amount,
           fine_amount = GREATEST(COALESCE(fine_amount, 0), v_fine_amount)
     WHERE id::text = v_request_identity;
  END IF;

  RETURN jsonb_build_object(
    'paymentId', v_payment_id, 'requestId', v_request.id,
    'amount', v_amount, 'remainingBalance', GREATEST(v_remaining - v_amount, 0)
  );
END;
$function$;
ALTER FUNCTION public.record_fine_payment_subadmin_internal(text, numeric, text, text, text, uuid) OWNER TO postgres;
ALTER FUNCTION public.record_fine_payment_subadmin_internal(text, numeric, text, text, text, uuid) SET search_path = '';
REVOKE ALL ON FUNCTION public.record_fine_payment_subadmin_internal(text, numeric, text, text, text, uuid) FROM PUBLIC, anon, authenticated, service_role;

-- ============================================================================
-- 4. FIX cancel_borrow_request (Support pending requests and resilient visitor check)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.cancel_borrow_request(
    p_request_id text,
    p_visitor_id text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_req public.borrow_requests%rowtype;
    v_visitor public.visitors%rowtype;
    v_clean_req_id text := pg_catalog.btrim(COALESCE(p_request_id, ''));
    v_clean_vis_id text := pg_catalog.btrim(COALESCE(p_visitor_id, ''));
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Authentication required.';
    END IF;

    -- Verify visitor ownership against session
    SELECT v.*
    INTO v_visitor
    FROM public.visitors AS v
    WHERE v.auth_user_id = auth.uid()
       OR v.id = auth.uid()::text
    LIMIT 1;

    IF v_visitor.id IS NULL THEN
        RAISE EXCEPTION 'Visitor account not found.';
    END IF;

    IF v_visitor.id <> v_clean_vis_id AND v_visitor.auth_user_id::text <> v_clean_vis_id THEN
        RAISE EXCEPTION 'You can only cancel your own requests.';
    END IF;

    SELECT request.*
    INTO v_req
    FROM public.borrow_requests AS request
    WHERE request.id::text = v_clean_req_id
      AND (request.visitor_id = v_visitor.id OR request.visitor_id = v_visitor.auth_user_id::text)
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Request not found.';
    END IF;

    -- Allow pending, queued, and ready_for_pickup requests to be cancelled
    IF v_req.status NOT IN ('pending', 'queued', 'ready_for_pickup') THEN
        RAISE EXCEPTION 'Only pending, queued, or ready-for-pickup requests can be cancelled.';
    END IF;

    -- Release copy if it was ready for pickup
    IF v_req.status = 'ready_for_pickup' THEN
        PERFORM public.release_copy_and_promote(v_req.book_id::text);
    END IF;

    UPDATE public.borrow_requests
    SET status = 'cancelled',
        cancel_reason = 'Cancelled by visitor'
    WHERE id::text = v_clean_req_id;

    -- Notification: borrow_cancelled
    PERFORM public.create_visitor_notification(
        v_visitor.id,
        'borrow_cancelled',
        'Request cancelled',
        'Your borrow request for "' || v_req.book_title || '" has been cancelled.',
        v_req.id::text,
        'borrow_request',
        pg_catalog.now() + pg_catalog.interval '7 days'
    );
END;
$function$;

ALTER FUNCTION public.cancel_borrow_request(text, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.cancel_borrow_request(text, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.cancel_borrow_request(text, text) TO authenticated;

-- ============================================================================
-- 5. FIX get_visitor_borrowing_history (Match visitor flexibly & keep full history)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.get_visitor_borrowing_history()
RETURNS TABLE (
  id text,
  book_id text,
  book_title text,
  visitor_id text,
  visitor_name text,
  library_id uuid,
  status text,
  request_date timestamp with time zone,
  pickup_deadline timestamp with time zone,
  queue_position integer,
  borrow_date timestamp with time zone,
  due_date timestamp with time zone,
  return_date timestamp with time zone,
  fine_amount numeric,
  fine_paid_amount numeric,
  confirmed_by text,
  return_confirmed_by text,
  fine_rate_snapshot integer,
  fine_review_required boolean,
  fine_review_resolved_at timestamp with time zone
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_uid uuid;
  v_visitor public.visitors%ROWTYPE;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authenticated visitor session required.';
  END IF;

  SELECT v.* INTO v_visitor
  FROM public.visitors AS v
  WHERE (v.auth_user_id = v_uid OR v.id = v_uid::text)
    AND v.otp_verified IS TRUE
    AND v.is_active IS TRUE
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Active, verified visitor account required.';
  END IF;

  RETURN QUERY
  SELECT
    br.id::text,
    br.book_id::text,
    br.book_title::text,
    br.visitor_id::text,
    br.visitor_name::text,
    br.library_id,
    br.status::text,
    br.request_date,
    br.pickup_deadline,
    br.queue_position,
    br.borrow_date,
    br.due_date,
    br.return_date,
    br.fine_amount::numeric,
    br.fine_paid_amount::numeric,
    br.confirmed_by::text,
    br.return_confirmed_by::text,
    br.fine_rate_snapshot,
    (
      COALESCE(br.fine_review_required, false)
      OR (
        COALESCE(br.fine_amount, 0) <> 0
        AND (
          br.status <> 'returned'
          OR br.fine_rate_snapshot IS NULL
          OR br.fine_rate_snapshot NOT IN (10, 15, 20)
        )
      )
      OR (
        br.status IN ('borrowed', 'returned')
        AND (
          br.fine_rate_snapshot IS NULL
          OR br.fine_rate_snapshot NOT IN (10, 15, 20)
        )
      )
    ) AS fine_review_required,
    br.fine_review_resolved_at
  FROM public.borrow_requests AS br
  WHERE br.visitor_id = v_visitor.id
     OR br.visitor_id = v_visitor.auth_user_id::text
  ORDER BY br.request_date DESC, br.id ASC;
END;
$function$;

ALTER FUNCTION public.get_visitor_borrowing_history() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_visitor_borrowing_history() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_visitor_borrowing_history() TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
