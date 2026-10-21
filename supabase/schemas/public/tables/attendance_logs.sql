CREATE TABLE "public"."attendance_logs" (
  "id"             uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "visitor_id"     text,
  "visitor_name"   character varying(255),
  "library_id"     uuid,
  "time_in"        timestamp with time zone DEFAULT now(),
  "checked_out_at" timestamp with time zone,
  CONSTRAINT "attendance_logs_pkey" PRIMARY KEY (id),
  CONSTRAINT "attendance_logs_library_id_fkey" FOREIGN KEY (library_id) REFERENCES public.libraries(id) ON DELETE CASCADE,
  CONSTRAINT "attendance_logs_visitor_id_fkey" FOREIGN KEY (visitor_id) REFERENCES public.visitors(id) ON DELETE CASCADE
);

ALTER TABLE "public"."attendance_logs"
  ENABLE ROW LEVEL SECURITY;

CREATE INDEX attendance_logs_branch_time_idx ON public.attendance_logs USING btree (library_id, time_in DESC);

CREATE TRIGGER audit_attendance_checkout
  AFTER UPDATE OF checked_out_at ON public.attendance_logs
  FOR EACH ROW
  EXECUTE FUNCTION public.capture_shelf_audit_event();

CREATE TRIGGER audit_attendance_insert
  AFTER INSERT ON public.attendance_logs
  FOR EACH ROW
  EXECUTE FUNCTION public.capture_shelf_audit_event();

CREATE POLICY "visitors and staff read attendance" ON "public"."attendance_logs"
  FOR SELECT
  TO "authenticated"
  USING (((EXISTS ( SELECT 1
   FROM public.visitors visitor
  WHERE ((visitor.id = attendance_logs.visitor_id) AND (visitor.auth_user_id = auth.uid()) AND visitor.otp_verified AND visitor.is_active))) OR
    public.is_active_staff_for_branch((library_id)::text)));

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."attendance_logs" TO "postgres", "service_role";

REVOKE ALL ON TABLE "public"."attendance_logs" FROM "authenticated";

GRANT SELECT ON TABLE "public"."attendance_logs" TO "authenticated";
