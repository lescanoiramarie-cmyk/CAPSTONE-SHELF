CREATE OR REPLACE FUNCTION public.get_book_rating_summaries(
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
SET search_path = public, pg_temp
AS $$
  SELECT
    review.book_id,
    round(avg(review.rating)::numeric, 2) AS average_rating,
    count(*)::bigint AS rating_count
  FROM public.book_reviews AS review
  WHERE review.book_id = ANY(COALESCE(p_book_ids, ARRAY[]::text[]))
    AND review.rating BETWEEN 1 AND 5
  GROUP BY review.book_id;
$$;

REVOKE ALL ON FUNCTION public.get_book_rating_summaries(text[])
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_book_rating_summaries(text[])
  TO anon, authenticated, postgres, service_role;

NOTIFY pgrst, 'reload schema';
