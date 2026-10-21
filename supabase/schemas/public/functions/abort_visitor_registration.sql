CREATE OR REPLACE FUNCTION public.abort_visitor_registration (
  p_visitor_id         text,
  p_registration_nonce text
)
  RETURNS boolean
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'auth'
  AS $function$
DECLARE
  v_visitor public.visitors%rowtype;
  v_metadata jsonb;
  v_nonce text;
BEGIN
  SELECT visitor.*
  INTO v_visitor
  FROM public.visitors AS visitor
  WHERE visitor.id = trim(p_visitor_id);

  IF v_visitor.id IS NULL THEN
    RETURN false;
  END IF;

  IF coalesce(v_visitor.otp_verified, false)
     OR NOT coalesce(v_visitor.is_active, true)
  THEN
    RETURN false;
  END IF;

  SELECT account.raw_user_meta_data
  INTO v_metadata
  FROM auth.users AS account
  WHERE account.id = v_visitor.auth_user_id;

  v_nonce := v_metadata ->> 'registration_nonce';

  IF v_nonce IS NULL
     OR v_nonce <> trim(p_registration_nonce)
  THEN
    RAISE EXCEPTION 'A matching visitor registration proof is required.';
  END IF;

  DELETE FROM auth.users
  WHERE id = v_visitor.auth_user_id;

  INSERT INTO public.audit_logs(
    actor_id,
    action,
    branch_id,
    details
  )
  VALUES (
    auth.uid(),
    'visitor.registration.rolled_back',
    NULL,
    jsonb_build_object(
      'visitorId', v_visitor.id,
      'fullName', v_visitor.full_name,
      'email', v_visitor.email,
      'reason', 'verification_email_not_delivered'
    )
  );

  RETURN true;
END;
$function$;

GRANT EXECUTE ON FUNCTION "public"."abort_visitor_registration"(text, text) TO "anon", "authenticated", "postgres", "service_role";

REVOKE ALL ON FUNCTION "public"."abort_visitor_registration"(text, text) FROM PUBLIC;
