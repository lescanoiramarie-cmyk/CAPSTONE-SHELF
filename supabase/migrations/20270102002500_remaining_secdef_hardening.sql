-- Harden remaining SECURITY DEFINER functions missing safe search_path and AAL2 checks
-- Additive migration for functions identified in SECURITY DEFINER audit
-- Preserves existing behavior, ownership, and grants

BEGIN;

-- ============================================================
-- 1. Harden deliver_subscription_renewal_followup(uuid, date)
-- ============================================================
-- Add AAL2 check (called by cron and follow_library_subscription_renewal)
-- Fix search_path to empty, qualify all table references

DROP FUNCTION IF EXISTS public.deliver_subscription_renewal_followup(uuid, date);

CREATE OR REPLACE FUNCTION public.deliver_subscription_renewal_followup(
  p_library_id uuid,
  p_renewal_date date
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_library_name text;
  v_sent_at timestamptz;
  v_inserted integer := 0;
  v_days integer;
  v_staff_library_id uuid;
  v_staff_role text;
  v_jwt_role text;
BEGIN
  -- Require authenticated staff session with AAL2
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authenticated staff account required.';
  END IF;
  IF COALESCE(auth.jwt() ->> 'aal', 'aal1') <> 'aal2' THEN
    RAISE EXCEPTION 'AAL2 authentication is required.';
  END IF;

  SELECT pg_catalog.lower(sp.role), sp.library_id
  INTO v_staff_role, v_staff_library_id
  FROM public.staff_profiles sp
  WHERE sp.id = auth.uid() AND sp.is_active IS TRUE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Active staff profile required.';
  END IF;
  v_jwt_role := auth.jwt() -> 'app_metadata' ->> 'role';
  IF v_staff_role IS NULL
     OR v_staff_role NOT IN ('superadmin', 'subadmin')
     OR COALESCE(v_jwt_role, v_staff_role) <> v_staff_role THEN
    RAISE EXCEPTION 'Unauthorized staff role.';
  END IF;
  IF v_staff_role = 'subadmin'
     AND v_staff_library_id IS DISTINCT FROM p_library_id THEN
    RAISE EXCEPTION 'You are not authorized for this library.';
  END IF;

  SELECT f.notification_sent_at, l.name
  INTO v_sent_at, v_library_name
  FROM public.subscription_renewal_follows f
  JOIN public.libraries l ON l.id = f.library_id
  JOIN public.library_subscriptions s ON s.library_id = f.library_id AND s.renews_on = f.renewal_date
  WHERE f.library_id = p_library_id AND f.renewal_date = p_renewal_date
  FOR UPDATE OF f;

  IF NOT FOUND OR v_sent_at IS NOT NULL THEN RETURN 0; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.staff_profiles sp
    WHERE sp.library_id = p_library_id AND lower(sp.role) = 'subadmin' AND sp.is_active IS TRUE
  ) THEN RETURN 0; END IF;

  v_days := GREATEST(p_renewal_date - current_date, 0);
  INSERT INTO public.staff_notifications (
    recipient_staff_id, library_id, notification_type, title, message, event_key
  )
  SELECT sp.id, p_library_id, 'subscription_renewal',
    CASE WHEN v_days = 0 THEN 'Subscription renewal due today'
      ELSE format('Subscription renewal in %s days', v_days) END,
    format('The %s subscription is due for renewal on %s. Please contact Super Admin if your library has renewed.',
      v_library_name, to_char(p_renewal_date, 'Mon FMDD, YYYY')),
    format('subscription-renewal:%s:%s', p_library_id, p_renewal_date)
  FROM public.staff_profiles sp
  WHERE sp.library_id = p_library_id AND lower(sp.role) = 'subadmin' AND sp.is_active IS TRUE
  ON CONFLICT (recipient_staff_id, event_key) DO NOTHING;
  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  UPDATE public.subscription_renewal_follows
  SET notification_sent_at = now()
  WHERE library_id = p_library_id AND renewal_date = p_renewal_date;

  RETURN v_inserted;
END;
$function$;

ALTER FUNCTION public.deliver_subscription_renewal_followup(uuid, date) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.deliver_subscription_renewal_followup(uuid, date)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.deliver_subscription_renewal_followup(uuid, date)
  TO authenticated, service_role;

-- ============================================================
-- 2. Harden add_personal_book (13-arg overload with fine_rate)
-- ============================================================
-- Fix search_path to empty, add AAL2 for visitor-facing function

DROP FUNCTION IF EXISTS public.add_personal_book(
  text, text, text, text, text, text, text, integer, text, text, boolean,
  integer, boolean, integer
);

CREATE OR REPLACE FUNCTION public.add_personal_book(
  p_visitor_id text,
  p_title text,
  p_author text,
  p_category text,
  p_isbn text,
  p_summary text,
  p_condition text,
  p_lending_period_days integer,
  p_handover_method text,
  p_handover_details text,
  p_lending_enabled boolean,
  p_total_copies integer,
  p_is_public boolean,
  p_fine_rate integer
)
RETURNS public.books
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  book_row public.books%ROWTYPE;
  v_category_rate integer;
  v_visitor public.visitors%ROWTYPE;
BEGIN
  -- Require authenticated visitor session with AAL2
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authenticated visitor account required.';
  END IF;
  IF COALESCE(auth.jwt() ->> 'aal', 'aal1') <> 'aal2' THEN
    RAISE EXCEPTION 'AAL2 authentication is required.';
  END IF;

  -- Verify visitor ownership
  SELECT v.* INTO v_visitor
  FROM public.visitors AS v
  WHERE v.id = pg_catalog.btrim(p_visitor_id)
    AND v.auth_user_id = auth.uid()
    AND v.otp_verified = true
    AND v.is_active = true
  LIMIT 1;

  IF v_visitor.id IS NULL THEN
    RAISE EXCEPTION 'Visitor account could not be verified.';
  END IF;

  -- Call the existing function without the fine-rate argument.
  book_row := public.add_personal_book(
    p_visitor_id,
    p_title,
    p_author,
    p_category,
    p_isbn,
    p_summary,
    p_condition,
    p_lending_period_days,
    p_handover_method,
    p_handover_details,
    p_lending_enabled,
    p_total_copies,
    p_is_public
  );

  -- Derive the rate from the category.
  v_category_rate := public.get_category_fine_rate(book_row.category);

  IF COALESCE(p_lending_enabled, false) THEN
    IF v_category_rate IS NULL THEN
      RAISE EXCEPTION
        'This category does not have an approved fine rate. Choose a supported category.';
    END IF;

    IF p_fine_rate IS DISTINCT FROM v_category_rate THEN
      RAISE EXCEPTION
        'The selected fine rate does not match the book category. Expected rate: % PHP per overdue day.',
        v_category_rate;
    END IF;

    IF book_row.fine_rate IS DISTINCT FROM v_category_rate THEN
      RAISE EXCEPTION
        'The book fine rate does not match its category. Please review the book category.';
    END IF;
  END IF;

  RETURN book_row;
END;
$function$;

ALTER FUNCTION public.add_personal_book(
  text, text, text, text, text, text, text, integer, text, text, boolean,
  integer, boolean, integer
) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.add_personal_book(
  text, text, text, text, text, text, text, integer, text, text, boolean,
  integer, boolean, integer
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.add_personal_book(
  text, text, text, text, text, text, text, integer, text, text, boolean,
  integer, boolean, integer
) TO authenticated, service_role;

-- ============================================================
-- 3. Harden add_personal_book_with_cover (14-arg overload with fine_rate)
-- ============================================================
-- Fix search_path to empty, add AAL2 for visitor-facing function

DROP FUNCTION IF EXISTS public.add_personal_book_with_cover(
  text, text, text, text, text, text, text, integer, text, text, boolean,
  integer, boolean, text, integer
);

CREATE OR REPLACE FUNCTION public.add_personal_book_with_cover(
  p_visitor_id text,
  p_title text,
  p_author text,
  p_category text,
  p_isbn text,
  p_summary text,
  p_condition text,
  p_lending_period_days integer,
  p_handover_method text,
  p_handover_details text,
  p_lending_enabled boolean,
  p_total_copies integer,
  p_is_public boolean,
  p_cover_url text,
  p_fine_rate integer
)
RETURNS public.books
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  book_row public.books%ROWTYPE;
  v_category_rate integer;
  v_visitor public.visitors%ROWTYPE;
BEGIN
  -- Require authenticated visitor session with AAL2
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authenticated visitor account required.';
  END IF;
  IF COALESCE(auth.jwt() ->> 'aal', 'aal1') <> 'aal2' THEN
    RAISE EXCEPTION 'AAL2 authentication is required.';
  END IF;

  -- Verify visitor ownership
  SELECT v.* INTO v_visitor
  FROM public.visitors AS v
  WHERE v.id = pg_catalog.btrim(p_visitor_id)
    AND v.auth_user_id = auth.uid()
    AND v.otp_verified = true
    AND v.is_active = true
  LIMIT 1;

  IF v_visitor.id IS NULL THEN
    RAISE EXCEPTION 'Visitor account could not be verified.';
  END IF;

  -- Call the existing function without the fine-rate argument.
  book_row := public.add_personal_book_with_cover(
    p_visitor_id,
    p_title,
    p_author,
    p_category,
    p_isbn,
    p_summary,
    p_condition,
    p_lending_period_days,
    p_handover_method,
    p_handover_details,
    p_lending_enabled,
    p_total_copies,
    p_is_public,
    p_cover_url
  );

  -- Derive the rate from the category.
  v_category_rate := public.get_category_fine_rate(book_row.category);

  IF COALESCE(p_lending_enabled, false) THEN
    IF v_category_rate IS NULL THEN
      RAISE EXCEPTION
        'This category does not have an approved fine rate. Choose a supported category.';
    END IF;

    IF p_fine_rate IS DISTINCT FROM v_category_rate THEN
      RAISE EXCEPTION
        'The selected fine rate does not match the book category. Expected rate: % PHP per overdue day.',
        v_category_rate;
    END IF;

    IF book_row.fine_rate IS DISTINCT FROM v_category_rate THEN
      RAISE EXCEPTION
        'The book fine rate does not match its category. Please review the book category.';
    END IF;
  END IF;

  RETURN book_row;
END;
$function$;

ALTER FUNCTION public.add_personal_book_with_cover(
  text, text, text, text, text, text, text, integer, text, text, boolean,
  integer, boolean, text, integer
) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.add_personal_book_with_cover(
  text, text, text, text, text, text, text, integer, text, text, boolean,
  integer, boolean, text, integer
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.add_personal_book_with_cover(
  text, text, text, text, text, text, text, integer, text, text, boolean,
  integer, boolean, text, integer
) TO authenticated, service_role;

-- ============================================================
-- 4. Harden update_personal_book (14-arg overload with fine_rate)
-- ============================================================
-- Fix search_path to empty, add AAL2 for visitor-facing function

DROP FUNCTION IF EXISTS public.update_personal_book(
  text, text, text, text, text, text, text, text, integer, text, text,
  boolean, integer, boolean, integer
);

CREATE OR REPLACE FUNCTION public.update_personal_book(
  p_visitor_id text,
  p_book_id text,
  p_title text,
  p_author text,
  p_category text,
  p_isbn text,
  p_summary text,
  p_condition text,
  p_lending_period_days integer,
  p_handover_method text,
  p_handover_details text,
  p_lending_enabled boolean,
  p_total_copies integer,
  p_is_public boolean,
  p_fine_rate integer
)
RETURNS public.books
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  book_row public.books%ROWTYPE;
  v_category_rate integer;
  v_visitor public.visitors%ROWTYPE;
BEGIN
  -- Require authenticated visitor session with AAL2
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authenticated visitor account required.';
  END IF;
  IF COALESCE(auth.jwt() ->> 'aal', 'aal1') <> 'aal2' THEN
    RAISE EXCEPTION 'AAL2 authentication is required.';
  END IF;

  -- Verify visitor ownership
  SELECT v.* INTO v_visitor
  FROM public.visitors AS v
  WHERE v.id = pg_catalog.btrim(p_visitor_id)
    AND v.auth_user_id = auth.uid()
    AND v.otp_verified = true
    AND v.is_active = true
  LIMIT 1;

  IF v_visitor.id IS NULL THEN
    RAISE EXCEPTION 'Visitor account could not be verified.';
  END IF;

  -- Call the existing function without the fine-rate argument.
  book_row := public.update_personal_book(
    p_visitor_id,
    p_book_id,
    p_title,
    p_author,
    p_category,
    p_isbn,
    p_summary,
    p_condition,
    p_lending_period_days,
    p_handover_method,
    p_handover_details,
    p_lending_enabled,
    p_total_copies,
    p_is_public
  );

  -- Derive the rate from the updated category.
  v_category_rate := public.get_category_fine_rate(book_row.category);

  IF COALESCE(p_lending_enabled, false) THEN
    IF v_category_rate IS NULL THEN
      RAISE EXCEPTION
        'This category does not have an approved fine rate. Choose a supported category.';
    END IF;

    IF p_fine_rate IS DISTINCT FROM v_category_rate THEN
      RAISE EXCEPTION
        'The selected fine rate does not match the book category. Expected rate: % PHP per overdue day.',
        v_category_rate;
    END IF;

    IF book_row.fine_rate IS DISTINCT FROM v_category_rate THEN
      RAISE EXCEPTION
        'The book fine rate does not match its category. Please review the book category.';
    END IF;
  END IF;

  RETURN book_row;
END;
$function$;

ALTER FUNCTION public.update_personal_book(
  text, text, text, text, text, text, text, text, integer, text, text,
  boolean, integer, boolean, integer
) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.update_personal_book(
  text, text, text, text, text, text, text, text, integer, text, text,
  boolean, integer, boolean, integer
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_personal_book(
  text, text, text, text, text, text, text, text, integer, text, text,
  boolean, integer, boolean, integer
) TO authenticated, service_role;

-- ============================================================
-- 5. Harden update_personal_book_with_cover (15-arg overload with fine_rate)
-- ============================================================
-- Fix search_path to empty, add AAL2 for visitor-facing function

DROP FUNCTION IF EXISTS public.update_personal_book_with_cover(
  text, text, text, text, text, text, text, text, integer, text, text,
  boolean, integer, boolean, text, integer
);

CREATE OR REPLACE FUNCTION public.update_personal_book_with_cover(
  p_visitor_id text,
  p_book_id text,
  p_title text,
  p_author text,
  p_category text,
  p_isbn text,
  p_summary text,
  p_condition text,
  p_lending_period_days integer,
  p_handover_method text,
  p_handover_details text,
  p_lending_enabled boolean,
  p_total_copies integer,
  p_is_public boolean,
  p_cover_url text,
  p_fine_rate integer
)
RETURNS public.books
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  book_row public.books%ROWTYPE;
  v_category_rate integer;
  v_visitor public.visitors%ROWTYPE;
BEGIN
  -- Require authenticated visitor session with AAL2
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authenticated visitor account required.';
  END IF;
  IF COALESCE(auth.jwt() ->> 'aal', 'aal1') <> 'aal2' THEN
    RAISE EXCEPTION 'AAL2 authentication is required.';
  END IF;

  -- Verify visitor ownership
  SELECT v.* INTO v_visitor
  FROM public.visitors AS v
  WHERE v.id = pg_catalog.btrim(p_visitor_id)
    AND v.auth_user_id = auth.uid()
    AND v.otp_verified = true
    AND v.is_active = true
  LIMIT 1;

  IF v_visitor.id IS NULL THEN
    RAISE EXCEPTION 'Visitor account could not be verified.';
  END IF;

  -- Call the existing function without the fine-rate argument.
  book_row := public.update_personal_book_with_cover(
    p_visitor_id,
    p_book_id,
    p_title,
    p_author,
    p_category,
    p_isbn,
    p_summary,
    p_condition,
    p_lending_period_days,
    p_handover_method,
    p_handover_details,
    p_lending_enabled,
    p_total_copies,
    p_is_public,
    p_cover_url
  );

  -- Derive the rate from the updated category.
  v_category_rate := public.get_category_fine_rate(book_row.category);

  IF COALESCE(p_lending_enabled, false) THEN
    IF v_category_rate IS NULL THEN
      RAISE EXCEPTION
        'This category does not have an approved fine rate. Choose a supported category.';
    END IF;

    IF p_fine_rate IS DISTINCT FROM v_category_rate THEN
      RAISE EXCEPTION
        'The selected fine rate does not match the book category. Expected rate: % PHP per overdue day.',
        v_category_rate;
    END IF;

    IF book_row.fine_rate IS DISTINCT FROM v_category_rate THEN
      RAISE EXCEPTION
        'The book fine rate does not match its category. Please review the book category.';
    END IF;
  END IF;

  RETURN book_row;
END;
$function$;

ALTER FUNCTION public.update_personal_book_with_cover(
  text, text, text, text, text, text, text, text, integer, text, text,
  boolean, integer, boolean, text, integer
) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.update_personal_book_with_cover(
  text, text, text, text, text, text, text, text, integer, text, text,
  boolean, integer, boolean, text, integer
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_personal_book_with_cover(
  text, text, text, text, text, text, text, text, integer, text, text,
  boolean, integer, boolean, text, integer
) TO authenticated, service_role;

-- ============================================================
-- 6. Harden shelf_private.get_visitor_borrow_requests_unchecked(uuid)
-- ============================================================
-- Fix search_path to empty (trigger/private function)

DROP FUNCTION IF EXISTS shelf_private.get_visitor_borrow_requests_unchecked(uuid);

CREATE FUNCTION shelf_private.get_visitor_borrow_requests_unchecked (
  p_visitor_id uuid
)
RETURNS TABLE (
  id uuid,
  book_id text,
  book_title text,
  visitor_id text,
  visitor_name text,
  status text,
  request_date timestamp with time zone,
  pickup_deadline timestamp with time zone,
  queue_position integer,
  borrow_date timestamp with time zone,
  due_date timestamp with time zone,
  return_date timestamp with time zone,
  fine_amount numeric,
  confirmed_by text,
  return_confirmed_by text,
  fine_rate_snapshot integer,
  fine_review_required boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  RETURN QUERY
  SELECT
    br.id,
    br.book_id::text,
    br.book_title::text,
    br.visitor_id::text,
    br.visitor_name::text,
    br.status::text,
    br.request_date,
    br.pickup_deadline,
    br.queue_position,
    br.borrow_date,
    br.due_date,
    br.return_date,
    br.fine_amount::numeric,
    br.confirmed_by::text,
    br.return_confirmed_by::text,
    br.fine_rate_snapshot,
    (
      COALESCE(br.fine_review_required, false)
      OR (
        COALESCE(br.fine_amount, 0) <> 0
        AND (
          br.status <> 'returned'
          OR br.fine_rate_snapshot IS NULL
          OR br.fine_rate_snapshot NOT IN (10, 15, 20)
        )
      )
      OR (
        br.status IN ('borrowed', 'returned')
        AND (
          br.fine_rate_snapshot IS NULL
          OR br.fine_rate_snapshot NOT IN (10, 15, 20)
        )
      )
    ) AS fine_review_required
  FROM public.borrow_requests AS br
  JOIN public.visitors AS v ON v.id = br.visitor_id
  WHERE v.auth_user_id = p_visitor_id
  ORDER BY br.request_date DESC;
END;
$function$;

ALTER FUNCTION shelf_private.get_visitor_borrow_requests_unchecked(uuid) OWNER TO postgres;

REVOKE ALL ON FUNCTION shelf_private.get_visitor_borrow_requests_unchecked(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION shelf_private.get_visitor_borrow_requests_unchecked(uuid)
  TO postgres;

-- ============================================================
-- 7. Harden public.get_visitor_borrow_requests(uuid)
-- ============================================================
-- Fix search_path to empty, add AAL2 for visitor-facing function

DROP FUNCTION IF EXISTS public.get_visitor_borrow_requests(uuid);

CREATE FUNCTION public.get_visitor_borrow_requests (
  p_visitor_id uuid
)
RETURNS TABLE (
  id uuid,
  book_id text,
  book_title text,
  visitor_id text,
  visitor_name text,
  status text,
  request_date timestamp with time zone,
  pickup_deadline timestamp with time zone,
  queue_position integer,
  borrow_date timestamp with time zone,
  due_date timestamp with time zone,
  return_date timestamp with time zone,
  fine_amount numeric,
  confirmed_by text,
  return_confirmed_by text,
  fine_rate_snapshot integer,
  fine_review_required boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF auth.uid() IS NULL OR auth.uid() IS DISTINCT FROM p_visitor_id THEN
    RAISE EXCEPTION 'The authenticated visitor account could not be verified.';
  END IF;
  IF COALESCE(auth.jwt() ->> 'aal', 'aal1') <> 'aal2' THEN
    RAISE EXCEPTION 'AAL2 authentication is required.';
  END IF;

  RETURN QUERY
  SELECT *
  FROM shelf_private.get_visitor_borrow_requests_unchecked(p_visitor_id);
END;
$function$;

ALTER FUNCTION public.get_visitor_borrow_requests(uuid) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.get_visitor_borrow_requests(uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_visitor_borrow_requests(uuid)
  TO authenticated, service_role;

-- ============================================================
-- 8. Harden public.fetch_my_community_book_requests(text)
-- ============================================================
-- Fix search_path to empty, add AAL2 for visitor-facing function

DROP FUNCTION IF EXISTS public.fetch_my_community_book_requests(text);

CREATE FUNCTION public.fetch_my_community_book_requests (
  p_requester_visitor_id text
)
RETURNS TABLE (
  id uuid,
  book_id text,
  book_title text,
  owner_visitor_id text,
  owner_name text,
  requester_visitor_id text,
  requester_name text,
  status text,
  request_date timestamp with time zone,
  approved_at timestamp with time zone,
  rejected_at timestamp with time zone,
  owner_response text,
  pickup_deadline timestamp with time zone,
  borrow_date timestamp with time zone,
  due_date timestamp with time zone,
  return_date timestamp with time zone,
  fine_amount numeric,
  confirmed_by text,
  return_confirmed_by text,
  queue_position integer,
  owner_contact_email text,
  owner_contact_number text,
  owner_contact_details text,
  fine_rate_snapshot integer,
  fine_review_required boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (
    SELECT 1
    FROM public.visitors AS visitor
    WHERE visitor.id = pg_catalog.btrim(p_requester_visitor_id)
      AND visitor.auth_user_id = auth.uid()
      AND visitor.otp_verified
      AND visitor.is_active
  ) THEN
    RAISE EXCEPTION
      'The authenticated, verified visitor account could not be found.';
  END IF;
  IF COALESCE(auth.jwt() ->> 'aal', 'aal1') <> 'aal2' THEN
    RAISE EXCEPTION 'AAL2 authentication is required.';
  END IF;

  RETURN QUERY
  SELECT
    request.id,
    request.book_id::text,
    request.book_title::text,
    request.owner_visitor_id::text,
    request.owner_name::text,
    request.requester_visitor_id::text,
    request.requester_name::text,
    request.status::text,
    request.request_date,
    request.approved_at,
    request.rejected_at,
    request.owner_response::text,
    request.pickup_deadline,
    request.borrow_date,
    request.due_date,
    request.return_date,
    request.fine_amount::numeric,
    request.confirmed_by::text,
    request.return_confirmed_by::text,
    CASE
      WHEN request.status = 'pending' THEN (
        SELECT count(*)::integer
        FROM public.community_book_requests AS earlier
        WHERE earlier.book_id = request.book_id
          AND earlier.status = 'pending'
          AND (earlier.request_date, earlier.id)
            <= (request.request_date, request.id)
      )
      ELSE NULL::integer
    END,
    CASE
      WHEN request.status IN ('approved', 'borrowed')
        THEN owner.email::text
      ELSE NULL::text
    END,
    CASE
      WHEN request.status IN ('approved', 'borrowed')
        THEN owner.contact_number::text
      ELSE NULL::text
    END,
    CASE
      WHEN request.status IN ('approved', 'borrowed')
        THEN book.handover_details::text
      ELSE NULL::text
    END,
    request.fine_rate_snapshot,
    (
      COALESCE(request.fine_review_required, false)
      OR (
        COALESCE(request.fine_amount, 0) <> 0
        AND (
          request.status <> 'returned'
          OR request.fine_rate_snapshot IS NULL
          OR request.fine_rate_snapshot NOT IN (10, 15, 20)
        )
      )
      OR (
        request.status IN ('borrowed', 'returned')
        AND (
          request.fine_rate_snapshot IS NULL
          OR request.fine_rate_snapshot NOT IN (10, 15, 20)
        )
      )
    ) AS fine_review_required
  FROM public.community_book_requests AS request
  LEFT JOIN public.visitors AS owner
    ON owner.id = request.owner_visitor_id
  LEFT JOIN public.books AS book
    ON book.id = request.book_id
  WHERE request.requester_visitor_id = pg_catalog.btrim(p_requester_visitor_id)
  ORDER BY request.request_date DESC;
END;
$function$;

ALTER FUNCTION public.fetch_my_community_book_requests(text) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.fetch_my_community_book_requests(text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fetch_my_community_book_requests(text)
  TO authenticated, service_role;

-- ============================================================
-- 9. Harden abort_visitor_registration(text, text)
-- ============================================================
-- Fix search_path to empty (was public, auth)

DROP FUNCTION IF EXISTS public.abort_visitor_registration(text, text);

CREATE OR REPLACE FUNCTION public.abort_visitor_registration(
  p_visitor_id text,
  p_registration_nonce text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_visitor public.visitors%rowtype;
  v_metadata jsonb;
  v_nonce text;
BEGIN
  SELECT visitor.* INTO v_visitor
  FROM public.visitors AS visitor
  WHERE visitor.id = pg_catalog.btrim(p_visitor_id);

  IF v_visitor.id IS NULL THEN
    RETURN false;
  END IF;

  IF COALESCE(v_visitor.otp_verified, false) OR v_visitor.qr_code IS NOT NULL THEN
    RAISE EXCEPTION 'This visitor has already been verified and cannot be removed.';
  END IF;
  IF v_visitor.auth_user_id IS NULL THEN
    RAISE EXCEPTION 'This registration cannot be rolled back automatically.';
  END IF;

  SELECT account.raw_user_meta_data INTO v_metadata
  FROM auth.users AS account
  WHERE account.id = v_visitor.auth_user_id;
  v_nonce := v_metadata ->> 'registration_nonce';
  IF v_nonce IS NULL OR v_nonce <> pg_catalog.btrim(p_registration_nonce) THEN
    RAISE EXCEPTION 'A matching visitor registration proof is required.';
  END IF;

  DELETE FROM auth.users WHERE id = v_visitor.auth_user_id;

  INSERT INTO public.audit_logs(actor_id, action, branch_id, details)
  VALUES (
    auth.uid(),
    'visitor.registration.rolled_back',
    NULL,
    jsonb_build_object(
      'visitorId', v_visitor.id,
      'fullName', v_visitor.full_name,
      'email', v_visitor.email,
      'reason', 'verification_email_not_delivered'
    )
  );
  RETURN true;
END;
$function$;

ALTER FUNCTION public.abort_visitor_registration(text, text) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.abort_visitor_registration(text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.abort_visitor_registration(text, text)
  TO anon, authenticated;

-- ============================================================
-- Postflight validation
-- ============================================================
DO $postflight$
DECLARE
  v_signature regprocedure;
  v_acl_count integer;
BEGIN
  -- Validate deliver_subscription_renewal_followup
  v_signature := 'public.deliver_subscription_renewal_followup(uuid,date)'::regprocedure;
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS procedure
    JOIN pg_catalog.pg_language AS language ON language.oid = procedure.prolang
    WHERE procedure.oid = v_signature
      AND procedure.proowner = 'postgres'::regrole
      AND language.lanname = 'plpgsql'
      AND procedure.prorettype = 'integer'::regtype
      AND procedure.pronargs = 2
      AND procedure.prosecdef
      AND procedure.proconfig = ARRAY['search_path=""']::text[]
  ) THEN
    RAISE EXCEPTION 'deliver_subscription_renewal_followup metadata differs from the reviewed contract.';
  END IF;

  SELECT pg_catalog.count(*) INTO v_acl_count
  FROM pg_catalog.pg_proc AS procedure
  CROSS JOIN LATERAL pg_catalog.aclexplode(procedure.proacl) AS acl
  WHERE procedure.oid = v_signature;

  IF v_acl_count <> 3
     OR NOT pg_catalog.has_function_privilege('authenticated', v_signature, 'EXECUTE')
     OR NOT pg_catalog.has_function_privilege('service_role', v_signature, 'EXECUTE')
     OR pg_catalog.has_function_privilege('anon', v_signature, 'EXECUTE') THEN
    RAISE EXCEPTION 'deliver_subscription_renewal_followup EXECUTE privileges differ from the least-privilege contract.';
  END IF;

  -- Validate add_personal_book (14 args)
  v_signature := 'public.add_personal_book(text,text,text,text,text,text,text,integer,text,text,boolean,integer,boolean,integer)'::regprocedure;
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS procedure
    JOIN pg_catalog.pg_language AS language ON language.oid = procedure.prolang
    WHERE procedure.oid = v_signature
      AND procedure.proowner = 'postgres'::regrole
      AND language.lanname = 'plpgsql'
      AND procedure.prorettype = 'public.books'::regtype
      AND procedure.pronargs = 14
      AND procedure.prosecdef
      AND procedure.proconfig = ARRAY['search_path=""']::text[]
  ) THEN
    RAISE EXCEPTION 'add_personal_book(14 args) metadata differs from the reviewed contract.';
  END IF;

  -- Validate add_personal_book_with_cover (15 args)
  v_signature := 'public.add_personal_book_with_cover(text,text,text,text,text,text,text,integer,text,text,boolean,integer,boolean,text,integer)'::regprocedure;
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS procedure
    JOIN pg_catalog.pg_language AS language ON language.oid = procedure.prolang
    WHERE procedure.oid = v_signature
      AND procedure.proowner = 'postgres'::regrole
      AND language.lanname = 'plpgsql'
      AND procedure.prorettype = 'public.books'::regtype
      AND procedure.pronargs = 15
      AND procedure.prosecdef
      AND procedure.proconfig = ARRAY['search_path=""']::text[]
  ) THEN
    RAISE EXCEPTION 'add_personal_book_with_cover(15 args) metadata differs from the reviewed contract.';
  END IF;

  -- Validate update_personal_book (15 args)
  v_signature := 'public.update_personal_book(text,text,text,text,text,text,text,text,integer,text,text,boolean,integer,boolean,integer)'::regprocedure;
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS procedure
    JOIN pg_catalog.pg_language AS language ON language.oid = procedure.prolang
    WHERE procedure.oid = v_signature
      AND procedure.proowner = 'postgres'::regrole
      AND language.lanname = 'plpgsql'
      AND procedure.prorettype = 'public.books'::regtype
      AND procedure.pronargs = 15
      AND procedure.prosecdef
      AND procedure.proconfig = ARRAY['search_path=""']::text[]
  ) THEN
    RAISE EXCEPTION 'update_personal_book(15 args) metadata differs from the reviewed contract.';
  END IF;

  -- Validate update_personal_book_with_cover (16 args)
  v_signature := 'public.update_personal_book_with_cover(text,text,text,text,text,text,text,text,integer,text,text,boolean,integer,boolean,text,integer)'::regprocedure;
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS procedure
    JOIN pg_catalog.pg_language AS language ON language.oid = procedure.prolang
    WHERE procedure.oid = v_signature
      AND procedure.proowner = 'postgres'::regrole
      AND language.lanname = 'plpgsql'
      AND procedure.prorettype = 'public.books'::regtype
      AND procedure.pronargs = 16
      AND procedure.prosecdef
      AND procedure.proconfig = ARRAY['search_path=""']::text[]
  ) THEN
    RAISE EXCEPTION 'update_personal_book_with_cover(16 args) metadata differs from the reviewed contract.';
  END IF;

  -- Validate shelf_private.get_visitor_borrow_requests_unchecked
  v_signature := 'shelf_private.get_visitor_borrow_requests_unchecked(uuid)'::regprocedure;
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS procedure
    JOIN pg_catalog.pg_language AS language ON language.oid = procedure.prolang
    WHERE procedure.oid = v_signature
      AND procedure.proowner = 'postgres'::regrole
      AND language.lanname = 'plpgsql'
      AND procedure.pronargs = 1
      AND procedure.prosecdef
      AND procedure.proconfig = ARRAY['search_path=""']::text[]
  ) THEN
    RAISE EXCEPTION 'shelf_private.get_visitor_borrow_requests_unchecked metadata differs from the reviewed contract.';
  END IF;

  SELECT pg_catalog.count(*) INTO v_acl_count
  FROM pg_catalog.pg_proc AS procedure
  CROSS JOIN LATERAL pg_catalog.aclexplode(procedure.proacl) AS acl
  WHERE procedure.oid = v_signature;

  IF v_acl_count <> 1
     OR NOT pg_catalog.has_function_privilege('postgres', v_signature, 'EXECUTE')
     OR pg_catalog.has_function_privilege('anon', v_signature, 'EXECUTE')
     OR pg_catalog.has_function_privilege('authenticated', v_signature, 'EXECUTE')
     OR pg_catalog.has_function_privilege('service_role', v_signature, 'EXECUTE') THEN
    RAISE EXCEPTION 'shelf_private.get_visitor_borrow_requests_unchecked EXECUTE privileges differ from the least-privilege contract.';
  END IF;

  -- Validate public.get_visitor_borrow_requests
  v_signature := 'public.get_visitor_borrow_requests(uuid)'::regprocedure;
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS procedure
    JOIN pg_catalog.pg_language AS language ON language.oid = procedure.prolang
    WHERE procedure.oid = v_signature
      AND procedure.proowner = 'postgres'::regrole
      AND language.lanname = 'plpgsql'
      AND procedure.pronargs = 1
      AND procedure.prosecdef
      AND procedure.proconfig = ARRAY['search_path=""']::text[]
  ) THEN
    RAISE EXCEPTION 'public.get_visitor_borrow_requests metadata differs from the reviewed contract.';
  END IF;

  SELECT pg_catalog.count(*) INTO v_acl_count
  FROM pg_catalog.pg_proc AS procedure
  CROSS JOIN LATERAL pg_catalog.aclexplode(procedure.proacl) AS acl
  WHERE procedure.oid = v_signature;

  IF v_acl_count <> 3
     OR NOT pg_catalog.has_function_privilege('authenticated', v_signature, 'EXECUTE')
     OR NOT pg_catalog.has_function_privilege('service_role', v_signature, 'EXECUTE')
     OR pg_catalog.has_function_privilege('anon', v_signature, 'EXECUTE') THEN
    RAISE EXCEPTION 'public.get_visitor_borrow_requests EXECUTE privileges differ from the least-privilege contract.';
  END IF;

  -- Validate public.fetch_my_community_book_requests
  v_signature := 'public.fetch_my_community_book_requests(text)'::regprocedure;
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS procedure
    JOIN pg_catalog.pg_language AS language ON language.oid = procedure.prolang
    WHERE procedure.oid = v_signature
      AND procedure.proowner = 'postgres'::regrole
      AND language.lanname = 'plpgsql'
      AND procedure.pronargs = 1
      AND procedure.prosecdef
      AND procedure.proconfig = ARRAY['search_path=""']::text[]
  ) THEN
    RAISE EXCEPTION 'public.fetch_my_community_book_requests metadata differs from the reviewed contract.';
  END IF;

  SELECT pg_catalog.count(*) INTO v_acl_count
  FROM pg_catalog.pg_proc AS procedure
  CROSS JOIN LATERAL pg_catalog.aclexplode(procedure.proacl) AS acl
  WHERE procedure.oid = v_signature;

  IF v_acl_count <> 3
     OR NOT pg_catalog.has_function_privilege('authenticated', v_signature, 'EXECUTE')
     OR NOT pg_catalog.has_function_privilege('service_role', v_signature, 'EXECUTE')
     OR pg_catalog.has_function_privilege('anon', v_signature, 'EXECUTE') THEN
    RAISE EXCEPTION 'public.fetch_my_community_book_requests EXECUTE privileges differ from the least-privilege contract.';
  END IF;

  -- Validate abort_visitor_registration
  v_signature := 'public.abort_visitor_registration(text,text)'::regprocedure;
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS procedure
    JOIN pg_catalog.pg_language AS language ON language.oid = procedure.prolang
    WHERE procedure.oid = v_signature
      AND procedure.proowner = 'postgres'::regrole
      AND language.lanname = 'plpgsql'
      AND procedure.prorettype = 'boolean'::regtype
      AND procedure.pronargs = 2
      AND procedure.prosecdef
      AND procedure.proconfig = ARRAY['search_path=""']::text[]
  ) THEN
    RAISE EXCEPTION 'abort_visitor_registration metadata differs from the reviewed contract.';
  END IF;

  SELECT pg_catalog.count(*) INTO v_acl_count
  FROM pg_catalog.pg_proc AS procedure
  CROSS JOIN LATERAL pg_catalog.aclexplode(procedure.proacl) AS acl
  WHERE procedure.oid = v_signature;

  IF v_acl_count <> 3
     OR NOT pg_catalog.has_function_privilege('anon', v_signature, 'EXECUTE')
     OR NOT pg_catalog.has_function_privilege('authenticated', v_signature, 'EXECUTE')
     OR pg_catalog.has_function_privilege('service_role', v_signature, 'EXECUTE') THEN
    RAISE EXCEPTION 'abort_visitor_registration EXECUTE privileges differ from the least-privilege contract.';
  END IF;
END;
$postflight$;

NOTIFY pgrst, 'reload schema';
COMMIT;