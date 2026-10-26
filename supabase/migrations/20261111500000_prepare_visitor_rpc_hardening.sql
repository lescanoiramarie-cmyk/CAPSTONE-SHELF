-- Prepare the three UUID/text RPC implementations that the next migration
-- moves into shelf_private before creating their public security wrappers.

create function public.request_borrow(
  p_visitor_id uuid,
  p_book_id text
)
returns public.borrow_requests
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_book books%rowtype;
  v_visitor visitors%rowtype;
  v_req borrow_requests%rowtype;
  v_queue_count int;
  v_active_allocations integer := 0;
begin
  select v.*
  into v_visitor
  from public.visitors as v
  where v.auth_user_id = p_visitor_id
     or v.id = p_visitor_id::text
  limit 1;

  select b.*
  into v_book
  from public.books as b
  where b.id = trim(p_book_id)
  for update;

  if v_visitor.id is null then
    raise exception 'Visitor account could not be found.';
  end if;

  if v_book.id is null then
    raise exception 'The selected book could not be found.';
  end if;

  if not coalesce(v_visitor.otp_verified, false) then
    raise exception
      'Please verify your visitor account before requesting a book.';
  end if;

  if not coalesce(v_visitor.is_active, true) then
    raise exception
      'This visitor account is currently inactive.';
  end if;

  if exists (
    select 1
    from public.borrow_requests as br
    where br.visitor_id = v_visitor.id
      and br.book_id = trim(p_book_id)
      and br.status in (
        'queued',
        'ready_for_pickup',
        'borrowed'
      )
  ) then
    raise exception
      'You already have an active request or loan for this title.';
  end if;

  select count(*)::integer
  into v_active_allocations
  from public.borrow_requests as request
  where request.book_id = v_book.id
    and request.status in ('ready_for_pickup', 'borrowed')
    and request.return_date is null;

  select v_active_allocations + count(*)::integer
  into v_active_allocations
  from public.community_book_requests as request
  where request.book_id = v_book.id
    and request.status in ('approved', 'borrowed')
    and request.return_date is null;

  if coalesce(v_book.available_copies, 0) > 0
     and v_book.total_copies > v_active_allocations
     and v_book.available_copies <= v_book.total_copies - v_active_allocations
  then
    update public.books as b
    set available_copies = b.available_copies - 1
    where b.id = trim(p_book_id);

    insert into public.borrow_requests (
      book_id,
      book_title,
      visitor_id,
      visitor_name,
      status,
      pickup_deadline
    )
    values (
      v_book.id,
      v_book.title,
      v_visitor.id,
      v_visitor.full_name,
      'ready_for_pickup',
      now() + interval '24 hours'
    )
    returning * into v_req;
  else
    select count(*)
    into v_queue_count
    from public.borrow_requests as br
    where br.book_id = trim(p_book_id)
      and br.status = 'queued';

    insert into public.borrow_requests (
      book_id,
      book_title,
      visitor_id,
      visitor_name,
      status,
      queue_position
    )
    values (
      v_book.id,
      v_book.title,
      v_visitor.id,
      v_visitor.full_name,
      'queued',
      v_queue_count + 1
    )
    returning * into v_req;
  end if;

  return v_req;
end;
$$;

grant execute on function public.request_borrow(uuid, text) to postgres;
revoke all on function public.request_borrow(uuid, text) from public;

create function public.get_visitor_borrow_requests(
  p_visitor_id uuid
)
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
  return query
    select br.id,
      br.book_id::text,
      br.book_title::text,
      br.visitor_id::text,
      br.visitor_name::text,
      br.status::text,
      br.request_date,
      br.pickup_deadline,
      br.queue_position,
      br.borrow_date,
      br.due_date,
      br.return_date,
      br.fine_amount::numeric,
      br.confirmed_by::text,
      br.return_confirmed_by::text
    from public.borrow_requests br
    join public.visitors v on v.id = br.visitor_id
    where v.auth_user_id = p_visitor_id
    order by br.request_date desc;
end;
$$;

grant execute on function public.get_visitor_borrow_requests(uuid) to postgres;
revoke all on function public.get_visitor_borrow_requests(uuid) from public;

create function public.cancel_community_book_request(
  p_request_id uuid,
  p_requester_visitor_id text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_req community_book_requests%rowtype;
begin
  select cbr.*
  into v_req
  from public.community_book_requests cbr
  where cbr.id = p_request_id;

  if v_req.id is null then
    raise exception 'Request not found.';
  end if;

  if v_req.requester_visitor_id <> trim(p_requester_visitor_id) then
    raise exception 'You can only cancel your own requests.';
  end if;

  if v_req.status <> 'pending' then
    raise exception 'Only pending requests can be cancelled.';
  end if;

  delete from public.community_book_requests
  where id = p_request_id;
end;
$$;

grant execute on function public.cancel_community_book_request(uuid, text) to postgres;
revoke all on function public.cancel_community_book_request(uuid, text) from public;

create function public.find_visitor_by_qr (
  p_qr text,
  p_library_id uuid
)
returns table (
  id text,
  full_name character varying,
  contact_number character varying,
  email character varying,
  address text,
  qr_code character varying
)
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  v_staff_library_id uuid;
  v_role text;
begin
  select sp.library_id, lower(sp.role)
    into v_staff_library_id, v_role
  from public.staff_profiles as sp
  where sp.id = auth.uid()
    and sp.is_active is true;

  if not found then
    raise exception 'Active staff profile required.';
  end if;

  if v_role <> 'superadmin'
     and v_staff_library_id is distinct from p_library_id
  then
    raise exception 'You are not authorized to scan for this library.';
  end if;

  return query
  select
    v.id::text,
    v.full_name,
    v.contact_number,
    v.email,
    v.address,
    v.qr_code
  from public.visitors as v
  where upper(trim(v.qr_code)) = upper(trim(p_qr))
    and v.is_active is true
    and v.otp_verified is true
  limit 1;
end;
$function$;

grant execute on function public.find_visitor_by_qr(text, uuid)
  to authenticated, postgres, service_role;
revoke all on function public.find_visitor_by_qr(text, uuid) from public;

create function public.auto_cancel_expired_borrow_requests()
returns integer
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_count integer;
begin
  update public.borrow_requests
  set
    status = 'cancelled',
    cancel_reason = 'Pickup deadline expired'
  where status = 'pending'
    and pickup_deadline is not null
    and pickup_deadline < now();

  get diagnostics v_count = row_count;

  return v_count;
end;
$function$;

grant execute on function public.auto_cancel_expired_borrow_requests()
  to postgres, service_role;
revoke all on function public.auto_cancel_expired_borrow_requests() from public;

create function public.confirm_community_book_return (
  p_request_id       uuid,
  p_owner_visitor_id text
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_req public.community_book_requests%rowtype;
  v_fine numeric := 0;
begin
  if auth.uid() is null or not exists (
    select 1
    from public.visitors as visitor
    where visitor.id::text = trim(p_owner_visitor_id)
      and visitor.auth_user_id = auth.uid()
      and visitor.otp_verified = true
      and visitor.is_active = true
  ) then
    raise exception
      'The authenticated, verified owner account could not be found.';
  end if;

  -- Get and lock the request
  select cbr.*
  into v_req
  from public.community_book_requests as cbr
  where cbr.id = p_request_id
  for update;

  -- Request must exist
  if v_req.id is null then
    raise exception 'Request not found.';
  end if;

  -- Only borrowed books can be returned
  if v_req.status <> 'borrowed' then
    raise exception
      'This community book is not currently borrowed.';
  end if;

  -- Only the owner can confirm the return
  if v_req.owner_visitor_id <> trim(p_owner_visitor_id) then
    raise exception
      'Only the owner of this community book can confirm the return.';
  end if;

  -- Calculate fine using the SHELF rule of ₱10/day.
  -- No fine if returned on or before the due date.
  if v_req.due_date is not null
     and now() > v_req.due_date then
    v_fine :=
      ceil(
        extract(epoch from (now() - v_req.due_date))
        / 86400
      ) * 10;
  end if;

  -- Mark the community book as returned
  update public.community_book_requests as cbr
  set
    status = 'returned',
    return_date = now(),
    fine_amount = v_fine,
    return_confirmed_by = trim(p_owner_visitor_id),
    updated_at = now()
  where cbr.id = p_request_id;
end;
$function$;

grant execute on function public.confirm_community_book_return(uuid, text)
  to authenticated, postgres, service_role;
revoke all on function public.confirm_community_book_return(uuid, text)
  from public;
