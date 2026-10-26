-- Keep the popular-book aggregation fast as borrowing history grows.
CREATE INDEX IF NOT EXISTS borrow_requests_popular_book_counts_idx
  ON public.borrow_requests (book_id)
  WHERE book_id IS NOT NULL
    AND (status IN ('borrowed', 'returned') OR borrow_date IS NOT NULL);
