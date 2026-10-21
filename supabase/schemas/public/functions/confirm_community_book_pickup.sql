CREATE OR REPLACE FUNCTION public.confirm_community_book_pickup (
  p_request_id       uuid,
  p_owner_visitor_id text
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
DECLARE
    v_req public.community_book_requests%ROWTYPE;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Authentication is required.';
    END IF;

    -- Verify the authenticated, active, OTP-verified owner.
    IF NOT EXISTS (
        SELECT 1
        FROM public.visitors AS v
        WHERE v.id::text = trim(p_owner_visitor_id)
          AND v.auth_user_id = auth.uid()
          AND v.otp_verified = true
          AND v.is_active = true
    ) THEN
        RAISE EXCEPTION
            'The authenticated, verified owner account could not be found.';
    END IF;

    -- Lock the request to prevent concurrent pickup confirmations.
    SELECT cbr.*
    INTO v_req
    FROM public.community_book_requests AS cbr
    WHERE cbr.id = p_request_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Request not found.';
    END IF;

    IF v_req.owner_visitor_id <> trim(p_owner_visitor_id) THEN
        RAISE EXCEPTION
            'Only the owner of this community book can confirm pickup.';
    END IF;

    IF v_req.status <> 'approved' THEN
        RAISE EXCEPTION
            'This request is not approved for pickup.';
    END IF;

    -- Start the seven-day loan.
    UPDATE public.community_book_requests AS cbr
    SET
        status = 'borrowed',
        borrow_date = now(),
        due_date = now() + interval '7 days',
        confirmed_by = trim(p_owner_visitor_id),
        updated_at = now()
    WHERE cbr.id = p_request_id;

    -- This function intentionally returns void.
    RETURN;
END;
$function$;

GRANT EXECUTE ON FUNCTION "public"."confirm_community_book_pickup"(uuid, text) TO PUBLIC, "anon", "authenticated", "postgres", "service_role";
