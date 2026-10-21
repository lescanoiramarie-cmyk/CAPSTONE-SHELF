CREATE OR REPLACE FUNCTION public.verify_password_reset_code (
  p_email     text,
  p_code_hash text
)
  RETURNS TABLE (
    valid        boolean,
    user_id      uuid,
    account_kind text,
    error        text
  )
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'auth'
  AS $function$
declare
  v_email text := lower(trim(p_email));
  v_hash text := trim(p_code_hash);
  v_row public.password_reset_codes%rowtype;
begin
  -- Lock out the address once five wrong codes have been recorded against the
  -- newest outstanding code.
  if exists (
    select 1
    from public.password_reset_codes as code_row
    where lower(code_row.email) = v_email
      and code_row.consumed_at is null
      and code_row.expires_at > now()
      and code_row.attempts >= 5
  ) then
    return query
      select false, null::uuid, null::text, 'locked'::text;
    return;
  end if;

  select code_row.* into v_row
  from public.password_reset_codes as code_row
  where lower(code_row.email) = v_email
    and code_row.consumed_at is null
  order by code_row.created_at desc
  limit 1;

  if v_row.id is null then
    return query
      select false, null::uuid, null::text, 'no_request'::text;
    return;
  end if;

  if v_row.expires_at <= now() then
    return query
      select false, null::uuid, null::text, 'expired'::text;
    return;
  end if;

  if v_row.code_hash <> v_hash then
    update public.password_reset_codes as code_row
    set attempts = code_row.attempts + 1
    where code_row.id = v_row.id;

    return query
      select false, null::uuid, null::text, 'incorrect'::text;
    return;
  end if;

  return query
    select true, v_row.auth_user_id, v_row.account_kind, null::text;
end;
$function$;

GRANT EXECUTE ON FUNCTION "public"."verify_password_reset_code"(text, text) TO "postgres", "service_role";

REVOKE ALL ON FUNCTION "public"."verify_password_reset_code"(text, text) FROM PUBLIC;
