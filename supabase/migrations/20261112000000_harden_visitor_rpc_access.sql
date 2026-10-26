create schema if not exists shelf_private;
revoke all on schema shelf_private from public, anon, authenticated, service_role;

alter function public.request_borrow(uuid, text) set schema shelf_private;
alter function shelf_private.request_borrow(uuid, text) rename to request_borrow_unchecked;
alter function public.get_visitor_borrow_requests(uuid) set schema shelf_private;
alter function shelf_private.get_visitor_borrow_requests(uuid) rename to get_visitor_borrow_requests_unchecked;
alter function public.fetch_visitor_reading_list(uuid) set schema shelf_private;
alter function shelf_private.fetch_visitor_reading_list(uuid) rename to fetch_visitor_reading_list_unchecked;
alter function public.toggle_reading_list_item(uuid, text) set schema shelf_private;
alter function shelf_private.toggle_reading_list_item(uuid, text) rename to toggle_reading_list_item_unchecked;
alter function public.set_personal_book_visibility(text, text, boolean) set schema shelf_private;
alter function shelf_private.set_personal_book_visibility(text, text, boolean) rename to set_personal_book_visibility_unchecked;
alter function public.cancel_community_book_request(uuid, text) set schema shelf_private;
alter function shelf_private.cancel_community_book_request(uuid, text) rename to cancel_community_book_request_unchecked;

revoke all on function shelf_private.request_borrow_unchecked(uuid, text)
  from public, anon, authenticated, service_role;
revoke all on function shelf_private.get_visitor_borrow_requests_unchecked(uuid)
  from public, anon, authenticated, service_role;
revoke all on function shelf_private.fetch_visitor_reading_list_unchecked(uuid)
  from public, anon, authenticated, service_role;
revoke all on function shelf_private.toggle_reading_list_item_unchecked(uuid, text)
  from public, anon, authenticated, service_role;
revoke all on function shelf_private.set_personal_book_visibility_unchecked(text, text, boolean)
  from public, anon, authenticated, service_role;
revoke all on function shelf_private.cancel_community_book_request_unchecked(uuid, text)
  from public, anon, authenticated, service_role;

alter function shelf_private.request_borrow_unchecked(uuid, text)
  set search_path = public, pg_temp;
alter function shelf_private.get_visitor_borrow_requests_unchecked(uuid)
  set search_path = public, pg_temp;
alter function shelf_private.fetch_visitor_reading_list_unchecked(uuid)
  set search_path = public, pg_temp;
alter function shelf_private.toggle_reading_list_item_unchecked(uuid, text)
  set search_path = public, pg_temp;
alter function shelf_private.set_personal_book_visibility_unchecked(text, text, boolean)
  set search_path = public, pg_temp;
alter function shelf_private.cancel_community_book_request_unchecked(uuid, text)
  set search_path = public, pg_temp;

create function public.request_borrow(
  p_visitor_id uuid,
  p_book_id text
)
returns public.borrow_requests
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null or auth.uid() is distinct from p_visitor_id then
    raise exception 'The authenticated visitor account could not be verified.';
  end if;

  return shelf_private.request_borrow_unchecked(p_visitor_id, p_book_id);
end;
$$;

create function public.get_visitor_borrow_requests(p_visitor_id uuid)
returns table (
  id uuid,
  book_id text,
  book_title text,
  visitor_id text,
  visitor_name text,
  status text,
  request_date timestamptz,
  pickup_deadline timestamptz,
  queue_position integer,
  borrow_date timestamptz,
  due_date timestamptz,
  return_date timestamptz,
  fine_amount numeric,
  confirmed_by text,
  return_confirmed_by text
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null or auth.uid() is distinct from p_visitor_id then
    raise exception 'The authenticated visitor account could not be verified.';
  end if;

  return query
  select *
  from shelf_private.get_visitor_borrow_requests_unchecked(p_visitor_id);
end;
$$;

create function public.fetch_visitor_reading_list(p_visitor_id uuid)
returns setof public.books
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null or auth.uid() is distinct from p_visitor_id then
    raise exception 'The authenticated visitor account could not be verified.';
  end if;

  return query
  select *
  from shelf_private.fetch_visitor_reading_list_unchecked(p_visitor_id);
end;
$$;

create function public.toggle_reading_list_item(
  p_visitor_id uuid,
  p_book_id text
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null or auth.uid() is distinct from p_visitor_id then
    raise exception 'The authenticated visitor account could not be verified.';
  end if;

  return shelf_private.toggle_reading_list_item_unchecked(p_visitor_id, p_book_id);
end;
$$;

create function public.set_personal_book_visibility(
  p_visitor_id text,
  p_book_id text,
  p_is_public boolean
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null or not exists (
    select 1
    from public.visitors visitor
    where visitor.auth_user_id = auth.uid()
      and visitor.otp_verified
      and visitor.is_active
      and (
        visitor.id::text = trim(p_visitor_id)
        or visitor.auth_user_id::text = trim(p_visitor_id)
      )
  ) then
    raise exception 'The authenticated visitor account could not be verified.';
  end if;

  return shelf_private.set_personal_book_visibility_unchecked(
    p_visitor_id,
    p_book_id,
    p_is_public
  );
end;
$$;

drop function if exists public.cancel_borrow_request(uuid, text);

create or replace function public.cancel_borrow_request(
  p_request_id text,
  p_reason text default 'cancelled'
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
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
$$;

create function public.cancel_community_book_request(
  p_request_id uuid,
  p_requester_visitor_id text,
  p_reason text default 'cancelled'
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
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
    raise exception 'The authenticated visitor account could not be verified.';
  end if;

  if p_reason <> 'cancelled' then
    raise exception 'Unsupported cancellation reason.';
  end if;

  perform shelf_private.cancel_community_book_request_unchecked(
    p_request_id,
    p_requester_visitor_id
  );
end;
$$;

revoke all on function public.request_borrow(uuid, text) from public, anon;
revoke all on function public.get_visitor_borrow_requests(uuid) from public, anon;
revoke all on function public.fetch_visitor_reading_list(uuid) from public, anon;
revoke all on function public.toggle_reading_list_item(uuid, text) from public, anon;
revoke all on function public.set_personal_book_visibility(text, text, boolean) from public, anon;
revoke all on function public.cancel_borrow_request(text, text) from public, anon;
revoke all on function public.cancel_community_book_request(uuid, text, text) from public, anon;

grant execute on function public.request_borrow(uuid, text) to authenticated, service_role;
grant execute on function public.get_visitor_borrow_requests(uuid) to authenticated, service_role;
grant execute on function public.fetch_visitor_reading_list(uuid) to authenticated, service_role;
grant execute on function public.toggle_reading_list_item(uuid, text) to authenticated, service_role;
grant execute on function public.set_personal_book_visibility(text, text, boolean) to authenticated, service_role;
grant execute on function public.cancel_borrow_request(text, text) to authenticated, service_role;
grant execute on function public.cancel_community_book_request(uuid, text, text)
  to authenticated, service_role;

revoke all on function public.auto_cancel_expired_borrow_requests()
  from public, anon, authenticated;
grant execute on function public.auto_cancel_expired_borrow_requests() to service_role;

revoke all on function public.find_visitor_by_qr(text, uuid) from public, anon;
revoke all on function public.confirm_community_book_pickup(uuid, text) from public, anon;
revoke all on function public.confirm_community_book_return(uuid, text) from public, anon;

grant execute on function public.find_visitor_by_qr(text, uuid) to authenticated;
grant execute on function public.confirm_community_book_pickup(uuid, text) to authenticated;
grant execute on function public.confirm_community_book_return(uuid, text) to authenticated;

notify pgrst, 'reload schema';
