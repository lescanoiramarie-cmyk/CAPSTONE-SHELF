-- Fail closed when the signed JWT role claim is absent or differs from the
-- active staff profile. Keep the existing helper contracts and ACLs intact.
DO $preflight$
BEGIN
  IF pg_catalog.to_regprocedure('public.is_active_staff_for_branch(text)') IS NULL
     OR pg_catalog.to_regprocedure('public.is_shelf_superadmin()') IS NULL THEN
    RAISE EXCEPTION 'Required staff authorization helpers are missing.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS p
    JOIN pg_catalog.pg_language AS l ON l.oid = p.prolang
    WHERE p.oid = 'public.is_active_staff_for_branch(text)'::regprocedure
      AND p.proowner = 'postgres'::regrole
      AND l.lanname = 'sql'
      AND p.provolatile = 's'
      AND p.prosecdef
      AND p.proconfig = ARRAY['search_path=public']::text[]
  ) OR NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS p
    JOIN pg_catalog.pg_language AS l ON l.oid = p.prolang
    WHERE p.oid = 'public.is_shelf_superadmin()'::regprocedure
      AND p.proowner = 'postgres'::regrole
      AND l.lanname = 'sql'
      AND p.provolatile = 's'
      AND p.prosecdef
      AND p.proconfig = ARRAY['search_path=public, pg_temp']::text[]
  ) THEN
    RAISE EXCEPTION 'Staff authorization helper metadata differs from the reviewed baseline.';
  END IF;

  IF pg_catalog.strpos(
       pg_catalog.pg_get_functiondef('public.is_active_staff_for_branch(text)'::regprocedure),
       $fallback$coalesce(auth.jwt() -> 'app_metadata' ->> 'role', staff.role)$fallback$
     ) = 0
     OR pg_catalog.strpos(
       pg_catalog.pg_get_functiondef('public.is_shelf_superadmin()'::regprocedure),
       $fallback$coalesce(auth.jwt() -> 'app_metadata' ->> 'role', staff.role)$fallback$
     ) = 0 THEN
    RAISE EXCEPTION 'Staff authorization helper body is not the reviewed fallback implementation.';
  END IF;

  IF pg_catalog.to_regprocedure('public.get_book_reviews(text,integer,integer)') IS NULL
     OR pg_catalog.to_regprocedure('public.save_my_book_review(text,integer,text)') IS NULL
     OR pg_catalog.to_regrole('shelf_book_reviews_rpc_owner') IS NULL THEN
    RAISE EXCEPTION 'Required book review RPCs or owner role are missing.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS p
    JOIN pg_catalog.pg_language AS l ON l.oid = p.prolang
    WHERE p.oid = 'public.get_book_reviews(text,integer,integer)'::regprocedure
      AND p.proowner = 'shelf_book_reviews_rpc_owner'::regrole
      AND l.lanname = 'plpgsql'
      AND p.provolatile = 's'
      AND p.prosecdef
      AND p.proconfig = ARRAY['search_path=""']::text[]
  ) OR NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS p
    JOIN pg_catalog.pg_language AS l ON l.oid = p.prolang
    WHERE p.oid = 'public.save_my_book_review(text,integer,text)'::regprocedure
      AND p.proowner = 'shelf_book_reviews_rpc_owner'::regrole
      AND l.lanname = 'plpgsql'
      AND p.provolatile = 'v'
      AND p.prosecdef
      AND p.proconfig = ARRAY['search_path=""']::text[]
  ) THEN
    RAISE EXCEPTION 'Book review RPC ownership or security metadata differs from the reviewed baseline.';
  END IF;

  -- Existing direct column ACLs for the two API roles would survive a table
  -- REVOKE. The reviewed schema has none; stop rather than silently altering
  -- an unexpected column-level grant.
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_class AS relation
    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
    JOIN pg_catalog.pg_attribute AS attribute ON attribute.attrelid = relation.oid
    CROSS JOIN LATERAL pg_catalog.aclexplode(attribute.attacl) AS acl
    WHERE namespace.nspname = 'public'
      AND relation.relname IN ('books', 'staff_profiles')
      AND attribute.attnum > 0
      AND NOT attribute.attisdropped
      AND acl.grantee IN (0, 'anon'::regrole::oid, 'authenticated'::regrole::oid)
  ) THEN
    RAISE EXCEPTION 'Unexpected PUBLIC/anon/authenticated column ACL found on books or staff_profiles.';
  END IF;
END;
$preflight$;

CREATE OR REPLACE FUNCTION public.is_active_staff_for_branch(p_branch_id text DEFAULT NULL::text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.staff_profiles AS staff
    WHERE staff.id = auth.uid()
      AND staff.is_active IS TRUE
      AND staff.role IN ('superadmin', 'subadmin')
      AND auth.jwt() -> 'app_metadata' ->> 'role' IS NOT NULL
      AND auth.jwt() -> 'app_metadata' ->> 'role' = staff.role
      AND (
        staff.role = 'superadmin'
        OR (
          staff.role = 'subadmin'
          AND p_branch_id IS NOT NULL
          AND staff.library_id::text = p_branch_id
        )
      )
  );
$function$;

CREATE OR REPLACE FUNCTION public.is_shelf_superadmin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.staff_profiles AS staff
    WHERE staff.id = auth.uid()
      AND staff.role = 'superadmin'
      AND staff.is_active IS TRUE
      AND auth.jwt() -> 'app_metadata' ->> 'role' IS NOT NULL
      AND auth.jwt() -> 'app_metadata' ->> 'role' = 'superadmin'
  );
$function$;

-- Keep both existing RPC signatures, authorization, ownership, grants, and
-- response fields. Only the visitor_name display value becomes generic.
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
    'Verified Reader'::text,
    review.rating,
    review.comment,
    review.created_at,
    EXISTS (
      SELECT 1
      FROM public.visitors AS visitor
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
  p_comment text DEFAULT ''::text
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
    'Verified Reader'::text,
    saved.rating,
    saved.comment,
    saved.created_at,
    true
  FROM public.book_reviews AS saved
  WHERE saved.id = v_review_id;
END;
$function$;

-- REST catalog operations used by the frontend:
-- anon: catalog SELECT only;
-- authenticated: catalog SELECT, inventory INSERT/DELETE, and the import's
-- narrowly scoped stock/call-number UPDATE. Normal editing remains in its
-- branch-checked update_inventory_book RPC.
REVOKE ALL PRIVILEGES ON TABLE public.books FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.books TO anon, authenticated;
GRANT INSERT, DELETE ON TABLE public.books TO authenticated;
GRANT UPDATE (total_copies, available_copies, call_number)
  ON TABLE public.books TO authenticated;

-- Staff profile data is read through authenticated RLS only. No frontend
-- caller writes this table directly; privileged changes remain RPC/service-side.
REVOKE ALL PRIVILEGES ON TABLE public.staff_profiles FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.staff_profiles TO authenticated;

DO $postflight$
DECLARE
  v_column record;
  v_expected_update boolean;
BEGIN
  IF pg_catalog.has_table_privilege('anon', 'public.books', 'SELECT') IS NOT TRUE
     OR pg_catalog.has_table_privilege('anon', 'public.books', 'INSERT')
     OR pg_catalog.has_table_privilege('anon', 'public.books', 'UPDATE')
     OR pg_catalog.has_table_privilege('anon', 'public.books', 'DELETE')
     OR pg_catalog.has_table_privilege('anon', 'public.books', 'TRUNCATE')
     OR pg_catalog.has_table_privilege('anon', 'public.books', 'REFERENCES')
     OR pg_catalog.has_table_privilege('anon', 'public.books', 'TRIGGER')
     OR pg_catalog.has_table_privilege('anon', 'public.books', 'MAINTAIN') THEN
    RAISE EXCEPTION 'Unexpected effective anon privilege remains on public.books.';
  END IF;

  IF pg_catalog.has_table_privilege('authenticated', 'public.books', 'SELECT') IS NOT TRUE
     OR pg_catalog.has_table_privilege('authenticated', 'public.books', 'INSERT') IS NOT TRUE
     OR pg_catalog.has_table_privilege('authenticated', 'public.books', 'DELETE') IS NOT TRUE
     OR pg_catalog.has_table_privilege('authenticated', 'public.books', 'TRUNCATE')
     OR pg_catalog.has_table_privilege('authenticated', 'public.books', 'REFERENCES')
     OR pg_catalog.has_table_privilege('authenticated', 'public.books', 'TRIGGER')
     OR pg_catalog.has_table_privilege('authenticated', 'public.books', 'MAINTAIN')
     OR pg_catalog.has_column_privilege('authenticated', 'public.books', 'total_copies', 'UPDATE') IS NOT TRUE
     OR pg_catalog.has_column_privilege('authenticated', 'public.books', 'available_copies', 'UPDATE') IS NOT TRUE
     OR pg_catalog.has_column_privilege('authenticated', 'public.books', 'call_number', 'UPDATE') IS NOT TRUE
     OR pg_catalog.has_column_privilege('authenticated', 'public.books', 'title', 'UPDATE') THEN
    RAISE EXCEPTION 'Unexpected effective authenticated privilege remains on public.books.';
  END IF;

  IF pg_catalog.has_table_privilege('anon', 'public.staff_profiles', 'SELECT')
     OR pg_catalog.has_table_privilege('anon', 'public.staff_profiles', 'INSERT')
     OR pg_catalog.has_table_privilege('anon', 'public.staff_profiles', 'UPDATE')
     OR pg_catalog.has_table_privilege('anon', 'public.staff_profiles', 'DELETE')
     OR pg_catalog.has_table_privilege('anon', 'public.staff_profiles', 'TRUNCATE')
     OR pg_catalog.has_table_privilege('anon', 'public.staff_profiles', 'REFERENCES')
     OR pg_catalog.has_table_privilege('anon', 'public.staff_profiles', 'TRIGGER')
     OR pg_catalog.has_table_privilege('anon', 'public.staff_profiles', 'MAINTAIN')
     OR pg_catalog.has_table_privilege('authenticated', 'public.staff_profiles', 'SELECT') IS NOT TRUE
     OR pg_catalog.has_table_privilege('authenticated', 'public.staff_profiles', 'INSERT')
     OR pg_catalog.has_table_privilege('authenticated', 'public.staff_profiles', 'UPDATE')
     OR pg_catalog.has_table_privilege('authenticated', 'public.staff_profiles', 'DELETE')
     OR pg_catalog.has_table_privilege('authenticated', 'public.staff_profiles', 'TRUNCATE')
     OR pg_catalog.has_table_privilege('authenticated', 'public.staff_profiles', 'REFERENCES')
     OR pg_catalog.has_table_privilege('authenticated', 'public.staff_profiles', 'TRIGGER')
     OR pg_catalog.has_table_privilege('authenticated', 'public.staff_profiles', 'MAINTAIN') THEN
    RAISE EXCEPTION 'Unexpected effective application privilege remains on public.staff_profiles.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_class AS c
    JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
    CROSS JOIN LATERAL pg_catalog.aclexplode(
      COALESCE(c.relacl, pg_catalog.acldefault('r', c.relowner))
    ) AS acl
    WHERE n.nspname = 'public'
      AND c.relname IN ('books', 'staff_profiles')
      AND (
        acl.grantee = 0
        OR (c.relname = 'books' AND acl.grantee = 'anon'::regrole::oid
            AND acl.privilege_type <> 'SELECT')
        OR (c.relname = 'books' AND acl.grantee = 'authenticated'::regrole::oid
            AND acl.privilege_type NOT IN ('SELECT', 'INSERT', 'DELETE'))
        OR (c.relname = 'staff_profiles' AND acl.grantee = 'anon'::regrole::oid)
        OR (c.relname = 'staff_profiles' AND acl.grantee = 'authenticated'::regrole::oid
            AND acl.privilege_type <> 'SELECT')
      )
  ) THEN
    RAISE EXCEPTION 'Unexpected direct PUBLIC/anon/authenticated table ACL remains.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_class AS c
    JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
    JOIN pg_catalog.pg_attribute AS a ON a.attrelid = c.oid
    CROSS JOIN LATERAL pg_catalog.aclexplode(a.attacl) AS acl
    WHERE n.nspname = 'public'
      AND c.relname IN ('books', 'staff_profiles')
      AND a.attnum > 0
      AND NOT a.attisdropped
      AND (
        acl.grantee = 0
        OR acl.grantee = 'anon'::regrole::oid
        OR (acl.grantee = 'authenticated'::regrole::oid AND NOT (
          c.relname = 'books'
          AND a.attname IN ('total_copies', 'available_copies', 'call_number')
          AND acl.privilege_type = 'UPDATE'
        ))
      )
  ) THEN
    RAISE EXCEPTION 'Unexpected direct PUBLIC/anon/authenticated column ACL remains.';
  END IF;

  -- Table-level REVOKEs do not remove column-level or inherited grants.
  -- Verify effective column privileges across every current column.
  FOR v_column IN
    SELECT relation.relname AS table_name, attribute.attname AS column_name
    FROM pg_catalog.pg_class AS relation
    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
    JOIN pg_catalog.pg_attribute AS attribute ON attribute.attrelid = relation.oid
    WHERE namespace.nspname = 'public'
      AND relation.relname IN ('books', 'staff_profiles')
      AND attribute.attnum > 0
      AND NOT attribute.attisdropped
  LOOP
    IF v_column.table_name = 'books' THEN
      v_expected_update := v_column.column_name IN ('total_copies', 'available_copies', 'call_number');
      IF pg_catalog.has_column_privilege('anon', 'public.books', v_column.column_name, 'INSERT')
         OR pg_catalog.has_column_privilege('anon', 'public.books', v_column.column_name, 'UPDATE')
         OR pg_catalog.has_column_privilege('anon', 'public.books', v_column.column_name, 'REFERENCES')
         OR pg_catalog.has_column_privilege('authenticated', 'public.books', v_column.column_name, 'UPDATE')
              IS DISTINCT FROM v_expected_update
         OR pg_catalog.has_column_privilege('authenticated', 'public.books', v_column.column_name, 'REFERENCES') THEN
        RAISE EXCEPTION 'Unexpected effective column privilege on public.books.%;', v_column.column_name;
      END IF;
    ELSE
      IF pg_catalog.has_column_privilege('anon', 'public.staff_profiles', v_column.column_name, 'INSERT')
         OR pg_catalog.has_column_privilege('anon', 'public.staff_profiles', v_column.column_name, 'UPDATE')
         OR pg_catalog.has_column_privilege('anon', 'public.staff_profiles', v_column.column_name, 'REFERENCES')
         OR pg_catalog.has_column_privilege('authenticated', 'public.staff_profiles', v_column.column_name, 'INSERT')
         OR pg_catalog.has_column_privilege('authenticated', 'public.staff_profiles', v_column.column_name, 'UPDATE')
         OR pg_catalog.has_column_privilege('authenticated', 'public.staff_profiles', v_column.column_name, 'REFERENCES') THEN
        RAISE EXCEPTION 'Unexpected effective column privilege on public.staff_profiles.%;', v_column.column_name;
      END IF;
    END IF;
  END LOOP;
END;
$postflight$;

NOTIFY pgrst, 'reload schema';