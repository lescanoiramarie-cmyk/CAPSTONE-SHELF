-- Version: 20270103001000. Enforce review eligibility: only visitors who borrowed and returned the exact book can review.
-- Fixes bypasses by revoking direct table access and adding borrowing verification in save_my_book_review.

BEGIN;

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

    -- Upsert the review (unique constraint on book_id, visitor_id prevents duplicates)
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
        'Verified Reader'::text,
        saved.rating,
        saved.comment,
        saved.created_at,
        true
    FROM public.book_reviews AS saved
    WHERE saved.id = v_review_id;
END;
$function$;

-- Owner is the dedicated RPC role
ALTER FUNCTION public.save_my_book_review(text, integer, text) OWNER TO shelf_book_reviews_rpc_owner;

-- ============================================================
-- 2. Ensure direct table access is fully revoked
-- ============================================================
REVOKE ALL ON TABLE public.book_reviews FROM PUBLIC, anon, authenticated, service_role;

-- The dedicated RPC owner role has column-level grants from previous migrations
-- No additional grants to application roles

-- ============================================================
-- 3. Ensure RLS policies are minimal (only for RPC owner)
-- ============================================================
DROP POLICY IF EXISTS "read public reviews" ON public.book_reviews;
DROP POLICY IF EXISTS "visitors manage own reviews" ON public.book_reviews;

-- Only the RPC owner can access the table (via SECURITY DEFINER functions)
CREATE POLICY "book review RPC owner reads reviews"
    ON public.book_reviews FOR ALL TO shelf_book_reviews_rpc_owner
    USING (true) WITH CHECK (true);

-- ============================================================
-- 4. get_book_reviews - ensure it uses the RPC owner and is stable
-- ============================================================
-- Already properly defined in 20270102001100, just verify grants
REVOKE ALL ON FUNCTION public.get_book_reviews(text, integer, integer)
    FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_book_reviews(text, integer, integer)
    TO anon, authenticated, service_role;

-- ============================================================
-- 5. delete_my_book_review - verify ownership
-- ============================================================
DROP FUNCTION IF EXISTS public.delete_my_book_review(uuid);

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

ALTER FUNCTION public.delete_my_book_review(uuid) OWNER TO shelf_book_reviews_rpc_owner;

REVOKE ALL ON FUNCTION public.delete_my_book_review(uuid)
    FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.delete_my_book_review(uuid)
    TO authenticated;

-- ============================================================
-- 6. Postflight validation
-- ============================================================
DO $postflight$
DECLARE
    v_save_sig regprocedure := 'public.save_my_book_review(text,integer,text)'::regprocedure;
    v_get_sig regprocedure := 'public.get_book_reviews(text,integer,integer)'::regprocedure;
    v_delete_sig regprocedure := 'public.delete_my_book_review(uuid)'::regprocedure;
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

    -- Verify direct table access is revoked
    IF pg_catalog.has_table_privilege('anon', 'public.book_reviews', 'SELECT')
       OR pg_catalog.has_table_privilege('authenticated', 'public.book_reviews', 'INSERT')
       OR pg_catalog.has_table_privilege('authenticated', 'public.book_reviews', 'UPDATE')
       OR pg_catalog.has_table_privilege('authenticated', 'public.book_reviews', 'DELETE') THEN
        RAISE EXCEPTION 'Unexpected direct table privileges remain on book_reviews.';
    END IF;

    -- Verify unique constraint exists
    IF NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_constraint
        WHERE conname = 'book_reviews_book_id_visitor_id_key'
           OR (conrelid = 'public.book_reviews'::regclass AND contype = 'u')
    ) THEN
        RAISE EXCEPTION 'Unique constraint on (book_id, visitor_id) missing.';
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
