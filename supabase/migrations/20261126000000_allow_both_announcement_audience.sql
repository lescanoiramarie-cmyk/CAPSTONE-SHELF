ALTER TABLE public.announcements
  DROP CONSTRAINT IF EXISTS announcements_audience_check;

ALTER TABLE public.announcements
  ADD CONSTRAINT announcements_audience_check
  CHECK (audience IN ('general', 'visitor', 'both'));
