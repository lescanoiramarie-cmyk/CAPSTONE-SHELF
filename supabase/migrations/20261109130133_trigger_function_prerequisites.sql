BEGIN;

-- These trigger functions are referenced by the following grant-hardening
-- migration but their canonical definitions are checked in later. Install
-- the exact canonical bodies here for clean forward replay. The later
-- migrations remain unchanged and may safely CREATE OR REPLACE them.
DO $trigger_function_prerequisites$
DECLARE
  v_owner_oid oid := 'postgres'::regrole::oid;
  v_language_oid oid;
  v_trigger_oid oid := 'trigger'::regtype::oid;
  v_proc record;
  v_name text;
  v_expected_source text;
  v_create_sql text;
BEGIN
  IF current_user <> 'postgres' THEN
    RAISE EXCEPTION
      'Trigger function prerequisites require current_user=postgres; found %',
      current_user;
  END IF;

  SELECT l.oid INTO v_language_oid
  FROM pg_catalog.pg_language AS l
  WHERE l.lanname = 'plpgsql';
  IF v_language_oid IS NULL THEN
    RAISE EXCEPTION 'Required language plpgsql does not exist';
  END IF;

  FOR v_name, v_expected_source, v_create_sql IN
    SELECT * FROM (VALUES
      (
        'set_borrow_request_library_id',
        $set_expected$
DECLARE
  v_book_library_id uuid;
BEGIN
  SELECT b.library_id INTO v_book_library_id
  FROM public.books b
  WHERE b.id::text = NEW.book_id::text;

  NEW.library_id := COALESCE(v_book_library_id, NEW.library_id);
  RETURN NEW;
END;
$set_expected$,
        $set_create$CREATE FUNCTION public.set_borrow_request_library_id()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $set_body$
DECLARE
  v_book_library_id uuid;
BEGIN
  SELECT b.library_id INTO v_book_library_id
  FROM public.books b
  WHERE b.id::text = NEW.book_id::text;

  NEW.library_id := COALESCE(v_book_library_id, NEW.library_id);
  RETURN NEW;
END;
$set_body$$set_create$
      ),
      (
        'maintain_book_rating_aggregates',
        $rating_expected$
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') AND OLD.rating BETWEEN 1 AND 5 THEN
    UPDATE public.book_rating_aggregates
    SET rating_sum = rating_sum - OLD.rating,
        rating_count = rating_count - 1
    WHERE book_id = OLD.book_id;

    DELETE FROM public.book_rating_aggregates
    WHERE book_id = OLD.book_id AND rating_count <= 0;
  END IF;

  IF TG_OP IN ('INSERT', 'UPDATE') AND NEW.rating BETWEEN 1 AND 5 THEN
    INSERT INTO public.book_rating_aggregates (book_id, rating_sum, rating_count)
    VALUES (NEW.book_id, NEW.rating, 1)
    ON CONFLICT (book_id) DO UPDATE
    SET rating_sum = book_rating_aggregates.rating_sum + EXCLUDED.rating_sum,
        rating_count = book_rating_aggregates.rating_count + 1;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$rating_expected$,
        $rating_create$CREATE FUNCTION public.maintain_book_rating_aggregates()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $rating_body$
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') AND OLD.rating BETWEEN 1 AND 5 THEN
    UPDATE public.book_rating_aggregates
    SET rating_sum = rating_sum - OLD.rating,
        rating_count = rating_count - 1
    WHERE book_id = OLD.book_id;

    DELETE FROM public.book_rating_aggregates
    WHERE book_id = OLD.book_id AND rating_count <= 0;
  END IF;

  IF TG_OP IN ('INSERT', 'UPDATE') AND NEW.rating BETWEEN 1 AND 5 THEN
    INSERT INTO public.book_rating_aggregates (book_id, rating_sum, rating_count)
    VALUES (NEW.book_id, NEW.rating, 1)
    ON CONFLICT (book_id) DO UPDATE
    SET rating_sum = book_rating_aggregates.rating_sum + EXCLUDED.rating_sum,
        rating_count = book_rating_aggregates.rating_count + 1;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$rating_body$$rating_create$
      )
    ) AS definitions(function_name, expected_source, create_sql)
  LOOP
    IF EXISTS (
      SELECT 1
      FROM pg_catalog.pg_proc AS p
      JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = v_name
        AND p.pronargs <> 0
    ) THEN
      RAISE EXCEPTION
        'Unexpected overloaded signature exists for public.%()', v_name;
    END IF;

    SELECT p.* INTO v_proc
    FROM pg_catalog.pg_proc AS p
    JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = v_name
      AND p.pronargs = 0;

    IF NOT FOUND THEN
      EXECUTE v_create_sql;
      SELECT p.* INTO v_proc
      FROM pg_catalog.pg_proc AS p
      JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = v_name
        AND p.pronargs = 0;
    END IF;

    IF v_proc.proowner <> v_owner_oid
       OR v_proc.prolang <> v_language_oid
       OR v_proc.prorettype <> v_trigger_oid
       OR v_proc.provolatile <> 'v'
       OR NOT v_proc.prosecdef
       OR v_proc.proconfig IS DISTINCT FROM
            ARRAY['search_path=public, pg_temp']::text[]
       OR v_proc.prosrc IS DISTINCT FROM v_expected_source THEN
      RAISE EXCEPTION
        'Existing public.%() does not match its later canonical definition',
        v_name;
    END IF;
  END LOOP;
END
$trigger_function_prerequisites$;

-- Match the following historical hardening migration's intended ACL state
-- immediately, including for functions created in this prerequisite.
REVOKE ALL ON FUNCTION public.set_borrow_request_library_id()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.maintain_book_rating_aggregates()
  FROM PUBLIC, anon, authenticated;

DO $trigger_function_acl_validation$
DECLARE
  v_proc record;
  v_name text;
BEGIN
  FOREACH v_name IN ARRAY ARRAY[
    'set_borrow_request_library_id', 'maintain_book_rating_aggregates'
  ] LOOP
    SELECT p.oid, p.proowner, p.proacl
      INTO v_proc
    FROM pg_catalog.pg_proc AS p
    JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = v_name AND p.pronargs = 0;

    IF v_proc.oid IS NULL OR v_proc.proowner <> 'postgres'::regrole::oid THEN
      RAISE EXCEPTION 'public.%() has an unexpected owner or is missing', v_name;
    END IF;

    IF EXISTS (
      SELECT 1
      FROM pg_catalog.aclexplode(
        COALESCE(v_proc.proacl, pg_catalog.acldefault('f', v_proc.proowner))
      ) AS acl
      WHERE acl.grantee NOT IN (
          v_proc.proowner, 'service_role'::regrole::oid
        )
         OR acl.privilege_type <> 'EXECUTE'
         OR acl.is_grantable
    ) OR NOT has_function_privilege('postgres', v_proc.oid, 'EXECUTE')
      OR has_function_privilege('anon', v_proc.oid, 'EXECUTE')
      OR has_function_privilege('authenticated', v_proc.oid, 'EXECUTE') THEN
      RAISE EXCEPTION
        'public.%() has an unexpected direct or inherited EXECUTE privilege',
        v_name;
    END IF;
  END LOOP;
END
$trigger_function_acl_validation$;

COMMIT;