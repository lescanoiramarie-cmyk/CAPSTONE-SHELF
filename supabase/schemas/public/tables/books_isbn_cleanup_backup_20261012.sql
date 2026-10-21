CREATE TABLE "public"."books_isbn_cleanup_backup_20261012" (
  "id"                  text,
  "title"               character varying(255),
  "author"              character varying(255),
  "category"            character varying(100),
  "isbn"                character varying(50),
  "shelf_location"      character varying(50),
  "library_id"          uuid,
  "total_copies"        integer,
  "available_copies"    integer,
  "summary"             text,
  "cover_url"           text,
  "created_at"          timestamp with time zone,
  "book_type"           character varying(20),
  "owner_visitor_id"    text,
  "lending_enabled"     boolean,
  "condition"           character varying(20),
  "lending_period_days" integer,
  "handover_location"   text,
  "handover_method"     character varying(30),
  "handover_details"    text,
  "updated_at"          timestamp with time zone,
  "is_public"           boolean
);

ALTER TABLE "public"."books_isbn_cleanup_backup_20261012"
  ENABLE ROW LEVEL SECURITY;

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
  ON TABLE "public"."books_isbn_cleanup_backup_20261012"
  TO "anon", "authenticated", "postgres", "service_role";
