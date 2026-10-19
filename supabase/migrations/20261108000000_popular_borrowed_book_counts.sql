create or replace function public.get_popular_borrowed_book_counts(
  p_limit integer default 40
)
returns table(book_id text, borrow_count bigint)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select request.book_id::text, count(*)::bigint
  from public.borrow_requests request
  where request.book_id is not null
    and (
      request.status in ('borrowed', 'returned')
      or request.borrow_date is not null
    )
  group by request.book_id
  order by count(*) desc, request.book_id::text
  limit least(greatest(coalesce(p_limit, 40), 1), 100);
$$;

revoke all on function public.get_popular_borrowed_book_counts(integer)
  from public, anon, authenticated;
grant execute on function public.get_popular_borrowed_book_counts(integer)
  to anon, authenticated;

notify pgrst, 'reload schema';