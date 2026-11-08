-- Help fine dashboards find active/returned requests quickly, especially for
-- Super Admin queries that span multiple partner libraries.
CREATE INDEX IF NOT EXISTS borrow_requests_fine_dashboard_status_book_due_idx
  ON public.borrow_requests (status, due_date, book_id)
  INCLUDE (fine_amount, fine_paid_amount, fine_rate_snapshot, fine_review_required,
           fine_review_resolved_at, visitor_id)
  WHERE status IN ('borrowed', 'returned');

CREATE INDEX IF NOT EXISTS books_library_id_book_id_idx
  ON public.books (library_id, id);

CREATE INDEX IF NOT EXISTS fine_payments_request_received_idx
  ON public.fine_payments (borrow_request_id, received_at DESC);

-- Alert targets only need confirmed outstanding fines. Returning every request
-- with a due date made the global Super Admin alert lookup scan the full
-- borrowing history and could exceed the API statement timeout.
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
  WITH fine_candidates AS (
    SELECT br.id::text AS request_id, br.visitor_id::text AS visitor_id,
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
    JOIN public.books b ON b.id = br.book_id
    WHERE br.status IN ('borrowed', 'returned')
      AND (v_role = 'superadmin' OR b.library_id = v_library_id)
      AND (p_library_id IS NULL OR b.library_id::text = p_library_id)
      AND ((br.status = 'borrowed' AND br.due_date < now()
            AND br.fine_rate_snapshot BETWEEN 1 AND 100)
        OR COALESCE(br.fine_amount, 0) > 0
        OR COALESCE(br.fine_review_required, false))
  )
  SELECT candidate.request_id, candidate.visitor_id
  FROM fine_candidates candidate
  WHERE NOT candidate.fine_review_required
    AND candidate.fine_amount > candidate.fine_paid_amount;
END;
$function$;

ALTER FUNCTION public.get_fine_payment_alert_targets(text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_fine_payment_alert_targets(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_fine_payment_alert_targets(text) TO authenticated, service_role;
NOTIFY pgrst, 'reload schema';
