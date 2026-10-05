-- ============================================================================
-- FIX UNDEFINED VARIABLE IN issue_password_reset_code
--
-- The request-password-reset edge function failed every request with:
--
--   Unable to start the password reset. Please try again.
--
-- Cause, surfaced by a temporary diagnostic wrapper:
--
--   SQLSTATE 42703 :: column "v_expires_at" does not exist
--
-- The function body validated its own input with `v_expires_at`, but the
-- parameter is named `p_expires_at`. PL/pgSQL resolves an unknown identifier as
-- a column reference, and there is no such column, so every call raised 42703
-- before the insert. The insert itself already used `p_expires_at` correctly, so
-- only the guard was wrong.
--
-- Note the failure mode: this is exactly why the edge function swallowed the
-- message. The 500 text the user saw carried no cause, and the real error only
-- appeared once the RPC was invoked outside the function.
-- ============================================================================

drop function if exists public.issue_password_reset_code(text, text, text, timestamptz);

create function public.issue_password_reset_code(
  p_email text,
  p_code_hash text,
  p_account_kind text,
  p_expires_at timestamptz
)
returns table (
  issued boolean,
  reason text,
  user_id uuid
)
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_email text := lower(trim(p_email));
  v_hash text := trim(p_code_hash);
  v_kind text := lower(trim(p_account_kind));
  v_user_id uuid;
  v_kind_found text;
  v_recent_count integer;
  v_last_issued timestamptz;
begin
  if v_email = '' or v_hash = '' or p_expires_at is null then
    return query
      select false, 'invalid_request'::text, null::uuid;
    return;
  end if;

  if v_kind not in ('visitor', 'staff') then
    return query
      select false, 'invalid_request'::text, null::uuid;
    return;
  end if;

  -- Cooldown: refuse a second code within 60 seconds of the previous one.
  select max(code_row.created_at)
    into v_last_issued
  from public.password_reset_codes as code_row
  where lower(code_row.email) = v_email;

  if v_last_issued is not null
    and v_last_issued > now() - interval '60 seconds' then
    return query
      select false, 'cooldown'::text, null::uuid;
    return;
  end if;

  -- Hourly cap: refuse once five codes have been issued in the last hour.
  select count(*)::integer
    into v_recent_count
  from public.password_reset_codes as code_row
  where lower(code_row.email) = v_email
    and code_row.created_at > now() - interval '1 hour';

  if v_recent_count >= 5 then
    return query
      select false, 'rate_limited'::text, null::uuid;
    return;
  end if;

  -- Resolve the authentication account through a real profile so an orphaned
  -- auth user cannot be reset.
  if v_kind = 'visitor' then
    select visitor.auth_user_id, 'visitor'
      into v_user_id, v_kind_found
    from public.visitors as visitor
    where lower(visitor.email) = v_email
      and visitor.auth_user_id is not null
    order by visitor.registered_at desc nulls last
    limit 1;
  else
    select profile.id, 'staff'
      into v_user_id, v_kind_found
    from public.staff_profiles as profile
    where lower(profile.email) = v_email
    order by profile.created_at desc nulls last
    limit 1;
  end if;

  if v_user_id is null then
    return query
      select false, 'not_found'::text, null::uuid;
    return;
  end if;

  -- Retire any outstanding code so only the newest is ever valid.
  update public.password_reset_codes as code_row
  set consumed_at = now()
  where code_row.auth_user_id = v_user_id
    and code_row.consumed_at is null;

  insert into public.password_reset_codes (
    email,
    auth_user_id,
    account_kind,
    code_hash,
    expires_at
  )
  values (
    v_email,
    v_user_id,
    v_kind_found,
    v_hash,
    p_expires_at
  );

  return query
    select true, null::text, v_user_id;
end;
$$;

revoke all on function public.issue_password_reset_code(text, text, text, timestamptz)
  from public, anon, authenticated;

grant execute on function public.issue_password_reset_code(text, text, text, timestamptz)
  to service_role;

notify pgrst, 'reload schema';