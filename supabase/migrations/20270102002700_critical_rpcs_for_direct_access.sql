-- Critical RPCs to replace direct Supabase access
-- get_current_user_role, get_visitor_profile, get_staff_borrowing_history
-- All with AAL2 for staff, AAL1 for visitors, empty search_path, schema qualification, least-privilege grants

BEGIN;

-- ============================================================
-- 1. get_current_user_role - Replace direct staff_profiles/visitors reads for auth scope
-- ============================================================

DROP FUNCTION IF EXISTS public.get_current_user_role();

CREATE FUNCTION public.get_current_user_role()
RETURNS TABLE (
  user_type text,
  role text,
  library_id uuid,
  visitor_id text,
  is_active boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_uid uuid;
  v_staff public.staff_profiles%ROWTYPE;
  v_visitor public.visitors%ROWTYPE;
  v_jwt_role text;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RETURN QUERY SELECT 'anonymous'::text, NULL::text, NULL::uuid, NULL::text, FALSE;
    RETURN;
  END IF;

  -- Check staff profile first (AAL2 required for staff operations)
  IF COALESCE(auth.jwt() ->> 'aal', 'aal1') = 'aal2' THEN
    SELECT sp.* INTO v_staff
    FROM public.staff_profiles AS sp
    WHERE sp.id = v_uid AND sp.is_active IS TRUE
    LIMIT 1;

    IF FOUND THEN
      v_jwt_role := auth.jwt() -> 'app_metadata' ->> 'role';
      IF v_staff.role IS NULL
         OR v_staff.role NOT IN ('superadmin', 'subadmin', 'librarian')
         OR COALESCE(v_jwt_role, v_staff.role) <> v_staff.role THEN
        RETURN QUERY SELECT 'anonymous'::text, NULL::text, NULL::uuid, NULL::text, FALSE;
        RETURN;
      END IF;

      RETURN QUERY SELECT
        CASE v_staff.role WHEN 'superadmin' THEN 'superadmin' ELSE 'subadmin' END,
        v_staff.role,
        v_staff.library_id,
        NULL::text,
        TRUE;
      RETURN;
    END IF;
  END IF;

  -- Check visitor profile (AAL1 sufficient for visitor operations)
  SELECT v.* INTO v_visitor
  FROM public.visitors AS v
  WHERE v.auth_user_id = v_uid
    AND v.otp_verified IS TRUE
    AND v.is_active IS TRUE
  LIMIT 1;

  IF FOUND THEN
    RETURN QUERY SELECT 'visitor'::text, 'visitor'::text, NULL::uuid, v_visitor.id, TRUE;
    RETURN;
  END IF;

  RETURN QUERY SELECT 'anonymous'::text, NULL::text, NULL::uuid, NULL::text, FALSE;
END;
$function$;

ALTER FUNCTION public.get_current_user_role() OWNER TO postgres;

REVOKE ALL ON FUNCTION public.get_current_user_role() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_current_user_role() TO authenticated, service_role;

-- ============================================================
-- 2. get_visitor_profile - Secure visitor profile loading
-- ============================================================

DROP FUNCTION IF EXISTS public.get_visitor_profile();

CREATE FUNCTION public.get_visitor_profile()
RETURNS TABLE (
  id text,
  auth_user_id uuid,
  full_name text,
  email text,
  contact_number text,
  address text,
  profile_image_url text,
  library_id uuid,
  otp_verified boolean,
  is_active boolean,
  status text,
  visitor_type text,
  qr_code text,
  created_at timestamp with time zone,
  updated_at timestamp with time zone
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
    RAISE EXCEPTION 'Authenticated session required.';
  END IF;

  SELECT v.* INTO v_visitor
  FROM public.visitors AS v
  WHERE v.auth_user_id = v_uid
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Visitor profile not found for the authenticated user.';
  END IF;

  RETURN QUERY SELECT
    v_visitor.id,
    v_visitor.auth_user_id,
    v_visitor.full_name,
    v_visitor.email,
    v_visitor.contact_number,
    v_visitor.address,
    v_visitor.profile_image_url,
    v_visitor.library_id,
    v_visitor.otp_verified,
    v_visitor.is_active,
    v_visitor.status,
    v_visitor.visitor_type,
    v_visitor.qr_code,
    v_visitor.created_at,
    v_visitor.updated_at;
END;
$function$;

ALTER FUNCTION public.get_visitor_profile() OWNER TO postgres;

REVOKE ALL ON FUNCTION public.get_visitor_profile() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_visitor_profile() TO authenticated, service_role;

-- ============================================================
-- 3. get_staff_borrowing_history - Replace direct borrow_requests/books access
-- ============================================================

DROP FUNCTION IF EXISTS public.get_staff_borrowing_history(
  p_recent_days integer DEFAULT 35,
  p_active_statuses text[] DEFAULT ARRAY['pending', 'queued', 'ready_for_pickup', 'borrowed']
);

CREATE FUNCTION public.get_staff_borrowing_history(
  p_recent_days integer DEFAULT 35,
  p_active_statuses text[] DEFAULT ARRAY['pending', 'queued', 'ready_for_pickup', 'borrowed']
)
RETURNS TABLE (
  id uuid,
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
  v_branch_book_ids uuid[];
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
    br.id,
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

-- ============================================================
-- 4. get_visitor_borrowing_history - Visitor's own borrowing history
-- ============================================================

DROP FUNCTION IF EXISTS public.get_visitor_borrowing_history();

CREATE FUNCTION public.get_visitor_borrowing_history()
RETURNS TABLE (
  id uuid,
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
    br.id,
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

-- ============================================================
-- Postflight validation
-- ============================================================
DO $postflight$
DECLARE
  v_signature regprocedure;
  v_acl_count integer;
BEGIN
  -- Validate get_current_user_role
  v_signature := 'public.get_current_user_role()'::regprocedure;
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS procedure
    JOIN pg_catalog.pg_language AS language ON language.oid = procedure.prolang
    WHERE procedure.oid = v_signature
      AND procedure.proowner = 'postgres'::regrole
      AND language.lanname = 'plpgsql'
      AND procedure.pronargs = 0
      AND procedure.prosecdef
      AND procedure.proconfig = ARRAY['search_path=""']::text[]
  ) THEN
    RAISE EXCEPTION 'get_current_user_role metadata differs from the reviewed contract.';
  END IF;

  SELECT pg_catalog.count(*) INTO v_acl_count
  FROM pg_catalog.pg_proc AS procedure
  CROSS JOIN LATERAL pg_catalog.aclexplode(procedure.proacl) AS acl
  WHERE procedure.oid = v_signature;

  IF v_acl_count <> 2
     OR NOT pg_catalog.has_function_privilege('authenticated', v_signature, 'EXECUTE')
     OR NOT pg_catalog.has_function_privilege('service_role', v_signature, 'EXECUTE')
     OR pg_catalog.has_function_privilege('anon', v_signature, 'EXECUTE') THEN
    RAISE EXCEPTION 'get_current_user_role EXECUTE privileges differ from the least-privilege contract.';
  END IF;

  -- Validate get_visitor_profile
  v_signature := 'public.get_visitor_profile()'::regprocedure;
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS procedure
    JOIN pg_catalog.pg_language AS language ON language.oid = procedure.prolang
    WHERE procedure.oid = v_signature
      AND procedure.proowner = 'postgres'::regrole
      AND language.lanname = 'plpgsql'
      AND procedure.pronargs = 0
      AND procedure.prosecdef
      AND procedure.proconfig = ARRAY['search_path=""']::text[]
  ) THEN
    RAISE EXCEPTION 'get_visitor_profile metadata differs from the reviewed contract.';
  END IF;

  SELECT pg_catalog.count(*) INTO v_acl_count
  FROM pg_catalog.pg_proc AS procedure
  CROSS JOIN LATERAL pg_catalog.aclexplode(procedure.proacl) AS acl
  WHERE procedure.oid = v_signature;

  IF v_acl_count <> 2
     OR NOT pg_catalog.has_function_privilege('authenticated', v_signature, 'EXECUTE')
     OR NOT pg_catalog.has_function_privilege('service_role', v_signature, 'EXECUTE')
     OR pg_catalog.has_function_privilege('anon', v_signature, 'EXECUTE') THEN
    RAISE EXCEPTION 'get_visitor_profile EXECUTE privileges differ from the least-privilege contract.';
  END IF;

  -- Validate get_staff_borrowing_history
  v_signature := 'public.get_staff_borrowing_history(integer,text[])'::regprocedure;
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS procedure
    JOIN pg_catalog.pg_language AS language ON language.oid = procedure.prolang
    WHERE procedure.oid = v_signature
      AND procedure.proowner = 'postgres'::regrole
      AND language.lanname = 'plpgsql'
      AND procedure.pronargs = 2
      AND procedure.prosecdef
      AND procedure.proconfig = ARRAY['search_path=""']::text[]
  ) THEN
    RAISE EXCEPTION 'get_staff_borrowing_history metadata differs from the reviewed contract.';
  END IF;

  SELECT pg_catalog.count(*) INTO v_acl_count
  FROM pg_catalog.pg_proc AS procedure
  CROSS JOIN LATERAL pg_catalog.aclexplode(procedure.proacl) AS acl
  WHERE procedure.oid = v_signature;

  IF v_acl_count <> 2
     OR NOT pg_catalog.has_function_privilege('authenticated', v_signature, 'EXECUTE')
     OR NOT pg_catalog.has_function_privilege('service_role', v_signature, 'EXECUTE')
     OR pg_catalog.has_function_privilege('anon', v_signature, 'EXECUTE') THEN
    RAISE EXCEPTION 'get_staff_borrowing_history EXECUTE privileges differ from the least-privilege contract.';
  END IF;

  -- Validate get_visitor_borrowing_history
  v_signature := 'public.get_visitor_borrowing_history()'::regprocedure;
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS procedure
    JOIN pg_catalog.pg_language AS language ON language.oid = procedure.prolang
    WHERE procedure.oid = v_signature
      AND procedure.proowner = 'postgres'::regrole
      AND language.lanname = 'plpgsql'
      AND procedure.pronargs = 0
      AND procedure.prosecdef
      AND procedure.proconfig = ARRAY['search_path=""']::text[]
  ) THEN
    RAISE EXCEPTION 'get_visitor_borrowing_history metadata differs from the reviewed contract.';
  END IF;

  SELECT pg_catalog.count(*) INTO v_acl_count
  FROM pg_catalog.pg_proc AS procedure
  CROSS JOIN LATERAL pg_catalog.aclexplode(procedure.proacl) AS acl
  WHERE procedure.oid = v_signature;

  IF v_acl_count <> 2
     OR NOT pg_catalog.has_function_privilege('authenticated', v_signature, 'EXECUTE')
     OR NOT pg_catalog.has_function_privilege('service_role', v_signature, 'EXECUTE')
     OR pg_catalog.has_function_privilege('anon', v_signature, 'EXECUTE') THEN
    RAISE EXCEPTION 'get_visitor_borrowing_history EXECUTE privileges differ from the least-privilege contract.';
  END IF;
END;
$postflight$;

NOTIFY pgrst, 'reload schema';
COMMIT;