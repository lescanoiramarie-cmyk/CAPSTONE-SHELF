-- ============================================================================
-- MAKE OTP ATTEMPT LOCKOUT ACTUALLY PERSIST
--
-- Bug this fixes:
--
-- The lockout in verify_visitor_otp never engaged. Six consecutive wrong codes
-- all returned "Incorrect OTP code. Please try again." instead of locking out
-- on the sixth.
--
-- Why:
--
-- In PL/pgSQL, raise exception aborts the enclosing transaction. Every RPC call
-- runs in one transaction, so the earlier statements in the same function are
-- rolled back with it:
--
--   update public.visitors set otp_attempts = otp_attempts + 1 ...
--   raise exception 'Incorrect OTP code. Please try again.';   -- rolls the above back
--
-- The same applied to the expiry branch, which cleared otp and otp_expempts_at
-- and then raised, so an expired code was never actually cleared either.
--
-- A 6-digit code with no working attempt limit is brute-forceable.
--
-- The fix:
--
-- Expected verification outcomes are no longer raised. They are returned as a
-- result row with a null id and a populated error column, so the writes that
-- record the attempt commit normally. Only genuinely exceptional states (no such
-- registration) still raise, because there is nothing to persist for those.
--
-- The return type gains an `error` column. verify_visitor_otp previously had no
-- overloads to preserve, so the signature change is safe.
-- ============================================================================

drop function if exists public.verify_visitor_otp(uuid, text);
drop function if exists public.verify_visitor_otp(text, text);

create function public.verify_visitor_otp(p_visitor_id text, p_code text)
returns table (
  id text,
  full_name text,
  email text,
  qr_code text,
  error text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_visitor public.visitors%rowtype;
  v_qr text;
  v_attempts integer;
  v_message text;
begin
  select visitor.* into v_visitor
  from public.visitors as visitor
  where visitor.id = trim(p_visitor_id);

  -- No registration exists. Nothing to record, so this can still raise.
  if v_visitor.id is null then
    raise exception 'Registration not found. Please register again.';
  end if;

  -- Already verified. Return the profile so a repeat submission is idempotent
  -- rather than an error.
  if coalesce(v_visitor.otp_verified, false) then
    return query
      select v_visitor.id::text,
             v_visitor.full_name::text,
             v_visitor.email::text,
             v_visitor.qr_code::text,
             null::text;
    return;
  end if;

  -- No code pending. Reached after a resend clears it.
  if v_visitor.otp is null then
    return query
      select null::text, null::text, null::text, null::text,
             'No verification code is pending. Please request a new code.'::text;
    return;
  end if;

  -- Expired. Clear the code; this now commits because nothing is raised.
  if v_visitor.otp_expires_at is not null
    and v_visitor.otp_expires_at <= now() then
    update public.visitors as visitor
      set otp = null,
          otp_expires_at = null,
          otp_attempts = 0
      where visitor.id = v_visitor.id;

    insert into public.audit_logs(actor_id, action, branch_id, details)
    values (
      auth.uid(),
      'visitor.otp.expired',
      null,
      jsonb_build_object('visitorId', v_visitor.id)
    );

    return query
      select null::text, null::text, null::text, null::text,
             'This verification code has expired. Please request a new code.'::text;
    return;
  end if;

  v_attempts := coalesce(v_visitor.otp_attempts, 0);

  -- Locked out. The increment from the attempt that reached the limit has
  -- already been committed by this point.
  if v_attempts >= 5 then
    insert into public.audit_logs(actor_id, action, branch_id, details)
    values (
      auth.uid(),
      'visitor.otp.lockout',
      null,
      jsonb_build_object(
        'visitorId', v_visitor.id,
        'attempts', v_attempts
      )
    );

    return query
      select null::text, null::text, null::text, null::text,
             'Too many incorrect attempts. Please request a new code.'::text;
    return;
  end if;

  -- Incorrect code. This update and its audit row now commit.
  if v_visitor.otp <> trim(p_code) then
    update public.visitors as visitor
      set otp_attempts = v_attempts + 1
      where visitor.id = v_visitor.id;

    insert into public.audit_logs(actor_id, action, branch_id, details)
    values (
      auth.uid(),
      'visitor.otp.verification_failed',
      null,
      jsonb_build_object(
        'visitorId', v_visitor.id,
        'attempts', v_attempts + 1
      )
    );

    v_message := 'Incorrect OTP code. Please try again.';

    -- Warn when the visitor is about to be locked out, while still allowing
    -- this attempt's increment to stand.
    if v_attempts + 1 >= 5 then
      v_message := 'Incorrect OTP code. Please try again. '
        || 'After one more incorrect attempt this code will be blocked.';
    end if;

    return query
      select null::text, null::text, null::text, null::text, v_message;
    return;
  end if;

  -- Correct code.
  v_qr := coalesce(
    nullif(v_visitor.qr_code, ''),
    public.generate_visitor_qr_code()
  );

  update public.visitors as visitor
  set otp_verified = true,
      qr_code = v_qr,
      otp = null,
      otp_expires_at = null,
      otp_attempts = 0
  where visitor.id = v_visitor.id;

  insert into public.audit_logs(actor_id, action, branch_id, details)
  values (
    auth.uid(),
    'visitor.registration.verified',
    null,
    jsonb_build_object(
      'visitorId', v_visitor.id,
      'fullName', v_visitor.full_name,
      'email', v_visitor.email
    )
  );

  return query
    select v_visitor.id::text,
           v_visitor.full_name::text,
           v_visitor.email::text,
           v_qr::text,
           null::text;
end;
$$;

revoke all on function public.verify_visitor_otp(text, text) from public;
grant execute on function public.verify_visitor_otp(text, text) to anon, authenticated;

notify pgrst, 'reload schema';