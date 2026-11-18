-- Fix community borrowing workflow: approval safeguards, cancellation, queue promotion, inventory triggers
-- This migration restores safeguards accidentally dropped in 20270103000900 while preserving notifications

BEGIN;

-- ============================================================
-- 1. Helper: Community allocation promotion (separate from library release_copy_and_promote)
-- ============================================================
-- Promotes the next eligible pending community request when a copy becomes available
CREATE OR REPLACE FUNCTION public.promote_next_community_request(
    p_book_id text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_next public.community_book_requests%ROWTYPE;
    v_total integer;
    v_available integer;
    v_allocations integer := 0;
    v_allocations_after_promotion integer := 0;
    v_available_after_release integer := 0;
BEGIN
    -- Lock the book and recompute free stock from both request tables
    SELECT book.total_copies, book.available_copies
    INTO v_total, v_available
    FROM public.books AS book
    WHERE book.id::text = p_book_id
      AND book.book_type = 'personal'
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Personal book not found: %', p_book_id;
    END IF;

    -- Count current allocations (library + community)
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

    -- No free copy after release -> nothing to promote
    IF v_available_after_release < 1 THEN
        RETURN;
    END IF;

    -- Find next eligible pending request (FIFO by request_date, id)
    SELECT *
    INTO v_next
    FROM public.community_book_requests
    WHERE book_id::text = p_book_id
      AND status = 'pending'
    ORDER BY request_date ASC NULLS LAST, id ASC
    LIMIT 1
    FOR UPDATE;

    IF v_next.id IS NOT NULL THEN
        -- Approve the next request automatically (system promotion)
        UPDATE public.community_book_requests
        SET status = 'approved',
            approved_at = pg_catalog.now(),
            updated_at = pg_catalog.now()
        WHERE id = v_next.id;

        -- Decrement available_copies for the promoted request
        UPDATE public.books
        SET available_copies = available_copies - 1
        WHERE id::text = p_book_id;

        -- Verify we didn't exceed capacity
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
        INTO v_allocations_after_promotion;

        IF v_allocations_after_promotion > v_total THEN
            RAISE EXCEPTION
                'Community promotion exceeds inventory capacity for book %', p_book_id;
        END IF;

        -- Notify requester
        PERFORM public.create_visitor_notification(
            v_next.requester_visitor_id,
            'community_request_approved',
            'Request approved',
            'Your request for "' || v_next.book_title || '" has been approved. You can now arrange pickup.',
            v_next.id::uuid,
            'community_book_request',
            pg_catalog.now() + pg_catalog.interval '30 days'
        );

        -- Notify owner
        PERFORM public.create_visitor_notification(
            v_next.owner_visitor_id,
            'community_request_approved',
            'Request auto-approved (queue promotion)',
            '"' || v_next.book_title || '" was auto-approved for ' || v_next.requester_name || ' after a copy became available.',
            v_next.id::uuid,
            'community_book_request',
            pg_catalog.now() + pg_catalog.interval '30 days'
        );
    END IF;
END;
$function$;

ALTER FUNCTION public.promote_next_community_request(text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.promote_next_community_request(text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.promote_next_community_request(text) TO service_role, postgres;

-- ============================================================
-- 2. Fix approve_community_book_request - restore all safeguards
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
    available_count integer;
    total_count integer;
    active_allocations integer := 0;
BEGIN
    -- Verify authenticated, active, OTP-verified owner
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

    -- Lock the request
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

    -- Lock and verify the community book has an available copy
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

    -- Count all active allocations against this book (library + community)
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

    -- Preserve queue ordering: ensure no earlier pending request exists
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

    -- Approve the request
    UPDATE public.community_book_requests AS request
    SET
        status = 'approved',
        approved_at = now(),
        rejected_at = null,
        owner_response = nullif(trim(p_response), ''),
        updated_at = now()
    WHERE request.id = p_request_id
    RETURNING request.* INTO request_row;

    -- Decrement available_copies for the approved request
    UPDATE public.books
    SET available_copies = available_copies - 1
    WHERE id = request_row.book_id
      AND book_type = 'personal';

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

    -- Notification for owner: community_request_approved
    PERFORM public.create_visitor_notification(
        request_row.owner_visitor_id,
        'community_request_approved',
        'Request approved',
        'You approved the request for "' || request_row.book_title || '" from ' || request_row.requester_name || '.',
        request_row.id::uuid,
        'community_book_request',
        pg_catalog.now() + pg_catalog.interval '30 days'
    );

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

ALTER FUNCTION public.approve_community_book_request(uuid, text, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.approve_community_book_request(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.approve_community_book_request(uuid, text, text) TO authenticated;

-- ============================================================
-- 3. Fix cancel_community_book_request - handle all states, restore availability, promote queue
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
SET search_path = ''
AS $function$
DECLARE
    v_req public.community_book_requests%rowtype;
    v_book public.books%rowtype;
    v_is_owner boolean := false;
    v_caller_id text;
BEGIN
    -- Identify caller (requester or owner)
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Authentication required.';
    END IF;

    SELECT visitor.id
    INTO v_caller_id
    FROM public.visitors AS visitor
    WHERE visitor.auth_user_id = auth.uid()
      AND visitor.otp_verified
      AND visitor.is_active
    LIMIT 1;

    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'Active, verified visitor account required.';
    END IF;

    -- Lock the request
    SELECT cbr.*
    INTO v_req
    FROM public.community_book_requests cbr
    WHERE cbr.id = p_request_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Request not found.';
    END IF;

    -- Check if caller is the requester
    IF v_req.requester_visitor_id = trim(p_requester_visitor_id) THEN
        IF v_req.requester_visitor_id <> v_caller_id THEN
            RAISE EXCEPTION 'You can only cancel your own requests.';
        END IF;
    -- Check if caller is the owner
    ELSIF v_req.owner_visitor_id = v_caller_id THEN
        v_is_owner := true;
    ELSE
        RAISE EXCEPTION 'You are not authorized to cancel this request.';
    END IF;

    -- Validate reason
    IF p_reason IS NULL OR trim(p_reason) = '' THEN
        RAISE EXCEPTION 'Cancellation reason is required.';
    END IF;

    -- Handle based on current status
    IF v_req.status = 'pending' THEN
        -- Requester or owner can cancel pending
        -- Delete the request (triggers will handle availability if needed)
        DELETE FROM public.community_book_requests
        WHERE id = p_request_id;

        -- Notify owner (if requester cancelled) or requester (if owner cancelled)
        IF v_is_owner THEN
            PERFORM public.create_visitor_notification(
                v_req.requester_visitor_id,
                'community_cancelled',
                'Request cancelled by owner',
                'The owner cancelled your request for "' || v_req.book_title || '". Reason: ' || trim(p_reason),
                p_request_id,
                'community_book_request',
                pg_catalog.now() + pg_catalog.interval '7 days'
            );
        ELSE
            PERFORM public.create_visitor_notification(
                v_req.owner_visitor_id,
                'community_cancelled',
                'Request cancelled',
                v_req.requester_name || ' cancelled their request for "' || v_req.book_title || '". Reason: ' || trim(p_reason),
                p_request_id,
                'community_book_request',
                pg_catalog.now() + pg_catalog.interval '7 days'
            );
        END IF;

    ELSIF v_req.status = 'approved' THEN
        -- Only owner can cancel approved request (requester should use different flow)
        IF NOT v_is_owner THEN
            RAISE EXCEPTION 'Only the owner can cancel an approved request. Requester should contact the owner.';
        END IF;

        -- Reject instead (sets status to rejected, restores availability via trigger)
        UPDATE public.community_book_requests AS request
        SET
            status = 'rejected',
            rejected_at = pg_catalog.now(),
            owner_response = nullif(trim(p_reason), ''),
            updated_at = pg_catalog.now()
        WHERE request.id = p_request_id;

        -- Notify requester
        PERFORM public.create_visitor_notification(
            v_req.requester_visitor_id,
            'community_request_rejected',
            'Request cancelled by owner',
            'The owner cancelled the approved request for "' || v_req.book_title || '". Reason: ' || trim(p_reason),
            p_request_id,
            'community_book_request',
            pg_catalog.now() + pg_catalog.interval '30 days'
        );

        -- Promote next in queue
        PERFORM public.promote_next_community_request(v_req.book_id);

    ELSIF v_req.status = 'borrowed' THEN
        -- Cannot cancel borrowed - must use return flow
        RAISE EXCEPTION 'Cannot cancel a borrowed book. Use the return confirmation instead.';

    ELSIF v_req.status IN ('returned', 'rejected', 'cancelled') THEN
        -- Already terminal - idempotent
        RAISE NOTICE 'Request already in terminal state: %', v_req.status;
        RETURN;

    ELSE
        RAISE EXCEPTION 'Unknown request status: %', v_req.status;
    END IF;
END;
$function$;

ALTER FUNCTION public.cancel_community_book_request(uuid, text, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.cancel_community_book_request(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_community_book_request(uuid, text, text) TO authenticated, service_role;

-- ============================================================
-- 4. Fix update_community_book_copy_availability trigger to handle DELETE
-- ============================================================
DROP TRIGGER IF EXISTS community_book_copy_availability
    ON public.community_book_requests;

DROP FUNCTION IF EXISTS public.update_community_book_copy_availability();

CREATE OR REPLACE FUNCTION public.update_community_book_copy_availability()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
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
            -- Transition TO allocating status
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
            -- Transition FROM allocating status (returned, rejected, cancelled)
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

                -- Promote next community request if copy available
                IF v_available_after_release >= 1 THEN
                    -- Use pg_notify to trigger async promotion (avoids trigger recursion)
                    PERFORM pg_notify('community_promotion', jsonb_build_object(
                        'book_id', old.book_id
                    )::text);
                END IF;
            END IF;
        END IF;

    ELSIF tg_op = 'DELETE' THEN
        -- Handle direct DELETE (should be rare - prefer status changes)
        IF old.status IN ('approved', 'borrowed') THEN
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

                IF v_available_after_release >= 1 THEN
                    PERFORM pg_notify('community_promotion', jsonb_build_object(
                        'book_id', old.book_id
                    )::text);
                END IF;
            END IF;
        END IF;
    END IF;

    RETURN new;
END;
$function$;

CREATE TRIGGER community_book_copy_availability
    AFTER INSERT OR UPDATE OR DELETE ON public.community_book_requests
    FOR EACH ROW
    EXECUTE FUNCTION public.update_community_book_copy_availability();

REVOKE ALL ON FUNCTION public.update_community_book_copy_availability()
    FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.update_community_book_copy_availability()
    TO postgres, service_role;

-- ============================================================
-- 5. Fix require_available_community_book_copy trigger (keep existing, verify)
-- ============================================================
-- The existing trigger is correct - it validates availability at INSERT time for pending requests
-- No changes needed, but ensure it's properly granted

REVOKE ALL ON FUNCTION public.require_available_community_book_copy()
    FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.require_available_community_book_copy()
    TO postgres, service_role;

-- ============================================================
-- 6. Fix enforce_book_copy_inventory to separate library vs community
-- ============================================================
DROP FUNCTION IF EXISTS public.enforce_book_copy_inventory();

CREATE OR REPLACE FUNCTION public.enforce_book_copy_inventory()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $function$
DECLARE
    library_allocations integer := 0;
    community_allocations integer := 0;
BEGIN
    -- Count library allocations
    SELECT count(*)::integer
    INTO library_allocations
    FROM public.borrow_requests AS request
    WHERE request.book_id = new.id
      AND request.status IN ('ready_for_pickup', 'borrowed')
      AND request.return_date IS NULL;

    -- Count community allocations
    SELECT count(*)::integer
    INTO community_allocations
    FROM public.community_book_requests AS request
    WHERE request.book_id = new.id
      AND request.status IN ('approved', 'borrowed')
      AND request.return_date IS NULL;

    -- For library books: validate against library inventory
    IF new.book_type = 'library' THEN
        IF new.total_copies IS NULL
           OR new.total_copies < 1
           OR new.available_copies IS NULL
           OR new.available_copies < 0
           OR new.available_copies > new.total_copies
           OR new.available_copies > GREATEST(new.total_copies - library_allocations, 0)
        THEN
            RAISE EXCEPTION USING
                ERRCODE = '23514',
                MESSAGE = FORMAT(
                    'INVENTORY_CONFLICT: library book total copies must be positive, and available copies must be within unallocated stock after %s outstanding library allocations.',
                    library_allocations
                );
        END IF;

        IF new.total_copies < library_allocations THEN
            IF tg_op <> 'UPDATE' THEN
                RAISE EXCEPTION USING
                    ERRCODE = '23514',
                    MESSAGE = FORMAT(
                        'INVENTORY_CONFLICT: library total copies cannot be less than %s outstanding library allocations.',
                        library_allocations
                    );
            END IF;

            IF new.total_copies IS DISTINCT FROM old.total_copies
               OR new.available_copies <> 0
               OR new.available_copies > old.available_copies
            THEN
                RAISE EXCEPTION USING
                    ERRCODE = '23514',
                    MESSAGE = FORMAT(
                        'INVENTORY_CONFLICT: library total copies cannot be less than %s outstanding library allocations.',
                        library_allocations
                    );
            END IF;
        END IF;

    -- For personal/community books: validate community allocations separately
    ELSIF new.book_type = 'personal' THEN
        IF new.total_copies IS NULL
           OR new.total_copies < 1
           OR new.available_copies IS NULL
           OR new.available_copies < 0
           OR new.available_copies > new.total_copies
        THEN
            RAISE EXCEPTION USING
                ERRCODE = '23514',
                MESSAGE = 'INVENTORY_CONFLICT: personal book total copies must be positive, and available copies cannot exceed total copies.';
        END IF;

        -- Community availability is managed by triggers on community_book_requests
        -- Just ensure available_copies doesn't exceed total_copies
        IF new.available_copies > new.total_copies THEN
            RAISE EXCEPTION USING
                ERRCODE = '23514',
                MESSAGE = 'INVENTORY_CONFLICT: available copies cannot exceed total copies for personal books.';
        END IF;
    END IF;

    RETURN new;
END;
$function$;

GRANT EXECUTE ON FUNCTION "public"."enforce_book_copy_inventory"() TO "postgres", "service_role";
REVOKE ALL ON FUNCTION "public"."enforce_book_copy_inventory"() FROM PUBLIC;

-- ============================================================
-- 7. Add community expiration cron (separate from library pickup deadline)
-- ============================================================
-- Community pending requests expire after 7 days if owner doesn't act
CREATE OR REPLACE FUNCTION public.auto_expire_community_requests()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_count integer;
    v_req public.community_book_requests%rowtype;
BEGIN
    -- Expire pending requests older than 7 days
    UPDATE public.community_book_requests
    SET
        status = 'cancelled',
        owner_response = 'Expired: owner did not respond within 7 days',
        updated_at = pg_catalog.now()
    WHERE status = 'pending'
      AND request_date < pg_catalog.now() - pg_catalog.interval '7 days';

    GET DIAGNOSTICS v_count = ROW_COUNT;

    -- Notify requesters
    IF v_count > 0 THEN
        FOR v_req IN
            SELECT * FROM public.community_book_requests
            WHERE status = 'cancelled'
              AND owner_response = 'Expired: owner did not respond within 7 days'
              AND request_date < pg_catalog.now() - pg_catalog.interval '7 days'
        LOOP
            PERFORM public.create_visitor_notification(
                v_req.requester_visitor_id,
                'community_cancelled',
                'Request expired',
                'Your request for "' || v_req.book_title || '" expired because the owner did not respond within 7 days.',
                v_req.id::uuid,
                'community_book_request',
                pg_catalog.now() + pg_catalog.interval '7 days'
            );

            PERFORM public.create_visitor_notification(
                v_req.owner_visitor_id,
                'community_cancelled',
                'Request expired',
                'Request from ' || v_req.requester_name || ' for "' || v_req.book_title || '" expired (no response within 7 days).',
                v_req.id::uuid,
                'community_book_request',
                pg_catalog.now() + pg_catalog.interval '7 days'
            );
        END LOOP;
    END IF;

    RETURN v_count;
END;
$function$;

ALTER FUNCTION public.auto_expire_community_requests() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.auto_expire_community_requests() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.auto_expire_community_requests() TO service_role;

-- ============================================================
-- 8. Postflight validation
-- ============================================================
DO $postflight$
DECLARE
    v_signature regprocedure;
    v_acl_count integer;
BEGIN
    -- Validate approve_community_book_request
    v_signature := 'public.approve_community_book_request(uuid,text,text)'::regprocedure;
    IF NOT EXISTS (
        SELECT 1
        FROM pg_catalog.pg_proc AS procedure
        JOIN pg_catalog.pg_language AS language ON language.oid = procedure.prolang
        WHERE procedure.oid = v_signature
          AND procedure.proowner = 'postgres'::regrole
          AND language.lanname = 'plpgsql'
          AND procedure.prorettype = 'record'::regtype
          AND procedure.pronargs = 3
          AND procedure.prosecdef
          AND procedure.proconfig = ARRAY['search_path=""']::text[]
    ) THEN
        RAISE EXCEPTION 'approve_community_book_request metadata differs from the reviewed contract.';
    END IF;

    SELECT pg_catalog.count(*) INTO v_acl_count
    FROM pg_catalog.pg_proc AS procedure
    CROSS JOIN LATERAL pg_catalog.aclexplode(procedure.proacl) AS acl
    WHERE procedure.oid = v_signature;

    IF v_acl_count <> 1
       OR NOT pg_catalog.has_function_privilege('authenticated', v_signature, 'EXECUTE')
       OR pg_catalog.has_function_privilege('anon', v_signature, 'EXECUTE')
       OR pg_catalog.has_function_privilege('service_role', v_signature, 'EXECUTE') THEN
        RAISE EXCEPTION 'approve_community_book_request EXECUTE privileges differ from the least-privilege contract.';
    END IF;

    -- Validate cancel_community_book_request
    v_signature := 'public.cancel_community_book_request(uuid,text,text)'::regprocedure;
    IF NOT EXISTS (
        SELECT 1
        FROM pg_catalog.pg_proc AS procedure
        JOIN pg_catalog.pg_language AS language ON language.oid = procedure.prolang
        WHERE procedure.oid = v_signature
          AND procedure.proowner = 'postgres'::regrole
          AND language.lanname = 'plpgsql'
          AND procedure.prorettype = 'void'::regtype
          AND procedure.pronargs = 3
          AND procedure.prosecdef
          AND procedure.proconfig = ARRAY['search_path=""']::text[]
    ) THEN
        RAISE EXCEPTION 'cancel_community_book_request metadata differs from the reviewed contract.';
    END IF;

    SELECT pg_catalog.count(*) INTO v_acl_count
    FROM pg_catalog.pg_proc AS procedure
    CROSS JOIN LATERAL pg_catalog.aclexplode(procedure.proacl) AS acl
    WHERE procedure.oid = v_signature;

    IF v_acl_count <> 2
       OR NOT pg_catalog.has_function_privilege('authenticated', v_signature, 'EXECUTE')
       OR NOT pg_catalog.has_function_privilege('service_role', v_signature, 'EXECUTE')
       OR pg_catalog.has_function_privilege('anon', v_signature, 'EXECUTE') THEN
        RAISE EXCEPTION 'cancel_community_book_request EXECUTE privileges differ from the least-privilege contract.';
    END IF;

    -- Validate promote_next_community_request
    v_signature := 'public.promote_next_community_request(text)'::regprocedure;
    IF NOT EXISTS (
        SELECT 1
        FROM pg_catalog.pg_proc AS procedure
        JOIN pg_catalog.pg_language AS language ON language.oid = procedure.prolang
        WHERE procedure.oid = v_signature
          AND procedure.proowner = 'postgres'::regrole
          AND language.lanname = 'plpgsql'
          AND procedure.prorettype = 'void'::regtype
          AND procedure.pronargs = 1
          AND procedure.prosecdef
          AND procedure.proconfig = ARRAY['search_path=""']::text[]
    ) THEN
        RAISE EXCEPTION 'promote_next_community_request metadata differs from the reviewed contract.';
    END IF;

    SELECT pg_catalog.count(*) INTO v_acl_count
    FROM pg_catalog.pg_proc AS procedure
    CROSS JOIN LATERAL pg_catalog.aclexplode(procedure.proacl) AS acl
    WHERE procedure.oid = v_signature;

    IF v_acl_count <> 2
       OR NOT pg_catalog.has_function_privilege('service_role', v_signature, 'EXECUTE')
       OR NOT pg_catalog.has_function_privilege('postgres', v_signature, 'EXECUTE')
       OR pg_catalog.has_function_privilege('anon', v_signature, 'EXECUTE')
       OR pg_catalog.has_function_privilege('authenticated', v_signature, 'EXECUTE') THEN
        RAISE EXCEPTION 'promote_next_community_request EXECUTE privileges differ from the least-privilege contract.';
    END IF;

    -- Validate auto_expire_community_requests
    v_signature := 'public.auto_expire_community_requests()'::regprocedure;
    IF NOT EXISTS (
        SELECT 1
        FROM pg_catalog.pg_proc AS procedure
        JOIN pg_catalog.pg_language AS language ON language.oid = procedure.prolang
        WHERE procedure.oid = v_signature
          AND procedure.proowner = 'postgres'::regrole
          AND language.lanname = 'plpgsql'
          AND procedure.prorettype = 'integer'::regtype
          AND procedure.pronargs = 0
          AND procedure.prosecdef
          AND procedure.proconfig = ARRAY['search_path=""']::text[]
    ) THEN
        RAISE EXCEPTION 'auto_expire_community_requests metadata differs from the reviewed contract.';
    END IF;

    SELECT pg_catalog.count(*) INTO v_acl_count
    FROM pg_catalog.pg_proc AS procedure
    CROSS JOIN LATERAL pg_catalog.aclexplode(procedure.proacl) AS acl
    WHERE procedure.oid = v_signature;

    IF v_acl_count <> 1
       OR NOT pg_catalog.has_function_privilege('service_role', v_signature, 'EXECUTE')
       OR pg_catalog.has_function_privilege('anon', v_signature, 'EXECUTE')
       OR pg_catalog.has_function_privilege('authenticated', v_signature, 'EXECUTE') THEN
        RAISE EXCEPTION 'auto_expire_community_requests EXECUTE privileges differ from the least-privilege contract.';
    END IF;
END;
$postflight$;

NOTIFY pgrst, 'reload schema';
COMMIT;