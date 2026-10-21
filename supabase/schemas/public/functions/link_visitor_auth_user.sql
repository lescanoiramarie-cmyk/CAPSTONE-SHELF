CREATE OR REPLACE FUNCTION public.link_visitor_auth_user()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'auth'
  AS $function$
declare
  visitor_id_value text;
begin
  if coalesce(new.raw_user_meta_data ->> 'role', '') <> 'visitor' then
    return new;
  end if;

  select id::text into visitor_id_value
  from public.visitors
  where lower(email) = lower(new.email)
  limit 1;

  if visitor_id_value is null then
    insert into public.visitors (
      full_name,
      contact_number,
      email,
      address,
      otp_verified,
      qr_code,
      auth_user_id,
      is_active
    ) values (
      coalesce(new.raw_user_meta_data ->> 'full_name', 'Visitor'),
      new.raw_user_meta_data ->> 'contact_number',
      lower(new.email),
      new.raw_user_meta_data ->> 'address',
      false,
      null,
      new.id,
      true
    );
  else
    update public.visitors
    set auth_user_id = new.id,
        full_name = coalesce(nullif(new.raw_user_meta_data ->> 'full_name', ''), full_name),
        contact_number = coalesce(new.raw_user_meta_data ->> 'contact_number', contact_number),
        address = coalesce(nullif(new.raw_user_meta_data ->> 'address', ''), address)
    where id::text = visitor_id_value;
  end if;

  return new;
end;
$function$;

GRANT EXECUTE ON FUNCTION "public"."link_visitor_auth_user"() TO "postgres", "service_role";

REVOKE ALL ON FUNCTION "public"."link_visitor_auth_user"() FROM PUBLIC;
