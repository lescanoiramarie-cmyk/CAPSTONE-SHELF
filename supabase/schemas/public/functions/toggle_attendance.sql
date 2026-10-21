CREATE OR REPLACE FUNCTION public.toggle_attendance (
  p_qr         text,
  p_library_id uuid
)
  RETURNS TABLE (
    log_id       uuid,
    visitor_id   text,
    visitor_name character varying,
    action       text
  )
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
DECLARE
    v_staff_library_id uuid;
    v_role text;
    v_visitor_id text;
    v_visitor_name varchar;
    v_log_id uuid;
    v_action text;
    v_open_log_id uuid;
BEGIN
    -- Require an active authenticated staff account.
    SELECT sp.library_id, lower(sp.role)
    INTO v_staff_library_id, v_role
    FROM public.staff_profiles AS sp
    WHERE sp.id = auth.uid()
      AND sp.is_active IS TRUE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Active staff profile required.';
    END IF;

    IF p_library_id IS NULL THEN
        RAISE EXCEPTION 'Library branch is required.';
    END IF;

    -- Enforce branch authorization.
    IF v_role <> 'superadmin'
       AND v_staff_library_id IS DISTINCT FROM p_library_id THEN
        RAISE EXCEPTION 'You are not authorized to record attendance for this branch.';
    END IF;

    -- Find a verified, active visitor using their QR pass.
    SELECT v.id::text, v.full_name
    INTO v_visitor_id, v_visitor_name
    FROM public.visitors AS v
    WHERE upper(trim(v.qr_code)) = upper(trim(p_qr))
      AND v.is_active IS TRUE
      AND v.otp_verified IS TRUE
    LIMIT 1;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'QR code not recognized. Please check the visitor pass and try again.';
    END IF;

    -- Find the most recent open attendance record for this branch.
    SELECT a.id
    INTO v_open_log_id
    FROM public.attendance_logs AS a
    WHERE a.visitor_id = v_visitor_id
      AND a.library_id = p_library_id
      AND a.checked_out_at IS NULL
    ORDER BY a.time_in DESC
    LIMIT 1
    FOR UPDATE;

    IF FOUND THEN
        -- Existing open record: check out.
        UPDATE public.attendance_logs AS a
        SET checked_out_at = now()
        WHERE a.id = v_open_log_id
        RETURNING a.id INTO v_log_id;

        v_action := 'checked_out';
    ELSE
        -- No open record: check in.
        INSERT INTO public.attendance_logs (
            visitor_id,
            visitor_name,
            library_id,
            time_in,
            checked_out_at
        )
        VALUES (
            v_visitor_id,
            v_visitor_name,
            p_library_id,
            now(),
            NULL
        )
        RETURNING id INTO v_log_id;

        v_action := 'checked_in';
    END IF;

    RETURN QUERY
    SELECT
        v_log_id,
        v_visitor_id,
        v_visitor_name,
        v_action;
END;
$function$;

GRANT EXECUTE ON FUNCTION "public"."toggle_attendance"(text, uuid) TO "authenticated", "postgres", "service_role";

REVOKE ALL ON FUNCTION "public"."toggle_attendance"(text, uuid) FROM PUBLIC;
