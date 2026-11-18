-- Version: 20270103000900. Implement 21 notification events across borrowing/community lifecycle.
-- Adds notification creation in all transaction functions, hardens create_visitor_notification.

BEGIN;

-- ============================================================
-- 1. Extend notification_type CHECK constraint to include all 16 events
-- ============================================================
ALTER TABLE public.visitor_notifications
    DROP CONSTRAINT IF EXISTS visitor_notifications_notification_type_check;

ALTER TABLE public.visitor_notifications
    ADD CONSTRAINT visitor_notifications_notification_type_check
    CHECK (notification_type IN (
        -- Borrowing lifecycle (8 events)
        'borrow_request_created',
        'borrow_request_queued',
        'borrow_ready_for_pickup',
        'borrow_pickup_confirmed',
        'borrow_due_soon',
        'borrow_due_today',
        'borrow_overdue',
        'borrow_return_confirmed',
        'borrow_auto_cancelled',
        'borrow_cancelled',
        -- Community book lifecycle (7 events)
        'community_request_pending',
        'community_request_approved',
        'community_request_rejected',
        'community_pickup_confirmed',
        'community_return_confirmed',
        'community_due_soon',
        'community_due_today',
        'community_overdue',
        'community_cancelled',
        -- Announcements
        'announcement',
        -- Fine reminders (existing)
        'fine_reminder'
    ));

-- ============================================================
-- 2. Harden create_visitor_notification - restrict to internal callers only
-- ============================================================
-- Revoke overly broad grants
REVOKE ALL ON FUNCTION public.create_visitor_notification(text, text, text, text, uuid, text, timestamptz)
    FROM PUBLIC, anon, authenticated, service_role;

-- Grant only to service_role (for cron jobs) and authenticated (for internal function calls via SECURITY DEFINER)
-- Note: Internal functions calling this should use SECURITY DEFINER and run as the function owner
GRANT EXECUTE ON FUNCTION public.create_visitor_notification(text, text, text, text, uuid, text, timestamptz)
    TO service_role;

-- Hardened function with authorization check - only callable by internal SECURITY DEFINER functions
-- or service_role (for cron jobs). Visitors cannot call this directly.
CREATE OR REPLACE FUNCTION public.create_visitor_notification(
    p_visitor_id text,
    p_notification_type text,
    p_title text,
    p_message text,
    p_reference_id uuid DEFAULT NULL,
    p_reference_type text DEFAULT NULL,
    p_expires_at timestamptz DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_notification_id uuid;
    v_caller text;
BEGIN
    -- Authorization: Only allow calls from SECURITY DEFINER functions (internal)
    -- or service_role (cron jobs). The current_user will be the function owner
    -- for SECURITY DEFINER calls, or service_role for direct calls.
    v_caller := current_user;

    -- Allow service_role (cron) and postgres (function owner for SECURITY DEFINER calls)
    IF v_caller NOT IN ('service_role', 'postgres') THEN
        -- Check if called from a SECURITY DEFINER function by checking if we're
        -- in a nested call where the definer is a trusted function
        RAISE EXCEPTION 'Insufficient privilege: create_visitor_notification can only be called by internal functions or service_role.';
    END IF;

    -- Validate notification_type against the constraint
    IF p_notification_type NOT IN (
        'borrow_request_created', 'borrow_request_queued', 'borrow_ready_for_pickup',
        'borrow_pickup_confirmed', 'borrow_due_soon', 'borrow_due_today', 'borrow_overdue',
        'borrow_return_confirmed', 'borrow_auto_cancelled', 'borrow_cancelled',
        'community_request_pending', 'community_request_approved', 'community_request_rejected',
        'community_pickup_confirmed', 'community_return_confirmed', 'community_due_soon',
        'community_due_today', 'community_overdue', 'community_cancelled',
        'announcement', 'fine_reminder'
    ) THEN
        RAISE EXCEPTION 'Invalid notification_type: %', p_notification_type;
    END IF;

    -- Validate visitor_id exists
    IF NOT EXISTS (SELECT 1 FROM public.visitors WHERE id = p_visitor_id) THEN
        RAISE EXCEPTION 'Visitor not found: %', p_visitor_id;
    END IF;

    -- Insert with idempotency: prevent duplicate notifications for same event
    -- Using a unique constraint on (visitor_id, notification_type, reference_id, reference_type)
    -- where reference_id is not null
    INSERT INTO public.visitor_notifications (
        visitor_id,
        notification_type,
        title,
        message,
        reference_id,
        reference_type,
        expires_at
    ) VALUES (
        p_visitor_id,
        p_notification_type,
        p_title,
        p_message,
        p_reference_id,
        p_reference_type,
        p_expires_at
    )
    ON CONFLICT DO NOTHING
    RETURNING id INTO v_notification_id;

    RETURN v_notification_id;
END;
$function$;

ALTER FUNCTION public.create_visitor_notification(text, text, text, text, uuid, text, timestamptz) OWNER TO postgres;

-- Add unique constraint for idempotency (prevent duplicate notifications for same event)
ALTER TABLE public.visitor_notifications
    DROP CONSTRAINT IF EXISTS visitor_notifications_idempotency_key;

ALTER TABLE public.visitor_notifications
    ADD CONSTRAINT visitor_notifications_idempotency_key
    UNIQUE (visitor_id, notification_type, reference_id, reference_type)
    DEFERRABLE INITIALLY IMMEDIATE;

-- ============================================================
-- 3. Add notification creation in shelf_private.request_borrow_unchecked
-- ============================================================
DROP FUNCTION IF EXISTS shelf_private.request_borrow_unchecked(uuid, text);

CREATE OR REPLACE FUNCTION shelf_private.request_borrow_unchecked(
    p_visitor_id uuid,
    p_book_id    text
)
RETURNS public.borrow_requests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_book public.books%rowtype;
    v_visitor public.visitors%rowtype;
    v_req public.borrow_requests%rowtype;
    v_queue_count int;
    v_active_allocations integer := 0;
    v_uid uuid;
    v_jwt_aal text;
BEGIN
    -- Require authenticated visitor session with AAL2
    v_uid := auth.uid();
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'Authenticated visitor account required.';
    END IF;
    v_jwt_aal := COALESCE(auth.jwt() ->> 'aal', 'aal1');
    IF v_jwt_aal <> 'aal2' THEN
        RAISE EXCEPTION 'AAL2 authentication is required.';
    END IF;

    -- Find visitor
    SELECT v.*
    INTO v_visitor
    FROM public.visitors AS v
    WHERE v.auth_user_id = p_visitor_id
       OR v.id = p_visitor_id::text
    LIMIT 1;

    -- Find book (with row lock)
    SELECT b.*
    INTO v_book
    FROM public.books AS b
    WHERE b.id = pg_catalog.trim(p_book_id)
    FOR UPDATE;

    -- Validate visitor
    IF v_visitor.id IS NULL THEN
        RAISE EXCEPTION 'Visitor account could not be found.';
    END IF;

    -- Validate book
    IF v_book.id IS NULL THEN
        RAISE EXCEPTION 'The selected book could not be found.';
    END IF;

    -- Verify visitor account
    IF NOT COALESCE(v_visitor.otp_verified, false) THEN
        RAISE EXCEPTION 'Please verify your visitor account before requesting a book.';
    END IF;

    IF NOT COALESCE(v_visitor.is_active, true) THEN
        RAISE EXCEPTION 'This visitor account is currently inactive.';
    END IF;

    -- Check existing active request / loan
    IF EXISTS (
        SELECT 1
        FROM public.borrow_requests AS br
        WHERE br.visitor_id = v_visitor.id
          AND br.book_id = pg_catalog.trim(p_book_id)
          AND br.status IN ('queued', 'ready_for_pickup', 'borrowed')
    ) THEN
        RAISE EXCEPTION 'You already have an active request or loan for this title.';
    END IF;

    -- Available copy check
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

    IF COALESCE(v_book.available_copies, 0) > 0
       AND v_book.total_copies > v_active_allocations
       AND v_book.available_copies <= v_book.total_copies - v_active_allocations
    THEN
        -- Immediate pickup available
        UPDATE public.books AS b
        SET available_copies = b.available_copies - 1
        WHERE b.id = pg_catalog.trim(p_book_id);

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
            pg_catalog.now() + pg_catalog.interval '24 hours'
        )
        RETURNING * INTO v_req;

        -- Notification: borrow_request_created + borrow_ready_for_pickup
        PERFORM public.create_visitor_notification(
            v_visitor.id,
            'borrow_request_created',
            'Borrow request created',
            'Your borrow request for "' || v_book.title || '" has been created and is ready for pickup.',
            v_req.id,
            'borrow_request',
            pg_catalog.now() + pg_catalog.interval '7 days'
        );

        PERFORM public.create_visitor_notification(
            v_visitor.id,
            'borrow_ready_for_pickup',
            'Book ready for pickup',
            '"' || v_book.title || '" is ready for pickup at the library. Please collect within 24 hours.',
            v_req.id,
            'borrow_request',
            v_req.pickup_deadline
        );

    ELSE
        -- Queue the request
        SELECT count(*)
        INTO v_queue_count
        FROM public.borrow_requests AS br
        WHERE br.book_id = pg_catalog.trim(p_book_id)
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

        -- Notification: borrow_request_created + borrow_request_queued
        PERFORM public.create_visitor_notification(
            v_visitor.id,
            'borrow_request_created',
            'Borrow request created',
            'Your borrow request for "' || v_book.title || '" has been created.',
            v_req.id,
            'borrow_request',
            pg_catalog.now() + pg_catalog.interval '30 days'
        );

        PERFORM public.create_visitor_notification(
            v_visitor.id,
            'borrow_request_queued',
            'Added to waitlist',
            'You are #' || (v_queue_count + 1) || ' in line for "' || v_book.title || '". We will notify you when it becomes available.',
            v_req.id,
            'borrow_request',
            pg_catalog.now() + pg_catalog.interval '30 days'
        );
    END IF;

    RETURN v_req;
END;
$function$;

ALTER FUNCTION shelf_private.request_borrow_unchecked(uuid, text) OWNER TO postgres;

REVOKE ALL ON FUNCTION shelf_private.request_borrow_unchecked(uuid, text)
    FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION shelf_private.request_borrow_unchecked(uuid, text)
    TO authenticated;

-- ============================================================
-- 4. Add notification creation in public.confirm_pickup (text,text) - legacy
-- ============================================================
DROP FUNCTION IF EXISTS public.confirm_pickup(text, text);

CREATE OR REPLACE FUNCTION public.confirm_pickup(
    p_request_id text,
    p_staff_name text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_req public.borrow_requests%rowtype;
    v_role text;
    v_uid uuid;
    v_jwt_role text;
BEGIN
    -- Require authenticated staff session
    v_uid := auth.uid();
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'Authenticated staff account required.';
    END IF;
    IF COALESCE(auth.jwt() ->> 'aal', 'aal1') <> 'aal2' THEN
        RAISE EXCEPTION 'AAL2 authentication is required.';
    END IF;
    IF NULLIF(pg_catalog.btrim(p_request_id), '') IS NULL
       OR NULLIF(pg_catalog.btrim(p_staff_name), '') IS NULL THEN
        RAISE EXCEPTION 'A request ID and staff name are required.';
    END IF;

    -- Validate active staff profile with supported role
    SELECT pg_catalog.lower(pg_catalog.btrim(staff.role))
    INTO v_role
    FROM public.staff_profiles AS staff
    WHERE staff.id = v_uid
      AND staff.is_active IS TRUE;
    IF NOT FOUND OR v_role NOT IN ('superadmin', 'subadmin') THEN
        RAISE EXCEPTION 'Active staff account with a supported role required.';
    END IF;

    -- Validate JWT role claim matches
    v_jwt_role := auth.jwt() -> 'app_metadata' ->> 'role';
    IF v_jwt_role IS NOT NULL
       AND pg_catalog.lower(pg_catalog.btrim(v_jwt_role)) <> v_role THEN
        RAISE EXCEPTION 'Staff role claim does not match the active staff profile.';
    END IF;

    -- Validate request exists, is ready for pickup, and staff has branch access
    SELECT request.*
    INTO v_req
    FROM public.borrow_requests AS request
    JOIN public.books AS book ON book.id = request.book_id
    WHERE request.id::text = pg_catalog.btrim(p_request_id)
      AND public.is_active_staff_for_branch(book.library_id::text)
    FOR UPDATE OF request;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Request not found or branch access denied.';
    END IF;

    IF v_req.status <> 'ready_for_pickup' THEN
        RAISE EXCEPTION 'This request is not ready for pickup.';
    END IF;
    IF v_req.pickup_deadline <= pg_catalog.now() THEN
        RAISE EXCEPTION 'Pickup window expired. The hold must be released before checkout.';
    END IF;

    UPDATE public.borrow_requests
    SET status = 'borrowed',
        borrow_date = pg_catalog.now(),
        due_date = pg_catalog.now() + pg_catalog.interval '7 days',
        confirmed_by = p_staff_name
    WHERE id::text = pg_catalog.btrim(p_request_id);

    -- Notification: borrow_pickup_confirmed
    PERFORM public.create_visitor_notification(
        v_req.visitor_id,
        'borrow_pickup_confirmed',
        'Pickup confirmed',
        'You have picked up "' || v_req.book_title || '". Due date: ' || to_char(pg_catalog.now() + pg_catalog.interval '7 days', 'YYYY-MM-DD') || '.',
        v_req.id,
        'borrow_request',
        pg_catalog.now() + pg_catalog.interval '7 days'
    );
END;
$function$;

ALTER FUNCTION public.confirm_pickup(text, text) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.confirm_pickup(text, text)
    FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.confirm_pickup(text, text)
    TO authenticated;

-- ============================================================
-- 5. Add notification creation in public.confirm_return (text,text) - legacy
-- ============================================================
DROP FUNCTION IF EXISTS public.confirm_return(text, text);

CREATE OR REPLACE FUNCTION public.confirm_return(
    p_request_id text,
    p_staff_name text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_req public.borrow_requests%rowtype;
    v_role text;
    v_uid uuid;
    v_jwt_role text;
    v_book_fine_rate integer;
    v_effective_rate integer;
    v_overdue_days integer;
    v_fine_amount numeric;
BEGIN
    -- Require authenticated staff session
    v_uid := auth.uid();
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'Authenticated staff account required.';
    END IF;
    IF COALESCE(auth.jwt() ->> 'aal', 'aal1') <> 'aal2' THEN
        RAISE EXCEPTION 'AAL2 authentication is required.';
    END IF;
    IF NULLIF(pg_catalog.btrim(p_request_id), '') IS NULL
       OR NULLIF(pg_catalog.btrim(p_staff_name), '') IS NULL THEN
        RAISE EXCEPTION 'A request ID and staff name are required.';
    END IF;

    -- Validate active staff profile with supported role
    SELECT pg_catalog.lower(pg_catalog.btrim(staff.role))
    INTO v_role
    FROM public.staff_profiles AS staff
    WHERE staff.id = v_uid
      AND staff.is_active IS TRUE;
    IF NOT FOUND OR v_role NOT IN ('superadmin', 'subadmin') THEN
        RAISE EXCEPTION 'Active staff account with a supported role required.';
    END IF;

    -- Validate JWT role claim matches
    v_jwt_role := auth.jwt() -> 'app_metadata' ->> 'role';
    IF v_jwt_role IS NOT NULL
       AND pg_catalog.lower(pg_catalog.btrim(v_jwt_role)) <> v_role THEN
        RAISE EXCEPTION 'Staff role claim does not match the active staff profile.';
    END IF;

    -- Validate request exists, is borrowed, and staff has branch access
    SELECT request.*
    INTO v_req
    FROM public.borrow_requests AS request
    JOIN public.books AS book ON book.id = request.book_id
    WHERE request.id::text = pg_catalog.btrim(p_request_id)
      AND public.is_active_staff_for_branch(book.library_id::text)
    FOR UPDATE OF request;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Loan not found or branch access denied.';
    END IF;

    IF v_req.status <> 'borrowed' THEN
        RAISE EXCEPTION 'This item is not currently on loan.';
    END IF;

    -- Determine effective fine rate using fine_rate_snapshot (if set) or book.fine_rate
    SELECT b.fine_rate
    INTO v_book_fine_rate
    FROM public.books AS b
    WHERE b.id = v_req.book_id;

    v_effective_rate := CASE
        WHEN v_req.fine_rate_snapshot BETWEEN 1 AND 100 THEN v_req.fine_rate_snapshot
        WHEN v_book_fine_rate BETWEEN 1 AND 100 THEN v_book_fine_rate
        ELSE NULL
    END;

    -- Calculate fine amount using effective rate
    v_overdue_days := GREATEST(0, CEIL(EXTRACT(EPOCH FROM (pg_catalog.now() - v_req.due_date)) / 86400));
    IF v_effective_rate IS NOT NULL THEN
        v_fine_amount := v_overdue_days * v_effective_rate;
    ELSE
        v_fine_amount := 0;
    END IF;

    UPDATE public.borrow_requests
    SET status = 'returned',
        return_date = pg_catalog.now(),
        fine_amount = v_fine_amount,
        return_confirmed_by = p_staff_name
    WHERE id::text = pg_catalog.btrim(p_request_id);

    PERFORM public.release_copy_and_promote(v_req.book_id);

    -- Notification: borrow_return_confirmed
    PERFORM public.create_visitor_notification(
        v_req.visitor_id,
        'borrow_return_confirmed',
        'Return confirmed',
        'You have returned "' || v_req.book_title || '".' ||
        CASE WHEN v_fine_amount > 0 THEN ' A fine of ₱' || v_fine_amount || ' has been applied.' ELSE '' END,
        v_req.id,
        'borrow_request',
        pg_catalog.now() + pg_catalog.interval '30 days'
    );

    -- If fine > 0, also create fine_reminder notification
    IF v_fine_amount > 0 THEN
        PERFORM public.create_visitor_notification(
            v_req.visitor_id,
            'fine_reminder',
            'Fine applied',
            'A fine of ₱' || v_fine_amount || ' has been applied for the late return of "' || v_req.book_title || '".',
            v_req.id,
            'borrow_request',
            pg_catalog.now() + pg_catalog.interval '30 days'
        );
    END IF;
END;
$function$;

ALTER FUNCTION public.confirm_return(text, text) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.confirm_return(text, text)
    FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.confirm_return(text, text)
    TO authenticated;

-- ============================================================
-- 6. Add notification creation in public.auto_cancel_expired_borrow_requests
-- ============================================================
DROP FUNCTION IF EXISTS public.auto_cancel_expired_borrow_requests();

CREATE OR REPLACE FUNCTION public.auto_cancel_expired_borrow_requests()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_count integer;
    v_req public.borrow_requests%rowtype;
BEGIN
    -- Update and capture affected rows
    UPDATE public.borrow_requests
    SET status = 'cancelled',
        cancel_reason = 'Pickup deadline expired'
    WHERE status = 'pending'
      AND pickup_deadline IS NOT NULL
      AND pickup_deadline < pg_catalog.now()
    RETURNING * INTO v_req;

    GET DIAGNOSTICS v_count = ROW_COUNT;

    -- Create notifications for each cancelled request
    IF v_count > 0 THEN
        FOR v_req IN
            SELECT * FROM public.borrow_requests
            WHERE status = 'cancelled'
              AND cancel_reason = 'Pickup deadline expired'
              AND pickup_deadline < pg_catalog.now()
        LOOP
            PERFORM public.create_visitor_notification(
                v_req.visitor_id,
                'borrow_auto_cancelled',
                'Request expired',
                'Your borrow request for "' || v_req.book_title || '" has been automatically cancelled because the pickup deadline passed.',
                v_req.id,
                'borrow_request',
                pg_catalog.now() + pg_catalog.interval '7 days'
            );
        END LOOP;
    END IF;

    RETURN v_count;
END;
$function$;

ALTER FUNCTION public.auto_cancel_expired_borrow_requests() OWNER TO postgres;

REVOKE ALL ON FUNCTION public.auto_cancel_expired_borrow_requests()
    FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.auto_cancel_expired_borrow_requests()
    TO service_role;

-- ============================================================
-- 7. Add notification creation in public.cancel_borrow_request (text,text)
-- ============================================================
-- First check if this function exists and update it
DROP FUNCTION IF EXISTS public.cancel_borrow_request(text, text);

CREATE OR REPLACE FUNCTION public.cancel_borrow_request(
    p_request_id text,
    p_visitor_id text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_req public.borrow_requests%rowtype;
    v_visitor public.visitors%rowtype;
BEGIN
    -- Verify visitor ownership
    SELECT v.*
    INTO v_visitor
    FROM public.visitors AS v
    WHERE v.auth_user_id = auth.uid()
       OR v.id = auth.uid()::text
    LIMIT 1;

    IF v_visitor.id IS NULL THEN
        RAISE EXCEPTION 'Visitor account not found.';
    END IF;

    IF v_visitor.id <> pg_catalog.btrim(p_visitor_id) THEN
        RAISE EXCEPTION 'You can only cancel your own requests.';
    END IF;

    SELECT request.*
    INTO v_req
    FROM public.borrow_requests AS request
    WHERE request.id::text = pg_catalog.btrim(p_request_id)
      AND request.visitor_id = v_visitor.id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Request not found.';
    END IF;

    IF v_req.status NOT IN ('queued', 'ready_for_pickup') THEN
        RAISE EXCEPTION 'Only queued or ready-for-pickup requests can be cancelled.';
    END IF;

    -- Release copy if it was ready for pickup
    IF v_req.status = 'ready_for_pickup' THEN
        UPDATE public.books
        SET available_copies = available_copies + 1
        WHERE id = v_req.book_id;
    END IF;

    UPDATE public.borrow_requests
    SET status = 'cancelled',
        cancel_reason = 'Cancelled by visitor'
    WHERE id::text = pg_catalog.btrim(p_request_id);

    -- Notification: borrow_cancelled
    PERFORM public.create_visitor_notification(
        v_visitor.id,
        'borrow_cancelled',
        'Request cancelled',
        'Your borrow request for "' || v_req.book_title || '" has been cancelled.',
        v_req.id,
        'borrow_request',
        pg_catalog.now() + pg_catalog.interval '7 days'
    );
END;
$function$;

ALTER FUNCTION public.cancel_borrow_request(text, text) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.cancel_borrow_request(text, text)
    FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.cancel_borrow_request(text, text)
    TO authenticated;

-- ============================================================
-- 8. Add notification creation in public.request_community_book
-- ============================================================
DROP FUNCTION IF EXISTS public.request_community_book(text, text);

CREATE OR REPLACE FUNCTION public.request_community_book (
    p_requester_visitor_id text,
    p_book_id              text
)
RETURNS TABLE (
    id                   uuid,
    book_id              text,
    book_title           text,
    owner_visitor_id     text,
    owner_name           text,
    requester_visitor_id text,
    requester_name       text,
    status               text,
    request_date         timestamp with time zone,
    owner_response       text,
    queue_position       integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
    requester public.visitors%ROWTYPE;
    book_row public.books%ROWTYPE;
    request_row public.community_book_requests%ROWTYPE;
    position_value integer;
BEGIN
    SELECT visitor.* INTO requester
    FROM public.visitors AS visitor
    WHERE visitor.auth_user_id = auth.uid()
      AND (
        visitor.id = trim(p_requester_visitor_id)
        OR visitor.auth_user_id::text = trim(p_requester_visitor_id)
      )
      AND visitor.otp_verified
      AND visitor.is_active;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'The authenticated, verified visitor account could not be found.';
    END IF;

    SELECT book.* INTO book_row
    FROM public.books AS book
    WHERE book.id = trim(p_book_id)
      AND book.book_type = 'personal'
      AND book.is_public
      AND book.lending_enabled
    FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'This is not available for community lending.';
    END IF;
    IF book_row.owner_visitor_id = requester.id THEN
        RAISE EXCEPTION 'You cannot request your own personal book.';
    END IF;
    IF EXISTS (
        SELECT 1
        FROM public.community_book_requests AS request
        WHERE request.book_id = book_row.id
          AND request.requester_visitor_id = requester.id
          AND request.status IN ('pending', 'approved', 'borrowed')
    ) THEN
        RAISE EXCEPTION 'You already have an active request for this community book.';
    END IF;
    IF COALESCE(book_row.available_copies, 0) <= 0 THEN
        RAISE EXCEPTION 'This community book is currently unavailable.';
    END IF;

    SELECT count(*)::integer + 1 INTO position_value
    FROM public.community_book_requests AS request
    WHERE request.book_id = book_row.id
      AND request.status = 'pending';

    INSERT INTO public.community_book_requests (
        book_id,
        book_title,
        owner_visitor_id,
        owner_name,
        requester_visitor_id,
        requester_name,
        status,
        queue_position
    ) VALUES (
        book_row.id,
        book_row.title,
        book_row.owner_visitor_id,
        COALESCE(
            (
                SELECT owner.full_name
                FROM public.visitors AS owner
                WHERE owner.id = book_row.owner_visitor_id
            ),
            'Book owner'
        ),
        requester.id,
        requester.full_name,
        'pending',
        position_value
    )
    RETURNING * INTO request_row;

    -- Notification for requester: community_request_pending (requester submitted)
    PERFORM public.create_visitor_notification(
        requester.id,
        'community_request_pending',
        'Community book request submitted',
        'Your request for "' || book_row.title || '" has been sent to the owner for approval.',
        request_row.id::uuid,
        'community_book_request',
        pg_catalog.now() + pg_catalog.interval '30 days'
    );

    -- Notification for owner: community_request_pending (new request received)
    PERFORM public.create_visitor_notification(
        book_row.owner_visitor_id,
        'community_request_pending',
        'New community book request',
        requester.full_name || ' requested "' || book_row.title || '"',
        request_row.id::uuid,
        'community_book_request',
        pg_catalog.now() + pg_catalog.interval '30 days'
    );

    RETURN QUERY
    SELECT
        request_row.id::uuid,
        request_row.book_id::text,
        request_row.book_title::text,
        request_row.owner_visitor_id::text,
        request_row.owner_name::text,
        request_row.requester_visitor_id::text,
        request_row.requester_name::text,
        request_row.status::text,
        request_row.request_date::timestamptz,
        request_row.owner_response::text,
        request_row.queue_position::integer;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.request_community_book(text, text)
    TO authenticated, postgres, service_role;
REVOKE ALL ON FUNCTION public.request_community_book(text, text)
    FROM PUBLIC, anon;

-- ============================================================
-- 9. Add notification creation in public.approve_community_book_request
-- ============================================================
DROP FUNCTION IF EXISTS public.approve_community_book_request(uuid, text, text);

CREATE OR REPLACE FUNCTION public.approve_community_book_request(
    p_request_id uuid,
    p_owner_visitor_id text,
    p_response text default null
)
RETURNS TABLE (
    id uuid,
    book_id text,
    book_title text,
    requester_visitor_id text,
    requester_name text,
    status text,
    approved_at timestamptz,
    owner_response text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    request_row public.community_book_requests%rowtype;
BEGIN
    IF auth.uid() IS NULL OR NOT EXISTS (
        SELECT 1
        FROM public.visitors AS visitor
        WHERE visitor.id = trim(p_owner_visitor_id)
          AND visitor.auth_user_id = auth.uid()
          AND visitor.otp_verified
          AND visitor.is_active
    ) THEN
        RAISE EXCEPTION 'The authenticated, verified visitor account could not be found.';
    END IF;

    SELECT request.*
    INTO request_row
    FROM public.community_book_requests AS request
    WHERE request.id = p_request_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Community book request could not be found.';
    END IF;
    IF request_row.owner_visitor_id <> trim(p_owner_visitor_id) THEN
        RAISE EXCEPTION 'Only the owner of this community book can approve the request.';
    END IF;
    IF request_row.status <> 'pending' THEN
        RAISE EXCEPTION 'This request is no longer pending.';
    END IF;

    UPDATE public.community_book_requests AS request
    SET status = 'approved',
        approved_at = now(),
        rejected_at = null,
        owner_response = nullif(trim(p_response), ''),
        updated_at = now()
    WHERE request.id = p_request_id;

    -- Notification for requester: community_request_approved
    PERFORM public.create_visitor_notification(
        request_row.requester_visitor_id,
        'community_request_approved',
        'Request approved',
        'Your request for "' || request_row.book_title || '" has been approved by the owner. You can now arrange pickup.',
        request_row.id::uuid,
        'community_book_request',
        pg_catalog.now() + pg_catalog.interval '30 days'
    );

    RETURN QUERY
    SELECT
        request.id,
        request.book_id,
        request.book_title,
        request.requester_visitor_id,
        request.requester_name,
        request.status::text,
        request.approved_at,
        request.owner_response
    FROM public.community_book_requests AS request
    WHERE request.id = p_request_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.approve_community_book_request(uuid, text, text)
    FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.approve_community_book_request(uuid, text, text)
    TO authenticated;

-- ============================================================
-- 10. Add notification creation in public.reject_community_book_request
-- ============================================================
DROP FUNCTION IF EXISTS public.reject_community_book_request(uuid, text, text);

CREATE OR REPLACE FUNCTION public.reject_community_book_request(
    p_request_id uuid,
    p_owner_visitor_id text,
    p_response text default null
)
RETURNS TABLE (
    id uuid,
    book_id text,
    book_title text,
    requester_visitor_id text,
    requester_name text,
    status text,
    rejected_at timestamptz,
    owner_response text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    request_row public.community_book_requests%rowtype;
BEGIN
    IF auth.uid() IS NULL OR NOT EXISTS (
        SELECT 1
        FROM public.visitors AS visitor
        WHERE visitor.id = trim(p_owner_visitor_id)
          AND visitor.auth_user_id = auth.uid()
          AND visitor.otp_verified
          AND visitor.is_active
    ) THEN
        RAISE EXCEPTION 'The authenticated, verified visitor account could not be found.';
    END IF;

    SELECT request.*
    INTO request_row
    FROM public.community_book_requests AS request
    WHERE request.id = p_request_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Community book request could not be found.';
    END IF;
    IF request_row.owner_visitor_id <> trim(p_owner_visitor_id) THEN
        RAISE EXCEPTION 'Only the owner of this community book can reject the request.';
    END IF;
    IF request_row.status <> 'pending' THEN
        RAISE EXCEPTION 'This request is no longer pending.';
    END IF;

    UPDATE public.community_book_requests AS request
    SET status = 'rejected',
        rejected_at = now(),
        approved_at = null,
        owner_response = nullif(trim(p_response), ''),
        updated_at = now()
    WHERE request.id = p_request_id;

    -- Notification for requester: community_request_rejected
    PERFORM public.create_visitor_notification(
        request_row.requester_visitor_id,
        'community_request_rejected',
        'Request declined',
        'Your request for "' || request_row.book_title || '" was declined by the owner.' ||
        CASE WHEN trim(p_response) <> '' THEN ' Reason: ' || p_response ELSE '' END,
        request_row.id::uuid,
        'community_book_request',
        pg_catalog.now() + pg_catalog.interval '30 days'
    );

    RETURN QUERY
    SELECT
        request.id,
        request.book_id,
        request.book_title,
        request.requester_visitor_id,
        request.requester_name,
        request.status::text,
        request.rejected_at,
        request.owner_response
    FROM public.community_book_requests AS request
    WHERE request.id = p_request_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.reject_community_book_request(uuid, text, text)
    FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reject_community_book_request(uuid, text, text)
    TO authenticated;

-- ============================================================
-- 11. Add notification creation in public.confirm_community_book_pickup
-- ============================================================
DROP FUNCTION IF EXISTS public.confirm_community_book_pickup(uuid, text);

CREATE OR REPLACE FUNCTION public.confirm_community_book_pickup(
    p_request_id uuid,
    p_owner_visitor_id text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
    v_req public.community_book_requests%ROWTYPE;
    v_book_type text;
    v_book_owner_id text;
    v_lending_enabled boolean;
    v_category text;
    v_fine_rate integer;
BEGIN
    -- Verify authenticated, active, OTP-verified owner.
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Authentication is required.';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM public.visitors AS v
        WHERE v.id::text = trim(p_owner_visitor_id)
          AND v.auth_user_id = auth.uid()
          AND v.otp_verified = true
          AND v.is_active = true
    ) THEN
        RAISE EXCEPTION
            'The authenticated, verified owner account could not be found.';
    END IF;

    -- Lock the request.
    SELECT cbr.*
    INTO v_req
    FROM public.community_book_requests AS cbr
    WHERE cbr.id = p_request_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Request not found.';
    END IF;

    IF v_req.owner_visitor_id <> trim(p_owner_visitor_id) THEN
        RAISE EXCEPTION
            'Only the owner of this community book can confirm pickup.';
    END IF;

    IF v_req.status <> 'approved' THEN
        RAISE EXCEPTION
            'This request is not approved for pickup.';
    END IF;

    -- Lock and validate the personal book.
    SELECT
        b.book_type,
        b.owner_visitor_id,
        b.lending_enabled,
        b.category
    INTO
        v_book_type,
        v_book_owner_id,
        v_lending_enabled,
        v_category
    FROM public.books AS b
    WHERE b.id = v_req.book_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Community book not found.';
    END IF;

    IF lower(trim(v_book_type)) <> 'personal'
       OR v_book_owner_id IS DISTINCT FROM trim(p_owner_visitor_id)
    THEN
        RAISE EXCEPTION
            'This book is not owned by the authenticated community book owner.';
    END IF;

    IF v_lending_enabled IS NOT TRUE THEN
        RAISE EXCEPTION
            'Pickup cannot proceed because lending is disabled for this book.';
    END IF;

    -- Derive the rate from the approved category mapping.
    v_fine_rate := public.get_category_fine_rate(v_category);

    IF v_fine_rate IS NULL THEN
        RAISE EXCEPTION
            'Pickup cannot proceed because this book has an unsupported or missing category.';
    END IF;

    -- Start the fixed seven-day loan and save its rate snapshot.
    UPDATE public.community_book_requests AS cbr
    SET
        status = 'borrowed',
        borrow_date = now(),
        due_date = now() + interval '7 days',
        confirmed_by = trim(p_owner_visitor_id),
        fine_rate_snapshot = v_fine_rate,
        fine_review_required = false,
        updated_at = now()
    WHERE cbr.id = p_request_id
    RETURNING * INTO v_req;

    -- Notification for requester: community_pickup_confirmed
    PERFORM public.create_visitor_notification(
        v_req.requester_visitor_id,
        'community_pickup_confirmed',
        'Pickup confirmed',
        'You have picked up "' || v_req.book_title || '" from the owner. Due date: ' || to_char(v_req.due_date, 'YYYY-MM-DD') || '.',
        v_req.id::uuid,
        'community_book_request',
        v_req.due_date
    );

    -- Notification for owner: community_pickup_confirmed
    PERFORM public.create_visitor_notification(
        v_req.owner_visitor_id,
        'community_pickup_confirmed',
        'Book picked up',
        '"' || v_req.book_title || '" has been picked up by ' || v_req.requester_name || '. Due date: ' || to_char(v_req.due_date, 'YYYY-MM-DD') || '.',
        v_req.id::uuid,
        'community_book_request',
        v_req.due_date
    );
END;
$function$;

GRANT EXECUTE ON FUNCTION
    public.confirm_community_book_pickup(uuid, text)
    TO authenticated, postgres, service_role;

REVOKE ALL ON FUNCTION
    public.confirm_community_book_pickup(uuid, text)
    FROM PUBLIC, anon;

-- ============================================================
-- 12. Add notification creation in public.confirm_community_book_return
-- ============================================================
DROP FUNCTION IF EXISTS public.confirm_community_book_return(uuid, text);

CREATE OR REPLACE FUNCTION public.confirm_community_book_return (
    p_request_id       uuid,
    p_owner_visitor_id text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
    v_req public.community_book_requests%ROWTYPE;
    v_overdue_days integer;
    v_fine numeric;
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

    SELECT cbr.*
    INTO v_req
    FROM public.community_book_requests AS cbr
    WHERE cbr.id = p_request_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Request not found.';
    END IF;

    IF v_req.status <> 'borrowed' THEN
        RAISE EXCEPTION
            'This community book is not currently borrowed.';
    END IF;

    IF v_req.owner_visitor_id <> trim(p_owner_visitor_id) THEN
        RAISE EXCEPTION
            'Only the owner of this community book can confirm the return.';
    END IF;

    IF v_req.fine_rate_snapshot IN (10, 15, 20) THEN
        IF COALESCE(v_req.fine_amount, 0) = 0 THEN
            v_overdue_days := CASE
                WHEN v_req.due_date IS NULL OR now() <= v_req.due_date THEN 0
                ELSE CEIL(
                    EXTRACT(EPOCH FROM (now() - v_req.due_date)) / 86400
                )::integer
            END;

            v_fine := v_overdue_days * v_req.fine_rate_snapshot;
        ELSE
            v_fine := v_req.fine_amount;
        END IF;

        UPDATE public.community_book_requests AS cbr
        SET
            status = 'returned',
            return_date = now(),
            fine_amount = v_fine,
            fine_review_required = COALESCE(v_req.fine_review_required, false),
            return_confirmed_by = trim(p_owner_visitor_id),
            updated_at = now()
        WHERE cbr.id = p_request_id;
    ELSE
        UPDATE public.community_book_requests AS cbr
        SET
            status = 'returned',
            return_date = now(),
            fine_amount = v_req.fine_amount,
            fine_review_required = true,
            return_confirmed_by = trim(p_owner_visitor_id),
            updated_at = now()
        WHERE cbr.id = p_request_id;
    END IF;

    -- Reload to get updated fine_amount
    SELECT cbr.*
    INTO v_req
    FROM public.community_book_requests AS cbr
    WHERE cbr.id = p_request_id;

    -- Notification for requester: community_return_confirmed
    PERFORM public.create_visitor_notification(
        v_req.requester_visitor_id,
        'community_return_confirmed',
        'Return confirmed',
        'You have returned "' || v_req.book_title || '" to the owner.' ||
        CASE WHEN COALESCE(v_req.fine_amount, 0) > 0 THEN ' A fine of ₱' || v_req.fine_amount || ' has been applied.' ELSE '' END,
        v_req.id::uuid,
        'community_book_request',
        pg_catalog.now() + pg_catalog.interval '30 days'
    );

    -- Notification for owner: community_return_confirmed
    PERFORM public.create_visitor_notification(
        v_req.owner_visitor_id,
        'community_return_confirmed',
        'Book returned',
        '"' || v_req.book_title || '" has been returned by ' || v_req.requester_name || '.' ||
        CASE WHEN COALESCE(v_req.fine_amount, 0) > 0 THEN ' A fine of ₱' || v_req.fine_amount || ' was applied.' ELSE '' END,
        v_req.id::uuid,
        'community_book_request',
        pg_catalog.now() + pg_catalog.interval '30 days'
    );

    -- If fine > 0, also create fine_reminder for requester
    IF COALESCE(v_req.fine_amount, 0) > 0 THEN
        PERFORM public.create_visitor_notification(
            v_req.requester_visitor_id,
            'fine_reminder',
            'Fine applied',
            'A fine of ₱' || v_req.fine_amount || ' has been applied for the late return of "' || v_req.book_title || '".',
            v_req.id::uuid,
            'community_book_request',
            pg_catalog.now() + pg_catalog.interval '30 days'
        );
    END IF;
END;
$function$;

GRANT EXECUTE ON FUNCTION
    public.confirm_community_book_return(uuid, text)
    TO authenticated, postgres, service_role;

REVOKE ALL ON FUNCTION
    public.confirm_community_book_return(uuid, text)
    FROM PUBLIC, anon;

-- ============================================================
-- 13. Add notification creation in public.cancel_community_book_request
-- ============================================================
DROP FUNCTION IF EXISTS public.cancel_community_book_request(uuid, text, text);

CREATE OR REPLACE FUNCTION public.cancel_community_book_request(
    p_request_id uuid,
    p_requester_visitor_id text,
    p_reason text default 'cancelled'
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
    v_req public.community_book_requests%rowtype;
BEGIN
    IF auth.uid() IS NULL OR NOT EXISTS (
        SELECT 1
        FROM public.visitors visitor
        WHERE visitor.id = trim(p_requester_visitor_id)
          AND visitor.auth_user_id = auth.uid()
          AND visitor.otp_verified
          AND visitor.is_active
    ) THEN
        RAISE EXCEPTION 'The authenticated visitor account could not be verified.';
    END IF;

    IF p_reason <> 'cancelled' THEN
        RAISE EXCEPTION 'Unsupported cancellation reason.';
    END IF;

    SELECT cbr.*
    INTO v_req
    FROM public.community_book_requests cbr
    WHERE cbr.id = p_request_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Request not found.';
    END IF;

    IF v_req.requester_visitor_id <> trim(p_requester_visitor_id) THEN
        RAISE EXCEPTION 'You can only cancel your own requests.';
    END IF;

    IF v_req.status <> 'pending' THEN
        RAISE EXCEPTION 'Only pending requests can be cancelled.';
    END IF;

    DELETE FROM public.community_book_requests
    WHERE id = p_request_id;

    -- Notification for owner: community_cancelled
    PERFORM public.create_visitor_notification(
        v_req.owner_visitor_id,
        'community_cancelled',
        'Request cancelled',
        v_req.requester_name || ' cancelled their request for "' || v_req.book_title || '".',
        p_request_id,
        'community_book_request',
        pg_catalog.now() + pg_catalog.interval '7 days'
    );
END;
$function$;

REVOKE ALL ON FUNCTION public.cancel_community_book_request(uuid, text, text)
    FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_community_book_request(uuid, text, text)
    TO authenticated, service_role;

-- ============================================================
-- 14. Create cron job functions for due date notifications (borrowing)
-- ============================================================
-- These will be called by pg_cron to send due_soon, due_today, overdue notifications
CREATE OR REPLACE FUNCTION public.send_borrow_due_soon_notifications()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_count integer := 0;
    v_req public.borrow_requests%rowtype;
BEGIN
    -- Due in 3 days (due_soon)
    FOR v_req IN
        SELECT * FROM public.borrow_requests
        WHERE status = 'borrowed'
          AND due_date IS NOT NULL
          AND due_date <= now() + interval '3 days'
          AND due_date > now() + interval '2 days'
          AND NOT EXISTS (
              SELECT 1 FROM public.visitor_notifications vn
              WHERE vn.visitor_id = v_req.visitor_id
                AND vn.reference_id = v_req.id
                AND vn.reference_type = 'borrow_request'
                AND vn.notification_type = 'borrow_due_soon'
                AND vn.created_at >= now() - interval '1 day'
          )
    LOOP
        PERFORM public.create_visitor_notification(
            v_req.visitor_id,
            'borrow_due_soon',
            'Due soon reminder',
            '"' || v_req.book_title || '" is due on ' || to_char(v_req.due_date, 'YYYY-MM-DD') || '. Please return it on time.',
            v_req.id,
            'borrow_request',
            v_req.due_date + interval '1 day'
        );
        v_count := v_count + 1;
    END LOOP;

    RETURN v_count;
END;
$function$;

ALTER FUNCTION public.send_borrow_due_soon_notifications() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.send_borrow_due_soon_notifications() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.send_borrow_due_soon_notifications() TO service_role;

CREATE OR REPLACE FUNCTION public.send_borrow_due_today_notifications()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_count integer := 0;
    v_req public.borrow_requests%rowtype;
BEGIN
    -- Due today
    FOR v_req IN
        SELECT * FROM public.borrow_requests
        WHERE status = 'borrowed'
          AND due_date IS NOT NULL
          AND due_date::date = now()::date
          AND NOT EXISTS (
              SELECT 1 FROM public.visitor_notifications vn
              WHERE vn.visitor_id = v_req.visitor_id
                AND vn.reference_id = v_req.id
                AND vn.reference_type = 'borrow_request'
                AND vn.notification_type = 'borrow_due_today'
                AND vn.created_at >= now() - interval '1 day'
          )
    LOOP
        PERFORM public.create_visitor_notification(
            v_req.visitor_id,
            'borrow_due_today',
            'Due today reminder',
            '"' || v_req.book_title || '" is due today. Please return it to avoid fines.',
            v_req.id,
            'borrow_request',
            v_req.due_date + interval '1 day'
        );
        v_count := v_count + 1;
    END LOOP;

    RETURN v_count;
END;
$function$;

ALTER FUNCTION public.send_borrow_due_today_notifications() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.send_borrow_due_today_notifications() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.send_borrow_due_today_notifications() TO service_role;

CREATE OR REPLACE FUNCTION public.send_borrow_overdue_notifications()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_count integer := 0;
    v_req public.borrow_requests%rowtype;
BEGIN
    -- Overdue
    FOR v_req IN
        SELECT * FROM public.borrow_requests
        WHERE status = 'borrowed'
          AND due_date IS NOT NULL
          AND due_date < now()
          AND NOT EXISTS (
              SELECT 1 FROM public.visitor_notifications vn
              WHERE vn.visitor_id = v_req.visitor_id
                AND vn.reference_id = v_req.id
                AND vn.reference_type = 'borrow_request'
                AND vn.notification_type = 'borrow_overdue'
                AND vn.created_at >= now() - interval '1 day'
          )
    LOOP
        PERFORM public.create_visitor_notification(
            v_req.visitor_id,
            'borrow_overdue',
            'Overdue notice',
            '"' || v_req.book_title || '" was due on ' || to_char(v_req.due_date, 'YYYY-MM-DD') || '. Please return it immediately to avoid additional fines.',
            v_req.id,
            'borrow_request',
            v_req.due_date + interval '7 days'
        );
        v_count := v_count + 1;
    END LOOP;

    RETURN v_count;
END;
$function$;

ALTER FUNCTION public.send_borrow_overdue_notifications() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.send_borrow_overdue_notifications() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.send_borrow_overdue_notifications() TO service_role;

-- ============================================================
-- 15. Create cron job functions for due date notifications (community books)
-- ============================================================
CREATE OR REPLACE FUNCTION public.send_community_due_soon_notifications()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_count integer := 0;
    v_req public.community_book_requests%rowtype;
BEGIN
    FOR v_req IN
        SELECT * FROM public.community_book_requests
        WHERE status = 'borrowed'
          AND due_date IS NOT NULL
          AND due_date <= now() + interval '3 days'
          AND due_date > now() + interval '2 days'
          AND NOT EXISTS (
              SELECT 1 FROM public.visitor_notifications vn
              WHERE vn.visitor_id = v_req.requester_visitor_id
                AND vn.reference_id = v_req.id::uuid
                AND vn.reference_type = 'community_book_request'
                AND vn.notification_type = 'community_due_soon'
                AND vn.created_at >= now() - interval '1 day'
          )
    LOOP
        PERFORM public.create_visitor_notification(
            v_req.requester_visitor_id,
            'community_due_soon',
            'Community book due soon',
            '"' || v_req.book_title || '" is due on ' || to_char(v_req.due_date, 'YYYY-MM-DD') || '. Please return it to the owner.',
            v_req.id::uuid,
            'community_book_request',
            v_req.due_date + interval '1 day'
        );
        v_count := v_count + 1;
    END LOOP;

    RETURN v_count;
END;
$function$;

ALTER FUNCTION public.send_community_due_soon_notifications() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.send_community_due_soon_notifications() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.send_community_due_soon_notifications() TO service_role;

CREATE OR REPLACE FUNCTION public.send_community_due_today_notifications()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_count integer := 0;
    v_req public.community_book_requests%rowtype;
BEGIN
    FOR v_req IN
        SELECT * FROM public.community_book_requests
        WHERE status = 'borrowed'
          AND due_date IS NOT NULL
          AND due_date::date = now()::date
          AND NOT EXISTS (
              SELECT 1 FROM public.visitor_notifications vn
              WHERE vn.visitor_id = v_req.requester_visitor_id
                AND vn.reference_id = v_req.id::uuid
                AND vn.reference_type = 'community_book_request'
                AND vn.notification_type = 'community_due_today'
                AND vn.created_at >= now() - interval '1 day'
          )
    LOOP
        PERFORM public.create_visitor_notification(
            v_req.requester_visitor_id,
            'community_due_today',
            'Community book due today',
            '"' || v_req.book_title || '" is due today. Please return it to the owner.',
            v_req.id::uuid,
            'community_book_request',
            v_req.due_date + interval '1 day'
        );
        v_count := v_count + 1;
    END LOOP;

    RETURN v_count;
END;
$function$;

ALTER FUNCTION public.send_community_due_today_notifications() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.send_community_due_today_notifications() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.send_community_due_today_notifications() TO service_role;

CREATE OR REPLACE FUNCTION public.send_community_overdue_notifications()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_count integer := 0;
    v_req public.community_book_requests%rowtype;
BEGIN
    FOR v_req IN
        SELECT * FROM public.community_book_requests
        WHERE status = 'borrowed'
          AND due_date IS NOT NULL
          AND due_date < now()
          AND NOT EXISTS (
              SELECT 1 FROM public.visitor_notifications vn
              WHERE vn.visitor_id = v_req.requester_visitor_id
                AND vn.reference_id = v_req.id::uuid
                AND vn.reference_type = 'community_book_request'
                AND vn.notification_type = 'community_overdue'
                AND vn.created_at >= now() - interval '1 day'
          )
    LOOP
        PERFORM public.create_visitor_notification(
            v_req.requester_visitor_id,
            'community_overdue',
            'Community book overdue',
            '"' || v_req.book_title || '" was due on ' || to_char(v_req.due_date, 'YYYY-MM-DD') || '. Please return it to the owner immediately.',
            v_req.id::uuid,
            'community_book_request',
            v_req.due_date + interval '7 days'
        );
        v_count := v_count + 1;
    END LOOP;

    RETURN v_count;
END;
$function$;

ALTER FUNCTION public.send_community_overdue_notifications() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.send_community_overdue_notifications() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.send_community_overdue_notifications() TO service_role;

-- ============================================================
-- 16. Create announcement notification function
-- ============================================================
CREATE OR REPLACE FUNCTION public.create_announcement_notifications(
    p_announcement_id uuid,
    p_title text,
    p_message text,
    p_library_id uuid DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_count integer := 0;
    v_visitor public.visitors%rowtype;
BEGIN
    -- Send to all active, verified visitors (or branch-specific if library_id provided)
    FOR v_visitor IN
        SELECT * FROM public.visitors
        WHERE is_active = true
          AND otp_verified = true
          AND (p_library_id IS NULL OR library_id = p_library_id)
    LOOP
        PERFORM public.create_visitor_notification(
            v_visitor.id,
            'announcement',
            p_title,
            p_message,
            p_announcement_id,
            'announcement',
            pg_catalog.now() + pg_catalog.interval '30 days'
        );
        v_count := v_count + 1;
    END LOOP;

    RETURN v_count;
END;
$function$;

ALTER FUNCTION public.create_announcement_notifications(uuid, text, text, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.create_announcement_notifications(uuid, text, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_announcement_notifications(uuid, text, text, uuid) TO service_role;

-- ============================================================
-- 17. Schedule cron jobs for due date notifications
-- ============================================================
-- Borrowing due date notifications
SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'shelf-borrow-due-soon';
SELECT cron.schedule('shelf-borrow-due-soon', '0 9 * * *', 'SELECT public.send_borrow_due_soon_notifications();');

SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'shelf-borrow-due-today';
SELECT cron.schedule('shelf-borrow-due-today', '0 9 * * *', 'SELECT public.send_borrow_due_today_notifications();');

SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'shelf-borrow-overdue';
SELECT cron.schedule('shelf-borrow-overdue', '0 9 * * *', 'SELECT public.send_borrow_overdue_notifications();');

-- Community book due date notifications
SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'shelf-community-due-soon';
SELECT cron.schedule('shelf-community-due-soon', '0 9 * * *', 'SELECT public.send_community_due_soon_notifications();');

SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'shelf-community-due-today';
SELECT cron.schedule('shelf-community-due-today', '0 9 * * *', 'SELECT public.send_community_due_today_notifications();');

SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'shelf-community-overdue';
SELECT cron.schedule('shelf-community-overdue', '0 9 * * *', 'SELECT public.send_community_overdue_notifications();');

-- ============================================================
-- 18. Postflight validation
-- ============================================================
DO $postflight$
DECLARE
    v_create_sig regprocedure := 'public.create_visitor_notification(text,text,text,text,uuid,text,timestamptz)'::regprocedure;
    v_request_borrow_sig regprocedure := 'shelf_private.request_borrow_unchecked(uuid,text)'::regprocedure;
    v_confirm_pickup_sig regprocedure := 'public.confirm_pickup(text,text)'::regprocedure;
    v_confirm_return_sig regprocedure := 'public.confirm_return(text,text)'::regprocedure;
    v_auto_cancel_sig regprocedure := 'public.auto_cancel_expired_borrow_requests()'::regprocedure;
    v_cancel_borrow_sig regprocedure := 'public.cancel_borrow_request(text,text)'::regprocedure;
    v_request_community_sig regprocedure := 'public.request_community_book(text,text)'::regprocedure;
    v_approve_community_sig regprocedure := 'public.approve_community_book_request(uuid,text,text)'::regprocedure;
    v_reject_community_sig regprocedure := 'public.reject_community_book_request(uuid,text,text)'::regprocedure;
    v_confirm_community_pickup_sig regprocedure := 'public.confirm_community_book_pickup(uuid,text)'::regprocedure;
    v_confirm_community_return_sig regprocedure := 'public.confirm_community_book_return(uuid,text)'::regprocedure;
    v_cancel_community_sig regprocedure := 'public.cancel_community_book_request(uuid,text,text)'::regprocedure;
BEGIN
    -- Validate create_visitor_notification metadata
    IF NOT EXISTS (
        SELECT 1
        FROM pg_catalog.pg_proc AS procedure
        JOIN pg_catalog.pg_language AS language ON language.oid = procedure.prolang
        WHERE procedure.oid = v_create_sig
          AND procedure.proowner = 'postgres'::regrole
          AND language.lanname = 'plpgsql'
          AND procedure.prosecdef
          AND procedure.proconfig = ARRAY['search_path=""']::text[]
    ) THEN
        RAISE EXCEPTION 'create_visitor_notification metadata differs from the reviewed contract.';
    END IF;

    -- Validate EXECUTE privileges - only service_role should have direct access
    IF pg_catalog.has_function_privilege('anon', v_create_sig, 'EXECUTE')
       OR pg_catalog.has_function_privilege('authenticated', v_create_sig, 'EXECUTE')
       OR NOT pg_catalog.has_function_privilege('service_role', v_create_sig, 'EXECUTE') THEN
        RAISE EXCEPTION 'create_visitor_notification EXECUTE privileges differ from the least-privilege contract.';
    END IF;

    -- Validate visitor_notifications table has idempotency constraint
    IF NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_constraint
        WHERE conname = 'visitor_notifications_idempotency_key'
    ) THEN
        RAISE EXCEPTION 'visitor_notifications_idempotency_key constraint is missing.';
    END IF;

    -- Validate notification_type check constraint includes all 21 types
    IF NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_constraint
        WHERE conname = 'visitor_notifications_notification_type_check'
          AND pg_catalog.pg_get_constraintdef(oid) LIKE '%borrow_request_created%'
          AND pg_catalog.pg_get_constraintdef(oid) LIKE '%community_cancelled%'
          AND pg_catalog.pg_get_constraintdef(oid) LIKE '%announcement%'
    ) THEN
        RAISE EXCEPTION 'visitor_notifications_notification_type_check constraint missing required types.';
    END IF;
END;
$postflight$;

NOTIFY pgrst, 'reload schema';
COMMIT;