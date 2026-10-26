-- Match the live project and schema snapshot: community requests are visible
-- only through the participants-read policy for authenticated users.
ALTER TABLE public.community_book_requests ENABLE ROW LEVEL SECURITY;
