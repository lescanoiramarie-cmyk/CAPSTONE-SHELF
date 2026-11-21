BEGIN;

-- New registrations of either type remain inactive until OTP verification and
-- approval. Existing linked visitor profiles are never rewritten by this
-- Auth trigger, including when email_confirmed_at changes.
CREATE OR REPLACE FUNCTION public.link_visitor_auth_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_type text;
  v_library_id uuid;
  v_existing_id text;
  v_existing_auth_user_id uuid;
  v_email_match record;
  v_email_match_count integer := 0;
BEGIN
  IF COALESCE(NEW.raw_user_meta_data ->> 'role', '') <> 'visitor' THEN
    RETURN NEW;
  END IF;

  SELECT visitor.id::text
    INTO v_existing_id
  FROM public.visitors AS visitor
  WHERE visitor.auth_user_id = NEW.id
  FOR UPDATE;
  IF v_existing_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  v_type := COALESCE(
    NULLIF(pg_catalog.lower(pg_catalog.btrim(NEW.raw_user_meta_data ->> 'registration_type')), ''),
    'institutional'
  );
  IF v_type NOT IN ('institutional', 'community') THEN
    RAISE EXCEPTION 'Choose a valid visitor registration type.';
  END IF;

  BEGIN
    v_library_id := NULLIF(pg_catalog.btrim(NEW.raw_user_meta_data ->> 'library_id'), '')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'Select a valid preferred library.';
  END;
  IF v_library_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.libraries AS library WHERE library.id = v_library_id
  ) THEN
    RAISE EXCEPTION 'Select a valid preferred library.';
  END IF;

  FOR v_email_match IN
    SELECT visitor.id::text AS id, visitor.auth_user_id
    FROM public.visitors AS visitor
    WHERE pg_catalog.lower(visitor.email) = pg_catalog.lower(NEW.email)
    ORDER BY visitor.id
    FOR UPDATE
  LOOP
    v_email_match_count := v_email_match_count + 1;
    IF v_email_match_count > 1 THEN
      RAISE EXCEPTION 'Multiple visitor profiles match this email and must be reviewed before it can be linked.';
    END IF;
    v_existing_id := v_email_match.id;
    v_existing_auth_user_id := v_email_match.auth_user_id;
  END LOOP;

  IF v_email_match_count > 0 THEN
    IF v_existing_auth_user_id IS NULL THEN
      RAISE EXCEPTION 'A visitor profile already exists for this email and must be reviewed before it can be linked.';
    END IF;
    RAISE EXCEPTION 'This email is already linked to a visitor account.';
  END IF;

  INSERT INTO public.visitors (
    full_name,
    contact_number,
    email,
    address,
    otp_verified,
    qr_code,
    auth_user_id,
    is_active,
    library_id,
    registration_type,
    approval_status
  ) VALUES (
    COALESCE(NEW.raw_user_meta_data ->> 'full_name', 'Visitor'),
    NEW.raw_user_meta_data ->> 'contact_number',
    pg_catalog.lower(NEW.email),
    NEW.raw_user_meta_data ->> 'address',
    false,
    NULL,
    NEW.id,
    false,
    v_library_id,
    v_type,
    'pending'
  );

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.link_visitor_auth_user()
  FROM PUBLIC, anon, authenticated, service_role;

-- Registration completion must match the pending, inactive profile created
-- by the Auth trigger. It does not change the profile or its approval state.
CREATE OR REPLACE FUNCTION public.register_visitor_v2(
  p_auth_user_id uuid,
  p_full_name text,
  p_contact_number text,
  p_email text,
  p_address text,
  p_registration_nonce text,
  p_library_id uuid,
  p_registration_type text
)
RETURNS TABLE(visitor_id text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_metadata jsonb;
  v_email text;
  v_type text;
  v_domain text;
  v_partner_domain text;
  v_visitor_id text;
  v_profile_library_id uuid;
  v_profile_type text;
  v_profile_approval text;
  v_profile_active boolean;
  v_profile_otp_verified boolean;
BEGIN
  v_type := pg_catalog.lower(pg_catalog.btrim(COALESCE(p_registration_type, '')));
  IF v_type IS NULL OR v_type NOT IN ('institutional', 'community') THEN
    RAISE EXCEPTION 'Choose a valid visitor registration type.';
  END IF;
  IF p_library_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.libraries AS library WHERE library.id = p_library_id
  ) THEN
    RAISE EXCEPTION 'Select a valid preferred library.';
  END IF;

  SELECT pg_catalog.lower(account.email), account.raw_user_meta_data
    INTO v_email, v_metadata
  FROM auth.users AS account
  WHERE account.id = p_auth_user_id;

  IF v_email IS NULL
     OR v_email <> pg_catalog.lower(pg_catalog.btrim(p_email))
     OR v_metadata ->> 'role' IS DISTINCT FROM 'visitor'
     OR v_metadata ->> 'registration_type' IS DISTINCT FROM v_type
     OR v_metadata ->> 'registration_nonce' IS DISTINCT FROM p_registration_nonce
     OR v_metadata ->> 'full_name' IS DISTINCT FROM pg_catalog.btrim(p_full_name)
     OR v_metadata ->> 'contact_number' IS DISTINCT FROM NULLIF(pg_catalog.btrim(p_contact_number), '')
     OR v_metadata ->> 'address' IS DISTINCT FROM NULLIF(pg_catalog.btrim(p_address), '')
     OR v_metadata ->> 'library_id' IS DISTINCT FROM p_library_id::text THEN
    RAISE EXCEPTION 'A matching visitor registration proof is required.';
  END IF;

  IF v_type = 'institutional' THEN
    v_domain := pg_catalog.lower(pg_catalog.split_part(v_email, '@', 2));
    SELECT NULLIF(
      pg_catalog.btrim(pg_catalog.lower(pg_catalog.btrim(library.email_domain)), '@.'),
      ''
    )
      INTO v_partner_domain
    FROM public.libraries AS library
    WHERE library.id = p_library_id;
    IF v_domain = 'gmail.com'
       OR v_partner_domain IS NULL
       OR (v_domain <> v_partner_domain
         AND pg_catalog.right(v_domain, pg_catalog.length(v_partner_domain) + 1) <> ('.' || v_partner_domain)) THEN
      RAISE EXCEPTION 'Institutional visitor registration requires an email domain configured for the selected library.';
    END IF;
  END IF;

  SELECT visitor.id::text, visitor.library_id, visitor.registration_type,
         visitor.approval_status, visitor.is_active, visitor.otp_verified
    INTO v_visitor_id, v_profile_library_id, v_profile_type,
         v_profile_approval, v_profile_active, v_profile_otp_verified
  FROM public.visitors AS visitor
  WHERE visitor.auth_user_id = p_auth_user_id
    AND pg_catalog.lower(visitor.email) = v_email
  FOR UPDATE;
  IF v_visitor_id IS NULL THEN
    RAISE EXCEPTION 'The visitor profile was not created by the Auth trigger.';
  END IF;
  IF v_profile_library_id IS DISTINCT FROM p_library_id
     OR v_profile_type IS DISTINCT FROM v_type
     OR v_profile_approval IS DISTINCT FROM 'pending'
     OR v_profile_active IS DISTINCT FROM false
     OR v_profile_otp_verified IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'The visitor profile does not match the original pending registration request.';
  END IF;

  RETURN QUERY SELECT v_visitor_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.register_visitor_v2(uuid, text, text, text, text, text, uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.register_visitor_v2(uuid, text, text, text, text, text, uuid, text)
  TO anon, authenticated;

-- Pending, OTP-verified visitors may read only their own profile status. All
-- visitor-service policies continue to require an active visitor account.
DROP POLICY IF EXISTS "visitor and staff read scoped visitor profiles"
  ON public.visitors;
CREATE POLICY "visitor and staff read scoped visitor profiles"
  ON public.visitors FOR SELECT TO authenticated
  USING (
    (
      auth_user_id = auth.uid()
      AND otp_verified IS TRUE
      AND (
        (approval_status = 'approved' AND is_active IS TRUE)
        OR (
          approval_status = 'pending'
          AND is_active IS FALSE
          AND registration_type IN ('institutional', 'community')
        )
      )
    )
    OR public.is_active_staff_for_branch(library_id::text)
  );

-- Shared approval implementation. A NULL expected type permits both visitor
-- types; the compatibility wrapper below remains restricted to community.
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
  IF NOT public.is_active_staff_for_branch(v_visitor.library_id::text) THEN
    RAISE EXCEPTION 'You are not authorized to approve visitors for this library.' USING ERRCODE = '42501';
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

CREATE OR REPLACE FUNCTION public.approve_visitor(p_visitor_id text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT public.shelf_approve_pending_visitor(p_visitor_id, NULL);
$function$;

REVOKE ALL ON FUNCTION public.approve_visitor(text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.approve_visitor(text) TO authenticated;

-- Preserve the existing RPC contract and its community-only semantics.
CREATE OR REPLACE FUNCTION public.approve_community_visitor(p_visitor_id text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT public.shelf_approve_pending_visitor(p_visitor_id, 'community');
$function$;

REVOKE ALL ON FUNCTION public.approve_community_visitor(text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.approve_community_visitor(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.set_visitor_active(p_visitor_id text, p_is_active boolean)
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
  IF NOT public.is_active_staff_for_branch(v_visitor.library_id::text) THEN
    RAISE EXCEPTION 'You are not authorized to update this visitor account.' USING ERRCODE = '42501';
  END IF;
  IF p_is_active IS TRUE AND v_visitor.approval_status = 'pending' THEN
    RAISE EXCEPTION 'Use the visitor approval action for pending accounts.' USING ERRCODE = '42501';
  END IF;

  UPDATE public.visitors SET is_active = p_is_active WHERE id = v_visitor.id;
  RETURN p_is_active;
END;
$function$;

REVOKE ALL ON FUNCTION public.set_visitor_active(text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_visitor_active(text, boolean) TO authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
