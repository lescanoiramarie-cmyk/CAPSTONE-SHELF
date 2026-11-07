BEGIN;

CREATE OR REPLACE FUNCTION public.reject_pending_community_requests_without_copies()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
BEGIN
  IF NEW.book_type = 'personal'
     AND COALESCE(NEW.available_copies, 0) = 0
  THEN
    UPDATE public.community_book_requests AS request
    SET
      status = 'rejected',
      rejected_at = pg_catalog.now(),
      owner_response = 'No available copies remain. Your request was automatically rejected.',
      queue_position = NULL,
      updated_at = pg_catalog.now()
    WHERE request.book_id = NEW.id::text
      AND request.status = 'pending';
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.reject_pending_community_requests_without_copies()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reject_pending_community_requests_without_copies()
  TO postgres, service_role;

DROP TRIGGER IF EXISTS reject_pending_community_requests_without_copies
  ON public.books;
CREATE TRIGGER reject_pending_community_requests_without_copies
AFTER UPDATE OF available_copies, book_type ON public.books
FOR EACH ROW
EXECUTE FUNCTION public.reject_pending_community_requests_without_copies();

-- Reconcile any pending requests that already point to an exhausted community book.
UPDATE public.community_book_requests AS request
SET
  status = 'rejected',
  rejected_at = pg_catalog.now(),
  owner_response = 'No available copies remain. Your request was automatically rejected.',
  queue_position = NULL,
  updated_at = pg_catalog.now()
FROM public.books AS book
WHERE request.book_id = book.id::text
  AND request.status = 'pending'
  AND book.book_type = 'personal'
  AND COALESCE(book.available_copies, 0) = 0;

NOTIFY pgrst, 'reload schema';

COMMIT;
