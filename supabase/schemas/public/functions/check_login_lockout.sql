CREATE OR REPLACE FUNCTION public.check_login_lockout (
  p_email text
)
  RETURNS TABLE (
    is_locked           boolean,
    retry_after_seconds integer
  )
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
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
$function$;

GRANT EXECUTE ON FUNCTION "public"."check_login_lockout"(text) TO "postgres", "service_role";

REVOKE ALL ON FUNCTION "public"."check_login_lockout"(text) FROM PUBLIC;
