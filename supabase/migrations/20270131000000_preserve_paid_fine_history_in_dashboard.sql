-- Preserve recorded payment history in the branch-scoped fine dashboard even
-- when its current assessed fine is zero (for example, a resolved historical
-- fine with a recorded payment). This migration changes only RPC selection.
BEGIN;

CREATE OR REPLACE FUNCTION public.get_fine_payment_dashboard_detail_internal(p_library_id text DEFAULT NULL)
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
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authenticated staff account required.'; END IF;
  SELECT pg_catalog.lower(sp.role), sp.library_id INTO v_role, v_library_id
  FROM public.staff_profiles AS sp
  WHERE sp.id = auth.uid() AND sp.is_active IS TRUE;
  IF NOT FOUND OR v_role NOT IN ('superadmin', 'subadmin') THEN
    RAISE EXCEPTION 'Active staff profile required.';
  END IF;
  v_jwt_role := auth.jwt() -> 'app_metadata' ->> 'role';
  IF v_jwt_role IS NOT NULL AND v_jwt_role IS DISTINCT FROM v_role THEN
    RAISE EXCEPTION 'Unauthorized staff role.';
  END IF;
  IF v_role = 'subadmin' AND p_library_id IS NOT NULL
     AND p_library_id IS DISTINCT FROM v_library_id::text THEN
    RAISE EXCEPTION 'You can only view fines for your assigned library.';
  END IF;

  RETURN QUERY
  WITH candidates AS (
    SELECT br.*,
      COALESCE(br.library_id, b.library_id) AS book_library_id,
      b.fine_rate AS book_fine_rate,
      COALESCE(l.name, 'Unassigned library') AS resolved_library_name,
      CASE WHEN br.fine_review_resolved_at IS NOT NULL THEN NULL
        WHEN br.fine_rate_snapshot BETWEEN 1 AND 100 THEN br.fine_rate_snapshot
        WHEN b.fine_rate BETWEEN 1 AND 100 THEN b.fine_rate ELSE NULL END AS effective_rate
    FROM public.borrow_requests AS br
    LEFT JOIN public.books AS b ON b.id::text = br.book_id::text
    LEFT JOIN public.libraries AS l ON l.id = COALESCE(br.library_id, b.library_id)
    WHERE br.status IN ('borrowed', 'returned')
      AND (v_role = 'superadmin' OR COALESCE(br.library_id, b.library_id) = v_library_id)
      AND (p_library_id IS NULL OR COALESCE(br.library_id, b.library_id)::text = p_library_id)
      AND (
        (br.status = 'borrowed' AND br.due_date < pg_catalog.now()
          AND (br.fine_rate_snapshot BETWEEN 1 AND 100 OR b.fine_rate BETWEEN 1 AND 100))
        OR (br.status = 'returned' AND br.due_date IS NOT NULL AND br.return_date IS NOT NULL
          AND br.return_date > br.due_date
          AND (br.fine_rate_snapshot BETWEEN 1 AND 100 OR b.fine_rate BETWEEN 1 AND 100))
        OR COALESCE(br.fine_amount, 0) > 0
        OR COALESCE(br.fine_paid_amount, 0) > 0
        OR (COALESCE(br.fine_review_required, false)
          AND COALESCE(br.fine_rate_snapshot, b.fine_rate) NOT BETWEEN 1 AND 100)
      )
  ), assessed AS (
    SELECT c.*,
      CASE
        WHEN c.effective_rate BETWEEN 1 AND 100 AND c.status = 'borrowed' AND c.due_date < pg_catalog.now()
          THEN CEIL(EXTRACT(EPOCH FROM (pg_catalog.now() - c.due_date)) / 86400) * c.effective_rate
        WHEN c.effective_rate BETWEEN 1 AND 100 AND c.status = 'returned'
          AND c.due_date IS NOT NULL AND c.return_date IS NOT NULL
          THEN GREATEST(
            CEIL(EXTRACT(EPOCH FROM (c.return_date - c.due_date)) / 86400) * c.effective_rate,
            GREATEST(COALESCE(c.fine_amount, 0), 0)
          )
        ELSE GREATEST(COALESCE(c.fine_amount, 0), 0)
      END::numeric AS assessed_fine,
      CASE WHEN c.fine_review_resolved_at IS NOT NULL THEN false
        WHEN c.effective_rate BETWEEN 1 AND 100 THEN false
        ELSE COALESCE(c.fine_review_required, false)
          OR (c.due_date IS NOT NULL AND c.status IN ('borrowed', 'returned'))
      END AS needs_review
    FROM candidates AS c
  )
  SELECT a.id::text,
    COALESCE(a.visitor_name, 'Visitor')::text,
    COALESCE(a.book_title, 'Book')::text,
    a.book_library_id::text,
    a.resolved_library_name::text,
    a.borrow_date,
    a.due_date,
    a.status::text,
    a.assessed_fine,
    GREATEST(COALESCE(a.fine_paid_amount, 0), 0)::numeric,
    GREATEST(a.assessed_fine - GREATEST(COALESCE(a.fine_paid_amount, 0), 0), 0)::numeric,
    a.needs_review,
    COALESCE((
      SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'id', fp.id, 'amount', fp.amount, 'paymentMethod', fp.payment_method,
        'referenceNumber', fp.reference_number, 'note', fp.note,
        'receivedBy', fp.received_by_name, 'receivedAt', fp.received_at
      ) ORDER BY fp.received_at DESC)
      FROM public.fine_payments AS fp
      WHERE fp.borrow_request_id = a.id::text
    ), '[]'::jsonb)
  FROM assessed AS a
  WHERE a.assessed_fine > 0 OR a.needs_review OR COALESCE(a.fine_paid_amount, 0) > 0
  ORDER BY GREATEST(a.assessed_fine - GREATEST(COALESCE(a.fine_paid_amount, 0), 0), 0) DESC,
    a.due_date ASC NULLS LAST;
END;
$function$;

ALTER FUNCTION public.get_fine_payment_dashboard_detail_internal(text) OWNER TO postgres;
ALTER FUNCTION public.get_fine_payment_dashboard_detail_internal(text) SET search_path = '';
REVOKE ALL ON FUNCTION public.get_fine_payment_dashboard_detail_internal(text)
  FROM PUBLIC, anon, authenticated, service_role;

DO $postflight$
DECLARE
  v_definition text := pg_catalog.pg_get_functiondef(
    'public.get_fine_payment_dashboard_detail_internal(text)'::pg_catalog.regprocedure
  );
BEGIN
  IF pg_catalog.strpos(v_definition, 'COALESCE(br.fine_paid_amount, 0) > 0') = 0
     OR pg_catalog.strpos(v_definition, 'COALESCE(a.fine_paid_amount, 0) > 0') = 0 THEN
    RAISE EXCEPTION 'Paid fine history must be retained in both dashboard candidate and result filters.';
  END IF;
  IF pg_catalog.has_function_privilege(
       'anon', 'public.get_fine_payment_dashboard_detail_internal(text)', 'EXECUTE'
     )
     OR pg_catalog.has_function_privilege(
       'authenticated', 'public.get_fine_payment_dashboard_detail_internal(text)', 'EXECUTE'
     )
     OR pg_catalog.has_function_privilege(
       'service_role', 'public.get_fine_payment_dashboard_detail_internal(text)', 'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'The detailed fine dashboard helper must remain inaccessible to API roles.';
  END IF;
END;
$postflight$;

NOTIFY pgrst, 'reload schema';
COMMIT;
