CREATE OR REPLACE FUNCTION public.auto_cancel_expired_borrow_requests()
  RETURNS integer
  LANGUAGE plpgsql
  SECURITY DEFINER
  AS $function$
DECLARE
    v_count integer;
BEGIN
    UPDATE public.borrow_requests
    SET
        status = 'cancelled',
        cancel_reason = 'Pickup deadline expired'
    WHERE status = 'pending'
      AND pickup_deadline IS NOT NULL
      AND pickup_deadline < now();

    GET DIAGNOSTICS v_count = ROW_COUNT;

    RETURN v_count;
END;
$function$;

GRANT EXECUTE ON FUNCTION "public"."auto_cancel_expired_borrow_requests"() TO PUBLIC, "anon", "authenticated", "postgres", "service_role";
