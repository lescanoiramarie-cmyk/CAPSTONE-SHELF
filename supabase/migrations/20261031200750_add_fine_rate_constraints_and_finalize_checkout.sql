
BEGIN;

-- Validate existing data before adding constraints.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM public.books
        WHERE fine_rate IS NOT NULL
          AND fine_rate NOT IN (10, 15, 20)
    ) THEN
        RAISE EXCEPTION 'Invalid fine_rate values exist in public.books.';
    END IF;

    IF EXISTS (
        SELECT 1 FROM public.borrow_requests
        WHERE fine_rate_snapshot IS NOT NULL
          AND fine_rate_snapshot NOT IN (10, 15, 20)
    ) THEN
        RAISE EXCEPTION 'Invalid fine_rate_snapshot values exist in public.borrow_requests.';
    END IF;

    IF EXISTS (
        SELECT 1 FROM public.community_book_requests
        WHERE fine_rate_snapshot IS NOT NULL
          AND fine_rate_snapshot NOT IN (10, 15, 20)
    ) THEN
        RAISE EXCEPTION 'Invalid fine_rate_snapshot values exist in public.community_book_requests.';
    END IF;
END;
$$;

-- Add constraints only when they do not already exist.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'public.books'::regclass
          AND conname = 'books_fine_rate_allowed'
    ) THEN
        ALTER TABLE public.books
            ADD CONSTRAINT books_fine_rate_allowed
            CHECK (fine_rate IS NULL OR fine_rate IN (10, 15, 20));
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'public.borrow_requests'::regclass
          AND conname = 'borrow_requests_fine_rate_snapshot_allowed'
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
        WHERE conrelid = 'public.community_book_requests'::regclass
          AND conname = 'community_book_requests_fine_rate_snapshot_allowed'
    ) THEN
        ALTER TABLE public.community_book_requests
            ADD CONSTRAINT community_book_requests_fine_rate_snapshot_allowed
            CHECK (
                fine_rate_snapshot IS NULL
                OR fine_rate_snapshot IN (10, 15, 20)
            );
    END IF;
END;
$$;

COMMIT;
