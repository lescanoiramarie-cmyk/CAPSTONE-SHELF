CREATE OR REPLACE FUNCTION public.register_visitor (
  p_auth_user_id       uuid,
  p_full_name          text,
  p_contact_number     text,
  p_email              text,
  p_address            text,
  p_registration_nonce text,
  p_library_id         uuid
)
  RETURNS TABLE (
    visitor_id text
  )
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'auth'
  AS $function$
DECLARE
  auth_metadata jsonb;
  auth_email text;
  visitor_id_value text;
BEGIN
  SELECT
    lower(account.email),
    account.raw_user_meta_data
  INTO
    auth_email,
    auth_metadata
  FROM auth.users AS account
  WHERE account.id = p_auth_user_id;

  IF auth_email IS NULL
    OR auth_email <> lower(trim(p_email))
    OR auth_metadata ->> 'role' IS DISTINCT FROM 'visitor'
    OR auth_metadata ->> 'registration_nonce' IS DISTINCT FROM p_registration_nonce
    OR auth_metadata ->> 'full_name' IS DISTINCT FROM trim(p_full_name)
    OR auth_metadata ->> 'contact_number' IS DISTINCT FROM nullif(trim(p_contact_number), '')
    OR auth_metadata ->> 'address' IS DISTINCT FROM nullif(trim(p_address), '')
  THEN
    RAISE EXCEPTION 'A matching visitor registration proof is required.';
  END IF;

  IF p_library_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.libraries AS library
    WHERE library.id = p_library_id
  ) THEN
    RAISE EXCEPTION 'Select a valid library branch or Outside Visitor.';
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

  RETURN QUERY
  SELECT visitor_id_value;
END;
$function$;

GRANT EXECUTE ON FUNCTION "public"."register_visitor"(uuid, text, text, text, text, text, uuid) TO "anon", "authenticated", "postgres", "service_role";

REVOKE ALL ON FUNCTION "public"."register_visitor"(uuid, text, text, text, text, text, uuid) FROM PUBLIC;
