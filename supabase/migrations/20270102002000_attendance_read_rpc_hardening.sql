-- Harden attendance log reads behind server-side, scope-enforcing RPCs.
-- Preserves existing attendance rows, policies, and write/scan RPC contracts.
-- Adds least-privilege read paths for authenticated staff/visitors.

BEGIN;

DO $$
BEGIN
  IF pg_catalog.to_regclass('public.attendance_logs') IS NULL THEN
    RAISE EXCEPTION 'public.attendance_logs is required for attendance read RPCs.';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_attendance_logs_v1()
RETURNS TABLE (
  id text,
  visitor_id text,
  visitor_name text,
  library_id text,
  time_in timestamptz,
  checked_out_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_uid uuid;
  v_aal text;
  v_role text;
  v_staff_id uuid;
  v_staff_role text;
  v_staff_library text;
  v_visitor_id text;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authenticated session required.' USING ERRCODE = '42501';
  END IF;

  v_aal := COALESCE(NULLIF(auth.jwt() ->> 'aal', ''), 'aal1');
  v_role := NULLIF(pg_catalog.lower(pg_catalog.btrim(auth.jwt() -> 'app_metadata' ->> 'role')), '');

  IF v_role IN ('subadmin', 'superadmin') THEN
    SELECT staff.id,
           NULLIF(pg_catalog.lower(pg_catalog.btrim(staff.role)), ''),
           staff.library_id::text
      INTO v_staff_id, v_staff_role, v_staff_library
    FROM public.staff_profiles AS staff
    WHERE staff.id = v_uid
      AND staff.is_active IS TRUE
      AND staff.role = v_role
    LIMIT 1;
  END IF;

  IF v_staff_id IS NOT NULL THEN
    IF v_aal <> 'aal2' THEN
      RAISE EXCEPTION 'AAL2 authentication is required for staff attendance access.' USING ERRCODE = '42501';
    END IF;

    IF v_staff_role = 'superadmin' THEN
      RETURN QUERY
      SELECT log.id::text, log.visitor_id::text, log.visitor_name::text,
             log.library_id::text, log.time_in, log.checked_out_at
      FROM public.attendance_logs AS log
      ORDER BY log.time_in DESC, log.id ASC;
      RETURN;
    END IF;

    IF v_staff_role = 'subadmin' THEN
      IF v_staff_library IS NULL OR pg_catalog.btrim(v_staff_library) = '' THEN
        RAISE EXCEPTION 'Staff library scope is required.' USING ERRCODE = '42501';
      END IF;

      RETURN QUERY
      SELECT log.id::text, log.visitor_id::text, log.visitor_name::text,
             log.library_id::text, log.time_in, log.checked_out_at
      FROM public.attendance_logs AS log
      WHERE log.library_id::text = v_staff_library
      ORDER BY log.time_in DESC, log.id ASC;
      RETURN;
    END IF;

    RAISE EXCEPTION 'Authorized staff role required.' USING ERRCODE = '42501';
  END IF;

  SELECT visitor.id::text
    INTO v_visitor_id
  FROM public.visitors AS visitor
  WHERE visitor.auth_user_id = v_uid
    AND visitor.otp_verified IS TRUE
    AND visitor.is_active IS TRUE
  LIMIT 1;

  IF v_visitor_id IS NULL THEN
    RAISE EXCEPTION 'Authorized visitor or staff session required.' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT log.id::text, log.visitor_id::text, log.visitor_name::text,
         log.library_id::text, log.time_in, log.checked_out_at
  FROM public.attendance_logs AS log
  WHERE log.visitor_id::text = v_visitor_id
  ORDER BY log.time_in DESC, log.id ASC;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_visitor_attendance_logs_v1(
  p_limit integer DEFAULT 30,
  p_cursor_time_in timestamptz DEFAULT NULL,
  p_cursor_id text DEFAULT NULL,
  p_from_time timestamptz DEFAULT NULL,
  p_before_time timestamptz DEFAULT NULL,
  p_library_id text DEFAULT NULL
)
RETURNS TABLE (
  id text,
  visitor_id text,
  visitor_name text,
  library_id text,
  time_in timestamptz,
  checked_out_at timestamptz,
  total_count bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_uid uuid;
  v_visitor_id text;
  v_limit integer;
  v_library_id text;
  v_total bigint;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authenticated visitor session required.' USING ERRCODE = '42501';
  END IF;

  SELECT visitor.id::text
    INTO v_visitor_id
  FROM public.visitors AS visitor
  WHERE visitor.auth_user_id = v_uid
    AND visitor.otp_verified IS TRUE
    AND visitor.is_active IS TRUE
  LIMIT 1;

  IF v_visitor_id IS NULL THEN
    RAISE EXCEPTION 'Authorized visitor session required.' USING ERRCODE = '42501';
  END IF;

  v_limit := LEAST(100, GREATEST(1, COALESCE(p_limit, 30)));
  v_library_id := NULLIF(pg_catalog.btrim(COALESCE(p_library_id, '')), '');

  IF p_cursor_time_in IS NULL AND p_cursor_id IS NULL THEN
    SELECT COUNT(*)
      INTO v_total
    FROM public.attendance_logs AS log
    WHERE log.visitor_id::text = v_visitor_id
      AND (v_library_id IS NULL OR log.library_id::text = v_library_id)
      AND (p_from_time IS NULL OR log.time_in >= p_from_time)
      AND (p_before_time IS NULL OR log.time_in < p_before_time);
  END IF;

  RETURN QUERY
  SELECT log.id::text, log.visitor_id::text, log.visitor_name::text,
         log.library_id::text, log.time_in, log.checked_out_at,
         v_total
  FROM public.attendance_logs AS log
  WHERE log.visitor_id::text = v_visitor_id
    AND (v_library_id IS NULL OR log.library_id::text = v_library_id)
    AND (p_from_time IS NULL OR log.time_in >= p_from_time)
    AND (p_before_time IS NULL OR log.time_in < p_before_time)
    AND (
      p_cursor_time_in IS NULL OR p_cursor_id IS NULL OR
      log.time_in < p_cursor_time_in OR
      (log.time_in = p_cursor_time_in AND log.id::text > p_cursor_id)
    )
  ORDER BY log.time_in DESC, log.id ASC
  LIMIT v_limit + 1;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_attendance_logs_v1() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_attendance_logs_v1() TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_visitor_attendance_logs_v1(integer, timestamptz, text, timestamptz, timestamptz, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_visitor_attendance_logs_v1(integer, timestamptz, text, timestamptz, timestamptz, text) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;