CREATE OR REPLACE FUNCTION public.cancel_borrow_request (
  p_request_id uuid,
  p_reason     text DEFAULT 'cancelled'::text
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  AS $function$
declare v_req borrow_requests%rowtype;
begin
  select br.* into v_req from borrow_requests br where br.id = p_request_id;
  if v_req.id is null then raise exception 'Request not found.'; end if;
  if v_req.status not in ('queued', 'ready_for_pickup') then raise exception 'This request can no longer be cancelled.'; end if;
  update borrow_requests set status = p_reason where id = p_request_id;
  if v_req.status = 'ready_for_pickup' then perform release_copy_and_promote(v_req.book_id);
  elsif v_req.status = 'queued' then
    update borrow_requests br set queue_position = sub.rn
    from (select id, row_number() over (order by queue_position asc) as rn from borrow_requests where book_id = v_req.book_id and status = 'queued') sub
    where br.id = sub.id;
  end if;
end;
$function$;

GRANT EXECUTE ON FUNCTION "public"."cancel_borrow_request"(uuid, text) TO PUBLIC, "anon", "authenticated", "postgres", "service_role";
