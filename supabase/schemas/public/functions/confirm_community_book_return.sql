CREATE OR REPLACE FUNCTION public.confirm_community_book_return (
  p_request_id       uuid,
  p_owner_visitor_id text
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
DECLARE
  v_req public.community_book_requests%rowtype;
  v_fine numeric := 0;
BEGIN
  -- Get and lock the request
  SELECT cbr.*
  INTO v_req
  FROM public.community_book_requests AS cbr
  WHERE cbr.id = p_request_id
  FOR UPDATE;

  -- Request must exist
  IF v_req.id IS NULL THEN
    RAISE EXCEPTION 'Request not found.';
  END IF;

  -- Only borrowed books can be returned
  IF v_req.status <> 'borrowed' THEN
    RAISE EXCEPTION
      'This community book is not currently borrowed.';
  END IF;

  -- Only the owner can confirm the return
  IF v_req.owner_visitor_id <> trim(p_owner_visitor_id) THEN
    RAISE EXCEPTION
      'Only the owner of this community book can confirm the return.';
  END IF;

  -- Calculate fine using the SHELF rule of ₱10/day.
  -- No fine if returned on or before the due date.
  IF v_req.due_date IS NOT NULL
     AND now() > v_req.due_date THEN

    v_fine :=
      CEIL(
        EXTRACT(EPOCH FROM (now() - v_req.due_date))
        / 86400
      ) * 10;

  END IF;

  -- Mark the community book as returned
  UPDATE public.community_book_requests AS cbr
  SET
    status = 'returned',
    return_date = now(),
    fine_amount = v_fine,
    return_confirmed_by = trim(p_owner_visitor_id),
    updated_at = now()
  WHERE cbr.id = p_request_id;
END;
$function$;

GRANT EXECUTE ON FUNCTION "public"."confirm_community_book_return"(uuid, text) TO PUBLIC, "anon", "authenticated", "postgres", "service_role";
