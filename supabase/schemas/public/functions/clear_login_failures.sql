CREATE OR REPLACE FUNCTION public.clear_login_failures (
  p_email text
)
  RETURNS void
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
  DELETE FROM public.login_attempt_lockouts
  WHERE normalized_email =
    pg_catalog.lower(pg_catalog.btrim(p_email));
$function$;

GRANT EXECUTE ON FUNCTION "public"."clear_login_failures"(text) TO "postgres", "service_role";

REVOKE ALL ON FUNCTION "public"."clear_login_failures"(text) FROM PUBLIC;
