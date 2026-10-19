
-- SHELF ILMS: Login lockout tracking
-- 5 failed password attempts; 15-minute lockout.

CREATE TABLE IF NOT EXISTS public.login_attempt_lockouts (
  normalized_email TEXT PRIMARY KEY,
  failed_attempts INTEGER NOT NULL DEFAULT 0
    CHECK (failed_attempts >= 0),
  locked_until TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.login_attempt_lockouts
  ENABLE ROW LEVEL SECURITY;

-- No direct client access. Server-side functions using the
-- service role will manage these records.
REVOKE ALL ON TABLE public.login_attempt_lockouts
  FROM PUBLIC, anon, authenticated;



-- Check whether an email is currently locked.
CREATE OR REPLACE FUNCTION public.check_login_lockout(
  p_email TEXT
)
RETURNS TABLE (
  is_locked BOOLEAN,
  retry_after_seconds INTEGER
)
LANGUAGE SQL
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    COALESCE(
      l.locked_until > pg_catalog.now(),
      FALSE
    ),
    CASE
      WHEN l.locked_until > pg_catalog.now()
      THEN GREATEST(
        0,
        CEIL(
          EXTRACT(
            EPOCH FROM (l.locked_until - pg_catalog.now())
          )
        )::INTEGER
      )
      ELSE 0
    END
  FROM (SELECT 1) AS seed
  LEFT JOIN public.login_attempt_lockouts AS l
    ON l.normalized_email =
       pg_catalog.lower(pg_catalog.btrim(p_email));
$$;

-- Record one failed password attempt.
CREATE OR REPLACE FUNCTION public.record_login_failure(
  p_email TEXT
)
RETURNS TABLE (
  attempts INTEGER,
  is_locked BOOLEAN,
  locked_until TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_attempts INTEGER;
  v_locked_until TIMESTAMPTZ;
BEGIN
  INSERT INTO public.login_attempt_lockouts AS current_lock (
    normalized_email,
    failed_attempts,
    locked_until,
    updated_at
  )
  VALUES (
    pg_catalog.lower(pg_catalog.btrim(p_email)),
    1,
    NULL,
    pg_catalog.now()
  )
  ON CONFLICT (normalized_email)
  DO UPDATE SET
    failed_attempts = CASE
      WHEN current_lock.locked_until IS NOT NULL
       AND current_lock.locked_until <= pg_catalog.now()
      THEN 1
      ELSE current_lock.failed_attempts + 1
    END,
    locked_until = CASE
      WHEN current_lock.locked_until IS NOT NULL
       AND current_lock.locked_until > pg_catalog.now()
      THEN current_lock.locked_until
      WHEN (
        CASE
          WHEN current_lock.locked_until IS NOT NULL
           AND current_lock.locked_until <= pg_catalog.now()
          THEN 1
          ELSE current_lock.failed_attempts + 1
        END
      ) >= 5
      THEN pg_catalog.now() + INTERVAL '15 minutes'
      ELSE NULL
    END,
    updated_at = pg_catalog.now()
  RETURNING
    current_lock.failed_attempts,
    current_lock.locked_until
  INTO v_attempts, v_locked_until;

  RETURN QUERY
  SELECT
    v_attempts,
    COALESCE(v_locked_until > pg_catalog.now(), FALSE),
    v_locked_until;
END;
$$;

-- Clear failed attempts after successful authentication.
CREATE OR REPLACE FUNCTION public.clear_login_failures(
  p_email TEXT
)
RETURNS VOID
LANGUAGE SQL
SECURITY DEFINER
SET search_path = ''
AS $$
  DELETE FROM public.login_attempt_lockouts
  WHERE normalized_email =
    pg_catalog.lower(pg_catalog.btrim(p_email));
$$;

-- Only the trusted server-side service role may call these.
REVOKE ALL ON FUNCTION public.check_login_lockout(TEXT)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_login_failure(TEXT)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.clear_login_failures(TEXT)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.check_login_lockout(TEXT)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.record_login_failure(TEXT)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.clear_login_failures(TEXT)
  TO service_role;
