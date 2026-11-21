BEGIN;

DO $preflight$
BEGIN
  IF pg_catalog.to_regprocedure('public.get_visitor_profile()') IS NULL
     OR pg_catalog.to_regprocedure('public.verify_visitor_otp(text,text)') IS NULL
     OR pg_catalog.to_regprocedure('public.is_active_staff_for_branch(text)') IS NULL THEN
    RAISE EXCEPTION 'Pending visitor privacy migration requires the visitor profile, OTP, and staff-scope RPCs.';
  END IF;

  IF EXISTS (
    SELECT required.column_name
    FROM (VALUES
      ('id'),
      ('auth_user_id'),
      ('full_name'),
      ('email'),
      ('contact_number'),
      ('address'),
      ('profile_image_path'),
      ('otp_verified'),
      ('qr_code'),
      ('registered_at'),
      ('library_id'),
      ('registration_type'),
      ('approval_status'),
      ('is_active')
    ) AS required(column_name)
    WHERE NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_attribute AS attribute
      WHERE attribute.attrelid = 'public.visitors'::pg_catalog.regclass
        AND attribute.attname = required.column_name
        AND attribute.attnum > 0
        AND NOT attribute.attisdropped
    )
  ) THEN
    RAISE EXCEPTION 'Pending visitor privacy migration requires the visitor schema established by earlier migrations.';
  END IF;
END;
$preflight$;

-- RLS controls rows, not columns. Keep only the linkage and eligibility
-- columns required by existing RLS predicates; profile data is returned by
-- narrowly authorized RPCs below.
REVOKE SELECT ON TABLE public.visitors FROM PUBLIC, anon, authenticated;

DO $revoke_column_select$
DECLARE
  v_columns text;
BEGIN
  SELECT pg_catalog.string_agg(pg_catalog.format('%I', attribute.attname), ', ')
    INTO v_columns
  FROM pg_catalog.pg_attribute AS attribute
  WHERE attribute.attrelid = 'public.visitors'::pg_catalog.regclass
    AND attribute.attnum > 0
    AND NOT attribute.attisdropped;

  IF v_columns IS NULL THEN
    RAISE EXCEPTION 'Unable to resolve public.visitors columns for privilege narrowing.';
  END IF;

  EXECUTE pg_catalog.format(
    'REVOKE SELECT (%s) ON TABLE public.visitors FROM PUBLIC, anon, authenticated',
    v_columns
  );
END;
$revoke_column_select$;

GRANT SELECT (id, auth_user_id, otp_verified, is_active, library_id, approval_status)
  ON TABLE public.visitors TO authenticated;

-- Pending visitors use get_my_visitor_approval_status instead of reading
-- their row through PostgREST. Approved visitors and authorized staff retain
-- the prior row-level scope.
DROP POLICY IF EXISTS "visitor and staff read scoped visitor profiles"
  ON public.visitors;
CREATE POLICY "visitor and staff read scoped visitor profiles"
  ON public.visitors FOR SELECT TO authenticated
  USING (
    (
      auth_user_id = auth.uid()
      AND otp_verified IS TRUE
      AND approval_status = 'approved'
      AND is_active IS TRUE
    )
    OR public.is_active_staff_for_branch(library_id::text)
  );

CREATE OR REPLACE FUNCTION public.get_visitor_profile()
RETURNS TABLE (
  id text,
  auth_user_id uuid,
  full_name text,
  email text,
  contact_number text,
  address text,
  profile_image_url text,
  library_id uuid,
  otp_verified boolean,
  is_active boolean,
  status text,
  visitor_type text,
  qr_code text,
  created_at timestamp with time zone,
  updated_at timestamp with time zone
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_uid uuid;
  v_visitor public.visitors%ROWTYPE;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authenticated session required.' USING ERRCODE = '42501';
  END IF;

  SELECT visitor.* INTO v_visitor
  FROM public.visitors AS visitor
  WHERE visitor.auth_user_id = v_uid
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Visitor profile not found for the authenticated user.';
  END IF;

  IF v_visitor.otp_verified IS NOT TRUE
     OR v_visitor.approval_status IS DISTINCT FROM 'approved'
     OR v_visitor.is_active IS NOT TRUE THEN
    RAISE EXCEPTION 'An approved, active, email-verified visitor account is required.'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY SELECT
    v_visitor.id::text,
    v_visitor.auth_user_id,
    v_visitor.full_name,
    v_visitor.email,
    v_visitor.contact_number,
    v_visitor.address,
    NULL::text,
    v_visitor.library_id,
    v_visitor.otp_verified,
    v_visitor.is_active,
    v_visitor.approval_status,
    v_visitor.registration_type,
    v_visitor.qr_code,
    v_visitor.registered_at,
    v_visitor.registered_at;
END;
$function$;
ALTER FUNCTION public.get_visitor_profile() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_visitor_profile() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_visitor_profile() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_my_visitor_approval_status()
RETURNS TABLE (
  registration_type text,
  approval_status text,
  otp_verified boolean,
  is_active boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authenticated session required.' USING ERRCODE = '42501';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.visitors AS visitor
    WHERE visitor.auth_user_id = auth.uid()
      AND visitor.otp_verified IS NOT TRUE
  ) THEN
    RAISE EXCEPTION 'Email verification is required before viewing visitor approval status.'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT visitor.registration_type,
         visitor.approval_status,
         visitor.otp_verified,
         visitor.is_active
  FROM public.visitors AS visitor
  WHERE visitor.auth_user_id = auth.uid()
    AND visitor.otp_verified IS TRUE;
END;
$function$;

ALTER FUNCTION public.get_my_visitor_approval_status() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_my_visitor_approval_status()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_my_visitor_approval_status()
  TO authenticated;

CREATE OR REPLACE FUNCTION public.get_my_visitor_profile_v2()
RETURNS TABLE (
  id text,
  auth_user_id uuid,
  full_name text,
  contact_number text,
  email text,
  address text,
  profile_image_path text,
  otp_verified boolean,
  qr_code text,
  registered_at timestamp with time zone,
  library_id uuid,
  registration_type text,
  approval_status text,
  is_active boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_visitor public.visitors%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authenticated session required.' USING ERRCODE = '42501';
  END IF;

  SELECT visitor.* INTO v_visitor
  FROM public.visitors AS visitor
  WHERE visitor.auth_user_id = auth.uid()
  LIMIT 1;

  IF NOT FOUND
     OR v_visitor.otp_verified IS NOT TRUE
     OR v_visitor.approval_status IS DISTINCT FROM 'approved'
     OR v_visitor.is_active IS NOT TRUE THEN
    RAISE EXCEPTION 'An approved, active, email-verified visitor account is required.'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY SELECT
    v_visitor.id::text,
    v_visitor.auth_user_id,
    v_visitor.full_name,
    v_visitor.contact_number,
    v_visitor.email,
    v_visitor.address,
    v_visitor.profile_image_path,
    v_visitor.otp_verified,
    v_visitor.qr_code,
    v_visitor.registered_at,
    v_visitor.library_id,
    v_visitor.registration_type,
    v_visitor.approval_status,
    v_visitor.is_active;
END;
$function$;

ALTER FUNCTION public.get_my_visitor_profile_v2() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_my_visitor_profile_v2()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_my_visitor_profile_v2()
  TO authenticated;

CREATE OR REPLACE FUNCTION public.list_visitor_accounts_v2(
  p_filter_library boolean DEFAULT false,
  p_library_id uuid DEFAULT NULL,
  p_visitor_id text DEFAULT NULL,
  p_search text DEFAULT NULL,
  p_offset integer DEFAULT 0,
  p_limit integer DEFAULT 100
)
RETURNS TABLE (
  id text,
  full_name text,
  contact_number text,
  email text,
  address text,
  profile_image_path text,
  otp_verified boolean,
  qr_code text,
  registered_at timestamp with time zone,
  library_id uuid,
  registration_type text,
  approval_status text,
  is_active boolean,
  total_count bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_role text;
  v_staff_library_id uuid;
  v_filter_library boolean;
  v_library_id uuid;
  v_visitor_id text;
  v_search text;
BEGIN
  IF auth.uid() IS NULL OR COALESCE(auth.jwt() ->> 'aal', '') <> 'aal2' THEN
    RAISE EXCEPTION 'A verified AAL2 staff session is required.'
      USING ERRCODE = '42501';
  END IF;
  IF p_offset IS NULL OR p_offset < 0
     OR p_limit IS NULL OR p_limit < 1 OR p_limit > 1000 THEN
    RAISE EXCEPTION 'Invalid visitor account page.' USING ERRCODE = '22023';
  END IF;

  SELECT staff.role, staff.library_id
    INTO v_role, v_staff_library_id
  FROM public.staff_profiles AS staff
  WHERE staff.id = auth.uid()
    AND staff.is_active IS TRUE;

  IF v_role NOT IN ('subadmin', 'superadmin')
     OR auth.jwt() -> 'app_metadata' ->> 'role' IS DISTINCT FROM v_role
     OR NOT public.is_active_staff_for_branch(v_staff_library_id::text) THEN
    RAISE EXCEPTION 'Active library staff access is required to view visitor accounts.'
      USING ERRCODE = '42501';
  END IF;

  IF v_role = 'subadmin' THEN
    IF v_staff_library_id IS NULL
       OR (p_filter_library IS TRUE AND p_library_id IS DISTINCT FROM v_staff_library_id) THEN
      RAISE EXCEPTION 'You can only view visitors from your assigned branch.'
        USING ERRCODE = '42501';
    END IF;
    v_filter_library := true;
    v_library_id := v_staff_library_id;
  ELSE
    v_filter_library := COALESCE(p_filter_library, false);
    v_library_id := p_library_id;
  END IF;

  v_visitor_id := NULLIF(pg_catalog.btrim(p_visitor_id), '');
  v_search := NULLIF(pg_catalog.lower(pg_catalog.btrim(p_search)), '');

  RETURN QUERY
  SELECT visitor.id::text,
         visitor.full_name,
         visitor.contact_number,
         visitor.email,
         visitor.address,
         visitor.profile_image_path,
         visitor.otp_verified,
         visitor.qr_code,
         visitor.registered_at,
         visitor.library_id,
         visitor.registration_type,
         visitor.approval_status,
         visitor.is_active,
         pg_catalog.count(*) OVER () AS total_count
  FROM public.visitors AS visitor
  WHERE (
      v_filter_library IS FALSE
      OR (v_library_id IS NULL AND visitor.library_id IS NULL)
      OR visitor.library_id = v_library_id
    )
    AND (v_visitor_id IS NULL OR visitor.id::text = v_visitor_id)
    AND (
      v_search IS NULL
      OR pg_catalog.strpos(
        pg_catalog.lower(pg_catalog.concat_ws(' ', visitor.full_name, visitor.email, visitor.contact_number)),
        v_search
      ) > 0
    )
  ORDER BY visitor.registered_at DESC NULLS LAST, visitor.id ASC
  OFFSET p_offset
  LIMIT p_limit;
END;
$function$;

ALTER FUNCTION public.list_visitor_accounts_v2(boolean, uuid, text, text, integer, integer)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.list_visitor_accounts_v2(boolean, uuid, text, text, integer, integer)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.list_visitor_accounts_v2(boolean, uuid, text, text, integer, integer)
  TO authenticated;

-- Keep OTP verification, attempt accounting, expiry, and audit behavior. A
-- pending visitor receives only the registration key needed by the UI; profile
-- fields and QR data are withheld until approval and activation.
CREATE OR REPLACE FUNCTION public.verify_visitor_otp(p_visitor_id text, p_code text)
RETURNS TABLE (id text, full_name text, email text, qr_code text, error text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_visitor public.visitors%ROWTYPE;
  v_qr text;
  v_attempts integer;
  v_message text;
  v_expected_hmac text;
  v_matches boolean := false;
  v_input text;
BEGIN
  v_input := pg_catalog.btrim(COALESCE(p_code, ''));

  SELECT visitor.* INTO v_visitor
  FROM public.visitors AS visitor
  WHERE visitor.id = pg_catalog.btrim(p_visitor_id)
  FOR UPDATE;
  IF v_visitor.id IS NULL THEN
    RAISE EXCEPTION 'Registration not found. Please register again.';
  END IF;
  IF COALESCE(v_visitor.otp_verified, false) THEN
    RETURN QUERY SELECT v_visitor.id::text, NULL::text, NULL::text, NULL::text, NULL::text;
    RETURN;
  END IF;
  IF v_visitor.otp IS NULL THEN
    RETURN QUERY SELECT NULL::text, NULL::text, NULL::text, NULL::text,
      'No verification code is pending. Please request a new code.'::text;
    RETURN;
  END IF;
  IF v_visitor.otp_expires_at IS NOT NULL AND v_visitor.otp_expires_at <= pg_catalog.now() THEN
    UPDATE public.visitors SET otp = NULL, otp_expires_at = NULL, otp_attempts = 0 WHERE id = v_visitor.id;
    INSERT INTO public.audit_logs(actor_id, action, branch_id, details)
    VALUES (auth.uid(), 'visitor.otp.expired', NULL, pg_catalog.jsonb_build_object('visitorId', v_visitor.id));
    RETURN QUERY SELECT NULL::text, NULL::text, NULL::text, NULL::text,
      'This verification code has expired. Please request a new code.'::text;
    RETURN;
  END IF;
  v_attempts := COALESCE(v_visitor.otp_attempts, 0);
  IF v_attempts >= 5 THEN
    INSERT INTO public.audit_logs(actor_id, action, branch_id, details)
    VALUES (auth.uid(), 'visitor.otp.lockout', NULL,
      pg_catalog.jsonb_build_object('visitorId', v_visitor.id, 'attempts', v_attempts));
    RETURN QUERY SELECT NULL::text, NULL::text, NULL::text, NULL::text,
      'Too many incorrect attempts. Please request a new code.'::text;
    RETURN;
  END IF;

  v_expected_hmac := public.shelf_visitor_otp_hmac(v_visitor.id::text, v_input);
  IF v_visitor.otp ~ '^[0-9a-f]{64}$' THEN
    v_matches := v_expected_hmac IS NOT NULL AND v_visitor.otp = v_expected_hmac;
  ELSIF v_visitor.otp ~ '^[0-9]{6}$' THEN
    v_matches := v_visitor.otp = v_input;
  ELSE
    v_matches := false;
  END IF;

  IF NOT v_matches THEN
    UPDATE public.visitors SET otp_attempts = v_attempts + 1 WHERE id = v_visitor.id;
    INSERT INTO public.audit_logs(actor_id, action, branch_id, details)
    VALUES (auth.uid(), 'visitor.otp.verification_failed', NULL,
      pg_catalog.jsonb_build_object('visitorId', v_visitor.id, 'attempts', v_attempts + 1));
    v_message := 'Incorrect OTP code. Please try again.';
    IF v_attempts + 1 >= 5 THEN
      v_message := v_message || ' After one more incorrect attempt this code will be blocked.';
    END IF;
    RETURN QUERY SELECT NULL::text, NULL::text, NULL::text, NULL::text, v_message;
    RETURN;
  END IF;

  IF v_visitor.approval_status = 'pending'
     AND v_visitor.is_active IS FALSE THEN
    v_qr := NULL;
  ELSIF v_visitor.approval_status = 'approved'
        AND v_visitor.is_active IS TRUE THEN
    v_qr := COALESCE(NULLIF(v_visitor.qr_code, ''), public.generate_visitor_qr_code());
  ELSE
    v_qr := NULL;
  END IF;

  UPDATE public.visitors
  SET otp_verified = true, qr_code = v_qr, otp = NULL,
      otp_expires_at = NULL, otp_attempts = 0
  WHERE id = v_visitor.id;
  INSERT INTO public.audit_logs(actor_id, action, branch_id, details)
  VALUES (auth.uid(), 'visitor.registration.verified', NULL,
    pg_catalog.jsonb_build_object('visitorId', v_visitor.id, 'fullName', v_visitor.full_name, 'email', v_visitor.email));

  IF v_visitor.approval_status = 'pending'
     AND v_visitor.is_active IS FALSE THEN
    RETURN QUERY SELECT v_visitor.id::text, NULL::text, NULL::text, NULL::text, NULL::text;
  ELSE
    RETURN QUERY SELECT v_visitor.id::text, v_visitor.full_name::text,
      v_visitor.email::text, v_qr::text, NULL::text;
  END IF;
END;
$function$;

ALTER FUNCTION public.verify_visitor_otp(text, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.verify_visitor_otp(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.verify_visitor_otp(text, text) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
