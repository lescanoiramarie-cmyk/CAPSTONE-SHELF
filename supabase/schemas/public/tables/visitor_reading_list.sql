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

CREATE POLICY "Visitors can manage own reading list" ON "public"."visitor_reading_list"
  FOR ALL
  TO "authenticated"
  USING ((visitor_id IN ( SELECT visitor.id
   FROM public.visitors visitor
  WHERE (visitor.auth_user_id = ( SELECT auth.uid() AS uid)))))
  WITH CHECK ((visitor_id IN ( SELECT visitor.id
   FROM public.visitors visitor
  WHERE (visitor.auth_user_id = ( SELECT auth.uid() AS uid)))));

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."visitor_reading_list" TO "anon", "authenticated", "postgres", "service_role";
