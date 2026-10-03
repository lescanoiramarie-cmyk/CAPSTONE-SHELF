create or replace function public.add_personal_book(
  p_visitor_id uuid,
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
  uuid,
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
  uuid,
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
