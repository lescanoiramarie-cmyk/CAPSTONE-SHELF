CREATE TABLE "public"."borrow_requests" (
  "id"                  uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "book_id"             text,
  "book_title"          character varying(255),
  "visitor_id"          text,
  "visitor_name"        character varying(255),
  "status"              character varying(50)    DEFAULT 'pending'::character varying,
  "request_date"        timestamp with time zone DEFAULT now(),
  "pickup_deadline"     timestamp with time zone,
  "queue_position"      integer                  DEFAULT 0,
  "borrow_date"         timestamp with time zone,
  "due_date"            timestamp with time zone,
  "return_date"         timestamp with time zone,
  "fine_amount"         numeric(10,2)            DEFAULT 0.00,
  "confirmed_by"        character varying(255),
  "return_confirmed_by" character varying(255),
  "cancel_reason"       text,
  CONSTRAINT "borrow_requests_book_id_fkey" FOREIGN KEY (book_id) REFERENCES public.books(id) ON DELETE CASCADE,
  CONSTRAINT "borrow_requests_pkey" PRIMARY KEY (id),
  CONSTRAINT "borrow_requests_visitor_id_fkey" FOREIGN KEY (visitor_id) REFERENCES public.visitors(id) ON DELETE CASCADE
);

ALTER TABLE "public"."borrow_requests"
  ENABLE ROW LEVEL SECURITY;

CREATE INDEX borrow_requests_book_status_idx ON public.borrow_requests USING btree (book_id, status);

CREATE INDEX borrow_requests_request_date_id_idx ON public.borrow_requests USING btree (request_date DESC, id);

CREATE TRIGGER audit_borrow_request_insert_delete
  AFTER INSERT OR DELETE ON public.borrow_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.capture_shelf_audit_event();

CREATE TRIGGER audit_borrow_request_status
  AFTER UPDATE OF status, fine_amount ON public.borrow_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.capture_shelf_audit_event();

CREATE POLICY "visitors and branch staff read requests" ON "public"."borrow_requests"
  FOR SELECT
  TO "authenticated"
  USING (((EXISTS ( SELECT 1
   FROM public.visitors visitor
  WHERE ((visitor.id = borrow_requests.visitor_id) AND (visitor.auth_user_id = auth.uid()) AND visitor.otp_verified AND visitor.is_active))) OR (EXISTS ( SELECT 1
   FROM public.books book
  WHERE ((book.id = borrow_requests.book_id) AND public.is_active_staff_for_branch((book.library_id)::text))))));

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."borrow_requests" TO "postgres", "service_role";

REVOKE ALL ON TABLE "public"."borrow_requests" FROM "authenticated";

GRANT SELECT ON TABLE "public"."borrow_requests" TO "authenticated";
