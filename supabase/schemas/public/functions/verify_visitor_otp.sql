CREATE OR REPLACE FUNCTION public.verify_visitor_otp (
  p_visitor_id text,
  p_code       text
)
  RETURNS TABLE (
    id        text,
    full_name text,
    email     text,
    qr_code   text,
    error     text
  )
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
declare
  v_visitor public.visitors%rowtype;
  v_qr text;
  v_attempts integer;
  v_message text;
begin
  select visitor.*
  into v_visitor
  from public.visitors as visitor
  where visitor.id = trim(p_visitor_id);

  if v_visitor.id is null then
    raise exception 'Registration not found. Please register again.';
  end if;

  if coalesce(v_visitor.otp_verified, false) then
    return query
      select
        v_visitor.id::text,
        v_visitor.full_name::text,
        v_visitor.email::text,
        v_visitor.qr_code::text,
        null::text;
    return;
  end if;

  if v_visitor.otp is null then
    return query
      select
        null::text,
        null::text,
        null::text,
        null::text,
        'No verification code is pending. Please request a new code.'::text;
    return;
  end if;

  if v_visitor.otp_expires_at is not null
     and v_visitor.otp_expires_at <= now() then

    update public.visitors as visitor
    set
      otp = null,
      otp_expires_at = null,
      otp_attempts = 0
    where visitor.id = v_visitor.id;

    insert into public.audit_logs(
      actor_id,
      action,
      branch_id,
      details
    )
    values (
      auth.uid(),
      'visitor.otp.expired',
      null,
      jsonb_build_object(
        'visitorId', v_visitor.id
      )
    );

    return query
      select
        null::text,
        null::text,
        null::text,
        null::text,
        'This verification code has expired. Please request a new code.'::text;
    return;
  end if;

  v_attempts := coalesce(v_visitor.otp_attempts, 0);

  if v_attempts >= 5 then

    insert into public.audit_logs(
      actor_id,
      action,
      branch_id,
      details
    )
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
      select
        null::text,
        null::text,
        null::text,
        null::text,
        'Too many incorrect attempts. Please request a new code.'::text;
    return;
  end if;

  if v_visitor.otp <> trim(p_code) then

    update public.visitors as visitor
    set otp_attempts = v_attempts + 1
    where visitor.id = v_visitor.id;

    insert into public.audit_logs(
      actor_id,
      action,
      branch_id,
      details
    )
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

    if v_attempts + 1 >= 5 then
      v_message :=
        'Incorrect OTP code. Please try again. '
        || 'After one more incorrect attempt this code will be blocked.';
    end if;

    return query
      select
        null::text,
        null::text,
        null::text,
        null::text,
        v_message;
    return;
  end if;

  v_qr := coalesce(
    nullif(v_visitor.qr_code, ''),
    public.generate_visitor_qr_code()
  );

  update public.visitors as visitor
  set
    otp_verified = true,
    qr_code = v_qr,
    otp = null,
    otp_expires_at = null,
    otp_attempts = 0
  where visitor.id = v_visitor.id;

  insert into public.audit_logs(
    actor_id,
    action,
    branch_id,
    details
  )
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
    select
      v_visitor.id::text,
      v_visitor.full_name::text,
      v_visitor.email::text,
      v_qr::text,
      null::text;
end;
$function$;

GRANT EXECUTE ON FUNCTION "public"."verify_visitor_otp"(text, text) TO "anon", "authenticated", "postgres", "service_role";

REVOKE ALL ON FUNCTION "public"."verify_visitor_otp"(text, text) FROM PUBLIC;
