CREATE OR REPLACE FUNCTION public.update_community_book_copy_availability()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
DECLARE
  v_total integer;
  v_available integer;
  v_allocations integer := 0;
  v_available_after_release integer := 0;
BEGIN
  IF tg_op = 'INSERT' THEN
    IF new.status IN ('approved', 'borrowed') THEN
      UPDATE public.books
      SET available_copies = available_copies - 1
      WHERE id = new.book_id
        AND book_type = 'personal'
        AND available_copies > 0;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'No copies of this community book are currently available.';
      END IF;
    END IF;
  ELSIF tg_op = 'UPDATE' THEN
    IF old.status NOT IN ('approved', 'borrowed')
       AND new.status IN ('approved', 'borrowed')
    THEN
      UPDATE public.books
      SET available_copies = available_copies - 1
      WHERE id = new.book_id
        AND book_type = 'personal'
        AND available_copies > 0;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'No copies of this community book are currently available.';
      END IF;
    ELSIF old.status IN ('approved', 'borrowed')
       AND new.status NOT IN ('approved', 'borrowed')
    THEN
      SELECT book.total_copies, book.available_copies
      INTO v_total, v_available
      FROM public.books AS book
      WHERE book.id = old.book_id
        AND book.book_type = 'personal'
      FOR UPDATE;

      IF FOUND THEN
        SELECT
          (SELECT count(*)::integer
           FROM public.borrow_requests AS request
           WHERE request.book_id = old.book_id
             AND request.status IN ('ready_for_pickup', 'borrowed')
             AND request.return_date IS NULL)
          +
          (SELECT count(*)::integer
           FROM public.community_book_requests AS request
           WHERE request.book_id = old.book_id
             AND request.status IN ('approved', 'borrowed')
             AND request.return_date IS NULL)
        INTO v_allocations;

        v_available_after_release := LEAST(
          GREATEST(v_total - v_allocations, 0),
          COALESCE(v_available, 0) + 1
        );

        IF v_available IS DISTINCT FROM v_available_after_release THEN
          UPDATE public.books
          SET available_copies = v_available_after_release
          WHERE id = old.book_id
            AND book_type = 'personal';
        END IF;
      END IF;
    END IF;
  END IF;

  RETURN new;
END;
$function$;

GRANT EXECUTE ON FUNCTION "public"."update_community_book_copy_availability"() TO "postgres", "service_role";
REVOKE ALL ON FUNCTION "public"."update_community_book_copy_availability"() FROM PUBLIC;
