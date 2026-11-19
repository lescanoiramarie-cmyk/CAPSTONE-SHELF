-- Version: 20270119000000. Reconcile Book Review Security, Privacy, and Eligibility.
-- Forward-only migration addressing historical schema drift:
-- 1. Absence of updated_at column in public.book_reviews
-- 2. Normalization of review IDs (bigint in DB, text in API) and ratings (integer)
-- 3. Atomic review upsert with canonical unique constraint (book_id, visitor_id)
-- 4. Review eligibility enforcement: verified borrower before saving reviews
-- 5. Strict least-privilege security definer ownership under shelf_book_reviews_rpc_owner

BEGIN;

-- Supported schemas differ: the original migration used UUID/smallint, while
-- the saved production snapshot uses bigint/integer. RPCs normalize IDs to
-- text and ratings to integer. Ensure the upsert key without changing data.
DO $review_uniqueness$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM public.book_reviews
        WHERE visitor_id IS NOT NULL
        GROUP BY book_id, visitor_id
        HAVING pg_catalog.count(*) > 1
    ) THEN
        RAISE EXCEPTION 'Duplicate visitor book reviews exist; resolve them with an approved data plan before applying review eligibility.';
    END IF;

    IF EXISTS (
        SELECT 1 FROM pg_catalog.pg_constraint AS constraint_row
        WHERE constraint_row.conrelid = 'public.book_reviews'::regclass
          AND constraint_row.conname = 'book_reviews_book_id_visitor_id_key'
          AND (
              constraint_row.contype <> 'u'
              OR constraint_row.condeferrable
              OR (
                  SELECT pg_catalog.array_agg(attribute_row.attname::text ORDER BY key_column.ordinality)
                  FROM pg_catalog.unnest(constraint_row.conkey) WITH ORDINALITY AS key_column(attnum, ordinality)
                  JOIN pg_catalog.pg_attribute AS attribute_row
                    ON attribute_row.attrelid = constraint_row.conrelid
                   AND attribute_row.attnum = key_column.attnum
              ) IS DISTINCT FROM ARRAY['book_id', 'visitor_id']::text[]
          )
    ) THEN
        RAISE EXCEPTION 'Constraint name book_reviews_book_id_visitor_id_key is occupied by a noncanonical definition.';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_catalog.pg_constraint AS constraint_row
        WHERE constraint_row.conrelid = 'public.book_reviews'::regclass
          AND constraint_row.contype = 'u'
          AND NOT constraint_row.condeferrable
          AND (
              SELECT pg_catalog.array_agg(attribute_row.attname::text ORDER BY key_column.ordinality)
              FROM pg_catalog.unnest(constraint_row.conkey) WITH ORDINALITY AS key_column(attnum, ordinality)
              JOIN pg_catalog.pg_attribute AS attribute_row
                ON attribute_row.attrelid = constraint_row.conrelid
               AND attribute_row.attnum = key_column.attnum
          ) = ARRAY['book_id', 'visitor_id']::text[]
    ) THEN
        ALTER TABLE public.book_reviews
            ADD CONSTRAINT book_reviews_book_id_visitor_id_key UNIQUE (book_id, visitor_id);
    END IF;
END;
$review_uniqueness$;

-- The eligibility SECURITY DEFINER RPC reads only these four columns. The
-- dedicated owner is NOLOGIN and must not be assumable by API-facing roles.
DO $review_owner_guard$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_roles
        WHERE rolname = 'shelf_book_reviews_rpc_owner'
    ) THEN
        CREATE ROLE shelf_book_reviews_rpc_owner NOLOGIN NOINHERIT NOBYPASSRLS;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_roles
        WHERE rolname = 'shelf_book_reviews_rpc_owner'
          AND NOT rolcanlogin AND NOT rolinherit AND NOT rolbypassrls AND NOT rolsuper
    ) OR pg_catalog.pg_has_role('anon', 'shelf_book_reviews_rpc_owner', 'MEMBER')
       OR pg_catalog.pg_has_role('authenticated', 'shelf_book_reviews_rpc_owner', 'MEMBER')
       OR pg_catalog.pg_has_role('authenticator', 'shelf_book_reviews_rpc_owner', 'MEMBER')
       OR pg_catalog.pg_has_role('service_role', 'shelf_book_reviews_rpc_owner', 'MEMBER') THEN
        RAISE EXCEPTION 'Book review RPC owner role is absent or assumable by an application role.';
    END IF;
END;
$review_owner_guard$;

GRANT USAGE, CREATE ON SCHEMA public TO shelf_book_reviews_rpc_owner;

-- Ensure request UID helper is available and executable by review RPC owner
CREATE OR REPLACE FUNCTION public.shelf_rpc_request_uid()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT NULLIF(
    COALESCE(
      pg_catalog.current_setting('request.jwt.claim.sub', true),
      (pg_catalog.current_setting('request.jwt.claims', true)::jsonb ->> 'sub')
    ),
    ''
  )::uuid;
$function$;

ALTER FUNCTION public.shelf_rpc_request_uid() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.shelf_rpc_request_uid() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.shelf_rpc_request_uid() TO authenticated, shelf_book_reviews_rpc_owner;

GRANT SELECT (id, auth_user_id, otp_verified, is_active, full_name)
    ON TABLE public.visitors TO shelf_book_reviews_rpc_owner;
GRANT SELECT (id)
    ON TABLE public.books TO shelf_book_reviews_rpc_owner;

DROP POLICY IF EXISTS "book review RPC owner reads active visitors" ON public.visitors;
CREATE POLICY "book review RPC owner reads active visitors"
    ON public.visitors FOR SELECT TO shelf_book_reviews_rpc_owner
    USING (auth_user_id = public.shelf_rpc_request_uid() AND otp_verified IS TRUE AND is_active IS TRUE);

DROP POLICY IF EXISTS "book review RPC owner reads books" ON public.books;
CREATE POLICY "book review RPC owner reads books"
    ON public.books FOR SELECT TO shelf_book_reviews_rpc_owner
    USING (true);

GRANT SELECT (visitor_id, book_id, status, return_date)
    ON TABLE public.borrow_requests TO shelf_book_reviews_rpc_owner;
GRANT SELECT (requester_visitor_id, book_id, status, return_date)
    ON TABLE public.community_book_requests TO shelf_book_reviews_rpc_owner;

DROP POLICY IF EXISTS "book review RPC owner reads borrow requests" ON public.borrow_requests;
CREATE POLICY "book review RPC owner reads borrow requests"
    ON public.borrow_requests FOR SELECT TO shelf_book_reviews_rpc_owner
    USING (true);
DROP POLICY IF EXISTS "book review RPC owner reads community requests" ON public.community_book_requests;
CREATE POLICY "book review RPC owner reads community requests"
    ON public.community_book_requests FOR SELECT TO shelf_book_reviews_rpc_owner
    USING (true);

-- ============================================================
-- 1. Add review eligibility check to save_my_book_review
-- ============================================================
DROP FUNCTION IF EXISTS public.save_my_book_review(text, integer, text);

CREATE OR REPLACE FUNCTION public.save_my_book_review(
    p_book_id text,
    p_rating integer,
    p_comment text DEFAULT ''
)
RETURNS TABLE (
    id text,
    visitor_name text,
    rating integer,
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
    v_review_id text;
    v_eligible boolean := false;
BEGIN
    -- Require authenticated visitor session
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

    -- Get the authenticated visitor
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

    -- Verify book exists
    IF NOT EXISTS (
        SELECT 1 FROM public.books AS book WHERE book.id::text = pg_catalog.btrim(p_book_id)
    ) THEN
        RAISE EXCEPTION 'Book not found.';
    END IF;

    -- ============================================================
    -- ELIGIBILITY CHECK: Visitor must have successfully borrowed
    -- and returned THIS EXACT BOOK.
    -- Check both library borrow_requests and community_book_requests.
    -- ============================================================
    v_eligible := EXISTS (
        -- Library books: borrowed and returned
        SELECT 1 FROM public.borrow_requests AS br
        WHERE br.visitor_id = v_visitor_id
          AND br.book_id = pg_catalog.btrim(p_book_id)
          AND br.status = 'returned'
          AND br.return_date IS NOT NULL
    ) OR EXISTS (
        -- Community books: borrowed and returned
        SELECT 1 FROM public.community_book_requests AS cbr
        WHERE cbr.requester_visitor_id = v_visitor_id
          AND cbr.book_id = pg_catalog.btrim(p_book_id)
          AND cbr.status = 'returned'
          AND cbr.return_date IS NOT NULL
    );

    IF NOT v_eligible THEN
        RAISE EXCEPTION 'You can only review books you have borrowed and returned.';
    END IF;

    -- Atomic upsert backed by the exact unique constraint established above.
    INSERT INTO public.book_reviews (book_id, visitor_id, visitor_name, rating, comment)
    VALUES (pg_catalog.btrim(p_book_id), v_visitor_id, v_visitor_name,
            p_rating::integer, COALESCE(p_comment, ''))
    ON CONFLICT (book_id, visitor_id) DO UPDATE
      SET rating = EXCLUDED.rating,
          comment = EXCLUDED.comment
    RETURNING book_reviews.id::text INTO v_review_id;

    RETURN QUERY
    SELECT saved.id::text,
        'Verified Reader'::text,
        saved.rating::integer,
        saved.comment,
        saved.created_at,
        true
    FROM public.book_reviews AS saved
    WHERE saved.id::text = v_review_id;
END;
$function$;

-- Owner is the dedicated RPC role
ALTER FUNCTION public.save_my_book_review(text, integer, text) OWNER TO shelf_book_reviews_rpc_owner;

REVOKE ALL ON FUNCTION public.save_my_book_review(text, integer, text)
    FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.save_my_book_review(text, integer, text)
    TO authenticated;

-- ============================================================
-- 2. Ensure direct table access is fully revoked
-- ============================================================
REVOKE ALL ON TABLE public.book_reviews FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, DELETE ON TABLE public.book_reviews TO shelf_book_reviews_rpc_owner;
GRANT UPDATE (rating, comment) ON TABLE public.book_reviews TO shelf_book_reviews_rpc_owner;

-- ============================================================
-- 3. Ensure RLS policies are minimal (only for RPC owner)
-- ============================================================
DROP POLICY IF EXISTS "read public reviews" ON public.book_reviews;
DROP POLICY IF EXISTS "visitors manage own reviews" ON public.book_reviews;

-- Only the RPC owner can access the table (via SECURITY DEFINER functions)
DROP POLICY IF EXISTS "book review RPC owner reads reviews" ON public.book_reviews;
CREATE POLICY "book review RPC owner reads reviews"
    ON public.book_reviews FOR ALL TO shelf_book_reviews_rpc_owner
    USING (true) WITH CHECK (true);

ALTER TABLE public.book_reviews ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 4. get_book_reviews - ensure it uses the RPC owner and is stable
-- ============================================================
DROP FUNCTION IF EXISTS public.get_book_reviews(text, integer, integer);

CREATE OR REPLACE FUNCTION public.get_book_reviews(
    p_book_id text,
    p_limit integer DEFAULT 10,
    p_offset integer DEFAULT 0
)
RETURNS TABLE (
    id text,
    visitor_name text,
    rating integer,
    comment text,
    created_at timestamptz,
    is_own boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_caller_auth_uid uuid := public.shelf_rpc_request_uid();
    v_caller_visitor_id text;
BEGIN
    IF NULLIF(pg_catalog.btrim(p_book_id), '') IS NULL THEN
        RAISE EXCEPTION 'A valid book_id is required.';
    END IF;

    IF v_caller_auth_uid IS NOT NULL THEN
        SELECT visitor.id
          INTO v_caller_visitor_id
          FROM public.visitors AS visitor
         WHERE visitor.auth_user_id = v_caller_auth_uid
           AND visitor.otp_verified IS TRUE
           AND visitor.is_active IS TRUE
         LIMIT 1;
    END IF;

    RETURN QUERY
    SELECT review.id::text,
        'Verified Reader'::text,
        review.rating::integer,
        review.comment,
        review.created_at,
        (v_caller_visitor_id IS NOT NULL AND review.visitor_id = v_caller_visitor_id) AS is_own
    FROM public.book_reviews AS review
    WHERE review.book_id = p_book_id
    ORDER BY review.created_at DESC
    LIMIT pg_catalog.least(pg_catalog.greatest(p_limit, 1), 50)
    OFFSET pg_catalog.greatest(p_offset, 0);
END;
$function$;

ALTER FUNCTION public.get_book_reviews(text, integer, integer) OWNER TO shelf_book_reviews_rpc_owner;

REVOKE ALL ON FUNCTION public.get_book_reviews(text, integer, integer)
    FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_book_reviews(text, integer, integer)
    TO anon, authenticated, service_role;

-- ============================================================
-- 5. delete_my_book_review - verify ownership
-- ============================================================
DROP FUNCTION IF EXISTS public.delete_my_book_review(uuid);
DROP FUNCTION IF EXISTS public.delete_my_book_review(text);

CREATE OR REPLACE FUNCTION public.delete_my_book_review(p_review_id text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_visitor_count bigint;
    v_visitor_id text;
    v_deleted_id text;
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
    WHERE review.id::text = p_review_id
      AND review.visitor_id = v_visitor_id
    RETURNING review.id::text INTO v_deleted_id;
    RETURN v_deleted_id IS NOT NULL;
END;
$function$;

ALTER FUNCTION public.delete_my_book_review(text) OWNER TO shelf_book_reviews_rpc_owner;

REVOKE ALL ON FUNCTION public.delete_my_book_review(text)
    FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.delete_my_book_review(text)
    TO authenticated;

-- Least privilege: drop CREATE on public schema after ownership established
REVOKE CREATE ON SCHEMA public FROM shelf_book_reviews_rpc_owner;

-- ============================================================
-- 6. Postflight validation
-- ============================================================
DO $postflight$
DECLARE
    v_save_sig regprocedure := 'public.save_my_book_review(text,integer,text)'::regprocedure;
    v_get_sig regprocedure := 'public.get_book_reviews(text,integer,integer)'::regprocedure;
    v_delete_sig regprocedure := 'public.delete_my_book_review(text)'::regprocedure;
BEGIN
    -- Verify function ownership
    IF NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_proc p
        JOIN pg_catalog.pg_language l ON l.oid = p.prolang
        WHERE p.oid = v_save_sig
          AND p.proowner = 'shelf_book_reviews_rpc_owner'::regrole
          AND l.lanname = 'plpgsql'
          AND p.prosecdef
          AND p.proconfig = ARRAY['search_path=""']::text[]
    ) THEN
        RAISE EXCEPTION 'save_my_book_review ownership/metadata mismatch.';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_proc p
        JOIN pg_catalog.pg_language l ON l.oid = p.prolang
        WHERE p.oid = v_get_sig
          AND p.proowner = 'shelf_book_reviews_rpc_owner'::regrole
          AND l.lanname = 'plpgsql'
          AND p.prosecdef
          AND p.proconfig = ARRAY['search_path=""']::text[]
    ) THEN
        RAISE EXCEPTION 'get_book_reviews ownership/metadata mismatch.';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_proc p
        JOIN pg_catalog.pg_language l ON l.oid = p.prolang
        WHERE p.oid = v_delete_sig
          AND p.proowner = 'shelf_book_reviews_rpc_owner'::regrole
          AND l.lanname = 'plpgsql'
          AND p.prosecdef
          AND p.proconfig = ARRAY['search_path=""']::text[]
    ) THEN
        RAISE EXCEPTION 'delete_my_book_review ownership/metadata mismatch.';
    END IF;

    IF NOT pg_catalog.has_column_privilege('shelf_book_reviews_rpc_owner', 'public.borrow_requests', 'visitor_id', 'SELECT')
       OR NOT pg_catalog.has_column_privilege('shelf_book_reviews_rpc_owner', 'public.borrow_requests', 'book_id', 'SELECT')
       OR NOT pg_catalog.has_column_privilege('shelf_book_reviews_rpc_owner', 'public.borrow_requests', 'status', 'SELECT')
       OR NOT pg_catalog.has_column_privilege('shelf_book_reviews_rpc_owner', 'public.borrow_requests', 'return_date', 'SELECT')
       OR NOT pg_catalog.has_column_privilege('shelf_book_reviews_rpc_owner', 'public.community_book_requests', 'requester_visitor_id', 'SELECT')
       OR NOT pg_catalog.has_column_privilege('shelf_book_reviews_rpc_owner', 'public.community_book_requests', 'book_id', 'SELECT')
       OR NOT pg_catalog.has_column_privilege('shelf_book_reviews_rpc_owner', 'public.community_book_requests', 'status', 'SELECT')
       OR NOT pg_catalog.has_column_privilege('shelf_book_reviews_rpc_owner', 'public.community_book_requests', 'return_date', 'SELECT') THEN
        RAISE EXCEPTION 'Review RPC owner eligibility column grants mismatch.';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_policy AS policy_row
        WHERE policy_row.polrelid = 'public.borrow_requests'::regclass
          AND policy_row.polname = 'book review RPC owner reads borrow requests'
          AND policy_row.polcmd = 'r'
          AND policy_row.polroles = ARRAY['shelf_book_reviews_rpc_owner'::regrole::oid]
          AND pg_catalog.pg_get_expr(policy_row.polqual, policy_row.polrelid) = 'true'
    ) OR NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_policy AS policy_row
        WHERE policy_row.polrelid = 'public.community_book_requests'::regclass
          AND policy_row.polname = 'book review RPC owner reads community requests'
          AND policy_row.polcmd = 'r'
          AND policy_row.polroles = ARRAY['shelf_book_reviews_rpc_owner'::regrole::oid]
          AND pg_catalog.pg_get_expr(policy_row.polqual, policy_row.polrelid) = 'true'
    ) THEN
        RAISE EXCEPTION 'Review RPC owner eligibility RLS policies mismatch.';
    END IF;

    -- Verify direct table access is revoked
    IF pg_catalog.has_table_privilege('anon', 'public.book_reviews', 'SELECT')
       OR pg_catalog.has_table_privilege('authenticated', 'public.book_reviews', 'INSERT')
       OR pg_catalog.has_table_privilege('authenticated', 'public.book_reviews', 'UPDATE')
       OR pg_catalog.has_table_privilege('authenticated', 'public.book_reviews', 'DELETE') THEN
        RAISE EXCEPTION 'Unexpected direct table privileges remain on book_reviews.';
    END IF;

    -- Verify the exact unique constraint required by the upsert exists.
    IF NOT EXISTS (
        SELECT 1
        FROM pg_catalog.pg_constraint AS constraint_row
        WHERE constraint_row.conrelid = 'public.book_reviews'::regclass
          AND constraint_row.contype = 'u'
          AND (
              SELECT pg_catalog.array_agg(attribute_row.attname::text ORDER BY key_column.ordinality)
              FROM pg_catalog.unnest(constraint_row.conkey) WITH ORDINALITY AS key_column(attnum, ordinality)
              JOIN pg_catalog.pg_attribute AS attribute_row
                ON attribute_row.attrelid = constraint_row.conrelid
               AND attribute_row.attnum = key_column.attnum
          ) = ARRAY['book_id', 'visitor_id']::text[]
    ) THEN
        RAISE EXCEPTION 'Exact unique constraint on (book_id, visitor_id) missing.';
    END IF;

    -- Verify request UID helper function and privileges
    IF NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_proc p
        WHERE p.oid = 'public.shelf_rpc_request_uid()'::regprocedure
          AND p.proowner = 'postgres'::regrole
          AND p.prosecdef
          AND p.proconfig = ARRAY['search_path=""']::text[]
    ) OR NOT pg_catalog.has_function_privilege('shelf_book_reviews_rpc_owner', 'public.shelf_rpc_request_uid()', 'EXECUTE')
       OR NOT pg_catalog.has_column_privilege('shelf_book_reviews_rpc_owner', 'public.visitors', 'id', 'SELECT')
       OR NOT pg_catalog.has_column_privilege('shelf_book_reviews_rpc_owner', 'public.books', 'id', 'SELECT') THEN
        RAISE EXCEPTION 'Request UID or helper table privileges mismatch.';
    END IF;

    -- Verify RPC grants
    IF NOT pg_catalog.has_function_privilege('anon', v_get_sig, 'EXECUTE')
       OR NOT pg_catalog.has_function_privilege('authenticated', v_get_sig, 'EXECUTE')
       OR NOT pg_catalog.has_function_privilege('authenticated', v_save_sig, 'EXECUTE')
       OR NOT pg_catalog.has_function_privilege('authenticated', v_delete_sig, 'EXECUTE')
       OR pg_catalog.has_function_privilege('anon', v_save_sig, 'EXECUTE')
       OR pg_catalog.has_function_privilege('anon', v_delete_sig, 'EXECUTE') THEN
        RAISE EXCEPTION 'RPC EXECUTE grants mismatch.';
    END IF;
END;
$postflight$;

NOTIFY pgrst, 'reload schema';
COMMIT;
