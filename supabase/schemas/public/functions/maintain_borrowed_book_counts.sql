CREATE OR REPLACE FUNCTION public.maintain_borrowed_book_counts()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  old_book_id text;
  new_book_id text;
  old_qualifies boolean := false;
  new_qualifies boolean := false;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    old_qualifies := OLD.book_id IS NOT NULL
      AND (OLD.status IN ('borrowed', 'returned') OR OLD.borrow_date IS NOT NULL);
    old_book_id := OLD.book_id::text;
  END IF;

  IF TG_OP <> 'DELETE' THEN
    new_qualifies := NEW.book_id IS NOT NULL
      AND (NEW.status IN ('borrowed', 'returned') OR NEW.borrow_date IS NOT NULL);
    new_book_id := NEW.book_id::text;
  END IF;

  IF old_qualifies
    AND (NOT new_qualifies OR old_book_id IS DISTINCT FROM new_book_id)
  THEN
    DELETE FROM public.borrowed_book_counts
    WHERE book_id = old_book_id AND borrow_count = 1;
    UPDATE public.borrowed_book_counts
    SET borrow_count = borrow_count - 1
    WHERE book_id = old_book_id AND borrow_count > 1;
  END IF;

  IF new_qualifies
    AND (NOT old_qualifies OR old_book_id IS DISTINCT FROM new_book_id)
  THEN
    INSERT INTO public.borrowed_book_counts (book_id, borrow_count)
    VALUES (new_book_id, 1)
    ON CONFLICT (book_id) DO UPDATE
    SET borrow_count = public.borrowed_book_counts.borrow_count + 1;
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$function$;

GRANT EXECUTE ON FUNCTION "public"."maintain_borrowed_book_counts"() TO "postgres", "service_role";
REVOKE ALL ON FUNCTION "public"."maintain_borrowed_book_counts"() FROM "anon", "authenticated", PUBLIC;
