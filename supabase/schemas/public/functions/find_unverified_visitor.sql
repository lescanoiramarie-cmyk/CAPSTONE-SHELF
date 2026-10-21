CREATE OR REPLACE FUNCTION public.find_unverified_visitor (
  p_email text
)
  RETURNS TABLE (
    visitor_id text
  )
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
begin
  return query
    select visitor.id::text
    from public.visitors as visitor
    where lower(visitor.email) = lower(trim(p_email))
      and not coalesce(visitor.otp_verified, false)
      and coalesce(visitor.is_active, true)
    limit 1;
end;
$function$;

GRANT EXECUTE ON FUNCTION "public"."find_unverified_visitor"(text) TO "anon", "authenticated", "postgres", "service_role";

REVOKE ALL ON FUNCTION "public"."find_unverified_visitor"(text) FROM PUBLIC;
