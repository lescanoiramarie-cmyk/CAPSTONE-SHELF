BEGIN;

-- Rename the legacy text function only if it exists.
-- The UUID-based function remains available for PostgREST.

DO $$
BEGIN
  IF to_regprocedure('public.get_visitor_borrow_requests(text)') IS NOT NULL
     AND to_regprocedure('public.get_visitor_borrow_requests_by_visitor_id(text)') IS NULL
  THEN
    ALTER FUNCTION public.get_visitor_borrow_requests(text)
      RENAME TO get_visitor_borrow_requests_by_visitor_id;
  END IF;
END;
$$;

NOTIFY pgrst, 'reload schema';

COMMIT;