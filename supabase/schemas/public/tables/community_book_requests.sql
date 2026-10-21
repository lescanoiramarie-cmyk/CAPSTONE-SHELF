CREATE TABLE "public"."community_book_requests" (
  "id"                   uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "book_id"              text                     NOT NULL,
  "book_title"           text                     NOT NULL,
  "owner_visitor_id"     text                     NOT NULL,
  "owner_name"           text,
  "requester_visitor_id" text                     NOT NULL,
  "requester_name"       text,
  "status"               character varying(20)    NOT NULL DEFAULT 'pending'::character varying,
  "request_date"         timestamp with time zone NOT NULL DEFAULT now(),
  "approved_at"          timestamp with time zone,
  "rejected_at"          timestamp with time zone,
  "owner_response"       text,
  "created_at"           timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"           timestamp with time zone NOT NULL DEFAULT now(),
  "pickup_deadline"      timestamp with time zone,
  "borrow_date"          timestamp with time zone,
  "due_date"             timestamp with time zone,
  "return_date"          timestamp with time zone,
  "fine_amount"          numeric                  NOT NULL DEFAULT 0,
  "confirmed_by"         text,
  "return_confirmed_by"  text,
  "queue_position"       integer,
  CONSTRAINT "community_book_requests_book_fk" FOREIGN KEY (book_id) REFERENCES public.books(id) ON DELETE CASCADE,
  CONSTRAINT "community_book_requests_pkey" PRIMARY KEY (id),
  CONSTRAINT "community_book_requests_status_check"
    CHECK
    (((status)::text = ANY ((ARRAY['pending'::character varying, 'approved'::character varying, 'rejected'::character varying, 'cancelled'::character varying, 'borrowed'::character
    varying, 'returned'::character varying])::text[]))),
  CONSTRAINT "community_book_requests_owner_fk" FOREIGN KEY (owner_visitor_id) REFERENCES public.visitors(id) ON DELETE CASCADE,
  CONSTRAINT "community_book_requests_requester_fk" FOREIGN KEY (requester_visitor_id) REFERENCES public.visitors(id) ON DELETE CASCADE
);

ALTER TABLE "public"."community_book_requests"
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."community_book_requests"
  ADD CONSTRAINT "community_book_requests_book_id_fkey" FOREIGN KEY (book_id) REFERENCES public.books(id) ON DELETE CASCADE NOT VALID;

ALTER TABLE "public"."community_book_requests"
  ADD CONSTRAINT "community_book_requests_owner_visitor_id_fkey" FOREIGN KEY (owner_visitor_id) REFERENCES public.visitors(id) ON DELETE CASCADE NOT VALID;

ALTER TABLE "public"."community_book_requests"
  ADD CONSTRAINT "community_book_requests_requester_visitor_id_fkey" FOREIGN KEY (requester_visitor_id) REFERENCES public.visitors(id) ON DELETE CASCADE NOT VALID;

CREATE INDEX community_book_requests_book_status_idx ON public.community_book_requests USING btree (book_id, status);

CREATE INDEX community_book_requests_pending_queue_idx ON public.community_book_requests USING btree (book_id, request_date, id)
  WHERE ((status)::text = 'pending'::text);

CREATE INDEX idx_community_requests_book ON public.community_book_requests USING btree (book_id);

CREATE INDEX idx_community_requests_owner ON public.community_book_requests USING btree (owner_visitor_id);

CREATE INDEX idx_community_requests_requester ON public.community_book_requests USING btree (requester_visitor_id);

CREATE INDEX idx_community_requests_status ON public.community_book_requests USING btree (status);

CREATE TRIGGER community_book_copy_availability
  AFTER INSERT OR UPDATE ON public.community_book_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.update_community_book_copy_availability();

CREATE POLICY "community request participants read" ON "public"."community_book_requests"
  FOR SELECT
  TO "authenticated"
  USING (((EXISTS ( SELECT 1
   FROM public.visitors visitor
  WHERE ((visitor.id = community_book_requests.owner_visitor_id) AND (visitor.auth_user_id = auth.uid())))) OR (EXISTS ( SELECT 1
   FROM public.visitors visitor
  WHERE ((visitor.id = community_book_requests.requester_visitor_id) AND (visitor.auth_user_id = auth.uid())))) OR (EXISTS ( SELECT 1
   FROM public.books book
  WHERE ((book.id = community_book_requests.book_id) AND public.is_active_staff_for_branch((book.library_id)::text))))));

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."community_book_requests" TO "postgres", "service_role";

REVOKE ALL ON TABLE "public"."community_book_requests" FROM "authenticated";

GRANT SELECT ON TABLE "public"."community_book_requests" TO "authenticated";
