CREATE TABLE "public"."borrowed_book_counts" (
  "book_id" text NOT NULL,
  "borrow_count" bigint NOT NULL,
  CONSTRAINT "borrowed_book_counts_borrow_count_check" CHECK ((borrow_count > 0)),
  CONSTRAINT "borrowed_book_counts_pkey" PRIMARY KEY (book_id)
);

CREATE INDEX borrowed_book_counts_popular_idx
  ON public.borrowed_book_counts USING btree (borrow_count DESC, book_id);

REVOKE ALL ON TABLE "public"."borrowed_book_counts"
  FROM PUBLIC, "anon", "authenticated", "service_role";
