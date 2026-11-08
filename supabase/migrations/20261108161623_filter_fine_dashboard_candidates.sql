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
          OR (br.due_date IS NOT NULL
            AND (br.fine_rate_snapshot IS NULL OR br.fine_rate_snapshot NOT BETWEEN 1 AND 100)))
        END AS fine_review_required
    FROM public.borrow_requests br
    LEFT JOIN public.books b ON b.id = br.book_id
    LEFT JOIN public.libraries l ON l.id = b.library_id
    WHERE br.status IN ('borrowed', 'returned')
      AND (v_role = 'superadmin' OR b.library_id = v_library_id)
      AND (p_library_id IS NULL OR b.library_id::text = p_library_id)
      AND (
        (br.status = 'borrowed' AND br.due_date < now()
          AND br.fine_rate_snapshot BETWEEN 1 AND 100)
        OR COALESCE(br.fine_amount, 0) > 0
        OR (br.fine_review_resolved_at IS NULL AND (
          COALESCE(br.fine_review_required, false)
          OR (br.due_date IS NOT NULL
            AND (br.fine_rate_snapshot IS NULL OR br.fine_rate_snapshot NOT BETWEEN 1 AND 100))
        ))
      )
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
REVOKE ALL ON FUNCTION public.get_fine_payment_dashboard(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_fine_payment_dashboard(text) TO authenticated, service_role;
NOTIFY pgrst, 'reload schema';
