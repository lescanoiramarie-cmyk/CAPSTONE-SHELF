CREATE OR REPLACE FUNCTION public.maintain_book_rating_aggregates ()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
  AS $function$
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') AND OLD.rating BETWEEN 1 AND 5 THEN
    UPDATE public.book_rating_aggregates
    SET rating_sum = rating_sum - OLD.rating,
        rating_count = rating_count - 1
    WHERE book_id = OLD.book_id;

    DELETE FROM public.book_rating_aggregates
    WHERE book_id = OLD.book_id AND rating_count <= 0;
  END IF;

  IF TG_OP IN ('INSERT', 'UPDATE') AND NEW.rating BETWEEN 1 AND 5 THEN
    INSERT INTO public.book_rating_aggregates (book_id, rating_sum, rating_count)
    VALUES (NEW.book_id, NEW.rating, 1)
    ON CONFLICT (book_id) DO UPDATE
    SET rating_sum = book_rating_aggregates.rating_sum + EXCLUDED.rating_sum,
        rating_count = book_rating_aggregates.rating_count + 1;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$function$;
