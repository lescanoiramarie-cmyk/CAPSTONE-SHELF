-- Keep staff transaction history ordered efficiently as the request table grows.
CREATE INDEX IF NOT EXISTS borrow_requests_request_date_id_idx
  ON public.borrow_requests (request_date DESC, id ASC);
