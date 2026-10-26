CREATE TABLE "public"."announcements" (
  "id"         uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "title"      text                     NOT NULL,
  "message"    text                     NOT NULL,
  "audience"   text                     NOT NULL DEFAULT 'visitor',
  "published"  boolean                  NOT NULL DEFAULT true,
  "expires_at" timestamp with time zone,
  "created_by" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  "library_id" uuid,
  CONSTRAINT "announcements_pkey" PRIMARY KEY (id),
  CONSTRAINT "announcements_audience_check" CHECK (audience IN ('general', 'visitor', 'both')),
  CONSTRAINT "announcements_library_id_fkey" FOREIGN KEY (library_id) REFERENCES public.libraries(id) ON DELETE SET NULL
);

ALTER TABLE "public"."announcements"
  ENABLE ROW LEVEL SECURITY;

CREATE INDEX announcements_published_created_idx ON public.announcements USING btree (published, created_at DESC);
CREATE INDEX announcements_published_expiration_created_idx ON public.announcements USING btree (published, expires_at, created_at DESC);
CREATE INDEX announcements_audience_published_expiration_idx ON public.announcements USING btree (audience, published, expires_at, created_at DESC);

CREATE TRIGGER audit_announcement_changes
  AFTER INSERT OR DELETE OR UPDATE ON public.announcements
  FOR EACH ROW
  EXECUTE FUNCTION public.capture_shelf_audit_event();

CREATE POLICY "published announcements are public" ON "public"."announcements"
  FOR SELECT
  TO "anon", "authenticated"
  USING ((published AND ((expires_at IS NULL) OR (expires_at > now()))));

CREATE POLICY "staff manage announcements" ON "public"."announcements"
  FOR ALL
  TO "authenticated"
  USING (((EXISTS ( SELECT 1
   FROM public.staff_profiles staff
  WHERE
    ((staff.id = auth.uid()) AND staff.is_active AND (staff.role = 'superadmin'::text) AND (COALESCE(((auth.jwt() -> 'app_metadata'::text) ->> 'role'::text), staff.role) =
    staff.role)))) OR public.is_active_staff_for_branch((library_id)::text)))
  WITH CHECK (((EXISTS ( SELECT 1
   FROM public.staff_profiles staff
  WHERE
    ((staff.id = auth.uid()) AND staff.is_active AND (staff.role = 'superadmin'::text) AND (COALESCE(((auth.jwt() -> 'app_metadata'::text) ->> 'role'::text), staff.role) =
    staff.role)))) OR public.is_active_staff_for_branch((library_id)::text)));

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."announcements" TO "anon", "authenticated", "postgres", "service_role";
