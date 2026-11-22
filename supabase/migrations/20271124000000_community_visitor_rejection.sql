-- Allow branch staff to reject a community account without granting access.
-- Rejected visitors remain inactive, unverified, and without a visitor QR pass.

ALTER TABLE public.visitors
  DROP CONSTRAINT IF EXISTS visitors_approval_status_check;

ALTER TABLE public.visitors
  ADD CONSTRAINT visitors_approval_status_check
  CHECK (approval_status IN ('approved', 'pending', 'rejected'));

CREATE OR REPLACE FUNCTION public.reject_community_visitor(p_visitor_id text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_visitor public.visitors%rowtype;
BEGIN
  IF auth.uid() IS NULL OR COALESCE(auth.jwt() ->> 'aal', '') <> 'aal2' THEN
    RAISE EXCEPTION 'A verified AAL2 staff session is required.' USING ERRCODE = '42501';
  END IF;

  SELECT visitor.* INTO v_visitor
  FROM public.visitors AS visitor
  WHERE visitor.id = pg_catalog.btrim(p_visitor_id)
  FOR UPDATE;

  IF v_visitor.id IS NULL THEN
    RAISE EXCEPTION 'Community visitor not found.' USING ERRCODE = 'P0002';
  END IF;
  IF v_visitor.auth_user_id = auth.uid() THEN
    RAISE EXCEPTION 'Visitors cannot reject their own accounts.' USING ERRCODE = '42501';
  END IF;
  IF v_visitor.registration_type <> 'community'
     OR v_visitor.approval_status <> 'pending' THEN
    RAISE EXCEPTION 'Only a pending community visitor can be rejected.' USING ERRCODE = '22023';
  END IF;
  IF v_visitor.library_id IS NULL
     OR NOT public.is_active_staff_for_branch(v_visitor.library_id::text) THEN
    RAISE EXCEPTION 'You are not authorized to reject visitors for this library.' USING ERRCODE = '42501';
  END IF;

  UPDATE public.visitors AS visitor
  SET approval_status = 'rejected',
      is_active = false,
      otp_verified = false,
      qr_code = NULL
  WHERE visitor.id = v_visitor.id;

  RETURN true;
END;
$function$;

REVOKE ALL ON FUNCTION public.reject_community_visitor(text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.reject_community_visitor(text) TO authenticated;

NOTIFY pgrst, 'reload schema';
