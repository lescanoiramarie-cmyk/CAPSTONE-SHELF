CREATE TABLE "public"."visitors" (
  "id"                text                     NOT NULL DEFAULT ('VIS-'::text || substr(replace((gen_random_uuid())::text, '-'::text, ''::text), 1, 8)),
  "full_name"         character varying(255)   NOT NULL,
  "contact_number"    character varying(50),
  "email"             character varying(255)   NOT NULL,
  "address"           text,
  "otp"               character varying(10),
  "otp_verified"      boolean                  DEFAULT false,
  "qr_code"           character varying(100),
  "registered_at"     timestamp with time zone DEFAULT now(),
  "otp_expires_at"    timestamp with time zone,
  "auth_user_id"      uuid,
  "is_active"         boolean                  NOT NULL DEFAULT true,
  "otp_attempts"      integer                  NOT NULL DEFAULT 0,
  "otp_last_sent_at"  timestamp with time zone,
  "terms_accepted_at" timestamp with time zone,
  CONSTRAINT "visitors_auth_user_id_fkey" FOREIGN KEY (auth_user_id) REFERENCES auth.users(id) ON DELETE CASCADE,
  CONSTRAINT "visitors_auth_user_id_key" UNIQUE (auth_user_id),
  CONSTRAINT "visitors_email_key" UNIQUE (email),
  CONSTRAINT "visitors_pkey" PRIMARY KEY (id),
  CONSTRAINT "visitors_qr_code_key" UNIQUE (qr_code),
  CONSTRAINT "visitors_qr_code_shelf_format" CHECK (((qr_code IS NULL) OR ((qr_code)::text ~ '^SHELF-QR-[0-9A-F]{32}$'::text)))
);

ALTER TABLE "public"."visitors"
  ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER audit_visitor_active
  AFTER UPDATE OF is_active ON public.visitors
  FOR EACH ROW
  WHEN ((COALESCE(old.is_active, true) IS DISTINCT FROM COALESCE(new.is_active, true)))
  EXECUTE FUNCTION public.capture_shelf_audit_event();

CREATE TRIGGER audit_visitor_registration_delete
  AFTER DELETE ON public.visitors
  FOR EACH ROW
  EXECUTE FUNCTION public.capture_shelf_audit_event();

CREATE TRIGGER audit_visitor_registration_insert
  AFTER INSERT ON public.visitors
  FOR EACH ROW
  EXECUTE FUNCTION public.capture_shelf_audit_event();

CREATE TRIGGER audit_visitor_verification
  AFTER UPDATE OF otp_verified ON public.visitors
  FOR EACH ROW
  WHEN ((COALESCE(old.otp_verified, false) IS DISTINCT FROM COALESCE(new.otp_verified, false)))
  EXECUTE FUNCTION public.capture_shelf_audit_event();

CREATE POLICY "staff manage visitors" ON "public"."visitors"
  FOR ALL
  TO "authenticated"
  USING (public.is_active_staff_for_branch(NULL::text))
  WITH CHECK (public.is_active_staff_for_branch(NULL::text));

CREATE POLICY "visitor and staff read scoped visitor profiles" ON "public"."visitors"
  FOR SELECT
  TO "authenticated"
  USING (((auth_user_id = auth.uid()) OR public.is_active_staff_for_branch(NULL::text)));

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."visitors" TO "postgres", "service_role";

REVOKE ALL ON TABLE "public"."visitors" FROM "authenticated";

GRANT SELECT ON TABLE "public"."visitors" TO "authenticated";
