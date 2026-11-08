SET LOCAL statement_timeout = '120s';

ALTER TABLE public.borrow_requests
  ADD COLUMN IF NOT EXISTS library_id uuid;

-- Only fine-bearing or actually overdue loans need their branch snapshot
-- backfilled. Historical on-time returns do not need a library lookup for
-- outstanding-fine workflows.
UPDATE public.borrow_requests br
SET library_id = b.library_id
FROM public.books b
WHERE br.library_id IS NULL
  AND b.id::text = br.book_id::text
  AND b.library_id IS NOT NULL
  AND (
    COALESCE(br.fine_amount, 0) > 0
    OR (br.status = 'borrowed' AND br.due_date < now())
    OR (br.status = 'returned' AND br.return_date > br.due_date)
  );

-- If a legacy loan's exact catalog row was removed, resolve only fine-bearing
-- loans to a real library copy of the same title.
UPDATE public.borrow_requests br
SET library_id = (
  SELECT b.library_id
  FROM public.books b
  WHERE b.book_type = 'library'
    AND b.library_id IS NOT NULL
    AND lower(btrim(b.title)) = lower(btrim(br.book_title))
  ORDER BY b.available_copies DESC NULLS LAST, b.library_id
  LIMIT 1
)
WHERE br.library_id IS NULL
  AND (
    COALESCE(br.fine_amount, 0) > 0
    OR (br.status = 'borrowed' AND br.due_date < now())
    OR (br.status = 'returned' AND br.return_date > br.due_date)
  )
  AND NOT EXISTS (
    SELECT 1 FROM public.books exact_book
    WHERE exact_book.id::text = br.book_id::text
      AND exact_book.library_id IS NOT NULL
  )
  AND EXISTS (
    SELECT 1
    FROM public.books b
    WHERE b.book_type = 'library'
      AND b.library_id IS NOT NULL
      AND lower(btrim(b.title)) = lower(btrim(br.book_title))
  );

CREATE INDEX IF NOT EXISTS borrow_requests_library_status_due_idx
  ON public.borrow_requests (library_id, status, due_date);

CREATE OR REPLACE FUNCTION public.set_borrow_request_library_id()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_book_library_id uuid;
BEGIN
  SELECT b.library_id INTO v_book_library_id
  FROM public.books b
  WHERE b.id::text = NEW.book_id::text;

  NEW.library_id := COALESCE(v_book_library_id, NEW.library_id);
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS set_borrow_request_library_id ON public.borrow_requests;
CREATE TRIGGER set_borrow_request_library_id
  BEFORE INSERT OR UPDATE OF book_id ON public.borrow_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.set_borrow_request_library_id();

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
    SELECT br.*, COALESCE(br.library_id, b.library_id) AS book_library_id,
      b.fine_rate AS book_fine_rate,
      COALESCE(l.name, 'Unassigned library') AS resolved_library_name,
      CASE WHEN br.fine_review_resolved_at IS NOT NULL THEN NULL
        WHEN br.fine_rate_snapshot BETWEEN 1 AND 100 THEN br.fine_rate_snapshot
        WHEN b.fine_rate BETWEEN 1 AND 100 THEN b.fine_rate ELSE NULL END AS effective_rate
    FROM public.borrow_requests br
    LEFT JOIN public.books b ON b.id::text = br.book_id::text
    LEFT JOIN public.libraries l ON l.id = COALESCE(br.library_id, b.library_id)
    WHERE br.status IN ('borrowed', 'returned')
      AND (v_role = 'superadmin' OR COALESCE(br.library_id, b.library_id) = v_library_id)
      AND (p_library_id IS NULL OR COALESCE(br.library_id, b.library_id)::text = p_library_id)
      AND (
        (br.status = 'borrowed' AND br.due_date < now()
          AND (br.fine_rate_snapshot BETWEEN 1 AND 100 OR b.fine_rate BETWEEN 1 AND 100))
        OR (br.status = 'returned' AND br.due_date IS NOT NULL AND br.return_date IS NOT NULL
          AND br.return_date > br.due_date
          AND (br.fine_rate_snapshot BETWEEN 1 AND 100 OR b.fine_rate BETWEEN 1 AND 100))
        OR COALESCE(br.fine_amount, 0) > 0
        OR (COALESCE(br.fine_review_required, false)
          AND COALESCE(br.fine_rate_snapshot, b.fine_rate) NOT BETWEEN 1 AND 100)
      )
  ), assessed AS (
    SELECT c.*,
      CASE
        WHEN c.effective_rate BETWEEN 1 AND 100 AND c.status = 'borrowed' AND c.due_date < now()
          THEN CEIL(EXTRACT(EPOCH FROM (now() - c.due_date)) / 86400) * c.effective_rate
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
