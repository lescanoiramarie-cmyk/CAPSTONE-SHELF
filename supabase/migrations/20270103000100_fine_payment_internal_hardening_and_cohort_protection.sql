-- Harden internal fine-payment functions: explicit ownership, empty search_path, least privilege.
-- Add small-cohort suppression to get_fine_payment_analytics to prevent individual disclosure.
-- Preserve legitimate service-role cron paths for notification Edge Functions.

BEGIN;

-- ============================================================
-- 1. Harden internal functions (renamed in 20270102000100)
-- ============================================================
-- These functions are called ONLY by the Sub-Admin wrapper RPCs.
-- They must not be directly executable by any role.

-- get_fine_payment_dashboard_detail_internal
ALTER FUNCTION public.get_fine_payment_dashboard_detail_internal(text)
  OWNER TO postgres;

ALTER FUNCTION public.get_fine_payment_dashboard_detail_internal(text)
  SET search_path = '';

-- get_fine_payment_alert_targets_detail_internal
ALTER FUNCTION public.get_fine_payment_alert_targets_detail_internal(text)
  OWNER TO postgres;

ALTER FUNCTION public.get_fine_payment_alert_targets_detail_internal(text)
  SET search_path = '';

-- record_fine_payment_subadmin_internal
ALTER FUNCTION public.record_fine_payment_subadmin_internal(text, numeric, text, text, text)
  OWNER TO postgres;

ALTER FUNCTION public.record_fine_payment_subadmin_internal(text, numeric, text, text, text)
  SET search_path = '';

-- resolve_fine_review_subadmin_internal
ALTER FUNCTION public.resolve_fine_review_subadmin_internal(text, text, numeric, text)
  OWNER TO postgres;

ALTER FUNCTION public.resolve_fine_review_subadmin_internal(text, text, numeric, text)
  OWNER TO postgres;

ALTER FUNCTION public.resolve_fine_review_subadmin_internal(text, text, numeric, text)
  SET search_path = '';

-- Ensure no direct EXECUTE grants exist (defense in depth; 20270102000700 already revoked)
REVOKE ALL ON FUNCTION public.get_fine_payment_dashboard_detail_internal(text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_fine_payment_alert_targets_detail_internal(text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.record_fine_payment_subadmin_internal(text, numeric, text, text, text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.resolve_fine_review_subadmin_internal(text, text, numeric, text)
  FROM PUBLIC, anon, authenticated, service_role;

-- ============================================================
-- 2. Harden wrapper functions (redefine with empty search_path, keep AAL2/branch checks)
-- ============================================================
-- get_fine_payment_dashboard (Sub-Admin only, branch-scoped)
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
  v_uid uuid;
  v_jwt jsonb;
  v_role text;
  v_library_id uuid;
  v_requested_library_id uuid;
BEGIN
  v_uid := auth.uid();
  v_jwt := auth.jwt();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authenticated staff account required.';
  END IF;
  IF COALESCE(v_jwt ->> 'aal', 'aal1') <> 'aal2' THEN
    RAISE EXCEPTION 'AAL2 authentication is required.';
  END IF;

  SELECT pg_catalog.lower(pg_catalog.btrim(staff.role)), staff.library_id
    INTO v_role, v_library_id
  FROM public.staff_profiles AS staff
  WHERE staff.id = v_uid AND staff.is_active IS TRUE;
  IF NOT FOUND OR v_role <> 'subadmin' OR v_library_id IS NULL THEN
    RAISE EXCEPTION 'Active Sub-Admin account with an assigned library required.';
  END IF;
  IF v_jwt -> 'app_metadata' ->> 'role' IS DISTINCT FROM v_role THEN
    RAISE EXCEPTION 'Staff role claim does not match the active staff profile.';
  END IF;

  IF p_library_id IS NOT NULL THEN
    BEGIN
      v_requested_library_id := pg_catalog.btrim(p_library_id)::uuid;
    EXCEPTION WHEN invalid_text_representation THEN
      RAISE EXCEPTION 'Invalid library branch.';
    END;
    IF v_requested_library_id IS DISTINCT FROM v_library_id THEN
      RAISE EXCEPTION 'You can only view fines for your assigned library.';
    END IF;
  END IF;

  RETURN QUERY
  SELECT *
  FROM public.get_fine_payment_dashboard_detail_internal(v_library_id::text);
END;
$function$;

ALTER FUNCTION public.get_fine_payment_dashboard(text) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.get_fine_payment_dashboard(text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_fine_payment_dashboard(text) TO authenticated;

-- get_fine_payment_alert_targets (Sub-Admin only, branch-scoped)
CREATE OR REPLACE FUNCTION public.get_fine_payment_alert_targets(p_library_id text DEFAULT NULL)
RETURNS TABLE (request_id text, visitor_id text, alerted_today boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_uid uuid;
  v_jwt jsonb;
  v_role text;
  v_library_id uuid;
  v_requested_library_id uuid;
BEGIN
  v_uid := auth.uid();
  v_jwt := auth.jwt();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authenticated staff account required.';
  END IF;
  IF COALESCE(v_jwt ->> 'aal', 'aal1') <> 'aal2' THEN
    RAISE EXCEPTION 'AAL2 authentication is required.';
  END IF;

  SELECT pg_catalog.lower(pg_catalog.btrim(staff.role)), staff.library_id
    INTO v_role, v_library_id
  FROM public.staff_profiles AS staff
  WHERE staff.id = v_uid AND staff.is_active IS TRUE;
  IF NOT FOUND OR v_role <> 'subadmin' OR v_library_id IS NULL THEN
    RAISE EXCEPTION 'Active Sub-Admin account with an assigned library required.';
  END IF;
  IF v_jwt -> 'app_metadata' ->> 'role' IS DISTINCT FROM v_role THEN
    RAISE EXCEPTION 'Staff role claim does not match the active staff profile.';
  END IF;

  IF p_library_id IS NOT NULL THEN
    BEGIN
      v_requested_library_id := pg_catalog.btrim(p_library_id)::uuid;
    EXCEPTION WHEN invalid_text_representation THEN
      RAISE EXCEPTION 'Invalid library branch.';
    END;
    IF v_requested_library_id IS DISTINCT FROM v_library_id THEN
      RAISE EXCEPTION 'You can only view fine alerts for your assigned library.';
    END IF;
  END IF;

  RETURN QUERY
  SELECT *
  FROM public.get_fine_payment_alert_targets_detail_internal(v_library_id::text);
END;
$function$;

ALTER FUNCTION public.get_fine_payment_alert_targets(text) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.get_fine_payment_alert_targets(text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_fine_payment_alert_targets(text) TO authenticated;

-- record_fine_payment (Sub-Admin only, branch-scoped, overpayment prevention)
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
  v_uid uuid;
  v_jwt jsonb;
  v_role text;
  v_library_id uuid;
  v_request_library_id uuid;
BEGIN
  v_uid := auth.uid();
  v_jwt := auth.jwt();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authenticated staff account required.';
  END IF;
  IF COALESCE(v_jwt ->> 'aal', 'aal1') <> 'aal2' THEN
    RAISE EXCEPTION 'AAL2 authentication is required.';
  END IF;

  SELECT pg_catalog.lower(pg_catalog.btrim(staff.role)), staff.library_id
    INTO v_role, v_library_id
  FROM public.staff_profiles AS staff
  WHERE staff.id = v_uid AND staff.is_active IS TRUE;
  IF NOT FOUND OR v_role <> 'subadmin' OR v_library_id IS NULL THEN
    RAISE EXCEPTION 'Active Sub-Admin account with an assigned library required.';
  END IF;
  IF v_jwt -> 'app_metadata' ->> 'role' IS DISTINCT FROM v_role THEN
    RAISE EXCEPTION 'Staff role claim does not match the active staff profile.';
  END IF;
  IF NULLIF(pg_catalog.btrim(p_request_id), '') IS NULL THEN
    RAISE EXCEPTION 'A borrow request is required.';
  END IF;

  SELECT book.library_id
    INTO v_request_library_id
  FROM public.borrow_requests AS request
  JOIN public.books AS book ON book.id = request.book_id
  WHERE request.id::text = pg_catalog.btrim(p_request_id);
  IF NOT FOUND OR v_request_library_id IS NULL
     OR v_request_library_id IS DISTINCT FROM v_library_id THEN
    RAISE EXCEPTION 'You can only record payments for requests in your assigned library.';
  END IF;

  RETURN public.record_fine_payment_subadmin_internal(
    p_request_id, p_amount, p_payment_method, p_reference_number, p_note
  );
END;
$function$;

ALTER FUNCTION public.record_fine_payment(text, numeric, text, text, text) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.record_fine_payment(text, numeric, text, text, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.record_fine_payment(text, numeric, text, text, text) TO authenticated;

-- resolve_fine_review (Sub-Admin only, branch-scoped)
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
  v_uid uuid;
  v_jwt jsonb;
  v_role text;
  v_library_id uuid;
  v_request_library_id uuid;
BEGIN
  v_uid := auth.uid();
  v_jwt := auth.jwt();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authenticated staff account required.';
  END IF;
  IF COALESCE(v_jwt ->> 'aal', 'aal1') <> 'aal2' THEN
    RAISE EXCEPTION 'AAL2 authentication is required.';
  END IF;

  SELECT pg_catalog.lower(pg_catalog.btrim(staff.role)), staff.library_id
    INTO v_role, v_library_id
  FROM public.staff_profiles AS staff
  WHERE staff.id = v_uid AND staff.is_active IS TRUE;
  IF NOT FOUND OR v_role <> 'subadmin' OR v_library_id IS NULL THEN
    RAISE EXCEPTION 'Active Sub-Admin account with an assigned library required.';
  END IF;
  IF v_jwt -> 'app_metadata' ->> 'role' IS DISTINCT FROM v_role THEN
    RAISE EXCEPTION 'Staff role claim does not match the active staff profile.';
  END IF;
  IF NULLIF(pg_catalog.btrim(p_request_id), '') IS NULL THEN
    RAISE EXCEPTION 'A borrow request is required.';
  END IF;

  SELECT book.library_id
    INTO v_request_library_id
  FROM public.borrow_requests AS request
  JOIN public.books AS book ON book.id = request.book_id
  WHERE request.id::text = pg_catalog.btrim(p_request_id);
  IF NOT FOUND OR v_request_library_id IS NULL
     OR v_request_library_id IS DISTINCT FROM v_library_id THEN
    RAISE EXCEPTION 'You can only review fines for requests in your assigned library.';
  END IF;

  RETURN public.resolve_fine_review_subadmin_internal(
    p_request_id, p_decision, p_approved_amount, p_note
  );
END;
$function$;

ALTER FUNCTION public.resolve_fine_review(text, text, numeric, text) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.resolve_fine_review(text, text, numeric, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.resolve_fine_review(text, text, numeric, text) TO authenticated;

-- ============================================================
-- 3. Harden get_fine_payment_analytics with small-cohort suppression
-- ============================================================
-- Super Admin: system-wide aggregates with minimum cohort threshold.
-- Sub-Admin: branch-scoped aggregates with minimum cohort threshold.
-- Threshold: minimum 3 requests per branch per period to return detail row.
-- Rationale: With fewer than 3 requests, individual financial activity
-- could be inferred by differencing. This threshold balances utility
-- and privacy for typical library branch volumes.

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
  v_min_cohort constant int := 3;
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
  -- Suppress branches with fewer than v_min_cohort requests in the period
  branch_request_counts AS (
    SELECT library_id, library_name,
           count(*) AS request_count
    FROM detail_rows
    GROUP BY library_id, library_name
    HAVING count(*) >= v_min_cohort
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
    JOIN branch_request_counts brc ON brc.library_id = d.library_id
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
  ),
  -- Apply cohort suppression to monthly breakdowns as well
  monthly_cohort AS (
    SELECT mb.month, mb.branch_id, mb.branch_name,
           count(DISTINCT request.id) AS request_count
    FROM public.fine_payments AS payment
    JOIN public.borrow_requests AS request
      ON request.id::text = payment.borrow_request_id
    LEFT JOIN public.books AS book ON book.id::text = request.book_id::text
    LEFT JOIN public.libraries AS library
      ON library.id = COALESCE(request.library_id, book.library_id)
    WHERE (v_role = 'superadmin' OR COALESCE(request.library_id, book.library_id) = v_library_id)
      AND (p_library_id IS NULL OR COALESCE(request.library_id, book.library_id)::text = p_library_id)
    GROUP BY mb.month, mb.branch_id, mb.branch_name
    HAVING count(DISTINCT request.id) >= v_min_cohort
  ),
  monthly_filtered AS (
    SELECT mb.month, mb.branch_id, mb.branch_name,
           mb.collected, mb.cash_total, mb.transfer_total, mb.other_total
    FROM month_by_branch mb
    JOIN monthly_cohort mc
      ON mc.month = mb.month
     AND mc.branch_id = mb.branch_id
     AND mc.branch_name = mb.branch_name
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
  FROM monthly_filtered AS monthly

  UNION ALL

  SELECT 'monthly'::text, monthly.month, NULL::text, 'All libraries'::text,
    0::numeric, sum(monthly.collected), 0::numeric, 0::bigint, 0::bigint, 0::bigint,
    sum(monthly.cash_total), sum(monthly.transfer_total), sum(monthly.other_total)
  FROM monthly_filtered AS monthly
  GROUP BY monthly.month;
END;
$function$;

ALTER FUNCTION public.get_fine_payment_analytics(text) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.get_fine_payment_analytics(text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_fine_payment_analytics(text) TO authenticated, service_role;

-- ============================================================
-- 4. Postflight validation
-- ============================================================
DO $postflight$
DECLARE
  v_signature regprocedure;
  v_acl_count integer;
BEGIN
  -- Validate internal functions have empty search_path and correct ownership
  FOR v_signature IN
    SELECT oid::regprocedure FROM pg_catalog.pg_proc
    WHERE proname IN (
      'get_fine_payment_dashboard_detail_internal',
      'get_fine_payment_alert_targets_detail_internal',
      'record_fine_payment_subadmin_internal',
      'resolve_fine_review_subadmin_internal'
    )
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_proc AS p
      JOIN pg_catalog.pg_language AS l ON l.oid = p.prolang
      WHERE p.oid = v_signature
        AND p.proowner = 'postgres'::regrole
        AND l.lanname = 'plpgsql'
        AND p.prosecdef
        AND p.proconfig = ARRAY['search_path=""']::text[]
    ) THEN
      RAISE EXCEPTION 'Internal function % metadata differs from hardened contract.', v_signature;
    END IF;

    -- Ensure no EXECUTE grants to any role
    IF pg_catalog.has_function_privilege('anon', v_signature, 'EXECUTE')
       OR pg_catalog.has_function_privilege('authenticated', v_signature, 'EXECUTE')
       OR pg_catalog.has_function_privilege('service_role', v_signature, 'EXECUTE') THEN
      RAISE EXCEPTION 'Internal function % has unexpected EXECUTE grants.', v_signature;
    END IF;
  END LOOP;

  -- Validate wrapper functions
  FOR v_signature IN
    SELECT oid::regprocedure FROM pg_catalog.pg_proc
    WHERE proname IN (
      'get_fine_payment_dashboard',
      'get_fine_payment_alert_targets',
      'record_fine_payment',
      'resolve_fine_review'
    )
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_proc AS p
      JOIN pg_catalog.pg_language AS l ON l.oid = p.prolang
      WHERE p.oid = v_signature
        AND p.proowner = 'postgres'::regrole
        AND l.lanname = 'plpgsql'
        AND p.prosecdef
        AND p.proconfig = ARRAY['search_path=""']::text[]
    ) THEN
      RAISE EXCEPTION 'Wrapper function % metadata differs from hardened contract.', v_signature;
    END IF;

    IF pg_catalog.has_function_privilege('anon', v_signature, 'EXECUTE')
       OR NOT pg_catalog.has_function_privilege('authenticated', v_signature, 'EXECUTE') THEN
      RAISE EXCEPTION 'Wrapper function % EXECUTE privileges differ from least-privilege contract.', v_signature;
    END IF;
  END LOOP;

  -- Validate analytics function
  v_signature := 'public.get_fine_payment_analytics(text)'::regprocedure;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc AS p
    JOIN pg_catalog.pg_language AS l ON l.oid = p.prolang
    WHERE p.oid = v_signature
      AND p.proowner = 'postgres'::regrole
      AND l.lanname = 'plpgsql'
      AND p.prosecdef
      AND p.proconfig = ARRAY['search_path=""']::text[]
  ) THEN
    RAISE EXCEPTION 'Analytics function metadata differs from hardened contract.';
  END IF;

  SELECT pg_catalog.count(*) INTO v_acl_count
  FROM pg_catalog.pg_proc AS p
  CROSS JOIN LATERAL pg_catalog.aclexplode(p.proacl) AS acl
  WHERE p.oid = v_signature;

  IF v_acl_count <> 2
     OR NOT pg_catalog.has_function_privilege('authenticated', v_signature, 'EXECUTE')
     OR NOT pg_catalog.has_function_privilege('service_role', v_signature, 'EXECUTE')
     OR pg_catalog.has_function_privilege('anon', v_signature, 'EXECUTE') THEN
    RAISE EXCEPTION 'Analytics function EXECUTE privileges differ from least-privilege contract.';
  END IF;
END;
$postflight$;

NOTIFY pgrst, 'reload schema';
COMMIT;