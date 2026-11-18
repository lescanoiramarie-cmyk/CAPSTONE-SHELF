-- Update OTP resend cooldown from 60 seconds to 120 seconds (2 minutes)
-- This migration updates the server-side enforcement in issue_visitor_resend_capability

CREATE OR REPLACE FUNCTION public.issue_visitor_resend_capability(
  p_visitor_id text,
  p_trusted_ip_hash text DEFAULT NULL
)
RETURNS TABLE (capability text, expires_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_visitor public.visitors%rowtype;
  v_capability text;
  v_capability_hash text;
  v_expires timestamptz;
BEGIN
  -- Anonymous/client-callable resend issuance for an active verification session.
  -- To reduce account/state enumeration, invalid/unknown/ineligible requests do
  -- not disclose visitor existence or state details; they return no capability.
  -- Legitimate OTP screens hold a valid unverified visitor session ID.
  SELECT visitor.* INTO v_visitor
  FROM public.visitors AS visitor
  WHERE visitor.id = pg_catalog.btrim(p_visitor_id)
  FOR UPDATE;

  IF v_visitor.id IS NULL
     OR COALESCE(v_visitor.otp_verified, false)
     OR COALESCE(v_visitor.is_active, true) = false THEN
    RETURN;
  END IF;

  -- Updated cooldown: 2 minutes (120 seconds)
  IF v_visitor.otp_last_sent_at IS NOT NULL
     AND v_visitor.otp_last_sent_at > pg_catalog.now() - interval '120 seconds' THEN
    RAISE EXCEPTION 'Please wait before requesting another verification code.' USING ERRCODE = 'P0001';
  END IF;

  BEGIN
    PERFORM public.shelf_visitor_otp_rate_limit_check(v_visitor.id::text, v_visitor.email, p_trusted_ip_hash, 'resend');
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'Please wait before requesting another verification code.' USING ERRCODE = 'P0001';
  END;

  UPDATE public.visitors
  SET otp = NULL, otp_expires_at = NULL, otp_attempts = 0
  WHERE id = v_visitor.id;

  v_capability := encode(extensions.gen_random_bytes(32), 'hex');
  v_capability_hash := public.shelf_hash_secret(v_capability);
  v_expires := pg_catalog.now() + interval '10 minutes';
  INSERT INTO public.visitor_otp_resend_capabilities (visitor_id, capability_hash, purpose, expires_at)
  VALUES (v_visitor.id, v_capability_hash, 'resend', v_expires);

  INSERT INTO public.audit_logs(actor_id, action, branch_id, details)
  VALUES (auth.uid(), 'visitor.otp.resend_requested', NULL, jsonb_build_object('visitorId', v_visitor.id));

  RETURN QUERY SELECT v_capability, v_expires;
END;
$function$;

REVOKE ALL ON FUNCTION public.issue_visitor_resend_capability(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_visitor_resend_capability(text, text) TO anon, authenticated;

-- Postflight assertion: verify cooldown interval is 120 seconds
DO $$
DECLARE
  v_src text;
BEGIN
  SELECT prosrc INTO v_src
  FROM pg_proc
  WHERE proname = 'issue_visitor_resend_capability'
    AND pronamespace = 'public'::regnamespace
    AND proargtypes[0] = 'text'::regtype
    AND proargtypes[1] = 'text'::regtype;

  IF v_src IS NULL THEN
    RAISE EXCEPTION 'Postflight failed: issue_visitor_resend_capability function not found';
  END IF;

  IF v_src !~ 'interval\s*[\'"]120 seconds[\'"]' THEN
    RAISE EXCEPTION 'Postflight failed: issue_visitor_resend_capability cooldown is not 120 seconds. Found: %', v_src;
  END IF;
END $$;