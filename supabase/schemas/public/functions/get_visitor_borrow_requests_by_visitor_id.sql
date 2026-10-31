CREATE OR REPLACE FUNCTION public.get_visitor_borrow_requests_by_visitor_id (
  p_visitor_id text
)
  RETURNS TABLE (
    id                  text,
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
  SET search_path TO 'public'
  AS $function$
begin
  if auth.uid() is null or not exists (
    select 1
    from public.visitors as visitor
    where visitor.id = trim(p_visitor_id)
      and visitor.auth_user_id = auth.uid()
  ) then
    raise exception 'The authenticated visitor account could not be verified.';
  end if;

  return query
    select
      request.id::text,
      request.book_id::text,
      request.book_title::text,
      request.visitor_id::text,
      request.visitor_name::text,
      request.status::text,
      request.request_date,
      request.pickup_deadline,
      request.queue_position,
      request.borrow_date,
      request.due_date,
      request.return_date,
      request.fine_amount::numeric,
      request.confirmed_by::text,
      request.return_confirmed_by::text
    from public.borrow_requests as request
    where request.visitor_id = trim(p_visitor_id)
    order by request.request_date desc;
end;
$function$;

GRANT EXECUTE ON FUNCTION "public"."get_visitor_borrow_requests_by_visitor_id"(text) TO "authenticated", "postgres", "service_role";

REVOKE ALL ON FUNCTION "public"."get_visitor_borrow_requests_by_visitor_id"(text) FROM PUBLIC;
