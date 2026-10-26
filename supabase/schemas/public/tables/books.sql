CREATE TABLE "public"."books" (
  "id"                  text                     NOT NULL DEFAULT ('BK-'::text || substr(replace((gen_random_uuid())::text, '-'::text, ''::text), 1, 8)),
  "title"               character varying(255)   NOT NULL,
  "author"              character varying(255)   NOT NULL,
  "category"            character varying(100),
  "isbn"                character varying(50),
  "shelf_location"      character varying(50),
  "library_id"          uuid,
  "total_copies"        integer                  DEFAULT 1,
  "available_copies"    integer                  DEFAULT 1,
  "summary"             text,
  "cover_url"           text,
  "created_at"          timestamp with time zone DEFAULT now(),
  "book_type"           character varying(20)    NOT NULL DEFAULT 'library'::character varying,
  "owner_visitor_id"    text,
  "lending_enabled"     boolean                  NOT NULL DEFAULT false,
  "condition"           character varying(20),
  "lending_period_days" integer                  DEFAULT 7,
  "handover_location"   text,
  "handover_method"     character varying(30),
  "handover_details"    text,
  "updated_at"          timestamp with time zone NOT NULL DEFAULT now(),
  "is_public"           boolean                  NOT NULL DEFAULT false,
  CONSTRAINT "books_book_type_check" CHECK (((book_type)::text = ANY ((ARRAY['library'::character varying, 'personal'::character varying])::text[]))),
  CONSTRAINT "books_isbn_key" UNIQUE (isbn),
  CONSTRAINT "books_lending_period_check" CHECK (((lending_period_days IS NULL) OR (lending_period_days > 0))),
  CONSTRAINT "books_owner_type_check"
    CHECK (((((book_type)::text = 'library'::text) AND (owner_visitor_id IS NULL)) OR (((book_type)::text = 'personal'::text) AND (owner_visitor_id IS NOT NULL)))),
  CONSTRAINT "books_personal_condition_check"
    CHECK
    (((condition IS NULL) OR ((condition)::text = ANY ((ARRAY['New'::character varying, 'Like New'::character varying, 'Good'::character varying, 'Fair'::character varying,
    'Poor'::character varying])::text[])))),
  CONSTRAINT "books_pkey" PRIMARY KEY (id),
  CONSTRAINT "books_library_id_fkey" FOREIGN KEY (library_id) REFERENCES public.libraries(id) ON DELETE CASCADE
);

ALTER TABLE "public"."books"
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."books"
  ADD CONSTRAINT "books_owner_visitor_id_fkey" FOREIGN KEY (owner_visitor_id) REFERENCES public.visitors(id) ON DELETE CASCADE NOT VALID;

CREATE TRIGGER audit_inventory_insert_delete
  AFTER INSERT OR DELETE ON public.books
  FOR EACH ROW
  EXECUTE FUNCTION public.capture_shelf_audit_event();

CREATE TRIGGER audit_inventory_update
  AFTER UPDATE OF title, isbn, category, total_copies, shelf_location ON public.books
  FOR EACH ROW
  EXECUTE FUNCTION public.capture_shelf_audit_event();

CREATE TRIGGER enforce_book_copy_inventory
  BEFORE INSERT OR UPDATE OF total_copies, available_copies ON public.books
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_book_copy_inventory();

CREATE TRIGGER set_book_updated_at
  BEFORE UPDATE ON public.books
  FOR EACH ROW
  EXECUTE FUNCTION public.set_book_updated_at();

CREATE POLICY "books visible to catalog and owners" ON "public"."books"
  FOR SELECT
  TO "authenticated"
  USING ((((book_type)::text <> 'personal'::text) OR is_public OR (EXISTS ( SELECT 1
   FROM public.visitors visitor
  WHERE ((visitor.id = books.owner_visitor_id) AND (visitor.auth_user_id = auth.uid()))))));

CREATE POLICY "public catalog books readable" ON "public"."books"
  FOR SELECT
  TO "anon"
  USING ((((book_type)::text <> 'personal'::text) OR is_public));

CREATE POLICY "staff manage books" ON "public"."books"
  FOR ALL
  TO "authenticated"
  USING (public.is_active_staff_for_branch((library_id)::text))
  WITH CHECK (public.is_active_staff_for_branch((library_id)::text));

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."books" TO "postgres", "service_role";

REVOKE ALL ON TABLE "public"."books" FROM "anon";

GRANT MAINTAIN, SELECT ON TABLE "public"."books" TO "anon";

REVOKE ALL ON TABLE "public"."books" FROM "authenticated";

GRANT DELETE, INSERT, MAINTAIN, SELECT, UPDATE ON TABLE "public"."books" TO "authenticated";
