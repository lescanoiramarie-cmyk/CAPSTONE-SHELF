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
  select counts.book_id, counts.borrow_count
  from public.borrowed_book_counts as counts
  order by counts.borrow_count desc, counts.book_id asc
  limit least(greatest(coalesce(p_limit, 40), 1), 100);
$function$;

GRANT EXECUTE ON FUNCTION "public"."get_popular_borrowed_book_counts"(integer) TO "anon", "authenticated", "postgres", "service_role";

REVOKE ALL ON FUNCTION "public"."get_popular_borrowed_book_counts"(integer) FROM PUBLIC;
