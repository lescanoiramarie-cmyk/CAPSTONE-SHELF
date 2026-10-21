CREATE OR REPLACE FUNCTION public.cancel_community_book_request (
  p_request_id           uuid,
  p_requester_visitor_id text,
  p_reason               text DEFAULT 'cancelled'::text
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
  AS $function$
begin
  if auth.uid() is null or not exists (
    select 1
    from public.visitors visitor
    where visitor.id = trim(p_requester_visitor_id)
      and visitor.auth_user_id = auth.uid()
      and visitor.otp_verified
      and visitor.is_active
  ) then
    raise exception 'The authenticated visitor account could not be verified.';
  end if;

  if p_reason <> 'cancelled' then
    raise exception 'Unsupported cancellation reason.';
  end if;

  perform shelf_private.cancel_community_book_request_unchecked(
    p_request_id,
    p_requester_visitor_id
  );
end;
$function$;

GRANT EXECUTE ON FUNCTION "public"."cancel_community_book_request"(uuid, text, text) TO "authenticated", "postgres", "service_role";

REVOKE ALL ON FUNCTION "public"."cancel_community_book_request"(uuid, text, text) FROM PUBLIC;
