-- Reconcile allocation rules across book validation, circulation RPCs, and release triggers.
-- This forward-only migration changes functions only; it does not alter records,
-- RLS policies, table grants, trigger definitions, or historical migrations.
CREATE OR REPLACE FUNCTION public.enforce_book_copy_inventory()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
declare
  active_allocations integer := 0;
  community_allocations integer := 0;
begin
  select count(*)::integer into active_allocations
  from public.borrow_requests request
  where request.book_id = new.id
    and request.status in ('ready_for_pickup', 'borrowed')
    and request.return_date is null;

  select count(*)::integer into community_allocations
  from public.community_book_requests request
  where request.book_id = new.id
    and request.status in ('approved', 'borrowed')
    and request.return_date is null;
  active_allocations := active_allocations + community_allocations;

  if new.total_copies is null
    or new.total_copies < 1
    or new.available_copies is null
    or new.available_copies < 0
    or new.available_copies > new.total_copies
    or new.available_copies > greatest(new.total_copies - active_allocations, 0)
  then
    raise exception using
      errcode = '23514',
      message = format(
        'INVENTORY_CONFLICT: total copies must be positive, and available copies must be within the unallocated stock after %s outstanding allocations.',
        active_allocations
      );
  end if;

  -- Existing over-allocation can be unwound safely by reducing availability
  -- to zero after a real return/cancellation/expiry. Do not permit a total
  -- reduction or any increase in availability while allocations exceed it.
  if new.total_copies < active_allocations then
    if tg_op <> 'UPDATE' then
      raise exception using
        errcode = '23514',
        message = format(
          'INVENTORY_CONFLICT: total copies cannot be less than %s outstanding allocations.',
          active_allocations
        );
    end if;

    if new.total_copies is distinct from old.total_copies
       or new.available_copies <> 0
       or new.available_copies > old.available_copies
    then
      raise exception using
        errcode = '23514',
        message = format(
          'INVENTORY_CONFLICT: total copies cannot be less than %s outstanding allocations.',
          active_allocations
        );
    end if;
  end if;

  return new;
end;
$function$;

GRANT EXECUTE ON FUNCTION "public"."enforce_book_copy_inventory"() TO "postgres", "service_role";

REVOKE ALL ON FUNCTION "public"."enforce_book_copy_inventory"() FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.update_inventory_book (
  p_book_id             text,
  p_expected_updated_at timestamp with time zone,
  p_patch               jsonb
)
  RETURNS public.books
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
DECLARE
    book_row public.books%rowtype;
    new_total integer;
    borrowed_count integer := 0;
    community_borrowed_count integer := 0;
    allocated_count integer := 0;
    new_library_id text;
BEGIN
    -- Validate the request payload.
    IF p_expected_updated_at IS NULL
       OR p_patch IS NULL
       OR jsonb_typeof(p_patch) IS DISTINCT FROM 'object'
    THEN
        RAISE EXCEPTION
            'INVENTORY_CONFLICT: reload this book before saving.';
    END IF;

    -- Lock the target book and verify its version.
    SELECT *
    INTO book_row
    FROM public.books
    WHERE id = p_book_id
    FOR UPDATE;

    IF NOT FOUND
       OR book_row.updated_at IS DISTINCT FROM p_expected_updated_at
    THEN
        RAISE EXCEPTION USING
            ERRCODE = '40001',
            MESSAGE =
                'INVENTORY_CONFLICT: this book changed or was removed. Reload it before saving.';
    END IF;

    -- Only active staff authorized for this branch may edit it.
    IF NOT public.is_active_staff_for_branch(
        book_row.library_id::text
    ) THEN
        RAISE EXCEPTION USING
            ERRCODE = '42501',
            MESSAGE = 'You cannot edit this branch inventory.';
    END IF;

    -- Validate the destination branch.
    new_library_id := CASE
        WHEN p_patch ? 'library_id'
            THEN NULLIF(p_patch ->> 'library_id', '')
        ELSE book_row.library_id::text
    END;

    IF new_library_id IS NOT NULL
       AND NOT public.is_active_staff_for_branch(new_library_id)
    THEN
        RAISE EXCEPTION USING
            ERRCODE = '42501',
            MESSAGE = 'You cannot move this book to that branch.';
    END IF;

    -- A sub-admin cannot unassign a book from its branch.
    IF new_library_id IS NULL
       AND NOT public.is_active_staff_for_branch(NULL::text)
    THEN
        RAISE EXCEPTION USING
            ERRCODE = '42501',
            MESSAGE = 'Only a superadmin may unassign inventory from a branch.';
    END IF;

    -- Validate the requested total copy count.
    new_total := CASE
        WHEN p_patch ? 'total_copies'
            THEN (p_patch ->> 'total_copies')::integer
        ELSE book_row.total_copies
    END;

    IF new_total IS NULL OR new_total < 1 THEN
        RAISE EXCEPTION
            'Total copies must be a positive whole number.';
    END IF;

    -- Count every library request that currently holds a physical copy.
    -- ready_for_pickup has already consumed a copy; confirming pickup only
    -- changes its status to borrowed and must not allocate a second copy.
    SELECT count(*)::integer
    INTO borrowed_count
    FROM public.borrow_requests request
    WHERE request.book_id = p_book_id
      AND request.status IN ('ready_for_pickup', 'borrowed')
      AND request.return_date IS NULL;

    -- Community approval allocates the copy. The later borrowed transition
    -- retains that allocation, so approved and borrowed are counted once.
    SELECT count(*)::integer
    INTO community_borrowed_count
    FROM public.community_book_requests request
    WHERE request.book_id = p_book_id
      AND request.status IN ('approved', 'borrowed')
      AND request.return_date IS NULL;

    borrowed_count :=
        borrowed_count + community_borrowed_count;

    -- Preserve all outstanding or otherwise allocated copies.
    allocated_count := greatest(
        borrowed_count,
        book_row.total_copies - book_row.available_copies
    );

    IF new_total < borrowed_count
       OR new_total < allocated_count
    THEN
        RAISE EXCEPTION USING
            ERRCODE = '23514',
            MESSAGE = format(
                'INVENTORY_CONFLICT: total copies cannot be less than the %s outstanding copies.',
                allocated_count
            );
    END IF;

    -- Update only fields explicitly supported by the original RPC.
    UPDATE public.books
    SET
        title = coalesce(
            nullif(trim(p_patch ->> 'title'), ''),
            title
        ),
        author = coalesce(
            nullif(trim(p_patch ->> 'author'), ''),
            author
        ),
        category = CASE
            WHEN p_patch ? 'category'
                THEN nullif(trim(p_patch ->> 'category'), '')
            ELSE category
        END,
        isbn = CASE
            WHEN p_patch ? 'isbn'
                THEN nullif(trim(p_patch ->> 'isbn'), '')
            ELSE isbn
        END,
        shelf_location = CASE
            WHEN p_patch ? 'shelf_location'
                THEN nullif(trim(p_patch ->> 'shelf_location'), '')
            ELSE shelf_location
        END,
        library_id = new_library_id::uuid,
        total_copies = new_total,
        available_copies = new_total - allocated_count,
        summary = CASE
            WHEN p_patch ? 'summary'
                THEN nullif(trim(p_patch ->> 'summary'), '')
            ELSE summary
        END,
        cover_url = CASE
            WHEN p_patch ? 'cover_url'
                THEN coalesce(
                    nullif(trim(p_patch ->> 'cover_url'), ''),
                    cover_url
                )
            ELSE cover_url
        END,
        lending_enabled = CASE
            WHEN p_patch ? 'lending_enabled'
                THEN (p_patch ->> 'lending_enabled')::boolean
            ELSE lending_enabled
        END,
        condition = CASE
            WHEN p_patch ? 'condition'
                THEN nullif(trim(p_patch ->> 'condition'), '')
            ELSE condition
        END,
        lending_period_days = CASE
            WHEN p_patch ? 'lending_period_days'
                THEN (p_patch ->> 'lending_period_days')::integer
            ELSE lending_period_days
        END,
        handover_location = CASE
            WHEN p_patch ? 'handover_location'
                THEN nullif(trim(p_patch ->> 'handover_location'), '')
            ELSE handover_location
        END,
        handover_method = CASE
            WHEN p_patch ? 'handover_method'
                THEN nullif(trim(p_patch ->> 'handover_method'), '')
            ELSE handover_method
        END,
        handover_details = CASE
            WHEN p_patch ? 'handover_details'
                THEN nullif(trim(p_patch ->> 'handover_details'), '')
            ELSE handover_details
        END
    WHERE id = p_book_id
    RETURNING * INTO book_row;

    RETURN book_row;
END;
$function$;

GRANT EXECUTE ON FUNCTION "public"."update_inventory_book"(text, timestamp WITH time zone, jsonb) TO "authenticated", "postgres", "service_role";

REVOKE ALL ON FUNCTION "public"."update_inventory_book"(text, timestamp WITH time zone, jsonb) FROM PUBLIC;

CREATE OR REPLACE FUNCTION shelf_private.request_borrow_unchecked (
  p_visitor_id uuid,
  p_book_id    text
)
  RETURNS public.borrow_requests
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
  AS $function$
DECLARE
  v_book books%rowtype;
  v_visitor visitors%rowtype;
  v_req borrow_requests%rowtype;
  v_queue_count int;
  v_active_allocations integer := 0;
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
  SELECT count(*)::integer
  INTO v_active_allocations
  FROM public.borrow_requests AS request
  WHERE request.book_id = v_book.id
    AND request.status IN ('ready_for_pickup', 'borrowed')
    AND request.return_date IS NULL;

  SELECT v_active_allocations + count(*)::integer
  INTO v_active_allocations
  FROM public.community_book_requests AS request
  WHERE request.book_id = v_book.id
    AND request.status IN ('approved', 'borrowed')
    AND request.return_date IS NULL;

  IF coalesce(v_book.available_copies, 0) > 0
     AND v_book.total_copies > v_active_allocations
     AND v_book.available_copies <= v_book.total_copies - v_active_allocations
  THEN

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
  -- NO AVAILABLE COPY â†’ QUEUE
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

GRANT EXECUTE ON FUNCTION "shelf_private"."request_borrow_unchecked"(uuid, text) TO "postgres";

REVOKE ALL ON FUNCTION "shelf_private"."request_borrow_unchecked"(uuid, text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.approve_community_book_request (
  p_request_id       uuid,
  p_owner_visitor_id text,
  p_response         text DEFAULT NULL::text
)
  RETURNS TABLE (
    id                   uuid,
    book_id              text,
    book_title           text,
    requester_visitor_id text,
    requester_name       text,
    status               text,
    approved_at          timestamp with time zone,
    owner_response       text
  )
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
DECLARE
  request_row public.community_book_requests%ROWTYPE;
  available_count integer;
  total_count integer;
  active_allocations integer := 0;
BEGIN
  -- Verify the authenticated, active, OTP-verified visitor.
  IF auth.uid() IS NULL OR NOT EXISTS (
    SELECT 1
    FROM public.visitors AS visitor
    WHERE visitor.id = trim(p_owner_visitor_id)
      AND visitor.auth_user_id = auth.uid()
      AND visitor.otp_verified
      AND visitor.is_active
  ) THEN
    RAISE EXCEPTION
      'The authenticated, verified visitor account could not be found.';
  END IF;

  -- Lock the request.
  SELECT request.*
  INTO request_row
  FROM public.community_book_requests AS request
  WHERE request.id = p_request_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Community book request could not be found.';
  END IF;

  IF request_row.owner_visitor_id <> trim(p_owner_visitor_id) THEN
    RAISE EXCEPTION
      'Only the owner of this community book can approve the request.';
  END IF;

  IF request_row.status <> 'pending' THEN
    RAISE EXCEPTION 'This request is no longer pending.';
  END IF;

  -- Verify that the community book has an available copy.
  SELECT book.available_copies, book.total_copies
  INTO available_count, total_count
  FROM public.books AS book
  WHERE book.id = request_row.book_id
    AND book.book_type = 'personal'
    AND book.lending_enabled
    AND book.is_public
  FOR UPDATE;

  IF NOT FOUND OR COALESCE(available_count, 0) < 1 THEN
    RAISE EXCEPTION
      'No copies of this community book are currently available.';
  END IF;

  SELECT count(*)::integer
  INTO active_allocations
  FROM public.borrow_requests AS request
  WHERE request.book_id = request_row.book_id
    AND request.status IN ('ready_for_pickup', 'borrowed')
    AND request.return_date IS NULL;

  SELECT active_allocations + count(*)::integer
  INTO active_allocations
  FROM public.community_book_requests AS request
  WHERE request.book_id = request_row.book_id
    AND request.status IN ('approved', 'borrowed')
    AND request.return_date IS NULL;

  IF total_count IS NULL
     OR total_count <= active_allocations
     OR available_count > total_count - active_allocations
  THEN
    RAISE EXCEPTION
      'No unallocated copy is available for this community request.';
  END IF;

  -- Preserve the request queue order.
  IF EXISTS (
    SELECT 1
    FROM public.community_book_requests AS earlier
    WHERE earlier.book_id = request_row.book_id
      AND earlier.status = 'pending'
      AND (earlier.request_date, earlier.id)
          < (request_row.request_date, request_row.id)
  ) THEN
    RAISE EXCEPTION
      'Please approve the next request in the community book queue first.';
  END IF;

  -- Approve the request.
  UPDATE public.community_book_requests AS request
  SET
    status = 'approved',
    approved_at = now(),
    rejected_at = NULL,
    owner_response = NULLIF(trim(p_response), '')
  WHERE request.id = p_request_id
  RETURNING request.* INTO request_row;

  -- Explicitly cast status to the declared return type: text.
  RETURN QUERY
  SELECT
    request_row.id,
    request_row.book_id,
    request_row.book_title,
    request_row.requester_visitor_id,
    request_row.requester_name,
    request_row.status::text,
    request_row.approved_at,
    request_row.owner_response;
END;
$function$;

GRANT EXECUTE ON FUNCTION "public"."approve_community_book_request"(uuid, text, text) TO "authenticated", "postgres", "service_role";

REVOKE ALL ON FUNCTION "public"."approve_community_book_request"(uuid, text, text) FROM PUBLIC;

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

CREATE OR REPLACE FUNCTION public.confirm_community_book_return (
  p_request_id       uuid,
  p_owner_visitor_id text
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
DECLARE
  v_req public.community_book_requests%rowtype;
  v_fine numeric := 0;
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (
    SELECT 1
    FROM public.visitors AS visitor
    WHERE visitor.id::text = trim(p_owner_visitor_id)
      AND visitor.auth_user_id = auth.uid()
      AND visitor.otp_verified = true
      AND visitor.is_active = true
  ) THEN
    RAISE EXCEPTION
      'The authenticated, verified owner account could not be found.';
  END IF;

  -- Get and lock the request
  SELECT cbr.*
  INTO v_req
  FROM public.community_book_requests AS cbr
  WHERE cbr.id = p_request_id
  FOR UPDATE;

  -- Request must exist
  IF v_req.id IS NULL THEN
    RAISE EXCEPTION 'Request not found.';
  END IF;

  -- Only borrowed books can be returned
  IF v_req.status <> 'borrowed' THEN
    RAISE EXCEPTION
      'This community book is not currently borrowed.';
  END IF;

  -- Only the owner can confirm the return
  IF v_req.owner_visitor_id <> trim(p_owner_visitor_id) THEN
    RAISE EXCEPTION
      'Only the owner of this community book can confirm the return.';
  END IF;

  -- Calculate fine using the SHELF rule of â‚±10/day.
  -- No fine if returned on or before the due date.
  IF v_req.due_date IS NOT NULL
     AND now() > v_req.due_date THEN

    v_fine :=
      CEIL(
        EXTRACT(EPOCH FROM (now() - v_req.due_date))
        / 86400
      ) * 10;

  END IF;

  -- Mark the community book as returned
  UPDATE public.community_book_requests AS cbr
  SET
    status = 'returned',
    return_date = now(),
    fine_amount = v_fine,
    return_confirmed_by = trim(p_owner_visitor_id),
    updated_at = now()
  WHERE cbr.id = p_request_id;
END;
$function$;

GRANT EXECUTE ON FUNCTION "public"."confirm_community_book_return"(uuid, text) TO "authenticated", "postgres", "service_role";

REVOKE ALL ON FUNCTION "public"."confirm_community_book_return"(uuid, text) FROM PUBLIC;
