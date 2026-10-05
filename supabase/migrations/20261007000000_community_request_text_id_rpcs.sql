drop function if exists public.fetch_owner_community_book_requests(uuid);

create function public.fetch_owner_community_book_requests(
  p_owner_visitor_id text
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
  owner_response text
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not exists (
    select 1
    from public.visitors as visitor
    where visitor.id = p_owner_visitor_id
      and visitor.auth_user_id = auth.uid()
      and visitor.otp_verified
      and visitor.is_active
  ) then
    raise exception 'The authenticated, verified visitor account could not be found.';
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
    request.status::text,
    request.request_date,
    request.approved_at,
    request.rejected_at,
    request.owner_response
  from public.community_book_requests as request
  where request.owner_visitor_id = p_owner_visitor_id
  order by
    case
      when request.status = 'pending' then 0
      when request.status = 'approved' then 1
      else 2
    end,
    request.request_date desc;
end;
$$;

revoke all on function public.fetch_owner_community_book_requests(text)
  from public, anon;
grant execute on function public.fetch_owner_community_book_requests(text)
  to authenticated;

drop function if exists public.approve_community_book_request(uuid, uuid, text);

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
begin
  if auth.uid() is null or not exists (
    select 1
    from public.visitors as visitor
    where visitor.id = p_owner_visitor_id
      and visitor.auth_user_id = auth.uid()
      and visitor.otp_verified
      and visitor.is_active
  ) then
    raise exception 'The authenticated, verified visitor account could not be found.';
  end if;

  select request.*
  into request_row
  from public.community_book_requests as request
  where request.id = p_request_id
  for update;

  if not found then
    raise exception 'Community book request could not be found.';
  end if;
  if request_row.owner_visitor_id <> p_owner_visitor_id then
    raise exception 'Only the owner of this community book can approve the request.';
  end if;
  if request_row.status <> 'pending' then
    raise exception 'This request is no longer pending.';
  end if;

  update public.community_book_requests as request
  set status = 'approved',
      approved_at = now(),
      rejected_at = null,
      owner_response = nullif(trim(p_response), ''),
      updated_at = now()
  where request.id = p_request_id;

  return query
  select
    request.id,
    request.book_id,
    request.book_title,
    request.requester_visitor_id,
    request.requester_name,
    request.status::text,
    request.approved_at,
    request.owner_response
  from public.community_book_requests as request
  where request.id = p_request_id;
end;
$$;

revoke all on function public.approve_community_book_request(uuid, text, text)
  from public, anon;
grant execute on function public.approve_community_book_request(uuid, text, text)
  to authenticated;

drop function if exists public.reject_community_book_request(uuid, uuid, text);

create function public.reject_community_book_request(
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
  rejected_at timestamptz,
  owner_response text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  request_row public.community_book_requests%rowtype;
begin
  if auth.uid() is null or not exists (
    select 1
    from public.visitors as visitor
    where visitor.id = p_owner_visitor_id
      and visitor.auth_user_id = auth.uid()
      and visitor.otp_verified
      and visitor.is_active
  ) then
    raise exception 'The authenticated, verified visitor account could not be found.';
  end if;

  select request.*
  into request_row
  from public.community_book_requests as request
  where request.id = p_request_id
  for update;

  if not found then
    raise exception 'Community book request could not be found.';
  end if;
  if request_row.owner_visitor_id <> p_owner_visitor_id then
    raise exception 'Only the owner of this community book can reject the request.';
  end if;
  if request_row.status <> 'pending' then
    raise exception 'This request is no longer pending.';
  end if;

  update public.community_book_requests as request
  set status = 'rejected',
      rejected_at = now(),
      approved_at = null,
      owner_response = nullif(trim(p_response), ''),
      updated_at = now()
  where request.id = p_request_id;

  return query
  select
    request.id,
    request.book_id,
    request.book_title,
    request.requester_visitor_id,
    request.requester_name,
    request.status::text,
    request.rejected_at,
    request.owner_response
  from public.community_book_requests as request
  where request.id = p_request_id;
end;
$$;

revoke all on function public.reject_community_book_request(uuid, text, text)
  from public, anon;
grant execute on function public.reject_community_book_request(uuid, text, text)
  to authenticated;

notify pgrst, 'reload schema';
