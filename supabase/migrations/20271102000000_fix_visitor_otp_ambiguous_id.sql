BEGIN;

-- verify_visitor_otp returns a column named `id`; qualify visitor table
-- references in UPDATE predicates to avoid PL/pgSQL output-variable ambiguity.
CREATE OR REPLACE FUNCTION public.verify_visitor_otp(p_visitor_id text, p_code text)
RETURNS TABLE (id text, full_name text, email text, qr_code text, error text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_visitor public.visitors%rowtype;
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
    RETURN QUERY SELECT v_visitor.id::text, v_visitor.full_name::text,
      v_visitor.email::text, v_visitor.qr_code::text, NULL::text;
    RETURN;
  END IF;
  IF v_visitor.otp IS NULL THEN
    RETURN QUERY SELECT NULL::text, NULL::text, NULL::text, NULL::text,
      'No verification code is pending. Please request a new code.'::text;
    RETURN;
  END IF;
  IF v_visitor.otp_expires_at IS NOT NULL AND v_visitor.otp_expires_at <= pg_catalog.now() THEN
    UPDATE public.visitors SET otp = NULL, otp_expires_at = NULL, otp_attempts = 0
    WHERE public.visitors.id = v_visitor.id;
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
    UPDATE public.visitors SET otp_attempts = v_attempts + 1
    WHERE public.visitors.id = v_visitor.id;
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

  IF v_visitor.registration_type = 'community' AND v_visitor.approval_status = 'pending' THEN
    v_qr := v_visitor.qr_code;
  ELSE
    v_qr := COALESCE(NULLIF(v_visitor.qr_code, ''), public.generate_visitor_qr_code());
  END IF;
  UPDATE public.visitors
  SET otp_verified = true, qr_code = v_qr, otp = NULL,
      otp_expires_at = NULL, otp_attempts = 0
  WHERE public.visitors.id = v_visitor.id;
  INSERT INTO public.audit_logs(actor_id, action, branch_id, details)
  VALUES (auth.uid(), 'visitor.registration.verified', NULL,
    pg_catalog.jsonb_build_object('visitorId', v_visitor.id, 'fullName', v_visitor.full_name, 'email', v_visitor.email));
  RETURN QUERY SELECT v_visitor.id::text, v_visitor.full_name::text,
    v_visitor.email::text, v_qr::text, NULL::text;
END;
$function$;

REVOKE ALL ON FUNCTION public.verify_visitor_otp(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.verify_visitor_otp(text, text) TO anon, authenticated;

COMMIT;
