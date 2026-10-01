-- Keep visitor QR passes unavailable until Supabase Auth confirms the email.

alter table public.visitors
  add column if not exists is_active boolean not null default true;

-- Profiles without a linked Auth account cannot be used to sign in.
update public.visitors
set otp_verified = false,
  qr_code = null,
  is_active = false
where auth_user_id is null;

-- Reflect Auth confirmation state and remove passes from unconfirmed profiles.
update public.visitors visitor
set otp_verified = (account.email_confirmed_at is not null),
    is_active = case
      when account.email_confirmed_at is null then false
      else visitor.is_active
    end,
    qr_code = case
      when account.email_confirmed_at is null or not visitor.is_active then null
      when visitor.qr_code ~ '^SHELF-QR-[0-9A-F]{32}$' then visitor.qr_code
      else 'SHELF-QR-' || upper(replace(gen_random_uuid()::text, '-', ''))
    end
from auth.users account
where account.id = visitor.auth_user_id
  and coalesce(account.raw_user_meta_data ->> 'role', '') = 'visitor';

create or replace function public.link_visitor_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  visitor_id_value text;
  is_confirmed boolean;
begin
  if coalesce(new.raw_user_meta_data ->> 'role', '') <> 'visitor' then
    return new;
  end if;

  is_confirmed := new.email_confirmed_at is not null;

  select id::text into visitor_id_value
  from public.visitors
  where lower(email) = lower(new.email)
  limit 1;

  if visitor_id_value is null then
    insert into public.visitors (
      full_name,
      contact_number,
      email,
      address,
      otp_verified,
      qr_code,
      auth_user_id,
      is_active
    ) values (
      coalesce(new.raw_user_meta_data ->> 'full_name', 'Visitor'),
      new.raw_user_meta_data ->> 'contact_number',
      lower(new.email),
      new.raw_user_meta_data ->> 'address',
      is_confirmed,
      case
        when is_confirmed then 'SHELF-QR-' || upper(replace(gen_random_uuid()::text, '-', ''))
        else null
      end,
      new.id,
      is_confirmed
    );
  else
    update public.visitors
    set auth_user_id = new.id,
        full_name = coalesce(nullif(new.raw_user_meta_data ->> 'full_name', ''), full_name),
        contact_number = coalesce(new.raw_user_meta_data ->> 'contact_number', contact_number),
        address = coalesce(new.raw_user_meta_data ->> 'address', address),
        otp_verified = is_confirmed,
        is_active = case
          when is_confirmed and not otp_verified then true
          else is_active
        end,
        qr_code = case
          when not is_confirmed or (not is_active and otp_verified) then null
          when qr_code ~ '^SHELF-QR-[0-9A-F]{32}$' then qr_code
          else 'SHELF-QR-' || upper(replace(gen_random_uuid()::text, '-', ''))
        end
    where id::text = visitor_id_value;
  end if;

  return new;
end;
$$;

drop policy if exists "visitor and staff read scoped visitor profiles" on public.visitors;
create policy "visitor and staff read scoped visitor profiles" on public.visitors
  for select to authenticated
  using (
    (auth_user_id = auth.uid() and otp_verified and is_active)
    or public.is_active_staff_for_branch(null)
  );

drop policy if exists "authenticated visitors submit feedback" on public.visitor_feedback;
create policy "authenticated visitors submit feedback" on public.visitor_feedback
  for insert to authenticated
  with check (exists (
    select 1 from public.visitors visitor
    where visitor.id::text = public.visitor_feedback.visitor_id::text
      and visitor.auth_user_id = auth.uid()
      and visitor.otp_verified
      and visitor.is_active
  ));

drop policy if exists "visitors and branch staff read feedback" on public.visitor_feedback;
create policy "visitors and branch staff read feedback" on public.visitor_feedback
  for select to authenticated using (
    exists (
      select 1 from public.visitors visitor
      where visitor.id::text = public.visitor_feedback.visitor_id::text
        and visitor.auth_user_id = auth.uid()
        and visitor.otp_verified
        and visitor.is_active
    )
    or public.is_active_staff_for_branch(library_id::text)
  );

drop policy if exists "visitors manage own reviews" on public.book_reviews;
create policy "visitors manage own reviews" on public.book_reviews
  for all to authenticated
  using (exists (
    select 1 from public.visitors visitor
    where visitor.id::text = public.book_reviews.visitor_id::text
      and visitor.auth_user_id = auth.uid()
      and visitor.otp_verified
      and visitor.is_active
  ))
  with check (exists (
    select 1 from public.visitors visitor
    where visitor.id::text = public.book_reviews.visitor_id::text
      and visitor.auth_user_id = auth.uid()
      and visitor.otp_verified
      and visitor.is_active
  ));

drop policy if exists "visitors manage own personal books" on public.personal_books;
create policy "visitors manage own personal books" on public.personal_books
  for all to authenticated
  using (exists (
    select 1 from public.visitors visitor
    where visitor.id::text = public.personal_books.owner_id::text
      and visitor.auth_user_id = auth.uid()
      and visitor.otp_verified
      and visitor.is_active
  ))
  with check (exists (
    select 1 from public.visitors visitor
    where visitor.id::text = public.personal_books.owner_id::text
      and visitor.auth_user_id = auth.uid()
      and visitor.otp_verified
      and visitor.is_active
  ));

drop policy if exists "visitors and branch staff read requests" on public.borrow_requests;
create policy "visitors and branch staff read requests" on public.borrow_requests
  for select to authenticated
  using (
    exists (
      select 1 from public.visitors visitor
      where visitor.id::text = public.borrow_requests.visitor_id::text
        and visitor.auth_user_id = auth.uid()
        and visitor.otp_verified
        and visitor.is_active
    )
    or exists (
      select 1 from public.books book
      where book.id::text = public.borrow_requests.book_id::text
        and public.is_active_staff_for_branch(book.library_id::text)
    )
  );

drop policy if exists "visitors and branch staff read attendance" on public.attendance_logs;
create policy "visitors and branch staff read attendance" on public.attendance_logs
  for select to authenticated
  using (
    exists (
      select 1 from public.visitors visitor
      where visitor.id::text = public.attendance_logs.visitor_id::text
        and visitor.auth_user_id = auth.uid()
        and visitor.otp_verified
        and visitor.is_active
    )
    or public.is_active_staff_for_branch(library_id::text)
  );

create or replace function public.request_borrow(p_visitor_id text, p_book_id text)
returns public.borrow_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  v_book public.books%rowtype;
  v_visitor public.visitors%rowtype;
  v_req public.borrow_requests%rowtype;
  v_queue_count integer;
begin
  select * into v_visitor from public.visitors
  where id::text = p_visitor_id
    and auth_user_id = auth.uid()
    and otp_verified
    and is_active;
  if v_visitor.id is null then raise exception 'A verified, active visitor session is required.'; end if;

  select * into v_book from public.books where id::text = p_book_id for update;
  if v_book.id is null then raise exception 'Book not found.'; end if;
  if exists (
    select 1 from public.borrow_requests
    where visitor_id::text = p_visitor_id and book_id::text = p_book_id
      and status in ('queued', 'ready_for_pickup', 'borrowed')
  ) then raise exception 'You already have an active request or loan for this title.'; end if;

  if v_book.available_copies > 0 then
    update public.books set available_copies = available_copies - 1 where id::text = p_book_id;
    insert into public.borrow_requests (book_id, book_title, visitor_id, visitor_name, status, pickup_deadline)
    values (p_book_id, v_book.title, p_visitor_id, v_visitor.full_name, 'ready_for_pickup', now() + interval '24 hours')
    returning * into v_req;
  else
    select count(*) into v_queue_count from public.borrow_requests where book_id::text = p_book_id and status = 'queued';
    insert into public.borrow_requests (book_id, book_title, visitor_id, visitor_name, status, queue_position)
    values (p_book_id, v_book.title, p_visitor_id, v_visitor.full_name, 'queued', v_queue_count + 1)
    returning * into v_req;
  end if;
  return v_req;
end;
$$;
revoke all on function public.request_borrow(text, text) from public, anon;
grant execute on function public.request_borrow(text, text) to authenticated;

create or replace function public.get_visitor_feedback_replies(p_visitor_id text, p_email text)
returns table(id uuid, subject text, admin_reply text, replied_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.visitors visitor
    where visitor.id::text = trim(p_visitor_id)
      and lower(visitor.email) = lower(trim(p_email))
      and visitor.auth_user_id = auth.uid()
      and visitor.otp_verified
      and visitor.is_active
  ) then
    raise exception 'Authenticated, active visitor identity could not be verified.';
  end if;
  return query
    select feedback.id, feedback.subject, feedback.admin_reply, feedback.replied_at
    from public.visitor_feedback feedback
    where feedback.visitor_id::text = trim(p_visitor_id)
      and feedback.admin_reply is not null
    order by feedback.replied_at desc;
end;
$$;
revoke all on function public.get_visitor_feedback_replies(text, text) from public, anon;
grant execute on function public.get_visitor_feedback_replies(text, text) to authenticated;

create or replace function public.find_visitor_by_qr(p_qr text, p_library_id text)
returns table(id text, full_name text, email text, qr_code text)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_active_staff_for_branch(p_library_id) then
    raise exception 'You are not authorized to scan visitors for this branch.';
  end if;
  return query
    select visitor.id::text, visitor.full_name, visitor.email, visitor.qr_code
    from public.visitors visitor
    where visitor.qr_code = trim(p_qr)
      and visitor.otp_verified
      and visitor.is_active;
end;
$$;
revoke all on function public.find_visitor_by_qr(text, text) from public, anon;
grant execute on function public.find_visitor_by_qr(text, text) to authenticated;

create or replace function public.toggle_attendance(p_qr text, p_library_id text)
returns table(log_id text, visitor_id text, visitor_name text, action text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_visitor public.visitors%rowtype;
  v_log public.attendance_logs%rowtype;
  v_action text;
  library_id_type text;
begin
  if not public.is_active_staff_for_branch(p_library_id) then
    raise exception 'You are not authorized to record attendance for this branch.';
  end if;

  select * into v_visitor
  from public.visitors
  where qr_code = trim(p_qr)
    and otp_verified
    and is_active;
  if v_visitor.id is null then
    raise exception 'QR code is invalid, unverified, or inactive.';
  end if;

  select * into v_log
  from public.attendance_logs
  where visitor_id::text = v_visitor.id::text
    and library_id::text = p_library_id
    and time_in::date = current_date
    and checked_out_at is null
  order by time_in desc
  limit 1
  for update;

  if v_log.id is null then
    select format_type(attribute.atttypid, attribute.atttypmod)
      into library_id_type
      from pg_attribute attribute
     where attribute.attrelid = 'public.attendance_logs'::regclass
       and attribute.attname = 'library_id'
       and not attribute.attisdropped;

    execute format(
      'insert into public.attendance_logs (visitor_id, visitor_name, library_id) values ($1, $2, $3::%s) returning *',
      library_id_type
    ) into v_log using v_visitor.id, v_visitor.full_name, p_library_id;
    v_action := 'checked_in';
  else
    update public.attendance_logs
       set checked_out_at = now()
     where id::text = v_log.id::text
     returning * into v_log;
    v_action := 'checked_out';
  end if;

  return query
    select v_log.id::text, v_visitor.id::text, v_visitor.full_name, v_action;
end;
$$;
revoke all on function public.toggle_attendance(text, text) from public, anon;
grant execute on function public.toggle_attendance(text, text) to authenticated;