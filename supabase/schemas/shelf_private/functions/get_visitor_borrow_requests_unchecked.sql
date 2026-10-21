CREATE OR REPLACE FUNCTION shelf_private.get_visitor_borrow_requests_unchecked (
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
  return query
    select br.id, br.book_id::text, br.book_title::text, br.visitor_id::text, br.visitor_name::text, br.status::text, br.request_date, br.pickup_deadline, br.queue_position, br.borrow_date, br.due_date, br.return_date, br.fine_amount::numeric, br.confirmed_by::text, br.return_confirmed_by::text
    from borrow_requests br
    join visitors v on v.id = br.visitor_id
    where v.auth_user_id = p_visitor_id
    order by br.request_date desc;
end; $function$;

GRANT EXECUTE ON FUNCTION "shelf_private"."get_visitor_borrow_requests_unchecked"(uuid) TO "postgres";

REVOKE ALL ON FUNCTION "shelf_private"."get_visitor_borrow_requests_unchecked"(uuid) FROM PUBLIC;
