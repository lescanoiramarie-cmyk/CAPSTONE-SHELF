-- Prerequisites for community-book inventory, kept here so this migration is
-- independently deployable after the Auth migration has already run.
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
    foreign key (owner_visitor_id) references public.visitors(id)
    on delete cascade not valid;
end;
$$;

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
end;
$$;

create or replace function public.add_personal_book(
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

create or replace function public.add_personal_book(
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
    p_visitor_id,
    p_title,
    p_author,
    p_category,
    p_isbn,
    p_summary,
    p_condition,
    p_lending_period_days,
    p_handover_method,
    p_handover_details,
    p_lending_enabled
  );

  update public.books
  set total_copies = p_total_copies,
      available_copies = p_total_copies
  where id = book_row.id
    and book_type = 'personal'
    and owner_visitor_id = p_visitor_id;

  if not found then
    raise exception 'The personal book inventory could not be updated.';
  end if;

  book_row.total_copies := p_total_copies;
  book_row.available_copies := p_total_copies;

  return book_row;
end;
$$;

revoke all on function public.add_personal_book(
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  integer,
  text,
  text,
  boolean,
  integer
) from public;
grant execute on function public.add_personal_book(
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  integer,
  text,
  text,
  boolean,
  integer
) to anon, authenticated;

update public.books as book
set available_copies = greatest(
  coalesce(book.total_copies, 1) - coalesce((
    select count(*)::integer
    from public.community_book_requests as request
    where request.book_id = book.id
      and request.status = 'borrowed'
      and request.return_date is null
  ), 0),
  0
)
where book.book_type = 'personal';

create or replace function public.update_community_book_copy_availability()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if new.status = 'borrowed' then
      update public.books
      set available_copies = available_copies - 1
      where id = new.book_id
        and book_type = 'personal'
        and available_copies > 0;

      if not found then
        raise exception 'No copies of this community book are currently available.';
      end if;
    end if;
  elsif tg_op = 'UPDATE' then
    if old.status is distinct from 'borrowed'
      and new.status = 'borrowed'
    then
      update public.books
      set available_copies = available_copies - 1
      where id = new.book_id
        and book_type = 'personal'
        and available_copies > 0;

      if not found then
        raise exception 'No copies of this community book are currently available.';
      end if;
    elsif old.status = 'borrowed'
      and new.status is distinct from 'borrowed'
    then
      update public.books
      set available_copies = least(
        coalesce(total_copies, 1),
        available_copies + 1
      )
      where id = old.book_id
        and book_type = 'personal';
    end if;
  end if;

  return new;
end;
$$;

create or replace function public.require_available_community_book_copy()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  available_count integer;
begin
  if new.status = 'pending' then
    select book.available_copies
    into available_count
    from public.books as book
    where book.id = new.book_id
      and book.book_type = 'personal'
      and book.lending_enabled = true
    for update;

    if not found or coalesce(available_count, 0) < 1 then
      raise exception 'This community book is currently borrowed and unavailable.';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.update_community_book_copy_availability()
  from public, anon, authenticated;
revoke all on function public.require_available_community_book_copy()
  from public, anon, authenticated;

drop trigger if exists require_available_community_book_copy
  on public.community_book_requests;
create trigger require_available_community_book_copy
  before insert on public.community_book_requests
  for each row
  execute function public.require_available_community_book_copy();

drop trigger if exists community_book_copy_availability
  on public.community_book_requests;
create trigger community_book_copy_availability
  after insert or update on public.community_book_requests
  for each row
  execute function public.update_community_book_copy_availability();
