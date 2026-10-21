CREATE OR REPLACE FUNCTION public.request_borrow (
  p_visitor_id uuid,
  p_book_id    text
)
  RETURNS public.borrow_requests
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
DECLARE
  v_book books%rowtype;
  v_visitor visitors%rowtype;
  v_req borrow_requests%rowtype;
  v_queue_count int;
BEGIN

  -- ============================================================
  -- FIND VISITOR
  --
  -- p_visitor_id from the app is the Supabase Auth UUID.
  --
  -- visitors.auth_user_id = UUID
  -- visitors.id           = TEXT
  --
  -- Therefore, if checking visitors.id, explicitly cast the UUID
  -- to TEXT.
  -- ============================================================
  SELECT v.*
  INTO v_visitor
  FROM public.visitors AS v
  WHERE v.auth_user_id = p_visitor_id
     OR v.id = p_visitor_id::text
  LIMIT 1;

  -- ============================================================
  -- FIND BOOK
  -- ============================================================
  SELECT b.*
  INTO v_book
  FROM public.books AS b
  WHERE b.id = trim(p_book_id)
  FOR UPDATE;

  -- ============================================================
  -- VALIDATE VISITOR
  -- ============================================================
  IF v_visitor.id IS NULL THEN
    RAISE EXCEPTION 'Visitor account could not be found.';
  END IF;

  -- ============================================================
  -- VALIDATE BOOK
  -- ============================================================
  IF v_book.id IS NULL THEN
    RAISE EXCEPTION 'The selected book could not be found.';
  END IF;

  -- ============================================================
  -- VERIFY VISITOR ACCOUNT
  -- ============================================================
  IF NOT coalesce(v_visitor.otp_verified, false) THEN
    RAISE EXCEPTION
      'Please verify your visitor account before requesting a book.';
  END IF;

  IF NOT coalesce(v_visitor.is_active, true) THEN
    RAISE EXCEPTION
      'This visitor account is currently inactive.';
  END IF;

  -- ============================================================
  -- CHECK EXISTING ACTIVE REQUEST / LOAN
  --
  -- borrow_requests.visitor_id = TEXT
  -- visitors.id               = TEXT
  --
  -- So this comparison is TEXT = TEXT.
  -- ============================================================
  IF EXISTS (
    SELECT 1
    FROM public.borrow_requests AS br
    WHERE br.visitor_id = v_visitor.id
      AND br.book_id = trim(p_book_id)
      AND br.status IN (
        'queued',
        'ready_for_pickup',
        'borrowed'
      )
  ) THEN
    RAISE EXCEPTION
      'You already have an active request or loan for this title.';
  END IF;

  -- ============================================================
  -- AVAILABLE COPY
  -- ============================================================
  IF coalesce(v_book.available_copies, 0) > 0 THEN

    UPDATE public.books AS b
    SET available_copies = b.available_copies - 1
    WHERE b.id = trim(p_book_id);

    INSERT INTO public.borrow_requests (
      book_id,
      book_title,
      visitor_id,
      visitor_name,
      status,
      pickup_deadline
    )
    VALUES (
      v_book.id,
      v_book.title,
      v_visitor.id,
      v_visitor.full_name,
      'ready_for_pickup',
      now() + interval '24 hours'
    )
    RETURNING * INTO v_req;

  -- ============================================================
  -- NO AVAILABLE COPY → QUEUE
  -- ============================================================
  ELSE

    SELECT count(*)
    INTO v_queue_count
    FROM public.borrow_requests AS br
    WHERE br.book_id = trim(p_book_id)
      AND br.status = 'queued';

    INSERT INTO public.borrow_requests (
      book_id,
      book_title,
      visitor_id,
      visitor_name,
      status,
      queue_position
    )
    VALUES (
      v_book.id,
      v_book.title,
      v_visitor.id,
      v_visitor.full_name,
      'queued',
      v_queue_count + 1
    )
    RETURNING * INTO v_req;

  END IF;

  RETURN v_req;

END;
$function$;

GRANT EXECUTE ON FUNCTION "public"."request_borrow"(uuid, text) TO PUBLIC, "anon", "authenticated", "postgres", "service_role";
