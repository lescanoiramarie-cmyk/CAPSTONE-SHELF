CREATE OR REPLACE FUNCTION public.resend_otp (
  p_visitor_id text
)
  RETURNS boolean
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
declare
  v_visitor public.visitors%rowtype;
begin
  select visitor.*
  into v_visitor
  from public.visitors as visitor
  where visitor.id = trim(p_visitor_id);

  if v_visitor.id is null then
    raise exception 'Registration not found. Please register again.';
  end if;

  if coalesce(v_visitor.otp_verified, false) then
    raise exception 'This visitor has already been verified.';
  end if;

  if v_visitor.otp_last_sent_at is not null
    and v_visitor.otp_last_sent_at > now() - interval '60 seconds'
  then
    raise exception 'Please wait before requesting another verification code.';
  end if;

  update public.visitors
  set otp = null,
      otp_expires_at = null,
      otp_attempts = 0
  where id = v_visitor.id;

  insert into public.audit_logs(
    actor_id,
    action,
    branch_id,
    details
  )
  values (
    auth.uid(),
    'visitor.otp.resend_requested',
    null,
    jsonb_build_object(
      'visitorId', v_visitor.id
    )
  );

  return true;
end;
$function$;

GRANT EXECUTE ON FUNCTION "public"."resend_otp"(text) TO "anon", "authenticated", "postgres", "service_role";

REVOKE ALL ON FUNCTION "public"."resend_otp"(text) FROM PUBLIC;
