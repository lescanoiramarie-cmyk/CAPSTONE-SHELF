create extension if not exists pgcrypto;

create table if not exists public.visitor_reading_list (
  id uuid primary key default gen_random_uuid(),
  visitor_id text not null references public.visitors(id) on delete cascade,
  book_id text not null references public.books(id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint visitor_reading_list_unique unique (visitor_id, book_id)
);

create or replace function public.toggle_reading_list_item(
  p_visitor_id uuid,
  p_book_id text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_visitor_id text;
  v_exists boolean;
begin
  if p_visitor_id is null or p_book_id is null then
    raise exception 'Visitor ID and Book ID are required.';
  end if;

  select v.id
  into v_visitor_id
  from public.visitors v
  where v.auth_user_id = p_visitor_id;

  if v_visitor_id is null then
    raise exception 'Visitor profile could not be resolved from the supplied auth user.';
  end if;

  select exists (
    select 1
    from public.visitor_reading_list
    where visitor_id = v_visitor_id
      and book_id = p_book_id
  )
  into v_exists;

  if v_exists then
    delete from public.visitor_reading_list
    where visitor_id = v_visitor_id
      and book_id = p_book_id;

    return false;
  end if;

  insert into public.visitor_reading_list (id, visitor_id, book_id)
  values (gen_random_uuid(), v_visitor_id, p_book_id)
  on conflict (visitor_id, book_id) do nothing;

  return exists (
    select 1
    from public.visitor_reading_list
    where visitor_id = v_visitor_id
      and book_id = p_book_id
  );
end;
$$;

create or replace function public.fetch_visitor_reading_list(
  p_visitor_id uuid
)
returns setof public.books
language sql
security definer
set search_path = public
as $$
  select b.*
  from public.visitor_reading_list r
  join public.visitors v on v.id = r.visitor_id
  join public.books b on b.id = r.book_id
  where v.auth_user_id = p_visitor_id
  order by r.created_at desc;
$$;

alter table public.visitor_reading_list enable row level security;

drop policy if exists "Visitors can manage own reading list" on public.visitor_reading_list;
drop policy if exists "Visitors can view own reading list" on public.visitor_reading_list;
drop policy if exists "Visitors can insert own reading list item" on public.visitor_reading_list;
drop policy if exists "Visitors can delete own reading list item" on public.visitor_reading_list;

create policy "Visitors can manage own reading list"
  on public.visitor_reading_list
  for all
  using (
    visitor_id in (
      select id
      from public.visitors
      where auth_user_id = auth.uid()
    )
  )
  with check (
    visitor_id in (
      select id
      from public.visitors
      where auth_user_id = auth.uid()
    )
  );

create policy "Visitors can view own reading list"
  on public.visitor_reading_list
  for select
  using (
    visitor_id in (
      select id
      from public.visitors
      where auth_user_id = auth.uid()
    )
  );

create policy "Visitors can insert own reading list item"
  on public.visitor_reading_list
  for insert
  with check (
    visitor_id in (
      select id
      from public.visitors
      where auth_user_id = auth.uid()
    )
  );

create policy "Visitors can delete own reading list item"
  on public.visitor_reading_list
  for delete
  using (
    visitor_id in (
      select id
      from public.visitors
      where auth_user_id = auth.uid()
    )
  );
