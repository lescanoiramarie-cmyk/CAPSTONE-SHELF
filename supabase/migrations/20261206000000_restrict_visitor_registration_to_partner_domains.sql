BEGIN;

CREATE OR REPLACE FUNCTION public.enforce_visitor_email_domain()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  visitor_domain text;
  partner_domain text;
  selected_library_id text;
BEGIN
  IF COALESCE(new.raw_user_meta_data ->> 'role', '') <> 'visitor' THEN
    RETURN new;
  END IF;

  visitor_domain := lower(split_part(trim(COALESCE(new.email, '')), '@', 2));
  selected_library_id := NULLIF(
    trim(new.raw_user_meta_data ->> 'library_id'),
    ''
  );

  SELECT trim(both '@.' from lower(trim(library.email_domain)))
  INTO partner_domain
  FROM public.libraries AS library
  WHERE library.id::text = selected_library_id
    AND NULLIF(trim(both '@.' from lower(trim(library.email_domain))), '') IS NOT NULL;

  IF visitor_domain = 'gmail.com'
     OR partner_domain IS NULL
     OR (
       visitor_domain <> partner_domain
       AND right(visitor_domain, length(partner_domain) + 1) <> ('.' || partner_domain)
     )
  THEN
    RAISE EXCEPTION
      'Visitor registration requires an email domain configured for the selected partner library or school.';
  END IF;

  RETURN new;
END;
$function$;

REVOKE ALL ON FUNCTION public.enforce_visitor_email_domain()
  FROM PUBLIC, anon, authenticated;

DROP FUNCTION IF EXISTS public.register_visitor(
  uuid, text, text, text, text, text, uuid
);

CREATE FUNCTION public.register_visitor(
  p_auth_user_id uuid,
  p_full_name text,
  p_contact_number text,
  p_email text,
  p_address text,
  p_registration_nonce text,
  p_library_id uuid
)
RETURNS TABLE(visitor_id text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  auth_metadata jsonb;
  auth_email text;
  visitor_id_value text;
  visitor_domain text;
  partner_domain text;
BEGIN
  SELECT lower(account.email), account.raw_user_meta_data
  INTO auth_email, auth_metadata
  FROM auth.users AS account
  WHERE account.id = p_auth_user_id;

  IF auth_email IS NULL
     OR auth_email <> lower(trim(p_email))
     OR auth_metadata ->> 'role' IS DISTINCT FROM 'visitor'
     OR auth_metadata ->> 'registration_nonce' IS DISTINCT FROM p_registration_nonce
     OR auth_metadata ->> 'full_name' IS DISTINCT FROM trim(p_full_name)
     OR auth_metadata ->> 'contact_number' IS DISTINCT FROM NULLIF(trim(p_contact_number), '')
     OR auth_metadata ->> 'address' IS DISTINCT FROM NULLIF(trim(p_address), '')
     OR auth_metadata ->> 'library_id' IS DISTINCT FROM p_library_id::text
  THEN
    RAISE EXCEPTION 'A matching visitor registration proof is required.';
  END IF;

  visitor_domain := lower(split_part(auth_email, '@', 2));

  SELECT trim(both '@.' from lower(trim(library.email_domain)))
  INTO partner_domain
  FROM public.libraries AS library
  WHERE library.id = p_library_id
    AND NULLIF(trim(both '@.' from lower(trim(library.email_domain))), '') IS NOT NULL;

  IF p_library_id IS NULL
     OR visitor_domain = 'gmail.com'
     OR partner_domain IS NULL
     OR (
       visitor_domain <> partner_domain
       AND right(visitor_domain, length(partner_domain) + 1) <> ('.' || partner_domain)
     )
  THEN
    RAISE EXCEPTION
      'Visitor registration requires an email domain configured for the selected partner library or school.';
  END IF;

  SELECT visitor.id
  INTO visitor_id_value
  FROM public.visitors AS visitor
  WHERE visitor.auth_user_id = p_auth_user_id
    AND lower(visitor.email) = auth_email
  FOR UPDATE;

  IF visitor_id_value IS NULL THEN
    RAISE EXCEPTION 'The visitor profile was not created by the Auth trigger.';
  END IF;

  UPDATE public.visitors
  SET library_id = p_library_id
  WHERE auth_user_id = p_auth_user_id;

  RETURN QUERY SELECT visitor_id_value;
END;
$function$;

REVOKE ALL ON FUNCTION public.register_visitor(
  uuid, text, text, text, text, text, uuid
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.register_visitor(
  uuid, text, text, text, text, text, uuid
) TO anon, authenticated;

DROP TRIGGER IF EXISTS on_auth_user_visitor_domain_validate ON auth.users;
CREATE TRIGGER on_auth_user_visitor_domain_validate
  BEFORE INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_visitor_email_domain();

NOTIFY pgrst, 'reload schema';

COMMIT;
