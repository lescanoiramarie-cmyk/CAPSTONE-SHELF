-- ============================================================================
-- STOP AUTH EMAIL CONFIRMATION FROM VERIFYING VISITORS
--
-- Reproduction of the registration failure:
--
--   1. signUp returns HTTP 200 with a session, and email_confirmed_at is
--      already populated. Email confirmation is not enforced.
--   2. link_visitor_auth_user() reads email_confirmed_at and sets
--      otp_verified = is_confirmed, allocating a QR code.
--   3. The visitor is therefore already verified before any code is entered.
--   4. send-visitor-otp then refuses: "This visitor is already verified."
--      -> HTTP 400 -> "Edge Function returned a non-2xx status code"
--   5. Registration rolled back the visitor, so the visitor is stuck in a
--      loop where signing up always fails and the account never survives.
--
-- Two independent verification systems were racing. This removes the
-- Supabase Auth email-confirmation path as a verification signal. A visitor
-- is now verified only by entering the code from send-visitor-otp.
--
-- To restore Supabase's own confirmation emails, set "Confirm email" ON in
-- Authentication > Providers > Email, and re-apply this migration.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. TRIGGER: NEVER DERIVE VERIFICATION FROM email_confirmed_at
-- ---------------------------------------------------------------------------

create or replace function public.link_visitor_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  visitor_id_value text;
begin
  if coalesce(new.raw_user_meta_data ->> 'role', '') <> 'visitor' then
    return new;
  end if;

  -- email_confirmed_at is intentionally ignored. Only the OTP flow in
  -- verify_visitor_otp() may set otp_verified, so a new account always
  -- starts unverified regardless of Auth email confirmation settings.

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
$$;
revoke all on function public.link_visitor_auth_user() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. RESET ROWS THAT THE AUTH TRIGGER VERIFIED WITHOUT A CODE
--
-- Only rows that have no QR pass are touched. A visitor who genuinely
-- completed the OTP flow is already verified and holds a QR code, so they
-- are left alone. Rows that never completed verification are cleared back to
-- unverified so the OTP flow can run for them again.
-- ---------------------------------------------------------------------------

update public.visitors
set otp_verified = false,
    qr_code = null
where otp_verified = true
  and qr_code is null
  and auth_user_id is not null;

-- ---------------------------------------------------------------------------
-- 3. AUDIT THE CORRECTION
--
-- visitor.account.disabled does not describe this, so the reset is recorded
-- through a dedicated action.
-- ---------------------------------------------------------------------------

insert into public.audit_logs(actor_id, action, branch_id, details)
select
  null,
  'visitor.registration.verification_revoked',
  null,
  jsonb_build_object(
    'reason', 'supabase_auth_email_confirmation_removed_as_verification_signal'
  )
where exists (
  select 1
  from public.visitors
  where otp_verified = false
    and qr_code is null
    and auth_user_id is not null
);

-- ---------------------------------------------------------------------------
-- 4. DO NOT SILENTLY REACTIVATE A PROFILE DISABLED BY STAFF
--
-- The previous trigger set is_active = true whenever the email confirmed,
-- which undid an administrator's deactivation. Verification no longer touches
-- is_active at all.
-- ---------------------------------------------------------------------------

notify pgrst, 'reload schema';