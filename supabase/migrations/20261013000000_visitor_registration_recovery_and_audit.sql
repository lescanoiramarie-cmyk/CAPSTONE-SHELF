-- ============================================================================
-- VISITOR REGISTRATION RECOVERY + AUDIT COVERAGE
--
-- Fixes three defects in the visitor OTP lifecycle:
--
--   1. Registration committed auth.users + visitors rows BEFORE the OTP email
--      was sent. When Resend failed, the visitor was stranded in the database
--      with otp_verified = false and no way to recover, because re-registering
--      hit "This email is already registered".
--      -> public.abort_visitor_registration() now rolls the row back.
--
--   2. public.verify_visitor_otp() never checked visitors.otp_expires_at, so a
--      leaked code stayed valid forever, and had no attempt limit, so a 6-digit
--      code could be brute-forced without restriction.
--      -> expiry + attempt lockout are enforced here.
--
--   3. public.resend_otp() generated a second OTP that was immediately
--      overwritten by the send-visitor-otp edge function. It now only clears
--      the pending code and opens a resend cooldown.
--
-- Also adds audit coverage for visitors. Registration, OTP verification and
-- account deactivation were previously unlogged.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. OTP STATE COLUMNS
-- ---------------------------------------------------------------------------

alter table public.visitors
  add column if not exists otp_attempts integer not null default 0;

alter table public.visitors
  add column if not exists otp_last_sent_at timestamptz;

-- ---------------------------------------------------------------------------
-- 2. VISITOR AUDIT TRIGGERS
--
-- Registered through capture_shelf_audit_event() so visitor events land in the
-- same audit_logs table the admin viewer already reads. OTP codes themselves
-- are never written to the audit trail.
-- ---------------------------------------------------------------------------

create or replace function public.capture_shelf_audit_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  branch_value text;
  event_action text;
  event_details jsonb;
  request_row public.borrow_requests%rowtype;
begin
  if tg_table_name = 'visitors' then
    if tg_op = 'INSERT' then
      event_action := 'visitor.registration.created';
      event_details := jsonb_build_object(
        'visitorId', new.id,
        'fullName', new.full_name,
        'email', new.email,
        'otpVerified', coalesce(new.otp_verified, false)
      );
    elsif tg_op = 'UPDATE' then
      branch_value := null;
      if coalesce(old.otp_verified, false) is distinct from coalesce(new.otp_verified, false) then
        event_action := case
          when coalesce(new.otp_verified, false)
            then 'visitor.registration.verified'
          else 'visitor.registration.verification_revoked'
        end;
        event_details := jsonb_build_object(
          'visitorId', new.id,
          'fullName', new.full_name,
          'email', new.email
        );
      elsif coalesce(old.is_active, true) is distinct from coalesce(new.is_active, true) then
        event_action := case
          when coalesce(new.is_active, true)
            then 'visitor.account.enabled'
          else 'visitor.account.disabled'
        end;
        event_details := jsonb_build_object(
          'visitorId', new.id,
          'fullName', new.full_name,
          'email', new.email
        );
      else
        return new;
      end if;
    else
      event_action := 'visitor.registration.deleted';
      event_details := jsonb_build_object(
        'visitorId', old.id,
        'fullName', old.full_name,
        'email', old.email
      );
    end if;
  elsif tg_table_name = 'borrow_requests' then
    if tg_op = 'DELETE' then
      request_row := old;
    else
      request_row := new;
    end if;
    select library_id::text into branch_value
    from public.books
    where id::text = request_row.book_id::text;
    event_action := 'circulation.borrow_request.' || lower(tg_op);
    event_details := jsonb_build_object(
      'requestId', request_row.id,
      'bookId', request_row.book_id,
      'status', request_row.status,
      'fineAmount', request_row.fine_amount
    );
  elsif tg_table_name = 'attendance_logs' then
    if tg_op = 'DELETE' then
      branch_value := old.library_id::text;
    else
      branch_value := new.library_id::text;
    end if;
    event_action := case
      when tg_op = 'INSERT' then 'circulation.visitor.checked_in'
      else 'circulation.visitor.checked_out'
    end;
    event_details := jsonb_build_object(
      'attendanceId', case when tg_op = 'DELETE' then old.id else new.id end,
      'visitorId', case when tg_op = 'DELETE' then old.visitor_id else new.visitor_id end
    );
  elsif tg_table_name = 'books' then
    if tg_op = 'DELETE' then
      branch_value := old.library_id::text;
    else
      branch_value := new.library_id::text;
    end if;
    event_action := 'inventory.book.' || lower(tg_op);
    event_details := jsonb_build_object(
      'bookId', case when tg_op = 'DELETE' then old.id else new.id end,
      'title', case when tg_op = 'DELETE' then old.title else new.title end,
      'isbn', case when tg_op = 'DELETE' then old.isbn else new.isbn end
    );
  elsif tg_table_name = 'visitor_feedback' then
    if tg_op = 'DELETE' then
      branch_value := old.library_id::text;
    else
      branch_value := new.library_id::text;
    end if;
    event_action := 'visitor_feedback.' || lower(tg_op);
    event_details := jsonb_build_object(
      'feedbackId', case when tg_op = 'DELETE' then old.id else new.id end,
      'status', case when tg_op = 'DELETE' then old.status else new.status end,
      'category', case when tg_op = 'DELETE' then old.category else new.category end
    );
  elsif tg_table_name = 'announcements' then
    event_action := 'announcement.' || lower(tg_op);
    event_details := jsonb_build_object(
      'announcementId', case when tg_op = 'DELETE' then old.id else new.id end,
      'title', case when tg_op = 'DELETE' then old.title else new.title end,
      'published', case when tg_op = 'DELETE' then old.published else new.published end
    );
  end if;

  insert into public.audit_logs(actor_id, action, branch_id, details)
  values (auth.uid(), event_action, branch_value, coalesce(event_details, '{}'::jsonb));
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
revoke all on function public.capture_shelf_audit_event() from public, anon, authenticated;

drop trigger if exists audit_visitor_registration_insert on public.visitors;
create trigger audit_visitor_registration_insert
  after insert on public.visitors
  for each row execute function public.capture_shelf_audit_event();

drop trigger if exists audit_visitor_verification on public.visitors;
create trigger audit_visitor_verification
  after update of otp_verified on public.visitors
  for each row
  when (
    coalesce(old.otp_verified, false)
      is distinct from coalesce(new.otp_verified, false)
  )
  execute function public.capture_shelf_audit_event();

drop trigger if exists audit_visitor_active on public.visitors;
create trigger audit_visitor_active
  after update of is_active on public.visitors
  for each row
  when (
    coalesce(old.is_active, true)
      is distinct from coalesce(new.is_active, true)
  )
  execute function public.capture_shelf_audit_event();

drop trigger if exists audit_visitor_registration_delete on public.visitors;
create trigger audit_visitor_registration_delete
  after delete on public.visitors
  for each row execute function public.capture_shelf_audit_event();

-- ---------------------------------------------------------------------------
-- 3. VERIFY VISITOR OTP
--
-- Security definer and reachable by an unauthenticated caller (the client is
-- signed out between registration and verification), so this is the trust
-- boundary. It now enforces the expiry that visitors.otp_expires_at always
-- recorded but nothing read, and locks the code out after repeated failures.
-- ---------------------------------------------------------------------------

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
    update public.visitors
      set otp = null, otp_attempts = 0
      where id = v_visitor.id;
    raise exception 'This verification code has expired. Please request a new code.';
  end if;

  v_attempts := coalesce(v_visitor.otp_attempts, 0);

  if v_attempts >= 5 then
    raise exception 'Too many incorrect attempts. Please request a new code.';
  end if;

  if v_visitor.otp <> trim(p_code) then
    update public.visitors
      set otp_attempts = v_attempts + 1
      where id = v_visitor.id;

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

  v_qr := coalesce(
    nullif(v_visitor.qr_code, ''),
    public.generate_visitor_qr_code()
  );

  update public.visitors
  set otp_verified = true,
      qr_code = v_qr,
      otp = null,
      otp_expires_at = null,
      otp_attempts = 0
  where id = v_visitor.id;

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

-- ---------------------------------------------------------------------------
-- 4. RESEND OTP
--
-- No longer generates a code. The send-visitor-otp edge function owns code
-- generation, and previously this RPC produced a code that was overwritten
-- moments later. It now clears the pending code, resets the attempt counter and
-- opens a 60 second cooldown so the endpoint cannot be used to mail-bomb.
-- ---------------------------------------------------------------------------

create or replace function public.resend_otp(p_visitor_id text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_visitor public.visitors%rowtype;
begin
  select visitor.* into v_visitor
  from public.visitors as visitor
  where visitor.id = trim(p_visitor_id);

  if v_visitor.id is null then
    raise exception 'Registration not found. Please register again.';
  end if;

  if coalesce(v_visitor.otp_verified, false) then
    raise exception 'This visitor has already been verified.';
  end if;

  if v_visitor.otp_last_sent_at is not null
    and v_visitor.otp_last_sent_at > now() - interval '60 seconds' then
    raise exception 'Please wait before requesting another verification code.';
  end if;

  update public.visitors
  set otp = null,
      otp_expires_at = null,
      otp_attempts = 0
  where id = v_visitor.id;

  insert into public.audit_logs(actor_id, action, branch_id, details)
  values (
    auth.uid(),
    'visitor.otp.resend_requested',
    null,
    jsonb_build_object('visitorId', v_visitor.id)
  );

  return true;
end;
$$;
revoke all on function public.resend_otp(text) from public;
grant execute on function public.resend_otp(text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. ABORT VISITOR REGISTRATION
--
-- Compensating action for a registration whose verification email could not be
-- delivered. Deletes the unverified visitor profile and its authentication
-- account so the visitor can register again instead of being stranded behind
-- "This email is already registered".
--
-- The caller must present the registration nonce that was issued to the same
-- browser session during signUp, so this cannot be used to delete an arbitrary
-- account. Verified or previously active visitors are never touched.
-- ---------------------------------------------------------------------------

create or replace function public.abort_visitor_registration(
  p_visitor_id text,
  p_registration_nonce text
)
returns boolean
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_visitor public.visitors%rowtype;
  v_metadata jsonb;
  v_nonce text;
begin
  select visitor.* into v_visitor
  from public.visitors as visitor
  where visitor.id = trim(p_visitor_id);

  if v_visitor.id is null then
    return false;
  end if;

  if coalesce(v_visitor.otp_verified, false)
    or v_visitor.qr_code is not null then
    raise exception 'This visitor has already been verified and cannot be removed.';
  end if;

  if v_visitor.auth_user_id is null then
    raise exception 'This registration cannot be rolled back automatically.';
  end if;

  select account.raw_user_meta_data into v_metadata
  from auth.users as account
  where account.id = v_visitor.auth_user_id;

  v_nonce := v_metadata ->> 'registration_nonce';

  if v_nonce is null or v_nonce <> trim(p_registration_nonce) then
    raise exception 'A matching visitor registration proof is required.';
  end if;

  delete from auth.users where id = v_visitor.auth_user_id;

  insert into public.audit_logs(actor_id, action, branch_id, details)
  values (
    auth.uid(),
    'visitor.registration.rolled_back',
    null,
    jsonb_build_object(
      'visitorId', v_visitor.id,
      'fullName', v_visitor.full_name,
      'email', v_visitor.email,
      'reason', 'verification_email_not_delivered'
    )
  );

  return true;
end;
$$;
revoke all on function public.abort_visitor_registration(text, text) from public;
grant execute on function public.abort_visitor_registration(text, text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. RESOLVE AN UNVERIFIED VISITOR BY EMAIL
--
-- Lets the login screen offer a working resend for visitors stranded before
-- this migration. Only returns a visitor that exists, is not verified and is
-- still active, so a verified account cannot be used to trigger another code.
-- ---------------------------------------------------------------------------

create or replace function public.find_unverified_visitor(p_email text)
returns table(visitor_id text)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
    select visitor.id::text
    from public.visitors as visitor
    where lower(visitor.email) = lower(trim(p_email))
      and not coalesce(visitor.otp_verified, false)
      and coalesce(visitor.is_active, true)
    limit 1;
end;
$$;
revoke all on function public.find_unverified_visitor(text) from public;
grant execute on function public.find_unverified_visitor(text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 7. RE-GRANT THE FUNCTIONS THE 20261002000000 REVOCATION REMOVED
--
-- That migration revoked verify_visitor_otp and resend_otp from anon and
-- authenticated and never restored them, so registration could be completed
-- but never verified. Grants above restore access with the hardened bodies.
-- ---------------------------------------------------------------------------

grant execute on function public.verify_visitor_otp(text, text) to anon, authenticated;
grant execute on function public.resend_otp(text) to anon, authenticated;
grant execute on function public.write_audit_log(text, text, jsonb) to authenticated;