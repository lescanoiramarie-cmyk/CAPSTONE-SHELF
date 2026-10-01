-- SHELF ILMS security and feature remediation.
-- Apply after the base schema. Review existing auth/provider configuration first.

alter table public.visitors
  add column if not exists auth_user_id uuid unique references auth.users(id) on delete cascade,
  add column if not exists otp_expires_at timestamptz;

drop function if exists public.register_visitor(text, text, text, text, text);
drop function if exists public.login_visitor(text, text);

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'visitors'
      and column_name = 'password'
  ) then
    execute 'alter table public.visitors drop column password';
  end if;
end;
$$;

create or replace function public.is_active_staff_for_branch(p_branch_id text default null)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.staff_profiles staff
    where staff.id = auth.uid()
      and staff.is_active
      and (
        staff.role = 'superadmin'
        or (staff.role = 'subadmin' and p_branch_id is not null
          and staff.library_id::text = p_branch_id)
      )
      and coalesce(auth.jwt() -> 'app_metadata' ->> 'role', staff.role) = staff.role
  );
$$;

revoke all on function public.is_active_staff_for_branch(text) from public;
grant execute on function public.is_active_staff_for_branch(text) to authenticated;

create or replace function public.link_visitor_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  visitor_id_value text;
begin
  if coalesce(new.raw_user_meta_data ->> 'role', '') <> 'visitor' then
    return new;
  end if;

  select id into visitor_id_value
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
      auth_user_id
    ) values (
      coalesce(new.raw_user_meta_data ->> 'full_name', 'Visitor'),
      new.raw_user_meta_data ->> 'contact_number',
      lower(new.email),
      new.raw_user_meta_data ->> 'address',
      new.email_confirmed_at is not null,
      'SHELF-QR-' || upper(replace(gen_random_uuid()::text, '-', '')),
      new.id
    ) returning id into visitor_id_value;
  else
    update public.visitors
    set auth_user_id = new.id,
        full_name = coalesce(nullif(new.raw_user_meta_data ->> 'full_name', ''), full_name),
        contact_number = coalesce(new.raw_user_meta_data ->> 'contact_number', contact_number),
        address = coalesce(new.raw_user_meta_data ->> 'address', address),
        otp_verified = new.email_confirmed_at is not null,
        qr_code = coalesce(qr_code, 'SHELF-QR-' || upper(replace(gen_random_uuid()::text, '-', '')))
    where id::text = visitor_id_value;
  end if;

  return new;
end;
$$;
revoke all on function public.link_visitor_auth_user() from public, anon, authenticated;

drop trigger if exists on_auth_user_visitor_link on auth.users;
create trigger on_auth_user_visitor_link_insert
  after insert on auth.users
  for each row execute function public.link_visitor_auth_user();
drop trigger if exists on_auth_user_visitor_confirm on auth.users;
create trigger on_auth_user_visitor_confirm
  after update of email_confirmed_at on auth.users
  for each row execute function public.link_visitor_auth_user();

update public.visitors visitor
set auth_user_id = account.id,
    otp_verified = account.email_confirmed_at is not null,
    qr_code = coalesce(visitor.qr_code, 'SHELF-QR-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12)))
from auth.users account
where lower(account.email) = lower(visitor.email)
  and coalesce(account.raw_user_meta_data ->> 'role', '') = 'visitor';

update public.visitors
set qr_code = 'SHELF-QR-' || upper(replace(gen_random_uuid()::text, '-', ''));

create table if not exists public.book_reviews (
  id uuid primary key default gen_random_uuid(),
  book_id text not null references public.books(id) on delete cascade,
  visitor_id text not null references public.visitors(id) on delete cascade,
  visitor_name text not null,
  rating smallint not null check (rating between 1 and 5),
  comment text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (book_id, visitor_id)
);

create table if not exists public.personal_books (
  id uuid primary key default gen_random_uuid(),
  owner_id text not null references public.visitors(id) on delete cascade,
  title text not null,
  author text not null,
  privacy_status text not null default 'private' check (privacy_status in ('private', 'public')),
  listing_type text not null default 'none' check (listing_type in ('none', 'lend', 'sell')),
  price numeric(10, 2) not null default 0 check (price >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references auth.users(id) on delete set null,
  action text not null,
  branch_id text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create or replace function public.capture_shelf_audit_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  branch_value text;
  event_action text;
  event_details jsonb;
  request_row public.borrow_requests%rowtype;
begin
  if tg_table_name = 'borrow_requests' then
    if tg_op = 'DELETE' then
      request_row := old;
    else
      request_row := new;
    end if;
    select library_id::text into branch_value
    from public.books
    where id::text = request_row.book_id::text;
    event_action := 'circulation.borrow_request.' || lower(tg_op);
    event_details := jsonb_build_object(
      'requestId', request_row.id,
      'bookId', request_row.book_id,
      'status', request_row.status,
      'fineAmount', request_row.fine_amount
    );
  elsif tg_table_name = 'attendance_logs' then
    if tg_op = 'DELETE' then
      branch_value := old.library_id::text;
    else
      branch_value := new.library_id::text;
    end if;
    event_action := case
      when tg_op = 'INSERT' then 'circulation.visitor.checked_in'
      else 'circulation.visitor.checked_out'
    end;
    event_details := jsonb_build_object(
      'attendanceId', case when tg_op = 'DELETE' then old.id else new.id end,
      'visitorId', case when tg_op = 'DELETE' then old.visitor_id else new.visitor_id end
    );
  elsif tg_table_name = 'books' then
    if tg_op = 'DELETE' then
      branch_value := old.library_id::text;
    else
      branch_value := new.library_id::text;
    end if;
    event_action := 'inventory.book.' || lower(tg_op);
    event_details := jsonb_build_object(
      'bookId', case when tg_op = 'DELETE' then old.id else new.id end,
      'title', case when tg_op = 'DELETE' then old.title else new.title end,
      'isbn', case when tg_op = 'DELETE' then old.isbn else new.isbn end
    );
  elsif tg_table_name = 'visitor_feedback' then
    if tg_op = 'DELETE' then
      branch_value := old.library_id::text;
    else
      branch_value := new.library_id::text;
    end if;
    event_action := 'visitor_feedback.' || lower(tg_op);
    event_details := jsonb_build_object(
      'feedbackId', case when tg_op = 'DELETE' then old.id else new.id end,
      'status', case when tg_op = 'DELETE' then old.status else new.status end,
      'category', case when tg_op = 'DELETE' then old.category else new.category end
    );
  elsif tg_table_name = 'announcements' then
    event_action := 'announcement.' || lower(tg_op);
    event_details := jsonb_build_object(
      'announcementId', case when tg_op = 'DELETE' then old.id else new.id end,
      'title', case when tg_op = 'DELETE' then old.title else new.title end,
      'published', case when tg_op = 'DELETE' then old.published else new.published end
    );
  end if;

  insert into public.audit_logs(actor_id, action, branch_id, details)
  values (auth.uid(), event_action, branch_value, coalesce(event_details, '{}'::jsonb));
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
revoke all on function public.capture_shelf_audit_event() from public, anon, authenticated;

drop trigger if exists audit_borrow_request_insert_delete on public.borrow_requests;
create trigger audit_borrow_request_insert_delete
  after insert or delete on public.borrow_requests
  for each row execute function public.capture_shelf_audit_event();
drop trigger if exists audit_borrow_request_status on public.borrow_requests;
create trigger audit_borrow_request_status
  after update of status, fine_amount on public.borrow_requests
  for each row execute function public.capture_shelf_audit_event();

drop trigger if exists audit_attendance_insert on public.attendance_logs;
create trigger audit_attendance_insert
  after insert on public.attendance_logs
  for each row execute function public.capture_shelf_audit_event();
drop trigger if exists audit_attendance_checkout on public.attendance_logs;
create trigger audit_attendance_checkout
  after update of checked_out_at on public.attendance_logs
  for each row execute function public.capture_shelf_audit_event();

drop trigger if exists audit_inventory_insert_delete on public.books;
create trigger audit_inventory_insert_delete
  after insert or delete on public.books
  for each row execute function public.capture_shelf_audit_event();
drop trigger if exists audit_inventory_update on public.books;
create trigger audit_inventory_update
  after update of title, isbn, category, total_copies, shelf_location on public.books
  for each row execute function public.capture_shelf_audit_event();

drop trigger if exists audit_feedback_insert_delete on public.visitor_feedback;
create trigger audit_feedback_insert_delete
  after insert or delete on public.visitor_feedback
  for each row execute function public.capture_shelf_audit_event();
drop trigger if exists audit_feedback_update on public.visitor_feedback;
create trigger audit_feedback_update
  after update of status, admin_reply on public.visitor_feedback
  for each row execute function public.capture_shelf_audit_event();

drop trigger if exists audit_announcement_changes on public.announcements;
create trigger audit_announcement_changes
  after insert or update or delete on public.announcements
  for each row execute function public.capture_shelf_audit_event();

create index if not exists borrow_requests_book_status_idx on public.borrow_requests(book_id, status);
create index if not exists audit_logs_created_idx on public.audit_logs(created_at desc);
create index if not exists audit_logs_branch_created_idx on public.audit_logs(branch_id, created_at desc);

alter table public.libraries enable row level security;
alter table public.books enable row level security;
alter table public.visitors enable row level security;
alter table public.borrow_requests enable row level security;
alter table public.attendance_logs enable row level security;
alter table public.announcements enable row level security;
alter table public.visitor_feedback enable row level security;
alter table public.staff_profiles enable row level security;
alter table public.book_reviews enable row level security;
alter table public.personal_books enable row level security;
alter table public.audit_logs enable row level security;

drop policy if exists "public read libraries" on public.libraries;
drop policy if exists "public write libraries" on public.libraries;
drop policy if exists "public read books" on public.books;
drop policy if exists "public write books" on public.books;
drop policy if exists "public read visitors" on public.visitors;
drop policy if exists "public write visitors" on public.visitors;
drop policy if exists "public read borrow_requests" on public.borrow_requests;
drop policy if exists "public write borrow_requests" on public.borrow_requests;
drop policy if exists "public read attendance_logs" on public.attendance_logs;
drop policy if exists "public write attendance_logs" on public.attendance_logs;

create policy "libraries are publicly readable" on public.libraries
  for select to anon, authenticated using (true);
create policy "superadmins manage libraries" on public.libraries
  for all to authenticated using (public.is_active_staff_for_branch(null))
  with check (public.is_active_staff_for_branch(null));

create policy "books are publicly readable" on public.books
  for select to anon, authenticated using (true);
create policy "staff manage books in branch" on public.books
  for all to authenticated
  using (public.is_active_staff_for_branch(library_id::text))
  with check (public.is_active_staff_for_branch(library_id::text));

create policy "visitor and staff read scoped visitor profiles" on public.visitors
  for select to authenticated
  using (
    auth_user_id = auth.uid()
    or public.is_active_staff_for_branch(null)
  );
create policy "visitors and branch staff read requests" on public.borrow_requests
  for select to authenticated
  using (
    exists (
      select 1 from public.visitors visitor
      where visitor.id::text = public.borrow_requests.visitor_id::text
        and visitor.auth_user_id = auth.uid()
    )
    or exists (
      select 1 from public.books book
      where book.id::text = public.borrow_requests.book_id::text
        and public.is_active_staff_for_branch(book.library_id::text)
    )
  );
create policy "visitors and branch staff read attendance" on public.attendance_logs
  for select to authenticated
  using (
    exists (
      select 1 from public.visitors visitor
      where visitor.id::text = public.attendance_logs.visitor_id::text
        and visitor.auth_user_id = auth.uid()
    )
    or public.is_active_staff_for_branch(library_id::text)
  );

drop policy if exists "public read announcements" on public.announcements;
drop policy if exists "admin manage announcements" on public.announcements;
create policy "published announcements are public" on public.announcements
  for select to anon, authenticated using (published);
create policy "staff manage announcements" on public.announcements
  for all to authenticated
  using (exists (
    select 1 from public.staff_profiles staff
    where staff.id = auth.uid() and staff.is_active
      and staff.role in ('superadmin', 'subadmin')
      and coalesce(auth.jwt() -> 'app_metadata' ->> 'role', staff.role) = staff.role
  ))
  with check (exists (
    select 1 from public.staff_profiles staff
    where staff.id = auth.uid() and staff.is_active
      and staff.role in ('superadmin', 'subadmin')
      and coalesce(auth.jwt() -> 'app_metadata' ->> 'role', staff.role) = staff.role
  ));

drop policy if exists "public submit feedback" on public.visitor_feedback;
drop policy if exists "admin read feedback" on public.visitor_feedback;
drop policy if exists "admin manage feedback" on public.visitor_feedback;
create policy "authenticated visitors submit feedback" on public.visitor_feedback
  for insert to authenticated
  with check (exists (
    select 1 from public.visitors visitor
    where visitor.id::text = visitor_feedback.visitor_id::text
      and visitor.auth_user_id = auth.uid()
      and (visitor_feedback.library_id is null or exists (
        select 1 from public.libraries library where library.id::text = visitor_feedback.library_id::text
      ))
  ));
create policy "visitors and branch staff read feedback" on public.visitor_feedback
  for select to authenticated using (
    exists (select 1 from public.visitors visitor where visitor.id::text = visitor_feedback.visitor_id::text and visitor.auth_user_id = auth.uid())
    or public.is_active_staff_for_branch(library_id::text)
  );
create policy "branch staff respond to feedback" on public.visitor_feedback
  for update to authenticated
  using (public.is_active_staff_for_branch(library_id::text))
  with check (public.is_active_staff_for_branch(library_id::text));

drop policy if exists "staff read own profile" on public.staff_profiles;
create policy "staff read own profile" on public.staff_profiles
  for select to authenticated using (
    id = auth.uid() or public.is_active_staff_for_branch(null)
  );

create policy "read public reviews" on public.book_reviews
  for select to anon, authenticated using (true);
create policy "visitors manage own reviews" on public.book_reviews
  for all to authenticated
  using (exists (select 1 from public.visitors visitor where visitor.id::text = public.book_reviews.visitor_id::text and visitor.auth_user_id = auth.uid()))
  with check (exists (select 1 from public.visitors visitor where visitor.id::text = public.book_reviews.visitor_id::text and visitor.auth_user_id = auth.uid()));

create policy "owners and public listings read personal books" on public.personal_books
  for select to authenticated
  using (
    privacy_status = 'public'
    or exists (select 1 from public.visitors visitor where visitor.id::text = public.personal_books.owner_id::text and visitor.auth_user_id = auth.uid())
  );
create policy "visitors manage own personal books" on public.personal_books
  for all to authenticated
  using (exists (select 1 from public.visitors visitor where visitor.id::text = public.personal_books.owner_id::text and visitor.auth_user_id = auth.uid()))
  with check (exists (select 1 from public.visitors visitor where visitor.id::text = public.personal_books.owner_id::text and visitor.auth_user_id = auth.uid()));

create policy "superadmins read audit logs" on public.audit_logs
  for select to authenticated using (public.is_active_staff_for_branch(null));
create policy "staff insert own audit events" on public.audit_logs
  for insert to authenticated with check (
    actor_id = auth.uid()
    and public.is_active_staff_for_branch(branch_id::text)
  );

revoke all on public.visitors from anon, authenticated;
revoke all on public.borrow_requests from anon, authenticated;
revoke all on public.attendance_logs from anon, authenticated;
revoke all on public.book_reviews from anon, authenticated;
revoke all on public.personal_books from anon, authenticated;
revoke all on public.audit_logs from anon, authenticated;
grant select on public.libraries, public.books, public.announcements to anon, authenticated;
grant select on public.visitors to authenticated;
grant select on public.staff_profiles to authenticated;
grant select on public.borrow_requests, public.attendance_logs to authenticated;
grant select, insert, update on public.visitor_feedback to authenticated;
grant select, insert, update, delete on public.book_reviews, public.personal_books to authenticated;
grant select, insert on public.audit_logs to authenticated;
grant insert, update, delete on public.books, public.libraries, public.announcements to authenticated;

revoke all on function public.verify_visitor_otp(text, text) from public, anon, authenticated;
revoke all on function public.resend_otp(text) from public, anon, authenticated;
revoke all on function public.auto_expire_pickups() from public, anon, authenticated;
grant execute on function public.auto_expire_pickups() to service_role;
revoke all on function public.scan_attendance(text, text) from public, anon, authenticated;
revoke all on function public.release_copy_and_promote(text) from public, anon, authenticated;

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
  ) then
    raise exception 'Authenticated visitor identity could not be verified.';
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

drop function if exists public.find_visitor_by_qr(text);
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
    where visitor.qr_code = trim(p_qr);
end;
$$;
revoke all on function public.find_visitor_by_qr(text, text) from public, anon;
grant execute on function public.find_visitor_by_qr(text, text) to authenticated;

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
  where id::text = p_visitor_id and auth_user_id = auth.uid();
  if v_visitor.id is null then raise exception 'Visitor authentication is required.'; end if;

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

create or replace function public.cancel_borrow_request(p_request_id text, p_reason text default 'cancelled')
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_req public.borrow_requests%rowtype;
begin
  select request.* into v_req
  from public.borrow_requests request
  join public.books book on book.id::text = request.book_id::text
  where request.id::text = p_request_id
    and (
      exists (select 1 from public.visitors visitor where visitor.id::text = request.visitor_id::text and visitor.auth_user_id = auth.uid())
      or public.is_active_staff_for_branch(book.library_id::text)
    );
  if v_req.id is null then raise exception 'Request not found or access denied.'; end if;
  if v_req.status not in ('queued', 'ready_for_pickup') then raise exception 'This request can no longer be cancelled.'; end if;
  if p_reason <> 'cancelled' then raise exception 'Unsupported cancellation reason.'; end if;
  update public.borrow_requests set status = p_reason where id::text = p_request_id;
  if v_req.status = 'ready_for_pickup' then
    perform public.release_copy_and_promote(v_req.book_id);
  else
    update public.borrow_requests br set queue_position = sub.rn
    from (select id, row_number() over (order by queue_position asc) as rn
      from public.borrow_requests where book_id = v_req.book_id and status = 'queued') sub
    where br.id = sub.id;
  end if;
end;
$$;
revoke all on function public.cancel_borrow_request(text, text) from public, anon;
grant execute on function public.cancel_borrow_request(text, text) to authenticated;

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
begin
  if not public.is_active_staff_for_branch(p_library_id) then
    raise exception 'You are not authorized to record attendance for this branch.';
  end if;
  select * into v_visitor from public.visitors where qr_code = trim(p_qr);
  if v_visitor.id is null then raise exception 'QR code not recognized.'; end if;
  select * into v_log from public.attendance_logs
    where attendance_logs.visitor_id::text = v_visitor.id::text
      and attendance_logs.library_id::text = p_library_id
      and attendance_logs.time_in::date = current_date
      and attendance_logs.checked_out_at is null
    order by attendance_logs.time_in desc limit 1 for update;
  if v_log.id is null then
    insert into public.attendance_logs (visitor_id, visitor_name, library_id)
    values (v_visitor.id, v_visitor.full_name, p_library_id) returning * into v_log;
    v_action := 'checked_in';
  else
    update public.attendance_logs set checked_out_at = now() where id = v_log.id returning * into v_log;
    v_action := 'checked_out';
  end if;
  return query select v_log.id::text, v_visitor.id::text, v_visitor.full_name, v_action;
end;
$$;
revoke all on function public.toggle_attendance(text, text) from public, anon;
grant execute on function public.toggle_attendance(text, text) to authenticated;

create or replace function public.confirm_pickup(p_request_id text, p_staff_name text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_req public.borrow_requests%rowtype;
begin
  select request.* into v_req from public.borrow_requests request
  join public.books book on book.id::text = request.book_id::text
  where request.id::text = p_request_id and public.is_active_staff_for_branch(book.library_id::text)
  for update of request;
  if v_req.id is null then raise exception 'Request not found or branch access denied.'; end if;
  if v_req.status <> 'ready_for_pickup' then raise exception 'This request is not ready for pickup.'; end if;
  if v_req.pickup_deadline <= now() then raise exception 'Pickup window expired. The hold must be released before checkout.'; end if;
  update public.borrow_requests set status = 'borrowed', borrow_date = now(), due_date = now() + interval '7 days', confirmed_by = p_staff_name where id::text = p_request_id;
end;
$$;
revoke all on function public.confirm_pickup(text, text) from public, anon;
grant execute on function public.confirm_pickup(text, text) to authenticated;

create or replace function public.confirm_return(p_request_id text, p_staff_name text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_req public.borrow_requests%rowtype;
  v_overdue_days integer;
begin
  select request.* into v_req from public.borrow_requests request
  join public.books book on book.id::text = request.book_id::text
  where request.id::text = p_request_id and public.is_active_staff_for_branch(book.library_id::text)
  for update of request;
  if v_req.id is null then raise exception 'Loan not found or branch access denied.'; end if;
  if v_req.status <> 'borrowed' then raise exception 'This item is not currently on loan.'; end if;
  v_overdue_days := greatest(0, ceil(extract(epoch from (now() - v_req.due_date)) / 86400));
  update public.borrow_requests set status = 'returned', return_date = now(), fine_amount = v_overdue_days * 10, return_confirmed_by = p_staff_name where id::text = p_request_id;
  perform public.release_copy_and_promote(v_req.book_id);
end;
$$;
revoke all on function public.confirm_return(text, text) from public, anon;
grant execute on function public.confirm_return(text, text) to authenticated;

create or replace function public.write_audit_log(
  p_action text,
  p_branch_id text default null,
  p_details jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare log_id uuid;
begin
  insert into public.audit_logs(actor_id, action, branch_id, details)
  values (auth.uid(), p_action, p_branch_id, coalesce(p_details, '{}'::jsonb))
  returning id into log_id;
  return log_id;
end;
$$;
grant execute on function public.write_audit_log(text, text, jsonb) to authenticated;

create or replace function public.auto_expire_pickups()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare r record; expired_count integer := 0;
begin
  for r in select id, book_id from public.borrow_requests
    where status = 'ready_for_pickup' and pickup_deadline <= now()
    for update skip locked
  loop
    update public.borrow_requests set status = 'expired'
    where id = r.id;
    perform public.release_copy_and_promote(r.book_id);
    expired_count := expired_count + 1;
  end loop;
  return expired_count;
end;
$$;
revoke all on function public.auto_expire_pickups() from public, anon, authenticated;
grant execute on function public.auto_expire_pickups() to service_role;

create extension if not exists pg_cron;
select cron.unschedule(jobid)
from cron.job
where jobname = 'shelf-expire-pickups';
select cron.schedule(
  'shelf-expire-pickups',
  '* * * * *',
  'select public.auto_expire_pickups();'
);