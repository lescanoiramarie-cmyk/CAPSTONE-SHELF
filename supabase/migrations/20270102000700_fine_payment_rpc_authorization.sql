-- Keep detailed fine workflows Sub-Admin-only and branch-scoped. Super Admins
-- use get_fine_payment_analytics, whose result contains aggregates only.
-- This migration changes RPC definitions and ACLs only; it does not touch data
-- or the fine_payments ledger.

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
SET search_path = public, pg_temp
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

CREATE OR REPLACE FUNCTION public.get_fine_payment_alert_targets(p_library_id text DEFAULT NULL)
RETURNS TABLE (request_id text, visitor_id text, alerted_today boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
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
SET search_path = public, pg_temp
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

CREATE OR REPLACE FUNCTION public.resolve_fine_review(
  p_request_id text,
  p_decision text,
  p_approved_amount numeric,
  p_note text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
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

ALTER FUNCTION public.get_fine_payment_dashboard(text) OWNER TO postgres;
ALTER FUNCTION public.get_fine_payment_alert_targets(text) OWNER TO postgres;
ALTER FUNCTION public.record_fine_payment(text, numeric, text, text, text) OWNER TO postgres;
ALTER FUNCTION public.resolve_fine_review(text, text, numeric, text) OWNER TO postgres;

-- The application invokes these RPCs with the authenticated user session.
-- The known reminder Edge Function uses scoped service-role table reads rather
-- than invoking these RPCs, so service_role EXECUTE is not needed here.
REVOKE ALL ON FUNCTION public.get_fine_payment_dashboard_detail_internal(text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_fine_payment_alert_targets_detail_internal(text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.record_fine_payment_subadmin_internal(text, numeric, text, text, text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.resolve_fine_review_subadmin_internal(text, text, numeric, text)
  FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.get_fine_payment_dashboard(text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_fine_payment_dashboard(text) TO authenticated;
REVOKE ALL ON FUNCTION public.get_fine_payment_alert_targets(text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_fine_payment_alert_targets(text) TO authenticated;
REVOKE ALL ON FUNCTION public.record_fine_payment(text, numeric, text, text, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.record_fine_payment(text, numeric, text, text, text) TO authenticated;
REVOKE ALL ON FUNCTION public.resolve_fine_review(text, text, numeric, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.resolve_fine_review(text, text, numeric, text) TO authenticated;

-- This is the only Super Admin fine read RPC. Its fixed row shape is aggregate
-- (branch/month totals and counts) and contains no request/payment-level fields.
REVOKE ALL ON FUNCTION public.get_fine_payment_analytics(text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_fine_payment_analytics(text) TO authenticated;

NOTIFY pgrst, 'reload schema';