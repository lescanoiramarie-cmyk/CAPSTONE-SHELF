CREATE OR REPLACE FUNCTION public.cancel_borrow_request (
  p_request_id text,
  p_reason     text DEFAULT 'cancelled'::text
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
  AS $function$
declare
  request_row public.borrow_requests%rowtype;
begin
  select request.*
  into request_row
  from public.borrow_requests request
  join public.books book
    on book.id::text = request.book_id::text
  where request.id::text = trim(p_request_id)
    and (
      exists (
        select 1
        from public.visitors visitor
        where visitor.id::text = request.visitor_id::text
          and visitor.auth_user_id = auth.uid()
      )
      or public.is_active_staff_for_branch(book.library_id::text)
    )
  for update of request;

  if request_row.id is null then
    raise exception 'Request not found or access denied.';
  end if;

  if request_row.status not in ('queued', 'ready_for_pickup') then
    raise exception 'This request can no longer be cancelled.';
  end if;

  if p_reason <> 'cancelled' then
    raise exception 'Unsupported cancellation reason.';
  end if;

  update public.borrow_requests
  set status = 'cancelled'
  where id = request_row.id;

  if request_row.status = 'ready_for_pickup' then
    perform public.release_copy_and_promote(request_row.book_id);
  else
    update public.borrow_requests request
    set queue_position = queued.position
    from (
      select id, row_number() over (order by queue_position asc) as position
      from public.borrow_requests
      where book_id = request_row.book_id
        and status = 'queued'
    ) queued
    where request.id = queued.id;
  end if;
end;
$function$;

GRANT EXECUTE ON FUNCTION "public"."cancel_borrow_request"(text, text) TO "authenticated", "postgres", "service_role";

REVOKE ALL ON FUNCTION "public"."cancel_borrow_request"(text, text) FROM PUBLIC;
