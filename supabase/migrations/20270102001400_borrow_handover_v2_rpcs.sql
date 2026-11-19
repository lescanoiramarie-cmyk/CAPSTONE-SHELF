-- Give PostgREST unambiguous pickup/return RPC names while preserving the
-- existing text/UUID overloads and their response contract.
BEGIN;

DO $preflight$
DECLARE
  v_pickup_proc regprocedure;
  v_return_proc regprocedure;
BEGIN
  IF pg_catalog.to_regprocedure('public.confirm_pickup_v2(text,text)') IS NOT NULL
     OR pg_catalog.to_regprocedure('public.confirm_return_v2(text,text)') IS NOT NULL THEN
    RAISE EXCEPTION 'A v2 handover RPC already exists; review its definition before continuing.';
  END IF;

  -- Verify is_active_staff_for_branch helper exists
  IF pg_catalog.to_regprocedure('public.is_active_staff_for_branch(text)') IS NULL THEN
    RAISE EXCEPTION 'Required branch authorization helper public.is_active_staff_for_branch(text) is missing.';
  END IF;

  -- Support existing production signature (uuid, text) as primary, with (text, text) compatibility for legacy environments
  v_pickup_proc := COALESCE(
    pg_catalog.to_regprocedure('public.confirm_pickup(uuid,text)'),
    pg_catalog.to_regprocedure('public.confirm_pickup(text,text)')
  );
  v_return_proc := COALESCE(
    pg_catalog.to_regprocedure('public.confirm_return(uuid,text)'),
    pg_catalog.to_regprocedure('public.confirm_return(text,text)')
  );

  IF v_pickup_proc IS NULL OR v_return_proc IS NULL THEN
    RAISE EXCEPTION 'Required legacy handover functions confirm_pickup/confirm_return are missing.';
  END IF;

  -- Verify argument and return types, prosecdef, and language for the handover procedures
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_language l ON l.oid = p.prolang
    WHERE p.oid = v_pickup_proc
      AND l.lanname = 'plpgsql'
      AND p.prorettype = 'void'::regtype
      AND p.prosecdef
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_language l ON l.oid = p.prolang
    WHERE p.oid = v_return_proc
      AND l.lanname = 'plpgsql'
      AND p.prorettype = 'void'::regtype
      AND p.prosecdef
  ) THEN
    RAISE EXCEPTION 'Legacy handover procedures do not satisfy required security properties or return types.';
  END IF;
END;
$preflight$;

CREATE FUNCTION public.confirm_pickup_v2(p_request_id text, p_staff_name text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_role text;
  v_request_uuid uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authenticated staff account required.';
  END IF;
  IF auth.jwt() ->> 'aal' IS DISTINCT FROM 'aal2' THEN
    RAISE EXCEPTION 'AAL2 authentication is required.';
  END IF;
  IF NULLIF(pg_catalog.btrim(p_request_id), '') IS NULL
     OR NULLIF(pg_catalog.btrim(p_staff_name), '') IS NULL THEN
    RAISE EXCEPTION 'A request ID and staff name are required.';
  END IF;

  BEGIN
    v_request_uuid := pg_catalog.btrim(p_request_id)::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'Invalid request ID format.';
  END;

  SELECT staff.role INTO v_role
  FROM public.staff_profiles AS staff
  WHERE staff.id = auth.uid()
    AND staff.is_active IS TRUE;
  IF NOT FOUND OR v_role NOT IN ('superadmin', 'subadmin') THEN
    RAISE EXCEPTION 'Active staff account with a supported role required.';
  END IF;
  IF auth.jwt() -> 'app_metadata' ->> 'role' IS DISTINCT FROM v_role THEN
    RAISE EXCEPTION 'Staff role claim does not match the active staff profile.';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.borrow_requests AS request
    JOIN public.books AS book ON book.id = request.book_id
    WHERE request.id = v_request_uuid::text
      AND public.is_active_staff_for_branch(book.library_id::text)
  ) THEN
    RAISE EXCEPTION 'Request not found or branch access denied.';
  END IF;

  IF pg_catalog.to_regprocedure('public.confirm_pickup(text,text)') IS NOT NULL THEN
    PERFORM public.confirm_pickup(p_request_id, p_staff_name);
  ELSE
    PERFORM public.confirm_pickup(v_request_uuid, p_staff_name);
  END IF;
END;
$function$;

CREATE FUNCTION public.confirm_return_v2(p_request_id text, p_staff_name text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_role text;
  v_request_uuid uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authenticated staff account required.';
  END IF;
  IF auth.jwt() ->> 'aal' IS DISTINCT FROM 'aal2' THEN
    RAISE EXCEPTION 'AAL2 authentication is required.';
  END IF;
  IF NULLIF(pg_catalog.btrim(p_request_id), '') IS NULL
     OR NULLIF(pg_catalog.btrim(p_staff_name), '') IS NULL THEN
    RAISE EXCEPTION 'A request ID and staff name are required.';
  END IF;

  BEGIN
    v_request_uuid := pg_catalog.btrim(p_request_id)::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'Invalid request ID format.';
  END;

  SELECT staff.role INTO v_role
  FROM public.staff_profiles AS staff
  WHERE staff.id = auth.uid()
    AND staff.is_active IS TRUE;
  IF NOT FOUND OR v_role NOT IN ('superadmin', 'subadmin') THEN
    RAISE EXCEPTION 'Active staff account with a supported role required.';
  END IF;
  IF auth.jwt() -> 'app_metadata' ->> 'role' IS DISTINCT FROM v_role THEN
    RAISE EXCEPTION 'Staff role claim does not match the active staff profile.';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.borrow_requests AS request
    JOIN public.books AS book ON book.id = request.book_id
    WHERE request.id = v_request_uuid::text
      AND public.is_active_staff_for_branch(book.library_id::text)
  ) THEN
    RAISE EXCEPTION 'Loan not found or branch access denied.';
  END IF;

  IF pg_catalog.to_regprocedure('public.confirm_return(text,text)') IS NOT NULL THEN
    PERFORM public.confirm_return(p_request_id, p_staff_name);
  ELSE
    PERFORM public.confirm_return(v_request_uuid, p_staff_name);
  END IF;
END;
$function$;

ALTER FUNCTION public.confirm_pickup_v2(text,text) OWNER TO postgres;
ALTER FUNCTION public.confirm_return_v2(text,text) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.confirm_pickup_v2(text,text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.confirm_return_v2(text,text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.confirm_pickup_v2(text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_return_v2(text,text) TO authenticated;

DO $postflight$
DECLARE
  v_signature regprocedure;
  v_acl_count integer;
BEGIN
  FOREACH v_signature IN ARRAY ARRAY[
    'public.confirm_pickup_v2(text,text)'::regprocedure,
    'public.confirm_return_v2(text,text)'::regprocedure
  ] LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_proc AS procedure
      JOIN pg_catalog.pg_language AS language ON language.oid = procedure.prolang
      WHERE procedure.oid = v_signature
        AND procedure.proowner = 'postgres'::regrole
        AND language.lanname = 'plpgsql'
        AND procedure.prorettype = 'void'::regtype
        AND procedure.pronargs = 2
        AND procedure.prosecdef
        AND procedure.proconfig = ARRAY['search_path=""']::text[]
    ) THEN
      RAISE EXCEPTION 'Handover RPC % metadata differs from the reviewed contract.', v_signature;
    END IF;

    SELECT pg_catalog.count(*) INTO v_acl_count
    FROM pg_catalog.pg_proc AS procedure
    CROSS JOIN LATERAL pg_catalog.aclexplode(procedure.proacl) AS acl
    WHERE procedure.oid = v_signature;

    IF v_acl_count <> 2
       OR NOT pg_catalog.has_function_privilege('authenticated', v_signature, 'EXECUTE')
       OR pg_catalog.has_function_privilege('anon', v_signature, 'EXECUTE')
       OR pg_catalog.has_function_privilege('service_role', v_signature, 'EXECUTE') THEN
      RAISE EXCEPTION 'Handover RPC % EXECUTE privileges differ from the least-privilege contract.', v_signature;
    END IF;
  END LOOP;
END;
$postflight$;

NOTIFY pgrst, 'reload schema';
COMMIT;
