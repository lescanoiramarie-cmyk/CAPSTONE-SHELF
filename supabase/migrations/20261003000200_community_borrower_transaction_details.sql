drop function if exists public.fetch_my_community_book_requests(uuid);

create function public.fetch_my_community_book_requests(
  p_requester_visitor_id uuid
)
returns table (
  id uuid,
  book_id uuid,
  book_title text,
  owner_visitor_id uuid,
  owner_name text,
  requester_visitor_id uuid,
  requester_name text,
  status varchar,
  request_date timestamptz,
  approved_at timestamptz,
  rejected_at timestamptz,
  owner_response text,
  pickup_deadline timestamptz,
  borrow_date timestamptz,
  due_date timestamptz,
  return_date timestamptz,
  fine_amount numeric,
  confirmed_by text,
  return_confirmed_by text
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_requester_visitor_id is null then
    raise exception 'Requester visitor ID is required.';
  end if;

  return query
  select
    request.id,
    request.book_id,
    request.book_title,
    request.owner_visitor_id,
    request.owner_name,
    request.requester_visitor_id,
    request.requester_name,
    request.status,
    request.request_date,
    request.approved_at,
    request.rejected_at,
    request.owner_response,
    request.pickup_deadline,
    request.borrow_date,
    request.due_date,
    request.return_date,
    request.fine_amount,
    request.confirmed_by,
    request.return_confirmed_by
  from public.community_book_requests as request
  where request.requester_visitor_id = p_requester_visitor_id
  order by request.request_date desc;
end;
$$;

grant execute on function public.fetch_my_community_book_requests(uuid)
  to anon, authenticated, service_role;
