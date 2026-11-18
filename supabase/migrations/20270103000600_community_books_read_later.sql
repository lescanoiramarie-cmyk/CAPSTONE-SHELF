-- Community Books "Read Later" / Saved Books functionality
-- Allows authenticated visitors to save community books for later reference

CREATE TABLE IF NOT EXISTS public.visitor_saved_community_books (
  visitor_id text NOT NULL REFERENCES public.visitors(id) ON DELETE CASCADE,
  community_book_id uuid NOT NULL REFERENCES public.books(id) ON DELETE CASCADE,
  saved_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (visitor_id, community_book_id)
);

COMMENT ON TABLE public.visitor_saved_community_books IS
'Stores community books that visitors have saved for later reading. Each visitor can save a community book once.';

CREATE INDEX IF NOT EXISTS idx_visitor_saved_community_books_visitor
  ON public.visitor_saved_community_books (visitor_id);

CREATE INDEX IF NOT EXISTS idx_visitor_saved_community_books_book
  ON public.visitor_saved_community_books (community_book_id);

ALTER TABLE public.visitor_saved_community_books ENABLE ROW LEVEL SECURITY;

-- Owner can read their own saved books
CREATE POLICY "visitor reads own saved community books"
  ON public.visitor_saved_community_books
  FOR SELECT
  TO authenticated
  USING (visitor_id = auth.uid()::text OR visitor_id = (SELECT id FROM public.visitors WHERE auth_user_id = auth.uid()));

-- Owner can save a community book
CREATE POLICY "visitor saves community book"
  ON public.visitor_saved_community_books
  FOR INSERT
  TO authenticated
  WITH CHECK (visitor_id = auth.uid()::text OR visitor_id = (SELECT id FROM public.visitors WHERE auth_user_id = auth.uid()));

-- Owner can unsave a community book
CREATE POLICY "visitor unsaves community book"
  ON public.visitor_saved_community_books
  FOR DELETE
  TO authenticated
  USING (visitor_id = auth.uid()::text OR visitor_id = (SELECT id FROM public.visitors WHERE auth_user_id = auth.uid()));

-- Postflight assertions
DO $$
DECLARE
  v_table_exists boolean;
  v_pk_exists boolean;
  v_rls_enabled boolean;
  v_policy_count integer;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'visitor_saved_community_books'
  ) INTO v_table_exists;
  IF NOT v_table_exists THEN
    RAISE EXCEPTION 'Postflight failed: visitor_saved_community_books table not created';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_schema = 'public' AND table_name = 'visitor_saved_community_books'
      AND constraint_type = 'PRIMARY KEY'
  ) INTO v_pk_exists;
  IF NOT v_pk_exists THEN
    RAISE EXCEPTION 'Postflight failed: primary key not created on visitor_saved_community_books';
  END IF;

  SELECT relrowsecurity INTO v_rls_enabled
  FROM pg_class
  WHERE relname = 'visitor_saved_community_books' AND relnamespace = 'public'::regnamespace;
  IF NOT v_rls_enabled THEN
    RAISE EXCEPTION 'Postflight failed: RLS not enabled on visitor_saved_community_books';
  END IF;

  SELECT COUNT(*) INTO v_policy_count
  FROM pg_policies
  WHERE schemaname = 'public' AND tablename = 'visitor_saved_community_books';
  IF v_policy_count < 3 THEN
    RAISE EXCEPTION 'Postflight failed: expected at least 3 policies on visitor_saved_community_books, found %', v_policy_count;
  END IF;
END $$;