CREATE OR REPLACE FUNCTION public.consume_password_reset_code (
  p_email text
)
  RETURNS boolean
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'auth'
  AS $function$
declare
  v_email text := lower(trim(p_email));
  v_spent integer;
begin
  update public.password_reset_codes as code_row
  set consumed_at = now()
  where code_row.id in (
    select inner_row.id
    from public.password_reset_codes as inner_row
    where lower(inner_row.email) = v_email
      and inner_row.consumed_at is null
    order by inner_row.created_at desc
    limit 1
  );

  get diagnostics v_spent = row_count;

  return v_spent > 0;
end;
$function$;

GRANT EXECUTE ON FUNCTION "public"."consume_password_reset_code"(text) TO "postgres", "service_role";

REVOKE ALL ON FUNCTION "public"."consume_password_reset_code"(text) FROM PUBLIC;
