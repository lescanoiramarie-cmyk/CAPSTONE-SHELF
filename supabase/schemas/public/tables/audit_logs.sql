CREATE TABLE "public"."audit_logs" (
  "id"         uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "actor_id"   uuid,
  "action"     text                     NOT NULL,
  "branch_id"  text,
  "details"    jsonb                    NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "audit_logs_actor_id_fkey" FOREIGN KEY (actor_id) REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT "audit_logs_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."audit_logs"
  ENABLE ROW LEVEL SECURITY;

CREATE INDEX audit_logs_branch_created_idx ON public.audit_logs USING btree (branch_id, created_at DESC);

CREATE INDEX audit_logs_created_idx ON public.audit_logs USING btree (created_at DESC);

CREATE POLICY "staff read branch audit log" ON "public"."audit_logs"
  FOR SELECT
  TO "authenticated"
  USING (public.is_active_staff_for_branch(NULL::text));

CREATE POLICY "staff write branch audit log" ON "public"."audit_logs"
  FOR INSERT
  TO "authenticated"
  WITH CHECK (((actor_id = auth.uid()) AND public.is_active_staff_for_branch(branch_id)));

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."audit_logs" TO "postgres", "service_role";

REVOKE ALL ON TABLE "public"."audit_logs" FROM "authenticated";

GRANT INSERT, SELECT ON TABLE "public"."audit_logs" TO "authenticated";
