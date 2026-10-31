-- Add explicit per-book overdue fine rates.
-- Existing columns are preserved.
-- NULL means not yet classified or no checkout snapshot exists.

ALTER TABLE public.books
ADD COLUMN IF NOT EXISTS fine_rate integer;

ALTER TABLE public.borrow_requests
ADD COLUMN IF NOT EXISTS fine_rate_snapshot integer;

ALTER TABLE public.community_book_requests
ADD COLUMN IF NOT EXISTS fine_rate_snapshot integer;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'books_fine_rate_allowed'
          AND conrelid = 'public.books'::regclass
    ) THEN
        ALTER TABLE public.books
        ADD CONSTRAINT books_fine_rate_allowed
        CHECK (fine_rate IS NULL OR fine_rate IN (10, 15, 20));
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'borrow_requests_fine_rate_snapshot_allowed'
          AND conrelid = 'public.borrow_requests'::regclass
    ) THEN
        ALTER TABLE public.borrow_requests
        ADD CONSTRAINT borrow_requests_fine_rate_snapshot_allowed
        CHECK (
            fine_rate_snapshot IS NULL
            OR fine_rate_snapshot IN (10, 15, 20)
        );
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'community_book_requests_fine_rate_snapshot_allowed'
          AND conrelid = 'public.community_book_requests'::regclass
    ) THEN
        ALTER TABLE public.community_book_requests
        ADD CONSTRAINT community_book_requests_fine_rate_snapshot_allowed
        CHECK (
            fine_rate_snapshot IS NULL
            OR fine_rate_snapshot IN (10, 15, 20)
        );
    END IF;
END $$;