do $$
begin
  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'books'
      and column_name = 'is_public'
  ) then
    alter table public.books
      add column is_public boolean not null default false;

    update public.books
    set is_public = lending_enabled
    where book_type = 'personal';
  end if;
end;
$$;

drop policy if exists "public read books" on public.books;
drop policy if exists "public write books" on public.books;
drop policy if exists "books are publicly readable" on public.books;
drop policy if exists "books visible to catalog and owners" on public.books;

create policy "books visible to catalog and owners" on public.books
  for select to anon, authenticated
  using (
    book_type <> 'personal'
    or is_public
    or exists (
      select 1
      from public.visitors as visitor
      where visitor.id = books.owner_visitor_id
        and visitor.auth_user_id = auth.uid()
    )
  );

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
  p_total_copies integer,
  p_is_public boolean
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
    p_lending_enabled,
    p_total_copies
  );

  update public.books
  set is_public = coalesce(p_is_public, false)
  where id = book_row.id
    and book_type = 'personal'
    and owner_visitor_id = p_visitor_id
  returning * into book_row;

  if not found then
    raise exception 'The personal book visibility could not be saved.';
  end if;

  return book_row;
end;
$$;

revoke all on function public.add_personal_book(
  text, text, text, text, text, text, text, integer, text, text, boolean,
  integer, boolean
) from public, anon;
grant execute on function public.add_personal_book(
  text, text, text, text, text, text, text, integer, text, text, boolean,
  integer, boolean
) to authenticated;

revoke all on function public.add_personal_book(
  text, text, text, text, text, text, text, integer, text, text, boolean,
  integer
) from anon;
grant execute on function public.add_personal_book(
  text, text, text, text, text, text, text, integer, text, text, boolean,
  integer
) to authenticated;

revoke all on function public.add_personal_book(
  text, text, text, text, text, text, text, integer, text, text, boolean
) from anon;
grant execute on function public.add_personal_book(
  text, text, text, text, text, text, text, integer, text, text, boolean
) to authenticated;

create or replace function public.set_personal_book_visibility(
  p_visitor_id text,
  p_book_id text,
  p_is_public boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not exists (
    select 1
    from public.visitors as visitor
    where visitor.id = p_visitor_id
      and visitor.auth_user_id = auth.uid()
      and visitor.otp_verified
      and visitor.is_active
  ) then
    raise exception 'The authenticated, verified visitor account could not be found.';
  end if;

  update public.books
  set is_public = coalesce(p_is_public, false)
  where id = p_book_id
    and book_type = 'personal'
    and owner_visitor_id = p_visitor_id;

  if not found then
    raise exception 'The personal book could not be found for this visitor.';
  end if;
end;
$$;

revoke all on function public.set_personal_book_visibility(text, text, boolean)
  from public, anon;
grant execute on function public.set_personal_book_visibility(text, text, boolean)
  to authenticated;

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
      and book.is_public = true
      and book.lending_enabled = true
    for update;

    if not found then
      raise exception 'This community book is private or unavailable for lending.';
    end if;
    if coalesce(available_count, 0) < 1 then
      raise exception 'This community book is currently borrowed and unavailable.';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.require_available_community_book_copy()
  from public, anon, authenticated;
