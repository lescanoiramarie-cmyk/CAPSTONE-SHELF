CREATE OR REPLACE FUNCTION public.enforce_visitor_email_domain()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'auth'
  AS $function$
declare
  visitor_domain text;
begin
  if coalesce(new.raw_user_meta_data ->> 'role', '') <> 'visitor' then
    return new;
  end if;

  visitor_domain := lower(split_part(trim(new.email), '@', 2));

  if visitor_domain = 'gmail.com' then
    return new;
  end if;

  if not exists (
    select 1
    from public.libraries library
    where nullif(trim(both '@.' from lower(trim(library.email_domain))), '') is not null
      and (
        visitor_domain = trim(both '@.' from lower(trim(library.email_domain)))
        or right(
          visitor_domain,
          length(trim(both '@.' from lower(trim(library.email_domain)))) + 1
        ) = '.' || trim(both '@.' from lower(trim(library.email_domain)))
      )
  ) then
    raise exception 'Visitor registration is limited to Gmail and configured partner school email domains.';
  end if;

  return new;
end;
$function$;

GRANT EXECUTE ON FUNCTION "public"."enforce_visitor_email_domain"() TO "postgres", "service_role";

REVOKE ALL ON FUNCTION "public"."enforce_visitor_email_domain"() FROM PUBLIC;
