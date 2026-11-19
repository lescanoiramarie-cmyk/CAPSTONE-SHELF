-- Migration 20270122000000_staff_metadata_and_rpc_reconciliation.sql
-- Fixes:
-- 1. Grant EXECUTE on public.get_library_subscription_dashboard(text) to authenticated, service_role
-- 2. Remove non-existent b.is_active condition from save_community_book_for_later(text)
-- 3. Reconcile unsave_community_book_for_later(text) and get_saved_community_books()
-- 4. Reconcile get_opac_category_book_counts(text) to handle null, empty, 'All', or library UUID
-- 5. Synchronize staff_profiles role, library_id, and is_active to auth.users.raw_app_meta_data
-- 6. Establish trigger to keep auth.users.raw_app_meta_data synchronized on staff profile changes
-- 7. Correct BatStateU JPLPC Malvar Campus coordinates to 14.04482, 121.15677
-- 8. Reconcile shelf_private.request_borrow_unchecked(uuid, text) for verified visitors

-- 1. Grant EXECUTE on get_library_subscription_dashboard
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'get_library_subscription_dashboard'
  ) THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.get_library_subscription_dashboard(text) TO authenticated, service_role';
  END IF;
END $$;

-- 2. Reconcile save_community_book_for_later (remove invalid is_active column on public.books)
CREATE OR REPLACE FUNCTION public.save_community_book_for_later(
  p_community_book_id text
)
RETURNS TABLE (success boolean, message text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_visitor_id text;
  v_book public.books%rowtype;
BEGIN
  -- Get current authenticated visitor
  SELECT id INTO v_visitor_id
  FROM public.visitors
  WHERE auth_user_id = auth.uid()
    AND is_active = true;

  IF v_visitor_id IS NULL THEN
    RETURN QUERY SELECT false::boolean, 'Please sign in to save books.'::text;
    RETURN;
  END IF;

  -- Verify the book exists and is a public community book
  SELECT * INTO v_book
  FROM public.books
  WHERE id = p_community_book_id
    AND book_type = 'personal'
    AND is_public = true;

  IF v_book IS NULL THEN
    RETURN QUERY SELECT false::boolean, 'Community book not found or not available for saving.'::text;
    RETURN;
  END IF;

  -- Insert or ignore if already saved
  INSERT INTO public.visitor_saved_community_books (visitor_id, community_book_id)
  VALUES (v_visitor_id, p_community_book_id)
  ON CONFLICT (visitor_id, community_book_id) DO NOTHING;

  RETURN QUERY SELECT true::boolean, 'Book saved for later.'::text;
END;
$function$;

REVOKE ALL ON FUNCTION public.save_community_book_for_later(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_community_book_for_later(text) TO authenticated, service_role;

-- 2b. Reconcile unsave_community_book_for_later
CREATE OR REPLACE FUNCTION public.unsave_community_book_for_later(
  p_community_book_id text
)
RETURNS TABLE (success boolean, message text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_visitor_id text;
  v_deleted integer;
BEGIN
  -- Get current authenticated visitor
  SELECT id INTO v_visitor_id
  FROM public.visitors
  WHERE auth_user_id = auth.uid()
    AND is_active = true;

  IF v_visitor_id IS NULL THEN
    RETURN QUERY SELECT false::boolean, 'Please sign in to unsave books.'::text;
    RETURN;
  END IF;

  DELETE FROM public.visitor_saved_community_books
  WHERE visitor_id = v_visitor_id
    AND community_book_id = p_community_book_id;

  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  IF v_deleted = 0 THEN
    RETURN QUERY SELECT false::boolean, 'Book was not in your saved list.'::text;
  ELSE
    RETURN QUERY SELECT true::boolean, 'Book removed from saved list.'::text;
  END IF;
END;
$function$;

REVOKE ALL ON FUNCTION public.unsave_community_book_for_later(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.unsave_community_book_for_later(text) TO authenticated, service_role;

-- 2c. Reconcile get_saved_community_books (remove invalid b.is_active condition)
CREATE OR REPLACE FUNCTION public.get_saved_community_books()
RETURNS TABLE (
  book_id text,
  title text,
  author text,
  category text,
  isbn text,
  cover_url text,
  owner_visitor_id text,
  owner_name text,
  saved_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_visitor_id text;
BEGIN
  -- Get current authenticated visitor
  SELECT id INTO v_visitor_id
  FROM public.visitors
  WHERE auth_user_id = auth.uid()
    AND is_active = true;

  IF v_visitor_id IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    b.id AS book_id,
    b.title,
    b.author,
    b.category,
    b.isbn,
    b.cover_url,
    b.owner_visitor_id,
    v.full_name AS owner_name,
    sb.saved_at
  FROM public.visitor_saved_community_books sb
  JOIN public.books b ON b.id = sb.community_book_id
  JOIN public.visitors v ON v.id = b.owner_visitor_id
  WHERE sb.visitor_id = v_visitor_id
    AND b.is_public = true
    AND b.book_type = 'personal'
  ORDER BY sb.saved_at DESC;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_saved_community_books() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_saved_community_books() TO authenticated, service_role;

-- 2d. Reconcile get_opac_category_book_counts (handle text, 'All', uuid, and drop old signatures)
DROP FUNCTION IF EXISTS public.get_opac_category_book_counts();
DROP FUNCTION IF EXISTS public.get_opac_category_book_counts(uuid);
DROP FUNCTION IF EXISTS public.get_opac_category_book_counts(text);

CREATE OR REPLACE FUNCTION public.get_opac_category_book_counts(
  p_library_id text DEFAULT NULL
)
RETURNS TABLE (category text, book_count bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  RETURN QUERY
  SELECT
    COALESCE(b.category, 'Uncategorized')::text AS category,
    COUNT(DISTINCT b.id)::bigint AS book_count
  FROM public.books AS b
  WHERE b.book_type = 'library'
    AND (
      p_library_id IS NULL
      OR p_library_id = ''
      OR p_library_id = 'All'
      OR b.library_id::text = p_library_id
    )
  GROUP BY COALESCE(b.category, 'Uncategorized')
  ORDER BY COALESCE(b.category, 'Uncategorized');
END;
$function$;

REVOKE ALL ON FUNCTION public.get_opac_category_book_counts(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_opac_category_book_counts(text) TO anon, authenticated, service_role;

-- 3. Synchronize existing active staff profiles into auth.users raw_app_meta_data
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT sp.id, sp.role, sp.library_id, sp.is_active
    FROM public.staff_profiles sp
    WHERE sp.id IS NOT NULL
  LOOP
    UPDATE auth.users
    SET raw_app_meta_data = COALESCE(raw_app_meta_data, '{}'::jsonb) ||
      jsonb_build_object(
        'role', r.role,
        'library_id', r.library_id,
        'is_active', r.is_active
      )
    WHERE id = r.id;
  END LOOP;
END $$;

-- 4. Trigger to maintain auth.users.raw_app_meta_data synchronization on staff profile changes
CREATE OR REPLACE FUNCTION public.sync_staff_profile_to_auth_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF NEW.id IS NOT NULL THEN
    UPDATE auth.users
    SET raw_app_meta_data = COALESCE(raw_app_meta_data, '{}'::jsonb) ||
      jsonb_build_object(
        'role', NEW.role,
        'library_id', NEW.library_id,
        'is_active', NEW.is_active
      )
    WHERE id = NEW.id;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_sync_staff_profile_to_auth_user ON public.staff_profiles;
CREATE TRIGGER trg_sync_staff_profile_to_auth_user
  AFTER INSERT OR UPDATE OF role, library_id, is_active
  ON public.staff_profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_staff_profile_to_auth_user();

-- 5. Correct BatStateU JPLPC Malvar Campus coordinates
UPDATE public.libraries
SET lat = 14.04482, lng = 121.15677, coordinates_verified = true
WHERE name ILIKE '%Malvar%' OR id = '277829af-1475-47ae-9e26-4b64c68f54f4';

-- 6. Reconcile shelf_private.request_borrow_unchecked (remove inappropriate AAL2 check for visitors)
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
BEGIN
    -- Require authenticated visitor session (AAL1 is valid for visitors)
    v_uid := auth.uid();
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'Authenticated visitor account required.';
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
    WHERE b.id = pg_catalog.btrim(p_book_id)
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
          AND br.book_id = pg_catalog.btrim(p_book_id)
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
        WHERE b.id = pg_catalog.btrim(p_book_id);

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
        WHERE br.book_id = pg_catalog.btrim(p_book_id)
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
    TO authenticated, service_role;

-- Postflight assertions
DO $$
DECLARE
  v_grant_exists boolean;
  v_trigger_exists boolean;
BEGIN
  -- Verify get_library_subscription_dashboard grant
  SELECT has_function_privilege('authenticated', 'public.get_library_subscription_dashboard(text)', 'EXECUTE')
  INTO v_grant_exists;

  IF NOT v_grant_exists THEN
    RAISE EXCEPTION 'Postflight Failed: authenticated role lacks EXECUTE on get_library_subscription_dashboard';
  END IF;

  -- Verify trigger exists
  SELECT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'trg_sync_staff_profile_to_auth_user'
  ) INTO v_trigger_exists;

  IF NOT v_trigger_exists THEN
    RAISE EXCEPTION 'Postflight Failed: trg_sync_staff_profile_to_auth_user trigger missing';
  END IF;

  -- Verify get_saved_community_books privilege
  IF NOT has_function_privilege('authenticated', 'public.get_saved_community_books()', 'EXECUTE') THEN
    RAISE EXCEPTION 'Postflight Failed: authenticated role lacks EXECUTE on get_saved_community_books';
  END IF;

  -- Verify save_community_book_for_later privilege
  IF NOT has_function_privilege('authenticated', 'public.save_community_book_for_later(text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Postflight Failed: authenticated role lacks EXECUTE on save_community_book_for_later';
  END IF;

  -- Verify unsave_community_book_for_later privilege
  IF NOT has_function_privilege('authenticated', 'public.unsave_community_book_for_later(text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Postflight Failed: authenticated role lacks EXECUTE on unsave_community_book_for_later';
  END IF;

  -- Verify get_opac_category_book_counts privilege
  IF NOT has_function_privilege('anon', 'public.get_opac_category_book_counts(text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Postflight Failed: anon role lacks EXECUTE on get_opac_category_book_counts';
  END IF;

  -- Verify request_borrow_unchecked privilege
  IF NOT has_function_privilege('authenticated', 'shelf_private.request_borrow_unchecked(uuid,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Postflight Failed: authenticated role lacks EXECUTE on shelf_private.request_borrow_unchecked';
  END IF;
END $$;
