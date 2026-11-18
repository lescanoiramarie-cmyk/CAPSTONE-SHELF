-- Harden remaining transaction-critical SECURITY DEFINER functions
-- Add AAL2 checks, empty search_path, and verify least-privilege grants
-- Targets: shelf_private.request_borrow_unchecked, confirm_return(uuid,text), record_fine_payment(text,numeric,text,text,text)

BEGIN;

-- ============================================================
-- 1. Harden shelf_private.request_borrow_unchecked
-- ============================================================
-- Add AAL2 requirement for visitor-facing borrow requests
-- Fix search_path to empty, qualify all table references

DROP FUNCTION IF EXISTS shelf_private.request_borrow_unchecked(uuid, text);

CREATE OR REPLACE FUNCTION shelf_private.request_borrow_unchecked(
  p_visitor_id uuid,
  p_book_id    text
)
RETURNS public.borrow_requests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_book public.books%rowtype;
  v_visitor public.visitors%rowtype;
  v_req public.borrow_requests%rowtype;
  v_queue_count int;
  v_active_allocations integer := 0;
  v_uid uuid;
  v_jwt_aal text;
BEGIN
  -- Require authenticated visitor session with AAL2
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authenticated visitor account required.';
  END IF;
  v_jwt_aal := COALESCE(auth.jwt() ->> 'aal', 'aal1');
  IF v_jwt_aal <> 'aal2' THEN
    RAISE EXCEPTION 'AAL2 authentication is required.';
  END IF;

  -- ============================================================
  -- FIND VISITOR
  --
  -- p_visitor_id from the app is the Supabase Auth UUID.
  -- visitors.auth_user_id = UUID
  -- visitors.id           = TEXT
  --
  -- Therefore, if checking visitors.id, explicitly cast the UUID
  -- to TEXT.
  -- ============================================================
  SELECT v.*
  INTO v_visitor
  FROM public.visitors AS v
  WHERE v.auth_user_id = p_visitor_id
     OR v.id = p_visitor_id::text
  LIMIT 1;

  -- ============================================================
  -- FIND BOOK (with row lock)
  -- ============================================================
  SELECT b.*
  INTO v_book
  FROM public.books AS b
  WHERE b.id = pg_catalog.btrim(p_book_id)
  FOR UPDATE;

  -- ============================================================
  -- VALIDATE VISITOR
  -- ============================================================
  IF v_visitor.id IS NULL THEN
    RAISE EXCEPTION 'Visitor account could not be found.';
  END IF;

  -- ============================================================
  -- VALIDATE BOOK
  -- ============================================================
  IF v_book.id IS NULL THEN
    RAISE EXCEPTION 'The selected book could not be found.';
  END IF;

  -- ============================================================
  -- VERIFY VISITOR ACCOUNT
  -- ============================================================
  IF NOT COALESCE(v_visitor.otp_verified, false) THEN
    RAISE EXCEPTION
      'Please verify your visitor account before requesting a book.';
  END IF;

  IF NOT COALESCE(v_visitor.is_active, true) THEN
    RAISE EXCEPTION
      'This visitor account is currently inactive.';
  END IF;

  -- ============================================================
  -- CHECK EXISTING ACTIVE REQUEST / LOAN
  --
  -- borrow_requests.visitor_id = TEXT
  -- visitors.id               = TEXT
  --
  -- So this comparison is TEXT = TEXT.
  -- ============================================================
  IF EXISTS (
    SELECT 1
    FROM public.borrow_requests AS br
    WHERE br.visitor_id = v_visitor.id
      AND br.book_id = pg_catalog.btrim(p_book_id)
      AND br.status IN (
        'queued',
        'ready_for_pickup',
        'borrowed'
      )
  ) THEN
    RAISE EXCEPTION
      'You already have an active request or loan for this title.';
  END IF;

  -- ============================================================
  -- AVAILABLE COPY
  -- ============================================================
  SELECT count(*)::integer
  INTO v_active_allocations
  FROM public.borrow_requests AS request
  WHERE request.book_id = v_book.id
    AND request.status IN ('ready_for_pickup', 'borrowed')
    AND request.return_date IS NULL;

  SELECT v_active_allocations + count(*)::integer
  INTO v_active_allocations
  FROM public.community_book_requests AS request
  WHERE request.book_id = v_book.id
    AND request.status IN ('approved', 'borrowed')
    AND request.return_date IS NULL;

  IF COALESCE(v_book.available_copies, 0) > 0
     AND v_book.total_copies > v_active_allocations
     AND v_book.available_copies <= v_book.total_copies - v_active_allocations
  THEN

    UPDATE public.books AS b
    SET available_copies = b.available_copies - 1
    WHERE b.id = pg_catalog.btrim(p_book_id);

    INSERT INTO public.borrow_requests (
      book_id,
      book_title,
      visitor_id,
      visitor_name,
      status,
      pickup_deadline
    )
    VALUES (
      v_book.id,
      v_book.title,
      v_visitor.id,
      v_visitor.full_name,
      'ready_for_pickup',
      pg_catalog.now() + pg_catalog.interval '24 hours'
    )
    RETURNING * INTO v_req;

  -- ============================================================
  -- NO AVAILABLE COPY -> QUEUE
  -- ============================================================
  ELSE

    SELECT count(*)
    INTO v_queue_count
    FROM public.borrow_requests AS br
    WHERE br.book_id = pg_catalog.btrim(p_book_id)
      AND br.status = 'queued';

    INSERT INTO public.borrow_requests (
      book_id,
      book_title,
      visitor_id,
      visitor_name,
      status,
      queue_position
    )
    VALUES (
      v_book.id,
      v_book.title,
      v_visitor.id,
      v_visitor.full_name,
      'queued',
      v_queue_count + 1
    )
    RETURNING * INTO v_req;

  END IF;

  RETURN v_req;

END;
$function$;

ALTER FUNCTION shelf_private.request_borrow_unchecked(uuid, text) OWNER TO postgres;

REVOKE ALL ON FUNCTION shelf_private.request_borrow_unchecked(uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION shelf_private.request_borrow_unchecked(uuid, text)
  TO authenticated;

-- ============================================================
-- 2. Harden confirm_return(uuid, text) - legacy overload
-- ============================================================
-- Add AAL2 check (currently missing)

DROP FUNCTION IF EXISTS public.confirm_return(uuid, text);

CREATE OR REPLACE FUNCTION public.confirm_return(
  p_request_id uuid,
  p_staff_name text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_req public.borrow_requests%ROWTYPE;
  v_staff_role text;
  v_staff_library_id uuid;
  v_staff_name text;
  v_book_library_id uuid;
  v_book_fine_rate integer;
  v_effective_fine_rate integer;
  v_jwt_role text;
  v_overdue_days integer;
  v_fine numeric;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authenticated staff account required.';
  END IF;
  IF COALESCE(auth.jwt() ->> 'aal', 'aal1') <> 'aal2' THEN
    RAISE EXCEPTION 'AAL2 authentication is required.';
  END IF;

  SELECT pg_catalog.lower(sp.role), sp.library_id,
    COALESCE(NULLIF(pg_catalog.btrim(sp.full_name), ''), sp.email)
  INTO v_staff_role, v_staff_library_id, v_staff_name
  FROM public.staff_profiles sp
  WHERE sp.id = auth.uid() AND sp.is_active IS TRUE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Active staff profile required.';
  END IF;
  v_jwt_role := auth.jwt() -> 'app_metadata' ->> 'role';
  IF v_staff_role IS NULL
     OR v_staff_role NOT IN ('superadmin', 'subadmin')
     OR COALESCE(v_jwt_role, v_staff_role) <> v_staff_role THEN
    RAISE EXCEPTION 'Unauthorized staff role.';
  END IF;

  SELECT br.* INTO v_req
  FROM public.borrow_requests br
  WHERE br.id = p_request_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Request not found.'; END IF;

  SELECT b.library_id, b.fine_rate
  INTO v_book_library_id, v_book_fine_rate
  FROM public.books b WHERE b.id = v_req.book_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Book not found.'; END IF;
  IF v_staff_role <> 'superadmin'
     AND v_staff_library_id IS DISTINCT FROM v_book_library_id THEN
    RAISE EXCEPTION 'You are not authorized to process this branch.';
  END IF;
  IF v_req.status <> 'borrowed' THEN
    RAISE EXCEPTION 'This item is not currently on loan.';
  END IF;

  v_effective_fine_rate := CASE
    WHEN v_req.fine_rate_snapshot BETWEEN 1 AND 100
      THEN v_req.fine_rate_snapshot
    WHEN v_book_fine_rate BETWEEN 1 AND 100
      THEN v_book_fine_rate
    ELSE NULL
  END;

  IF v_effective_fine_rate IS NOT NULL THEN
    v_overdue_days := CASE
      WHEN v_req.due_date IS NULL OR pg_catalog.now() <= v_req.due_date THEN 0
      ELSE CEIL(EXTRACT(EPOCH FROM (pg_catalog.now() - v_req.due_date)) / 86400)::integer
    END;
    v_fine := v_overdue_days * v_effective_fine_rate;
    UPDATE public.borrow_requests
    SET status = 'returned',
        return_date = pg_catalog.now(),
        fine_amount = v_fine,
        fine_rate_snapshot = v_effective_fine_rate,
        fine_review_required = false,
        return_confirmed_by = v_staff_name
    WHERE id = p_request_id;
  ELSE
    UPDATE public.borrow_requests
    SET status = 'returned',
        return_date = pg_catalog.now(),
        fine_amount = v_req.fine_amount,
        fine_review_required = true,
        return_confirmed_by = v_staff_name
    WHERE id = p_request_id;
  END IF;

  PERFORM public.release_copy_and_promote(v_req.book_id);
END;
$function$;

ALTER FUNCTION public.confirm_return(uuid, text) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.confirm_return(uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.confirm_return(uuid, text)
  TO authenticated, postgres, service_role;

-- ============================================================
-- 3. Harden record_fine_payment(text, numeric, text, text, text)
-- ============================================================
-- Add AAL2 check, fix search_path to empty

DROP FUNCTION IF EXISTS public.record_fine_payment(text, numeric, text, text, text);

CREATE OR REPLACE FUNCTION public.record_fine_payment(
  p_request_id text,
  p_amount numeric,
  p_payment_method text,
  p_reference_number text DEFAULT NULL,
  p_note text DEFAULT NULL
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
  v_amount numeric := pg_catalog.round(p_amount, 2);
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authenticated staff account required.'; END IF;
  IF COALESCE(auth.jwt() ->> 'aal', 'aal1') <> 'aal2' THEN
    RAISE EXCEPTION 'AAL2 authentication is required.';
  END IF;
  SELECT * INTO v_staff FROM public.staff_profiles
  WHERE id = auth.uid() AND is_active IS TRUE;
  IF NOT FOUND OR pg_catalog.lower(v_staff.role) NOT IN ('superadmin', 'subadmin') THEN
    RAISE EXCEPTION 'Active staff profile required.';
  END IF;
  IF auth.jwt() -> 'app_metadata' ->> 'role' IS NOT NULL
     AND auth.jwt() -> 'app_metadata' ->> 'role' <> pg_catalog.lower(v_staff.role) THEN
    RAISE EXCEPTION 'Unauthorized staff role.';
  END IF;
  IF v_amount IS NULL OR v_amount <= 0 THEN RAISE EXCEPTION 'Enter a payment amount greater than zero.'; END IF;
  IF p_payment_method NOT IN ('cash', 'bank_transfer', 'other') THEN RAISE EXCEPTION 'Choose a valid payment method.'; END IF;

  SELECT br.* INTO v_request FROM public.borrow_requests br
  WHERE br.id::text = pg_catalog.btrim(p_request_id) FOR UPDATE;
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

  UPDATE public.borrow_requests
  SET fine_paid_amount = COALESCE(fine_paid_amount, 0) + v_amount
  WHERE id::text = v_request.id::text;

  RETURN jsonb_build_object(
    'paymentId', v_payment_id, 'requestId', v_request.id,
    'amount', v_amount, 'remainingBalance', GREATEST(v_remaining - v_amount, 0)
  );
END;
$function$;

ALTER FUNCTION public.record_fine_payment(text, numeric, text, text, text) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.record_fine_payment(text, numeric, text, text, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.record_fine_payment(text, numeric, text, text, text)
  TO authenticated, service_role;

-- ============================================================
-- 4. Harden get_fine_payment_dashboard(text) - wrapper
-- ============================================================
-- Fix search_path to empty

DROP FUNCTION IF EXISTS public.get_fine_payment_dashboard(text);

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
SET search_path = ''
AS $function$
DECLARE
  v_role text;
  v_library_id uuid;
  v_jwt_role text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authenticated staff account required.';
  END IF;
  IF COALESCE(auth.jwt() ->> 'aal', 'aal1') <> 'aal2' THEN
    RAISE EXCEPTION 'AAL2 authentication is required.';
  END IF;

  SELECT pg_catalog.lower(staff.role), staff.library_id
    INTO v_role, v_library_id
  FROM public.staff_profiles AS staff
  WHERE staff.id = auth.uid() AND staff.is_active IS TRUE;
  IF NOT FOUND OR v_role <> 'subadmin' THEN
    RAISE EXCEPTION 'Active Sub-Admin account required for individual fine records.';
  END IF;

  v_jwt_role := auth.jwt() -> 'app_metadata' ->> 'role';
  IF v_jwt_role IS DISTINCT FROM v_role THEN
    RAISE EXCEPTION 'Staff role claim does not match the active staff profile.';
  END IF;
  IF p_library_id IS NOT NULL AND p_library_id <> v_library_id::text THEN
    RAISE EXCEPTION 'You can only view fines for your assigned library.';
  END IF;

  RETURN QUERY
  SELECT * FROM public.get_fine_payment_dashboard_detail_internal(v_library_id::text);
END;
$function$;

ALTER FUNCTION public.get_fine_payment_dashboard(text) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.get_fine_payment_dashboard(text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_fine_payment_dashboard(text)
  TO authenticated, service_role;

-- ============================================================
-- 5. Harden get_fine_payment_alert_targets(text) - wrapper
-- ============================================================
-- Fix search_path to empty

DROP FUNCTION IF EXISTS public.get_fine_payment_alert_targets(text);

CREATE OR REPLACE FUNCTION public.get_fine_payment_alert_targets(p_library_id text DEFAULT NULL)
RETURNS TABLE (request_id text, visitor_id text, alerted_today boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_role text;
  v_library_id uuid;
  v_jwt_role text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authenticated staff account required.';
  END IF;
  IF COALESCE(auth.jwt() ->> 'aal', 'aal1') <> 'aal2' THEN
    RAISE EXCEPTION 'AAL2 authentication is required.';
  END IF;

  SELECT pg_catalog.lower(staff.role), staff.library_id
    INTO v_role, v_library_id
  FROM public.staff_profiles AS staff
  WHERE staff.id = auth.uid() AND staff.is_active IS TRUE;
  IF NOT FOUND OR v_role <> 'subadmin' THEN
    RAISE EXCEPTION 'Active Sub-Admin account required for individual fine alerts.';
  END IF;

  v_jwt_role := auth.jwt() -> 'app_metadata' ->> 'role';
  IF v_jwt_role IS DISTINCT FROM v_role THEN
    RAISE EXCEPTION 'Staff role claim does not match the active staff profile.';
  END IF;
  IF p_library_id IS NOT NULL AND p_library_id <> v_library_id::text THEN
    RAISE EXCEPTION 'You can only view fine alerts for your assigned library.';
  END IF;

  RETURN QUERY
  SELECT * FROM public.get_fine_payment_alert_targets_detail_internal(v_library_id::text);
END;
$function$;

ALTER FUNCTION public.get_fine_payment_alert_targets(text) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.get_fine_payment_alert_targets(text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_fine_payment_alert_targets(text)
  TO authenticated, service_role;

-- ============================================================
-- 6. Harden record_fine_payment wrapper - Sub-Admin only
-- ============================================================
-- Fix search_path to empty

DROP FUNCTION IF EXISTS public.record_fine_payment(text, numeric, text, text, text);

CREATE OR REPLACE FUNCTION public.record_fine_payment(
  p_request_id text,
  p_amount numeric,
  p_payment_method text,
  p_reference_number text DEFAULT NULL,
  p_note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_role text;
  v_jwt_role text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authenticated staff account required.';
  END IF;
  IF COALESCE(auth.jwt() ->> 'aal', 'aal1') <> 'aal2' THEN
    RAISE EXCEPTION 'AAL2 authentication is required.';
  END IF;
  SELECT pg_catalog.lower(staff.role) INTO v_role
  FROM public.staff_profiles AS staff
  WHERE staff.id = auth.uid() AND staff.is_active IS TRUE;
  IF NOT FOUND OR v_role <> 'subadmin' THEN
    RAISE EXCEPTION 'Active Sub-Admin account required to record individual payments.';
  END IF;
  v_jwt_role := auth.jwt() -> 'app_metadata' ->> 'role';
  IF v_jwt_role IS DISTINCT FROM v_role THEN
    RAISE EXCEPTION 'Staff role claim does not match the active staff profile.';
  END IF;
  RETURN public.record_fine_payment_subadmin_internal(
    p_request_id, p_amount, p_payment_method, p_reference_number, p_note
  );
END;
$function$;

ALTER FUNCTION public.record_fine_payment(text, numeric, text, text, text) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.record_fine_payment(text, numeric, text, text, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.record_fine_payment(text, numeric, text, text, text)
  TO authenticated, service_role;

-- ============================================================
-- 7. Harden resolve_fine_review wrapper - Sub-Admin only
-- ============================================================
-- Fix search_path to empty

DROP FUNCTION IF EXISTS public.resolve_fine_review(text, text, numeric, text);

CREATE OR REPLACE FUNCTION public.resolve_fine_review(
  p_request_id text,
  p_decision text,
  p_approved_amount numeric,
  p_note text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_role text;
  v_jwt_role text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authenticated staff account required.';
  END IF;
  IF COALESCE(auth.jwt() ->> 'aal', 'aal1') <> 'aal2' THEN
    RAISE EXCEPTION 'AAL2 authentication is required.';
  END IF;
  SELECT pg_catalog.lower(staff.role) INTO v_role
  FROM public.staff_profiles AS staff
  WHERE staff.id = auth.uid() AND staff.is_active IS TRUE;
  IF NOT FOUND OR v_role <> 'subadmin' THEN
    RAISE EXCEPTION 'Active Sub-Admin account required to review individual fines.';
  END IF;
  v_jwt_role := auth.jwt() -> 'app_metadata' ->> 'role';
  IF v_jwt_role IS DISTINCT FROM v_role THEN
    RAISE EXCEPTION 'Staff role claim does not match the active staff profile.';
  END IF;
  RETURN public.resolve_fine_review_subadmin_internal(
    p_request_id, p_decision, p_approved_amount, p_note
  );
END;
$function$;

ALTER FUNCTION public.resolve_fine_review(text, text, numeric, text) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.resolve_fine_review(text, text, numeric, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.resolve_fine_review(text, text, numeric, text)
  TO authenticated, service_role;

-- ============================================================
-- 8. Harden get_fine_payment_analytics(text) - Super Admin/Sub-Admin aggregate
-- ============================================================
-- Fix search_path to empty

DROP FUNCTION IF EXISTS public.get_fine_payment_analytics(text);

CREATE OR REPLACE FUNCTION public.get_fine_payment_analytics(p_library_id text DEFAULT NULL)
RETURNS TABLE (
  report_kind text,
  period_month date,
  branch_id text,
  branch_name text,
  fines_assessed numeric,
  fines_collected numeric,
  outstanding_balance numeric,
  paid_request_count bigint,
  partially_paid_request_count bigint,
  unpaid_request_count bigint,
  cash_collected numeric,
  bank_transfer_collected numeric,
  other_collected numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_role text;
  v_library_id uuid;
  v_jwt_role text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authenticated staff account required.';
  END IF;
  IF COALESCE(auth.jwt() ->> 'aal', 'aal1') <> 'aal2' THEN
    RAISE EXCEPTION 'AAL2 authentication is required.';
  END IF;
  SELECT pg_catalog.lower(staff.role), staff.library_id
    INTO v_role, v_library_id
  FROM public.staff_profiles AS staff
  WHERE staff.id = auth.uid() AND staff.is_active IS TRUE;
  IF NOT FOUND OR v_role NOT IN ('subadmin', 'superadmin') THEN
    RAISE EXCEPTION 'Active staff account required.';
  END IF;
  v_jwt_role := auth.jwt() -> 'app_metadata' ->> 'role';
  IF v_jwt_role IS DISTINCT FROM v_role THEN
    RAISE EXCEPTION 'Staff role claim does not match the active staff profile.';
  END IF;
  IF v_role = 'subadmin'
     AND p_library_id IS NOT NULL
     AND p_library_id <> v_library_id::text THEN
    RAISE EXCEPTION 'You can only view analytics for your assigned library.';
  END IF;

  RETURN QUERY
  WITH detail_rows AS MATERIALIZED (
    SELECT dashboard.library_id, dashboard.library_name,
           dashboard.fine_amount, dashboard.fine_paid_amount,
           dashboard.outstanding_amount, dashboard.payments
    FROM public.get_fine_payment_dashboard_detail_internal(
      CASE WHEN v_role = 'subadmin' THEN v_library_id::text ELSE p_library_id END
    ) AS dashboard
  ),
  payment_methods AS (
    SELECT d.library_id,
      COALESCE(sum((payment.value ->> 'amount')::numeric)
        FILTER (WHERE payment.value ->> 'paymentMethod' = 'cash'), 0)::numeric AS cash_total,
      COALESCE(sum((payment.value ->> 'amount')::numeric)
        FILTER (WHERE payment.value ->> 'paymentMethod' = 'bank_transfer'), 0)::numeric AS transfer_total,
      COALESCE(sum((payment.value ->> 'amount')::numeric)
        FILTER (WHERE payment.value ->> 'paymentMethod' = 'other'), 0)::numeric AS other_total
    FROM detail_rows AS d
    CROSS JOIN LATERAL pg_catalog.jsonb_array_elements(
      COALESCE(d.payments, '[]'::jsonb)
    ) AS payment(value)
    GROUP BY d.library_id
  ),
  branch_summary AS (
    SELECT d.library_id, d.library_name,
      COALESCE(sum(d.fine_amount), 0)::numeric AS assessed,
      COALESCE(sum(d.fine_paid_amount), 0)::numeric AS collected,
      COALESCE(sum(d.outstanding_amount), 0)::numeric AS outstanding,
      count(*) FILTER (WHERE d.fine_amount > 0 AND d.outstanding_amount <= 0) AS paid_count,
      count(*) FILTER (WHERE d.fine_paid_amount > 0 AND d.outstanding_amount > 0) AS partial_count,
      count(*) FILTER (WHERE d.outstanding_amount > 0 AND d.fine_paid_amount <= 0) AS unpaid_count
    FROM detail_rows AS d
    GROUP BY d.library_id, d.library_name
  ),
  month_by_branch AS (
    SELECT pg_catalog.date_trunc('month', payment.received_at)::date AS month,
      COALESCE(request.library_id, book.library_id)::text AS branch_id,
      COALESCE(library.name, 'Unassigned library')::text AS branch_name,
      COALESCE(sum(payment.amount), 0)::numeric AS collected,
      COALESCE(sum(payment.amount) FILTER (WHERE payment.payment_method = 'cash'), 0)::numeric AS cash_total,
      COALESCE(sum(payment.amount) FILTER (WHERE payment.payment_method = 'bank_transfer'), 0)::numeric AS transfer_total,
      COALESCE(sum(payment.amount) FILTER (WHERE payment.payment_method = 'other'), 0)::numeric AS other_total
    FROM public.fine_payments AS payment
    JOIN public.borrow_requests AS request
      ON request.id::text = payment.borrow_request_id
    LEFT JOIN public.books AS book ON book.id::text = request.book_id::text
    LEFT JOIN public.libraries AS library
      ON library.id = COALESCE(request.library_id, book.library_id)
    WHERE (v_role = 'superadmin' OR COALESCE(request.library_id, book.library_id) = v_library_id)
      AND (p_library_id IS NULL OR COALESCE(request.library_id, book.library_id)::text = p_library_id)
    GROUP BY pg_catalog.date_trunc('month', payment.received_at)::date,
      COALESCE(request.library_id, book.library_id)::text,
      COALESCE(library.name, 'Unassigned library')::text
  )
  SELECT 'summary'::text, NULL::date, branch.library_id, branch.library_name,
    branch.assessed, branch.collected, branch.outstanding,
    branch.paid_count, branch.partial_count, branch.unpaid_count,
    COALESCE(method.cash_total, 0), COALESCE(method.transfer_total, 0),
    COALESCE(method.other_total, 0)
  FROM branch_summary AS branch
  LEFT JOIN payment_methods AS method ON method.library_id = branch.library_id

  UNION ALL

  SELECT 'summary'::text, NULL::date, NULL::text, 'All libraries'::text,
    COALESCE(sum(branch.assessed), 0), COALESCE(sum(branch.collected), 0),
    COALESCE(sum(branch.outstanding), 0), COALESCE(sum(branch.paid_count), 0),
    COALESCE(sum(branch.partial_count), 0), COALESCE(sum(branch.unpaid_count), 0),
    COALESCE(sum(method.cash_total), 0), COALESCE(sum(method.transfer_total), 0),
    COALESCE(sum(method.other_total), 0)
  FROM branch_summary AS branch
  LEFT JOIN payment_methods AS method ON method.library_id = branch.library_id

  UNION ALL

  SELECT 'monthly'::text, monthly.month, monthly.branch_id, monthly.branch_name,
    0::numeric, monthly.collected, 0::numeric, 0::bigint, 0::bigint, 0::bigint,
    monthly.cash_total, monthly.transfer_total, monthly.other_total
  FROM month_by_branch AS monthly

  UNION ALL

  SELECT 'monthly'::text, monthly.month, NULL::text, 'All libraries'::text,
    0::numeric, sum(monthly.collected), 0::numeric, 0::bigint, 0::bigint, 0::bigint,
    sum(monthly.cash_total), sum(monthly.transfer_total), sum(monthly.other_total)
  FROM month_by_branch AS monthly
  GROUP BY monthly.month;
END;
$function$;

ALTER FUNCTION public.get_fine_payment_analytics(text) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.get_fine_payment_analytics(text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_fine_payment_analytics(text)
  TO authenticated, service_role;

-- ============================================================
-- Postflight validation
-- ============================================================
DO $postflight$
DECLARE
  v_signature regprocedure;
  v_acl_count integer;
BEGIN
  -- Validate shelf_private.request_borrow_unchecked
  v_signature := 'shelf_private.request_borrow_unchecked(uuid,text)'::regprocedure;
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS procedure
    JOIN pg_catalog.pg_language AS language ON language.oid = procedure.prolang
    WHERE procedure.oid = v_signature
      AND procedure.proowner = 'postgres'::regrole
      AND language.lanname = 'plpgsql'
      AND procedure.prorettype = 'public.borrow_requests'::regtype
      AND procedure.pronargs = 2
      AND procedure.prosecdef
      AND procedure.proconfig = ARRAY['search_path=""']::text[]
  ) THEN
    RAISE EXCEPTION 'shelf_private.request_borrow_unchecked metadata differs from the reviewed contract.';
  END IF;

  SELECT pg_catalog.count(*) INTO v_acl_count
  FROM pg_catalog.pg_proc AS procedure
  CROSS JOIN LATERAL pg_catalog.aclexplode(procedure.proacl) AS acl
  WHERE procedure.oid = v_signature;

  IF v_acl_count <> 2
     OR NOT pg_catalog.has_function_privilege('authenticated', v_signature, 'EXECUTE')
     OR pg_catalog.has_function_privilege('anon', v_signature, 'EXECUTE')
     OR pg_catalog.has_function_privilege('service_role', v_signature, 'EXECUTE') THEN
    RAISE EXCEPTION 'shelf_private.request_borrow_unchecked EXECUTE privileges differ from the least-privilege contract.';
  END IF;

  -- Validate confirm_return(uuid,text)
  v_signature := 'public.confirm_return(uuid,text)'::regprocedure;
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS procedure
    JOIN pg_catalog.pg_language AS language ON language.oid = procedure.prolang
    WHERE procedure.oid = v_signature
      AND procedure.proowner = 'postgres'::regrole
      AND language.lanname = 'plpgsql'
      AND procedure.prorettype = 'void'::regtype
      AND procedure.pronargs = 2
      AND procedure.prosecdef
      AND procedure.proconfig = ARRAY['search_path=""']::text[]
  ) THEN
    RAISE EXCEPTION 'confirm_return(uuid,text) metadata differs from the reviewed contract.';
  END IF;

  -- Validate record_fine_payment(text,numeric,text,text,text)
  v_signature := 'public.record_fine_payment(text,numeric,text,text,text)'::regprocedure;
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS procedure
    JOIN pg_catalog.pg_language AS language ON language.oid = procedure.prolang
    WHERE procedure.oid = v_signature
      AND procedure.proowner = 'postgres'::regrole
      AND language.lanname = 'plpgsql'
      AND procedure.prorettype = 'jsonb'::regtype
      AND procedure.pronargs = 5
      AND procedure.prosecdef
      AND procedure.proconfig = ARRAY['search_path=""']::text[]
  ) THEN
    RAISE EXCEPTION 'record_fine_payment metadata differs from the reviewed contract.';
  END IF;

  SELECT pg_catalog.count(*) INTO v_acl_count
  FROM pg_catalog.pg_proc AS procedure
  CROSS JOIN LATERAL pg_catalog.aclexplode(procedure.proacl) AS acl
  WHERE procedure.oid = v_signature;

  IF v_acl_count <> 3
     OR NOT pg_catalog.has_function_privilege('authenticated', v_signature, 'EXECUTE')
     OR NOT pg_catalog.has_function_privilege('service_role', v_signature, 'EXECUTE')
     OR pg_catalog.has_function_privilege('anon', v_signature, 'EXECUTE') THEN
    RAISE EXCEPTION 'record_fine_payment EXECUTE privileges differ from the least-privilege contract.';
  END IF;
END;
$postflight$;

NOTIFY pgrst, 'reload schema';
COMMIT;