CREATE TABLE "public"."personal_books" (
  "id"             uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "title"          character varying        NOT NULL,
  "author"         character varying        NOT NULL,
  "isbn"           character varying,
  "privacy_status" character varying        DEFAULT 'private'::character varying,
  "listing_type"   character varying        DEFAULT 'none'::character varying,
  "price"          numeric(10,2)            DEFAULT 0.00,
  "description"    text,
  "created_at"     timestamp with time zone DEFAULT now(),
  CONSTRAINT "personal_books_listing_type_check"
    CHECK (((listing_type)::text = ANY ((ARRAY['none'::character varying, 'lend'::character varying, 'sell'::character varying])::text[]))),
  CONSTRAINT "personal_books_pkey" PRIMARY KEY (id),
  CONSTRAINT "personal_books_privacy_status_check" CHECK (((privacy_status)::text = ANY ((ARRAY['private'::character varying, 'public'::character varying])::text[]))),
  "owner_id"       uuid                     NOT NULL DEFAULT auth.uid()
);

ALTER TABLE "public"."personal_books"
  ENABLE ROW LEVEL SECURITY;

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."personal_books" TO "postgres", "service_role";

CREATE POLICY "owners and public listings read personal books" ON "public"."personal_books"
  FOR SELECT
  TO "authenticated"
  USING ((((privacy_status)::text = 'public'::text) OR (EXISTS ( SELECT 1
   FROM public.visitors visitor
  WHERE ((visitor.id = (personal_books.owner_id)::text) AND (visitor.auth_user_id = auth.uid()))))));

CREATE POLICY "visitors manage own personal books" ON "public"."personal_books"
  FOR ALL
  TO "authenticated"
  USING ((EXISTS ( SELECT 1
   FROM public.visitors visitor
  WHERE ((visitor.id = (personal_books.owner_id)::text) AND (visitor.auth_user_id = auth.uid()) AND visitor.otp_verified AND visitor.is_active))))
  WITH CHECK ((EXISTS ( SELECT 1
   FROM public.visitors visitor
  WHERE ((visitor.id = (personal_books.owner_id)::text) AND (visitor.auth_user_id = auth.uid()) AND visitor.otp_verified AND visitor.is_active))));

REVOKE ALL ON TABLE "public"."personal_books" FROM "authenticated";

GRANT DELETE, INSERT, SELECT, UPDATE ON TABLE "public"."personal_books" TO "authenticated";
