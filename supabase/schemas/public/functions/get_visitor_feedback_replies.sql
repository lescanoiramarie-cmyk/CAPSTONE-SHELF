CREATE OR REPLACE FUNCTION public.get_visitor_feedback_replies (
  p_visitor_id text,
  p_email      text
)
  RETURNS TABLE (
    id          uuid,
    subject     text,
    admin_reply text,
    replied_at  timestamp with time zone
  )
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
begin
  if not exists (
    select 1 from public.visitors visitor
    where visitor.id::text = trim(p_visitor_id)
      and lower(visitor.email) = lower(trim(p_email))
      and visitor.auth_user_id = auth.uid()
      and visitor.otp_verified
      and visitor.is_active
  ) then
    raise exception 'Authenticated, active visitor identity could not be verified.';
  end if;
  return query
    select feedback.id, feedback.subject, feedback.admin_reply, feedback.replied_at
    from public.visitor_feedback feedback
    where feedback.visitor_id::text = trim(p_visitor_id)
      and feedback.admin_reply is not null
    order by feedback.replied_at desc;
end;
$function$;

GRANT EXECUTE ON FUNCTION "public"."get_visitor_feedback_replies"(text, text) TO "authenticated", "postgres", "service_role";

REVOKE ALL ON FUNCTION "public"."get_visitor_feedback_replies"(text, text) FROM PUBLIC;
