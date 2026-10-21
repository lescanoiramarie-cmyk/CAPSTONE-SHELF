CREATE OR REPLACE FUNCTION public.accept_visitor_terms()
  RETURNS timestamp WITH time zone
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
declare
  accepted_at timestamptz;
begin
  if auth.uid() is null then
    raise exception 'A signed-in visitor session is required.';
  end if;

  update public.visitors visitor
  set terms_accepted_at = coalesce(visitor.terms_accepted_at, now())
  where visitor.auth_user_id = auth.uid()
    and visitor.otp_verified
    and visitor.is_active
  returning visitor.terms_accepted_at into accepted_at;

  if not found then
    raise exception 'The active visitor account could not be found.';
  end if;

  return accepted_at;
end;
$function$;

GRANT EXECUTE ON FUNCTION "public"."accept_visitor_terms"() TO "authenticated", "postgres", "service_role";

REVOKE ALL ON FUNCTION "public"."accept_visitor_terms"() FROM PUBLIC;
