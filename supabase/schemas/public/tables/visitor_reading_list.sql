CREATE TABLE "public"."visitor_reading_list" (
  "id"         uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "visitor_id" text                     NOT NULL,
  "book_id"    text                     NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "visitor_reading_list_book_id_fkey" FOREIGN KEY (book_id) REFERENCES public.books(id) ON DELETE CASCADE,
  CONSTRAINT "visitor_reading_list_pkey" PRIMARY KEY (id),
  CONSTRAINT "visitor_reading_list_unique" UNIQUE (visitor_id, book_id),
  CONSTRAINT "visitor_reading_list_visitor_id_fkey" FOREIGN KEY (visitor_id) REFERENCES public.visitors(id) ON DELETE CASCADE
);

ALTER TABLE "public"."visitor_reading_list"
  ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Visitors can delete own reading list item" ON "public"."visitor_reading_list"
  FOR DELETE
  TO PUBLIC
  USING ((visitor_id IN ( SELECT visitors.id
   FROM public.visitors
  WHERE (visitors.auth_user_id = auth.uid()))));

CREATE POLICY "Visitors can insert own reading list item" ON "public"."visitor_reading_list"
  FOR INSERT
  TO PUBLIC
  WITH CHECK ((visitor_id IN ( SELECT visitors.id
   FROM public.visitors
  WHERE (visitors.auth_user_id = auth.uid()))));

CREATE POLICY "Visitors can manage own reading list" ON "public"."visitor_reading_list"
  FOR ALL
  TO PUBLIC
  USING ((visitor_id IN ( SELECT visitors.id
   FROM public.visitors
  WHERE (visitors.auth_user_id = auth.uid()))))
  WITH CHECK ((visitor_id IN ( SELECT visitors.id
   FROM public.visitors
  WHERE (visitors.auth_user_id = auth.uid()))));

CREATE POLICY "Visitors can view own reading list" ON "public"."visitor_reading_list"
  FOR SELECT
  TO PUBLIC
  USING ((visitor_id IN ( SELECT visitors.id
   FROM public.visitors
  WHERE (visitors.auth_user_id = auth.uid()))));

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."visitor_reading_list" TO "anon", "authenticated", "postgres", "service_role";
