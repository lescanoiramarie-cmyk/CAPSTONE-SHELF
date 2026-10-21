CREATE OR REPLACE FUNCTION public.reject_community_book_request (
  p_request_id       uuid,
  p_owner_visitor_id text,
  p_response         text DEFAULT NULL::text
)
  RETURNS TABLE (
    id                   uuid,
    book_id              text,
    book_title           text,
    requester_visitor_id text,
    requester_name       text,
    status               text,
    rejected_at          timestamp with time zone,
    owner_response       text
  )
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
DECLARE
    v_owner_id text;
    v_status text;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Authentication is required.';
    END IF;

    SELECT v.id::text
    INTO v_owner_id
    FROM public.visitors AS v
    WHERE v.auth_user_id = auth.uid()
      AND v.id::text = trim(p_owner_visitor_id)
      AND v.otp_verified = true
      AND v.is_active = true
    LIMIT 1;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Owner identity could not be verified.';
    END IF;

    SELECT cbr.status
    INTO v_status
    FROM public.community_book_requests AS cbr
    WHERE cbr.id = p_request_id
      AND cbr.owner_visitor_id = v_owner_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Request not found or you are not its owner.';
    END IF;

    IF v_status <> 'pending' THEN
        RAISE EXCEPTION 'This request is no longer pending.';
    END IF;

    UPDATE public.community_book_requests AS cbr
    SET
        status = 'rejected',
        rejected_at = pg_catalog.now(),
        approved_at = NULL,
        owner_response = NULLIF(pg_catalog.btrim(p_response), ''),
        updated_at = pg_catalog.now()
    WHERE cbr.id = p_request_id
      AND cbr.owner_visitor_id = v_owner_id;

    RETURN QUERY
    SELECT
        cbr.id,
        cbr.book_id,
        cbr.book_title,
        cbr.requester_visitor_id,
        cbr.requester_name,
        cbr.status::text,
        cbr.rejected_at,
        cbr.owner_response
    FROM public.community_book_requests AS cbr
    WHERE cbr.id = p_request_id
      AND cbr.owner_visitor_id = v_owner_id;
END;
$function$;

GRANT EXECUTE ON FUNCTION "public"."reject_community_book_request"(uuid, text, text) TO "authenticated", "postgres", "service_role";

REVOKE ALL ON FUNCTION "public"."reject_community_book_request"(uuid, text, text) FROM PUBLIC;
