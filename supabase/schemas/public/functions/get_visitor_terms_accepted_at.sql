CREATE OR REPLACE FUNCTION public.get_visitor_terms_accepted_at()
  RETURNS timestamp WITH time zone
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
  AS $function$
declare
  accepted_at timestamptz;
begin
  if auth.uid() is null then
    raise exception 'A signed-in visitor session is required.';
  end if;

  select visitor.terms_accepted_at
    into accepted_at
  from public.visitors visitor
  where visitor.auth_user_id = auth.uid()
    and visitor.otp_verified
    and visitor.is_active
    and visitor.terms_version = '2026-11-04-v2';

  if not found then
    if not exists (
      select 1
      from public.visitors visitor
      where visitor.auth_user_id = auth.uid()
        and visitor.otp_verified
        and visitor.is_active
    ) then
      raise exception 'The active visitor account could not be found.';
    end if;
    return null;
  end if;

  return accepted_at;
end;
$function$;

GRANT EXECUTE ON FUNCTION "public"."get_visitor_terms_accepted_at"() TO "authenticated", "postgres", "service_role";

REVOKE ALL ON FUNCTION "public"."get_visitor_terms_accepted_at"() FROM PUBLIC, anon;
