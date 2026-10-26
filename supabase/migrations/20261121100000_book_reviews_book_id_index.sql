-- Keep the review fields used by the summary available from the index.
CREATE INDEX IF NOT EXISTS book_reviews_book_id_rating_idx
  ON public.book_reviews (book_id) INCLUDE (rating);

DROP INDEX IF EXISTS public.book_reviews_book_id_idx;
