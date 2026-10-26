CREATE TABLE IF NOT EXISTS public.book_rating_aggregates (
  book_id text PRIMARY KEY,
  rating_sum bigint NOT NULL DEFAULT 0,
  rating_count bigint NOT NULL DEFAULT 0
);

ALTER TABLE public.book_rating_aggregates ENABLE ROW LEVEL SECURITY;

INSERT INTO public.book_rating_aggregates (book_id, rating_sum, rating_count)
SELECT book_id, sum(rating)::bigint, count(*)::bigint
FROM public.book_reviews
WHERE rating BETWEEN 1 AND 5
GROUP BY book_id
ON CONFLICT (book_id) DO UPDATE
SET rating_sum = EXCLUDED.rating_sum,
    rating_count = EXCLUDED.rating_count;

CREATE OR REPLACE FUNCTION public.maintain_book_rating_aggregates()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') AND OLD.rating BETWEEN 1 AND 5 THEN
    UPDATE public.book_rating_aggregates
    SET rating_sum = rating_sum - OLD.rating,
        rating_count = rating_count - 1
    WHERE book_id = OLD.book_id;

    DELETE FROM public.book_rating_aggregates
    WHERE book_id = OLD.book_id AND rating_count <= 0;
  END IF;

  IF TG_OP IN ('INSERT', 'UPDATE') AND NEW.rating BETWEEN 1 AND 5 THEN
    INSERT INTO public.book_rating_aggregates (book_id, rating_sum, rating_count)
    VALUES (NEW.book_id, NEW.rating, 1)
    ON CONFLICT (book_id) DO UPDATE
    SET rating_sum = book_rating_aggregates.rating_sum + EXCLUDED.rating_sum,
        rating_count = book_rating_aggregates.rating_count + 1;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS maintain_book_rating_aggregates ON public.book_reviews;
CREATE TRIGGER maintain_book_rating_aggregates
AFTER INSERT OR UPDATE OF book_id, rating OR DELETE ON public.book_reviews
FOR EACH ROW EXECUTE FUNCTION public.maintain_book_rating_aggregates();

CREATE OR REPLACE FUNCTION public.get_book_rating_summaries(p_book_ids text[])
RETURNS TABLE (book_id text, average_rating numeric, rating_count bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT aggregate.book_id,
         round(aggregate.rating_sum::numeric / aggregate.rating_count, 2),
         aggregate.rating_count
  FROM public.book_rating_aggregates AS aggregate
  WHERE aggregate.book_id = ANY(COALESCE(p_book_ids, ARRAY[]::text[]))
    AND aggregate.rating_count > 0;
$$;

REVOKE ALL ON FUNCTION public.get_book_rating_summaries(text[])
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_book_rating_summaries(text[])
  TO anon, authenticated, postgres, service_role;

NOTIFY pgrst, 'reload schema';
