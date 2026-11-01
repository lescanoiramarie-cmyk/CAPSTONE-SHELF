CREATE INDEX IF NOT EXISTS borrow_requests_visitor_request_date_idx
  ON public.borrow_requests (visitor_id, request_date DESC);
