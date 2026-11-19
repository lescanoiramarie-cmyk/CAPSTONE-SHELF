-- Version: 20270121000000. UI and RPC Reconciliation.
-- Forward-only migration addressing runtime RPC issues identified in UI audit:
-- 1. get_opac_category_book_counts: remove non-existent column b.is_active
-- 2. get_saved_community_books: remove non-existent column b.is_active (use v.is_active)
-- 3. get_staff_borrowing_history: use text[] for v_branch_book_ids and id text return type (borrow_requests.id and books.id are text)
-- 4. get_visitor_borrowing_history: use id text return type (borrow_requests.id is text)
-- 5. get_opac_filtered_book_count: allow public library branch filtering in OPAC
-- 6. opac_has_library_access: define explicitly and restrict to authenticated (least privilege)

BEGIN;

-- 1. Fix get_opac_category_book_counts
CREATE OR REPLACE FUNCTION public.get_opac_category_book_counts(
  p_library_id uuid DEFAULT NULL
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
    AND (p_library_id IS NULL OR b.library_id = p_library_id)
  GROUP BY COALESCE(b.category, 'Uncategorized')
  ORDER BY COALESCE(b.category, 'Uncategorized');
END;
$function$;

REVOKE ALL ON FUNCTION public.get_opac_category_book_counts(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_opac_category_book_counts(uuid) TO anon, authenticated;

-- 2. Fix get_saved_community_books
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
  SELECT id INTO v_visitor_id
  FROM public.visitors
  WHERE auth_user_id = auth.uid()
    AND is_active = true;

  IF v_visitor_id IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    b.id::text AS book_id,
    b.title::text,
    b.author::text,
    b.category::text,
    b.isbn::text,
    b.cover_url::text,
    b.owner_visitor_id::text,
    v.full_name::text AS owner_name,
    sb.saved_at
  FROM public.visitor_saved_community_books sb
  JOIN public.books b ON b.id = sb.community_book_id
  JOIN public.visitors v ON v.id = b.owner_visitor_id
  WHERE sb.visitor_id = v_visitor_id
    AND v.is_active = true
    AND b.is_public = true
    AND b.book_type = 'personal'
  ORDER BY sb.saved_at DESC;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_saved_community_books() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_saved_community_books() TO authenticated;

-- 3. Fix get_staff_borrowing_history
DROP FUNCTION IF EXISTS public.get_staff_borrowing_history(integer, text[]);

CREATE FUNCTION public.get_staff_borrowing_history(
  p_recent_days integer DEFAULT 35,
  p_active_statuses text[] DEFAULT ARRAY['pending', 'approved', 'borrowed', 'overdue']
)
RETURNS TABLE (
  id text,
  book_id text,
  book_title text,
  visitor_id text,
  visitor_name text,
  library_id uuid,
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
  fine_review_required boolean,
  fine_review_resolved_at timestamp with time zone
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_uid uuid;
  v_staff public.staff_profiles%ROWTYPE;
  v_jwt_role text;
  v_branch_book_ids text[];
  v_recent_start timestamptz;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authenticated staff session required.';
  END IF;

  -- Require AAL2 for staff operations
  IF COALESCE(auth.jwt() ->> 'aal', 'aal1') <> 'aal2' THEN
    RAISE EXCEPTION 'AAL2 authentication is required.';
  END IF;

  SELECT sp.* INTO v_staff
  FROM public.staff_profiles AS sp
  WHERE sp.id = v_uid AND sp.is_active IS TRUE
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Active staff profile required.';
  END IF;

  v_jwt_role := auth.jwt() -> 'app_metadata' ->> 'role';
  IF v_staff.role IS NULL
     OR v_staff.role NOT IN ('superadmin', 'subadmin', 'librarian')
     OR COALESCE(v_jwt_role, v_staff.role) <> v_staff.role THEN
    RAISE EXCEPTION 'Unauthorized staff role.';
  END IF;

  -- Sub-admin branch scoping
  IF v_staff.role = 'subadmin' THEN
    IF v_staff.library_id IS NULL THEN
      RAISE EXCEPTION 'Your staff account has no assigned library branch.';
    END IF;

    SELECT ARRAY_AGG(b.id) INTO v_branch_book_ids
    FROM public.books AS b
    WHERE b.library_id = v_staff.library_id
      AND b.book_type = 'library';

    IF v_branch_book_ids IS NULL OR array_length(v_branch_book_ids, 1) = 0 THEN
      RETURN;
    END IF;
  END IF;

  v_recent_start := (current_date - p_recent_days)::timestamptz;

  RETURN QUERY
  SELECT
    br.id::text,
    br.book_id::text,
    br.book_title::text,
    br.visitor_id::text,
    br.visitor_name::text,
    br.library_id,
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
    ) AS fine_review_required,
    br.fine_review_resolved_at
  FROM public.borrow_requests AS br
  WHERE (v_staff.role = 'superadmin' OR br.book_id = ANY(v_branch_book_ids))
    AND (
      br.request_date >= v_recent_start
      OR br.status = ANY(p_active_statuses)
    )
  ORDER BY br.request_date DESC, br.id ASC;
END;
$function$;

ALTER FUNCTION public.get_staff_borrowing_history(integer, text[]) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_staff_borrowing_history(integer, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_staff_borrowing_history(integer, text[]) TO authenticated, service_role;

-- 4. Fix get_visitor_borrowing_history
DROP FUNCTION IF EXISTS public.get_visitor_borrowing_history();

CREATE FUNCTION public.get_visitor_borrowing_history()
RETURNS TABLE (
  id text,
  book_id text,
  book_title text,
  visitor_id text,
  visitor_name text,
  library_id uuid,
  status text,
  request_date timestamp with time zone,
  pickup_deadline timestamp with time zone,
  queue_position integer,
  borrow_date timestamp with time zone,
  due_date timestamp with time zone,
  return_date timestamp with time zone,
  fine_amount numeric,
  fine_paid_amount numeric,
  confirmed_by text,
  return_confirmed_by text,
  fine_rate_snapshot integer,
  fine_review_required boolean,
  fine_review_resolved_at timestamp with time zone
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_uid uuid;
  v_visitor public.visitors%ROWTYPE;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authenticated visitor session required.';
  END IF;

  SELECT v.* INTO v_visitor
  FROM public.visitors AS v
  WHERE v.auth_user_id = v_uid
    AND v.otp_verified IS TRUE
    AND v.is_active IS TRUE
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Active, verified visitor account required.';
  END IF;

  RETURN QUERY
  SELECT
    br.id::text,
    br.book_id::text,
    br.book_title::text,
    br.visitor_id::text,
    br.visitor_name::text,
    br.library_id,
    br.status::text,
    br.request_date,
    br.pickup_deadline,
    br.queue_position,
    br.borrow_date,
    br.due_date,
    br.return_date,
    br.fine_amount::numeric,
    br.fine_paid_amount::numeric,
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
    ) AS fine_review_required,
    br.fine_review_resolved_at
  FROM public.borrow_requests AS br
  WHERE br.visitor_id = v_visitor.id
  ORDER BY br.request_date DESC, br.id ASC;
END;
$function$;

ALTER FUNCTION public.get_visitor_borrowing_history() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_visitor_borrowing_history() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_visitor_borrowing_history() TO authenticated, service_role;

-- 5. Fix get_opac_filtered_book_count
CREATE OR REPLACE FUNCTION public.get_opac_filtered_book_count(
  p_search text DEFAULT '',
  p_category text DEFAULT 'All',
  p_library_id uuid DEFAULT NULL,
  p_availability text DEFAULT 'All'
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_count bigint;
  v_normalized_search text;
  v_normalized_category text;
BEGIN
  v_normalized_search := lower(trim(coalesce(p_search, '')));
  v_normalized_category := lower(trim(coalesce(p_category, 'All')));

  SELECT count(*) INTO v_count
  FROM public.books b
  WHERE b.book_type = 'library'
    AND (v_normalized_search = '' OR
         lower(b.title) like '%' || v_normalized_search || '%' OR
         lower(b.author) like '%' || v_normalized_search || '%' OR
         lower(b.isbn) like '%' || v_normalized_search || '%' OR
         lower(b.category) like '%' || v_normalized_search || '%' OR
         lower(b.call_number) like '%' || v_normalized_search || '%')
    AND (v_normalized_category = 'all' OR lower(b.category) = v_normalized_category)
    AND (p_library_id IS NULL OR b.library_id = p_library_id)
    AND (p_availability = 'All' OR
         (p_availability = 'Available' AND b.available_copies > 0) OR
         (p_availability = 'Unavailable' AND b.available_copies = 0));

  IF (p_library_id IS NULL) AND (p_availability = 'All' OR p_availability = 'Unavailable') THEN
    SELECT v_count + count(*) INTO v_count
    FROM public.external_catalog_books ecb
    WHERE (v_normalized_search = '' OR
           lower(ecb.title) like '%' || v_normalized_search || '%' OR
           lower(ecb.author) like '%' || v_normalized_search || '%' OR
           lower(ecb.isbn) like '%' || v_normalized_search || '%' OR
           lower(ecb.category) like '%' || v_normalized_search || '%')
      AND (v_normalized_category = 'all' OR lower(ecb.category) = v_normalized_category);
  END IF;

  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.get_opac_filtered_book_count(text, text, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_opac_filtered_book_count(text, text, uuid, text) TO anon, authenticated;

-- 6. Helper opac_has_library_access
CREATE OR REPLACE FUNCTION public.opac_has_library_access(p_library_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT CASE
    WHEN p_library_id IS NULL THEN true
    WHEN auth.uid() IS NULL THEN false
    ELSE public.is_active_staff_for_branch(p_library_id::text)
  END;
$$;

REVOKE ALL ON FUNCTION public.opac_has_library_access(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.opac_has_library_access(uuid) TO authenticated;

-- Postflight assertions
DO $$
DECLARE
  v_count integer;
BEGIN
  SELECT count(*) INTO v_count
  FROM pg_proc
  WHERE proname IN (
    'get_opac_category_book_counts',
    'get_saved_community_books',
    'get_staff_borrowing_history',
    'get_visitor_borrowing_history',
    'get_opac_filtered_book_count',
    'opac_has_library_access'
  )
  AND pronamespace = 'public'::regnamespace;

  IF v_count < 6 THEN
    RAISE EXCEPTION 'Postflight failed: not all reconciled functions exist (found %)', v_count;
  END IF;
END $$;

COMMIT;
