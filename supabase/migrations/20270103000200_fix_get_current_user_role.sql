-- Fix get_current_user_role RPC: remove 'librarian' from allowed roles
-- The staff_profiles table constraint only allows 'superadmin' and 'subadmin'
-- 'librarian' and 'circulation' are display-only and don't exist in the database

BEGIN;

DROP FUNCTION IF EXISTS public.get_current_user_role();

CREATE FUNCTION public.get_current_user_role()
RETURNS TABLE (
  user_type text,
  role text,
  library_id uuid,
  visitor_id text,
  is_active boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_uid uuid;
  v_staff public.staff_profiles%ROWTYPE;
  v_visitor public.visitors%ROWTYPE;
  v_jwt_role text;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RETURN QUERY SELECT 'anonymous'::text, NULL::text, NULL::uuid, NULL::text, FALSE;
    RETURN;
  END IF;

  -- Check staff profile first (AAL2 required for staff operations)
  IF COALESCE(auth.jwt() ->> 'aal', 'aal1') = 'aal2' THEN
    SELECT sp.* INTO v_staff
    FROM public.staff_profiles AS sp
    WHERE sp.id = v_uid AND sp.is_active IS TRUE
    LIMIT 1;

    IF FOUND THEN
      v_jwt_role := auth.jwt() -> 'app_metadata' ->> 'role';
      -- Staff roles are only 'superadmin' and 'subadmin' per staff_profiles constraint
      IF v_staff.role IS NULL
         OR v_staff.role NOT IN ('superadmin', 'subadmin')
         OR COALESCE(v_jwt_role, v_staff.role) <> v_staff.role THEN
        RETURN QUERY SELECT 'anonymous'::text, NULL::text, NULL::uuid, NULL::text, FALSE;
        RETURN;
      END IF;

      RETURN QUERY SELECT
        CASE v_staff.role WHEN 'superadmin' THEN 'superadmin' ELSE 'subadmin' END,
        v_staff.role,
        v_staff.library_id,
        NULL::text,
        TRUE;
      RETURN;
    END IF;
  END IF;

  -- Check visitor profile (AAL1 sufficient for visitor operations)
  SELECT v.* INTO v_visitor
  FROM public.visitors AS v
  WHERE v.auth_user_id = v_uid
    AND v.otp_verified IS TRUE
    AND v.is_active IS TRUE
  LIMIT 1;

  IF FOUND THEN
    RETURN QUERY SELECT 'visitor'::text, 'visitor'::text, NULL::uuid, v_visitor.id, TRUE;
    RETURN;
  END IF;

  RETURN QUERY SELECT 'anonymous'::text, NULL::text, NULL::uuid, NULL::text, FALSE;
END;
$function$;

ALTER FUNCTION public.get_current_user_role() OWNER TO postgres;

REVOKE ALL ON FUNCTION public.get_current_user_role() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_current_user_role() TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
