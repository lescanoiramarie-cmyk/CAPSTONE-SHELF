ALTER TABLE public.announcements
  ADD COLUMN IF NOT EXISTS audience text NOT NULL DEFAULT 'visitor'
    CHECK (audience IN ('general', 'visitor'));

CREATE INDEX IF NOT EXISTS announcements_audience_published_expiration_idx
  ON public.announcements (audience, published, expires_at, created_at DESC);
