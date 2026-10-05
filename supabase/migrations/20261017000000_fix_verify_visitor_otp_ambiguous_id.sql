-- ============================================================================
-- FIX AMBIGUOUS COLUMN REFERENCE IN verify_visitor_otp
--
-- Error this fixes:
--
--   column reference "id" is ambiguous
--   It could refer to either a PL/pgSQL variable or a table column.
--
-- Why it happened:
--
-- `returns table(id text, ...)` declares PL/pgSQL output variables named id,
-- email, full_name and qr_code. Inside the body, `update public.visitors ...
-- where id = v_visitor.id` references a bare `id`, which the planner cannot
-- resolve: it may be the output variable or the table column.
--
-- The qualified form `visitor.id` is unambiguous, so the update targets are
-- aliased.
--
-- This also removes the remaining bare-column references in the same function.
-- The other RPCs are unaffected: their predicates are already qualified with a
-- table alias, and resend_otp returns boolean so it declares no output columns.
-- ============================================================================

create or replace function public.verify_visitor_otp(p_visitor_id text, p_code text)
returns table(id text, full_name text, email text, qr_code text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_visitor public.visitors%rowtype;
  v_qr text;
  v_attempts integer;
begin
  select visitor.* into v_visitor
  from public.visitors as visitor
  where visitor.id = trim(p_visitor_id);

  if v_visitor.id is null then
    raise exception 'Registration not found. Please register again.';
  end if;

  if coalesce(v_visitor.otp_verified, false) then
    return query
      select v_visitor.id::text, v_visitor.full_name::text,
             v_visitor.email::text, v_visitor.qr_code::text;
    return;
  end if;

  if v_visitor.otp is null then
    raise exception 'No verification code is pending. Please request a new code.';
  end if;

  if v_visitor.otp_expires_at is not null
    and v_visitor.otp_expires_at <= now() then
    update public.visitors as visitor
      set otp = null,
          otp_attempts = 0
      where visitor.id = v_visitor.id;

    raise exception 'This verification code has expired. Please request a new code.';
  end if;

  v_attempts := coalesce(v_visitor.otp_attempts, 0);

  if v_attempts >= 5 then
    raise exception 'Too many incorrect attempts. Please request a new code.';
  end if;

  -- -------------------------------------------------------------------------
  -- INCORRECT CODE
  -- -------------------------------------------------------------------------

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

    raise exception 'Incorrect OTP code. Please try again.';
  end if;

  -- -------------------------------------------------------------------------
  -- CORRECT CODE
  -- -------------------------------------------------------------------------

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
    select v_visitor.id::text, v_visitor.full_name::text,
           v_visitor.email::text, v_qr::text;
end;
$$;
revoke all on function public.verify_visitor_otp(text, text) from public;
grant execute on function public.verify_visitor_otp(text, text) to anon, authenticated;

notify pgrst, 'reload schema';