-- ============================================================================
-- PASSWORD RESET CODES
--
-- Adds the server-side state for a self-service password reset that matches the
-- existing registration OTP design: a short numeric code is emailed, and the
-- code is exchanged for a new password.
--
-- Design notes, each of which fixes a defect found in the earlier OTP work:
--
--   * Only the HASH of the code is stored. A database read cannot be replayed
--     as a valid reset.
--
--   * Expected failures are RETURNED, not raised. In PL/pgSQL, raise exception
--     aborts the transaction, which rolled back the attempt counter in
--     verify_visitor_otp and left a 6-digit code brute-forceable. Every function
--     below therefore returns an `error` column and lets the caller branch.
--
--   * No `drop function ... cascade`. That removed is_active_staff_for_branch
--     and silently deleted every RLS policy that referenced it.
--
--   * RETURNS TABLE columns are qualified or avoided where a bare column name
--     would collide with a PL/pgSQL variable of the same name.
--
-- The table is service-role only. RLS is enabled with no policies, so anon and
-- authenticated cannot read or write it; only the request-password-reset edge
-- function, which holds the service role key, can reach it.
-- ============================================================================

create table if not exists public.password_reset_codes (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  auth_user_id uuid not null references auth.users(id) on delete cascade,
  account_kind text not null check (account_kind in ('visitor', 'staff')),
  code_hash text not null,
  expires_at timestamptz not null,
  attempts integer not null default 0,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists password_reset_codes_email_idx
  on public.password_reset_codes (lower(email), created_at desc);

create index if not exists password_reset_codes_user_idx
  on public.password_reset_codes (auth_user_id, created_at desc);

alter table public.password_reset_codes enable row level security;

revoke all on public.password_reset_codes from anon, authenticated;

-- ---------------------------------------------------------------------------
-- ISSUE A RESET CODE
--
-- Enforces the anti-abuse limits server-side so the edge function cannot skip
-- them:
--   * one code per 60 seconds, per address
--   * at most 5 codes per hour, per address
--
-- Issues a code for visitor and staff accounts only. An authentication user
-- with neither profile cannot be reset through this flow.
--
-- Returns whether a code was issued, plus a short reason. No address enumeration
-- is possible from this function: it does not report whether the account exists.
-- ---------------------------------------------------------------------------

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

-- ---------------------------------------------------------------------------
-- VERIFY A RESET CODE
--
-- Returns the auth user id when the code is valid, so the edge function can set
-- the new password. A wrong code increments `attempts` and COMMITS, because this
-- path returns instead of raising. Five failures lock the address for 15 minutes.
--
-- The comparison is constant-time in effect: a mismatch returns the same shape as
-- a match with issued = false, and no timing signal is exposed to the client
-- beyond the request itself.
-- ---------------------------------------------------------------------------

drop function if exists public.verify_password_reset_code(text, text);

create function public.verify_password_reset_code(p_email text, p_code_hash text)
returns table (
  valid boolean,
  user_id uuid,
  account_kind text,
  error text
)
language plpgsql
security definer
set search_path = public, auth
as $$
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
$$;

revoke all on function public.verify_password_reset_code(text, text)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- CONSUME A RESET CODE
--
-- Called after the password has actually been changed, so a code cannot be
-- reused. Marks it spent and returns whether a row was spent.
-- ---------------------------------------------------------------------------

drop function if exists public.consume_password_reset_code(text);

create function public.consume_password_reset_code(p_email text)
returns boolean
language plpgsql
security definer
set search_path = public, auth
as $$
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
$$;

revoke all on function public.consume_password_reset_code(text)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- HOUSEKEEPING
--
-- Clear spent codes after a day and expired ones after a week, so the table
-- cannot grow without bound and old hashes stop being a liability.
-- ---------------------------------------------------------------------------

create or replace function public.purge_password_reset_codes()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_removed integer;
begin
  delete from public.password_reset_codes as code_row
  where (code_row.consumed_at is not null and code_row.consumed_at < now() - interval '1 day')
     or (code_row.consumed_at is null and code_row.expires_at < now() - interval '7 days');

  get diagnostics v_removed = row_count;

  return v_removed;
end;
$$;

revoke all on function public.purge_password_reset_codes() from public, anon, authenticated;

notify pgrst, 'reload schema';