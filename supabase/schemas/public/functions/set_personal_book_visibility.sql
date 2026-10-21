CREATE OR REPLACE FUNCTION public.set_personal_book_visibility (
  p_visitor_id text,
  p_book_id    text,
  p_is_public  boolean
)
  RETURNS boolean
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
  AS $function$
begin
  if auth.uid() is null or not exists (
    select 1
    from public.visitors visitor
    where visitor.auth_user_id = auth.uid()
      and visitor.otp_verified
      and visitor.is_active
      and (
        visitor.id::text = trim(p_visitor_id)
        or visitor.auth_user_id::text = trim(p_visitor_id)
      )
  ) then
    raise exception 'The authenticated visitor account could not be verified.';
  end if;

  return shelf_private.set_personal_book_visibility_unchecked(
    p_visitor_id,
    p_book_id,
    p_is_public
  );
end;
$function$;

GRANT EXECUTE ON FUNCTION "public"."set_personal_book_visibility"(text, text, boolean) TO "authenticated", "postgres", "service_role";

REVOKE ALL ON FUNCTION "public"."set_personal_book_visibility"(text, text, boolean) FROM PUBLIC;
