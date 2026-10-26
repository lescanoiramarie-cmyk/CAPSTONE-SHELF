-- Local bootstrap baseline for the pre-existing application schema.
--
-- The timestamped history begins with a compatibility migration that expects
-- these tables to exist. Keep application functions, triggers, policies, and
-- data in their timestamped migrations; this file only establishes the base
-- relations and their required types/constraints.

create extension if not exists pgcrypto;

create table public.libraries (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email_domain text,
  campus text,
  address text,
  lat double precision,
  lng double precision,
  hours text,
  status text default 'Open',
  is_sample_location boolean default false
);

create table public.books (
  id text primary key default ('BK-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8)),
  title text not null,
  author text not null,
  category text default 'General',
  isbn text,
  shelf_location text,
  library_id uuid references public.libraries(id) on delete set null,
  total_copies integer not null default 1,
  available_copies integer not null default 1,
  book_type text not null default 'library'
    check (book_type in ('library', 'personal')),
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

create table public.visitors (
  id text primary key default ('VIS-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8)),
  full_name varchar(255) not null,
  contact_number varchar(50),
  email text unique not null,
  address text,
  auth_user_id uuid unique references auth.users(id) on delete cascade,
  otp text,
  otp_expires_at timestamptz,
  otp_verified boolean default false,
  is_active boolean not null default true,
  qr_code text unique
    check (qr_code is null or qr_code ~ '^SHELF-QR-[0-9]{6}$'),
  registered_at timestamptz default now()
);

alter table public.books
  add constraint books_owner_visitor_id_fkey
  foreign key (owner_visitor_id) references public.visitors(id)
  on delete cascade not valid;

create table public.borrow_requests (
  id text primary key default ('REQ-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8)),
  book_id text references public.books(id) on delete set null,
  book_title text,
  visitor_id text references public.visitors(id) on delete set null,
  visitor_name text,
  status text not null default 'queued',
  request_date timestamptz default now(),
  pickup_deadline timestamptz,
  queue_position integer,
  borrow_date timestamptz,
  due_date timestamptz,
  return_date timestamptz,
  fine_amount numeric default 0,
  confirmed_by text,
  return_confirmed_by text
);

create table public.attendance_logs (
  id uuid primary key default gen_random_uuid(),
  visitor_id text references public.visitors(id) on delete set null,
  visitor_name varchar(255),
  library_id uuid references public.libraries(id) on delete cascade,
  time_in timestamptz default now(),
  checked_out_at timestamptz
);

create table public.announcements (
  id uuid primary key default gen_random_uuid(),
  library_id uuid references public.libraries(id) on delete set null,
  title text not null,
  message text not null,
  published boolean not null default true,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.visitor_feedback (
  id uuid primary key default gen_random_uuid(),
  visitor_id text references public.visitors(id) on delete set null,
  library_id uuid references public.libraries(id) on delete set null,
  visitor_name text not null,
  visitor_email text,
  category text not null default 'General',
  subject text not null,
  message text not null,
  status text not null default 'new'
    check (status in ('new', 'in_review', 'answered')),
  admin_reply text,
  replied_by text,
  replied_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.staff_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  full_name text not null,
  role text not null check (role in ('superadmin', 'subadmin')),
  library_id uuid references public.libraries(id) on delete set null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint staff_profiles_role_library_check
    check ((role = 'superadmin' and library_id is null) or role = 'subadmin')
);
