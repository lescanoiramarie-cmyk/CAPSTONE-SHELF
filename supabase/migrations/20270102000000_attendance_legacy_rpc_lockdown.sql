-- Preserve the legacy attendance RPC contracts while routing them through the
-- AAL2 and branch-scoped implementation introduced in the prior migration.
-- This does not change visitor QR formats or attendance records.

BEGIN;

DO $role_check$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles
    WHERE rolname = 'shelf_attendance_rpc_owner'
      AND rolcanlogin IS FALSE
      AND rolinherit IS FALSE
      AND rolbypassrls IS FALSE
  ) THEN
    RAISE EXCEPTION 'The dedicated attendance RPC owner is missing or unsafe';
  END IF;

  IF pg_catalog.pg_has_role('anon', 'shelf_attendance_rpc_owner', 'MEMBER')
     OR pg_catalog.pg_has_role('authenticated', 'shelf_attendance_rpc_owner', 'MEMBER')
     OR pg_catalog.pg_has_role('authenticator', 'shelf_attendance_rpc_owner', 'MEMBER')
     OR pg_catalog.pg_has_role('service_role', 'shelf_attendance_rpc_owner', 'MEMBER') THEN
    RAISE EXCEPTION 'An application-facing role can assume the attendance RPC owner';
  END IF;
END;
$role_check$;

GRANT USAGE, CREATE ON SCHEMA public TO shelf_attendance_rpc_owner;
-- Match the ownership-transfer prerequisite in the original hardening
-- migration. On Supabase-managed clusters this may coexist with a managed
-- postgres membership; never revoke or rewrite that membership here.
GRANT shelf_attendance_rpc_owner TO postgres;

-- PostgreSQL cannot change a RETURNS TABLE row shape with CREATE OR REPLACE.
-- Keep the legacy overload for existing clients and expose a uniquely named
-- endpoint for PostgREST callers, avoiding text/UUID overload resolution.
DROP FUNCTION IF EXISTS public.find_visitor_by_qr(text, text);

CREATE FUNCTION public.lookup_attendance_visitor_v2(
  p_qr text,
  p_library_id text
)
RETURNS TABLE (
  id text,
  full_name character varying,
  contact_number character varying,
  email character varying,
  address text,
  qr_code character varying,
  profile_image_path text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_library_id uuid;
BEGIN
  IF NULLIF(pg_catalog.btrim(p_library_id), '') IS NULL THEN
    RAISE EXCEPTION 'A library branch is required.';
  END IF;

  BEGIN
    v_library_id := pg_catalog.btrim(p_library_id)::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'Invalid library branch.';
  END;

  RETURN QUERY
  SELECT visitor.id,
         visitor.full_name,
         visitor.contact_number,
         visitor.email::character varying,
         visitor.address::text,
         visitor.qr_code::character varying,
         visitor.profile_image_path
  FROM public.find_visitor_by_qr(p_qr, v_library_id) AS visitor;
END;
$function$;

ALTER FUNCTION public.lookup_attendance_visitor_v2(text, text)
  OWNER TO shelf_attendance_rpc_owner;

CREATE FUNCTION public.find_visitor_by_qr(
  p_qr text,
  p_library_id text
)
RETURNS TABLE (
  id text,
  full_name character varying,
  contact_number character varying,
  email character varying,
  address text,
  qr_code character varying,
  profile_image_path text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  RETURN QUERY
  SELECT visitor.id,
         visitor.full_name,
         visitor.contact_number,
         visitor.email,
         visitor.address,
         visitor.qr_code,
         visitor.profile_image_path
  FROM public.lookup_attendance_visitor_v2(p_qr, p_library_id) AS visitor;
END;
$function$;

ALTER FUNCTION public.find_visitor_by_qr(text, text)
  OWNER TO shelf_attendance_rpc_owner;

CREATE OR REPLACE FUNCTION public.scan_attendance(
  p_qr text,
  p_library_id text
)
RETURNS TABLE (
  log_id text,
  visitor_id text,
  visitor_name text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_library_id uuid;
  v_visitor_id text;
  v_visitor_name text;
  v_log_id text;
BEGIN
  IF NULLIF(pg_catalog.btrim(p_library_id), '') IS NULL THEN
    RAISE EXCEPTION 'A library branch is required.';
  END IF;

  BEGIN
    v_library_id := pg_catalog.btrim(p_library_id)::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'Invalid library branch.';
  END;

  -- Preserve the legacy insert-per-call contract. The hardened lookup enforces
  -- AAL2, active staff, role-claim consistency, and branch authorization.
  SELECT visitor.id, visitor.full_name
    INTO v_visitor_id, v_visitor_name
  FROM public.find_visitor_by_qr(p_qr, v_library_id) AS visitor;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'QR code is invalid, unverified, or inactive.';
  END IF;

  INSERT INTO public.attendance_logs (visitor_id, visitor_name, library_id)
  VALUES (v_visitor_id, v_visitor_name, v_library_id)
  RETURNING id::text INTO v_log_id;

  RETURN QUERY
  SELECT v_log_id, v_visitor_id, v_visitor_name;
END;
$function$;

ALTER FUNCTION public.scan_attendance(text, text)
  OWNER TO shelf_attendance_rpc_owner;

REVOKE CREATE ON SCHEMA public FROM shelf_attendance_rpc_owner;

REVOKE ALL ON FUNCTION public.find_visitor_by_qr(text, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.find_visitor_by_qr(text, text)
  TO authenticated;

REVOKE ALL ON FUNCTION public.lookup_attendance_visitor_v2(text, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.lookup_attendance_visitor_v2(text, text)
  TO authenticated;

REVOKE ALL ON FUNCTION public.scan_attendance(text, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.scan_attendance(text, text)
  TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;