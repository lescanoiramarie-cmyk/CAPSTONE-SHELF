-- Use PostgREST's verified request claims directly inside dedicated SECURITY DEFINER
-- functions. The managed auth schema is owned by supabase_admin; postgres cannot
-- grant its USAGE privilege to the dedicated NOLOGIN function-owner roles.

CREATE OR REPLACE FUNCTION public.shelf_rpc_request_uid()
RETURNS uuid
LANGUAGE sql
STABLE
SET search_path = ''
AS $function$
  SELECT COALESCE(
    NULLIF(pg_catalog.current_setting('request.jwt.claim.sub', true), ''),
    (NULLIF(pg_catalog.current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$function$;

CREATE OR REPLACE FUNCTION public.shelf_rpc_request_jwt()
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = ''
AS $function$
  SELECT COALESCE(
    NULLIF(pg_catalog.current_setting('request.jwt.claim', true), ''),
    NULLIF(pg_catalog.current_setting('request.jwt.claims', true), '')
  )::jsonb
$function$;

REVOKE ALL ON FUNCTION public.shelf_rpc_request_uid() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.shelf_rpc_request_jwt() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.shelf_rpc_request_uid()
  TO shelf_attendance_rpc_owner, shelf_book_reviews_rpc_owner;
GRANT EXECUTE ON FUNCTION public.shelf_rpc_request_jwt()
  TO shelf_attendance_rpc_owner;
GRANT SELECT (id) ON TABLE public.books TO shelf_book_reviews_rpc_owner;
CREATE OR REPLACE FUNCTION public.find_visitor_by_qr(
  p_qr text,
  p_library_id uuid
)
RETURNS TABLE (
  id text,
  full_name character varying,
  contact_number character varying,
  email character varying,
  address text,
  qr_code character varying,
  profile_image_path text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_staff_library_id uuid;
  v_role text;
  v_jwt_role text;
BEGIN
  IF public.shelf_rpc_request_uid() IS NULL THEN
    RAISE EXCEPTION 'Authenticated staff session required.';
  END IF;
  IF COALESCE(public.shelf_rpc_request_jwt() ->> 'aal', 'aal1') <> 'aal2' THEN
    RAISE EXCEPTION 'AAL2 authentication is required.';
  END IF;
  IF p_library_id IS NULL OR NULLIF(pg_catalog.btrim(p_qr), '') IS NULL THEN
    RAISE EXCEPTION 'A visitor QR pass and library branch are required.';
  END IF;

  SELECT pg_catalog.lower(pg_catalog.btrim(staff.role)), staff.library_id
    INTO v_role, v_staff_library_id
  FROM public.staff_profiles AS staff
  WHERE staff.id = public.shelf_rpc_request_uid()
    AND staff.is_active IS TRUE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Active staff profile required.';
  END IF;
  IF v_role NOT IN ('subadmin', 'superadmin') THEN
    RAISE EXCEPTION 'Unsupported staff role.';
  END IF;

  v_jwt_role := public.shelf_rpc_request_jwt() -> 'app_metadata' ->> 'role';
  IF v_jwt_role IS NOT NULL
     AND pg_catalog.lower(pg_catalog.btrim(v_jwt_role)) <> v_role THEN
    RAISE EXCEPTION 'Staff role does not match the authenticated role claim.';
  END IF;
  IF v_role = 'subadmin'
     AND v_staff_library_id IS DISTINCT FROM p_library_id THEN
    RAISE EXCEPTION 'You are not authorized to scan for this library.';
  END IF;

  RETURN QUERY
  SELECT visitor.id::text,
         visitor.full_name,
         visitor.contact_number,
         visitor.email::character varying,
         visitor.address,
         visitor.qr_code::character varying,
         visitor.profile_image_path
  FROM public.visitors AS visitor
  WHERE pg_catalog.upper(pg_catalog.btrim(visitor.qr_code)) =
        pg_catalog.upper(pg_catalog.btrim(p_qr))
    AND visitor.is_active IS TRUE
    AND visitor.otp_verified IS TRUE
  LIMIT 1;
END;
$function$;

CREATE OR REPLACE FUNCTION public.toggle_attendance(
  p_qr text,
  p_library_id text
)
RETURNS TABLE (log_id text, visitor_id text, visitor_name text, action text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_library_id uuid;
  v_staff_library_id uuid;
  v_role text;
  v_jwt_role text;
  v_visitor_id text;
  v_visitor_name text;
  v_log_id uuid;
  v_action text;
BEGIN
  IF public.shelf_rpc_request_uid() IS NULL THEN
    RAISE EXCEPTION 'Authenticated staff session required.';
  END IF;
  IF COALESCE(public.shelf_rpc_request_jwt() ->> 'aal', 'aal1') <> 'aal2' THEN
    RAISE EXCEPTION 'AAL2 authentication is required.';
  END IF;
  IF NULLIF(pg_catalog.btrim(p_qr), '') IS NULL
     OR NULLIF(pg_catalog.btrim(p_library_id), '') IS NULL THEN
    RAISE EXCEPTION 'A visitor QR pass and library branch are required.';
  END IF;

  BEGIN
    v_library_id := pg_catalog.btrim(p_library_id)::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'Invalid library branch.';
  END;

  SELECT pg_catalog.lower(pg_catalog.btrim(staff.role)), staff.library_id
    INTO v_role, v_staff_library_id
  FROM public.staff_profiles AS staff
  WHERE staff.id = public.shelf_rpc_request_uid()
    AND staff.is_active IS TRUE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Active staff profile required.';
  END IF;
  IF v_role NOT IN ('subadmin', 'superadmin') THEN
    RAISE EXCEPTION 'Unsupported staff role.';
  END IF;

  v_jwt_role := public.shelf_rpc_request_jwt() -> 'app_metadata' ->> 'role';
  IF v_jwt_role IS NOT NULL
     AND pg_catalog.lower(pg_catalog.btrim(v_jwt_role)) <> v_role THEN
    RAISE EXCEPTION 'Staff role does not match the authenticated role claim.';
  END IF;
  IF v_role = 'subadmin'
     AND v_staff_library_id IS DISTINCT FROM v_library_id THEN
    RAISE EXCEPTION 'You are not authorized to record attendance for this branch.';
  END IF;

  SELECT visitor.id::text, visitor.full_name
    INTO v_visitor_id, v_visitor_name
  FROM public.visitors AS visitor
  WHERE pg_catalog.upper(pg_catalog.btrim(visitor.qr_code)) =
        pg_catalog.upper(pg_catalog.btrim(p_qr))
    AND visitor.otp_verified IS TRUE
    AND visitor.is_active IS TRUE
  LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'QR code is invalid, unverified, or inactive.';
  END IF;

  SELECT attendance.id
    INTO v_log_id
  FROM public.attendance_logs AS attendance
  WHERE attendance.visitor_id = v_visitor_id
    AND attendance.library_id = v_library_id
    AND attendance.checked_out_at IS NULL
  ORDER BY attendance.time_in DESC
  LIMIT 1
  FOR UPDATE;

  IF FOUND THEN
    UPDATE public.attendance_logs AS attendance
       SET checked_out_at = pg_catalog.now()
     WHERE attendance.id = v_log_id
     RETURNING attendance.id INTO v_log_id;
    v_action := 'checked_out';
  ELSE
    INSERT INTO public.attendance_logs (visitor_id, visitor_name, library_id)
    VALUES (v_visitor_id, v_visitor_name, v_library_id)
    RETURNING id INTO v_log_id;
    v_action := 'checked_in';
  END IF;

  RETURN QUERY
  SELECT v_log_id::text, v_visitor_id, v_visitor_name::text, v_action;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_book_reviews(
  p_book_id text,
  p_limit integer DEFAULT 20,
  p_offset integer DEFAULT 0
)
RETURNS TABLE (
  id uuid,
  visitor_name text,
  rating smallint,
  comment text,
  created_at timestamptz,
  is_own boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF NULLIF(pg_catalog.btrim(p_book_id), '') IS NULL THEN
    RAISE EXCEPTION 'A book ID is required.';
  END IF;

  RETURN QUERY
  SELECT review.id,
    CASE
      WHEN pg_catalog.cardinality(pg_catalog.regexp_split_to_array(pg_catalog.btrim(review.visitor_name), '\s+')) > 1
      THEN pg_catalog.left((pg_catalog.regexp_split_to_array(pg_catalog.btrim(review.visitor_name), '\s+'))[1], 2)
        || '*** '
        || pg_catalog.upper(pg_catalog.left((pg_catalog.regexp_split_to_array(pg_catalog.btrim(review.visitor_name), '\s+'))[
          pg_catalog.cardinality(pg_catalog.regexp_split_to_array(pg_catalog.btrim(review.visitor_name), '\s+'))
        ], 1)) || '.'
      WHEN pg_catalog.btrim(review.visitor_name) <> ''
      THEN pg_catalog.left(pg_catalog.btrim(review.visitor_name), 2) || '***'
      ELSE 'Anonymous Visitor'
    END::text,
    review.rating,
    review.comment,
    review.created_at,
    EXISTS (
      SELECT 1 FROM public.visitors AS visitor
      WHERE visitor.id::text = review.visitor_id
        AND visitor.auth_user_id = public.shelf_rpc_request_uid()
        AND visitor.otp_verified IS TRUE
        AND visitor.is_active IS TRUE
    )
  FROM public.book_reviews AS review
  WHERE review.book_id = pg_catalog.btrim(p_book_id)
  ORDER BY review.created_at DESC, review.id DESC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 20), 1), 50)
  OFFSET GREATEST(COALESCE(p_offset, 0), 0);
END;
$function$;

CREATE OR REPLACE FUNCTION public.save_my_book_review(
  p_book_id text,
  p_rating integer,
  p_comment text DEFAULT ''
)
RETURNS TABLE (
  id uuid,
  visitor_name text,
  rating smallint,
  comment text,
  created_at timestamptz,
  is_own boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_visitor_count bigint;
  v_visitor_id text;
  v_visitor_name text;
  v_review_id uuid;
BEGIN
  IF public.shelf_rpc_request_uid() IS NULL THEN
    RAISE EXCEPTION 'A signed-in visitor account is required.';
  END IF;
  IF p_rating IS NULL OR p_rating < 1 OR p_rating > 5 THEN
    RAISE EXCEPTION 'Rating must be between 1 and 5.';
  END IF;
  IF NULLIF(pg_catalog.btrim(p_book_id), '') IS NULL
     OR pg_catalog.length(COALESCE(p_comment, '')) > 4000 THEN
    RAISE EXCEPTION 'A valid book and review comment are required.';
  END IF;

  SELECT pg_catalog.count(*), pg_catalog.min(visitor.id::text),
         pg_catalog.min(visitor.full_name::text)
    INTO v_visitor_count, v_visitor_id, v_visitor_name
  FROM public.visitors AS visitor
  WHERE visitor.auth_user_id = public.shelf_rpc_request_uid()
    AND visitor.otp_verified IS TRUE
    AND visitor.is_active IS TRUE;
  IF v_visitor_count <> 1 THEN
    RAISE EXCEPTION 'An active, verified visitor profile linked to this session is required.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.books AS book WHERE book.id::text = pg_catalog.btrim(p_book_id)
  ) THEN
    RAISE EXCEPTION 'Book not found.';
  END IF;

  SELECT review.id INTO v_review_id
  FROM public.book_reviews AS review
  WHERE review.book_id = pg_catalog.btrim(p_book_id)
    AND review.visitor_id = v_visitor_id
  FOR UPDATE;

  IF FOUND THEN
    UPDATE public.book_reviews AS review
    SET rating = p_rating::smallint,
        comment = COALESCE(p_comment, ''),
        updated_at = pg_catalog.now()
    WHERE review.id = v_review_id;
  ELSE
    INSERT INTO public.book_reviews (book_id, visitor_id, visitor_name, rating, comment)
    VALUES (pg_catalog.btrim(p_book_id), v_visitor_id, v_visitor_name,
            p_rating::smallint, COALESCE(p_comment, ''))
    RETURNING book_reviews.id INTO v_review_id;
  END IF;

  RETURN QUERY
  SELECT saved.id,
    CASE
      WHEN pg_catalog.cardinality(pg_catalog.regexp_split_to_array(pg_catalog.btrim(saved.visitor_name), '\s+')) > 1
      THEN pg_catalog.left((pg_catalog.regexp_split_to_array(pg_catalog.btrim(saved.visitor_name), '\s+'))[1], 2)
        || '*** '
        || pg_catalog.upper(pg_catalog.left((pg_catalog.regexp_split_to_array(pg_catalog.btrim(saved.visitor_name), '\s+'))[
          pg_catalog.cardinality(pg_catalog.regexp_split_to_array(pg_catalog.btrim(saved.visitor_name), '\s+'))
        ], 1)) || '.'
      WHEN pg_catalog.btrim(saved.visitor_name) <> ''
      THEN pg_catalog.left(pg_catalog.btrim(saved.visitor_name), 2) || '***'
      ELSE 'Anonymous Visitor'
    END::text,
    saved.rating, saved.comment, saved.created_at, true
  FROM public.book_reviews AS saved
  WHERE saved.id = v_review_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.delete_my_book_review(p_review_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_visitor_count bigint;
  v_visitor_id text;
  v_deleted_id uuid;
BEGIN
  IF public.shelf_rpc_request_uid() IS NULL THEN
    RAISE EXCEPTION 'A signed-in visitor account is required.';
  END IF;

  SELECT pg_catalog.count(*), pg_catalog.min(visitor.id::text)
    INTO v_visitor_count, v_visitor_id
  FROM public.visitors AS visitor
  WHERE visitor.auth_user_id = public.shelf_rpc_request_uid()
    AND visitor.otp_verified IS TRUE
    AND visitor.is_active IS TRUE;
  IF v_visitor_count <> 1 THEN
    RAISE EXCEPTION 'An active, verified visitor profile linked to this session is required.';
  END IF;

  DELETE FROM public.book_reviews AS review
  WHERE review.id = p_review_id
    AND review.visitor_id = v_visitor_id
  RETURNING review.id INTO v_deleted_id;
  RETURN v_deleted_id IS NOT NULL;
END;
$function$;

DROP POLICY IF EXISTS "attendance RPC owner reads own staff profile" ON public.staff_profiles;
CREATE POLICY "attendance RPC owner reads own staff profile"
  ON public.staff_profiles FOR SELECT TO shelf_attendance_rpc_owner
  USING (id = public.shelf_rpc_request_uid());

DROP POLICY IF EXISTS "book review RPC owner reads books" ON public.books;
CREATE POLICY "book review RPC owner reads books"
  ON public.books FOR SELECT TO shelf_book_reviews_rpc_owner
  USING (true);

DROP POLICY IF EXISTS "book review RPC owner reads visitors" ON public.visitors;
CREATE POLICY "book review RPC owner reads visitors"
  ON public.visitors FOR SELECT TO shelf_book_reviews_rpc_owner
  USING (auth_user_id = public.shelf_rpc_request_uid() AND otp_verified IS TRUE AND is_active IS TRUE);

ALTER FUNCTION public.shelf_rpc_request_uid() OWNER TO postgres;
ALTER FUNCTION public.shelf_rpc_request_jwt() OWNER TO postgres;