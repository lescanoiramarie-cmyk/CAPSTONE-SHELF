CREATE TABLE "public"."due_date_notifications" (
  "id"                uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "borrow_request_id" uuid                     NOT NULL,
  "visitor_id"        text                     NOT NULL,
  "notification_type" text                     NOT NULL,
  "notification_date" date                     NOT NULL DEFAULT CURRENT_DATE,
  "sent_at"           timestamp with time zone NOT NULL DEFAULT now(),
  "created_at"        timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "due_date_notifications_borrow_request_id_fkey" FOREIGN KEY (borrow_request_id) REFERENCES public.borrow_requests(id) ON DELETE CASCADE,
  CONSTRAINT "due_date_notifications_pkey" PRIMARY KEY (id),
  CONSTRAINT "due_date_notifications_type_check" CHECK ((notification_type = ANY (ARRAY['due_soon'::text, 'due_today'::text, 'overdue'::text, 'follow_up'::text]))),
  CONSTRAINT "due_date_notifications_unique" UNIQUE (borrow_request_id, notification_type, notification_date),
  CONSTRAINT "due_date_notifications_visitor_id_fkey" FOREIGN KEY (visitor_id) REFERENCES public.visitors(id) ON DELETE CASCADE
);

ALTER TABLE "public"."due_date_notifications"
  ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_due_date_notifications_date ON public.due_date_notifications USING btree (notification_date);

CREATE INDEX idx_due_date_notifications_request ON public.due_date_notifications USING btree (borrow_request_id);

CREATE INDEX idx_due_date_notifications_visitor ON public.due_date_notifications USING btree (visitor_id);

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."due_date_notifications" TO "anon", "authenticated", "postgres", "service_role";
