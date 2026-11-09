-- Trigger-only SECURITY DEFINER functions should not be exposed as RPCs.
REVOKE ALL ON FUNCTION public.set_borrow_request_library_id()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.maintain_book_rating_aggregates()
  FROM PUBLIC, anon, authenticated;

-- This helper remains executable for authenticated RLS policies and server
-- code, but anonymous clients do not need to probe staff/library membership.
REVOKE EXECUTE ON FUNCTION public.is_active_staff_for_branch(text)
  FROM anon;
