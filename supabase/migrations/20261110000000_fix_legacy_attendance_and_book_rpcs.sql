DROP FUNCTION IF EXISTS public.scan_attendance(TEXT, UUID);

CREATE OR REPLACE FUNCTION public.scan_attendance(
  p_qr TEXT,
  p_library_id TEXT
)
RETURNS TABLE(log_id TEXT, visitor_id TEXT, visitor_name TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_visitor RECORD;
  v_log_id TEXT;
  library_id_type TEXT;
BEGIN
  SELECT *
    INTO v_visitor
    FROM public.visitors
   WHERE qr_code = pg_catalog.btrim(p_qr);

  IF v_visitor.id IS NULL THEN
    RAISE EXCEPTION 'QR code not recognized. Please check the pass and try again.';
  END IF;

  SELECT pg_catalog.format_type(attribute.atttypid, attribute.atttypmod)
    INTO library_id_type
    FROM pg_catalog.pg_attribute AS attribute
   WHERE attribute.attrelid = 'public.attendance_logs'::regclass
     AND attribute.attname = 'library_id'
     AND NOT attribute.attisdropped;

  IF library_id_type IS NULL THEN
    RAISE EXCEPTION 'attendance_logs.library_id column is missing.';
  END IF;

  EXECUTE pg_catalog.format(
    'INSERT INTO public.attendance_logs (visitor_id, visitor_name, library_id) VALUES ($1, $2, $3::%s) RETURNING id::text',
    library_id_type
  )
    INTO v_log_id
    USING v_visitor.id, v_visitor.full_name, p_library_id;

  RETURN QUERY
  SELECT v_log_id, v_visitor.id::TEXT, v_visitor.full_name::TEXT;
END;
$$;

CREATE OR REPLACE FUNCTION public.release_copy_and_promote(
  p_book_id TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_next public.borrow_requests%ROWTYPE;
BEGIN
  UPDATE public.books
     SET available_copies = available_copies + 1
   WHERE id::TEXT = p_book_id;

  SELECT *
    INTO v_next
    FROM public.borrow_requests
   WHERE book_id::TEXT = p_book_id
     AND status = 'queued'
   ORDER BY queue_position ASC
   LIMIT 1;

  IF v_next.id IS NOT NULL THEN
    UPDATE public.borrow_requests
       SET status = 'ready_for_pickup',
           pickup_deadline = pg_catalog.now() + INTERVAL '24 hours',
           queue_position = NULL
     WHERE id = v_next.id;

    UPDATE public.books
       SET available_copies = available_copies - 1
     WHERE id::TEXT = p_book_id;

    UPDATE public.borrow_requests AS request
       SET queue_position = queued.row_number
      FROM (
        SELECT id,
               pg_catalog.row_number() OVER (ORDER BY queue_position ASC) AS row_number
          FROM public.borrow_requests
         WHERE book_id::TEXT = p_book_id
           AND status = 'queued'
      ) AS queued
     WHERE request.id = queued.id;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.release_copy_and_promote(
  p_book_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.release_copy_and_promote(p_book_id::TEXT);
END;
$$;
