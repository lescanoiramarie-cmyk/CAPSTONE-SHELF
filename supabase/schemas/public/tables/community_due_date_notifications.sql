CREATE TABLE "public"."community_due_date_notifications" (
  "id"                   uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "community_request_id" text                     NOT NULL,
  "visitor_id"           text                     NOT NULL,
  "notification_type"    text                     NOT NULL,
  "notification_date"    date                     NOT NULL,
  "sent_at"              timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "community_due_date_notificati_community_request_id_notifica_key" UNIQUE (community_request_id, notification_type, notification_date),
  CONSTRAINT "community_due_date_notifications_notification_type_check" CHECK ((notification_type = ANY (ARRAY['due_soon'::text, 'due_today'::text, 'overdue'::text]))),
  CONSTRAINT "community_due_date_notifications_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."community_due_date_notifications"
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."community_due_date_notifications"
  ADD CONSTRAINT "community_due_date_notifications_visitor_id_fkey" FOREIGN KEY (visitor_id) REFERENCES public.visitors(id) ON DELETE CASCADE NOT VALID;

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
  ON TABLE "public"."community_due_date_notifications"
  TO "anon", "authenticated", "postgres", "service_role";
