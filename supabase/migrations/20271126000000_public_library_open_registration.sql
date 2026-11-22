BEGIN;

ALTER TABLE public.libraries
  ADD COLUMN IF NOT EXISTS visitor_access_mode text NOT NULL DEFAULT 'institutional';

DO $constraints$
DECLARE
  v_definition text;
  v_type "char";
  v_validated boolean;
BEGIN
  SELECT pg_catalog.pg_get_constraintdef(oid), contype, convalidated
    INTO v_definition, v_type, v_validated
  FROM pg_catalog.pg_constraint
  WHERE conrelid = 'public.libraries'::pg_catalog.regclass
    AND conname = 'libraries_visitor_access_mode_check';

  IF NOT FOUND THEN
    ALTER TABLE public.libraries
      ADD CONSTRAINT libraries_visitor_access_mode_check
      CHECK (visitor_access_mode IN ('institutional', 'public'));
  ELSIF v_type <> 'c' OR NOT v_validated
     OR pg_catalog.strpos(pg_catalog.lower(v_definition), 'visitor_access_mode') = 0
     OR pg_catalog.strpos(pg_catalog.lower(v_definition), 'institutional') = 0
     OR pg_catalog.strpos(pg_catalog.lower(v_definition), 'public') = 0 THEN
    RAISE EXCEPTION 'Existing libraries_visitor_access_mode_check is not the expected validated access-mode constraint.';
  END IF;
END;
$constraints$;

-- Public-library community visitors are activated only after they verify their
-- email. Institutional-library community visitors keep their approval queue.
CREATE OR REPLACE FUNCTION public.apply_public_library_visitor_access()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_access_mode text;
BEGIN
  IF NEW.registration_type <> 'community' THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(library.visitor_access_mode, 'institutional')
    INTO v_access_mode
  FROM public.libraries AS library
  WHERE library.id = NEW.library_id;

  IF v_access_mode = 'public' THEN
    NEW.approval_status := 'approved';
    -- Keep the account inactive until OTP verification completes. Only the
    -- verification transition activates it; a later staff deactivation stays.
    IF TG_OP = 'UPDATE' AND NEW.otp_verified IS TRUE
       AND OLD.otp_verified IS DISTINCT FROM TRUE THEN
      NEW.is_active := true;
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.apply_public_library_visitor_access()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS apply_public_library_visitor_access ON public.visitors;
CREATE TRIGGER apply_public_library_visitor_access
  BEFORE INSERT OR UPDATE
  ON public.visitors
  FOR EACH ROW
  EXECUTE FUNCTION public.apply_public_library_visitor_access();

-- If an existing branch is explicitly changed to public, its already email-
-- verified community registrations no longer need a manual approval step.
CREATE OR REPLACE FUNCTION public.activate_public_library_community_visitors()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF NEW.visitor_access_mode = 'public'
     AND OLD.visitor_access_mode IS DISTINCT FROM 'public' THEN
    UPDATE public.visitors AS visitor
    SET approval_status = 'approved', is_active = visitor.otp_verified
    WHERE visitor.library_id = NEW.id
      AND visitor.registration_type = 'community'
      AND visitor.approval_status = 'pending';
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.activate_public_library_community_visitors()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS activate_public_library_community_visitors ON public.libraries;
CREATE TRIGGER activate_public_library_community_visitors
  AFTER UPDATE OF visitor_access_mode ON public.libraries
  FOR EACH ROW
  EXECUTE FUNCTION public.activate_public_library_community_visitors();

-- Keep the existing RPC contract while deriving the expected approval state
-- from trusted library configuration instead of client metadata.
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
  v_access_mode text;
  v_expected_approval text;
  v_visitor_id text;
  v_profile_library_id uuid;
  v_profile_type text;
  v_profile_approval text;
BEGIN
  v_type := pg_catalog.lower(pg_catalog.btrim(COALESCE(p_registration_type, '')));
  IF v_type IS NULL OR v_type NOT IN ('institutional', 'community') THEN
    RAISE EXCEPTION 'Choose a valid visitor registration type.';
  END IF;

  SELECT COALESCE(library.visitor_access_mode, 'institutional'),
         NULLIF(pg_catalog.btrim(pg_catalog.lower(pg_catalog.btrim(library.email_domain)), '@.'), '')
    INTO v_access_mode, v_partner_domain
  FROM public.libraries AS library
  WHERE library.id = p_library_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Select a valid preferred library.';
  END IF;

  IF v_type = 'institutional' THEN
    v_domain := pg_catalog.lower(pg_catalog.split_part(pg_catalog.btrim(COALESCE(p_email, '')), '@', 2));
    IF v_domain = 'gmail.com'
       OR v_partner_domain IS NULL
       OR (v_domain <> v_partner_domain
         AND pg_catalog.right(v_domain, pg_catalog.length(v_partner_domain) + 1) <> ('.' || v_partner_domain)) THEN
      RAISE EXCEPTION 'Institutional visitor registration requires an email domain configured for the selected library.';
    END IF;
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

  v_expected_approval := CASE
    WHEN v_type = 'community' AND v_access_mode <> 'public' THEN 'pending'
    ELSE 'approved'
  END;

  SELECT visitor.id::text, visitor.library_id,
         visitor.registration_type, visitor.approval_status
    INTO v_visitor_id, v_profile_library_id, v_profile_type, v_profile_approval
  FROM public.visitors AS visitor
  WHERE visitor.auth_user_id = p_auth_user_id
    AND pg_catalog.lower(visitor.email) = v_email
  FOR UPDATE;
  IF v_visitor_id IS NULL THEN
    RAISE EXCEPTION 'The visitor profile was not created by the Auth trigger.';
  END IF;

  IF v_profile_library_id IS DISTINCT FROM p_library_id
     OR v_profile_type IS DISTINCT FROM v_type
     OR v_profile_approval IS DISTINCT FROM v_expected_approval THEN
    RAISE EXCEPTION 'The visitor profile does not match the original registration request.';
  END IF;

  RETURN QUERY SELECT v_visitor_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.register_visitor_v2(uuid, text, text, text, text, text, uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.register_visitor_v2(uuid, text, text, text, text, text, uuid, text)
  TO anon, authenticated;

COMMIT;
