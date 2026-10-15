drop function if exists public.confirm_community_book_pickup(uuid, uuid);
drop function if exists public.confirm_community_book_pickup(uuid, text);
drop function if exists public.confirm_community_book_pickup(text, text);

create function public.confirm_community_book_pickup(
  p_request_id uuid,
  p_owner_visitor_id text
)
returns table (
  id uuid,
  status text,
  borrow_date timestamptz,
  due_date timestamptz,
  confirmed_by text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  request_row public.community_book_requests%rowtype;
  lending_days integer;
  confirmed_at timestamptz := now();
begin
  if auth.uid() is null or not exists (
    select 1
    from public.visitors visitor
    where visitor.id = trim(p_owner_visitor_id)
      and visitor.auth_user_id = auth.uid()
      and visitor.otp_verified
      and visitor.is_active
  ) then
    raise exception 'The authenticated, verified visitor account could not be found.';
  end if;

  select request.*
  into request_row
  from public.community_book_requests request
  where request.id = p_request_id
  for update;

  if not found then
    raise exception 'Community book request could not be found.';
  end if;

  if request_row.owner_visitor_id <> trim(p_owner_visitor_id) then
    raise exception 'Only the owner of this community book can confirm its handover.';
  end if;

  if request_row.status <> 'approved' then
    raise exception 'Only an approved community book request can be confirmed.';
  end if;

  select greatest(coalesce(book.lending_period_days, 14), 1)
  into lending_days
  from public.books book
  where book.id = request_row.book_id
    and book.book_type = 'personal'
    and book.lending_enabled;

  if not found then
    raise exception 'This community book is no longer available for lending.';
  end if;

  update public.community_book_requests request
  set status = 'borrowed',
      borrow_date = confirmed_at,
      due_date = confirmed_at + make_interval(days => lending_days),
      confirmed_by = trim(p_owner_visitor_id)
  where request.id = p_request_id
  returning request.* into request_row;

  return query
  select
    request_row.id::uuid,
    request_row.status::text,
    request_row.borrow_date::timestamptz,
    request_row.due_date::timestamptz,
    request_row.confirmed_by::text;
end;
$$;

revoke all on function public.confirm_community_book_pickup(uuid, text)
  from public, anon;
grant execute on function public.confirm_community_book_pickup(uuid, text)
  to authenticated;

notify pgrst, 'reload schema';
