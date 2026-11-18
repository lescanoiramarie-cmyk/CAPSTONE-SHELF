-- Fix lookup_attendance_visitor_v2 to enforce AAL2 and staff authorization
-- The legacy v2 function currently delegates to find_visitor_by_qr without any auth checks
-- This migration adds proper authorization to the lookup function
BEGIN;

-- Drop the circular delegation and implement proper auth
DROP FUNCTION IF EXISTS public.find_visitor_by_qr(text, uuid);
DROP FUNCTION IF EXISTS public.find_visitor_by_qr(text, text);

-- Create a new secure lookup function that enforces staff auth
CREATE OR REPLACE FUNCTION public.lookup_attendance_visitor_v2(
  p_qr text,
  p_library_id text
)
RETURNS TABLE (
  id text,
  full_name character varying,
  contact_number character varying,
  email character varying,
  address text,
  qr_code character varying,
  profile_image_path text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_library_id uuid;
  v_uid uuid;
  v_role text;
  v_staff_library_id uuid;
  v_jwt_role text;
BEGIN
  -- Require authenticated staff session
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authenticated staff session required.';
  END IF;
  IF COALESCE(auth.jwt() ->> 'aal', 'aal1') <> 'aal2' THEN
    RAISE EXCEPTION 'AAL2 authentication is required.';
  END IF;

  -- Validate library ID
  IF NULLIF(pg_catalog.btrim(p_library_id), '') IS NULL THEN
    RAISE EXCEPTION 'A library branch is required.';
  END IF;

  BEGIN
    v_library_id := pg_catalog.btrim(p_library_id)::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'Invalid library branch.';
  END;

  -- Validate active staff profile with supported role
  SELECT pg_catalog.lower(pg_catalog.btrim(staff.role)), staff.library_id
    INTO v_role, v_staff_library_id
  FROM public.staff_profiles AS staff
  WHERE staff.id = v_uid
    AND staff.is_active IS TRUE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Active staff profile required.';
  END IF;
  IF v_role NOT IN ('subadmin', 'superadmin') THEN
    RAISE EXCEPTION 'Unsupported staff role.';
  END IF;

  -- Validate JWT role claim matches
  v_jwt_role := auth.jwt() -> 'app_metadata' ->> 'role';
  IF v_jwt_role IS NOT NULL
     AND pg_catalog.lower(pg_catalog.btrim(v_jwt_role)) <> v_role THEN
    RAISE EXCEPTION 'Staff role does not match the authenticated role claim.';
  END IF;

  -- Enforce branch authorization for subadmins
  IF v_role = 'subadmin'
     AND v_staff_library_id IS DISTINCT FROM v_library_id THEN
    RAISE EXCEPTION 'You are not authorized to look up visitors for this branch.';
  END IF;

  -- Validate QR code format
  IF NULLIF(pg_catalog.btrim(p_qr), '') IS NULL THEN
    RAISE EXCEPTION 'A visitor QR pass is required.';
  END IF;

  -- Look up visitor with verification and active status
  RETURN QUERY
  SELECT visitor.id,
         visitor.full_name,
         visitor.contact_number,
         visitor.email::character varying,
         visitor.address::text,
         visitor.qr_code::character varying,
         visitor.profile_image_path
  FROM public.visitors AS visitor
  WHERE pg_catalog.upper(pg_catalog.btrim(visitor.qr_code)) =
        pg_catalog.upper(pg_catalog.btrim(p_qr))
    AND visitor.otp_verified IS TRUE
    AND visitor.is_active IS TRUE
  LIMIT 1;
END;
$function$;

ALTER FUNCTION public.lookup_attendance_visitor_v2(text, text)
  OWNER TO postgres;

REVOKE ALL ON FUNCTION public.lookup_attendance_visitor_v2(text, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.lookup_attendance_visitor_v2(text, text)
  TO authenticated, service_role;

-- Postflight validation
DO $postflight$
DECLARE
  v_signature regprocedure := 'public.lookup_attendance_visitor_v2(text,text)'::regprocedure;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS procedure
    JOIN pg_catalog.pg_language AS language ON language.oid = procedure.prolang
    WHERE procedure.oid = v_signature
      AND procedure.proowner = 'postgres'::regrole
      AND language.lanname = 'plpgsql'
      AND procedure.prorettype = 'record'::regtype
      AND procedure.prosecdef
      AND procedure.proconfig = ARRAY['search_path=""']::text[]
  ) THEN
    RAISE EXCEPTION 'lookup_attendance_visitor_v2 metadata differs from the reviewed contract.';
  END IF;

  IF pg_catalog.has_function_privilege('anon', v_signature, 'EXECUTE')
     OR NOT pg_catalog.has_function_privilege('service_role', v_signature, 'EXECUTE')
     OR NOT pg_catalog.has_function_privilege('authenticated', v_signature, 'EXECUTE') THEN
    RAISE EXCEPTION 'lookup_attendance_visitor_v2 EXECUTE privileges differ from the least-privilege contract.';
  END IF;
END;
$postflight$;

NOTIFY pgrst, 'reload schema';
COMMIT;