ALTER TABLE public.community_book_requests
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
