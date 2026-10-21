CREATE OR REPLACE FUNCTION public.find_visitor_by_qr (
  p_qr         text,
  p_library_id uuid
)
  RETURNS TABLE (
    id             text,
    full_name      character varying,
    contact_number character varying,
    email          character varying,
    address        text,
    qr_code        character varying
  )
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
DECLARE
    v_staff_library_id uuid;
    v_role text;
BEGIN
    SELECT sp.library_id, lower(sp.role)
      INTO v_staff_library_id, v_role
    FROM public.staff_profiles AS sp
    WHERE sp.id = auth.uid()
      AND sp.is_active IS TRUE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Active staff profile required.';
    END IF;

    IF v_role <> 'superadmin'
       AND v_staff_library_id IS DISTINCT FROM p_library_id THEN
        RAISE EXCEPTION 'You are not authorized to scan for this library.';
    END IF;

    RETURN QUERY
    SELECT
        v.id::text,
        v.full_name,
        v.contact_number,
        v.email,
        v.address,
        v.qr_code
    FROM public.visitors AS v
    WHERE upper(trim(v.qr_code)) = upper(trim(p_qr))
      AND v.is_active IS TRUE
      AND v.otp_verified IS TRUE
    LIMIT 1;
END;
$function$;

GRANT EXECUTE ON FUNCTION "public"."find_visitor_by_qr"(text, uuid) TO "authenticated", "postgres", "service_role";

REVOKE ALL ON FUNCTION "public"."find_visitor_by_qr"(text, uuid) FROM PUBLIC;
