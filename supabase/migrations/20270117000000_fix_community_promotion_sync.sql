-- Fix community queue promotion: ensure synchronous promotion in trigger
-- The trigger update_community_book_copy_availability was using pg_notify('community_promotion', ...)
-- as a defensive async fallback, but no consumer exists. Promotion must happen synchronously
-- within the trigger transaction to guarantee FIFO queue processing and inventory consistency.

BEGIN;

-- ============================================================
-- 1. Fix update_community_book_copy_availability trigger
--    Replace pg_notify with direct call to promote_next_community_request()
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

                -- PROMOTION: Synchronously promote next community request if copy available
                -- This replaces the dead pg_notify('community_promotion', ...) fallback
                IF v_available_after_release >= 1 THEN
                    PERFORM public.promote_next_community_request(old.book_id);
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
              AND book_type = 'personal'
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

                -- PROMOTION: Synchronously promote next community request if copy available
                IF v_available_after_release >= 1 THEN
                    PERFORM public.promote_next_community_request(old.book_id);
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
-- 2. Postflight validation
-- ============================================================
DO $postflight$
DECLARE
    v_definition text;
    v_notify_count integer;
BEGIN
    -- Verify pg_notify calls are removed from trigger function
    SELECT pg_catalog.pg_get_functiondef(oid)
    INTO v_definition
    FROM pg_catalog.pg_proc
    WHERE proname = 'update_community_book_copy_availability'
      AND pronamespace = 'public'::regnamespace;

    IF v_definition IS NULL THEN
        RAISE EXCEPTION 'update_community_book_copy_availability function not found.';
    END IF;

    -- Count pg_notify occurrences - should be zero
    v_notify_count := (SELECT count(*) FROM regexp_matches(v_definition, 'pg_notify', 'g'));
    IF v_notify_count > 0 THEN
        RAISE EXCEPTION 'update_community_book_copy_availability still contains % pg_notify call(s); expected 0', v_notify_count;
    END IF;

    -- Verify promote_next_community_request is called
    IF pg_catalog.strpos(v_definition, 'promote_next_community_request') = 0 THEN
        RAISE EXCEPTION 'update_community_book_copy_availability does not call promote_next_community_request';
    END IF;

    -- Validate function metadata
    IF NOT EXISTS (
        SELECT 1
        FROM pg_catalog.pg_proc AS procedure
        JOIN pg_catalog.pg_language AS language ON language.oid = procedure.prolang
        WHERE procedure.oid = 'public.update_community_book_copy_availability()'::regprocedure
          AND procedure.proowner = 'postgres'::regrole
          AND language.lanname = 'plpgsql'
          AND procedure.prorettype = 'trigger'::regtype
          AND procedure.prosecdef
          AND procedure.proconfig = ARRAY['search_path=public']::text[]
    ) THEN
        RAISE EXCEPTION 'update_community_book_copy_availability metadata differs from the reviewed contract.';
    END IF;

    -- Validate EXECUTE grants
    IF NOT pg_catalog.has_function_privilege('postgres', 'public.update_community_book_copy_availability()', 'EXECUTE')
       OR NOT pg_catalog.has_function_privilege('service_role', 'public.update_community_book_copy_availability()', 'EXECUTE')
       OR pg_catalog.has_function_privilege('anon', 'public.update_community_book_copy_availability()', 'EXECUTE')
       OR pg_catalog.has_function_privilege('authenticated', 'public.update_community_book_copy_availability()', 'EXECUTE') THEN
        RAISE EXCEPTION 'update_community_book_copy_availability EXECUTE privileges differ from the least-privilege contract.';
    END IF;

    -- Verify trigger exists and is attached
    IF NOT EXISTS (
        SELECT 1
        FROM pg_catalog.pg_trigger AS trigger
        JOIN pg_catalog.pg_class AS cls ON cls.oid = trigger.tgrelid
        JOIN pg_catalog.pg_namespace AS ns ON ns.oid = cls.relnamespace
        WHERE trigger.tgname = 'community_book_copy_availability'
          AND cls.relname = 'community_book_requests'
          AND ns.nspname = 'public'
    ) THEN
        RAISE EXCEPTION 'community_book_copy_availability trigger not found on community_book_requests';
    END IF;
END;
$postflight$;

NOTIFY pgrst, 'reload schema';
COMMIT;