CREATE OR REPLACE FUNCTION public.request_borrow (
  p_visitor_id uuid,
  p_book_id    text
)
  RETURNS public.borrow_requests
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
  AS $function$
begin
  if auth.uid() is null or auth.uid() is distinct from p_visitor_id then
    raise exception 'The authenticated visitor account could not be verified.';
  end if;

  return shelf_private.request_borrow_unchecked(p_visitor_id, p_book_id);
end;
$function$;

GRANT EXECUTE ON FUNCTION "public"."request_borrow"(uuid, text) TO "authenticated", "postgres", "service_role";

REVOKE ALL ON FUNCTION "public"."request_borrow"(uuid, text) FROM PUBLIC;
