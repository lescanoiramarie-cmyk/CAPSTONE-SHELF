BEGIN;

-- ============================================================================
-- Visitor OTP delivery hardening (Batch 3A Group 1)
-- - Binds registration OTP issuance to trusted auth metadata/nonce + visitor.
-- - Removes anonymous visitor-ID disclosure from recovery.
-- - Introduces durable delivery intents and compare-and-set state transitions.
-- - Adds layered rate limits (visitor/email/trusted IP when verifiable).
-- - Preserves abort_visitor_registration compatibility and existing verify
--   contract/behavioral surface as far as safely possible.
-- - Additive; no production application in this task.
--
-- Distributed limitation: database state and external provider delivery are not
-- one atomic transaction. Ambiguous provider outcomes fail closed.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE public.visitors
  ADD COLUMN IF NOT EXISTS registration_otp_send_consumed_at timestamptz,
  ADD COLUMN IF NOT EXISTS registration_otp_send_expires_at timestamptz;

-- Durable delivery intent / idempotency / audit-safe state machine.
CREATE TABLE IF NOT EXISTS public.visitor_otp_delivery_intents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  visitor_id text NOT NULL REFERENCES public.visitors(id) ON DELETE CASCADE,
  auth_user_id uuid,
  purpose text NOT NULL CHECK (purpose IN ('registration_send', 'resend', 'recovery', 'qr_email')),
  channel text NOT NULL CHECK (channel IN ('otp', 'qr')),
  state text NOT NULL CHECK (state IN (
    'pending_claim', 'provider_submitting', 'provider_accepted',
    'provider_rejected', 'persisted', 'failed', 'ambiguous_timeout'
  )),
  idempotency_key text,
  email_hash text,
  trusted_ip_hash text,
  registration_nonce_hash text,
  resend_capability_hash text,
  provider_message_id text,
  otp_hash text,
  otp_expires_at timestamptz,
  failure_code text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  updated_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  submitted_at timestamptz,
  resolved_at timestamptz,
  expires_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS visitor_otp_delivery_intents_visitor_created_idx
  ON public.visitor_otp_delivery_intents (visitor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS visitor_otp_delivery_intents_email_created_idx
  ON public.visitor_otp_delivery_intents (email_hash, created_at DESC)
  WHERE email_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS visitor_otp_delivery_intents_ip_created_idx
  ON public.visitor_otp_delivery_intents (trusted_ip_hash, created_at DESC)
  WHERE trusted_ip_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS visitor_otp_delivery_intents_active_idx
  ON public.visitor_otp_delivery_intents (visitor_id, channel, state)
  WHERE state IN ('pending_claim', 'provider_submitting', 'provider_accepted');

ALTER TABLE public.visitor_otp_delivery_intents ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.visitor_otp_delivery_intents FROM PUBLIC, anon, authenticated;

CREATE TABLE IF NOT EXISTS public.visitor_otp_resend_capabilities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  visitor_id text NOT NULL REFERENCES public.visitors(id) ON DELETE CASCADE,
  capability_hash text NOT NULL UNIQUE,
  purpose text NOT NULL CHECK (purpose IN ('resend', 'recovery')),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.now()
);

CREATE INDEX IF NOT EXISTS visitor_otp_resend_capabilities_visitor_idx
  ON public.visitor_otp_resend_capabilities (visitor_id, expires_at DESC);

ALTER TABLE public.visitor_otp_resend_capabilities ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.visitor_otp_resend_capabilities FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Helpers (SECURITY DEFINER; private execution)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.shelf_normalize_email(p_email text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $function$
  SELECT NULLIF(pg_catalog.lower(pg_catalog.btrim(COALESCE(p_email, ''))), '');
$function$;
REVOKE ALL ON FUNCTION public.shelf_normalize_email(text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.shelf_hash_secret(p_value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $function$
  SELECT CASE
    WHEN p_value IS NULL OR p_value = '' THEN NULL
    ELSE encode(extensions.digest(convert_to(p_value, 'UTF8'), 'sha256'), 'hex')
  END;
$function$;
REVOKE ALL ON FUNCTION public.shelf_hash_secret(text) FROM PUBLIC, anon, authenticated;

-- Keyed OTP protection compatible with edge HMAC-SHA256(visitor_id:otp).
-- Secret is read from current_setting('app.settings.visitor_otp_hmac_secret', true)
-- and must be configured in trusted DB/runtime environments. If unavailable,
-- keyed OTP verification fails closed; only pre-existing legacy plaintext rows
-- (6-digit stored value, controlled transition path) may be verified.
CREATE OR REPLACE FUNCTION public.shelf_visitor_otp_hmac(p_visitor_id text, p_otp text)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_secret text;
BEGIN
  v_secret := NULLIF(current_setting('app.settings.visitor_otp_hmac_secret', true), '');
  IF v_secret IS NULL THEN
    RETURN NULL;
  END IF;
  RETURN encode(
    extensions.hmac(
      convert_to(pg_catalog.btrim(p_visitor_id) || ':' || pg_catalog.btrim(p_otp), 'UTF8'),
      convert_to(v_secret, 'UTF8'),
      'sha256'
    ),
    'hex'
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.shelf_visitor_otp_hmac(text, text) FROM PUBLIC, anon, authenticated;

-- Trusted IP must be supplied by verified edge infrastructure; DB never trusts
-- arbitrary forwarded headers directly. NULL means unavailable/untrusted.
CREATE OR REPLACE FUNCTION public.shelf_visitor_otp_rate_limit_check(
  p_visitor_id text,
  p_email text,
  p_trusted_ip_hash text,
  p_purpose text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_email_hash text;
  v_recent_visitor integer;
  v_recent_email integer;
  v_recent_ip integer;
BEGIN
  v_email_hash := public.shelf_hash_secret(public.shelf_normalize_email(p_email));

  IF p_visitor_id IS NOT NULL THEN
    SELECT count(*) INTO v_recent_visitor
    FROM public.visitor_otp_delivery_intents intent
    WHERE intent.visitor_id = p_visitor_id
      AND intent.purpose = p_purpose
      AND intent.created_at > pg_catalog.now() - interval '15 minutes'
      AND intent.state <> 'failed';
    IF v_recent_visitor >= 5 THEN
      RAISE EXCEPTION 'Please wait before requesting another verification code.' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  IF v_email_hash IS NOT NULL THEN
    SELECT count(*) INTO v_recent_email
    FROM public.visitor_otp_delivery_intents intent
    WHERE intent.email_hash = v_email_hash
      AND intent.created_at > pg_catalog.now() - interval '15 minutes'
      AND intent.state <> 'failed';
    IF v_recent_email >= 8 THEN
      RAISE EXCEPTION 'Please wait before requesting another verification code.' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  IF p_trusted_ip_hash IS NOT NULL AND p_trusted_ip_hash <> '' THEN
    SELECT count(*) INTO v_recent_ip
    FROM public.visitor_otp_delivery_intents intent
    WHERE intent.trusted_ip_hash = p_trusted_ip_hash
      AND intent.created_at > pg_catalog.now() - interval '10 minutes'
      AND intent.state <> 'failed';
    IF v_recent_ip >= 20 THEN
      RAISE EXCEPTION 'Please wait before requesting another verification code.' USING ERRCODE = 'P0001';
    END IF;
  END IF;
END;
$function$;
REVOKE ALL ON FUNCTION public.shelf_visitor_otp_rate_limit_check(text, text, text, text) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Registration send proof verification for edge function (service role path).
-- Preserves abort compatibility: abort still validates auth metadata nonce.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.verify_visitor_registration_send_proof(
  p_visitor_id text,
  p_registration_nonce text
)
RETURNS TABLE (
  visitor_id text,
  auth_user_id uuid,
  email text,
  full_name text,
  registration_type text,
  approval_status text,
  library_id uuid,
  otp_verified boolean,
  is_active boolean,
  qr_code text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_visitor public.visitors%rowtype;
  v_metadata jsonb;
  v_auth_email text;
BEGIN
  SELECT visitor.* INTO v_visitor
  FROM public.visitors AS visitor
  WHERE visitor.id = pg_catalog.btrim(p_visitor_id)
  FOR UPDATE;

  IF v_visitor.id IS NULL THEN
    RAISE EXCEPTION 'Registration not found. Please register again.' USING ERRCODE = 'P0002';
  END IF;
  IF v_visitor.auth_user_id IS NULL THEN
    RAISE EXCEPTION 'A matching visitor registration proof is required.' USING ERRCODE = '42501';
  END IF;
  IF COALESCE(v_visitor.otp_verified, false) THEN
    RAISE EXCEPTION 'This visitor has already been verified.' USING ERRCODE = 'P0001';
  END IF;

  SELECT pg_catalog.lower(account.email), account.raw_user_meta_data
    INTO v_auth_email, v_metadata
  FROM auth.users AS account
  WHERE account.id = v_visitor.auth_user_id;

  IF v_auth_email IS NULL THEN
    RAISE EXCEPTION 'A matching visitor registration proof is required.' USING ERRCODE = '42501';
  END IF;
  IF v_metadata ->> 'role' IS DISTINCT FROM 'visitor'
     OR v_metadata ->> 'registration_nonce' IS DISTINCT FROM pg_catalog.btrim(p_registration_nonce)
     OR v_metadata ->> 'registration_type' IS DISTINCT FROM v_visitor.registration_type
     OR v_metadata ->> 'library_id' IS DISTINCT FROM v_visitor.library_id::text
     OR pg_catalog.lower(COALESCE(v_visitor.email, '')) IS DISTINCT FROM v_auth_email THEN
    RAISE EXCEPTION 'A matching visitor registration proof is required.' USING ERRCODE = '42501';
  END IF;

  IF v_visitor.registration_otp_send_consumed_at IS NOT NULL THEN
    RAISE EXCEPTION 'This verification request can no longer be used. Please register again.' USING ERRCODE = 'P0001';
  END IF;
  IF v_visitor.registration_otp_send_expires_at IS NOT NULL
     AND v_visitor.registration_otp_send_expires_at <= pg_catalog.now() THEN
    RAISE EXCEPTION 'This verification request has expired. Please register again.' USING ERRCODE = 'P0001';
  END IF;

  IF v_visitor.registration_otp_send_expires_at IS NULL THEN
    UPDATE public.visitors
    SET registration_otp_send_expires_at = pg_catalog.now() + interval '30 minutes'
    WHERE id = v_visitor.id;
    v_visitor.registration_otp_send_expires_at := pg_catalog.now() + interval '30 minutes';
  END IF;

  RETURN QUERY SELECT
    v_visitor.id::text,
    v_visitor.auth_user_id,
    v_visitor.email::text,
    v_visitor.full_name::text,
    v_visitor.registration_type::text,
    v_visitor.approval_status::text,
    v_visitor.library_id,
    COALESCE(v_visitor.otp_verified, false),
    COALESCE(v_visitor.is_active, false),
    v_visitor.qr_code::text;
END;
$function$;
REVOKE ALL ON FUNCTION public.verify_visitor_registration_send_proof(text, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.consume_visitor_registration_send_proof(
  p_visitor_id text,
  p_registration_nonce text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_rows integer;
BEGIN
  PERFORM 1 FROM public.verify_visitor_registration_send_proof(p_visitor_id, p_registration_nonce);
  UPDATE public.visitors
  SET registration_otp_send_consumed_at = pg_catalog.now()
  WHERE id = pg_catalog.btrim(p_visitor_id)
    AND registration_otp_send_consumed_at IS NULL;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows > 0;
END;
$function$;
REVOKE ALL ON FUNCTION public.consume_visitor_registration_send_proof(text, text) FROM PUBLIC, anon, authenticated;

-- Generic recovery (no visitor_id disclosure)
CREATE OR REPLACE FUNCTION public.request_visitor_otp_recovery(
  p_email text,
  p_trusted_ip_hash text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_email text;
BEGIN
  v_email := public.shelf_normalize_email(p_email);
  IF v_email IS NOT NULL THEN
    BEGIN
      PERFORM public.shelf_visitor_otp_rate_limit_check(NULL, v_email, p_trusted_ip_hash, 'recovery');
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
  END IF;
  INSERT INTO public.audit_logs(actor_id, action, branch_id, details)
  VALUES (auth.uid(), 'visitor.otp.recovery_requested', NULL, jsonb_build_object('result', 'requested'));
  RETURN jsonb_build_object(
    'success', true,
    'message', 'If an unverified registration exists for that address, a new verification code will be sent.'
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.request_visitor_otp_recovery(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.request_visitor_otp_recovery(text, text) TO anon, authenticated;

-- Internal: resolve recovery issuance for edge service role (no visitor_id to client).
CREATE OR REPLACE FUNCTION public.issue_visitor_recovery_capability(
  p_email text,
  p_trusted_ip_hash text DEFAULT NULL
)
RETURNS TABLE (visitor_id text, capability text, email text, full_name text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_email text;
  v_visitor public.visitors%rowtype;
  v_capability text;
  v_capability_hash text;
BEGIN
  v_email := public.shelf_normalize_email(p_email);
  IF v_email IS NULL THEN
    RETURN;
  END IF;

  PERFORM public.shelf_visitor_otp_rate_limit_check(NULL, v_email, p_trusted_ip_hash, 'recovery');

  SELECT visitor.* INTO v_visitor
  FROM public.visitors AS visitor
  WHERE pg_catalog.lower(visitor.email) = v_email
    AND COALESCE(visitor.otp_verified, false) = false
    AND COALESCE(visitor.is_active, true) = true
  ORDER BY visitor.registered_at DESC NULLS LAST
  LIMIT 1
  FOR UPDATE;

  IF v_visitor.id IS NULL THEN
    RETURN;
  END IF;

  IF v_visitor.otp_last_sent_at IS NOT NULL
     AND v_visitor.otp_last_sent_at > pg_catalog.now() - interval '60 seconds' THEN
    RAISE EXCEPTION 'Please wait before requesting another verification code.' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.visitors
  SET otp = NULL, otp_expires_at = NULL, otp_attempts = 0
  WHERE id = v_visitor.id;

  v_capability := encode(extensions.gen_random_bytes(32), 'hex');
  v_capability_hash := public.shelf_hash_secret(v_capability);
  INSERT INTO public.visitor_otp_resend_capabilities (visitor_id, capability_hash, purpose, expires_at)
  VALUES (v_visitor.id, v_capability_hash, 'recovery', pg_catalog.now() + interval '10 minutes');

  RETURN QUERY SELECT v_visitor.id::text, v_capability, v_visitor.email::text, v_visitor.full_name::text;
END;
$function$;
REVOKE ALL ON FUNCTION public.issue_visitor_recovery_capability(text, text) FROM PUBLIC, anon, authenticated;

-- Server-controlled resend issuance for known verification session.
-- Returns opaque capability to client; capability is required by edge.
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

  IF v_visitor.otp_last_sent_at IS NOT NULL
     AND v_visitor.otp_last_sent_at > pg_catalog.now() - interval '60 seconds' THEN
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

CREATE OR REPLACE FUNCTION public.consume_visitor_resend_capability(
  p_capability text
)
RETURNS TABLE (visitor_id text, purpose text, email text, full_name text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_hash text;
  v_row public.visitor_otp_resend_capabilities%rowtype;
  v_visitor public.visitors%rowtype;
BEGIN
  v_hash := public.shelf_hash_secret(pg_catalog.btrim(p_capability));
  IF v_hash IS NULL THEN
    RAISE EXCEPTION 'A valid verification request is required.' USING ERRCODE = '42501';
  END IF;

  SELECT cap.* INTO v_row
  FROM public.visitor_otp_resend_capabilities AS cap
  WHERE cap.capability_hash = v_hash
  FOR UPDATE;

  IF v_row.id IS NULL OR v_row.consumed_at IS NOT NULL OR v_row.expires_at <= pg_catalog.now() THEN
    RAISE EXCEPTION 'This verification request is invalid or has expired.' USING ERRCODE = '42501';
  END IF;

  UPDATE public.visitor_otp_resend_capabilities
  SET consumed_at = pg_catalog.now()
  WHERE id = v_row.id;

  SELECT visitor.* INTO v_visitor
  FROM public.visitors AS visitor
  WHERE visitor.id = v_row.visitor_id;

  IF v_visitor.id IS NULL OR COALESCE(v_visitor.otp_verified, false) THEN
    RAISE EXCEPTION 'This verification request is no longer valid.' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY SELECT v_visitor.id::text, v_row.purpose::text, v_visitor.email::text, v_visitor.full_name::text;
END;
$function$;
REVOKE ALL ON FUNCTION public.consume_visitor_resend_capability(text) FROM PUBLIC, anon, authenticated;

-- Legacy public RPCs: keep signatures but remove insecure behavior.
CREATE OR REPLACE FUNCTION public.find_unverified_visitor(p_email text)
RETURNS TABLE(visitor_id text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  -- Legacy signature retained for compatibility but never returns visitor IDs.
  RETURN;
END;
$function$;
REVOKE ALL ON FUNCTION public.find_unverified_visitor(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.find_unverified_visitor(text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.resend_otp(p_visitor_id text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  RAISE EXCEPTION 'Use the secure verification resend flow.' USING ERRCODE = '42501';
END;
$function$;
REVOKE ALL ON FUNCTION public.resend_otp(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resend_otp(text) TO anon, authenticated;

-- Preserve abort_visitor_registration behavior/compatibility.
CREATE OR REPLACE FUNCTION public.abort_visitor_registration(
  p_visitor_id text,
  p_registration_nonce text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $function$
DECLARE
  v_visitor public.visitors%rowtype;
  v_metadata jsonb;
  v_nonce text;
BEGIN
  SELECT visitor.* INTO v_visitor
  FROM public.visitors AS visitor
  WHERE visitor.id = pg_catalog.btrim(p_visitor_id);

  IF v_visitor.id IS NULL THEN
    RETURN false;
  END IF;

  IF COALESCE(v_visitor.otp_verified, false) OR v_visitor.qr_code IS NOT NULL THEN
    RAISE EXCEPTION 'This visitor has already been verified and cannot be removed.';
  END IF;
  IF v_visitor.auth_user_id IS NULL THEN
    RAISE EXCEPTION 'This registration cannot be rolled back automatically.';
  END IF;

  SELECT account.raw_user_meta_data INTO v_metadata
  FROM auth.users AS account
  WHERE account.id = v_visitor.auth_user_id;
  v_nonce := v_metadata ->> 'registration_nonce';
  IF v_nonce IS NULL OR v_nonce <> pg_catalog.btrim(p_registration_nonce) THEN
    RAISE EXCEPTION 'A matching visitor registration proof is required.';
  END IF;

  DELETE FROM auth.users WHERE id = v_visitor.auth_user_id;

  INSERT INTO public.audit_logs(actor_id, action, branch_id, details)
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
REVOKE ALL ON FUNCTION public.abort_visitor_registration(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.abort_visitor_registration(text, text) TO anon, authenticated;

-- Keyed OTP verification while preserving app contract and community approval behavior.
-- Accepts keyed HMAC when DB secret is configured; supports legacy plaintext OTPs
-- for transition safety where keyed secret is not configured/available.
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

  -- Keyed OTPs are stored as 64-char HMAC-SHA256 hex. New issuance must be keyed.
  -- Legacy plaintext (6-digit) rows may be verified only as a controlled
  -- transition path when no keyed secret comparison is possible/required.
  v_expected_hmac := public.shelf_visitor_otp_hmac(v_visitor.id::text, v_input);
  IF v_visitor.otp ~ '^[0-9a-f]{64}$' THEN
    IF v_expected_hmac IS NOT NULL AND v_visitor.otp = v_expected_hmac THEN
      v_matches := true;
    ELSE
      v_matches := false; -- fail closed for keyed OTPs (missing/invalid secret or mismatch)
    END IF;
  ELSIF v_visitor.otp ~ '^[0-9]{6}$' THEN
    -- Controlled legacy transition: only pre-existing plaintext OTP rows.
    v_matches := (v_visitor.otp = v_input);
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

  IF v_visitor.registration_type = 'community' AND v_visitor.approval_status = 'pending' THEN
    v_qr := v_visitor.qr_code;
  ELSE
    v_qr := COALESCE(NULLIF(v_visitor.qr_code, ''), public.generate_visitor_qr_code());
  END IF;
  UPDATE public.visitors
  SET otp_verified = true, qr_code = v_qr, otp = NULL,
      otp_expires_at = NULL, otp_attempts = 0
  WHERE id = v_visitor.id;
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