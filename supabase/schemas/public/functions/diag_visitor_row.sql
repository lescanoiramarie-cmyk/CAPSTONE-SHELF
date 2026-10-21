CREATE OR REPLACE FUNCTION public.diag_visitor_row (
  p_email text
)
  RETURNS text
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
declare
  v_row record;
begin
  select row_entry.id, row_entry.auth_user_id, row_entry.otp_verified,
         row_entry.is_active, row_entry.email
    into v_row
  from public.visitors as row_entry
  where lower(row_entry.email) = lower(trim(p_email))
  limit 1;

  if v_row.id is null then
    return 'NO_VISITOR_ROW';
  end if;

  return format(
    'id=%s auth_user_id=%s otp_verified=%s is_active=%s email=%s',
    v_row.id, v_row.auth_user_id, v_row.otp_verified, v_row.is_active, v_row.email
  );
end;
$function$;

GRANT EXECUTE ON FUNCTION "public"."diag_visitor_row"(text) TO PUBLIC, "anon", "authenticated", "postgres", "service_role";
