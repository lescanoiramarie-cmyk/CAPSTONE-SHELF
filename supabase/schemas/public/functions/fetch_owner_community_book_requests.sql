CREATE OR REPLACE FUNCTION public.fetch_owner_community_book_requests (
  p_owner_visitor_id text
)
  RETURNS TABLE (
    id                   uuid,
    book_id              text,
    book_title           text,
    owner_visitor_id     text,
    owner_name           text,
    requester_visitor_id text,
    requester_name       text,
    status               text,
    request_date         timestamp with time zone,
    approved_at          timestamp with time zone,
    rejected_at          timestamp with time zone,
    owner_response       text
  )
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
DECLARE
    v_visitor_id text;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Authentication is required.';
    END IF;

    SELECT v.id::text
    INTO v_visitor_id
    FROM public.visitors AS v
    WHERE v.auth_user_id = auth.uid()
      AND v.id::text = trim(p_owner_visitor_id)
      AND v.otp_verified = true
      AND v.is_active = true
    LIMIT 1;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Visitor identity could not be verified.';
    END IF;

    RETURN QUERY
    SELECT
        cbr.id,
        cbr.book_id,
        cbr.book_title,
        cbr.owner_visitor_id,
        cbr.owner_name,
        cbr.requester_visitor_id,
        cbr.requester_name,
        cbr.status::text,
        cbr.request_date,
        cbr.approved_at,
        cbr.rejected_at,
        cbr.owner_response
    FROM public.community_book_requests AS cbr
    WHERE cbr.owner_visitor_id = v_visitor_id
    ORDER BY
        CASE
            WHEN cbr.status = 'pending' THEN 0
            WHEN cbr.status = 'approved' THEN 1
            ELSE 2
        END,
        cbr.request_date DESC;
END;
$function$;

GRANT EXECUTE ON FUNCTION "public"."fetch_owner_community_book_requests"(text) TO "authenticated", "postgres", "service_role";

REVOKE ALL ON FUNCTION "public"."fetch_owner_community_book_requests"(text) FROM PUBLIC;
