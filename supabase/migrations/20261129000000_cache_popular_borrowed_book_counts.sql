-- Maintain the popular-book aggregation incrementally so public pages do not
-- scan the full borrowing history on every request.
CREATE TABLE IF NOT EXISTS public.borrowed_book_counts (
  book_id text PRIMARY KEY,
  borrow_count bigint NOT NULL CHECK (borrow_count > 0)
);

REVOKE ALL ON TABLE public.borrowed_book_counts
  FROM PUBLIC, anon, authenticated, service_role;

CREATE INDEX IF NOT EXISTS borrowed_book_counts_popular_idx
  ON public.borrowed_book_counts (borrow_count DESC, book_id ASC);

CREATE OR REPLACE FUNCTION public.maintain_borrowed_book_counts()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  old_book_id text;
  new_book_id text;
  old_qualifies boolean := false;
  new_qualifies boolean := false;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    old_qualifies := OLD.book_id IS NOT NULL
      AND (
        OLD.status IN ('borrowed', 'returned')
        OR OLD.borrow_date IS NOT NULL
      );
    old_book_id := OLD.book_id::text;
  END IF;

  IF TG_OP <> 'DELETE' THEN
    new_qualifies := NEW.book_id IS NOT NULL
      AND (
        NEW.status IN ('borrowed', 'returned')
        OR NEW.borrow_date IS NOT NULL
      );
    new_book_id := NEW.book_id::text;
  END IF;

  IF old_qualifies
    AND (NOT new_qualifies OR old_book_id IS DISTINCT FROM new_book_id)
  THEN
    DELETE FROM public.borrowed_book_counts
    WHERE book_id = old_book_id
      AND borrow_count = 1;

    UPDATE public.borrowed_book_counts
    SET borrow_count = borrow_count - 1
    WHERE book_id = old_book_id
      AND borrow_count > 1;
  END IF;

  IF new_qualifies
    AND (NOT old_qualifies OR old_book_id IS DISTINCT FROM new_book_id)
  THEN
    INSERT INTO public.borrowed_book_counts (book_id, borrow_count)
    VALUES (new_book_id, 1)
    ON CONFLICT (book_id) DO UPDATE
    SET borrow_count = public.borrowed_book_counts.borrow_count + 1;
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.maintain_borrowed_book_counts()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.maintain_borrowed_book_counts()
  TO postgres, service_role;

-- Keep historical backfill and trigger installation in one transaction.
-- Writes wait briefly while the initial count is built, then resume with the
-- trigger active, avoiding a gap that could make the cached counts drift.
DO $migration$
BEGIN
  EXECUTE 'LOCK TABLE public.borrow_requests IN SHARE ROW EXCLUSIVE MODE';

  INSERT INTO public.borrowed_book_counts (book_id, borrow_count)
  SELECT request.book_id::text, count(*)::bigint
  FROM public.borrow_requests AS request
  WHERE request.book_id IS NOT NULL
    AND (
      request.status IN ('borrowed', 'returned')
      OR request.borrow_date IS NOT NULL
    )
  GROUP BY request.book_id::text
  ON CONFLICT (book_id) DO UPDATE
  SET borrow_count = EXCLUDED.borrow_count;

  EXECUTE 'DROP TRIGGER IF EXISTS maintain_borrowed_book_counts ON public.borrow_requests';
  EXECUTE 'CREATE TRIGGER maintain_borrowed_book_counts
    AFTER INSERT OR DELETE OR UPDATE OF book_id, status, borrow_date
    ON public.borrow_requests
    FOR EACH ROW
    EXECUTE FUNCTION public.maintain_borrowed_book_counts()';
END;
$migration$;

CREATE OR REPLACE FUNCTION public.get_popular_borrowed_book_counts(
  p_limit integer DEFAULT 40
)
RETURNS TABLE(book_id text, borrow_count bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT counts.book_id, counts.borrow_count
  FROM public.borrowed_book_counts AS counts
  ORDER BY counts.borrow_count DESC, counts.book_id ASC
  LIMIT least(greatest(coalesce(p_limit, 40), 1), 100);
$$;

REVOKE ALL ON FUNCTION public.get_popular_borrowed_book_counts(integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_popular_borrowed_book_counts(integer)
  TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
