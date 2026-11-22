BEGIN;

-- Keep the OTP HMAC key encrypted in Supabase Vault instead of relying on a
-- Postgres custom setting that is not populated by Edge Function secrets.
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
  SELECT NULLIF(secret.decrypted_secret, '')
    INTO v_secret
  FROM vault.decrypted_secrets AS secret
  WHERE secret.name = 'shelf_otp_hmac_secret';

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

REVOKE ALL ON FUNCTION public.shelf_visitor_otp_hmac(text, text)
  FROM PUBLIC, anon, authenticated;

COMMIT;
