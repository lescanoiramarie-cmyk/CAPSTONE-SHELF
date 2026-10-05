-- ============================================================================
-- DROP STALE UUID OVERLOADS OF THE VISITOR RPCs
--
-- Error this fixes:
--
--   Could not choose the best candidate function between:
--     public.verify_visitor_otp(p_visitor_id => text, p_code => text),
--     public.verify_visitor_otp(p_visitor_id => uuid, p_code => text)
--
-- Why it happened:
--
-- 20261013000000 recreated these functions with `create or replace`, which
-- only replaces a signature that already matches. The historical uuid
-- overloads were never dropped, so both signatures remained registered for the
-- same call name. PostgREST then refuses to guess, and verification fails
-- before any code is compared.
--
-- 20261002000000 had revoked execute on these functions by name, which left the
-- uuid bodies in place. Revoking is not dropping.
--
-- This migration enumerates every overload of each affected name from
-- pg_proc and drops it, then recreates only the text signature. Enumerating by
-- name rather than by a hardcoded signature means this is correct regardless of
-- which historical signatures exist on a given database.
--
-- After this, each call resolves to exactly one candidate.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. DROP ALL OVERLOADS
-- ---------------------------------------------------------------------------

do $$
declare
  function_name text;
  function_signature text;
begin
  foreach function_name in array array[
    'verify_visitor_otp',
    'resend_otp',
    'get_visitor_borrow_requests',
    'fetch_my_community_book_requests',
    'fetch_owner_community_book_requests',
    'abort_visitor_registration',
    'find_unverified_visitor',
    'link_visitor_auth_user',
    'capture_shelf_audit_event',
    'generate_visitor_qr_code',
    'is_active_staff_for_branch',
    'get_visitor_feedback_replies',
    'find_visitor_by_qr'
  ]
  loop
    for function_signature in
      select procedure_row.oid::regprocedure::text
      from pg_proc as procedure_row
      join pg_namespace as procedure_schema
        on procedure_schema.oid = procedure_row.pronamespace
      where procedure_schema.nspname = 'public'
        and procedure_row.proname = function_name
    loop
      execute format(
        'drop function if exists %s cascade',
        function_signature
      );

      raise notice 'dropped overload: %', function_signature;
    end loop;
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. RECREATE THE OTP RPCs AT TEXT SIGNATURE ONLY
-- ---------------------------------------------------------------------------

create or replace function public.generate_visitor_qr_code()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  qr_value text;
begin
  perform pg_advisory_xact_lock(hashtext('public.visitors.qr_code'));
  loop
    qr_value := 'SHELF-QR-' || floor(random() * 900000 + 100000)::text;
    exit when not exists (
      select 1 from public.visitors where qr_code = qr_value
    );
  end loop;
  return qr_value;
end;
$$;
revoke all on function public.generate_visitor_qr_code() from public, anon, authenticated;

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
      jsonb_build_object('visitorId', v_visitor.id, 'attempts', v_attempts + 1)
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
  set otp = null, otp_expires_at = null, otp_attempts = 0
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
-- 3. RECREATE THE REQUEST READERS
-- ---------------------------------------------------------------------------

create or replace function public.get_visitor_borrow_requests(p_visitor_id text)
returns table (
  id text,
  book_id text,
  book_title text,
  visitor_id text,
  visitor_name text,
  status text,
  request_date timestamptz,
  pickup_deadline timestamptz,
  queue_position integer,
  borrow_date timestamptz,
  due_date timestamptz,
  return_date timestamptz,
  fine_amount numeric,
  confirmed_by text,
  return_confirmed_by text
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not exists (
    select 1
    from public.visitors as visitor
    where visitor.id = trim(p_visitor_id)
      and visitor.auth_user_id = auth.uid()
  ) then
    raise exception 'The authenticated visitor account could not be verified.';
  end if;

  return query
    select
      request.id::text,
      request.book_id::text,
      request.book_title::text,
      request.visitor_id::text,
      request.visitor_name::text,
      request.status::text,
      request.request_date,
      request.pickup_deadline,
      request.queue_position,
      request.borrow_date,
      request.due_date,
      request.return_date,
      request.fine_amount::numeric,
      request.confirmed_by::text,
      request.return_confirmed_by::text
    from public.borrow_requests as request
    where request.visitor_id = trim(p_visitor_id)
    order by request.request_date desc;
end;
$$;
revoke all on function public.get_visitor_borrow_requests(text) from public, anon;
grant execute on function public.get_visitor_borrow_requests(text) to authenticated;

create or replace function public.fetch_my_community_book_requests(p_requester_visitor_id text)
returns table (
  id uuid,
  book_id text,
  book_title text,
  owner_visitor_id text,
  owner_name text,
  requester_visitor_id text,
  requester_name text,
  status text,
  request_date timestamptz,
  approved_at timestamptz,
  rejected_at timestamptz,
  owner_response text,
  pickup_deadline timestamptz,
  borrow_date timestamptz,
  due_date timestamptz,
  return_date timestamptz,
  fine_amount numeric,
  confirmed_by text,
  return_confirmed_by text
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not exists (
    select 1
    from public.visitors as visitor
    where visitor.id = trim(p_requester_visitor_id)
      and visitor.auth_user_id = auth.uid()
      and visitor.otp_verified
      and visitor.is_active
  ) then
    raise exception 'The authenticated, verified visitor account could not be found.';
  end if;

  return query
    select
      request.id,
      request.book_id::text,
      request.book_title::text,
      request.owner_visitor_id::text,
      request.owner_name::text,
      request.requester_visitor_id::text,
      request.requester_name::text,
      request.status::text,
      request.request_date,
      request.approved_at,
      request.rejected_at,
      request.owner_response::text,
      request.pickup_deadline,
      request.borrow_date,
      request.due_date,
      request.return_date,
      request.fine_amount::numeric,
      request.confirmed_by::text,
      request.return_confirmed_by::text
    from public.community_book_requests as request
    where request.requester_visitor_id = trim(p_requester_visitor_id)
    order by request.request_date desc;
end;
$$;
revoke all on function public.fetch_my_community_book_requests(text) from public, anon;
grant execute on function public.fetch_my_community_book_requests(text) to authenticated;

create or replace function public.fetch_owner_community_book_requests(p_owner_visitor_id text)
returns table (
  id uuid,
  book_id text,
  book_title text,
  owner_visitor_id text,
  owner_name text,
  requester_visitor_id text,
  requester_name text,
  status text,
  request_date timestamptz,
  approved_at timestamptz,
  rejected_at timestamptz,
  owner_response text
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not exists (
    select 1
    from public.visitors as visitor
    where visitor.id = trim(p_owner_visitor_id)
      and visitor.auth_user_id = auth.uid()
      and visitor.otp_verified
      and visitor.is_active
  ) then
    raise exception 'The authenticated, verified visitor account could not be found.';
  end if;

  return query
    select
      request.id,
      request.book_id::text,
      request.book_title::text,
      request.owner_visitor_id::text,
      request.owner_name::text,
      request.requester_visitor_id::text,
      request.requester_name::text,
      request.status::text,
      request.request_date,
      request.approved_at,
      request.rejected_at,
      request.owner_response::text
    from public.community_book_requests as request
    where request.owner_visitor_id = trim(p_owner_visitor_id)
    order by
      case
        when request.status = 'pending' then 0
        when request.status = 'approved' then 1
        else 2
      end,
      request.request_date desc;
end;
$$;
revoke all on function public.fetch_owner_community_book_requests(text) from public, anon;
grant execute on function public.fetch_owner_community_book_requests(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. RECREATE THE AUTH LINK TRIGGER FUNCTION
--
-- Dropped with cascade above, so the auth.users triggers that depended on it
-- were removed with it and must be reattached.
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

drop trigger if exists on_auth_user_visitor_link_insert on auth.users;
create trigger on_auth_user_visitor_link_insert
  after insert on auth.users
  for each row execute function public.link_visitor_auth_user();

drop trigger if exists on_auth_user_visitor_confirm on auth.users;
create trigger on_auth_user_visitor_confirm
  after update of email_confirmed_at on auth.users
  for each row execute function public.link_visitor_auth_user();

-- ---------------------------------------------------------------------------
-- 5. RECREATE THE AUDIT CAPTURE FUNCTION
--
-- Also dropped with cascade, and the visitor audit triggers depend on it.
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

drop trigger if exists audit_borrow_request_insert_delete on public.borrow_requests;
create trigger audit_borrow_request_insert_delete
  after insert or delete on public.borrow_requests
  for each row execute function public.capture_shelf_audit_event();

drop trigger if exists audit_borrow_request_status on public.borrow_requests;
create trigger audit_borrow_request_status
  after update of status, fine_amount on public.borrow_requests
  for each row execute function public.capture_shelf_audit_event();

drop trigger if exists audit_attendance_insert on public.attendance_logs;
create trigger audit_attendance_insert
  after insert on public.attendance_logs
  for each row execute function public.capture_shelf_audit_event();

drop trigger if exists audit_attendance_checkout on public.attendance_logs;
create trigger audit_attendance_checkout
  after update of checked_out_at on public.attendance_logs
  for each row execute function public.capture_shelf_audit_event();

drop trigger if exists audit_inventory_insert_delete on public.books;
create trigger audit_inventory_insert_delete
  after insert or delete on public.books
  for each row execute function public.capture_shelf_audit_event();

drop trigger if exists audit_inventory_update on public.books;
create trigger audit_inventory_update
  after update of title, isbn, category, total_copies, shelf_location on public.books
  for each row execute function public.capture_shelf_audit_event();

drop trigger if exists audit_feedback_insert_delete on public.visitor_feedback;
create trigger audit_feedback_insert_delete
  after insert or delete on public.visitor_feedback
  for each row execute function public.capture_shelf_audit_event();

drop trigger if exists audit_feedback_update on public.visitor_feedback;
create trigger audit_feedback_update
  after update of status, admin_reply on public.visitor_feedback
  for each row execute function public.capture_shelf_audit_event();

drop trigger if exists audit_announcement_changes on public.announcements;
create trigger audit_announcement_changes
  after insert or update or delete on public.announcements
  for each row execute function public.capture_shelf_audit_event();

-- ---------------------------------------------------------------------------
-- 6. POSTGREST SCHEMA RELOAD
-- ---------------------------------------------------------------------------

notify pgrst, 'reload schema';