-- Fix legacy confirm_pickup and confirm_return to enforce AAL2, fix search_path,
-- add fine_rate_snapshot for return fines (REMOVE incorrect visitor ownership check)
BEGIN;

-- ============================================================
-- Fix confirm_pickup (text,text) legacy function
-- ============================================================
DROP FUNCTION IF EXISTS public.confirm_pickup(text, text);

CREATE OR REPLACE FUNCTION public.confirm_pickup(
  p_request_id text,
  p_staff_name text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_req public.borrow_requests%rowtype;
  v_role text;
  v_uid uuid;
  v_jwt_role text;
BEGIN
  -- Require authenticated staff session
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authenticated staff account required.';
  END IF;
  IF COALESCE(auth.jwt() ->> 'aal', 'aal1') <> 'aal2' THEN
    RAISE EXCEPTION 'AAL2 authentication is required.';
  END IF;
  IF NULLIF(pg_catalog.btrim(p_request_id), '') IS NULL
     OR NULLIF(pg_catalog.btrim(p_staff_name), '') IS NULL THEN
    RAISE EXCEPTION 'A request ID and staff name are required.';
  END IF;

  -- Validate active staff profile with supported role
  SELECT pg_catalog.lower(pg_catalog.btrim(staff.role))
    INTO v_role
  FROM public.staff_profiles AS staff
  WHERE staff.id = v_uid
    AND staff.is_active IS TRUE;
  IF NOT FOUND OR v_role NOT IN ('superadmin', 'subadmin') THEN
    RAISE EXCEPTION 'Active staff account with a supported role required.';
  END IF;

  -- Validate JWT role claim matches
  v_jwt_role := auth.jwt() -> 'app_metadata' ->> 'role';
  IF v_jwt_role IS NOT NULL
     AND pg_catalog.lower(pg_catalog.btrim(v_jwt_role)) <> v_role THEN
    RAISE EXCEPTION 'Staff role claim does not match the active staff profile.';
  END IF;

  -- Validate request exists, is ready for pickup, and staff has branch access
  SELECT request.*
    INTO v_req
  FROM public.borrow_requests AS request
  JOIN public.books AS book ON book.id = request.book_id
  WHERE request.id::text = pg_catalog.btrim(p_request_id)
    AND public.is_active_staff_for_branch(book.library_id::text)
  FOR UPDATE OF request;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Request not found or branch access denied.';
  END IF;

  IF v_req.status <> 'ready_for_pickup' THEN
    RAISE EXCEPTION 'This request is not ready for pickup.';
  END IF;
  IF v_req.pickup_deadline <= pg_catalog.now() THEN
    RAISE EXCEPTION 'Pickup window expired. The hold must be released before checkout.';
  END IF;

  UPDATE public.borrow_requests
     SET status = 'borrowed',
         borrow_date = pg_catalog.now(),
         due_date = pg_catalog.now() + pg_catalog.interval '7 days',
         confirmed_by = p_staff_name
   WHERE id::text = pg_catalog.btrim(p_request_id);
END;
$function$;

ALTER FUNCTION public.confirm_pickup(text, text) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.confirm_pickup(text, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.confirm_pickup(text, text)
  TO authenticated;

-- ============================================================
-- Fix confirm_return (text,text) legacy function
-- ============================================================
DROP FUNCTION IF EXISTS public.confirm_return(text, text);

CREATE OR REPLACE FUNCTION public.confirm_return(
  p_request_id text,
  p_staff_name text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_req public.borrow_requests%rowtype;
  v_role text;
  v_uid uuid;
  v_jwt_role text;
  v_book_fine_rate integer;
  v_effective_rate integer;
  v_overdue_days integer;
  v_fine_amount numeric;
BEGIN
  -- Require authenticated staff session
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authenticated staff account required.';
  END IF;
  IF COALESCE(auth.jwt() ->> 'aal', 'aal1') <> 'aal2' THEN
    RAISE EXCEPTION 'AAL2 authentication is required.';
  END IF;
  IF NULLIF(pg_catalog.btrim(p_request_id), '') IS NULL
     OR NULLIF(pg_catalog.btrim(p_staff_name), '') IS NULL THEN
    RAISE EXCEPTION 'A request ID and staff name are required.';
  END IF;

  -- Validate active staff profile with supported role
  SELECT pg_catalog.lower(pg_catalog.btrim(staff.role))
    INTO v_role
  FROM public.staff_profiles AS staff
  WHERE staff.id = v_uid
    AND staff.is_active IS TRUE;
  IF NOT FOUND OR v_role NOT IN ('superadmin', 'subadmin') THEN
    RAISE EXCEPTION 'Active staff account with a supported role required.';
  END IF;

  -- Validate JWT role claim matches
  v_jwt_role := auth.jwt() -> 'app_metadata' ->> 'role';
  IF v_jwt_role IS NOT NULL
     AND pg_catalog.lower(pg_catalog.btrim(v_jwt_role)) <> v_role THEN
    RAISE EXCEPTION 'Staff role claim does not match the active staff profile.';
  END IF;

  -- Validate request exists, is borrowed, and staff has branch access
  SELECT request.*
    INTO v_req
  FROM public.borrow_requests AS request
  JOIN public.books AS book ON book.id = request.book_id
  WHERE request.id::text = pg_catalog.btrim(p_request_id)
    AND public.is_active_staff_for_branch(book.library_id::text)
  FOR UPDATE OF request;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Loan not found or branch access denied.';
  END IF;

  IF v_req.status <> 'borrowed' THEN
    RAISE EXCEPTION 'This item is not currently on loan.';
  END IF;

  -- Determine effective fine rate using fine_rate_snapshot (if set) or book.fine_rate
  SELECT b.fine_rate
    INTO v_book_fine_rate
  FROM public.books AS b
  WHERE b.id = v_req.book_id;

  v_effective_rate := CASE
    WHEN v_req.fine_rate_snapshot BETWEEN 1 AND 100 THEN v_req.fine_rate_snapshot
    WHEN v_book_fine_rate BETWEEN 1 AND 100 THEN v_book_fine_rate
    ELSE NULL
  END;

  -- Calculate fine amount using effective rate
  v_overdue_days := GREATEST(0, CEIL(EXTRACT(EPOCH FROM (pg_catalog.now() - v_req.due_date)) / 86400));
  IF v_effective_rate IS NOT NULL THEN
    v_fine_amount := v_overdue_days * v_effective_rate;
  ELSE
    v_fine_amount := 0;
  END IF;

  UPDATE public.borrow_requests
     SET status = 'returned',
         return_date = pg_catalog.now(),
         fine_amount = v_fine_amount,
         return_confirmed_by = p_staff_name
   WHERE id::text = pg_catalog.btrim(p_request_id);

  PERFORM public.release_copy_and_promote(v_req.book_id);
END;
$function$;

ALTER FUNCTION public.confirm_return(text, text) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.confirm_return(text, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.confirm_return(text, text)
  TO authenticated;

-- ============================================================
-- Postflight validation
-- ============================================================
DO $postflight$
DECLARE
  v_pickup_sig regprocedure := 'public.confirm_pickup(text,text)'::regprocedure;
  v_return_sig regprocedure := 'public.confirm_return(text,text)'::regprocedure;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS procedure
    JOIN pg_catalog.pg_language AS language ON language.oid = procedure.prolang
    WHERE procedure.oid = v_pickup_sig
      AND procedure.proowner = 'postgres'::regrole
      AND language.lanname = 'plpgsql'
      AND procedure.prorettype = 'void'::regtype
      AND procedure.prosecdef
      AND procedure.proconfig = ARRAY['search_path=""']::text[]
  ) THEN
    RAISE EXCEPTION 'confirm_pickup metadata differs from the reviewed contract.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS procedure
    JOIN pg_catalog.pg_language AS language ON language.oid = procedure.prolang
    WHERE procedure.oid = v_return_sig
      AND procedure.proowner = 'postgres'::regrole
      AND language.lanname = 'plpgsql'
      AND procedure.prorettype = 'void'::regtype
      AND procedure.prosecdef
      AND procedure.proconfig = ARRAY['search_path=""']::text[]
  ) THEN
    RAISE EXCEPTION 'confirm_return metadata differs from the reviewed contract.';
  END IF;

  IF pg_catalog.has_function_privilege('anon', v_pickup_sig, 'EXECUTE')
     OR NOT pg_catalog.has_function_privilege('authenticated', v_pickup_sig, 'EXECUTE') THEN
    RAISE EXCEPTION 'confirm_pickup EXECUTE privileges differ from the least-privilege contract.';
  END IF;

  IF pg_catalog.has_function_privilege('anon', v_return_sig, 'EXECUTE')
     OR NOT pg_catalog.has_function_privilege('authenticated', v_return_sig, 'EXECUTE') THEN
    RAISE EXCEPTION 'confirm_return EXECUTE privileges differ from the least-privilege contract.';
  END IF;
END;
$postflight$;

NOTIFY pgrst, 'reload schema';
COMMIT;