-- Allow unauthenticated landing-page visitors to send general feedback to
-- Super Admin without granting them access to read or modify feedback rows.
REVOKE ALL ON TABLE public.visitor_feedback FROM anon, PUBLIC;
GRANT INSERT (
  visitor_id,
  library_id,
  visitor_name,
  visitor_email,
  category,
  subject,
  message
) ON TABLE public.visitor_feedback TO anon;

DROP POLICY IF EXISTS "public submit feedback"
  ON public.visitor_feedback;
DROP POLICY IF EXISTS "anonymous landing feedback submit"
  ON public.visitor_feedback;
CREATE POLICY "anonymous landing feedback submit"
  ON public.visitor_feedback
  FOR INSERT
  TO anon
  WITH CHECK (
    visitor_id IS NULL
    AND library_id IS NULL
    AND category = 'General'
    AND status = 'new'
    AND admin_reply IS NULL
    AND replied_by IS NULL
    AND replied_at IS NULL
    AND char_length(trim(visitor_name)) BETWEEN 1 AND 120
    AND visitor_email IS NOT NULL
    AND char_length(trim(visitor_email)) BETWEEN 3 AND 254
    AND char_length(trim(subject)) BETWEEN 1 AND 160
    AND char_length(trim(message)) BETWEEN 1 AND 5000
  );
