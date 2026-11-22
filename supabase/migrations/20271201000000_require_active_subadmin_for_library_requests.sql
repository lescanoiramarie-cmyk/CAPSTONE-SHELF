BEGIN;

-- A library request needs someone who can process its pickup and return.
-- Subscription status does not control the basic lending service.
CREATE OR REPLACE FUNCTION public.require_active_subadmin_for_library_request()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_library_id uuid;
BEGIN
  -- System imports and maintenance do not represent a signed-in visitor request.
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT book.library_id INTO v_library_id
  FROM public.books AS book
  WHERE book.id = NEW.book_id;

  -- Personal books are handled separately and do not belong to a branch.
  IF v_library_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Hold the row until the request completes so deactivation cannot race the check.
  PERFORM 1 FROM public.staff_profiles AS staff
  WHERE staff.library_id = v_library_id
    AND staff.role = 'subadmin'
    AND staff.is_active IS TRUE
  LIMIT 1 FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Borrowing and reservations are temporarily unavailable at this library. Please contact library staff.';
  END IF;
  RETURN NEW;
END;
$function$;

ALTER FUNCTION public.require_active_subadmin_for_library_request() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.require_active_subadmin_for_library_request()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER require_active_subadmin_for_library_request
BEFORE INSERT ON public.borrow_requests
FOR EACH ROW EXECUTE FUNCTION public.require_active_subadmin_for_library_request();

COMMIT;
