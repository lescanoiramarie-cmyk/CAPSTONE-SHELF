CREATE TABLE "public"."visitor_feedback" (
  "id"            uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "visitor_id"    text,
  "library_id"    uuid,
  "visitor_name"  text                     NOT NULL,
  "visitor_email" text,
  "category"      text                     NOT NULL DEFAULT 'General'::text,
  "subject"       text                     NOT NULL,
  "message"       text                     NOT NULL,
  "status"        text                     NOT NULL DEFAULT 'new'::text,
  "admin_reply"   text,
  "replied_by"    text,
  "replied_at"    timestamp with time zone,
  "created_at"    timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"    timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "visitor_feedback_library_id_fkey" FOREIGN KEY (library_id) REFERENCES public.libraries(id) ON DELETE SET NULL,
  CONSTRAINT "visitor_feedback_pkey" PRIMARY KEY (id),
  CONSTRAINT "visitor_feedback_status_check" CHECK ((status = ANY (ARRAY['new'::text, 'in_review'::text, 'answered'::text]))),
  CONSTRAINT "visitor_feedback_visitor_id_fkey" FOREIGN KEY (visitor_id) REFERENCES public.visitors(id) ON DELETE SET NULL
);

ALTER TABLE "public"."visitor_feedback"
  ENABLE ROW LEVEL SECURITY;

CREATE INDEX visitor_feedback_branch_created_idx ON public.visitor_feedback USING btree (library_id, created_at DESC);

CREATE TRIGGER audit_feedback_insert_delete
  AFTER INSERT OR DELETE ON public.visitor_feedback
  FOR EACH ROW
  EXECUTE FUNCTION public.capture_shelf_audit_event();

CREATE TRIGGER audit_feedback_update
  AFTER UPDATE OF status, admin_reply ON public.visitor_feedback
  FOR EACH ROW
  EXECUTE FUNCTION public.capture_shelf_audit_event();

CREATE POLICY "authenticated visitors submit feedback" ON "public"."visitor_feedback"
  FOR INSERT
  TO "authenticated"
  WITH CHECK ((EXISTS ( SELECT 1
   FROM public.visitors visitor
  WHERE ((visitor.id = visitor_feedback.visitor_id) AND (visitor.auth_user_id = auth.uid()) AND visitor.otp_verified AND visitor.is_active))));

CREATE POLICY "anonymous landing feedback submit" ON "public"."visitor_feedback"
  FOR INSERT
  TO "anon"
  WITH CHECK (
    visitor_id IS NULL
    AND library_id IS NULL
    AND category = 'General'
    AND status = 'new'
    AND admin_reply IS NULL
    AND replied_by IS NULL
    AND replied_at IS NULL
    AND char_length(trim(visitor_name)) BETWEEN 1 AND 120
    AND visitor_email IS NOT NULL
    AND char_length(trim(visitor_email)) BETWEEN 3 AND 254
    AND char_length(trim(subject)) BETWEEN 1 AND 160
    AND char_length(trim(message)) BETWEEN 1 AND 5000
  );

CREATE POLICY "visitors and branch staff read feedback" ON "public"."visitor_feedback"
  FOR SELECT
  TO "authenticated"
  USING (((EXISTS ( SELECT 1
   FROM public.visitors visitor
  WHERE ((visitor.id = visitor_feedback.visitor_id) AND (visitor.auth_user_id = auth.uid()) AND visitor.otp_verified AND visitor.is_active))) OR
    public.is_active_staff_for_branch((library_id)::text)));

REVOKE ALL ON TABLE "public"."visitor_feedback" FROM "anon", PUBLIC;
GRANT INSERT (
  "visitor_id",
  "library_id",
  "visitor_name",
  "visitor_email",
  "category",
  "subject",
  "message"
) ON TABLE "public"."visitor_feedback" TO "anon";
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."visitor_feedback" TO "authenticated", "postgres", "service_role";
