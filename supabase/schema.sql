-- ============================================================================
-- SHELF ILMS — Supabase schema
-- ----------------------------------------------------------------------------
-- Run this once in your Supabase project's SQL Editor (Dashboard → SQL Editor
-- → New Query → paste this whole file → Run). It creates the tables, enables
-- Row Level Security, and defines the RPC functions that keep the borrow/
-- queue logic atomic (safe from race conditions between two visitors).
-- ============================================================================

create extension if not exists pgcrypto;

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
  summary text,
  cover_url text,
  created_at timestamptz default now()
);

create table if not exists visitors (
  id text primary key default ('VIS-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8)),
  full_name text not null,
  contact_number text,
  email text unique not null,
  address text,
  password text not null, -- ⚠ plaintext for capstone-demo scope, see note at bottom of file
  otp text,
  otp_verified boolean default false,
  qr_code text unique,
  registered_at timestamptz default now()
);

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

create table if not exists attendance_logs (
  id text primary key default ('ATT-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8)),
  visitor_id text references visitors(id) on delete set null,
  visitor_name text,
  library_id text references libraries(id),
  time_in timestamptz default now()
);

-- ---------------------------------------------------------------------------
-- Seed the library network (Tanauan City integrated network — sample coords,
-- swap in surveyed GPS coordinates for each real branch before go-live)
-- ---------------------------------------------------------------------------
insert into libraries (id, name, campus, address, lat, lng, hours, status, is_sample_location) values
  ('LIB-01', 'BatStateU JPLPC – Malvar Campus Library', 'Malvar Campus', 'Batangas State University, JPLPC – Malvar Campus, Malvar, Batangas', 14.0672, 121.1597, '7:00 AM – 6:00 PM (Mon–Fri)', 'Open', true),
  ('LIB-02', 'Tanauan City Public Library', 'Tanauan City Hall Complex', 'P. Gomez St, Poblacion, Tanauan City, Batangas', 14.0860, 121.1497, '8:00 AM – 5:00 PM (Mon–Sat)', 'Open', true),
  ('LIB-03', 'BatStateU Batangas City Main Campus Library', 'Batangas City (Main Campus)', 'Rizal Avenue Extension, Batangas City, Batangas', 13.7565, 121.0583, '8:00 AM – 5:00 PM (Mon–Fri)', 'Closed', true)
on conflict (id) do nothing;

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

drop policy if exists "public read libraries" on libraries;
create policy "public read libraries" on libraries for select using (true);
drop policy if exists "public write libraries" on libraries;
create policy "public write libraries" on libraries for all using (true) with check (true);

drop policy if exists "public read books" on books;
create policy "public read books" on books for select using (true);
drop policy if exists "public write books" on books;
create policy "public write books" on books for all using (true) with check (true);

-- Visitors: only non-sensitive columns are ever selected from the client
-- (see mapVisitor() in src/data/store.js) — password/otp checks happen
-- server-side inside the SECURITY DEFINER functions below, not via a
-- direct table select, so a public select policy here does not leak them
-- through the normal app flow. Still, avoid `select *` on this table.
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

-- ---------------------------------------------------------------------------
-- Realtime — let the app's Postgres Changes subscription receive updates.
-- If this errors saying the table is already a member, that's fine — it
-- means Realtime is already on for it (check Database → Replication too).
-- ---------------------------------------------------------------------------
alter publication supabase_realtime add table books, libraries, visitors, borrow_requests, attendance_logs;

-- ============================================================================
-- RPC functions (SECURITY DEFINER) — these hold the atomic business logic
-- (queue promotion, pickup expiry, OTP/login checks) so it can't race between
-- two concurrent requests, and so visitor passwords/OTPs are checked
-- server-side rather than fetched to the browser.
-- ============================================================================

create or replace function register_visitor(
  p_full_name text, p_contact_number text, p_email text, p_address text, p_password text
) returns table(visitor_id text, otp text) as $$
declare
  v_id text;
  v_otp text;
begin
  if exists (select 1 from visitors where lower(email) = lower(p_email)) then
    raise exception 'An account with this email already exists. Please log in instead.';
  end if;
  v_otp := lpad(floor(random() * 900000 + 100000)::text, 6, '0');
  insert into visitors (full_name, contact_number, email, address, password, otp, otp_verified)
  values (trim(p_full_name), trim(p_contact_number), trim(p_email), trim(p_address), p_password, v_otp, false)
  returning id into v_id;
  return query select v_id, v_otp;
end;
$$ language plpgsql security definer;

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
  v_qr := 'SHELF-QR-' || floor(random() * 900000 + 100000)::text;
  update visitors set otp_verified = true, qr_code = v_qr, otp = null where visitors.id = p_visitor_id;
  return query select visitors.id, visitors.full_name, visitors.email, visitors.qr_code
    from visitors where visitors.id = p_visitor_id;
end;
$$ language plpgsql security definer;

create or replace function login_visitor(p_identifier text, p_password text)
returns table(id text, full_name text, email text, qr_code text) as $$
declare v record;
begin
  select * into v from visitors
    where lower(visitors.email) = lower(p_identifier) or visitors.qr_code = p_identifier
    limit 1;
  if v.id is null then
    raise exception 'No account found with that email or QR pass ID. Please register first.';
  end if;
  if not v.otp_verified then
    raise exception 'Please verify your OTP code before logging in.';
  end if;
  if v.qr_code is distinct from p_identifier and v.password <> p_password then
    raise exception 'Incorrect password.';
  end if;
  return query select v.id, v.full_name, v.email, v.qr_code;
end;
$$ language plpgsql security definer;

create or replace function find_visitor_by_qr(p_qr text)
returns table(id text, full_name text, email text, qr_code text) as $$
begin
  return query select visitors.id, visitors.full_name, visitors.email, visitors.qr_code
    from visitors where visitors.qr_code = trim(p_qr);
end;
$$ language plpgsql security definer;

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

create or replace function auto_expire_pickups()
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

-- ============================================================================
-- ⚠ Security note (read before a real-world launch, not just a demo/defense):
-- Visitor passwords are stored as plain text in this schema to keep the
-- capstone scope manageable. Before handling real members' data, switch to
-- Supabase Auth (supabase.auth.signUp / signInWithPassword) for visitors, or
-- at minimum hash passwords with pgcrypto's crypt()/gen_salt() inside
-- register_visitor/login_visitor instead of comparing them raw.
-- ============================================================================
