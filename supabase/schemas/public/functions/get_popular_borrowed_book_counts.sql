CREATE OR REPLACE FUNCTION public.get_popular_borrowed_book_counts (
  p_limit integer DEFAULT 40
)
  RETURNS TABLE (
    book_id      text,
    borrow_count bigint
  )
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
  AS $function$
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
$function$;

GRANT EXECUTE ON FUNCTION "public"."get_popular_borrowed_book_counts"(integer) TO "anon", "authenticated", "postgres", "service_role";

REVOKE ALL ON FUNCTION "public"."get_popular_borrowed_book_counts"(integer) FROM PUBLIC;
