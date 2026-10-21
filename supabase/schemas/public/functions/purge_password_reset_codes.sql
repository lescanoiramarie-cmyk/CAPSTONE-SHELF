CREATE OR REPLACE FUNCTION public.purge_password_reset_codes()
  RETURNS integer
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
declare
  v_removed integer;
begin
  delete from public.password_reset_codes as code_row
  where (code_row.consumed_at is not null and code_row.consumed_at < now() - interval '1 day')
     or (code_row.consumed_at is null and code_row.expires_at < now() - interval '7 days');

  get diagnostics v_removed = row_count;

  return v_removed;
end;
$function$;

GRANT EXECUTE ON FUNCTION "public"."purge_password_reset_codes"() TO "postgres", "service_role";

REVOKE ALL ON FUNCTION "public"."purge_password_reset_codes"() FROM PUBLIC;
