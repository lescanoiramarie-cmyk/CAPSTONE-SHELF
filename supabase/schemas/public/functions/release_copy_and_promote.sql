CREATE OR REPLACE FUNCTION public.release_copy_and_promote (
  p_book_id text
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
DECLARE
  v_next public.borrow_requests%ROWTYPE;
  v_total integer;
  v_available integer;
  v_allocations integer := 0;
  v_available_after_release integer := 0;
BEGIN
  -- Callers first move the relevant request out of its allocating status.
  -- Recompute free stock from both request tables so stale counters cannot
  -- prevent a legitimate return/cancel/expiry from completing.
  SELECT book.total_copies, book.available_copies
  INTO v_total, v_available
  FROM public.books AS book
  WHERE book.id::text = p_book_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  SELECT
    (SELECT count(*)::integer
     FROM public.borrow_requests AS request
     WHERE request.book_id = p_book_id
       AND request.status IN ('ready_for_pickup', 'borrowed')
       AND request.return_date IS NULL)
    +
    (SELECT count(*)::integer
     FROM public.community_book_requests AS request
     WHERE request.book_id = p_book_id
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
    WHERE id::text = p_book_id;
  END IF;

  -- Never promote another borrower unless there is a free copy after the
  -- released request and any existing allocations have been accounted for.
  IF v_available_after_release < 1 THEN
    RETURN;
  END IF;

  SELECT *
  INTO v_next
  FROM public.borrow_requests
  WHERE book_id::text = p_book_id
    AND status = 'queued'
  ORDER BY queue_position ASC
  LIMIT 1
  FOR UPDATE;

  IF v_next.id IS NOT NULL THEN
    UPDATE public.borrow_requests
    SET status = 'ready_for_pickup',
        pickup_deadline = pg_catalog.now() + INTERVAL '24 hours',
        queue_position = NULL
    WHERE id = v_next.id;

    UPDATE public.books
    SET available_copies = available_copies - 1
    WHERE id::text = p_book_id;

    UPDATE public.borrow_requests AS request
    SET queue_position = queued.row_number
    FROM (
      SELECT id,
        pg_catalog.row_number() OVER (ORDER BY queue_position ASC) AS row_number
      FROM public.borrow_requests
      WHERE book_id::text = p_book_id
        AND status = 'queued'
    ) AS queued
    WHERE request.id = queued.id;
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.release_copy_and_promote (
  p_book_id uuid
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
BEGIN
  PERFORM public.release_copy_and_promote(p_book_id::text);
END;
$function$;

GRANT EXECUTE ON FUNCTION "public"."release_copy_and_promote"(text) TO "postgres", "service_role";
GRANT EXECUTE ON FUNCTION "public"."release_copy_and_promote"(uuid) TO "postgres", "service_role";
REVOKE ALL ON FUNCTION "public"."release_copy_and_promote"(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."release_copy_and_promote"(uuid) FROM PUBLIC;
