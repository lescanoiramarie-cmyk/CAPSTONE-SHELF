BEGIN;

-- A valid checkout rate is enough to calculate the fine. Recompute it using
-- the actual return time and clear stale review flags during future returns.
CREATE OR REPLACE FUNCTION public.confirm_return(
  p_request_id uuid,
  p_staff_name text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
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

  SELECT lower(sp.role), sp.library_id,
    COALESCE(NULLIF(btrim(sp.full_name), ''), sp.email)
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
      WHEN v_req.due_date IS NULL OR now() <= v_req.due_date THEN 0
      ELSE CEIL(EXTRACT(EPOCH FROM (now() - v_req.due_date)) / 86400)::integer
    END;
    v_fine := v_overdue_days * v_effective_fine_rate;
    UPDATE public.borrow_requests
    SET status = 'returned',
        return_date = now(),
        fine_amount = v_fine,
        fine_rate_snapshot = v_effective_fine_rate,
        fine_review_required = false,
        return_confirmed_by = v_staff_name
    WHERE id = p_request_id;
  ELSE
    UPDATE public.borrow_requests
    SET status = 'returned',
        return_date = now(),
        fine_amount = v_req.fine_amount,
        fine_review_required = true,
        return_confirmed_by = v_staff_name
    WHERE id = p_request_id;
  END IF;

  PERFORM public.release_copy_and_promote(v_req.book_id);
END;
$function$;

ALTER FUNCTION public.confirm_return(uuid, text) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION public.confirm_return(uuid, text)
  TO authenticated, postgres, service_role;
REVOKE ALL ON FUNCTION public.confirm_return(uuid, text) FROM PUBLIC, anon;

-- Staff fine dashboard uses the checkout snapshot when present and falls back
-- to the book's current valid rate for legacy requests without a snapshot.
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
  WITH candidates AS (
    SELECT br.*, b.library_id AS book_library_id, b.fine_rate AS book_fine_rate,
      COALESCE(l.name, 'Unassigned library') AS resolved_library_name,
      CASE WHEN br.fine_rate_snapshot BETWEEN 1 AND 100 THEN br.fine_rate_snapshot
        WHEN b.fine_rate BETWEEN 1 AND 100 THEN b.fine_rate ELSE NULL END AS effective_rate
    FROM public.borrow_requests br
    LEFT JOIN public.books b ON b.id::text = br.book_id::text
    LEFT JOIN public.libraries l ON l.id = b.library_id
    WHERE br.status IN ('borrowed', 'returned')
      AND (v_role = 'superadmin' OR b.library_id = v_library_id)
      AND (p_library_id IS NULL OR b.library_id::text = p_library_id)
      AND (
        (br.status = 'borrowed' AND br.due_date < now()
          AND (br.fine_rate_snapshot BETWEEN 1 AND 100 OR b.fine_rate BETWEEN 1 AND 100))
        OR (br.status = 'returned' AND br.due_date IS NOT NULL AND br.return_date IS NOT NULL
          AND br.return_date > br.due_date
          AND (br.fine_rate_snapshot BETWEEN 1 AND 100 OR b.fine_rate BETWEEN 1 AND 100))
        OR COALESCE(br.fine_amount, 0) > 0
        OR (COALESCE(br.fine_review_required, false) AND
          COALESCE(br.fine_rate_snapshot, b.fine_rate) NOT BETWEEN 1 AND 100)
      )
  ), assessed AS (
    SELECT c.*,
      CASE
        WHEN c.effective_rate BETWEEN 1 AND 100 AND c.status = 'borrowed' AND c.due_date < now()
          THEN CEIL(EXTRACT(EPOCH FROM (now() - c.due_date)) / 86400) * c.effective_rate
        WHEN c.effective_rate BETWEEN 1 AND 100 AND c.status = 'returned'
          AND c.due_date IS NOT NULL AND c.return_date IS NOT NULL
          THEN GREATEST(CEIL(EXTRACT(EPOCH FROM (c.return_date - c.due_date)) / 86400), 0) * c.effective_rate
        ELSE GREATEST(COALESCE(c.fine_amount, 0), 0)
      END::numeric AS assessed_fine,
      CASE WHEN c.effective_rate BETWEEN 1 AND 100 THEN false
        ELSE COALESCE(c.fine_review_required, false)
          OR (c.due_date IS NOT NULL AND c.status IN ('borrowed', 'returned'))
      END AS needs_review
    FROM candidates c
  )
  SELECT a.id::text, COALESCE(a.visitor_name, 'Visitor')::text,
    COALESCE(a.book_title, 'Book')::text, a.book_library_id::text,
    a.resolved_library_name::text, a.borrow_date, a.due_date, a.status::text,
    a.assessed_fine, GREATEST(COALESCE(a.fine_paid_amount, 0), 0)::numeric,
    GREATEST(a.assessed_fine - GREATEST(COALESCE(a.fine_paid_amount, 0), 0), 0)::numeric,
    a.needs_review,
    COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'id', fp.id, 'amount', fp.amount, 'paymentMethod', fp.payment_method,
      'referenceNumber', fp.reference_number, 'note', fp.note,
      'receivedBy', fp.received_by_name, 'receivedAt', fp.received_at
    ) ORDER BY fp.received_at DESC) FROM public.fine_payments fp
      WHERE fp.borrow_request_id = a.id::text), '[]'::jsonb)
  FROM assessed a
  WHERE a.assessed_fine > 0 OR a.needs_review
  ORDER BY (a.assessed_fine - GREATEST(COALESCE(a.fine_paid_amount, 0), 0)) DESC,
    a.due_date ASC NULLS LAST;
END;
$function$;
ALTER FUNCTION public.get_fine_payment_dashboard(text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_fine_payment_dashboard(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_fine_payment_dashboard(text) TO authenticated, service_role;

-- Alert eligibility follows the same automatic assessment as the dashboard.
CREATE OR REPLACE FUNCTION public.get_fine_payment_alert_targets(p_library_id text DEFAULT NULL)
RETURNS TABLE (request_id text, visitor_id text)
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
  FROM public.staff_profiles sp WHERE sp.id = auth.uid() AND sp.is_active IS TRUE;
  IF NOT FOUND OR v_role NOT IN ('superadmin', 'subadmin') THEN RAISE EXCEPTION 'Active staff profile required.'; END IF;
  v_jwt_role := auth.jwt() -> 'app_metadata' ->> 'role';
  IF v_jwt_role IS NOT NULL AND v_jwt_role <> v_role THEN RAISE EXCEPTION 'Unauthorized staff role.'; END IF;
  IF v_role = 'subadmin' AND p_library_id IS NOT NULL AND p_library_id <> v_library_id::text THEN
    RAISE EXCEPTION 'You can only view fine alerts for your assigned library.';
  END IF;

  RETURN QUERY
  WITH candidates AS (
    SELECT br.id::text AS request_id, br.visitor_id::text AS visitor_id,
      br.status, br.due_date, br.return_date, br.fine_amount, br.fine_paid_amount,
      br.fine_rate_snapshot, br.fine_review_required, b.fine_rate,
      CASE WHEN br.fine_rate_snapshot BETWEEN 1 AND 100 THEN br.fine_rate_snapshot
        WHEN b.fine_rate BETWEEN 1 AND 100 THEN b.fine_rate ELSE NULL END AS effective_rate
    FROM public.borrow_requests br
    JOIN public.books b ON b.id::text = br.book_id::text
    WHERE br.status IN ('borrowed', 'returned')
      AND (v_role = 'superadmin' OR b.library_id = v_library_id)
      AND (p_library_id IS NULL OR b.library_id::text = p_library_id)
      AND (COALESCE(br.fine_amount, 0) > 0 OR br.due_date < now()
        OR COALESCE(br.fine_review_required, false))
  ), assessed AS (
    SELECT c.*,
      CASE
        WHEN c.effective_rate IS NOT NULL AND c.status = 'borrowed' AND c.due_date < now()
          THEN CEIL(EXTRACT(EPOCH FROM (now() - c.due_date)) / 86400) * c.effective_rate
        WHEN c.effective_rate IS NOT NULL AND c.status = 'returned'
          AND c.due_date IS NOT NULL AND c.return_date IS NOT NULL
          THEN GREATEST(CEIL(EXTRACT(EPOCH FROM (c.return_date - c.due_date)) / 86400), 0) * c.effective_rate
        ELSE GREATEST(COALESCE(c.fine_amount, 0), 0)
      END::numeric AS assessed_fine,
      CASE WHEN c.effective_rate IS NOT NULL THEN false
        ELSE COALESCE(c.fine_review_required, false)
          OR (c.due_date IS NOT NULL AND c.status IN ('borrowed', 'returned'))
      END AS needs_review
    FROM candidates c
  )
  SELECT a.request_id, a.visitor_id FROM assessed a
  WHERE NOT a.needs_review
    AND a.assessed_fine > GREATEST(COALESCE(a.fine_paid_amount, 0), 0);
END;
$function$;
ALTER FUNCTION public.get_fine_payment_alert_targets(text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_fine_payment_alert_targets(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_fine_payment_alert_targets(text) TO authenticated, service_role;

-- Recording an offline payment is permitted whenever a valid rate can assess
-- the fine, even if a legacy review flag was left behind on the request.
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
SET search_path TO 'public', 'pg_temp'
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
  v_amount numeric := round(p_amount, 2);
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authenticated staff account required.'; END IF;
  SELECT * INTO v_staff FROM public.staff_profiles
  WHERE id = auth.uid() AND is_active IS TRUE;
  IF NOT FOUND OR lower(v_staff.role) NOT IN ('superadmin', 'subadmin') THEN
    RAISE EXCEPTION 'Active staff profile required.';
  END IF;
  IF auth.jwt() -> 'app_metadata' ->> 'role' IS NOT NULL
     AND auth.jwt() -> 'app_metadata' ->> 'role' <> lower(v_staff.role) THEN
    RAISE EXCEPTION 'Unauthorized staff role.';
  END IF;
  IF v_amount IS NULL OR v_amount <= 0 THEN RAISE EXCEPTION 'Enter a payment amount greater than zero.'; END IF;
  IF p_payment_method NOT IN ('cash', 'bank_transfer', 'other') THEN RAISE EXCEPTION 'Choose a valid payment method.'; END IF;

  SELECT br.* INTO v_request FROM public.borrow_requests br
  WHERE br.id::text = btrim(p_request_id) FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Borrow request not found.'; END IF;
  SELECT b.library_id, b.fine_rate INTO v_library_id, v_book_fine_rate
  FROM public.books b WHERE b.id::text = v_request.book_id::text;
  IF lower(v_staff.role) = 'subadmin'
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
      OR (v_request.status = 'borrowed' AND v_request.due_date < now())) THEN
    RAISE EXCEPTION 'This fine needs review because the book has no valid fine rate.';
  END IF;

  IF v_effective_rate IS NOT NULL AND v_request.status = 'borrowed'
     AND v_request.due_date < now() THEN
    v_fine_amount := CEIL(EXTRACT(EPOCH FROM (now() - v_request.due_date)) / 86400)
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
    NULLIF(btrim(p_reference_number), ''), NULLIF(btrim(p_note), ''),
    v_staff.id, COALESCE(NULLIF(btrim(v_staff.full_name), ''), v_staff.email)
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
REVOKE ALL ON FUNCTION public.record_fine_payment(text, numeric, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_fine_payment(text, numeric, text, text, text) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
