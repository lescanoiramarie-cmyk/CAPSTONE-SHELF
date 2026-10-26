CREATE TABLE "public"."book_rating_aggregates" (
  "book_id"      text                     NOT NULL,
  "rating_sum"   bigint                   NOT NULL DEFAULT 0,
  "rating_count" bigint                   NOT NULL DEFAULT 0,
  CONSTRAINT "book_rating_aggregates_pkey" PRIMARY KEY (book_id)
);

ALTER TABLE "public"."book_rating_aggregates"
  ENABLE ROW LEVEL SECURITY;
