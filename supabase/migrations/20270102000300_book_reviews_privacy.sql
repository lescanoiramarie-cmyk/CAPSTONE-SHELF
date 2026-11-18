-- Remove direct access to raw review identity and route review operations
-- through narrow SECURITY DEFINER RPCs with server-derived ownership.

DO $role_check$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles
    WHERE rolname = 'shelf_book_reviews_rpc_owner'
  ) THEN
    CREATE ROLE shelf_book_reviews_rpc_owner NOLOGIN NOINHERIT NOBYPASSRLS;
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles
    WHERE rolname = 'shelf_book_reviews_rpc_owner'
      AND (rolcanlogin OR rolinherit OR rolbypassrls OR rolsuper)
  ) THEN
    RAISE EXCEPTION 'shelf_book_reviews_rpc_owner has unsafe role attributes';
  END IF;

  IF pg_catalog.pg_has_role('anon', 'shelf_book_reviews_rpc_owner', 'MEMBER')
     OR pg_catalog.pg_has_role('authenticated', 'shelf_book_reviews_rpc_owner', 'MEMBER')
     OR pg_catalog.pg_has_role('authenticator', 'shelf_book_reviews_rpc_owner', 'MEMBER')
     OR pg_catalog.pg_has_role('service_role', 'shelf_book_reviews_rpc_owner', 'MEMBER') THEN
    RAISE EXCEPTION 'An application-facing role can assume the book review RPC owner';
  END IF;
END;
$role_check$;

-- Read the authenticated subject from PostgREST's verified request claims.
-- This avoids granting the dedicated function owner access to the managed auth schema.
CREATE FUNCTION public.shelf_rpc_request_uid()
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

ALTER FUNCTION public.shelf_rpc_request_uid() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.shelf_rpc_request_uid()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.shelf_rpc_request_uid()
  TO shelf_book_reviews_rpc_owner;

GRANT USAGE, CREATE ON SCHEMA public TO shelf_book_reviews_rpc_owner;

GRANT SELECT (id, auth_user_id, full_name, otp_verified, is_active)
  ON TABLE public.visitors TO shelf_book_reviews_rpc_owner;
GRANT SELECT (id, book_id, visitor_id, visitor_name, rating, comment, created_at)
  ON TABLE public.book_reviews TO shelf_book_reviews_rpc_owner;
GRANT INSERT (book_id, visitor_id, visitor_name, rating, comment)
  ON TABLE public.book_reviews TO shelf_book_reviews_rpc_owner;
GRANT UPDATE (rating, comment)
  ON TABLE public.book_reviews TO shelf_book_reviews_rpc_owner;
GRANT DELETE ON TABLE public.book_reviews TO shelf_book_reviews_rpc_owner;

DROP POLICY IF EXISTS "read public reviews" ON public.book_reviews;
DROP POLICY IF EXISTS "visitors manage own reviews" ON public.book_reviews;
DROP POLICY IF EXISTS "book review RPC owner reads visitors" ON public.visitors;
DROP POLICY IF EXISTS "book review RPC owner reads reviews" ON public.book_reviews;

CREATE POLICY "book review RPC owner reads visitors"
  ON public.visitors FOR SELECT TO shelf_book_reviews_rpc_owner
  USING (auth_user_id = public.shelf_rpc_request_uid() AND otp_verified IS TRUE AND is_active IS TRUE);
CREATE POLICY "book review RPC owner reads reviews"
  ON public.book_reviews FOR ALL TO shelf_book_reviews_rpc_owner
  USING (true) WITH CHECK (true);

REVOKE ALL ON TABLE public.book_reviews FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.get_book_reviews(
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

CREATE FUNCTION public.save_my_book_review(
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
        comment = COALESCE(p_comment, '')
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

CREATE FUNCTION public.delete_my_book_review(p_review_id uuid)
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

GRANT CREATE ON SCHEMA public TO shelf_book_reviews_rpc_owner;
GRANT shelf_book_reviews_rpc_owner TO postgres;
ALTER FUNCTION public.get_book_reviews(text, integer, integer)
  OWNER TO shelf_book_reviews_rpc_owner;
ALTER FUNCTION public.save_my_book_review(text, integer, text)
  OWNER TO shelf_book_reviews_rpc_owner;
ALTER FUNCTION public.delete_my_book_review(uuid)
  OWNER TO shelf_book_reviews_rpc_owner;
REVOKE CREATE ON SCHEMA public FROM shelf_book_reviews_rpc_owner;

REVOKE ALL ON FUNCTION public.get_book_reviews(text, integer, integer)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_book_reviews(text, integer, integer)
  TO anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.save_my_book_review(text, integer, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.save_my_book_review(text, integer, text)
  TO authenticated;
REVOKE ALL ON FUNCTION public.delete_my_book_review(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.delete_my_book_review(uuid)
  TO authenticated;

NOTIFY pgrst, 'reload schema';
