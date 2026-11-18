-- Preserve the declared bigint status-count fields for whole-library summaries.

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
SET search_path = public, pg_temp
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
    COALESCE(sum(branch.outstanding), 0), COALESCE(sum(branch.paid_count), 0)::bigint,
    COALESCE(sum(branch.partial_count), 0)::bigint, COALESCE(sum(branch.unpaid_count), 0)::bigint,
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