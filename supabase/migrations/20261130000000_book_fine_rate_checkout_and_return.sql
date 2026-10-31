BEGIN;

-- Capture explicit book rates at checkout and preserve assessed fine history.

ALTER TABLE public.borrow_requests
  ADD COLUMN IF NOT EXISTS fine_review_required boolean NOT NULL DEFAULT false;

-- Ensure updated_at exists before community-book RPCs use it.
ALTER TABLE public.community_book_requests
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

-- Backfill only the review marker. The community allocation trigger observes
-- status transitions, which this update does not change.
UPDATE public.borrow_requests
SET fine_review_required = true
WHERE status IN ('borrowed', 'returned')
  AND (
    fine_rate_snapshot IS NULL
    OR fine_rate_snapshot NOT IN (10, 15, 20)
  );

UPDATE public.community_book_requests
SET fine_review_required = true
WHERE status IN ('borrowed', 'returned')
  AND (
    fine_rate_snapshot IS NULL
    OR fine_rate_snapshot NOT IN (10, 15, 20)
  );

-- Keep the existing update_inventory_book function.
-- The books category trigger automatically derives fine_rate
-- whenever the category or lending_enabled value changes.
-- Do not manually override fine_rate in this migration.

CREATE OR REPLACE FUNCTION public.confirm_pickup (
  p_request_id uuid,
  p_staff_name text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_req public.borrow_requests%ROWTYPE;
  v_staff_role text;
  v_staff_library_id uuid;
  v_staff_name text;
  v_book_library_id uuid;
  v_book_type text;
  v_lending_enabled boolean;
  v_category text;
  v_fine_rate integer;
  v_jwt_role text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authenticated staff account required.';
  END IF;

  SELECT
    lower(sp.role),
    sp.library_id,
    COALESCE(NULLIF(btrim(sp.full_name), ''), sp.email)
  INTO
    v_staff_role,
    v_staff_library_id,
    v_staff_name
  FROM public.staff_profiles AS sp
  WHERE sp.id = auth.uid()
    AND sp.is_active IS TRUE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Active staff profile required.';
  END IF;

  v_jwt_role := auth.jwt() -> 'app_metadata' ->> 'role';

  IF v_staff_role IS NULL
     OR v_staff_role NOT IN ('superadmin', 'subadmin')
     OR COALESCE(v_jwt_role, v_staff_role) <> v_staff_role
  THEN
    RAISE EXCEPTION 'Unauthorized staff role.';
  END IF;

  SELECT br.*
  INTO v_req
  FROM public.borrow_requests AS br
  WHERE br.id = p_request_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Request not found.';
  END IF;

  SELECT b.library_id, b.book_type, b.lending_enabled, b.category, b.fine_rate
  INTO v_book_library_id, v_book_type, v_lending_enabled, v_category, v_fine_rate
  FROM public.books AS b
  WHERE b.id = v_req.book_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Book not found.';
  END IF;

  IF v_staff_role <> 'superadmin'
     AND v_staff_library_id IS DISTINCT FROM v_book_library_id
  THEN
    RAISE EXCEPTION 'You are not authorized to process this branch.';
  END IF;

  IF v_book_type IS DISTINCT FROM 'library'
   OR v_lending_enabled IS NOT TRUE THEN
    RAISE EXCEPTION 'This library book is not enabled for lending.';
  END IF;

  IF v_req.status <> 'ready_for_pickup' THEN
    RAISE EXCEPTION 'This request is not ready for pickup.';
  END IF;

  IF v_req.pickup_deadline IS NULL OR v_req.pickup_deadline <= now() THEN
    RAISE EXCEPTION
      'Pickup window expired. The hold must be released before checkout.';
  END IF;

  IF v_fine_rate IS NULL
     OR v_fine_rate NOT IN (10, 15, 20)
     OR v_fine_rate IS DISTINCT FROM public.get_category_fine_rate(v_category) THEN
    RAISE EXCEPTION
      'This book category has no valid fine rate. Update the category before checkout.';
  END IF;

  UPDATE public.borrow_requests
  SET
    status = 'borrowed',
    borrow_date = now(),
    due_date = now() + interval '7 days',
    confirmed_by = v_staff_name,
    fine_rate_snapshot = v_fine_rate,
    fine_review_required = false
  WHERE id = p_request_id;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.confirm_pickup(uuid, text)
  TO authenticated, postgres, service_role;

REVOKE ALL ON FUNCTION public.confirm_pickup(uuid, text)
  FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.confirm_return (
  p_request_id uuid,
  p_staff_name text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_req public.borrow_requests%ROWTYPE;
  v_staff_role text;
  v_staff_library_id uuid;
  v_staff_name text;
  v_book_library_id uuid;
  v_jwt_role text;
  v_overdue_days integer;
  v_fine numeric;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authenticated staff account required.';
  END IF;

  SELECT
    lower(sp.role),
    sp.library_id,
    COALESCE(NULLIF(btrim(sp.full_name), ''), sp.email)
  INTO
    v_staff_role,
    v_staff_library_id,
    v_staff_name
  FROM public.staff_profiles AS sp
  WHERE sp.id = auth.uid()
    AND sp.is_active IS TRUE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Active staff profile required.';
  END IF;

  v_jwt_role := auth.jwt() -> 'app_metadata' ->> 'role';

  IF v_staff_role IS NULL
     OR v_staff_role NOT IN ('superadmin', 'subadmin')
     OR COALESCE(v_jwt_role, v_staff_role) <> v_staff_role
  THEN
    RAISE EXCEPTION 'Unauthorized staff role.';
  END IF;

  SELECT br.*
  INTO v_req
  FROM public.borrow_requests AS br
  WHERE br.id = p_request_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Request not found.';
  END IF;

  SELECT b.library_id
  INTO v_book_library_id
  FROM public.books AS b
  WHERE b.id = v_req.book_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Book not found.';
  END IF;

  IF v_staff_role <> 'superadmin'
     AND v_staff_library_id IS DISTINCT FROM v_book_library_id
  THEN
    RAISE EXCEPTION 'You are not authorized to process this branch.';
  END IF;

  IF v_req.status <> 'borrowed' THEN
    RAISE EXCEPTION 'This item is not currently on loan.';
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

    UPDATE public.borrow_requests
    SET
      status = 'returned',
      return_date = now(),
      fine_amount = v_fine,
      fine_review_required = COALESCE(v_req.fine_review_required, false),
      return_confirmed_by = v_staff_name
    WHERE id = p_request_id;
  ELSE
    UPDATE public.borrow_requests
    SET
      status = 'returned',
      return_date = now(),
      fine_amount = v_req.fine_amount,
      fine_review_required = true,
      return_confirmed_by = v_staff_name
    WHERE id = p_request_id;
  END IF;

  PERFORM public.release_copy_and_promote(v_req.book_id);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.confirm_return(uuid, text)
  TO authenticated, postgres, service_role;
REVOKE ALL ON FUNCTION public.confirm_return(uuid, text) FROM PUBLIC, anon;

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
  WHERE cbr.id = p_request_id;
END;
$function$;

GRANT EXECUTE ON FUNCTION
  public.confirm_community_book_pickup(uuid, text)
  TO authenticated, postgres, service_role;

REVOKE ALL ON FUNCTION
  public.confirm_community_book_pickup(uuid, text)
  FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.confirm_community_book_return (
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
END;
$function$;

GRANT EXECUTE ON FUNCTION public.confirm_community_book_return(uuid, text)
  TO authenticated, postgres, service_role;
REVOKE ALL ON FUNCTION public.confirm_community_book_return(uuid, text)
  FROM PUBLIC, anon;

-- Rate-aware personal-book RPC overloads preserve the original contracts
-- for existing frontend calls while enforcing category-based fine rates.

CREATE OR REPLACE FUNCTION public.add_personal_book (
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
SET search_path TO 'public'
AS $function$
DECLARE
  book_row public.books%ROWTYPE;
  v_category_rate integer;
BEGIN
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

GRANT EXECUTE ON FUNCTION public.add_personal_book(
  text, text, text, text, text, text, text, integer, text, text, boolean,
  integer, boolean, integer
) TO authenticated, postgres, service_role;

REVOKE ALL ON FUNCTION public.add_personal_book(
  text, text, text, text, text, text, text, integer, text, text, boolean,
  integer, boolean, integer
) FROM PUBLIC, anon;


CREATE OR REPLACE FUNCTION public.add_personal_book_with_cover (
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
SET search_path TO 'public'
AS $function$
DECLARE
  book_row public.books%ROWTYPE;
  v_category_rate integer;
BEGIN
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

GRANT EXECUTE ON FUNCTION public.add_personal_book_with_cover(
  text, text, text, text, text, text, text, integer, text, text, boolean,
  integer, boolean, text, integer
) TO authenticated, postgres, service_role;

REVOKE ALL ON FUNCTION public.add_personal_book_with_cover(
  text, text, text, text, text, text, text, integer, text, text, boolean,
  integer, boolean, text, integer
) FROM PUBLIC, anon;


CREATE OR REPLACE FUNCTION public.update_personal_book (
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
SET search_path TO 'public'
AS $function$
DECLARE
  book_row public.books%ROWTYPE;
  v_category_rate integer;
BEGIN
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

GRANT EXECUTE ON FUNCTION public.update_personal_book(
  text, text, text, text, text, text, text, text, integer, text, text,
  boolean, integer, boolean, integer
) TO authenticated, postgres, service_role;

REVOKE ALL ON FUNCTION public.update_personal_book(
  text, text, text, text, text, text, text, text, integer, text, text,
  boolean, integer, boolean, integer
) FROM PUBLIC, anon;


CREATE OR REPLACE FUNCTION public.update_personal_book_with_cover (
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
SET search_path TO 'public'
AS $function$
DECLARE
  book_row public.books%ROWTYPE;
  v_category_rate integer;
BEGIN
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

GRANT EXECUTE ON FUNCTION public.update_personal_book_with_cover(
  text, text, text, text, text, text, text, text, integer, text, text,
  boolean, integer, boolean, text, integer
) TO authenticated, postgres, service_role;

REVOKE ALL ON FUNCTION public.update_personal_book_with_cover(
  text, text, text, text, text, text, text, text, integer, text, text,
  boolean, integer, boolean, text, integer
) FROM PUBLIC, anon;

-- Extend only the request result shapes needed to display the snapshot/review
-- state. The existing identity checks and row visibility remain unchanged.

DROP FUNCTION public.get_visitor_borrow_requests(uuid);
DROP FUNCTION shelf_private.get_visitor_borrow_requests_unchecked(uuid);

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
SET search_path TO 'public', 'pg_temp'
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

GRANT EXECUTE ON FUNCTION shelf_private.get_visitor_borrow_requests_unchecked(uuid)
  TO postgres;

REVOKE ALL ON FUNCTION shelf_private.get_visitor_borrow_requests_unchecked(uuid)
  FROM PUBLIC, anon, authenticated, service_role;


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
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF auth.uid() IS NULL OR auth.uid() IS DISTINCT FROM p_visitor_id THEN
    RAISE EXCEPTION 'The authenticated visitor account could not be verified.';
  END IF;

  RETURN QUERY
  SELECT *
  FROM shelf_private.get_visitor_borrow_requests_unchecked(p_visitor_id);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.get_visitor_borrow_requests(uuid)
  TO authenticated, postgres, service_role;

REVOKE ALL ON FUNCTION public.get_visitor_borrow_requests(uuid)
  FROM PUBLIC, anon;


DROP FUNCTION public.fetch_my_community_book_requests(text);

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
SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (
    SELECT 1
    FROM public.visitors AS visitor
    WHERE visitor.id = trim(p_requester_visitor_id)
      AND visitor.auth_user_id = auth.uid()
      AND visitor.otp_verified
      AND visitor.is_active
  ) THEN
    RAISE EXCEPTION
      'The authenticated, verified visitor account could not be found.';
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
  WHERE request.requester_visitor_id = trim(p_requester_visitor_id)
  ORDER BY request.request_date DESC;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.fetch_my_community_book_requests(text)
  TO authenticated, postgres, service_role;

REVOKE ALL ON FUNCTION public.fetch_my_community_book_requests(text)
  FROM PUBLIC, anon;


DROP FUNCTION public.fetch_owner_community_book_requests(text);

CREATE FUNCTION public.fetch_owner_community_book_requests (
  p_owner_visitor_id text
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
  borrow_date timestamp with time zone,
  due_date timestamp with time zone,
  return_date timestamp with time zone,
  fine_amount numeric,
  fine_rate_snapshot integer,
  fine_review_required boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_visitor_id text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication is required.';
  END IF;

  SELECT v.id::text
  INTO v_visitor_id
  FROM public.visitors AS v
  WHERE v.auth_user_id = auth.uid()
    AND v.id::text = trim(p_owner_visitor_id)
    AND v.otp_verified = true
    AND v.is_active = true
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Visitor identity could not be verified.';
  END IF;

  RETURN QUERY
  SELECT
    cbr.id,
    cbr.book_id,
    cbr.book_title,
    cbr.owner_visitor_id,
    cbr.owner_name,
    cbr.requester_visitor_id,
    cbr.requester_name,
    cbr.status::text,
    cbr.request_date,
    cbr.approved_at,
    cbr.rejected_at,
    cbr.owner_response,
    cbr.borrow_date,
    cbr.due_date,
    cbr.return_date,
    cbr.fine_amount::numeric,
    cbr.fine_rate_snapshot,
    (
      COALESCE(cbr.fine_review_required, false)
      OR (
        COALESCE(cbr.fine_amount, 0) <> 0
        AND (
          cbr.status <> 'returned'
          OR cbr.fine_rate_snapshot IS NULL
          OR cbr.fine_rate_snapshot NOT IN (10, 15, 20)
        )
      )
      OR (
        cbr.status IN ('borrowed', 'returned')
        AND (
          cbr.fine_rate_snapshot IS NULL
          OR cbr.fine_rate_snapshot NOT IN (10, 15, 20)
        )
      )
    ) AS fine_review_required
  FROM public.community_book_requests AS cbr
  WHERE cbr.owner_visitor_id = v_visitor_id
  ORDER BY
    CASE
      WHEN cbr.status = 'pending' THEN 0
      WHEN cbr.status = 'approved' THEN 1
      ELSE 2
    END,
    cbr.request_date DESC;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.fetch_owner_community_book_requests(text)
  TO authenticated, postgres, service_role;

REVOKE ALL ON FUNCTION public.fetch_owner_community_book_requests(text)
  FROM PUBLIC, anon;


NOTIFY pgrst, 'reload schema';

COMMIT;