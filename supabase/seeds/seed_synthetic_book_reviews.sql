-- Give every visitor one synthetic rating for every library book in their
-- assigned library. Visitors without a library assignment are distributed
-- randomly across existing libraries first. The script is safe to run more
-- than once: it preserves existing visitor/book reviews and inserts only
-- missing visitor/book pairs.
-- Run only against a local/test Supabase project. This script changes
-- visitors.library_id and inserts synthetic review records; never run it on
-- production or the live Supabase project.

BEGIN;
SET LOCAL statement_timeout = '0';

WITH unassigned_visitors AS (
  SELECT
    visitor.id,
    row_number() OVER (ORDER BY random()) AS visitor_number
  FROM public.visitors AS visitor
  WHERE visitor.library_id IS NULL
), randomized_libraries AS (
  SELECT
    library.id,
    row_number() OVER (ORDER BY random()) AS library_number,
    count(*) OVER () AS library_count
  FROM public.libraries AS library
), assignments AS (
  SELECT
    visitor.id AS visitor_id,
    library.id AS library_id
  FROM unassigned_visitors AS visitor
  JOIN randomized_libraries AS library
    ON library.library_number =
      mod(visitor.visitor_number - 1, library.library_count) + 1
)
UPDATE public.visitors AS visitor
SET library_id = assignments.library_id
FROM assignments
WHERE visitor.id = assignments.visitor_id;

WITH library_books AS (
  SELECT book.id, book.library_id
  FROM public.books AS book
  WHERE book.book_type = 'library'
    AND book.library_id IS NOT NULL
), review_rows AS (
  SELECT
    book.id AS book_id,
    visitor.id AS visitor_id,
    visitor.full_name AS visitor_name,
    floor(random() * 5)::integer + 1 AS rating,
    'Synthetic visitor rating for dashboard testing.'::text AS comment,
    now() - random() * interval '180 days' AS created_at
  FROM library_books AS book
  JOIN public.visitors AS visitor
    ON visitor.library_id = book.library_id
)
INSERT INTO public.book_reviews (
  book_id,
  visitor_id,
  visitor_name,
  rating,
  comment,
  created_at
)
SELECT
  candidate.book_id,
  candidate.visitor_id,
  candidate.visitor_name,
  candidate.rating,
  candidate.comment,
  candidate.created_at
FROM review_rows AS candidate
WHERE NOT EXISTS (
  SELECT 1
  FROM public.book_reviews AS existing
  WHERE existing.book_id = candidate.book_id
    AND existing.visitor_id = candidate.visitor_id
);

COMMIT;
