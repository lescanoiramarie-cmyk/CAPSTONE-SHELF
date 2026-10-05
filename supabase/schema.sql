-- ============================================================================
-- SHELF ILMS — Supabase schema
-- ----------------------------------------------------------------------------

create extension if not exists pgcrypto;
create schema if not exists extensions;
create extension if not exists postgis with schema extensions;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table if not exists libraries (
  id text primary key,
  name text not null,
  campus text,
  address text,
  lat double precision,
  lng double precision,
  hours text,
  status text default 'Open',
  is_sample_location boolean default false
);

do $$
declare
  postgis_schema text;
begin
  select nsp.nspname into postgis_schema
  from pg_extension ext
  join pg_namespace nsp on nsp.oid = ext.extnamespace
  where ext.extname = 'postgis';

  if postgis_schema is null then
    raise exception 'PostGIS must be installed to create library geography coordinates.';
  end if;

  execute format(
    'alter table public.libraries add column if not exists location %I.geography(Point, 4326)',
    postgis_schema
  );
  execute format(
    'update public.libraries set location = %1$I.st_setsrid(%1$I.st_makepoint(lng, lat), 4326)::%1$I.geography where location is null and lat between -90 and 90 and lng between -180 and 180',
    postgis_schema
  );
end;
$$;

create table if not exists books (
  id text primary key default ('BK-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8)),
  title text not null,
  author text not null,
  category text default 'General',
  isbn text,
  shelf_location text,
  library_id text references libraries(id) on delete set null,
  total_copies int not null default 1,
  available_copies int not null default 1,
  book_type text not null default 'library' check (book_type in ('library', 'personal')),
  is_public boolean not null default false,
  owner_visitor_id text,
  lending_enabled boolean not null default false,
  condition text,
  lending_period_days integer,
  handover_location text,
  handover_method text,
  handover_details text,
  summary text,
  cover_url text,
  updated_at timestamptz not null default now(),
  created_at timestamptz default now()
);

create table if not exists visitors (
  id text primary key default ('VIS-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8)),
  full_name text not null,
  contact_number text,
  email text unique not null,
  address text,
  auth_user_id uuid unique references auth.users(id) on delete cascade,
  otp text,
  otp_expires_at timestamptz,
  otp_verified boolean default false,
  is_active boolean not null default true,
  qr_code text unique check (qr_code is null or qr_code ~ '^SHELF-QR-[0-9]{6}$'),
  registered_at timestamptz default now()
);

create or replace function public.generate_visitor_qr_code()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  qr_value text;
begin
  perform pg_advisory_xact_lock(hashtext('public.visitors.qr_code'));
  loop
    qr_value := 'SHELF-QR-' || floor(random() * 900000 + 100000)::text;
    exit when not exists (
      select 1 from public.visitors where qr_code = qr_value
    );
  end loop;
  return qr_value;
end;
$$;
revoke all on function public.generate_visitor_qr_code() from public, anon, authenticated;

do $$
begin
  alter table public.books
    drop constraint if exists books_owner_visitor_id_fkey;
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'books'
      and column_name = 'owner_visitor_id'
      and data_type <> 'text'
  ) then
    alter table public.books
      alter column owner_visitor_id type text using owner_visitor_id::text;
  end if;
  alter table public.books
    add constraint books_owner_visitor_id_fkey
    foreign key (owner_visitor_id)
    references public.visitors(id) on delete cascade not valid;
end;
$$;

create table if not exists borrow_requests (
  id text primary key default ('REQ-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8)),
  book_id text references books(id) on delete set null,
  book_title text,
  visitor_id text references visitors(id) on delete set null,
  visitor_name text,
  status text not null default 'queued', -- queued | ready_for_pickup | borrowed | returned | cancelled | expired
  request_date timestamptz default now(),
  pickup_deadline timestamptz,
  queue_position int,
  borrow_date timestamptz,
  due_date timestamptz,
  return_date timestamptz,
  fine_amount numeric default 0,
  confirmed_by text,
  return_confirmed_by text
);

create table if not exists community_book_requests (
  id uuid primary key default gen_random_uuid(),
  book_id text not null references books(id) on delete cascade,
  book_title text not null,
  owner_visitor_id text not null references visitors(id) on delete cascade,
  owner_name text not null,
  requester_visitor_id text not null references visitors(id) on delete cascade,
  requester_name text not null,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected', 'borrowed', 'returned', 'cancelled')),
  request_date timestamptz not null default now(),
  approved_at timestamptz,
  rejected_at timestamptz,
  owner_response text,
  pickup_deadline timestamptz,
  borrow_date timestamptz,
  due_date timestamptz,
  return_date timestamptz,
  fine_amount numeric not null default 0,
  confirmed_by text,
  return_confirmed_by text
);

create table if not exists attendance_logs (
  id text primary key default ('ATT-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8)),
  visitor_id text references visitors(id) on delete set null,
  visitor_name text,
  library_id text references libraries(id),
  time_in timestamptz default now(),
  checked_out_at timestamptz
);

alter table attendance_logs
  add column if not exists checked_out_at timestamptz;

create table if not exists announcements (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  message text not null,
  published boolean not null default true,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists visitor_feedback (
  id uuid primary key default gen_random_uuid(),
  visitor_id text,
  library_id text,
  visitor_name text not null,
  visitor_email text,
  category text not null default 'General',
  subject text not null,
  message text not null,
  status text not null default 'new' check (status in ('new', 'in_review', 'answered')),
  admin_reply text,
  replied_by text,
  replied_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table visitor_feedback
  add column if not exists library_id text;

-- Existing RLS policies can depend on library_id and block its type upgrade.
-- The policy definitions are recreated below after the column is aligned.
do $$
declare
  dependent_policy text;
begin
  for dependent_policy in
    select distinct policy.polname
    from pg_policy policy
    join pg_depend dependency
      on dependency.classid = 'pg_policy'::regclass
     and dependency.objid = policy.oid
     and dependency.refclassid = 'pg_class'::regclass
     and dependency.refobjid = 'public.visitor_feedback'::regclass
    where policy.polrelid = 'public.visitor_feedback'::regclass
      and dependency.refobjsubid = (
        select attribute.attnum
        from pg_attribute attribute
        where attribute.attrelid = 'public.visitor_feedback'::regclass
          and attribute.attname = 'library_id'
          and not attribute.attisdropped
      )
  loop
    execute format(
      'drop policy %I on public.visitor_feedback',
      dependent_policy
    );
  end loop;
end;
$$;

do $$
declare
  visitor_id_type text;
  library_id_type text;
begin
  select format_type(attribute.atttypid, attribute.atttypmod)
    into visitor_id_type
    from pg_attribute attribute
   where attribute.attrelid = 'public.visitors'::regclass
     and attribute.attname = 'id'
     and not attribute.attisdropped;

  if visitor_id_type is null then
    raise exception 'Could not determine the type of visitors.id.';
  end if;

  select format_type(attribute.atttypid, attribute.atttypmod)
    into library_id_type
    from pg_attribute attribute
   where attribute.attrelid = 'public.libraries'::regclass
     and attribute.attname = 'id'
     and not attribute.attisdropped;

  if library_id_type is null then
    raise exception 'Could not determine the type of libraries.id.';
  end if;

  alter table public.visitor_feedback
    drop constraint if exists visitor_feedback_visitor_id_fkey;
  alter table public.visitor_feedback
    drop constraint if exists visitor_feedback_library_id_fkey;

  execute format(
    'alter table public.visitor_feedback alter column visitor_id type %1$s using visitor_id::text::%1$s',
    visitor_id_type
  );
  execute format(
    'alter table public.visitor_feedback alter column library_id type %1$s using library_id::text::%1$s',
    library_id_type
  );

  execute format(
    'alter table public.visitor_feedback add constraint visitor_feedback_visitor_id_fkey foreign key (visitor_id) references public.visitors(id) on delete set null'
  );
  execute format(
    'alter table public.visitor_feedback add constraint visitor_feedback_library_id_fkey foreign key (library_id) references public.libraries(id) on delete set null'
  );
end;
$$;

create index if not exists attendance_logs_branch_time_idx
  on attendance_logs (library_id, time_in desc);
create index if not exists visitor_feedback_branch_created_idx
  on visitor_feedback (library_id, created_at desc);
create index if not exists announcements_published_created_idx
  on announcements (published, created_at desc);

create table if not exists staff_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  full_name text not null,
  role text not null check (role in ('superadmin', 'subadmin')),
  library_id text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  check ((role = 'superadmin' and library_id is null) or role = 'subadmin')
);

do $$
declare
  library_id_type text;
begin
  select format_type(attribute.atttypid, attribute.atttypmod)
    into library_id_type
    from pg_attribute attribute
   where attribute.attrelid = 'public.libraries'::regclass
     and attribute.attname = 'id'
     and not attribute.attisdropped;

  if library_id_type is null then
    raise exception 'Could not determine the type of libraries.id.';
  end if;

  alter table public.staff_profiles
    drop constraint if exists staff_profiles_library_id_fkey;

  execute format(
    'alter table public.staff_profiles alter column library_id type %1$s using library_id::text::%1$s',
    library_id_type
  );
  execute format(
    'alter table public.staff_profiles add constraint staff_profiles_library_id_fkey foreign key (library_id) references public.libraries(id) on delete set null'
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Seed the library network (Tanauan City integrated network — sample coords,
-- swap in surveyed GPS coordinates for each real branch before go-live)
-- ---------------------------------------------------------------------------
insert into libraries (id, name, campus, address, lat, lng, hours, status, is_sample_location) values
  ('277829af-1475-47ae-9e26-4b64c68f54f4', 'BatStateU JPLPC – Malvar Campus Library', 'Malvar Campus', 'Batangas State University, JPLPC – Malvar Campus, Malvar, Batangas', 14.0672, 121.1597, '7:00 AM – 6:00 PM (Mon–Fri)', 'Open', true),
  ('00000000-0000-4000-8000-000000000002', 'Tanauan City Public Library', 'Tanauan City Hall Complex', 'P. Gomez St, Poblacion, Tanauan City, Batangas', 14.0860, 121.1497, '8:00 AM – 5:00 PM (Mon–Sat)', 'Open', true),
  ('bde57b8b-d3b8-4676-823e-7573f80d3a36', 'BatStateU Batangas City Main Campus Library', 'Batangas City (Main Campus)', 'Rizal Avenue Extension, Batangas City, Batangas', 13.7565, 121.0583, '8:00 AM – 5:00 PM (Mon–Fri)', 'Closed', true)
on conflict (id) do nothing;

do $$
declare
  postgis_schema text;
begin
  select nsp.nspname into postgis_schema
  from pg_extension ext
  join pg_namespace nsp on nsp.oid = ext.extnamespace
  where ext.extname = 'postgis';

  execute format(
    'update public.libraries set location = %1$I.st_setsrid(%1$I.st_makepoint(lng, lat), 4326)::%1$I.geography where location is null and lat between -90 and 90 and lng between -180 and 180',
    postgis_schema
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
-- This app has no server of its own — the browser talks directly to Supabase
-- using the public "anon" key, so these policies are intentionally permissive
-- (anyone with the anon key can read/write these operational tables). That's
-- an acceptable trade-off for a school-project deployment with no sensitive
-- personal data beyond what visitors themselves type in. Before handling
-- real personal data, tighten this — e.g. require `auth.role() = 'authenticated'`
-- for writes, or move admin-only writes behind a Supabase Edge Function that
-- uses the service_role key instead of the anon key.
alter table libraries enable row level security;
alter table books enable row level security;
alter table visitors enable row level security;
alter table borrow_requests enable row level security;
alter table attendance_logs enable row level security;
alter table announcements enable row level security;
alter table visitor_feedback enable row level security;
alter table staff_profiles enable row level security;

drop policy if exists "public read libraries" on libraries;
create policy "public read libraries" on libraries for select using (true);
drop policy if exists "public write libraries" on libraries;
create policy "public write libraries" on libraries for all using (true) with check (true);

drop policy if exists "public read books" on books;
create policy "public read books" on books for select using (
  book_type <> 'personal'
  or is_public
  or exists (
    select 1
    from visitors visitor
    where visitor.id = books.owner_visitor_id
      and visitor.auth_user_id = auth.uid()
  )
);
drop policy if exists "public write books" on books;

-- Visitors: only non-sensitive columns are ever selected from the client;
-- OTP verification remains server-side.
drop policy if exists "public read visitors" on visitors;
create policy "public read visitors" on visitors for select using (true);
drop policy if exists "public write visitors" on visitors;
create policy "public write visitors" on visitors for all using (true) with check (true);

drop policy if exists "public read borrow_requests" on borrow_requests;
create policy "public read borrow_requests" on borrow_requests for select using (true);
drop policy if exists "public write borrow_requests" on borrow_requests;
create policy "public write borrow_requests" on borrow_requests for all using (true) with check (true);

drop policy if exists "public read attendance_logs" on attendance_logs;
create policy "public read attendance_logs" on attendance_logs for select using (true);
drop policy if exists "public write attendance_logs" on attendance_logs;
create policy "public write attendance_logs" on attendance_logs for all using (true) with check (true);

drop policy if exists "public read announcements" on announcements;
create policy "public read announcements" on announcements for select using (published = true);
drop policy if exists "admin manage announcements" on announcements;
create policy "admin manage announcements" on announcements for all
  using ((auth.jwt() -> 'app_metadata' ->> 'role') in ('superadmin', 'subadmin'))
  with check ((auth.jwt() -> 'app_metadata' ->> 'role') in ('superadmin', 'subadmin'));

drop policy if exists "public submit feedback" on visitor_feedback;
create policy "public submit feedback" on visitor_feedback for insert with check (true);
drop policy if exists "admin read feedback" on visitor_feedback;
create policy "admin read feedback" on visitor_feedback for select
  using (
    auth.jwt() -> 'app_metadata' ->> 'role' = 'superadmin'
    or exists (
      select 1 from staff_profiles staff
      where staff.id = auth.uid() and staff.role = 'subadmin'
        and staff.is_active and staff.library_id = visitor_feedback.library_id
    )
  );
drop policy if exists "admin manage feedback" on visitor_feedback;
create policy "admin manage feedback" on visitor_feedback for update
  using (
    auth.jwt() -> 'app_metadata' ->> 'role' = 'superadmin'
    or exists (
      select 1 from staff_profiles staff
      where staff.id = auth.uid() and staff.role = 'subadmin'
        and staff.is_active and staff.library_id = visitor_feedback.library_id
    )
  )
  with check (
    auth.jwt() -> 'app_metadata' ->> 'role' = 'superadmin'
    or exists (
      select 1 from staff_profiles staff
      where staff.id = auth.uid() and staff.role = 'subadmin'
        and staff.is_active and staff.library_id = visitor_feedback.library_id
    )
  );

drop policy if exists "staff read own profile" on staff_profiles;
create policy "staff read own profile" on staff_profiles for select
  using (auth.uid() = id or auth.jwt() -> 'app_metadata' ->> 'role' = 'superadmin');

create or replace function toggle_attendance(p_qr text, p_library_id text)
returns table(log_id text, visitor_id text, visitor_name text, action text)
as $$
declare
  v_visitor visitors%rowtype;
  v_log attendance_logs%rowtype;
  v_action text;
begin
  select * into v_visitor from visitors where qr_code = trim(p_qr) for update;
  if v_visitor.id is null then
    raise exception 'QR code not recognized. Please check the pass and try again.';
  end if;

  select * into v_log from attendance_logs as attendance
    where attendance.visitor_id = v_visitor.id
      and attendance.library_id = p_library_id
      and attendance.time_in::date = current_date
      and attendance.checked_out_at is null
    order by attendance.time_in desc
    limit 1 for update;

  if v_log.id is null then
    insert into attendance_logs (visitor_id, visitor_name, library_id)
      values (v_visitor.id, v_visitor.full_name, p_library_id)
      returning * into v_log;
    v_action := 'checked_in';
  else
    update attendance_logs as attendance set checked_out_at = now()
      where attendance.id = v_log.id
      returning * into v_log;
    v_action := 'checked_out';
  end if;

  return query select v_log.id, v_visitor.id, v_visitor.full_name, v_action;
end;
$$ language plpgsql security definer;

create or replace function get_visitor_feedback_replies(p_visitor_id text, p_email text)
returns table(id uuid, subject text, admin_reply text, replied_at timestamptz)
as $$
begin
  if not exists (
    select 1 from visitors
    where visitors.id::text = trim(p_visitor_id)
      and lower(visitors.email) = lower(trim(p_email))
  ) then
    raise exception 'Visitor identity could not be verified.';
  end if;

  return query
    select feedback.id, feedback.subject, feedback.admin_reply, feedback.replied_at
    from visitor_feedback feedback
    where feedback.visitor_id::text = trim(p_visitor_id)
      and feedback.admin_reply is not null
    order by feedback.replied_at desc;
end;
$$ language plpgsql security definer;

revoke all on function get_visitor_feedback_replies(text, text) from public;
grant execute on function get_visitor_feedback_replies(text, text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Realtime — let the app's Postgres Changes subscription receive updates.
-- If this errors saying the table is already a member, that's fine — it
-- means Realtime is already on for it (check Database → Replication too).
-- ---------------------------------------------------------------------------
do $$
declare
  table_name text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    raise exception 'Publication supabase_realtime does not exist.';
  end if;

  foreach table_name in array array[
    'books', 'libraries', 'visitors', 'borrow_requests',
    'attendance_logs', 'announcements', 'visitor_feedback'
  ] loop
    if not exists (
      select 1
        from pg_publication_tables publication_table
       where publication_table.pubname = 'supabase_realtime'
         and publication_table.schemaname = 'public'
         and publication_table.tablename = table_name
    ) then
      execute format('alter publication supabase_realtime add table public.%I', table_name);
    end if;
  end loop;
end;
$$;

-- ============================================================================
-- RPC functions (SECURITY DEFINER) — these hold the atomic business logic
-- (queue promotion, pickup expiry, OTP/login checks) so it can't race between
-- two concurrent requests.
-- ============================================================================

drop function if exists public.verify_visitor_otp(text, text);
drop function if exists public.find_visitor_by_qr(text);
drop function if exists public.scan_attendance(text, text);

create or replace function public.register_visitor(
  p_auth_user_id uuid,
  p_full_name text,
  p_contact_number text,
  p_email text,
  p_address text
) returns table(visitor_id text) as $$
declare
  auth_email text;
  auth_role text;
  visitor_id_value text;
begin
  select lower(account.email), account.raw_user_meta_data ->> 'role'
    into auth_email, auth_role
  from auth.users account
  where account.id = p_auth_user_id;

  if auth_email is null
    or auth_email <> lower(trim(p_email))
    or auth_role is distinct from 'visitor'
  then
    raise exception 'A matching visitor authentication account is required.';
  end if;

  insert into public.visitors (
    full_name, contact_number, email, address, otp_verified, qr_code, auth_user_id
  ) values (
    trim(p_full_name),
    nullif(trim(p_contact_number), ''),
    auth_email,
    nullif(trim(p_address), ''),
    false,
    public.generate_visitor_qr_code(),
    p_auth_user_id
  )
  on conflict (email) do update
  set auth_user_id = excluded.auth_user_id,
      full_name = excluded.full_name,
      contact_number = excluded.contact_number,
      address = excluded.address,
      qr_code = coalesce(public.visitors.qr_code, excluded.qr_code)
  where public.visitors.auth_user_id is null
     or public.visitors.auth_user_id = excluded.auth_user_id
  returning id into visitor_id_value;

  if visitor_id_value is null then
    raise exception 'This email is already linked to another visitor account.';
  end if;

  return query select visitor_id_value;
end;
$$ language plpgsql security definer;
revoke all on function public.register_visitor(uuid, text, text, text, text) from public;
grant execute on function public.register_visitor(uuid, text, text, text, text) to anon, authenticated;

create or replace function resend_otp(p_visitor_id text) returns text as $$
declare v_otp text;
begin
  v_otp := lpad(floor(random() * 900000 + 100000)::text, 6, '0');
  update visitors set otp = v_otp where id = p_visitor_id;
  return v_otp;
end;
$$ language plpgsql security definer;

create or replace function verify_visitor_otp(p_visitor_id text, p_code text)
returns table(id text, full_name text, email text, qr_code text) as $$
declare v_qr text;
begin
  if not exists (select 1 from visitors where visitors.id = p_visitor_id) then
    raise exception 'Registration not found. Please register again.';
  end if;
  if not exists (select 1 from visitors where visitors.id = p_visitor_id and visitors.otp = p_code) then
    raise exception 'Incorrect OTP code. Please try again.';
  end if;
  v_qr := public.generate_visitor_qr_code();
  update visitors set otp_verified = true, qr_code = v_qr, otp = null where visitors.id = p_visitor_id;
  return query select visitors.id, visitors.full_name, visitors.email, visitors.qr_code
    from visitors where visitors.id = p_visitor_id;
end;
$$ language plpgsql security definer;
grant execute on function public.verify_visitor_otp(text, text) to anon, authenticated;

create or replace function find_visitor_by_qr(p_qr text)
returns table(id text, full_name text, email text, qr_code text) as $$
begin
  return query select visitors.id, visitors.full_name, visitors.email, visitors.qr_code
    from visitors where visitors.qr_code = trim(p_qr);
end;
$$ language plpgsql security definer;
grant execute on function public.find_visitor_by_qr(text) to anon, authenticated;

create or replace function scan_attendance(p_qr text, p_library_id text)
returns table(log_id text, visitor_id text, visitor_name text) as $$
declare v record;
declare v_log_id text;
begin
  select * into v from visitors where visitors.qr_code = trim(p_qr);
  if v.id is null then
    raise exception 'QR code not recognized. Please check the pass and try again.';
  end if;
  insert into attendance_logs (visitor_id, visitor_name, library_id)
    values (v.id, v.full_name, p_library_id)
    returning attendance_logs.id into v_log_id;
  return query select v_log_id, v.id, v.full_name;
end;
$$ language plpgsql security definer;
grant execute on function public.scan_attendance(text, text) to anon, authenticated;

-- Internal helper: give back a copy and promote the next queued visitor.
create or replace function release_copy_and_promote(p_book_id text)
returns void as $$
declare v_next borrow_requests%rowtype;
begin
  update books set available_copies = available_copies + 1 where id = p_book_id;

  select * into v_next from borrow_requests
    where book_id = p_book_id and status = 'queued'
    order by queue_position asc
    limit 1;

  if v_next.id is not null then
    update borrow_requests
      set status = 'ready_for_pickup', pickup_deadline = now() + interval '24 hours', queue_position = null
      where id = v_next.id;

    update books set available_copies = available_copies - 1 where id = p_book_id;

    update borrow_requests br
      set queue_position = sub.rn
      from (
        select id, row_number() over (order by queue_position asc) as rn
        from borrow_requests
        where book_id = p_book_id and status = 'queued'
      ) sub
      where br.id = sub.id;
  end if;
end;
$$ language plpgsql security definer;

create or replace function request_borrow(p_visitor_id text, p_book_id text)
returns borrow_requests as $$
declare
  v_book books%rowtype;
  v_visitor visitors%rowtype;
  v_req borrow_requests%rowtype;
  v_queue_count int;
begin
  select * into v_book from books where id = p_book_id for update;
  select * into v_visitor from visitors where id = p_visitor_id;
  if v_book.id is null or v_visitor.id is null then
    raise exception 'Invalid borrow request.';
  end if;

  if exists (
    select 1 from borrow_requests
    where visitor_id = p_visitor_id and book_id = p_book_id
      and status in ('queued', 'ready_for_pickup', 'borrowed')
  ) then
    raise exception 'You already have an active request or loan for this title.';
  end if;

  if v_book.available_copies > 0 then
    update books set available_copies = available_copies - 1 where id = p_book_id;
    insert into borrow_requests (book_id, book_title, visitor_id, visitor_name, status, pickup_deadline)
      values (p_book_id, v_book.title, p_visitor_id, v_visitor.full_name, 'ready_for_pickup', now() + interval '24 hours')
      returning * into v_req;
  else
    select count(*) into v_queue_count from borrow_requests where book_id = p_book_id and status = 'queued';
    insert into borrow_requests (book_id, book_title, visitor_id, visitor_name, status, queue_position)
      values (p_book_id, v_book.title, p_visitor_id, v_visitor.full_name, 'queued', v_queue_count + 1)
      returning * into v_req;
  end if;

  return v_req;
end;
$$ language plpgsql security definer;

create or replace function cancel_borrow_request(p_request_id text, p_reason text default 'cancelled')
returns void as $$
declare v_req borrow_requests%rowtype;
begin
  select * into v_req from borrow_requests where id = p_request_id;
  if v_req.id is null then
    raise exception 'Request not found.';
  end if;
  if v_req.status not in ('queued', 'ready_for_pickup') then
    raise exception 'This request can no longer be cancelled.';
  end if;

  update borrow_requests set status = p_reason where id = p_request_id;

  if v_req.status = 'ready_for_pickup' then
    perform release_copy_and_promote(v_req.book_id);
  elsif v_req.status = 'queued' then
    update borrow_requests br
      set queue_position = sub.rn
      from (
        select id, row_number() over (order by queue_position asc) as rn
        from borrow_requests
        where book_id = v_req.book_id and status = 'queued'
      ) sub
      where br.id = sub.id;
  end if;
end;
$$ language plpgsql security definer;

drop function if exists public.auto_expire_pickups();

create function auto_expire_pickups()
returns int as $$
declare v_count int := 0;
declare r record;
begin
  for r in select id from borrow_requests where status = 'ready_for_pickup' and pickup_deadline < now()
  loop
    perform cancel_borrow_request(r.id, 'expired');
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$ language plpgsql security definer;
grant execute on function public.auto_expire_pickups() to anon, authenticated;

create or replace function confirm_pickup(p_request_id text, p_staff_name text)
returns void as $$
declare v_req borrow_requests%rowtype;
begin
  select * into v_req from borrow_requests where id = p_request_id;
  if v_req.id is null then raise exception 'Request not found.'; end if;
  if v_req.status <> 'ready_for_pickup' then raise exception 'This request is not ready for pickup.'; end if;
  update borrow_requests
    set status = 'borrowed', borrow_date = now(), due_date = now() + interval '7 days', confirmed_by = p_staff_name
    where id = p_request_id;
end;
$$ language plpgsql security definer;

create or replace function confirm_return(p_request_id text, p_staff_name text)
returns void as $$
declare
  v_req borrow_requests%rowtype;
  v_overdue_days int;
  v_fine numeric;
begin
  select * into v_req from borrow_requests where id = p_request_id;
  if v_req.id is null then raise exception 'Request not found.'; end if;
  if v_req.status <> 'borrowed' then raise exception 'This item is not currently on loan.'; end if;

  v_overdue_days := greatest(0, ceil(extract(epoch from (now() - v_req.due_date)) / 86400));
  v_fine := v_overdue_days * 10;

  update borrow_requests
    set status = 'returned', return_date = now(), fine_amount = v_fine, return_confirmed_by = p_staff_name
    where id = p_request_id;

  perform release_copy_and_promote(v_req.book_id);
end;
$$ language plpgsql security definer;
