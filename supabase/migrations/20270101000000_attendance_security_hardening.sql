-- Harden attendance reads and staff-only attendance RPCs.
-- This forward migration preserves attendance rows, triggers, QR formats,
-- function signatures, and existing result contracts.

DO $role$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles
    WHERE rolname = 'shelf_attendance_rpc_owner'
  ) THEN
    CREATE ROLE shelf_attendance_rpc_owner
      NOLOGIN NOINHERIT NOBYPASSRLS;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_roles
    WHERE rolname = 'shelf_attendance_rpc_owner'
      AND (rolcanlogin OR rolinherit OR rolbypassrls OR rolsuper)
  ) THEN
    RAISE EXCEPTION 'shelf_attendance_rpc_owner has unsafe role attributes';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_auth_members m
    JOIN pg_catalog.pg_roles target_role ON target_role.oid = m.roleid
    JOIN pg_catalog.pg_roles member_role ON member_role.oid = m.member
    WHERE target_role.rolname = 'shelf_attendance_rpc_owner'
      AND member_role.rolname <> 'postgres'
  ) THEN
    RAISE EXCEPTION 'Unexpected role membership can assume shelf_attendance_rpc_owner';
  END IF;
END;
$role$;

-- postgres is the migration executor and needs temporary membership only to
-- transfer function ownership. Application roles are never granted membership.
GRANT shelf_attendance_rpc_owner TO postgres;
GRANT USAGE, CREATE ON SCHEMA public TO shelf_attendance_rpc_owner;
GRANT USAGE ON SCHEMA auth TO shelf_attendance_rpc_owner;

-- The definer role may read only the visitor fields used by the existing kiosk
-- and identification callers, and only the current staff profile for auth.uid().
GRANT SELECT (
  id, qr_code, full_name, is_active, otp_verified,
  contact_number, email, address, profile_image_path
) ON TABLE public.visitors TO shelf_attendance_rpc_owner;
GRANT SELECT (id, role, library_id, is_active)
  ON TABLE public.staff_profiles TO shelf_attendance_rpc_owner;
GRANT SELECT (id, visitor_id, library_id, checked_out_at, time_in),
      INSERT (visitor_id, visitor_name, library_id),
      UPDATE (checked_out_at)
  ON TABLE public.attendance_logs TO shelf_attendance_rpc_owner;
GRANT EXECUTE ON FUNCTION auth.uid() TO shelf_attendance_rpc_owner;
GRANT EXECUTE ON FUNCTION auth.jwt() TO shelf_attendance_rpc_owner;

DROP POLICY IF EXISTS "attendance RPC owner reads visitors" ON public.visitors;
CREATE POLICY "attendance RPC owner reads visitors"
  ON public.visitors FOR SELECT TO shelf_attendance_rpc_owner
  USING (true);

DROP POLICY IF EXISTS "attendance RPC owner reads own staff profile" ON public.staff_profiles;
CREATE POLICY "attendance RPC owner reads own staff profile"
  ON public.staff_profiles FOR SELECT TO shelf_attendance_rpc_owner
  USING (id = auth.uid());

DROP POLICY IF EXISTS "attendance RPC owner reads attendance" ON public.attendance_logs;
CREATE POLICY "attendance RPC owner reads attendance"
  ON public.attendance_logs FOR SELECT TO shelf_attendance_rpc_owner
  USING (true);

DROP POLICY IF EXISTS "attendance RPC owner inserts attendance" ON public.attendance_logs;
CREATE POLICY "attendance RPC owner inserts attendance"
  ON public.attendance_logs FOR INSERT TO shelf_attendance_rpc_owner
  WITH CHECK (true);

DROP POLICY IF EXISTS "attendance RPC owner updates attendance" ON public.attendance_logs;
CREATE POLICY "attendance RPC owner updates attendance"
  ON public.attendance_logs FOR UPDATE TO shelf_attendance_rpc_owner
  USING (true)
  WITH CHECK (true);

-- Preserve the existing authenticated visitor-own and staff branch policies.
DROP POLICY IF EXISTS "Allow read access for attendance_logs"
  ON public.attendance_logs;
REVOKE SELECT ON TABLE public.attendance_logs FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.find_visitor_by_qr(
  p_qr text,
  p_library_id uuid
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
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_staff_library_id uuid;
  v_role text;
  v_jwt_role text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authenticated staff session required.';
  END IF;
  IF COALESCE(auth.jwt() ->> 'aal', 'aal1') <> 'aal2' THEN
    RAISE EXCEPTION 'AAL2 authentication is required.';
  END IF;
  IF p_library_id IS NULL OR NULLIF(pg_catalog.btrim(p_qr), '') IS NULL THEN
    RAISE EXCEPTION 'A visitor QR pass and library branch are required.';
  END IF;

  SELECT pg_catalog.lower(pg_catalog.btrim(staff.role)), staff.library_id
    INTO v_role, v_staff_library_id
  FROM public.staff_profiles AS staff
  WHERE staff.id = auth.uid()
    AND staff.is_active IS TRUE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Active staff profile required.';
  END IF;
  IF v_role NOT IN ('subadmin', 'superadmin') THEN
    RAISE EXCEPTION 'Unsupported staff role.';
  END IF;

  v_jwt_role := auth.jwt() -> 'app_metadata' ->> 'role';
  IF v_jwt_role IS NOT NULL
     AND pg_catalog.lower(pg_catalog.btrim(v_jwt_role)) <> v_role THEN
    RAISE EXCEPTION 'Staff role does not match the authenticated role claim.';
  END IF;
  IF v_role = 'subadmin'
     AND v_staff_library_id IS DISTINCT FROM p_library_id THEN
    RAISE EXCEPTION 'You are not authorized to scan for this library.';
  END IF;

  RETURN QUERY
  SELECT visitor.id::text,
         visitor.full_name,
         visitor.contact_number,
         visitor.email,
         visitor.address,
         visitor.qr_code,
         visitor.profile_image_path
  FROM public.visitors AS visitor
  WHERE pg_catalog.upper(pg_catalog.btrim(visitor.qr_code)) =
        pg_catalog.upper(pg_catalog.btrim(p_qr))
    AND visitor.is_active IS TRUE
    AND visitor.otp_verified IS TRUE
  LIMIT 1;
END;
$function$;

CREATE OR REPLACE FUNCTION public.toggle_attendance(
  p_qr text,
  p_library_id text
)
RETURNS TABLE (log_id text, visitor_id text, visitor_name text, action text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_library_id uuid;
  v_staff_library_id uuid;
  v_role text;
  v_jwt_role text;
  v_visitor_id text;
  v_visitor_name text;
  v_log_id uuid;
  v_action text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authenticated staff session required.';
  END IF;
  IF COALESCE(auth.jwt() ->> 'aal', 'aal1') <> 'aal2' THEN
    RAISE EXCEPTION 'AAL2 authentication is required.';
  END IF;
  IF NULLIF(pg_catalog.btrim(p_qr), '') IS NULL
     OR NULLIF(pg_catalog.btrim(p_library_id), '') IS NULL THEN
    RAISE EXCEPTION 'A visitor QR pass and library branch are required.';
  END IF;

  BEGIN
    v_library_id := pg_catalog.btrim(p_library_id)::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'Invalid library branch.';
  END;

  SELECT pg_catalog.lower(pg_catalog.btrim(staff.role)), staff.library_id
    INTO v_role, v_staff_library_id
  FROM public.staff_profiles AS staff
  WHERE staff.id = auth.uid()
    AND staff.is_active IS TRUE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Active staff profile required.';
  END IF;
  IF v_role NOT IN ('subadmin', 'superadmin') THEN
    RAISE EXCEPTION 'Unsupported staff role.';
  END IF;

  v_jwt_role := auth.jwt() -> 'app_metadata' ->> 'role';
  IF v_jwt_role IS NOT NULL
     AND pg_catalog.lower(pg_catalog.btrim(v_jwt_role)) <> v_role THEN
    RAISE EXCEPTION 'Staff role does not match the authenticated role claim.';
  END IF;
  IF v_role = 'subadmin'
     AND v_staff_library_id IS DISTINCT FROM v_library_id THEN
    RAISE EXCEPTION 'You are not authorized to record attendance for this branch.';
  END IF;

  SELECT visitor.id::text, visitor.full_name
    INTO v_visitor_id, v_visitor_name
  FROM public.visitors AS visitor
  WHERE pg_catalog.upper(pg_catalog.btrim(visitor.qr_code)) =
        pg_catalog.upper(pg_catalog.btrim(p_qr))
    AND visitor.otp_verified IS TRUE
    AND visitor.is_active IS TRUE
  LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'QR code is invalid, unverified, or inactive.';
  END IF;

  SELECT attendance.id
    INTO v_log_id
  FROM public.attendance_logs AS attendance
  WHERE attendance.visitor_id = v_visitor_id
    AND attendance.library_id = v_library_id
    AND attendance.checked_out_at IS NULL
  ORDER BY attendance.time_in DESC
  LIMIT 1
  FOR UPDATE;

  IF FOUND THEN
    UPDATE public.attendance_logs AS attendance
       SET checked_out_at = pg_catalog.now()
     WHERE attendance.id = v_log_id
     RETURNING attendance.id INTO v_log_id;
    v_action := 'checked_out';
  ELSE
    INSERT INTO public.attendance_logs (visitor_id, visitor_name, library_id)
    VALUES (v_visitor_id, v_visitor_name, v_library_id)
    RETURNING id INTO v_log_id;
    v_action := 'checked_in';
  END IF;

  RETURN QUERY
  SELECT v_log_id::text, v_visitor_id, v_visitor_name::text, v_action;
END;
$function$;

ALTER FUNCTION public.find_visitor_by_qr(text, uuid)
  OWNER TO shelf_attendance_rpc_owner;
ALTER FUNCTION public.toggle_attendance(text, text)
  OWNER TO shelf_attendance_rpc_owner;

REVOKE ALL ON FUNCTION public.find_visitor_by_qr(text, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.find_visitor_by_qr(text, uuid)
  TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.toggle_attendance(text, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.toggle_attendance(text, text)
  TO authenticated, service_role;

REVOKE CREATE ON SCHEMA public FROM shelf_attendance_rpc_owner;
REVOKE shelf_attendance_rpc_owner FROM postgres;

NOTIFY pgrst, 'reload schema';