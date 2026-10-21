CREATE OR REPLACE FUNCTION public.record_login_failure (
  p_email text
)
  RETURNS TABLE (
    attempts     integer,
    is_locked    boolean,
    locked_until timestamp with time zone
  )
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
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
                                                                                                                                                                                                                                       $function$;

GRANT EXECUTE ON FUNCTION "public"."record_login_failure"(text) TO "postgres", "service_role";

REVOKE ALL ON FUNCTION "public"."record_login_failure"(text) FROM PUBLIC;
