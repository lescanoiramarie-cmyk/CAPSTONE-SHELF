CREATE OR REPLACE FUNCTION public.get_visitor_borrow_requests (
  p_visitor_id uuid
)
  RETURNS TABLE (
    id                  uuid,
    book_id             text,
    book_title          text,
    visitor_id          text,
    visitor_name        text,
    status              text,
    request_date        timestamp with time zone,
    pickup_deadline     timestamp with time zone,
    queue_position      integer,
    borrow_date         timestamp with time zone,
    due_date            timestamp with time zone,
    return_date         timestamp with time zone,
    fine_amount         numeric,
    confirmed_by        text,
    return_confirmed_by text
  )
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
  AS $function$
begin
  if auth.uid() is null or auth.uid() is distinct from p_visitor_id then
    raise exception 'The authenticated visitor account could not be verified.';
  end if;

  return query
  select *
  from shelf_private.get_visitor_borrow_requests_unchecked(p_visitor_id);
end;
$function$;

GRANT EXECUTE ON FUNCTION "public"."get_visitor_borrow_requests"(uuid) TO "authenticated", "postgres", "service_role";

REVOKE ALL ON FUNCTION "public"."get_visitor_borrow_requests"(uuid) FROM PUBLIC;
