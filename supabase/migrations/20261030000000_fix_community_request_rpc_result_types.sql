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
    select 1
    from public.community_book_requests request
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
    book_id,
    book_title,
    owner_visitor_id,
    owner_name,
    requester_visitor_id,
    requester_name,
    status,
    queue_position
  ) values (
    book_row.id,
    book_row.title,
    book_row.owner_visitor_id,
    coalesce(
      (
        select owner.full_name
        from public.visitors owner
        where owner.id = book_row.owner_visitor_id
      ),
      'Book owner'
    ),
    requester.id,
    requester.full_name,
    'pending',
    position_value
  )
  returning * into request_row;

  return query
  select
    request_row.id::uuid,
    request_row.book_id::text,
    request_row.book_title::text,
    request_row.owner_visitor_id::text,
    request_row.owner_name::text,
    request_row.requester_visitor_id::text,
    request_row.requester_name::text,
    request_row.status::text,
    request_row.request_date::timestamptz,
    request_row.owner_response::text,
    request_row.queue_position::integer;
end;
$$;

revoke all on function public.request_community_book(text, text)
  from public, anon;
grant execute on function public.request_community_book(text, text)
  to authenticated;

drop function if exists public.fetch_my_community_book_requests(uuid);
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
    select 1
    from public.visitors visitor
    where visitor.id = trim(p_requester_visitor_id)
      and visitor.auth_user_id = auth.uid()
      and visitor.otp_verified
      and visitor.is_active
  ) then
    raise exception 'The authenticated, verified visitor account could not be found.';
  end if;

  return query
  select
    request.id::uuid,
    request.book_id::text,
    request.book_title::text,
    request.owner_visitor_id::text,
    request.owner_name::text,
    request.requester_visitor_id::text,
    request.requester_name::text,
    request.status::text,
    request.request_date::timestamptz,
    request.approved_at::timestamptz,
    request.rejected_at::timestamptz,
    request.owner_response::text,
    request.pickup_deadline::timestamptz,
    request.borrow_date::timestamptz,
    request.due_date::timestamptz,
    request.return_date::timestamptz,
    request.fine_amount::numeric,
    request.confirmed_by::text,
    request.return_confirmed_by::text,
    case
      when request.status = 'pending' then (
        select count(*)::integer
        from public.community_book_requests earlier
        where earlier.book_id = request.book_id
          and earlier.status = 'pending'
          and (earlier.request_date, earlier.id)
            <= (request.request_date, request.id)
      )
      else null::integer
    end,
    case
      when request.status in ('approved', 'borrowed')
        then owner.email::text
      else null::text
    end,
    case
      when request.status in ('approved', 'borrowed')
        then owner.contact_number::text
      else null::text
    end,
    case
      when request.status in ('approved', 'borrowed')
        then book.handover_details::text
      else null::text
    end
  from public.community_book_requests request
  left join public.visitors owner
    on owner.id = request.owner_visitor_id
  left join public.books book
    on book.id = request.book_id
  where request.requester_visitor_id = trim(p_requester_visitor_id)
  order by request.request_date desc;
end;
$$;

revoke all on function public.fetch_my_community_book_requests(text)
  from public, anon;
grant execute on function public.fetch_my_community_book_requests(text)
  to authenticated;

notify pgrst, 'reload schema';
