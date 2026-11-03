CREATE INDEX IF NOT EXISTS borrow_requests_active_status_date_idx
  ON public.borrow_requests (status, request_date DESC, id ASC)
  WHERE status IN ('pending', 'queued', 'ready_for_pickup', 'borrowed');
