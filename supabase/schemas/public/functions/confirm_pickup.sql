CREATE OR REPLACE FUNCTION public.confirm_pickup (
  p_request_id uuid,
  p_staff_name text
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
DECLARE
    v_req public.borrow_requests%ROWTYPE;
    v_staff_role text;
    v_staff_library_id uuid;
    v_staff_name text;
    v_book_library_id uuid;
    v_jwt_role text;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Authenticated staff account required.';
    END IF;

    SELECT
        lower(sp.role),
        sp.library_id,
        COALESCE(NULLIF(btrim(sp.full_name), ''), sp.email)
    INTO
        v_staff_role,
        v_staff_library_id,
        v_staff_name
    FROM public.staff_profiles AS sp
    WHERE sp.id = auth.uid()
      AND sp.is_active IS TRUE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Active staff profile required.';
    END IF;

    v_jwt_role := auth.jwt() -> 'app_metadata' ->> 'role';

    IF v_staff_role NOT IN ('superadmin', 'subadmin')
       OR COALESCE(v_jwt_role, v_staff_role) <> v_staff_role
    THEN
        RAISE EXCEPTION 'Unauthorized staff role.';
    END IF;

    SELECT br.*
    INTO v_req
    FROM public.borrow_requests AS br
    WHERE br.id = p_request_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Request not found.';
    END IF;

    SELECT b.library_id
    INTO v_book_library_id
    FROM public.books AS b
    WHERE b.id = v_req.book_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Book not found.';
    END IF;

    IF v_staff_role <> 'superadmin'
       AND v_staff_library_id IS DISTINCT FROM v_book_library_id
    THEN
        RAISE EXCEPTION 'You are not authorized to process this branch.';
    END IF;

    IF v_req.status <> 'ready_for_pickup' THEN
        RAISE EXCEPTION 'This request is not ready for pickup.';
    END IF;

    UPDATE public.borrow_requests
    SET
        status = 'borrowed',
        borrow_date = now(),
        due_date = now() + interval '7 days',
        confirmed_by = v_staff_name
    WHERE id = p_request_id;
END;
$function$;

GRANT EXECUTE ON FUNCTION "public"."confirm_pickup"(uuid, text) TO "authenticated", "postgres", "service_role";

REVOKE ALL ON FUNCTION "public"."confirm_pickup"(uuid, text) FROM PUBLIC;
