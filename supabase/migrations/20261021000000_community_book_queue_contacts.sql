alter table public.community_book_requests
  add column if not exists queue_position integer;

create index if not exists community_book_requests_pending_queue_idx
  on public.community_book_requests (book_id, request_date, id)
  where status = 'pending';

update public.books book
set available_copies = greatest(
  coalesce(book.total_copies, 1) - coalesce((
    select count(*)::integer
    from public.community_book_requests request
    where request.book_id = book.id
      and request.status in ('approved', 'borrowed')
  ), 0),
  0
)
where book.book_type = 'personal';

drop trigger if exists require_available_community_book_copy
  on public.community_book_requests;

create or replace function public.update_community_book_copy_availability()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if new.status in ('approved', 'borrowed') then
      update public.books
      set available_copies = available_copies - 1
      where id = new.book_id
        and book_type = 'personal'
        and available_copies > 0;

      if not found then
        raise exception 'No copies of this community book are currently available.';
      end if;
    end if;
  elsif tg_op = 'UPDATE' then
    if old.status not in ('approved', 'borrowed')
      and new.status in ('approved', 'borrowed')
    then
      update public.books
      set available_copies = available_copies - 1
      where id = new.book_id
        and book_type = 'personal'
        and available_copies > 0;

      if not found then
        raise exception 'No copies of this community book are currently available.';
      end if;
    elsif old.status in ('approved', 'borrowed')
      and new.status not in ('approved', 'borrowed')
    then
      update public.books
      set available_copies = least(
        coalesce(total_copies, 1),
        available_copies + 1
      )
      where id = old.book_id
        and book_type = 'personal';
    end if;
  end if;

  return new;
end;
$$;

drop function if exists public.request_community_book(text, text);
drop function if exists public.request_community_book(uuid, text);
create function public.request_community_book(
  p_requester_visitor_id text,
  p_book_id text
)
returns table (
  id uuid,
  book_id text,
  book_title text,
  owner_visitor_id text,
  owner_name text,
  requester_visitor_id text,
  requester_name text,
  status text,
  request_date timestamptz,
  owner_response text,
  queue_position integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  requester public.visitors%rowtype;
  book_row public.books%rowtype;
  request_row public.community_book_requests%rowtype;
  position_value integer;
begin
  select visitor.* into requester
  from public.visitors visitor
  where visitor.auth_user_id = auth.uid()
    and (
      visitor.id = trim(p_requester_visitor_id)
      or visitor.auth_user_id::text = trim(p_requester_visitor_id)
    )
    and visitor.otp_verified
    and visitor.is_active;
  if not found then
    raise exception 'The authenticated, verified visitor account could not be found.';
  end if;

  select book.* into book_row
  from public.books book
  where book.id = trim(p_book_id)
    and book.book_type = 'personal'
    and book.is_public
    and book.lending_enabled
  for update;
  if not found then
    raise exception 'This is not available for community lending.';
  end if;
  if book_row.owner_visitor_id = requester.id then
    raise exception 'You cannot request your own personal book.';
  end if;
  if exists (
    select 1 from public.community_book_requests request
    where request.book_id = book_row.id
      and request.requester_visitor_id = requester.id
      and request.status in ('pending', 'approved', 'borrowed')
  ) then
    raise exception 'You already have an active request for this community book.';
  end if;

  select count(*)::integer + 1 into position_value
  from public.community_book_requests request
  where request.book_id = book_row.id
    and request.status = 'pending';

  insert into public.community_book_requests (
    book_id, book_title, owner_visitor_id, owner_name,
    requester_visitor_id, requester_name, status, queue_position
  ) values (
    book_row.id, book_row.title, book_row.owner_visitor_id,
    coalesce((select owner.full_name from public.visitors owner
              where owner.id = book_row.owner_visitor_id), 'Book owner'),
    requester.id, requester.full_name, 'pending', position_value
  )
  returning * into request_row;

  return query select request_row.id, request_row.book_id, request_row.book_title,
    request_row.owner_visitor_id, request_row.owner_name,
    request_row.requester_visitor_id, request_row.requester_name,
    request_row.status, request_row.request_date, request_row.owner_response,
    request_row.queue_position;
end;
$$;

revoke all on function public.request_community_book(text, text)
  from public, anon;
grant execute on function public.request_community_book(text, text)
  to authenticated;

drop function if exists public.fetch_my_community_book_requests(text);
create function public.fetch_my_community_book_requests(
  p_requester_visitor_id text
)
returns table (
  id uuid,
  book_id text,
  book_title text,
  owner_visitor_id text,
  owner_name text,
  requester_visitor_id text,
  requester_name text,
  status text,
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
  return_confirmed_by text,
  queue_position integer,
  owner_contact_email text,
  owner_contact_number text,
  owner_contact_details text
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not exists (
    select 1 from public.visitors visitor
    where visitor.id = trim(p_requester_visitor_id)
      and visitor.auth_user_id = auth.uid()
      and visitor.otp_verified
      and visitor.is_active
  ) then
    raise exception 'The authenticated, verified visitor account could not be found.';
  end if;

  return query
  select request.id, request.book_id, request.book_title,
    request.owner_visitor_id, request.owner_name,
    request.requester_visitor_id, request.requester_name,
    request.status::text, request.request_date, request.approved_at,
    request.rejected_at, request.owner_response, request.pickup_deadline,
    request.borrow_date, request.due_date, request.return_date,
    request.fine_amount, request.confirmed_by, request.return_confirmed_by,
    case when request.status = 'pending' then (
      select count(*)::integer
      from public.community_book_requests earlier
      where earlier.book_id = request.book_id
        and earlier.status = 'pending'
        and (earlier.request_date, earlier.id) <= (request.request_date, request.id)
    )
      else null
    end,
    case when request.status in ('approved', 'borrowed')
      then owner.email else null end,
    case when request.status in ('approved', 'borrowed')
      then owner.contact_number else null end,
    case when request.status in ('approved', 'borrowed')
      then book.handover_details else null end
  from public.community_book_requests request
  left join public.visitors owner on owner.id = request.owner_visitor_id
  left join public.books book on book.id = request.book_id
  where request.requester_visitor_id = trim(p_requester_visitor_id)
  order by request.request_date desc;
end;
$$;

revoke all on function public.fetch_my_community_book_requests(text)
  from public, anon;
grant execute on function public.fetch_my_community_book_requests(text)
  to authenticated;

drop function if exists public.approve_community_book_request(uuid, text, text);
create function public.approve_community_book_request(
  p_request_id uuid,
  p_owner_visitor_id text,
  p_response text default null
)
returns table (
  id uuid,
  book_id text,
  book_title text,
  requester_visitor_id text,
  requester_name text,
  status text,
  approved_at timestamptz,
  owner_response text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  request_row public.community_book_requests%rowtype;
  available_count integer;
begin
  if auth.uid() is null or not exists (
    select 1 from public.visitors visitor
    where visitor.id = trim(p_owner_visitor_id)
      and visitor.auth_user_id = auth.uid()
      and visitor.otp_verified
      and visitor.is_active
  ) then
    raise exception 'The authenticated, verified visitor account could not be found.';
  end if;

  select request.* into request_row
  from public.community_book_requests request
  where request.id = p_request_id
  for update;
  if not found then
    raise exception 'Community book request could not be found.';
  end if;
  if request_row.owner_visitor_id <> trim(p_owner_visitor_id) then
    raise exception 'Only the owner of this community book can approve the request.';
  end if;
  if request_row.status <> 'pending' then
    raise exception 'This request is no longer pending.';
  end if;

  select book.available_copies into available_count
  from public.books book
  where book.id = request_row.book_id
    and book.book_type = 'personal'
    and book.lending_enabled
    and book.is_public
  for update;
  if not found or coalesce(available_count, 0) < 1 then
    raise exception 'No copies of this community book are currently available.';
  end if;
  if exists (
    select 1 from public.community_book_requests earlier
    where earlier.book_id = request_row.book_id
      and earlier.status = 'pending'
      and (earlier.request_date, earlier.id) < (request_row.request_date, request_row.id)
  ) then
    raise exception 'Please approve the next request in the community book queue first.';
  end if;

  update public.community_book_requests request
  set status = 'approved',
      approved_at = now(),
      rejected_at = null,
      owner_response = nullif(trim(p_response), '')
  where request.id = p_request_id
  returning * into request_row;

  return query select request_row.id, request_row.book_id, request_row.book_title,
    request_row.requester_visitor_id, request_row.requester_name,
    request_row.status, request_row.approved_at, request_row.owner_response;
end;
$$;

revoke all on function public.approve_community_book_request(uuid, text, text)
  from public, anon;
grant execute on function public.approve_community_book_request(uuid, text, text)
  to authenticated;

notify pgrst, 'reload schema';
