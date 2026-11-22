BEGIN;

-- Public libraries accept open community registrations, not institution-only
-- registrations. Enforce this before Auth creates a user/profile so a forged
-- client request cannot create a partially registered visitor account.
CREATE OR REPLACE FUNCTION public.enforce_public_library_registration_type()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_library_id uuid;
  v_access_mode text;
  v_type text;
BEGIN
  IF COALESCE(NEW.raw_user_meta_data ->> 'role', '') <> 'visitor' THEN
    RETURN NEW;
  END IF;

  v_type := COALESCE(
    NULLIF(pg_catalog.lower(pg_catalog.btrim(NEW.raw_user_meta_data ->> 'registration_type')), ''),
    'institutional'
  );
  BEGIN
    v_library_id := NULLIF(pg_catalog.btrim(NEW.raw_user_meta_data ->> 'library_id'), '')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'Select a valid preferred library.';
  END;

  SELECT COALESCE(library.visitor_access_mode, 'institutional')
    INTO v_access_mode
  FROM public.libraries AS library
  WHERE library.id = v_library_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Select a valid preferred library.';
  END IF;

  IF v_access_mode = 'public' AND v_type <> 'community' THEN
    RAISE EXCEPTION 'This public library uses open registration. Choose Public / Community Visitor.';
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.enforce_public_library_registration_type()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS enforce_public_library_registration_type ON auth.users;
CREATE TRIGGER enforce_public_library_registration_type
  BEFORE INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_public_library_registration_type();

COMMIT;
