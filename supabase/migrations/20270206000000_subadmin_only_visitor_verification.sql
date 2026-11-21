BEGIN;

-- Visitor approval and status mutation are branch-librarian operations.
-- Super-admin oversight remains read-only and must not use these RPCs.
CREATE OR REPLACE FUNCTION public.shelf_approve_pending_visitor(
  p_visitor_id text,
  p_expected_type text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_visitor public.visitors%rowtype;
  v_is_assigned_subadmin boolean;
BEGIN
  IF auth.uid() IS NULL OR COALESCE(auth.jwt() ->> 'aal', '') <> 'aal2' THEN
    RAISE EXCEPTION 'A verified AAL2 staff session is required.' USING ERRCODE = '42501';
  END IF;
  IF p_expected_type IS NOT NULL
     AND p_expected_type NOT IN ('institutional', 'community') THEN
    RAISE EXCEPTION 'Invalid visitor registration type.' USING ERRCODE = '22023';
  END IF;

  SELECT visitor.* INTO v_visitor
  FROM public.visitors AS visitor
  WHERE visitor.id = pg_catalog.btrim(p_visitor_id)
  FOR UPDATE;
  IF v_visitor.id IS NULL THEN
    RAISE EXCEPTION 'Pending visitor not found.' USING ERRCODE = 'P0002';
  END IF;
  IF v_visitor.library_id IS NULL THEN
    RAISE EXCEPTION 'The visitor has no preferred library assigned.' USING ERRCODE = '22023';
  END IF;
  IF v_visitor.auth_user_id IS NULL THEN
    RAISE EXCEPTION 'The visitor account is not linked to an Auth user.' USING ERRCODE = '22023';
  END IF;
  IF v_visitor.auth_user_id = auth.uid() THEN
    RAISE EXCEPTION 'Visitors cannot approve their own accounts.' USING ERRCODE = '42501';
  END IF;
  IF v_visitor.registration_type NOT IN ('institutional', 'community')
     OR (p_expected_type IS NOT NULL AND v_visitor.registration_type IS DISTINCT FROM p_expected_type)
     OR v_visitor.approval_status IS DISTINCT FROM 'pending'
     OR v_visitor.otp_verified IS NOT TRUE
     OR v_visitor.is_active IS NOT FALSE THEN
    RAISE EXCEPTION 'Only an email-verified inactive pending visitor can be approved.' USING ERRCODE = '22023';
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.staff_profiles AS staff
    WHERE staff.id = auth.uid()
      AND staff.is_active IS TRUE
      AND staff.role = 'subadmin'
      AND staff.library_id IS NOT DISTINCT FROM v_visitor.library_id
      AND auth.jwt() -> 'app_metadata' ->> 'role' = 'subadmin'
  ) INTO v_is_assigned_subadmin;

  IF COALESCE(v_is_assigned_subadmin, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'Only an assigned active sub-admin can approve visitors for this library.' USING ERRCODE = '42501';
  END IF;

  UPDATE public.visitors AS visitor
  SET approval_status = 'approved',
      is_active = true,
      qr_code = COALESCE(NULLIF(visitor.qr_code, ''), public.generate_visitor_qr_code())
  WHERE visitor.id = v_visitor.id
    AND visitor.approval_status = 'pending'
    AND visitor.otp_verified IS TRUE
    AND visitor.is_active IS FALSE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'The visitor approval state changed. Reload and try again.' USING ERRCODE = '40001';
  END IF;
  RETURN true;
END;
$function$;

REVOKE ALL ON FUNCTION public.shelf_approve_pending_visitor(text, text)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.set_visitor_active(p_visitor_id text, p_is_active boolean)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_visitor public.visitors%rowtype;
  v_is_assigned_subadmin boolean;
BEGIN
  IF auth.uid() IS NULL OR COALESCE(auth.jwt() ->> 'aal', '') <> 'aal2' THEN
    RAISE EXCEPTION 'A verified AAL2 staff session is required.' USING ERRCODE = '42501';
  END IF;
  IF p_is_active IS NULL THEN
    RAISE EXCEPTION 'A visitor account status is required.' USING ERRCODE = '22023';
  END IF;

  SELECT visitor.* INTO v_visitor
  FROM public.visitors AS visitor
  WHERE visitor.id = pg_catalog.btrim(p_visitor_id)
  FOR UPDATE;
  IF v_visitor.id IS NULL THEN
    RAISE EXCEPTION 'Visitor account not found.' USING ERRCODE = 'P0002';
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.staff_profiles AS staff
    WHERE staff.id = auth.uid()
      AND staff.is_active IS TRUE
      AND staff.role = 'subadmin'
      AND staff.library_id IS NOT DISTINCT FROM v_visitor.library_id
      AND auth.jwt() -> 'app_metadata' ->> 'role' = 'subadmin'
  ) INTO v_is_assigned_subadmin;

  IF COALESCE(v_is_assigned_subadmin, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'Only an assigned active sub-admin can update this visitor account.' USING ERRCODE = '42501';
  END IF;
  IF p_is_active IS TRUE AND v_visitor.approval_status = 'pending' THEN
    RAISE EXCEPTION 'Use the visitor approval action for pending accounts.' USING ERRCODE = '42501';
  END IF;

  UPDATE public.visitors SET is_active = p_is_active WHERE id = v_visitor.id;
  RETURN p_is_active;
END;
$function$;

REVOKE ALL ON FUNCTION public.set_visitor_active(text, boolean)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_visitor_active(text, boolean) TO authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
