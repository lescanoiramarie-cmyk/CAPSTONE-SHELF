CREATE TABLE "public"."staff_terms_acceptances" (
  "id"            uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "staff_user_id" uuid                     NOT NULL,
  "staff_name"    text                     NOT NULL,
  "staff_email"   text                     NOT NULL,
  "staff_role"    text                     NOT NULL,
  "library_id"    uuid,
  "terms_version" text                     NOT NULL,
  "accepted_at"   timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "staff_terms_acceptances_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "staff_terms_acceptances_user_version_key" UNIQUE ("staff_user_id", "terms_version"),
  CONSTRAINT "staff_terms_acceptances_role_check" CHECK ("staff_role" = 'subadmin'::text)
);

ALTER TABLE "public"."staff_terms_acceptances"
  ENABLE ROW LEVEL SECURITY;

CREATE INDEX staff_terms_acceptances_version_accepted_idx
  ON public.staff_terms_acceptances USING btree (terms_version, accepted_at DESC);

CREATE POLICY "staff terms acceptance read own or superadmin"
  ON public.staff_terms_acceptances
  FOR SELECT
  TO authenticated
  USING (
    staff_user_id = auth.uid()
    OR EXISTS (
      SELECT 1
      FROM public.staff_profiles admin
      WHERE admin.id = auth.uid()
        AND admin.role = 'superadmin'
        AND admin.is_active
    )
  );

REVOKE ALL ON TABLE public.staff_terms_acceptances FROM anon, PUBLIC;
REVOKE ALL ON TABLE public.staff_terms_acceptances FROM authenticated;
GRANT SELECT ON TABLE public.staff_terms_acceptances TO authenticated;
