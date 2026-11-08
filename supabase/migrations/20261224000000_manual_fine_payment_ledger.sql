BEGIN;

ALTER TABLE public.borrow_requests
  ADD COLUMN IF NOT EXISTS fine_paid_amount numeric NOT NULL DEFAULT 0
    CHECK (fine_paid_amount >= 0);

CREATE TABLE IF NOT EXISTS public.fine_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Store the identifier as text because legacy installations may use either
  -- UUID or text request IDs. The recording RPC validates the request before
  -- writing a payment.
  borrow_request_id text NOT NULL,
  amount numeric NOT NULL CHECK (amount > 0),
  payment_method text NOT NULL CHECK (payment_method IN ('cash', 'bank_transfer', 'other')),
  reference_number text,
  note text,
  received_by uuid NOT NULL REFERENCES public.staff_profiles(id) ON DELETE RESTRICT,
  received_by_name text NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS fine_payments_request_received_idx
  ON public.fine_payments (borrow_request_id, received_at DESC);

ALTER TABLE public.fine_payments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.fine_payments FROM anon, authenticated;

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
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authenticated staff account required.';
  END IF;

  SELECT lower(sp.role), sp.library_id
    INTO v_role, v_library_id
  FROM public.staff_profiles sp
  WHERE sp.id = auth.uid() AND sp.is_active IS TRUE;

  IF NOT FOUND OR v_role NOT IN ('superadmin', 'subadmin') THEN
    RAISE EXCEPTION 'Active staff profile required.';
  END IF;
  v_jwt_role := auth.jwt() -> 'app_metadata' ->> 'role';
  IF v_jwt_role IS NOT NULL AND v_jwt_role <> v_role THEN
    RAISE EXCEPTION 'Unauthorized staff role.';
  END IF;
  IF v_role = 'subadmin' AND p_library_id IS NOT NULL
     AND p_library_id <> v_library_id::text THEN
    RAISE EXCEPTION 'You can only view fines for your assigned library.';
  END IF;

  RETURN QUERY
  WITH requests AS (
    SELECT
      br.id::text AS request_id,
      COALESCE(br.visitor_name, 'Visitor')::text AS visitor_name,
      COALESCE(br.book_title, b.title, 'Book')::text AS book_title,
      b.library_id::text AS library_id,
      COALESCE(l.name, 'Unassigned library')::text AS library_name,
      br.borrow_date,
      br.due_date,
      br.status::text AS request_status,
      CASE
        WHEN br.status = 'borrowed' AND br.due_date < now()
             AND br.fine_rate_snapshot BETWEEN 1 AND 100
          THEN ceil(extract(epoch FROM (now() - br.due_date)) / 86400)
               * br.fine_rate_snapshot
        ELSE greatest(COALESCE(br.fine_amount, 0), 0)
      END::numeric AS fine_amount,
      greatest(COALESCE(br.fine_paid_amount, 0), 0)::numeric AS fine_paid_amount,
      COALESCE(br.fine_review_required, false) AS fine_review_required
    FROM public.borrow_requests br
    LEFT JOIN public.books b ON b.id = br.book_id
    LEFT JOIN public.libraries l ON l.id = b.library_id
    WHERE br.status IN ('borrowed', 'returned')
      AND (br.due_date IS NOT NULL OR COALESCE(br.fine_amount, 0) > 0)
      AND (v_role = 'superadmin' OR b.library_id = v_library_id)
      AND (p_library_id IS NULL OR b.library_id::text = p_library_id)
  )
  SELECT
    r.request_id,
    r.visitor_name,
    r.book_title,
    r.library_id,
    r.library_name,
    r.borrow_date,
    r.due_date,
    r.request_status,
    r.fine_amount,
    r.fine_paid_amount,
    greatest(r.fine_amount - r.fine_paid_amount, 0)::numeric AS outstanding_amount,
    r.fine_review_required,
    COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', fp.id,
        'amount', fp.amount,
        'paymentMethod', fp.payment_method,
        'referenceNumber', fp.reference_number,
        'note', fp.note,
        'receivedBy', fp.received_by_name,
        'receivedAt', fp.received_at
      ) ORDER BY fp.received_at DESC)
      FROM public.fine_payments fp
      WHERE fp.borrow_request_id = r.request_id
    ), '[]'::jsonb)
  FROM requests r
  WHERE r.fine_amount > 0 OR r.fine_review_required
  ORDER BY (r.fine_amount - r.fine_paid_amount) DESC, r.due_date ASC NULLS LAST;
END;
$function$;

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
  v_fine_amount numeric;
  v_remaining numeric;
  v_payment_id uuid;
  v_amount numeric := round(p_amount, 2);
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authenticated staff account required.';
  END IF;
  SELECT * INTO v_staff
  FROM public.staff_profiles
  WHERE id = auth.uid() AND is_active IS TRUE;
  IF NOT FOUND OR lower(v_staff.role) NOT IN ('superadmin', 'subadmin') THEN
    RAISE EXCEPTION 'Active staff profile required.';
  END IF;
  IF auth.jwt() -> 'app_metadata' ->> 'role' IS NOT NULL
     AND auth.jwt() -> 'app_metadata' ->> 'role' <> lower(v_staff.role) THEN
    RAISE EXCEPTION 'Unauthorized staff role.';
  END IF;
  IF v_amount IS NULL OR v_amount <= 0 THEN
    RAISE EXCEPTION 'Enter a payment amount greater than zero.';
  END IF;
  IF p_payment_method NOT IN ('cash', 'bank_transfer', 'other') THEN
    RAISE EXCEPTION 'Choose a valid payment method.';
  END IF;

  SELECT br.* INTO v_request
  FROM public.borrow_requests br
  WHERE br.id::text = btrim(p_request_id)
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Borrow request not found.';
  END IF;
  SELECT b.library_id INTO v_library_id
  FROM public.books b
  WHERE b.id = v_request.book_id;
  IF lower(v_staff.role) = 'subadmin'
     AND (v_library_id IS NULL OR v_library_id <> v_staff.library_id) THEN
    RAISE EXCEPTION 'You can only record payments for your assigned library.';
  END IF;
  IF v_request.status NOT IN ('borrowed', 'returned') THEN
    RAISE EXCEPTION 'Payments can only be recorded for borrowed or returned books.';
  END IF;
  IF COALESCE(v_request.fine_review_required, false) THEN
    RAISE EXCEPTION 'This fine needs review before a payment can be recorded.';
  END IF;

  IF v_request.status = 'borrowed' AND v_request.due_date < now()
     AND v_request.fine_rate_snapshot BETWEEN 1 AND 100 THEN
    v_fine_amount := ceil(extract(epoch FROM (now() - v_request.due_date)) / 86400)
                     * v_request.fine_rate_snapshot;
  ELSE
    v_fine_amount := greatest(COALESCE(v_request.fine_amount, 0), 0);
  END IF;
  v_remaining := greatest(v_fine_amount - COALESCE(v_request.fine_paid_amount, 0), 0);
  IF v_remaining <= 0 THEN
    RAISE EXCEPTION 'This fine has already been paid in full.';
  END IF;
  IF v_amount > v_remaining THEN
    RAISE EXCEPTION 'Payment cannot exceed the outstanding balance of ₱%.' , to_char(v_remaining, 'FM999999990.00');
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
    'paymentId', v_payment_id,
    'requestId', v_request.id,
    'amount', v_amount,
    'remainingBalance', greatest(v_remaining - v_amount, 0)
  );
END;
$function$;

ALTER FUNCTION public.get_fine_payment_dashboard(text) OWNER TO postgres;
ALTER FUNCTION public.record_fine_payment(text, numeric, text, text, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_fine_payment_dashboard(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.record_fine_payment(text, numeric, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_fine_payment_dashboard(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.record_fine_payment(text, numeric, text, text, text) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
