-- Repair Auth visitor IDs, library geography, and atomic inventory edits.

create schema if not exists extensions;
create extension if not exists postgis with schema extensions;

do $$
declare
  postgis_schema text;
begin
  select nsp.nspname into postgis_schema
  from pg_extension ext
  join pg_namespace nsp on nsp.oid = ext.extnamespace
  where ext.extname = 'postgis';

  if postgis_schema is null then
    raise exception 'PostGIS must be installed to add library geography coordinates.';
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

alter table public.books
  add column if not exists book_type text not null default 'library',
  add column if not exists owner_visitor_id text,
  add column if not exists lending_enabled boolean not null default false,
  add column if not exists condition text,
  add column if not exists lending_period_days integer,
  add column if not exists handover_location text,
  add column if not exists handover_method text,
  add column if not exists handover_details text,
  add column if not exists updated_at timestamptz not null default now();
alter table public.visitors
  add column if not exists auth_user_id uuid unique references auth.users(id) on delete cascade,
  add column if not exists otp_expires_at timestamptz,
  add column if not exists is_active boolean not null default true;

create table if not exists public.community_book_requests (
  id uuid primary key default gen_random_uuid(),
  book_id text not null references public.books(id) on delete cascade,
  book_title text not null,
  owner_visitor_id text not null references public.visitors(id) on delete cascade,
  owner_name text not null,
  requester_visitor_id text not null references public.visitors(id) on delete cascade,
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
create index if not exists community_book_requests_book_status_idx
  on public.community_book_requests (book_id, status);

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'books'
      and column_name = 'owner_visitor_id' and data_type <> 'text'
  ) then
    alter table public.books
      drop constraint if exists books_owner_visitor_id_fkey;
    alter table public.books
      alter column owner_visitor_id type text using owner_visitor_id::text;
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'books_owner_visitor_id_fkey'
      and conrelid = 'public.books'::regclass
  ) then
    alter table public.books
      add constraint books_owner_visitor_id_fkey
      foreign key (owner_visitor_id) references public.visitors(id)
      on delete cascade not valid;
  end if;

  if to_regclass('public.community_book_requests') is not null then
    alter table public.community_book_requests
      drop constraint if exists community_book_requests_book_id_fkey,
      drop constraint if exists community_book_requests_owner_visitor_id_fkey,
      drop constraint if exists community_book_requests_requester_visitor_id_fkey;

    if exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'community_book_requests'
        and column_name = 'book_id' and data_type <> 'text'
    ) then
      alter table public.community_book_requests
        alter column book_id type text using book_id::text;
    end if;
    if exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'community_book_requests'
        and column_name = 'owner_visitor_id' and data_type <> 'text'
    ) then
      alter table public.community_book_requests
        alter column owner_visitor_id type text using owner_visitor_id::text;
    end if;
    if exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'community_book_requests'
        and column_name = 'requester_visitor_id' and data_type <> 'text'
    ) then
      alter table public.community_book_requests
        alter column requester_visitor_id type text using requester_visitor_id::text;
    end if;

    alter table public.community_book_requests
      add constraint community_book_requests_book_id_fkey
      foreign key (book_id) references public.books(id) on delete cascade not valid,
      add constraint community_book_requests_owner_visitor_id_fkey
      foreign key (owner_visitor_id) references public.visitors(id) on delete cascade not valid,
      add constraint community_book_requests_requester_visitor_id_fkey
      foreign key (requester_visitor_id) references public.visitors(id) on delete cascade not valid;
  end if;
end;
$$;

create or replace function public.set_book_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := greatest(
    clock_timestamp(),
    old.updated_at + interval '1 microsecond'
  );
  return new;
end;
$$;

drop trigger if exists set_book_updated_at on public.books;
create trigger set_book_updated_at
  before update on public.books
  for each row execute function public.set_book_updated_at();

create or replace function public.enforce_book_copy_inventory()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  active_allocations integer := 0;
  community_allocations integer := 0;
begin
  select count(*)::integer into active_allocations
  from public.borrow_requests request
  where request.book_id = new.id
    and request.status in ('ready_for_pickup', 'borrowed')
    and request.return_date is null;

  select count(*)::integer into community_allocations
  from public.community_book_requests request
  where request.book_id = new.id
    and request.status = 'borrowed'
    and request.return_date is null;
  active_allocations := active_allocations + community_allocations;

  if new.total_copies < active_allocations
    or new.available_copies < 0
    or new.available_copies > new.total_copies - active_allocations
  then
    raise exception using
      errcode = '23514',
      message = format(
        'INVENTORY_CONFLICT: copy totals must preserve %s outstanding allocations.',
        active_allocations
      );
  end if;

  return new;
end;
$$;
revoke all on function public.enforce_book_copy_inventory() from public, anon, authenticated;

drop trigger if exists enforce_book_copy_inventory on public.books;
create trigger enforce_book_copy_inventory
  before update of total_copies, available_copies on public.books
  for each row execute function public.enforce_book_copy_inventory();

-- Inventory updates must use the version-checked RPC; the trigger above also
-- guards copy arithmetic for other privileged SQL update paths.
revoke update on public.books from anon, authenticated;

-- Keep visitor IDs as the text VIS-* values generated by visitors.id.
drop function if exists public.register_visitor(text, text, text, text, text);
drop function if exists public.login_visitor(text, text);
do $$
begin
  if to_regclass('public.community_due_date_notifications') is not null then
    alter table public.community_due_date_notifications
      drop constraint if exists community_due_date_notifications_visitor_id_fkey;

    if exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'community_due_date_notifications'
        and column_name = 'visitor_id'
        and data_type <> 'text'
    ) then
      alter table public.community_due_date_notifications
        alter column visitor_id type text using visitor_id::text;
    end if;

    alter table public.community_due_date_notifications
      add constraint community_due_date_notifications_visitor_id_fkey
      foreign key (visitor_id) references public.visitors(id)
      on delete cascade not valid;
  end if;
end;
$$;

drop function if exists public.register_visitor(uuid, text, text, text, text);
drop function if exists public.register_visitor(uuid, text, text, text, text, text);
create function public.register_visitor(
  p_auth_user_id uuid,
  p_full_name text,
  p_contact_number text,
  p_email text,
  p_address text,
  p_registration_nonce text
)
returns table(visitor_id text)
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  auth_metadata jsonb;
  auth_email text;
  visitor_id_value text;
begin
  select lower(account.email), account.raw_user_meta_data
    into auth_email, auth_metadata
  from auth.users account
  where account.id = p_auth_user_id;

  if auth_email is null
    or auth_email <> lower(trim(p_email))
    or auth_metadata ->> 'role' is distinct from 'visitor'
    or auth_metadata ->> 'registration_nonce' is distinct from p_registration_nonce
    or auth_metadata ->> 'full_name' is distinct from trim(p_full_name)
    or auth_metadata ->> 'contact_number' is distinct from nullif(trim(p_contact_number), '')
    or auth_metadata ->> 'address' is distinct from nullif(trim(p_address), '')
  then
    raise exception 'A matching visitor registration proof is required.';
  end if;

  select visitor.id into visitor_id_value
  from public.visitors visitor
  where visitor.auth_user_id = p_auth_user_id
    and lower(visitor.email) = auth_email;

  if visitor_id_value is null then
    raise exception 'The visitor profile was not created by the Auth trigger.';
  end if;

  return query select visitor_id_value;
end;
$$;
revoke all on function public.register_visitor(uuid, text, text, text, text, text) from public;
grant execute on function public.register_visitor(uuid, text, text, text, text, text)
  to anon, authenticated;

-- This historical function was declared with UUID visitor IDs even though
-- both visitors.id and the application contract use text VIS-* identifiers.
drop function if exists public.fetch_my_community_book_requests(uuid);
drop function if exists public.fetch_my_community_book_requests(text);
create function public.fetch_my_community_book_requests(p_requester_visitor_id text)
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
  return_confirmed_by text
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if nullif(trim(p_requester_visitor_id), '') is null then
    raise exception 'Requester visitor ID is required.';
  end if;

  return query
  select request.id, request.book_id, request.book_title,
         request.owner_visitor_id, request.owner_name,
         request.requester_visitor_id, request.requester_name,
         request.status, request.request_date, request.approved_at,
         request.rejected_at, request.owner_response,
         request.pickup_deadline, request.borrow_date, request.due_date,
         request.return_date, request.fine_amount, request.confirmed_by,
         request.return_confirmed_by
  from public.community_book_requests request
  where request.requester_visitor_id = p_requester_visitor_id
  order by request.request_date desc;
end;
$$;
revoke all on function public.fetch_my_community_book_requests(text) from public;
grant execute on function public.fetch_my_community_book_requests(text)
  to anon, authenticated, service_role;

-- Replace the broken UUID overloads on installations where the earlier
-- inventory migration was already applied.
drop function if exists public.add_personal_book(
  uuid, text, text, text, text, text, text, integer, text, text, boolean, integer
);
drop function if exists public.add_personal_book(
  text, text, text, text, text, text, text, integer, text, text, boolean, integer
);
drop function if exists public.add_personal_book(
  uuid, text, text, text, text, text, text, integer, text, text, boolean
);
drop function if exists public.add_personal_book(
  text, text, text, text, text, text, text, integer, text, text, boolean
);

create function public.add_personal_book(
  p_visitor_id text,
  p_title text,
  p_author text,
  p_category text,
  p_isbn text,
  p_summary text,
  p_condition text,
  p_lending_period_days integer,
  p_handover_method text,
  p_handover_details text,
  p_lending_enabled boolean
)
returns public.books
language plpgsql
security definer
set search_path = public
as $$
declare
  book_row public.books%rowtype;
begin
  if auth.uid() is null or not exists (
    select 1 from public.visitors visitor
    where visitor.id = p_visitor_id
      and visitor.auth_user_id = auth.uid()
      and visitor.otp_verified
      and visitor.is_active
  ) then
    raise exception 'The authenticated, verified visitor account could not be found.';
  end if;
  if nullif(trim(p_title), '') is null or nullif(trim(p_author), '') is null then
    raise exception 'Book title and author are required.';
  end if;

  insert into public.books (
    title, author, category, isbn, summary, book_type, owner_visitor_id,
    lending_enabled, condition, lending_period_days, handover_method,
    handover_details, total_copies, available_copies
  ) values (
    trim(p_title), trim(p_author), nullif(trim(p_category), ''),
    nullif(trim(p_isbn), ''), nullif(trim(p_summary), ''),
    'personal', p_visitor_id, coalesce(p_lending_enabled, false),
    nullif(trim(p_condition), ''), p_lending_period_days,
    nullif(trim(p_handover_method), ''), nullif(trim(p_handover_details), ''),
    1, 1
  )
  returning * into book_row;
  return book_row;
end;
$$;
revoke all on function public.add_personal_book(
  text, text, text, text, text, text, text, integer, text, text, boolean
) from public;
grant execute on function public.add_personal_book(
  text, text, text, text, text, text, text, integer, text, text, boolean
) to authenticated;

create function public.add_personal_book(
  p_visitor_id text,
  p_title text,
  p_author text,
  p_category text,
  p_isbn text,
  p_summary text,
  p_condition text,
  p_lending_period_days integer,
  p_handover_method text,
  p_handover_details text,
  p_lending_enabled boolean,
  p_total_copies integer
)
returns public.books
language plpgsql
security definer
set search_path = public
as $$
declare
  book_row public.books%rowtype;
begin
  if p_total_copies is null or p_total_copies < 1 then
    raise exception 'Copy count must be a whole number of at least 1.';
  end if;
  book_row := public.add_personal_book(
    p_visitor_id, p_title, p_author, p_category, p_isbn, p_summary,
    p_condition, p_lending_period_days, p_handover_method,
    p_handover_details, p_lending_enabled
  );
  update public.books
  set total_copies = p_total_copies, available_copies = p_total_copies
  where id = book_row.id and book_type = 'personal'
    and owner_visitor_id = p_visitor_id;
  book_row.total_copies := p_total_copies;
  book_row.available_copies := p_total_copies;
  return book_row;
end;
$$;
revoke all on function public.add_personal_book(
  text, text, text, text, text, text, text, integer, text, text, boolean, integer
) from public;
grant execute on function public.add_personal_book(
  text, text, text, text, text, text, text, integer, text, text, boolean, integer
) to authenticated;

create or replace function public.update_inventory_book(
  p_book_id text,
  p_expected_updated_at timestamptz,
  p_patch jsonb
)
returns public.books
language plpgsql
security definer
set search_path = public
as $$
declare
  book_row public.books%rowtype;
  new_total integer;
  borrowed_count integer := 0;
  community_borrowed_count integer := 0;
  allocated_count integer := 0;
  new_library_id text;
begin
  if p_expected_updated_at is null
    or p_patch is null
    or jsonb_typeof(p_patch) is distinct from 'object'
  then
    raise exception 'INVENTORY_CONFLICT: reload this book before saving.';
  end if;

  select * into book_row
  from public.books
  where id = p_book_id
  for update;

  if not found
    or book_row.updated_at is distinct from p_expected_updated_at
  then
    raise exception using
      errcode = '40001',
      message = 'INVENTORY_CONFLICT: this book changed or was removed. Reload it before saving.';
  end if;

  if not public.is_active_staff_for_branch(book_row.library_id) then
    raise exception using errcode = '42501', message = 'You cannot edit this branch inventory.';
  end if;

  new_library_id := case
    when p_patch ? 'library_id' then nullif(p_patch ->> 'library_id', '')
    else book_row.library_id
  end;
  if new_library_id is not null
    and not public.is_active_staff_for_branch(new_library_id)
  then
    raise exception using errcode = '42501', message = 'You cannot move this book to that branch.';
  end if;

  new_total := case
    when p_patch ? 'total_copies' then (p_patch ->> 'total_copies')::integer
    else book_row.total_copies
  end;
  if new_total is null or new_total < 1 then
    raise exception 'Total copies must be a positive whole number.';
  end if;

  select count(*)::integer into borrowed_count
  from public.borrow_requests request
  where request.book_id = p_book_id
    and request.status = 'borrowed'
    and request.return_date is null;
  select count(*)::integer into community_borrowed_count
  from public.community_book_requests request
  where request.book_id = p_book_id
    and request.status = 'borrowed'
    and request.return_date is null;
  borrowed_count := borrowed_count + community_borrowed_count;

  allocated_count := greatest(
    borrowed_count,
    book_row.total_copies - book_row.available_copies
  );
  if new_total < borrowed_count or new_total < allocated_count then
    raise exception using
      errcode = '23514',
      message = format(
        'INVENTORY_CONFLICT: total copies cannot be less than the %s outstanding copies.',
        allocated_count
      );
  end if;

  update public.books
  set title = coalesce(nullif(trim(p_patch ->> 'title'), ''), title),
      author = coalesce(nullif(trim(p_patch ->> 'author'), ''), author),
      category = case when p_patch ? 'category' then nullif(trim(p_patch ->> 'category'), '') else category end,
      isbn = case when p_patch ? 'isbn' then nullif(trim(p_patch ->> 'isbn'), '') else isbn end,
      shelf_location = case when p_patch ? 'shelf_location' then nullif(trim(p_patch ->> 'shelf_location'), '') else shelf_location end,
      library_id = new_library_id,
      total_copies = new_total,
      available_copies = new_total - allocated_count,
      summary = case when p_patch ? 'summary' then nullif(trim(p_patch ->> 'summary'), '') else summary end,
      cover_url = case when p_patch ? 'cover_url' then coalesce(nullif(trim(p_patch ->> 'cover_url'), ''), cover_url) else cover_url end,
      lending_enabled = case when p_patch ? 'lending_enabled' then (p_patch ->> 'lending_enabled')::boolean else lending_enabled end,
      condition = case when p_patch ? 'condition' then nullif(trim(p_patch ->> 'condition'), '') else condition end,
      lending_period_days = case when p_patch ? 'lending_period_days' then (p_patch ->> 'lending_period_days')::integer else lending_period_days end,
      handover_location = case when p_patch ? 'handover_location' then nullif(trim(p_patch ->> 'handover_location'), '') else handover_location end,
      handover_method = case when p_patch ? 'handover_method' then nullif(trim(p_patch ->> 'handover_method'), '') else handover_method end,
      handover_details = case when p_patch ? 'handover_details' then nullif(trim(p_patch ->> 'handover_details'), '') else handover_details end
  where id = p_book_id
  returning * into book_row;

  return book_row;
end;
$$;
revoke all on function public.update_inventory_book(text, timestamptz, jsonb) from public, anon;
grant execute on function public.update_inventory_book(text, timestamptz, jsonb)
  to authenticated;
