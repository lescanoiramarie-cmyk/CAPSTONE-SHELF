CREATE OR REPLACE FUNCTION public.get_book_rating_summaries (
  p_book_ids text[]
)
  RETURNS TABLE (
    book_id text,
    average_rating numeric,
    rating_count bigint
  )
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
  AS $function$
  SELECT aggregate.book_id,
         round(aggregate.rating_sum::numeric / aggregate.rating_count, 2),
         aggregate.rating_count
  FROM public.book_rating_aggregates AS aggregate
  WHERE aggregate.book_id = ANY(COALESCE(p_book_ids, ARRAY[]::text[]))
    AND aggregate.rating_count > 0;
$function$;

REVOKE ALL ON FUNCTION public.get_book_rating_summaries(text[])
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_book_rating_summaries(text[])
  TO anon, authenticated, postgres, service_role;
