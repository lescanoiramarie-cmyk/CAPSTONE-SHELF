BEGIN;

-- Pending community visitors are intentionally inactive until staff approval,
-- but still need to be able to resend their email verification code.
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
  v_pending_community boolean;
BEGIN
  SELECT visitor.* INTO v_visitor
  FROM public.visitors AS visitor
  WHERE visitor.id = pg_catalog.btrim(p_visitor_id)
  FOR UPDATE;

  v_pending_community :=
    v_visitor.registration_type = 'community'
    AND v_visitor.approval_status = 'pending';

  IF v_visitor.id IS NULL
     OR COALESCE(v_visitor.otp_verified, false)
     OR (COALESCE(v_visitor.is_active, true) = false AND NOT v_pending_community) THEN
    RETURN;
  END IF;

  IF v_visitor.otp_last_sent_at IS NOT NULL
     AND v_visitor.otp_last_sent_at > pg_catalog.now() - interval '120 seconds' THEN
    RAISE EXCEPTION 'Please wait before requesting another verification code.' USING ERRCODE = 'P0001';
  END IF;

  BEGIN
    PERFORM public.shelf_visitor_otp_rate_limit_check(
      v_visitor.id::text, v_visitor.email, p_trusted_ip_hash, 'resend'
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'Please wait before requesting another verification code.' USING ERRCODE = 'P0001';
  END;

  UPDATE public.visitors
  SET otp = NULL, otp_expires_at = NULL, otp_attempts = 0
  WHERE public.visitors.id = v_visitor.id;

  v_capability := encode(extensions.gen_random_bytes(32), 'hex');
  v_capability_hash := public.shelf_hash_secret(v_capability);
  v_expires := pg_catalog.now() + interval '10 minutes';
  INSERT INTO public.visitor_otp_resend_capabilities (visitor_id, capability_hash, purpose, expires_at)
  VALUES (v_visitor.id, v_capability_hash, 'resend', v_expires);

  INSERT INTO public.audit_logs(actor_id, action, branch_id, details)
  VALUES (auth.uid(), 'visitor.otp.resend_requested', NULL,
    pg_catalog.jsonb_build_object('visitorId', v_visitor.id));

  RETURN QUERY SELECT v_capability, v_expires;
END;
$function$;

REVOKE ALL ON FUNCTION public.issue_visitor_resend_capability(text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_visitor_resend_capability(text, text)
  TO anon, authenticated;

COMMIT;
