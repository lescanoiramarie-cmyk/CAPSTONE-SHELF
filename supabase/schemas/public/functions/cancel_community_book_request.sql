CREATE OR REPLACE FUNCTION public.cancel_community_book_request (
  p_request_id           uuid,
  p_requester_visitor_id text
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  AS $function$
declare v_req community_book_requests%rowtype;
begin
  select cbr.* into v_req from public.community_book_requests cbr where cbr.id = p_request_id;
  if v_req.id is null then raise exception 'Request not found.'; end if;
  if v_req.requester_visitor_id <> trim(p_requester_visitor_id) then raise exception 'You can only cancel your own requests.'; end if;
  if v_req.status <> 'pending' then raise exception 'Only pending requests can be cancelled.'; end if;
  delete from public.community_book_requests where id = p_request_id;
end; $function$;

GRANT EXECUTE ON FUNCTION "public"."cancel_community_book_request"(uuid, text) TO PUBLIC, "anon", "authenticated", "postgres", "service_role";
