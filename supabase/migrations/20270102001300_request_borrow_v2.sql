-- Provide a uniquely named PostgREST endpoint for the visitor borrow request.
-- The legacy request_borrow(text,text) and request_borrow(uuid,text)
-- overloads remain unchanged for existing SQL and external integrations.
BEGIN;

DO $preflight$
BEGIN
  IF pg_catalog.to_regprocedure('public.request_borrow_v2(text)') IS NOT NULL THEN
    RAISE EXCEPTION 'public.request_borrow_v2(text) already exists; review its definition before continuing.';
  END IF;

  IF pg_catalog.to_regprocedure('shelf_private.request_borrow_unchecked(uuid,text)') IS NULL THEN
    RAISE EXCEPTION 'Required shelf_private.request_borrow_unchecked(uuid,text) implementation is missing.';
  END IF;
END;
$preflight$;

CREATE FUNCTION public.request_borrow_v2(p_book_id text)
RETURNS public.borrow_requests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_uid uuid;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'The authenticated visitor account could not be verified.';
  END IF;

  IF NULLIF(pg_catalog.btrim(p_book_id), '') IS NULL THEN
    RAISE EXCEPTION 'A book ID is required.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.visitors AS visitor
    WHERE visitor.auth_user_id = v_uid
      AND visitor.otp_verified IS TRUE
      AND visitor.is_active IS TRUE
  ) THEN
    RAISE EXCEPTION 'An active, verified visitor account is required.';
  END IF;

  RETURN shelf_private.request_borrow_unchecked(v_uid, p_book_id);
END;
$function$;

ALTER FUNCTION public.request_borrow_v2(text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.request_borrow_v2(text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.request_borrow_v2(text) TO authenticated;

DO $postflight$
DECLARE
  v_acl_count integer;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS procedure
    JOIN pg_catalog.pg_language AS language ON language.oid = procedure.prolang
    WHERE procedure.oid = 'public.request_borrow_v2(text)'::regprocedure
      AND procedure.proowner = 'postgres'::regrole
      AND language.lanname = 'plpgsql'
      AND procedure.prorettype = 'public.borrow_requests'::regtype
      AND procedure.pronargs = 1
      AND procedure.prosecdef
      AND procedure.proconfig = ARRAY['search_path=""']::text[]
  ) THEN
    RAISE EXCEPTION 'public.request_borrow_v2(text) metadata differs from the reviewed contract.';
  END IF;

  SELECT pg_catalog.count(*)
    INTO v_acl_count
  FROM pg_catalog.pg_proc AS procedure
  CROSS JOIN LATERAL pg_catalog.aclexplode(procedure.proacl) AS acl
  WHERE procedure.oid = 'public.request_borrow_v2(text)'::regprocedure;

  IF v_acl_count <> 2
     OR NOT EXISTS (
       SELECT 1
       FROM pg_catalog.pg_proc AS procedure
       CROSS JOIN LATERAL pg_catalog.aclexplode(procedure.proacl) AS acl
       WHERE procedure.oid = 'public.request_borrow_v2(text)'::regprocedure
         AND acl.grantee = 'postgres'::regrole
         AND acl.grantor = 'postgres'::regrole
         AND acl.privilege_type = 'EXECUTE'
         AND NOT acl.is_grantable
     )
     OR NOT EXISTS (
       SELECT 1
       FROM pg_catalog.pg_proc AS procedure
       CROSS JOIN LATERAL pg_catalog.aclexplode(procedure.proacl) AS acl
       WHERE procedure.oid = 'public.request_borrow_v2(text)'::regprocedure
         AND acl.grantee = 'authenticated'::regrole
         AND acl.grantor = 'postgres'::regrole
         AND acl.privilege_type = 'EXECUTE'
         AND NOT acl.is_grantable
     )
     OR pg_catalog.has_function_privilege('anon', 'public.request_borrow_v2(text)', 'EXECUTE')
     OR pg_catalog.has_function_privilege('service_role', 'public.request_borrow_v2(text)', 'EXECUTE')
     OR NOT pg_catalog.has_function_privilege('authenticated', 'public.request_borrow_v2(text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'public.request_borrow_v2(text) EXECUTE privileges differ from the least-privilege contract.';
  END IF;
END;
$postflight$;

NOTIFY pgrst, 'reload schema';
COMMIT;