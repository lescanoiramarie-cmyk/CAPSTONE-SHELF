CREATE TABLE "public"."libraries" (
  "id"                 uuid                             NOT NULL DEFAULT gen_random_uuid(),
  "name"               character varying(255)           NOT NULL,
  "campus"             character varying(255)           NOT NULL,
  "address"            text,
  "lat"                numeric(10,8),
  "lng"                numeric(11,8),
  "hours"              character varying(100),
  "status"             character varying(50)            DEFAULT 'open'::character varying,
  "is_sample_location" boolean                          DEFAULT false,
  "location"           extensions.geography(Point,4326),
  "email_domain"       character varying(255),
  CONSTRAINT "libraries_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."libraries"
  ENABLE ROW LEVEL SECURITY;

CREATE POLICY "libraries are publicly readable" ON "public"."libraries"
  FOR SELECT
  TO "anon", "authenticated"
  USING (true);

CREATE POLICY "staff manage libraries" ON "public"."libraries"
  FOR ALL
  TO "authenticated"
  USING (public.is_active_staff_for_branch((id)::text))
  WITH CHECK (public.is_active_staff_for_branch((id)::text));

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."libraries" TO "anon", "authenticated", "postgres", "service_role";
