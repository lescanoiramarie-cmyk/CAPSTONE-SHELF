CREATE TABLE "public"."staff_profiles" (
  "id"         uuid                     NOT NULL,
  "email"      text                     NOT NULL,
  "full_name"  text                     NOT NULL,
  "role"       text                     NOT NULL,
  "library_id" uuid,
  "is_active"  boolean                  NOT NULL DEFAULT true,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "staff_profiles_check" CHECK ((((role = 'superadmin'::text) AND (library_id IS NULL)) OR (role = 'subadmin'::text))),
  CONSTRAINT "staff_profiles_email_key" UNIQUE (email),
  CONSTRAINT "staff_profiles_id_fkey" FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE,
  CONSTRAINT "staff_profiles_library_id_fkey" FOREIGN KEY (library_id) REFERENCES public.libraries(id) ON DELETE SET NULL,
  CONSTRAINT "staff_profiles_pkey" PRIMARY KEY (id),
  CONSTRAINT "staff_profiles_role_check" CHECK ((role = ANY (ARRAY['superadmin'::text, 'subadmin'::text])))
);

ALTER TABLE "public"."staff_profiles"
  ENABLE ROW LEVEL SECURITY;

CREATE POLICY "staff manage by superadmin" ON "public"."staff_profiles"
  FOR ALL
  TO "authenticated"
  USING (public.is_active_staff_for_branch(NULL::text))
  WITH CHECK (public.is_active_staff_for_branch(NULL::text));

CREATE POLICY "staff read own or superadmin" ON "public"."staff_profiles"
  FOR SELECT
  TO "authenticated"
  USING (((id = auth.uid()) OR public.is_active_staff_for_branch(NULL::text)));

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."staff_profiles" TO "anon", "authenticated", "postgres", "service_role";
