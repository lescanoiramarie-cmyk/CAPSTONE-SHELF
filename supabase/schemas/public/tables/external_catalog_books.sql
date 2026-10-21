CREATE TABLE "public"."external_catalog_books" (
  "openlibrary_key" text                     NOT NULL,
  "title"           text                     NOT NULL,
  "author"          text,
  "category"        text,
  "isbn"            text,
  "summary"         text,
  "cover_url"       text,
  "source_url"      text,
  "last_synced_at"  timestamp with time zone NOT NULL DEFAULT now(),
  "created_at"      timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"      timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "external_catalog_books_pkey" PRIMARY KEY (openlibrary_key)
);

ALTER TABLE "public"."external_catalog_books"
  ENABLE ROW LEVEL SECURITY;

CREATE POLICY "External catalog readable by visitors" ON "public"."external_catalog_books"
  FOR SELECT
  TO "anon", "authenticated"
  USING (true);

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."external_catalog_books" TO "anon", "authenticated", "postgres", "service_role";
