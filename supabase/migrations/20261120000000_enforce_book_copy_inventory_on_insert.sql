-- Enforce the existing book-copy invariant for every insertion path as well
-- as copy-count updates. This protects direct authenticated inserts in
-- addition to the validated staff UI and personal-book RPC.
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

  if new.total_copies is null
    or new.total_copies < 1
    or new.available_copies is null
    or new.available_copies < 0
    or new.available_copies > new.total_copies
    or new.total_copies < active_allocations
    or new.available_copies > new.total_copies - active_allocations
  then
    raise exception using
      errcode = '23514',
      message = format(
        'INVENTORY_CONFLICT: total copies must be positive, and available copies must be within the unallocated stock after %s outstanding allocations.',
        active_allocations
      );
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_book_copy_inventory()
  from public, anon, authenticated;

drop trigger if exists enforce_book_copy_inventory on public.books;
create trigger enforce_book_copy_inventory
  before insert or update of total_copies, available_copies on public.books
  for each row execute function public.enforce_book_copy_inventory();
